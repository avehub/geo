//! 应用状态与依赖装配。
//!
//! `services` 层只认 [`AppState`] 里的四个依赖（连接池、密钥存储、LLM 工厂、抓取器），
//! 因此集成测试可以完全绕开 WebView 直接构造状态调用 service（见 `tests/service_flow.rs`）。
//!
//! 装配规则：
//! - SQLite 落在 Tauri app data dir，启动即 `sqlx::migrate!` 并校验；
//! - 密钥只走系统钥匙串（无桌面会话时由调用方换成 `MemorySecretStore`）；
//! - HTTP 一律 rustls，代理取自 `settings`，用户没开就直连。

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use geo_crawler::{FetchLimits, SiteFetcher};
use geo_llm::{FixtureTransport, LlmClient, LlmConfig, LlmProvider, ReqwestTransport, Transport};
use geo_store::{AppSettings, KeyringSecretStore, SecretStore, SettingsRepo};
use sqlx::SqlitePool;

use crate::error::IpcError;

/// 抓取时对外声明的 UA。带联系方式是 robots 礼仪，也便于站点方联系而不是直接封 IP。
pub const USER_AGENT: &str = "geo-desktop/0.1 (+https://gaodekuai.local/bot)";

/// 单次自动建档最多抓多少页：够覆盖首页/关于/产品/FAQ/联系，又不至于拖太久。
pub const MAX_CRAWL_PAGES: usize = 8;

/// SQLite 文件名（位于 Tauri app data dir 下）。
pub const DB_FILE_NAME: &str = "geo.db";

/// LLM 客户端工厂：把「用哪个 transport」与「用哪个 provider/Key」解耦。
///
/// 生产用 `ReqwestTransport`，测试与离线演示用 `FixtureTransport`，
/// service 层拿到的是同一个 `LlmClient` 类型，不需要知道背后是哪种。
#[derive(Clone)]
pub struct LlmFactory {
    transport: Arc<dyn Transport>,
}

impl LlmFactory {
    pub fn new(transport: Arc<dyn Transport>) -> Self {
        Self { transport }
    }

    /// 生产装配：真实 HTTP，走 rustls（不依赖 openssl / cmake）。
    pub fn production(timeout: Duration, proxy: Option<String>) -> Result<Self, IpcError> {
        let transport = ReqwestTransport::new(timeout, proxy)?;
        Ok(Self::new(Arc::new(transport)))
    }

    /// 从目录加载录制响应（`fixtures/llm/`），文件名即 fixture key。
    pub fn fixture_dir(path: &Path) -> Result<Self, IpcError> {
        Ok(Self::new(Arc::new(FixtureTransport::from_dir(path)?)))
    }

    /// 直接用内存里的响应表，测试里最方便。
    pub fn fixture_map(responses: BTreeMap<String, String>) -> Self {
        Self::new(Arc::new(FixtureTransport::from_map(responses)))
    }

    pub fn transport(&self) -> Arc<dyn Transport> {
        self.transport.clone()
    }

    /// 按配置与 Key 构造客户端。Key 只在这里出现，不进日志。
    pub fn client(&self, config: LlmConfig, api_key: &str) -> LlmClient {
        LlmClient::new(config, api_key.to_string(), self.transport.clone())
    }

    /// 由 `AppSettings` 推出 provider 配置；`model` 为空则用 provider 默认模型。
    pub fn config_from_settings(settings: &AppSettings) -> Result<LlmConfig, IpcError> {
        let provider = LlmProvider::parse(&settings.model.provider).ok_or_else(|| {
            IpcError::new(
                "llm/config",
                format!("未知的模型服务商：{}", settings.model.provider),
            )
        })?;
        let mut config =
            LlmConfig::for_provider(provider, geo_store::secret_ref("llm", provider.as_str()));
        if let Some(model) = settings
            .model
            .model
            .as_deref()
            .filter(|m| !m.trim().is_empty())
        {
            config.model = model.trim().to_string();
        }
        config.temperature = settings.model.temperature;
        config.timeout_secs = settings.model.timeout_secs;
        if provider == LlmProvider::Custom && config.base_url.trim().is_empty() {
            return Err(IpcError::new(
                "llm/config",
                "自定义服务商必须填写接口地址（base_url）",
            ));
        }
        Ok(config)
    }
}

/// 由抓取限额与 UA 构造抓取器。
pub fn build_fetcher(
    limits: FetchLimits,
    proxy: Option<String>,
) -> Result<Arc<SiteFetcher>, IpcError> {
    let fetcher = SiteFetcher::new(limits, USER_AGENT, proxy)?;
    Ok(Arc::new(fetcher))
}

/// 应用级共享状态。`Clone` 成本低（内部全是 `Arc` / 连接池句柄）。
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub secrets: Arc<dyn SecretStore>,
    pub llm: Arc<LlmFactory>,
    pub fetcher: Arc<SiteFetcher>,
}

impl AppState {
    /// 生产装配：从 Tauri app data dir 打开数据库，并按设置装配 LLM 与抓取器。
    pub fn initialize(app: &tauri::AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        tauri::async_runtime::block_on(Self::initialize_async(app))
    }

    pub async fn initialize_async(
        app: &tauri::AppHandle,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        use tauri::Manager;

        let data_dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&data_dir)?;
        let pool = geo_store::open(&data_dir.join(DB_FILE_NAME)).await?;

        let settings = SettingsRepo::new(pool.clone()).get().await?;
        let proxy = settings
            .proxy
            .as_ref()
            .filter(|proxy| proxy.enabled)
            .and_then(|proxy| proxy.url.clone());

        Ok(Self {
            pool: pool.clone(),
            secrets: Arc::new(KeyringSecretStore::with_default_service()),
            llm: Arc::new(LlmFactory::production(
                Duration::from_secs(settings.model.timeout_secs),
                proxy.clone(),
            )?),
            fetcher: build_fetcher(fetch_limits_from(&settings), proxy)?,
        })
    }

    /// 测试装配：内存库 + 内存钥匙串 + fixture 传输 + 指向 wiremock 的抓取器。
    pub fn for_test(
        pool: SqlitePool,
        secrets: Arc<dyn SecretStore>,
        llm: Arc<LlmFactory>,
        fetcher: Arc<SiteFetcher>,
    ) -> Self {
        Self {
            pool,
            secrets,
            llm,
            fetcher,
        }
    }

    pub async fn settings(&self) -> Result<AppSettings, IpcError> {
        Ok(SettingsRepo::new(self.pool.clone()).get().await?)
    }
}

/// 把设置里的频控/并发折算成抓取限额。
fn fetch_limits_from(settings: &AppSettings) -> FetchLimits {
    let mut limits = FetchLimits {
        max_pages: MAX_CRAWL_PAGES,
        ..FetchLimits::default()
    };
    limits.total_timeout = Duration::from_secs(settings.model.timeout_secs.max(30) * 2);
    limits
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[tokio::test]
    async fn for_test_wires_memory_store_and_fixture_transport() {
        let state = AppState::for_test(
            geo_store::open_in_memory().await.expect("内存库可用"),
            Arc::new(geo_store::MemorySecretStore::default()),
            Arc::new(LlmFactory::fixture_map(BTreeMap::new())),
            test_fetcher(),
        );

        let (count,): (i64,) = sqlx::query_as("SELECT count(*) FROM projects")
            .fetch_one(&state.pool)
            .await
            .expect("迁移已建表");
        assert_eq!(count, 0);
        state
            .secrets
            .set("llm/deepseek", "sk-x")
            .await
            .expect("内存钥匙串可写");
        assert_eq!(
            state.secrets.get("llm/deepseek").await.unwrap().as_deref(),
            Some("sk-x")
        );
    }

    #[test]
    fn llm_factory_builds_client_with_shared_transport() {
        let factory = LlmFactory::fixture_map(BTreeMap::new());
        let config = LlmConfig::for_provider(LlmProvider::DeepSeek, "keyring://llm/deepseek");
        let client = factory.client(config.clone(), "sk-test");
        assert_eq!(client.config().provider, LlmProvider::DeepSeek);
        assert_eq!(client.config().base_url, "https://api.deepseek.com/v1");
    }

    #[test]
    fn user_agent_identifies_the_product() {
        assert!(USER_AGENT.contains("geo"));
        assert!(USER_AGENT.contains("0.1"));
    }

    #[test]
    fn default_fetch_limits_match_the_documented_budget() {
        let limits = FetchLimits::default();
        assert_eq!(limits.max_pages, MAX_CRAWL_PAGES);
        assert!(limits.max_bytes > 0);
    }

    fn test_fetcher() -> Arc<SiteFetcher> {
        Arc::new(SiteFetcher::new(FetchLimits::default(), USER_AGENT, None).expect("抓取器可构造"))
    }
}

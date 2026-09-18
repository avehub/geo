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
use std::sync::Arc;
use std::time::Duration;

use geo_crawler::{FetchLimits, SiteFetcher};
use geo_llm::{FixtureTransport, LlmClient, LlmConfig, LlmProvider, ReqwestTransport, Transport};
use geo_store::{AppSettings, KeyringSecretStore, SecretStore, SettingsRepo};
use sqlx::SqlitePool;

use crate::error::{err_codes, IpcError};

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
    ///
    /// 三处失败一律发 `llm/config` + 稳定 `reason`（裁定 R-E）：
    /// `unknown_provider`（`value` = 用户填的非法串）/ `missing_base_url` /
    /// `missing_model`（`value` = `Provider::as_str()` 的稳定 id）。
    /// 「设置 → 模型服务商 → 接口地址」这类可操作指引由前端词典按 locale 渲染，
    /// 后端不拼句子（AGENTS 规则 7）。
    pub fn config_from_settings(settings: &AppSettings) -> Result<LlmConfig, IpcError> {
        let provider = LlmProvider::parse(&settings.model.provider).ok_or_else(|| {
            IpcError::with_params(
                err_codes::LLM_CONFIG,
                [
                    ("reason", "unknown_provider"),
                    ("value", settings.model.provider.as_str()),
                ],
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
        // 接口地址覆盖：custom 必填，预设 provider 填了就用用户给的（内网网关场景）。
        if let Some(base_url) = settings
            .model
            .base_url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())
        {
            config.base_url = base_url.to_string();
        }
        if provider == LlmProvider::Custom {
            if config.base_url.trim().is_empty() {
                return Err(IpcError::with_params(
                    err_codes::LLM_CONFIG,
                    [("reason", "missing_base_url"), ("value", provider.as_str())],
                ));
            }
            // `Custom` 没有默认模型名，不填就会在发请求时才报「模型名为空」
            if config.model.trim().is_empty() {
                return Err(IpcError::with_params(
                    err_codes::LLM_CONFIG,
                    [("reason", "missing_model"), ("value", provider.as_str())],
                ));
            }
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
        let proxy = crate::services::active_proxy(&settings);

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

    /// 自定义 Provider 必须真的可用：接口地址与模型名都来自设置（spec FR-L1）。
    #[test]
    fn custom_provider_uses_the_configured_base_url_and_model() {
        let mut settings = AppSettings::default();
        settings.model.provider = "custom".to_string();
        settings.model.base_url = Some("https://api.example.com/v1".to_string());
        settings.model.model = Some("my-model".to_string());

        let config = LlmFactory::config_from_settings(&settings).expect("自定义配置应可用");
        assert_eq!(config.provider, LlmProvider::Custom);
        assert_eq!(config.base_url, "https://api.example.com/v1");
        assert_eq!(config.model, "my-model");
        assert_eq!(config.secret_ref, geo_store::secret_ref("llm", "custom"));
    }

    /// 配置不全时要在**发请求之前**拦下，并发出稳定 `reason` + provider id。
    ///
    /// 「设置 → 模型服务商 → 接口地址」这类可操作指引由前端词典按 locale 渲染
    /// （spec §4.2 / 裁定 R-E）：后端只发记号，`value` 用 `Provider::as_str()`
    /// 的稳定 id（与 Task 4 对 `geo-llm/src/client.rs` 的口径一致），不是中文句子。
    #[test]
    fn custom_provider_gaps_report_stable_reasons_keyed_by_the_provider_id() {
        let mut settings = AppSettings::default();
        settings.model.provider = "custom".to_string();

        let error = LlmFactory::config_from_settings(&settings).expect_err("缺接口地址必须拦下");
        assert_eq!(error.code, "llm/config");
        assert_eq!(error.params["reason"], "missing_base_url");
        assert_eq!(error.params["value"], "custom");
        assert_eq!(error.params.len(), 2, "{:?}", error.params);

        settings.model.base_url = Some("https://api.example.com/v1".to_string());
        let error = LlmFactory::config_from_settings(&settings).expect_err("缺模型名必须拦下");
        assert_eq!(error.code, "llm/config");
        assert_eq!(error.params["reason"], "missing_model");
        assert_eq!(error.params["value"], "custom");
        assert_eq!(error.params.len(), 2, "{:?}", error.params);
    }

    /// `unknown_provider` 的 `value` 是**用户填的那个非法串**，不是合法取值列表
    /// （裁定 R-E：列表前端本来就能从 `llm_providers` 拿到，属文案不属参数）。
    #[test]
    fn unknown_provider_reason_carries_the_offending_value() {
        let mut settings = AppSettings::default();
        settings.model.provider = "gpt".to_string();

        let error =
            LlmFactory::config_from_settings(&settings).expect_err("认不出的服务商必须拦下");
        assert_eq!(error.code, "llm/config");
        assert_eq!(error.params["reason"], "unknown_provider");
        assert_eq!(error.params["value"], "gpt");
        assert_eq!(error.params.len(), 2, "{:?}", error.params);
    }

    /// 预设 Provider 也允许覆盖接口地址（企业内网网关 / 自建代理的常见诉求）。
    #[test]
    fn base_url_override_also_applies_to_preset_providers() {
        let mut settings = AppSettings::default();
        settings.model.base_url = Some("https://gateway.internal/v1".to_string());

        let config = LlmFactory::config_from_settings(&settings).unwrap();
        assert_eq!(config.provider, LlmProvider::DeepSeek);
        assert_eq!(config.base_url, "https://gateway.internal/v1");
    }

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

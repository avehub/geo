//! 设置与密钥服务：应用设置读写、API Key 的钥匙串存取、Provider 预设与连通性测试。
//!
//! 两条纪律：
//! 1. **Key 只进钥匙串**（`SecretStore`），库里只留 `secret_ref` 引用串，
//!    任何返回值、日志、错误信息都不得出现明文（`IpcError::redact` 是最后一道关）；
//! 2. **provider 取值归一化**：`geo-store` 不认识 `geo-llm`（分层约束），
//!    库里存的可能是 `deepseek` 这类用户写法，本层统一收敛成
//!    `LlmProvider::as_str()`，保证与 `llm_providers` 返回值、前端单选框同源。

use std::sync::Arc;
use std::time::Instant;

use geo_domain::GeoError;
use geo_llm::{ChatMessage, ChatRequest, LlmError, LlmProvider};
use geo_store::{secret_ref, AppSettings, ProxyConfig, SecretStore, SettingsRepo};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::{err_codes, redact, IpcError};
use crate::state::LlmFactory;

/// 密钥在钥匙串里的类别前缀：`keyring://llm/<provider>`。
pub const SECRET_KIND: &str = "llm";

/// 连通性测试用的提示词：越短越省钱，只要能拿到一次完整应答即可。
const CONNECTIVITY_PROMPT: &str = "请只回复四个字：连接正常。";

// 设置的安全区间。上限刻意保守：桌面端跑在用户自己的网络与机器上，
// 频控放太开会被引擎封 IP，并发放太高会把笔记本风扇拉满。
pub const MAX_PARALLEL_RANGE: std::ops::RangeInclusive<u8> = 1..=16;
pub const QUEUE_SIZE_RANGE: std::ops::RangeInclusive<usize> = 1..=10_000;
pub const REQUESTS_PER_MINUTE_RANGE: std::ops::RangeInclusive<u32> = 1..=600;
pub const MIN_INTERVAL_RANGE: std::ops::RangeInclusive<u64> = 0..=60_000;
pub const RETRY_MAX_RANGE: std::ops::RangeInclusive<u8> = 0..=10;
pub const TEMPERATURE_RANGE: std::ops::RangeInclusive<f32> = 0.0..=2.0;
pub const TIMEOUT_RANGE: std::ops::RangeInclusive<u64> = 5..=600;

/// 密钥状态。**只有布尔与引用串**，没有值字段——从类型上杜绝明文外泄。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SecretStatus {
    pub provider: String,
    pub configured: bool,
    pub secret_ref: String,
}

/// 一次连通性测试的结果（含用量与成本，成本看板复用同一口径）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LlmTestResult {
    pub ok: bool,
    pub model: String,
    pub latency_ms: u64,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub cost_cny: f64,
    pub message: Option<String>,
}

/// Provider 预设（前端只读展示：base_url、默认模型、单价）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub provider: String,
    pub label_zh: String,
    pub base_url: String,
    pub default_model: String,
    pub input_per_mtok: f64,
    pub output_per_mtok: f64,
}

impl From<LlmProvider> for ProviderInfo {
    fn from(provider: LlmProvider) -> Self {
        let pricing = provider.pricing();
        Self {
            provider: provider.as_str().to_string(),
            label_zh: provider.label_zh().to_string(),
            base_url: provider.base_url().to_string(),
            default_model: provider.default_model().to_string(),
            input_per_mtok: pricing.input_per_mtok,
            output_per_mtok: pricing.output_per_mtok,
        }
    }
}

/// 设置与密钥服务。
#[derive(Clone)]
pub struct SettingsService {
    pool: SqlitePool,
    secrets: Arc<dyn SecretStore>,
    llm: Arc<LlmFactory>,
}

impl SettingsService {
    pub fn new(pool: SqlitePool, secrets: Arc<dyn SecretStore>, llm: Arc<LlmFactory>) -> Self {
        Self { pool, secrets, llm }
    }

    pub fn from_state(state: &crate::state::AppState) -> Self {
        Self::new(state.pool.clone(), state.secrets.clone(), state.llm.clone())
    }

    fn repo(&self) -> SettingsRepo {
        SettingsRepo::new(self.pool.clone())
    }

    /// 读设置。`model.provider` 一律归一化为 `LlmProvider::as_str()`；
    /// 库里存了认不出的值就回落默认厂商，不让应用起不来。
    pub async fn get(&self) -> Result<AppSettings, IpcError> {
        let mut settings = self.repo().get().await?;
        settings.model.provider = canonical_provider(&settings.model.provider)
            .unwrap_or_else(|| LlmProvider::default().as_str())
            .to_string();
        Ok(settings)
    }

    /// 写设置。先体检后落库：任何一项越界都整批拒绝（`validation/failed`）。
    ///
    /// 注意：代理与超时影响的是**已构造好的** HTTP 客户端（`AppState` 里的
    /// `Arc<LlmFactory>` 与 `Arc<SiteFetcher>`），本层只负责持久化，
    /// 变更在应用重启后生效；P0-B 的采集调度会接上热重建。
    pub async fn update(&self, mut settings: AppSettings) -> Result<AppSettings, IpcError> {
        validate_settings(&settings)?;
        settings.model.provider = canonical_provider(&settings.model.provider)
            .ok_or_else(|| {
                GeoError::validation(
                    "model.provider",
                    format!("未知的模型服务商：{}", settings.model.provider),
                )
            })?
            .to_string();
        if let Some(proxy) = &mut settings.proxy {
            proxy.url = proxy.url.as_ref().map(|url| url.trim().to_string());
        }
        settings.language = settings.language.trim().to_string();

        let network_changed = settings.proxy != self.repo().get().await?.proxy;
        self.repo().update(&settings).await?;
        if network_changed {
            tracing::info!("代理设置已变更，将在应用重启后对抓取与模型请求生效");
        }
        Ok(settings)
    }

    /// 全部 Provider 预设（含「自定义」）。
    pub fn providers(&self) -> Vec<ProviderInfo> {
        LlmProvider::all()
            .into_iter()
            .map(ProviderInfo::from)
            .collect()
    }

    /// 写入 API Key。只进钥匙串；库里不存、日志不打。
    pub async fn set_secret(&self, provider: &str, value: &str) -> Result<(), IpcError> {
        let provider = parse_provider(provider)?;
        let value = value.trim();
        if value.is_empty() {
            return Err(GeoError::validation("value", "API Key 不能为空").into());
        }
        self.secrets
            .set(&secret_ref(SECRET_KIND, provider.as_str()), value)
            .await?;
        tracing::info!(provider = provider.as_str(), "API Key 已写入钥匙串");
        Ok(())
    }

    /// 密钥状态：只回答「配没配」与「引用串是什么」。
    pub async fn secret_status(&self, provider: &str) -> Result<SecretStatus, IpcError> {
        let provider = parse_provider(provider)?;
        let reference = secret_ref(SECRET_KIND, provider.as_str());
        let configured = self
            .secrets
            .get(&reference)
            .await?
            .is_some_and(|value| !value.trim().is_empty());
        Ok(SecretStatus {
            provider: provider.as_str().to_string(),
            configured,
            secret_ref: reference,
        })
    }

    /// 删除 API Key（幂等）。
    pub async fn delete_secret(&self, provider: &str) -> Result<(), IpcError> {
        let provider = parse_provider(provider)?;
        self.secrets
            .delete(&secret_ref(SECRET_KIND, provider.as_str()))
            .await?;
        tracing::info!(provider = provider.as_str(), "API Key 已从钥匙串删除");
        Ok(())
    }

    /// 连通性测试：发一条最短提示词，回报模型、耗时、用量与成本。
    ///
    /// 没配 Key / 配置不全属于**用户要修的问题**，返回错误让前端引导；
    /// 网络不通、限流、5xx 属于**测试结果**，用 `ok=false` + 中文原因回给界面。
    pub async fn provider_test(&self, provider: &str) -> Result<LlmTestResult, IpcError> {
        let provider = parse_provider(provider)?;
        let client = self.client_for(provider).await?;
        let model = client.config().model.clone();
        let request = ChatRequest::new(vec![ChatMessage::user(CONNECTIVITY_PROMPT)]);

        let started = Instant::now();
        let outcome = client.chat_with_cost(&request).await;
        let latency_ms = started.elapsed().as_millis() as u64;

        Ok(match outcome {
            Ok((response, cost_cny)) => {
                tracing::info!(
                    provider = provider.as_str(),
                    model = %response.model,
                    latency_ms,
                    prompt_tokens = response.usage.prompt_tokens,
                    completion_tokens = response.usage.completion_tokens,
                    cost_cny,
                    "连通性测试成功"
                );
                LlmTestResult {
                    ok: true,
                    model,
                    latency_ms,
                    prompt_tokens: response.usage.prompt_tokens,
                    completion_tokens: response.usage.completion_tokens,
                    cost_cny,
                    message: None,
                }
            }
            Err(error) => {
                tracing::warn!(
                    provider = provider.as_str(),
                    code = error.code(),
                    latency_ms,
                    "连通性测试失败"
                );
                LlmTestResult {
                    ok: false,
                    model,
                    latency_ms,
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    cost_cny: 0.0,
                    message: Some(redact(&error.user_message())),
                }
            }
        })
    }

    /// 为指定 provider 装配客户端。测试的不是当前默认厂商时，用该厂商的默认模型。
    async fn client_for(&self, provider: LlmProvider) -> Result<geo_llm::LlmClient, IpcError> {
        let mut settings = self.get().await?;
        let configured = canonical_provider(&settings.model.provider) == Some(provider.as_str());
        settings.model.provider = provider.as_str().to_string();
        if !configured {
            settings.model.model = None;
        }
        let config = LlmFactory::config_from_settings(&settings)?;
        let api_key = self
            .secrets
            .get(&config.secret_ref)
            .await?
            .filter(|key| !key.trim().is_empty())
            .ok_or(IpcError::from(LlmError::MissingSecret))?;
        Ok(self.llm.client(config, &api_key))
    }
}

/// 宽松解析 provider：认不出就报 `llm/config`，并列出合法取值。
fn parse_provider(raw: &str) -> Result<LlmProvider, IpcError> {
    LlmProvider::parse(raw).ok_or_else(|| {
        IpcError::new(
            err_codes::LLM_CONFIG,
            format!(
                "未知的模型服务商：{raw}。可选值：{}",
                LlmProvider::all()
                    .iter()
                    .map(|provider| provider.as_str())
                    .collect::<Vec<_>>()
                    .join("、")
            ),
        )
    })
}

/// 归一化为 `as_str()`；认不出返回 `None`。
fn canonical_provider(raw: &str) -> Option<&'static str> {
    LlmProvider::parse(raw).map(|provider| provider.as_str())
}

/// 设置体检：越界一律中文报错，字段名与前端表单一一对应。
fn validate_settings(settings: &AppSettings) -> Result<(), IpcError> {
    let AppSettings {
        proxy,
        concurrency,
        rate_limit,
        model,
        language,
        notify: _,
    } = settings;

    in_range(
        "concurrency.max_parallel",
        concurrency.max_parallel,
        &MAX_PARALLEL_RANGE,
    )?;
    in_range(
        "concurrency.queue_size",
        concurrency.queue_size,
        &QUEUE_SIZE_RANGE,
    )?;
    in_range(
        "rate_limit.requests_per_minute",
        rate_limit.requests_per_minute,
        &REQUESTS_PER_MINUTE_RANGE,
    )?;
    in_range(
        "rate_limit.min_interval_ms",
        rate_limit.min_interval_ms,
        &MIN_INTERVAL_RANGE,
    )?;
    in_range(
        "rate_limit.retry_max",
        rate_limit.retry_max,
        &RETRY_MAX_RANGE,
    )?;
    in_range("model.temperature", model.temperature, &TEMPERATURE_RANGE)?;
    in_range("model.timeout_secs", model.timeout_secs, &TIMEOUT_RANGE)?;

    if canonical_provider(&model.provider).is_none() {
        return Err(GeoError::validation(
            "model.provider",
            format!("未知的模型服务商：{}", model.provider),
        )
        .into());
    }
    if let Some(model_name) = model
        .model
        .as_deref()
        .filter(|name| !name.trim().is_empty())
    {
        if model_name.chars().count() > 120 {
            return Err(GeoError::validation("model.model", "模型名过长").into());
        }
    }
    if language.trim().is_empty() {
        return Err(GeoError::validation("language", "界面语言不能为空").into());
    }
    // 接口地址：只接受 http(s)。空白视为「未填」，交给 config_from_settings 判断。
    if let Some(base_url) = model
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
    {
        if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
            return Err(GeoError::validation(
                "model.base_url",
                format!("接口地址需以 http:// 或 https:// 开头，当前 {base_url}"),
            )
            .into());
        }
        if url::Url::parse(base_url).is_err() {
            return Err(GeoError::validation(
                "model.base_url",
                format!("接口地址不是合法 URL：{base_url}"),
            )
            .into());
        }
    }
    if let Some(proxy) = proxy {
        if proxy.enabled {
            let url = proxy.url.as_deref().unwrap_or("").trim();
            if url.is_empty() {
                return Err(GeoError::validation("proxy.url", "开启代理时必须填写代理地址").into());
            }
            if !(url.starts_with("http://")
                || url.starts_with("https://")
                || url.starts_with("socks5://"))
            {
                return Err(GeoError::validation(
                    "proxy.url",
                    format!("代理地址需以 http:// / https:// / socks5:// 开头，当前 {url}"),
                )
                .into());
            }
        }
    }
    Ok(())
}

fn in_range<T>(field: &str, value: T, range: &std::ops::RangeInclusive<T>) -> Result<(), IpcError>
where
    T: PartialOrd + std::fmt::Display + Copy,
{
    if range.contains(&value) {
        return Ok(());
    }
    Err(GeoError::validation(
        field,
        format!(
            "取值需在 {}~{} 之间，当前 {value}",
            range.start(),
            range.end()
        ),
    )
    .into())
}

/// 供命令层复用：把用户填的代理转成 `Option<String>`（未开启即直连）。
pub fn active_proxy(settings: &AppSettings) -> Option<String> {
    let proxy: &ProxyConfig = settings.proxy.as_ref()?;
    if !proxy.enabled {
        return None;
    }
    proxy
        .url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 自定义接口地址只接受 http(s)，且不能是明显写错的串。
    #[test]
    fn validate_settings_rejects_a_non_http_base_url() {
        let mut settings = AppSettings::default();
        settings.model.base_url = Some("ftp://api.example.com".to_string());
        let error = validate_settings(&settings).expect_err("非 http(s) 必须拒绝");
        assert_eq!(error.code, "validation/failed");

        settings.model.base_url = Some("  ".to_string());
        assert!(validate_settings(&settings).is_ok(), "空白视为未填");

        settings.model.base_url = Some("https://api.example.com/v1".to_string());
        assert!(validate_settings(&settings).is_ok());
    }

    #[test]
    fn provider_names_are_normalized_to_the_wire_form() {
        assert_eq!(canonical_provider("deepseek"), Some("deep_seek"));
        assert_eq!(canonical_provider("DeepSeek"), Some("deep_seek"));
        assert_eq!(canonical_provider("kimi"), Some("moonshot"));
        assert_eq!(canonical_provider("doubao"), Some("volcengine_ark"));
        assert_eq!(canonical_provider("qwen"), Some("ali_bailian"));
        assert_eq!(canonical_provider("ernie"), Some("baidu_qianfan"));
        assert_eq!(canonical_provider("hunyuan"), Some("tencent_hunyuan"));
        assert_eq!(canonical_provider("不知道"), None);
        assert_eq!(canonical_provider(""), None);
    }

    #[test]
    fn every_documented_provider_has_a_preset() {
        for provider in LlmProvider::all() {
            let info = ProviderInfo::from(provider);
            assert_eq!(info.provider, provider.as_str());
            assert!(!info.label_zh.is_empty());
            if provider == LlmProvider::Custom {
                assert!(info.base_url.is_empty());
            } else {
                assert!(info.base_url.starts_with("https://"), "{}", info.base_url);
                assert!(!info.default_model.is_empty());
            }
        }
    }

    #[test]
    fn settings_validation_rejects_out_of_range_values() {
        let mut settings = AppSettings::default();
        settings.model.provider = "deep_seek".to_string();
        validate_settings(&settings).expect("默认设置合法");

        for broken in [
            |s: &mut AppSettings| s.concurrency.max_parallel = 0,
            |s: &mut AppSettings| s.concurrency.max_parallel = 17,
            |s: &mut AppSettings| s.concurrency.queue_size = 0,
            |s: &mut AppSettings| s.rate_limit.requests_per_minute = 0,
            |s: &mut AppSettings| s.rate_limit.requests_per_minute = 601,
            |s: &mut AppSettings| s.rate_limit.min_interval_ms = 60_001,
            |s: &mut AppSettings| s.rate_limit.retry_max = 11,
            |s: &mut AppSettings| s.model.temperature = -0.1,
            |s: &mut AppSettings| s.model.temperature = 2.1,
            |s: &mut AppSettings| s.model.timeout_secs = 4,
            |s: &mut AppSettings| s.model.timeout_secs = 601,
            |s: &mut AppSettings| s.language = "  ".to_string(),
            |s: &mut AppSettings| s.model.provider = "gpt".to_string(),
            |s: &mut AppSettings| {
                s.proxy = Some(ProxyConfig {
                    enabled: true,
                    url: None,
                })
            },
            |s: &mut AppSettings| {
                s.proxy = Some(ProxyConfig {
                    enabled: true,
                    url: Some("ftp://x".to_string()),
                })
            },
        ] {
            let mut candidate = settings.clone();
            broken(&mut candidate);
            let error = validate_settings(&candidate).expect_err("应被拒绝");
            assert_eq!(error.code, "validation/failed", "{error}");
        }
    }

    #[test]
    fn a_disabled_proxy_needs_no_url() {
        let mut settings = AppSettings::default();
        settings.model.provider = "deep_seek".to_string();
        settings.proxy = Some(ProxyConfig {
            enabled: false,
            url: None,
        });
        validate_settings(&settings).expect("关着的代理不校验地址");
        assert_eq!(active_proxy(&settings), None);

        settings.proxy = Some(ProxyConfig {
            enabled: true,
            url: Some("http://127.0.0.1:7890".to_string()),
        });
        validate_settings(&settings).expect("合法代理地址");
        assert_eq!(
            active_proxy(&settings).as_deref(),
            Some("http://127.0.0.1:7890")
        );
    }

    #[test]
    fn secret_status_has_no_field_that_could_carry_the_value() {
        let status = SecretStatus {
            provider: "deep_seek".to_string(),
            configured: true,
            secret_ref: secret_ref(SECRET_KIND, "deep_seek"),
        };
        let json = serde_json::to_value(&status).expect("可序列化");
        let mut keys: Vec<&str> = json
            .as_object()
            .expect("对象")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, ["configured", "provider", "secret_ref"]);
    }

    #[test]
    fn unknown_provider_error_lists_the_valid_values() {
        let error = parse_provider("openai").expect_err("不在预设里");
        assert_eq!(error.code, "llm/config");
        assert!(error.message.contains("deep_seek"), "{}", error.message);
        assert!(error.message.contains("custom"), "{}", error.message);
    }
}

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

/// 模型名长度上限（**字符数**，配 `too_long` 的 `limit`）。
/// 提成常量：这个值现在会作为 `params["limit"]` 出到前端，
/// 判定与参数必须同源，否则词典模板会渲出一个与判定不符的上限。
const MAX_MODEL_NAME_CHARS: usize = 120;

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
            .ok_or_else(|| unknown_provider_validation(settings.model.provider.as_str()))?
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
            // 裁定 R-F 的唯一例外：`field` 从含糊的 `value` 改成 `api_key`
            // （英文侧会渲成「值不能为空」），Task 7 的 `fields.ts` 补一个词条即可。
            return Err(GeoError::validation("api_key", "required").into());
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

/// 宽松解析 provider：认不出就报 `llm/config` + `reason=unknown_provider`。
///
/// 裁定 R-E / §G-7：`value` 一律装**出错的值**（用户填的那个非法串），
/// 不再把合法取值列表拼进错误——列表前端本来就能从 `llm_providers` 拿到，属文案不属参数。
fn parse_provider(raw: &str) -> Result<LlmProvider, IpcError> {
    LlmProvider::parse(raw).ok_or_else(|| {
        IpcError::with_params(
            err_codes::LLM_CONFIG,
            [("reason", "unknown_provider"), ("value", raw)],
        )
    })
}

/// `validation/failed` 形态的「服务商认不出」：与 [`parse_provider`] 同一份数据，
/// 只是 code 不同（前者走表单字段校验，后者走命令入参）。
fn unknown_provider_validation(raw: &str) -> GeoError {
    GeoError::validation("model.provider", "unknown_provider").with_param("value", raw)
}

/// 归一化为 `as_str()`；认不出返回 `None`。
fn canonical_provider(raw: &str) -> Option<&'static str> {
    LlmProvider::parse(raw).map(|provider| provider.as_str())
}

/// 设置体检：越界一律报 `validation/failed` + 目录 key，
/// `field` 与前端表单一一对应（`field` 是 Task 7 `fields.ts` 词典的键，裁定 R-F：原则上不改名）。
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
        return Err(unknown_provider_validation(&model.provider).into());
    }
    if let Some(model_name) = model
        .model
        .as_deref()
        .filter(|name| !name.trim().is_empty())
    {
        if model_name.chars().count() > MAX_MODEL_NAME_CHARS {
            return Err(GeoError::validation("model.model", "too_long")
                .with_param("limit", MAX_MODEL_NAME_CHARS)
                .into());
        }
    }
    if language.trim().is_empty() {
        return Err(GeoError::validation("language", "required").into());
    }
    // 接口地址：只接受 http(s)。空白视为「未填」，交给 config_from_settings 判断。
    if let Some(base_url) = model
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
    {
        // 协议判据是**我们自己写的形状判据** → `invalid_format`；
        // 解析器判不了 → `invalid_url`（目录语义规则 3）。两者都配 `value` = 出错的原始值。
        if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
            return Err(GeoError::validation("model.base_url", "invalid_format")
                .with_param("value", base_url)
                .into());
        }
        if url::Url::parse(base_url).is_err() {
            return Err(GeoError::validation("model.base_url", "invalid_url")
                .with_param("value", base_url)
                .into());
        }
    }
    if let Some(proxy) = proxy {
        if proxy.enabled {
            let url = proxy.url.as_deref().unwrap_or("").trim();
            if url.is_empty() {
                return Err(GeoError::validation("proxy.url", "required").into());
            }
            if !(url.starts_with("http://")
                || url.starts_with("https://")
                || url.starts_with("socks5://"))
            {
                return Err(GeoError::validation("proxy.url", "invalid_format")
                    .with_param("value", url)
                    .into());
            }
        }
    }
    Ok(())
}

/// 数值区间体检：`out_of_range` + `expected`（语言中立的 `a~b` 闭区间表达式，
/// **不带单位**）+ `value`（用户填的实际值）。目录语义规则 2。
fn in_range<T>(field: &str, value: T, range: &std::ops::RangeInclusive<T>) -> Result<(), IpcError>
where
    T: PartialOrd + std::fmt::Display + Copy,
{
    if range.contains(&value) {
        return Ok(());
    }
    Err(GeoError::validation(field, "out_of_range")
        .with_param("expected", format!("{}~{}", range.start(), range.end()))
        .with_param("value", value)
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

    /// 裁定 §G-7：`unknown_provider` 的 `value` 是**用户填的那个非法串**，
    /// 合法取值列表不再进错误（前端能从 `llm_providers` 拿到，属文案不属参数）。
    /// 原用例 `unknown_provider_error_lists_the_valid_values` 钉的正是被驳回的旧口径。
    #[test]
    fn unknown_provider_error_carries_the_offending_value() {
        let error = parse_provider("openai").expect_err("不在预设里");
        assert_eq!(error.code, "llm/config");
        assert_eq!(error.params["reason"], "unknown_provider");
        assert_eq!(error.params["value"], "openai");
        assert_eq!(error.params.len(), 2, "{:?}", error.params);
        for provider in LlmProvider::all() {
            assert!(
                !error.message.contains(provider.as_str()),
                "合法取值列表不该再进错误：{}",
                error.message
            );
        }
    }

    /// `validate_settings` 的 15 处站点逐处钉住 `(code, field, reason, params)`。
    ///
    /// 裁定 R-H 第一档：一律**经生产函数**触发（`validate_settings` 是私有函数，
    /// 集成测试拿不到），且断言到 params 的**键与值**——只断言 `code` 的话，
    /// `limit` 写成 `expected`、`1~16` 写成 `16` 都不会红（Task 3 复审 I-1 的教训）。
    ///
    /// 期望值是**字面量**而不是把站点的表达式抄一遍：站点若从
    /// `format!("{}~{}", start, end)` 改成 `format!("<={}", end)`，这条会红，
    /// 而抄表达式不会。常量与字面量的同源由 [`the_documented_ranges_match_the_constants`] 钉。
    #[test]
    fn validate_settings_reports_directory_keys_with_language_neutral_params() {
        struct Case {
            name: &'static str,
            break_it: fn(&mut AppSettings),
            field: &'static str,
            reason: &'static str,
            /// 除 `field` / `reason` 之外必须**恰好**出现的配套参数。
            extra: &'static [(&'static str, &'static str)],
        }

        let cases = [
            Case {
                name: "并发数越下界",
                break_it: |settings| settings.concurrency.max_parallel = 0,
                field: "concurrency.max_parallel",
                reason: "out_of_range",
                extra: &[("expected", "1~16"), ("value", "0")],
            },
            Case {
                name: "并发数越上界",
                break_it: |settings| settings.concurrency.max_parallel = 17,
                field: "concurrency.max_parallel",
                reason: "out_of_range",
                extra: &[("expected", "1~16"), ("value", "17")],
            },
            Case {
                name: "队列长度越界",
                break_it: |settings| settings.concurrency.queue_size = 0,
                field: "concurrency.queue_size",
                reason: "out_of_range",
                extra: &[("expected", "1~10000"), ("value", "0")],
            },
            Case {
                name: "每分钟请求数越界",
                break_it: |settings| settings.rate_limit.requests_per_minute = 601,
                field: "rate_limit.requests_per_minute",
                reason: "out_of_range",
                extra: &[("expected", "1~600"), ("value", "601")],
            },
            Case {
                name: "最小间隔越界",
                break_it: |settings| settings.rate_limit.min_interval_ms = 60_001,
                field: "rate_limit.min_interval_ms",
                reason: "out_of_range",
                extra: &[("expected", "0~60000"), ("value", "60001")],
            },
            Case {
                name: "重试次数越界",
                break_it: |settings| settings.rate_limit.retry_max = 11,
                field: "rate_limit.retry_max",
                reason: "out_of_range",
                extra: &[("expected", "0~10"), ("value", "11")],
            },
            Case {
                name: "温度越界",
                break_it: |settings| settings.model.temperature = 2.1,
                field: "model.temperature",
                reason: "out_of_range",
                extra: &[("expected", "0~2"), ("value", "2.1")],
            },
            Case {
                name: "超时越界",
                break_it: |settings| settings.model.timeout_secs = 4,
                field: "model.timeout_secs",
                reason: "out_of_range",
                extra: &[("expected", "5~600"), ("value", "4")],
            },
            Case {
                name: "服务商认不出",
                break_it: |settings| settings.model.provider = "gpt".to_string(),
                field: "model.provider",
                reason: "unknown_provider",
                extra: &[("value", "gpt")],
            },
            Case {
                name: "模型名过长",
                break_it: |settings| settings.model.model = Some("m".repeat(121)),
                field: "model.model",
                reason: "too_long",
                extra: &[("limit", "120")],
            },
            Case {
                name: "界面语言为空",
                break_it: |settings| settings.language = "  ".to_string(),
                field: "language",
                reason: "required",
                extra: &[],
            },
            Case {
                name: "接口地址不是 http(s)",
                break_it: |settings| {
                    settings.model.base_url = Some("ftp://api.example.com".to_string())
                },
                field: "model.base_url",
                reason: "invalid_format",
                extra: &[("value", "ftp://api.example.com")],
            },
            Case {
                name: "接口地址缺少合法域名",
                break_it: |settings| settings.model.base_url = Some("http://".to_string()),
                field: "model.base_url",
                reason: "invalid_url",
                extra: &[("value", "http://")],
            },
            Case {
                name: "开了代理却没填地址",
                break_it: |settings| {
                    settings.proxy = Some(ProxyConfig {
                        enabled: true,
                        url: None,
                    })
                },
                field: "proxy.url",
                reason: "required",
                extra: &[],
            },
            Case {
                name: "代理协议不支持",
                break_it: |settings| {
                    settings.proxy = Some(ProxyConfig {
                        enabled: true,
                        url: Some("ftp://proxy.example".to_string()),
                    })
                },
                field: "proxy.url",
                reason: "invalid_format",
                extra: &[("value", "ftp://proxy.example")],
            },
        ];

        for case in cases {
            let mut settings = AppSettings::default();
            settings.model.provider = "deep_seek".to_string();
            (case.break_it)(&mut settings);

            let error = validate_settings(&settings).expect_err(case.name);
            assert_eq!(error.code, "validation/failed", "{}", case.name);
            assert_eq!(error.params["field"], case.field, "{}", case.name);
            assert_eq!(error.params["reason"], case.reason, "{}", case.name);

            let mut expected: std::collections::BTreeMap<String, String> = case
                .extra
                .iter()
                .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
                .collect();
            expected.insert("field".to_string(), case.field.to_string());
            expected.insert("reason".to_string(), case.reason.to_string());
            assert_eq!(error.params, expected, "{}：{:?}", case.name, error.params);
        }
    }

    /// 用例里钉死的 `expected` / `limit` 字面量与常量同源。
    #[test]
    fn the_documented_ranges_match_the_constants() {
        assert_eq!(MAX_PARALLEL_RANGE, 1..=16);
        assert_eq!(QUEUE_SIZE_RANGE, 1..=10_000);
        assert_eq!(REQUESTS_PER_MINUTE_RANGE, 1..=600);
        assert_eq!(MIN_INTERVAL_RANGE, 0..=60_000);
        assert_eq!(RETRY_MAX_RANGE, 0..=10);
        assert_eq!(TEMPERATURE_RANGE, 0.0..=2.0);
        assert_eq!(TIMEOUT_RANGE, 5..=600);
    }
}

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
use geo_llm::{ChatMessage, ChatRequest, HttpMethod, HttpRequest, LlmError, LlmProvider};
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

/// `model.protocol` 允许保存的取值。`anthropic` 可以存进设置，
/// 但桌面端发请求前由 `LlmFactory::config_from_settings` 以 `unsupported_protocol`
/// 拒绝（Rust 目前只实现了 OpenAI 兼容那一支）。
pub const MODEL_PROTOCOLS: [&str; 2] = ["openai_compat", "anthropic"];

/// 搜索专用 provider：只用于 `keyring://llm/metaso` 的搜索 API Key。
/// 🔴 它不是 `LlmProvider`：不进 `llm_providers`，也不能作为 `model.provider`。
const METASO_PROVIDER: &str = "metaso";

/// Google OAuth 的客户端密钥位（可空；desktop client + PKCE 不需要）。
/// 与 GSC token（`gsc`）一样只占钥匙串位，**不是** `LlmProvider`。
const GOOGLE_OAUTH_PROVIDER: &str = "google_oauth";
/// GSC token 的钥匙串位（OAuth 成功后由 `search_oauth` 写入）。
const GSC_TOKEN_PROVIDER: &str = "gsc";
/// Bing Webmaster OAuth 的客户端密钥位（只进钥匙串，不是 `LlmProvider`）。
const BING_OAUTH_PROVIDER: &str = "bing_oauth";
/// Bing Webmaster 的 API Key 位。Bing 官方推荐用 API Key 取数：一次生成、
/// 长期有效、不需要登记回调地址（OAuth 控制台不接受 loopback 重定向）。
const BING_WMT_PROVIDER: &str = "bing_wmt";

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

/// `llm_models_list` 的入参 = **界面上的草稿配置**（DR-34），不是已落库那份。
#[derive(Debug, Clone, Deserialize)]
pub struct LlmModelsQuery {
    pub provider: String,
    #[serde(default)]
    pub protocol: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    /// 契约里保留的临时 Key 位；真后端一律读钥匙串，**不使用**这个字段。
    #[serde(default)]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelsListSource {
    Preset,
    Upstream,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelsListResult {
    pub models: Vec<String>,
    pub source: ModelsListSource,
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
        let provider = parse_secret_provider(provider)?;
        let value = value.trim();
        if value.is_empty() {
            // 裁定 R-F 的唯一例外：`field` 从含糊的 `value` 改成 `api_key`
            // （英文侧会渲成「值不能为空」），Task 7 的 `fields.ts` 补一个词条即可。
            return Err(GeoError::validation("api_key", "required").into());
        }
        self.secrets
            .set(&secret_ref(SECRET_KIND, &provider), value)
            .await?;
        tracing::info!(provider = %provider, "API Key 已写入钥匙串");
        Ok(())
    }

    /// 密钥状态：只回答「配没配」与「引用串是什么」。
    ///
    /// 🔴 用 `exists` 而不是 `get`：设置页一打开就会查这一条，而 `get` 在 macOS 上
    /// 走 legacy Keychain 的解密路径——开发构建的 ad-hoc 签名每次重编 cdhash 都会变，
    /// 条目 ACL 不认当前二进制，于是弹「允许访问 com.gaodekuai.geo」的授权框，
    /// 用户输完密码还可能在 securityd 的 decrypt 上卡住。状态查询根本不需要明文。
    pub async fn secret_status(&self, provider: &str) -> Result<SecretStatus, IpcError> {
        let provider = parse_secret_provider(provider)?;
        let reference = secret_ref(SECRET_KIND, &provider);
        let configured = self.secrets.exists(&reference).await?;
        Ok(SecretStatus {
            provider,
            configured,
            secret_ref: reference,
        })
    }

    /// 删除 API Key（幂等）。
    pub async fn delete_secret(&self, provider: &str) -> Result<(), IpcError> {
        let provider = parse_secret_provider(provider)?;
        self.secrets
            .delete(&secret_ref(SECRET_KIND, &provider))
            .await?;
        tracing::info!(provider = %provider, "API Key 已从钥匙串删除");
        Ok(())
    }

    /// 连通性测试：发一条最短提示词，回报模型、耗时、用量与成本。
    ///
    /// 没配 Key / 配置不全属于**用户要修的问题**，返回错误让前端引导；
    /// 网络不通、限流、5xx 属于**测试结果**，用 `ok=false` + 中文原因回给界面。
    pub async fn provider_test(&self, provider: &str) -> Result<LlmTestResult, IpcError> {
        let provider = parse_llm_provider(provider)?;
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

    /// 按**界面草稿**拉模型清单：`GET {base_url}/models`。
    ///
    /// - Key 只读钥匙串（`api_key` 入参刻意忽略，杜绝密钥经 IPC 回传）；
    /// - `custom` 缺接口地址 ⇒ `llm/config {reason: missing_base_url}`；
    /// - `anthropic` 协议只影响鉴权头（`x-api-key` + `anthropic-version`），
    ///   路径仍是 `{base_url}/models`；其余按 OpenAI 兼容的 Bearer。
    pub async fn list_models(&self, query: LlmModelsQuery) -> Result<ModelsListResult, IpcError> {
        let provider = parse_llm_provider(&query.provider)?;
        let draft_base = query
            .base_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let base_url = match (provider, draft_base) {
            (_, Some(value)) => value.to_string(),
            (LlmProvider::Custom, None) => {
                return Err(IpcError::with_params(
                    err_codes::LLM_CONFIG,
                    [("reason", "missing_base_url"), ("value", provider.as_str())],
                ));
            }
            (provider, None) => provider.base_url().to_string(),
        };
        let secret_ref = geo_store::secret_ref(SECRET_KIND, provider.as_str());
        let api_key = self
            .secrets
            .get(&secret_ref)
            .await?
            .filter(|key| !key.trim().is_empty())
            .ok_or(IpcError::from(LlmError::MissingSecret))?;

        let url = format!("{}/models", base_url.trim_end_matches('/'));
        let anthropic = query
            .protocol
            .as_deref()
            .map(|value| value.trim().eq_ignore_ascii_case("anthropic"))
            .unwrap_or(false);
        let headers = if anthropic {
            vec![
                ("x-api-key".to_string(), api_key),
                ("anthropic-version".to_string(), "2023-06-01".to_string()),
                ("Accept".to_string(), "application/json".to_string()),
            ]
        } else {
            vec![
                ("Authorization".to_string(), format!("Bearer {api_key}")),
                ("Accept".to_string(), "application/json".to_string()),
            ]
        };
        let response = self
            .llm
            .transport()
            .send(HttpRequest {
                method: HttpMethod::Get,
                url,
                headers,
                body: String::new(),
            })
            .await?;
        if response.status == 429 {
            return Err(IpcError::from(LlmError::RateLimited));
        }
        if !response.is_success() {
            return Err(IpcError::from(LlmError::Server {
                status: response.status,
            }));
        }
        let value: serde_json::Value = serde_json::from_str(&response.body)
            .map_err(|_| IpcError::from(LlmError::bad_response("parse_failed")))?;
        let mut models = Vec::new();
        if let Some(items) = value.get("data").and_then(|value| value.as_array()) {
            for item in items {
                if let Some(id) = item.get("id").and_then(|value| value.as_str()) {
                    models.push(id.to_string());
                }
            }
        } else if let Some(items) = value.get("models").and_then(|value| value.as_array()) {
            for item in items {
                let id = item.as_str().map(str::to_string).or_else(|| {
                    item.get("id")
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                });
                if let Some(id) = id {
                    models.push(id);
                }
            }
        } else {
            return Err(IpcError::from(LlmError::bad_response("missing_choices")));
        }
        let mut seen = std::collections::HashSet::new();
        models.retain(|model| seen.insert(model.clone()));
        Ok(ModelsListResult {
            models,
            source: ModelsListSource::Upstream,
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

/// 宽松解析 **模型厂商**：认不出就报 `llm/config` + `reason=unknown_provider`。
///
/// 裁定 R-E / §G-7：`value` 一律装**出错的值**（用户填的那个非法串），
/// 不再把合法取值列表拼进错误——列表前端本来就能从 `llm_providers` 拿到，属文案不属参数。
fn parse_llm_provider(raw: &str) -> Result<LlmProvider, IpcError> {
    LlmProvider::parse(raw).ok_or_else(|| {
        IpcError::with_params(
            err_codes::LLM_CONFIG,
            [("reason", "unknown_provider"), ("value", raw)],
        )
    })
}

/// 密钥命令的 provider 解析：`LlmProvider` 预设 **加** 五个非模型钥匙串位
/// （`metaso` 搜索 Key、`google_oauth` 客户端密钥、`gsc` OAuth token、
/// `bing_wmt` Bing API Key、`bing_oauth` 历史 OAuth 客户端密钥）。
///
/// 🔴 `bing_oauth` 保留只为让旧钥匙串条目仍可读 / 可删：Bing 已改走 API Key，
/// 不再有 OAuth 流程（见 `services/search_oauth.rs` 文件头）。
///
/// 三段密钥命令（`secret_set` / `secret_status` / `secret_delete`）用这个；
/// 模型设置、连通性测试与模型清单仍用 [`parse_llm_provider`]，所以 `metaso`
/// 永远不会被当成 `model.provider`。返回值是归一化后的 wire id（`deep_seek` / `metaso` …）。
fn parse_secret_provider(raw: &str) -> Result<String, IpcError> {
    let normalized = raw.trim().to_ascii_lowercase();
    if [
        METASO_PROVIDER,
        GOOGLE_OAUTH_PROVIDER,
        GSC_TOKEN_PROVIDER,
        BING_OAUTH_PROVIDER,
        BING_WMT_PROVIDER,
    ]
    .contains(&normalized.as_str())
    {
        return Ok(normalized);
    }
    parse_llm_provider(raw).map(|provider| provider.as_str().to_string())
}

/// `validation/failed` 形态的「服务商认不出」：与 [`parse_llm_provider`] 同一份数据，
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
        storage,
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

    if !MODEL_PROTOCOLS.contains(&model.protocol.as_str()) {
        return Err(GeoError::validation("model.protocol", "not_allowed")
            .with_param("value", &model.protocol)
            .into());
    }
    if let Some(dir) = storage.last_export_dir.as_deref() {
        if !std::path::Path::new(dir).is_absolute() {
            return Err(
                GeoError::validation("storage.last_export_dir", "invalid_format")
                    .with_param("value", dir)
                    .into(),
            );
        }
    }

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
                // P2-08：回显**抹掉 userinfo 的形态**，不把用户填的原串整段送进 params
                // （params 会原样进前端、日志与导出）；解析不出来就不发 `value`。
                let mut error = GeoError::validation("proxy.url", "invalid_format");
                if let Some(redacted) = redacted_proxy_url(url) {
                    error = error.with_param("value", redacted);
                }
                return Err(error.into());
            }
        }
        // P2-08：代理地址内嵌 `user:pass@` 一律拒绝。判据住在
        // `geo_store::ProxyConfig::validate`——写库前是同一道闸，两层不会漂移。
        // 🔴 刻意放在协议判据之后：先告诉用户「协议不对」，再说「不许带账号密码」；
        // 也刻意不看 `enabled`：关着的代理照样明文落库。
        proxy.validate()?;
    }
    Ok(())
}

/// 回显用的代理地址：`scheme://host[:port]`——抹掉 userinfo 与路径/查询。
///
/// 解析不出来的串返回 `None`，调用方就不发 `value`：宁可少给信息，也不能把可能
/// 夹带凭据的原串送进 params（AGENTS 规则 3）。端口按用户写出来的样子保留
/// （`port()` 而不是 `port_or_known_default()`，免得给 `ftp://h` 凭空补上 `:21`）。
fn redacted_proxy_url(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    Some(match parsed.port() {
        Some(port) => format!("{}://{}:{}", parsed.scheme(), host, port),
        None => format!("{}://{}", parsed.scheme(), host),
    })
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

    /// P2-08：`ProxyConfig` 整段明文进 settings 表，所以 `user:pass@` 形态的凭据
    /// 一律拒绝——不论代理开关是否打开（关着也照样落库、照样随备份与导出扩散）。
    /// 错误里**不得**出现原始串：`params` 与兜底 `message` 都要过这一关（AGENTS 规则 3）。
    #[test]
    fn validate_settings_rejects_credentials_embedded_in_the_proxy_url() {
        let mut settings = AppSettings::default();
        settings.model.provider = "deep_seek".to_string();

        for url in [
            "http://u:p@proxy.example:8080",
            "https://u:p@proxy.example",
            "socks5://u:p@127.0.0.1:1080",
            "http://editor@proxy.example:8080",
        ] {
            settings.proxy = Some(ProxyConfig {
                enabled: true,
                url: Some(url.to_string()),
            });
            let error = match validate_settings(&settings) {
                Ok(()) => panic!("{url} 内嵌凭据必须被拒绝"),
                Err(error) => error,
            };
            assert_eq!(error.code, "validation/failed", "{url}");
            assert_eq!(
                error.params["field"], "proxy.url",
                "{url}：{:?}",
                error.params
            );
            assert_eq!(
                error.params["reason"], "not_allowed",
                "{url}：{:?}",
                error.params
            );
            assert!(
                error.params.values().all(|value| !value.contains('@')),
                "{url}：params 不得回显凭据：{:?}",
                error.params
            );
            assert!(!error.to_string().contains('@'), "{url}：{error}");
        }

        // 关着的代理同样不许把凭据存进库。
        settings.proxy = Some(ProxyConfig {
            enabled: false,
            url: Some("http://u:p@proxy.example:8080".to_string()),
        });
        let error = validate_settings(&settings).expect_err("关着的代理也要拒绝凭据");
        assert_eq!(error.params["field"], "proxy.url");
        assert_eq!(error.params["reason"], "not_allowed");

        // 没有 userinfo 的地址照常通过。
        for url in [
            "http://proxy.example:8080",
            "https://proxy.example",
            "socks5://127.0.0.1:1080",
        ] {
            settings.proxy = Some(ProxyConfig {
                enabled: true,
                url: Some(url.to_string()),
            });
            validate_settings(&settings).unwrap_or_else(|error| panic!("{url} 应被接受：{error}"));
        }

        // 协议非法仍然拒绝（既有用例）；回显的是抹掉 userinfo 的形态，不是原串。
        settings.proxy = Some(ProxyConfig {
            enabled: true,
            url: Some("ftp://proxy.example".to_string()),
        });
        let error = validate_settings(&settings).expect_err("ftp 仍拒绝");
        assert_eq!(error.params["reason"], "invalid_format");
        assert_eq!(error.params["value"], "ftp://proxy.example");
    }

    /// 回显形态：`scheme://host[:port]`，userinfo 与路径/查询一律抹掉；
    /// 解析不出来的串**不回显**（少给信息 ≠ 泄漏信息）。
    #[test]
    fn redacted_proxy_url_drops_userinfo_and_everything_after_the_authority() {
        // `2121` 不是 ftp 的默认端口，所以按用户写出来的样子保留。
        assert_eq!(
            redacted_proxy_url("ftp://u:p@proxy.example:2121/path?x=1").as_deref(),
            Some("ftp://proxy.example:2121")
        );
        assert_eq!(
            redacted_proxy_url("ftp://proxy.example").as_deref(),
            Some("ftp://proxy.example")
        );
        assert_eq!(redacted_proxy_url("u:p@proxy.example:8080"), None);
        assert_eq!(redacted_proxy_url(""), None);
    }

    /// 判据不能只依赖 `url::Url`：解析不出来的串（端口写错）同样是凭据可能藏身之处，
    /// 必须有文本兜底；反过来，`@` 只出现在路径/查询里不算内嵌凭据。
    #[test]
    fn credential_rejection_also_covers_unparsable_proxy_urls() {
        let mut settings = AppSettings::default();
        settings.model.provider = "deep_seek".to_string();

        for url in [
            "http://u:p@proxy.example:notaport",
            "socks5://u:p@proxy.example:notaport",
        ] {
            settings.proxy = Some(ProxyConfig {
                enabled: true,
                url: Some(url.to_string()),
            });
            let error = match validate_settings(&settings) {
                Ok(()) => panic!("{url} 解析不出来也必须拒绝凭据"),
                Err(error) => error,
            };
            assert_eq!(
                error.params["field"], "proxy.url",
                "{url}：{:?}",
                error.params
            );
            assert_eq!(
                error.params["reason"], "not_allowed",
                "{url}：{:?}",
                error.params
            );
        }

        settings.proxy = Some(ProxyConfig {
            enabled: true,
            url: Some("http://proxy.example:8080/path?redirect=a@b".to_string()),
        });
        validate_settings(&settings).expect("路径里的 @ 不是凭据");
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

    /// 搜索专用 provider 只走密钥命令；模型设置 / 连通性测试仍只认 `LlmProvider`。
    #[test]
    fn metaso_is_a_secret_provider_but_not_a_model_provider() {
        assert_eq!(parse_secret_provider("metaso").unwrap(), "metaso");
        assert_eq!(parse_secret_provider("  Metaso  ").unwrap(), "metaso");
        assert_eq!(parse_secret_provider("deepseek").unwrap(), "deep_seek");

        // GSC OAuth 的两个钥匙串位：可读可写 secret_*，但绝不是模型厂商。
        assert_eq!(
            parse_secret_provider("google_oauth").unwrap(),
            "google_oauth"
        );
        assert_eq!(parse_secret_provider(" gsc ").unwrap(), "gsc");
        assert_eq!(
            parse_secret_provider(" Bing_OAuth ").unwrap(),
            "bing_oauth",
            "Bing 客户端密钥只占钥匙串位，不是模型厂商"
        );
        assert_eq!(
            parse_secret_provider(" Bing_WMT ").unwrap(),
            "bing_wmt",
            "Bing API Key 只占钥匙串位，不是模型厂商"
        );
        for provider in ["google_oauth", "gsc", "bing_oauth", "bing_wmt"] {
            let error = parse_llm_provider(provider).expect_err("OAuth 钥匙串位不是模型厂商");
            assert_eq!(error.code, "llm/config");
            assert_eq!(error.params["reason"], "unknown_provider");
        }

        let error = parse_llm_provider("metaso").expect_err("metaso 不是模型厂商");
        assert_eq!(error.code, "llm/config");
        assert_eq!(error.params["reason"], "unknown_provider");
        assert_eq!(error.params["value"], "metaso");

        let error = parse_secret_provider("nope").expect_err("认不出的密钥 provider");
        assert_eq!(error.code, "llm/config");
        assert_eq!(error.params["reason"], "unknown_provider");
    }

    /// 两个新校验的正向边界：`anthropic` 可存、绝对路径可存。
    #[test]
    fn protocol_and_export_dir_accept_the_documented_values() {
        let mut settings = AppSettings::default();
        settings.model.provider = "deep_seek".to_string();
        settings.model.protocol = "anthropic".to_string();
        settings.storage.last_export_dir = Some("/Users/me/Desktop/exports".to_string());
        validate_settings(&settings).expect("anthropic + 绝对路径合法");
    }

    /// 裁定 §G-7：`unknown_provider` 的 `value` 是**用户填的那个非法串**，
    /// 合法取值列表不再进错误（前端能从 `llm_providers` 拿到，属文案不属参数）。
    /// 原用例 `unknown_provider_error_lists_the_valid_values` 钉的正是被驳回的旧口径。
    #[test]
    fn unknown_provider_error_carries_the_offending_value() {
        let error = parse_llm_provider("openai").expect_err("不在预设里");
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
                name: "模型协议不支持",
                break_it: |settings| settings.model.protocol = "gemini".to_string(),
                field: "model.protocol",
                reason: "not_allowed",
                extra: &[("value", "gemini")],
            },
            Case {
                name: "导出目录不是绝对路径",
                break_it: |settings| {
                    settings.storage.last_export_dir = Some("relative/exports".to_string())
                },
                field: "storage.last_export_dir",
                reason: "invalid_format",
                extra: &[("value", "relative/exports")],
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
            Case {
                // P2-08：凭据既不许落库，也不许经 params 回显——`extra` 为空即钉死
                // 「只发 field + reason，不发 value」。
                name: "代理地址内嵌账号密码",
                break_it: |settings| {
                    settings.proxy = Some(ProxyConfig {
                        enabled: true,
                        url: Some("http://u:p@proxy.example:8080".to_string()),
                    })
                },
                field: "proxy.url",
                reason: "not_allowed",
                extra: &[],
            },
            Case {
                name: "代理协议不支持且内嵌账号密码",
                break_it: |settings| {
                    settings.proxy = Some(ProxyConfig {
                        enabled: true,
                        url: Some("ftp://u:p@proxy.example".to_string()),
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

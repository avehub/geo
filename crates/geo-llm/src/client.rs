//! OpenAI 兼容聊天客户端：请求构造、指数退避重试与用量记账。
//!
//! 只依赖 `Transport` trait，因此测试既可以用 `wiremock` 打真实 HTTP，
//! 也可以用 `FixtureTransport` 离线回放。重试策略（spec FR-L3）：
//! 仅对 429 / 5xx / 网络与超时错误重试，其余 4xx 立即失败。

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{library_reason, LlmError, REASON_MISSING_CHOICES, REASON_PARSE_FAILED};
use crate::provider::LlmConfig;
use crate::transport::{HttpRequest, HttpResponse, Transport, TransportError};

pub use crate::provider::Usage;

/// 日志中响应体的截断长度（字符），避免把完整回答写进日志。
const LOG_BODY_CHARS: usize = 200;

/// 对话角色。序列化值即 OpenAI 兼容协议的取值。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatRole {
    System,
    User,
    Assistant,
}

impl ChatRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

/// 一条对话消息。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self::new(ChatRole::System, content)
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self::new(ChatRole::User, content)
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self::new(ChatRole::Assistant, content)
    }

    fn new(role: ChatRole, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
        }
    }
}

/// 一次聊天请求。`temperature` 为 `None` 时回落到 `LlmConfig::temperature`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    /// 要求模型输出 JSON（协议里的 `response_format`）。
    #[serde(default)]
    pub response_format_json: bool,
    pub temperature: Option<f32>,
    /// Provider 专用参数（如 Qwen 的 `enable_search` / `search_options`）。
    /// 不进 OpenAI 标准字段，构造请求体时合并到顶层。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_body: Option<serde_json::Map<String, serde_json::Value>>,
}

impl ChatRequest {
    pub fn new(messages: Vec<ChatMessage>) -> Self {
        Self {
            messages,
            response_format_json: false,
            temperature: None,
            extra_body: None,
        }
    }

    /// 要求结构化输出。
    pub fn json(mut self) -> Self {
        self.response_format_json = true;
        self
    }

    pub fn with_temperature(mut self, temperature: f32) -> Self {
        self.temperature = Some(temperature);
        self
    }

    /// 追加一个 Provider 专用顶层参数。重复 key 覆盖旧值。
    pub fn with_extra(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        let extra = self.extra_body.get_or_insert_with(serde_json::Map::new);
        extra.insert(key.into(), value);
        self
    }

    /// 追加一条消息：`chat_json` 修复重试时用它带上「上次错在哪」。
    pub fn with_message(mut self, message: ChatMessage) -> Self {
        self.messages.push(message);
        self
    }
}

/// 模型回答与本次调用的用量。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    pub usage: Usage,
    pub model: String,
    pub finish_reason: Option<String>,
    /// 搜索型模型（Qwen `search_info.search_results` 等）返回的引用。
    #[serde(default)]
    pub citations: Vec<crate::search::SearchHit>,
}

/// OpenAI 兼容客户端。API Key 只在构造时传入，绝不写日志、不落库。
pub struct LlmClient {
    config: LlmConfig,
    transport: Arc<dyn Transport>,
    api_key: String,
}

/// 手工实现 `Debug`：API Key 一律打码（AGENTS.md 硬性规则 3）。
impl fmt::Debug for LlmClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LlmClient")
            .field("config", &self.config)
            .field("api_key", &"<redacted>")
            .finish_non_exhaustive()
    }
}

/// 单次尝试的归类结果。`Retry` 同时携带「重试耗尽时该抛出的错误」。
enum Attempt {
    Success(HttpResponse),
    Retry(LlmError),
    Fatal(LlmError),
}

impl LlmClient {
    pub fn new(
        config: LlmConfig,
        api_key: impl Into<String>,
        transport: Arc<dyn Transport>,
    ) -> Self {
        Self {
            config,
            transport,
            api_key: api_key.into(),
        }
    }

    pub fn config(&self) -> &LlmConfig {
        &self.config
    }

    /// 发起一次聊天补全，内部按指数退避重试。
    pub async fn chat(&self, req: &ChatRequest) -> Result<ChatResponse, LlmError> {
        let request =
            HttpRequest::bearer_json(self.request_url()?, &self.api_key, self.build_body(req)?);

        let mut attempt: u32 = 0;
        loop {
            match classify(self.transport.send(request.clone()).await) {
                Attempt::Success(response) => {
                    let parsed = parse_chat_response(&response)?;
                    tracing::debug!(
                        model = %parsed.model,
                        prompt_tokens = parsed.usage.prompt_tokens,
                        completion_tokens = parsed.usage.completion_tokens,
                        attempts = attempt + 1,
                        content = %preview(&parsed.content, LOG_BODY_CHARS),
                        "LLM 调用成功"
                    );
                    return Ok(parsed);
                }
                Attempt::Fatal(error) => return Err(error),
                Attempt::Retry(error) => {
                    if attempt >= self.config.max_retries {
                        tracing::warn!(
                            attempts = attempt + 1,
                            reason = %error.user_message(),
                            "LLM 重试次数已用尽"
                        );
                        return Err(error);
                    }
                    let backoff = self.config.backoff_ms(attempt);
                    tracing::warn!(
                        attempt = attempt + 1,
                        max_retries = self.config.max_retries,
                        backoff_ms = backoff,
                        reason = %error.user_message(),
                        "LLM 调用失败，退避后重试"
                    );
                    tokio::time::sleep(Duration::from_millis(backoff)).await;
                    attempt += 1;
                }
            }
        }
    }

    /// 同 `chat`，并按 Provider 预设单价折算本次调用的人民币成本（成本看板用）。
    pub async fn chat_with_cost(&self, req: &ChatRequest) -> Result<(ChatResponse, f64), LlmError> {
        let response = self.chat(req).await?;
        let cost = self.config.provider.pricing().cost_cny(&response.usage);
        Ok((response, cost))
    }

    /// 请求地址与前置配置校验：配置不全时直接报错，不发出必然失败的请求。
    fn request_url(&self) -> Result<String, LlmError> {
        let url = self.config.chat_completions_url();
        if url.is_empty() {
            // `value` 装 `Provider::as_str()` 的稳定 id：`label_zh()` 是中文，
            // 进 params 就等于把散文直送前端（en locale 下露馅）
            return Err(LlmError::config("missing_base_url")
                .with_param("value", self.config.provider.as_str()));
        }
        if self.config.model.trim().is_empty() {
            return Err(LlmError::config("missing_model")
                .with_param("value", self.config.provider.as_str()));
        }
        if self.api_key.trim().is_empty() {
            return Err(LlmError::MissingSecret);
        }
        Ok(url)
    }

    /// 组装 OpenAI 兼容请求体；只有要求结构化输出时才带 `response_format`。
    fn build_body(&self, req: &ChatRequest) -> Result<String, LlmError> {
        let payload = WireChatRequest {
            model: self.config.model.as_str(),
            messages: req.messages.as_slice(),
            temperature: req.temperature.unwrap_or(self.config.temperature),
            response_format: req.response_format_json.then_some(WireResponseFormat {
                kind: "json_object",
            }),
        };
        // 先按 Wire 结构序列化再解析成 Value：这样 f32 的 0.3 仍是最短表示，
        // 不会被 `to_value` 的 f64 提升成 0.30000001192092896。
        let wire = serde_json::to_string(&payload)
            .map_err(|err| LlmError::config("parse_failed").with_param("value", err))?;
        let mut body: serde_json::Value = serde_json::from_str(&wire)
            .map_err(|err| LlmError::config("parse_failed").with_param("value", err))?;
        if let Some(extra) = &req.extra_body {
            if let serde_json::Value::Object(map) = &mut body {
                for (key, value) in extra {
                    map.insert(key.clone(), value.clone());
                }
            }
        }
        // 请求体序列化失败属目录里的 `parse_failed`（序列化器库返回的 Error），
        // `value` 装 serde 原文
        serde_json::to_string(&body)
            .map_err(|err| LlmError::config("parse_failed").with_param("value", err))
    }
}

#[derive(Serialize)]
struct WireChatRequest<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<WireResponseFormat>,
}

#[derive(Serialize)]
struct WireResponseFormat {
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Debug, Deserialize)]
struct WireChatResponse {
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    choices: Vec<WireChoice>,
    #[serde(default)]
    usage: Option<WireUsage>,
    #[serde(default)]
    search_info: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct WireChoice {
    #[serde(default)]
    message: Option<WireMessage>,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WireMessage {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WireUsage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
    #[serde(default)]
    total_tokens: u32,
}

/// 归类一次尝试：区分「成功 / 可重试 / 立即失败」。
fn classify(result: Result<HttpResponse, TransportError>) -> Attempt {
    let response = match result {
        Err(err @ (TransportError::Network(_) | TransportError::Timeout)) => {
            tracing::warn!(reason = %err, "LLM 传输失败，可重试");
            return Attempt::Retry(err.into());
        }
        Err(err) => return Attempt::Fatal(err.into()),
        Ok(response) => response,
    };
    if response.is_success() {
        return Attempt::Success(response);
    }
    tracing::warn!(
        status = response.status,
        body = %preview(&response.body, LOG_BODY_CHARS),
        "LLM 返回错误状态"
    );
    match response.status {
        429 => Attempt::Retry(LlmError::RateLimited),
        500..=599 => Attempt::Retry(LlmError::Server {
            status: response.status,
        }),
        status => Attempt::Fatal(LlmError::Server { status }),
    }
}

/// 解析 OpenAI 兼容响应；结构不符一律归为 `BadResponse`（重试也不会变好）。
fn parse_chat_response(response: &HttpResponse) -> Result<ChatResponse, LlmError> {
    // `reason` 是目录里的稳定 key，serde 原文降级进 `value`（已限长）：
    // 改造前这两句都是一整段中文散文当 reason，en-US 下就是中文泄漏（裁定 R-C1）
    let wire: WireChatResponse = serde_json::from_str(&response.body).map_err(|err| {
        LlmError::bad_response(REASON_PARSE_FAILED).with_param("value", library_reason(&err))
    })?;
    let choice = wire
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| LlmError::bad_response(REASON_MISSING_CHOICES))?;
    Ok(ChatResponse {
        content: choice
            .message
            .and_then(|message| message.content)
            .unwrap_or_default(),
        usage: wire.usage.map(Usage::from).unwrap_or_default(),
        model: wire.model.unwrap_or_default(),
        finish_reason: choice.finish_reason,
        citations: wire
            .search_info
            .as_ref()
            .map(crate::search::hits_from_search_info)
            .unwrap_or_default(),
    })
}

impl From<WireUsage> for Usage {
    fn from(wire: WireUsage) -> Self {
        Self {
            prompt_tokens: wire.prompt_tokens,
            completion_tokens: wire.completion_tokens,
            total_tokens: wire.total_tokens,
        }
    }
}

/// 按字符截断文本用于日志，超出部分以省略号结尾。
fn preview(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut preview: String = text.chars().take(limit).collect();
    preview.push('…');
    preview
}

#[cfg(test)]
mod tests;

//! OpenAI 兼容 LLM 客户端：Provider 预设与计价、传输层抽象、重试与用量记账、
//! 结构化输出抽取。
//!
//! 分层约束（见 AGENTS.md）：本 crate 只依赖 `geo-domain`，不碰数据库与钥匙串；
//! API Key 由桌面壳从 `SecretStore` 取出后在构造 `LlmClient` 时注入，
//! 本 crate 只负责「不把它写进日志与错误信息」。
//!
//! 测试策略：一律离线。要么 `wiremock` 起本地服务配 `ReqwestTransport`，
//! 要么 `FixtureTransport` 回放 `fixtures/llm/` 的录制响应。
//!
//! ```no_run
//! use std::sync::Arc;
//!
//! use geo_llm::{
//!     chat_json, ChatMessage, ChatRequest, LlmClient, LlmConfig, LlmProvider, ReqwestTransport,
//! };
//!
//! # async fn demo() -> Result<(), geo_llm::LlmError> {
//! let config = LlmConfig::for_provider(LlmProvider::DeepSeek, "keyring://llm/deepseek");
//! let transport = Arc::new(
//!     ReqwestTransport::new(
//!         std::time::Duration::from_secs(config.timeout_secs),
//!         None,
//!     )
//!     .expect("构造传输层"),
//! );
//! let client = LlmClient::new(config, "sk-...", transport);
//! let request = ChatRequest::new(vec![ChatMessage::user("介绍一下宏宇泵业")]);
//! let (response, cost_cny) = client.chat_with_cost(&request).await?;
//! println!("{} 元：{}", cost_cny, response.content);
//! # Ok(())
//! # }
//! ```

pub mod client;
pub mod error;
pub mod json;
pub mod provider;
pub mod transport;

pub use client::{ChatMessage, ChatRequest, ChatResponse, ChatRole, LlmClient, Usage};
pub use error::LlmError;
pub use json::{chat_json, extract_json};
pub use provider::{LlmConfig, LlmProvider, Pricing};
pub use transport::{
    fixture_key, FixtureTransport, HttpRequest, HttpResponse, ReqwestTransport, Transport,
    TransportError,
};

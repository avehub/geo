//! LLM 层错误与稳定错误码。
//!
//! 约定（见 AGENTS.md）：所有面向用户的文案为中文，错误码稳定不变；
//! API Key 与完整回答正文都不得出现在错误信息里。

use geo_domain::GeoError;

use crate::transport::TransportError;

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("模型配置错误：{0}")]
    Config(String),
    #[error("模型请求失败：{0}")]
    Transport(#[from] TransportError),
    #[error("请求过于频繁，请稍后重试")]
    RateLimited,
    #[error("模型服务异常：HTTP {status}")]
    Server { status: u16 },
    #[error("模型返回内容不可用：{0}")]
    BadResponse(String),
    #[error("模型返回结构不符合预期：{0}")]
    Deserialize(String),
    #[error("未配置 API Key，请先在「设置 → 模型」里填写")]
    MissingSecret,
}

impl LlmError {
    /// 稳定错误码，前端据此决定文案与是否可重试。
    pub fn code(&self) -> &'static str {
        match self {
            Self::Config(_) => "llm/config",
            Self::Transport(_) => "llm/transport",
            Self::RateLimited => "llm/rate_limited",
            Self::Server { .. } => "llm/server",
            Self::BadResponse(_) => "llm/bad_response",
            Self::Deserialize(_) => "llm/deserialize",
            Self::MissingSecret => "llm/missing_secret",
        }
    }

    /// 面向用户的中文原因（不含 API Key 与完整回答正文）。
    pub fn user_message(&self) -> String {
        self.to_string()
    }
}

/// 跨 crate 边界统一收敛为 `GeoError::Upstream`，错误码保留 `llm/*` 前缀。
impl From<LlmError> for GeoError {
    fn from(err: LlmError) -> Self {
        GeoError::upstream(err.code(), err.user_message())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cases() -> Vec<(LlmError, &'static str)> {
        vec![
            (LlmError::Config("base_url 为空".into()), "llm/config"),
            (
                LlmError::Transport(TransportError::Timeout),
                "llm/transport",
            ),
            (LlmError::RateLimited, "llm/rate_limited"),
            (LlmError::Server { status: 500 }, "llm/server"),
            (LlmError::BadResponse("空内容".into()), "llm/bad_response"),
            (LlmError::Deserialize("缺字段".into()), "llm/deserialize"),
            (LlmError::MissingSecret, "llm/missing_secret"),
        ]
    }

    #[test]
    fn every_variant_has_a_stable_code() {
        for (error, code) in cases() {
            assert_eq!(error.code(), code, "{error:?} 的错误码不符");
        }
    }

    #[test]
    fn user_message_is_chinese_and_never_empty() {
        for (error, _) in cases() {
            let message = error.user_message();
            assert!(!message.is_empty());
            assert_eq!(message, error.to_string());
            assert!(
                message.chars().any(|ch| ch > '\u{4e00}'),
                "面向用户的文案需为中文：{message}"
            );
        }
    }

    #[test]
    fn server_error_message_carries_status() {
        let error = LlmError::Server { status: 502 };
        assert!(error.user_message().contains("502"));
    }

    #[test]
    fn converts_to_geo_error_as_upstream() {
        let geo = GeoError::from(LlmError::Server { status: 503 });
        assert_eq!(geo.code(), "upstream/llm/server");
        assert!(geo.user_message().contains("503"));

        let geo = GeoError::from(LlmError::MissingSecret);
        assert_eq!(geo.code(), "upstream/llm/missing_secret");
    }
}

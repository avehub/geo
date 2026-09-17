//! IPC 边界的错误契约。
//!
//! 前端只认两样东西：稳定的 `code`（用于分支处理，例如 `llm/missing_secret`
//! 就去引导用户填 Key）与中文 `message`（直接展示）。因此所有 crate 的错误
//! 都在这一层收敛成 [`IpcError`]，不允许把内部错误类型直接抛给 WebView。
//!
//! 这里还是密钥防泄漏的**最后一道关**：即便上游把 API Key 拼进了错误信息，
//! [`redact`] 也会在送出前把它抹成 `***`。

use geo_crawler::CrawlerError;
use geo_domain::GeoError;
use geo_llm::LlmError;
use geo_store::StoreError;
use serde::Serialize;

/// 送回前端的统一错误结构。字段形状即 `apps/desktop/ui/src/api/types.ts` 的契约。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IpcError {
    pub code: String,
    pub message: String,
    pub detail: Option<serde_json::Value>,
}

impl IpcError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: redact(&message.into()),
            detail: None,
        }
    }

    /// 附带结构化上下文。detail 里可能原样夹带上游响应片段，因此同样要脱敏。
    pub fn with_detail(mut self, detail: serde_json::Value) -> Self {
        let mut detail = detail;
        redact_value(&mut detail);
        self.detail = Some(detail);
        self
    }

    /// 不属于任何下游 crate 的壳内错误（配置、路径、序列化等）。
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("ipc/internal", message)
    }
}

impl std::fmt::Display for IpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for IpcError {}

impl From<GeoError> for IpcError {
    fn from(error: GeoError) -> Self {
        Self::new(error.code(), error.user_message())
    }
}

impl From<StoreError> for IpcError {
    fn from(error: StoreError) -> Self {
        Self::new(error.code(), error.to_string())
    }
}

impl From<LlmError> for IpcError {
    fn from(error: LlmError) -> Self {
        Self::new(error.code(), error.user_message())
    }
}

impl From<CrawlerError> for IpcError {
    fn from(error: CrawlerError) -> Self {
        Self::new(error.code(), error.user_message())
    }
}

impl From<geo_llm::TransportError> for IpcError {
    fn from(error: geo_llm::TransportError) -> Self {
        Self::from(LlmError::Transport(error))
    }
}

impl From<sqlx::Error> for IpcError {
    fn from(error: sqlx::Error) -> Self {
        Self::from(StoreError::from(error))
    }
}

impl From<serde_json::Error> for IpcError {
    fn from(error: serde_json::Error) -> Self {
        Self::from(GeoError::from(error))
    }
}

impl From<std::io::Error> for IpcError {
    fn from(error: std::io::Error) -> Self {
        Self::from(GeoError::from(error))
    }
}

/// 递归抹掉 JSON 里所有字符串中的密钥样式片段。
fn redact_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(text) => *text = redact(text),
        serde_json::Value::Array(items) => items.iter_mut().for_each(redact_value),
        serde_json::Value::Object(map) => map.values_mut().for_each(redact_value),
        serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_) => {}
    }
}

/// 抹掉形如 `sk-...` 的密钥样式片段。
///
/// 不用正则：这段代码在错误路径上，越简单越不容易自己出问题。
///
/// **凡是把上游错误文案送去展示、落库或打日志的地方都要过这一道**：
/// `IpcError` 只是最后一关，`LlmTestResult.message`、`prompt_sets.notes`
/// 这些不经过 `IpcError` 的出口同样是泄漏面（AGENTS 规则 3）。
pub(crate) fn redact(message: &str) -> String {
    const PREFIX: &str = "sk-";
    let chars: Vec<char> = message.chars().collect();
    let prefix: Vec<char> = PREFIX.chars().collect();
    let mut output = String::with_capacity(message.len());
    let mut index = 0;

    while index < chars.len() {
        let matches_prefix = chars[index..]
            .iter()
            .zip(prefix.iter())
            .take_while(|(actual, expected)| actual.eq_ignore_ascii_case(expected))
            .count()
            == prefix.len();

        if matches_prefix {
            let end = (index..chars.len())
                .find(|position| !is_token_char(chars[*position]))
                .unwrap_or(chars.len());
            output.push_str("***");
            index = end;
            continue;
        }

        output.push(chars[index]);
        index += 1;
    }

    output
}

fn is_token_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
}

#[cfg(test)]
mod tests {
    use super::*;
    use geo_crawler::CrawlerError;
    use geo_llm::{LlmError, TransportError};
    use geo_store::StoreError;

    #[test]
    fn geo_error_keeps_its_stable_code() {
        let error = IpcError::from(GeoError::not_found("project", "abc-123"));
        assert_eq!(error.code, "project/not_found");
        assert!(error.message.contains("abc-123"));
        assert!(!error.message.is_empty());
    }

    #[test]
    fn validation_error_carries_field_and_reason() {
        let error = IpcError::from(GeoError::validation("brand_name", "不能为空"));
        assert_eq!(error.code, "validation/failed");
        assert!(error.message.contains("brand_name"));
        assert!(error.message.contains("不能为空"));
    }

    #[test]
    fn llm_errors_map_to_llm_prefixed_codes() {
        assert_eq!(
            IpcError::from(LlmError::RateLimited).code,
            "llm/rate_limited"
        );
        assert_eq!(
            IpcError::from(LlmError::MissingSecret).code,
            "llm/missing_secret"
        );
        assert_eq!(
            IpcError::from(LlmError::Server { status: 500 }).code,
            "llm/server"
        );
        assert_eq!(
            IpcError::from(LlmError::Transport(TransportError::Timeout)).code,
            "llm/transport"
        );
    }

    #[test]
    fn store_and_crawler_errors_keep_their_codes() {
        assert_eq!(
            IpcError::from(StoreError::not_found("prompt_set", "x")).code,
            "prompt_set/not_found"
        );
        assert_eq!(
            IpcError::from(CrawlerError::Timeout { url: "u".into() }).code,
            "crawler/timeout"
        );
    }

    #[test]
    fn serialises_to_the_shape_the_frontend_expects() {
        let error = IpcError::from(GeoError::conflict("重复导入"));
        let json = serde_json::to_value(&error).expect("可序列化");
        assert_eq!(json["code"], "state/conflict");
        assert_eq!(json["message"], "操作冲突：重复导入");
        assert!(json["detail"].is_null());
    }

    #[test]
    fn detail_json_is_redacted_too() {
        let error = IpcError::new("llm/bad_response", "调用失败").with_detail(serde_json::json!({
            "echo": "上游返回 Bearer sk-leaked-key",
            "nested": { "list": ["sk-another-token", 3] }
        }));
        let dumped = serde_json::to_string(&error.detail.expect("有 detail")).expect("可序列化");
        assert!(!dumped.contains("sk-leaked-key"), "{dumped}");
        assert!(!dumped.contains("sk-another-token"), "{dumped}");
        assert!(dumped.contains("***"), "{dumped}");
    }

    #[test]
    fn secret_shaped_strings_never_reach_the_frontend() {
        // 上游万一把 Key 拼进错误信息，IPC 这道关必须抹掉
        let leaked = IpcError::from(GeoError::upstream(
            "auth",
            "鉴权失败：sk-abc123XYZ_-9 无效（Bearer sk-second0000）",
        ));
        assert!(!leaked.message.contains("sk-abc123XYZ_-9"));
        assert!(!leaked.message.contains("sk-second0000"));
        assert!(leaked.message.contains("***"));
        assert!(leaked.message.contains("鉴权失败"));
    }

    #[test]
    fn redaction_leaves_ordinary_text_alone() {
        let error = IpcError::from(GeoError::config("base_url 为空，任务已跳过"));
        assert_eq!(error.message, "配置错误：base_url 为空，任务已跳过");
    }

    #[test]
    fn internal_helper_produces_actionable_chinese_message() {
        let error = IpcError::internal("解析导入文件失败");
        assert_eq!(error.code, "ipc/internal");
        assert!(error.message.contains("解析导入文件失败"));
    }
}

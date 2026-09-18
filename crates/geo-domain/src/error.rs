//! 跨层统一错误类型。

use std::fmt;

/// 领域错误。所有 crate 对外暴露的错误最终都转换为该类型，
/// 由桌面壳在 IPC 边界映射为稳定错误码 + 中文可读原因。
#[derive(Debug, thiserror::Error)]
pub enum GeoError {
    /// 输入校验失败，携带字段名与原因。
    #[error("{field} 校验失败：{reason}")]
    Validation { field: String, reason: String },
    /// 资源不存在，`kind` 为资源类别（如 `project`、`prompt_set`）。
    #[error("{kind} 不存在：{id}")]
    NotFound { kind: String, id: String },
    /// 状态冲突（如重复导入、版本冲突）。
    #[error("操作冲突：{reason}")]
    Conflict { reason: String },
    /// 配置缺失或非法。
    #[error("配置错误：{reason}")]
    Config { reason: String },
    /// 上游服务（LLM / 引擎 / 站点）返回的错误。
    #[error("上游服务错误[{code}]：{message}")]
    Upstream { code: String, message: String },
    /// IO 错误。
    #[error("读写错误：{0}")]
    Io(#[from] std::io::Error),
    /// 序列化/反序列化错误。
    #[error("数据格式错误：{0}")]
    Serde(#[from] serde_json::Error),
}

impl GeoError {
    pub fn validation(field: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::Validation {
            field: field.into(),
            reason: reason.into(),
        }
    }

    pub fn not_found(kind: impl Into<String>, id: impl fmt::Display) -> Self {
        Self::NotFound {
            kind: kind.into(),
            id: id.to_string(),
        }
    }

    pub fn conflict(reason: impl Into<String>) -> Self {
        Self::Conflict {
            reason: reason.into(),
        }
    }

    pub fn config(reason: impl Into<String>) -> Self {
        Self::Config {
            reason: reason.into(),
        }
    }

    pub fn upstream(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Upstream {
            code: code.into(),
            message: message.into(),
        }
    }

    /// 稳定错误码，供前端分支处理。`NotFound` 会带上资源类别前缀，
    /// 例如 `project/not_found`。
    pub fn code(&self) -> String {
        match self {
            Self::Validation { .. } => "validation/failed".to_string(),
            Self::NotFound { kind, .. } => format!("{kind}/not_found"),
            Self::Conflict { .. } => "state/conflict".to_string(),
            Self::Config { .. } => "config/invalid".to_string(),
            Self::Upstream { code, .. } => format!("upstream/{code}"),
            Self::Io(_) => "io/failed".to_string(),
            Self::Serde(_) => "data/invalid".to_string(),
        }
    }

    /// 面向用户的中文原因。
    pub fn user_message(&self) -> String {
        self.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_error_contains_field_and_reason() {
        let err = GeoError::validation("brand_name", "不能为空");
        assert_eq!(err.code(), "validation/failed");
        assert!(err.user_message().contains("brand_name"));
        assert!(err.user_message().contains("不能为空"));
    }

    #[test]
    fn not_found_code_is_prefixed_with_kind() {
        let err = GeoError::not_found("project", "abc-123");
        assert_eq!(err.code(), "project/not_found");
        assert!(err.user_message().contains("abc-123"));
    }

    #[test]
    fn upstream_code_is_namespaced() {
        let err = GeoError::upstream("rate_limited", "请求过于频繁");
        assert_eq!(err.code(), "upstream/rate_limited");
    }
}

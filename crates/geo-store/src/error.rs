//! `geo-store` 的 crate 级错误，以及与 `geo_domain::GeoError` 的双向转换。
//!
//! 转换保持 `code()` 语义：`NotFound` → `{kind}/not_found`、`Validation` → `validation/failed`、
//! `Conflict` → `state/conflict`、`Serde` → `data/invalid`、`Io` → `io/failed`、
//! `Secret` ↔ `Config` → `config/invalid`。数据库层错误归入 `io/failed`，
//! 唯一约束冲突归入 `state/conflict`。

use std::io;

use geo_domain::GeoError;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// 资源不存在，`kind` 为资源类别（如 `project`、`prompt_set`）。
    #[error("{kind} 不存在：{id}")]
    NotFound { kind: String, id: String },
    /// 输入或行数据校验失败。
    #[error("{field} 校验失败：{reason}")]
    Validation { field: String, reason: String },
    /// 状态冲突（唯一约束、并发写冲突等）。
    #[error("操作冲突：{0}")]
    Conflict(String),
    /// 数据库驱动/迁移错误。
    #[error("数据库错误：{0}")]
    Sqlx(#[from] sqlx::Error),
    /// JSON 列解析失败。
    #[error("数据格式错误：{0}")]
    Serde(#[from] serde_json::Error),
    /// 系统钥匙串读写失败。**错误信息中不得包含密钥值**。
    #[error("密钥存取错误：{0}")]
    Secret(String),
    /// 文件系统错误。
    #[error("读写错误：{0}")]
    Io(#[from] io::Error),
}

impl StoreError {
    pub fn not_found(kind: impl Into<String>, id: impl std::fmt::Display) -> Self {
        Self::NotFound {
            kind: kind.into(),
            id: id.to_string(),
        }
    }

    pub fn validation(field: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::Validation {
            field: field.into(),
            reason: reason.into(),
        }
    }

    pub fn conflict(reason: impl Into<String>) -> Self {
        Self::Conflict(reason.into())
    }

    pub fn secret(reason: impl Into<String>) -> Self {
        Self::Secret(reason.into())
    }

    /// 稳定错误码，与 `GeoError::code()` 对齐（见 `code_matches_geo_error` 测试）。
    pub fn code(&self) -> String {
        match self {
            Self::NotFound { kind, .. } => format!("{kind}/not_found"),
            Self::Validation { .. } => "validation/failed".to_string(),
            Self::Conflict(_) => "state/conflict".to_string(),
            Self::Sqlx(sqlx_error) => {
                if is_unique_violation(sqlx_error) {
                    "state/conflict".to_string()
                } else {
                    "io/failed".to_string()
                }
            }
            Self::Serde(_) => "data/invalid".to_string(),
            Self::Secret(_) => "config/invalid".to_string(),
            Self::Io(_) => "io/failed".to_string(),
        }
    }
}

/// SQLite 唯一约束/主键冲突错误码（`SQLITE_CONSTRAINT_UNIQUE` / `_PRIMARYKEY` / 通用 `_CONSTRAINT`）。
const SQLITE_CONSTRAINT_UNIQUE: &str = "2067";
const SQLITE_CONSTRAINT_PRIMARYKEY: &str = "1555";
const SQLITE_CONSTRAINT: &str = "19";

fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|db| db.code())
        .is_some_and(|code| {
            matches!(
                code.as_ref(),
                SQLITE_CONSTRAINT_UNIQUE | SQLITE_CONSTRAINT_PRIMARYKEY | SQLITE_CONSTRAINT
            )
        })
}

impl From<StoreError> for GeoError {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::NotFound { kind, id } => GeoError::NotFound { kind, id },
            StoreError::Validation { field, reason } => GeoError::Validation { field, reason },
            StoreError::Conflict(reason) => GeoError::Conflict { reason },
            StoreError::Sqlx(sqlx_error) => {
                if is_unique_violation(&sqlx_error) {
                    GeoError::conflict(sqlx_error.to_string())
                } else {
                    GeoError::Io(io::Error::other(sqlx_error.to_string()))
                }
            }
            StoreError::Serde(serde_error) => GeoError::Serde(serde_error),
            StoreError::Secret(reason) => GeoError::config(reason),
            StoreError::Io(io_error) => GeoError::Io(io_error),
        }
    }
}

impl From<GeoError> for StoreError {
    fn from(error: GeoError) -> Self {
        match error {
            GeoError::NotFound { kind, id } => StoreError::NotFound { kind, id },
            GeoError::Validation { field, reason } => StoreError::Validation { field, reason },
            GeoError::Conflict { reason } => StoreError::Conflict(reason),
            // `config/invalid` 在存储层主要来自密钥不可用，映射回 `Secret` 以保持 code 语义。
            GeoError::Config { reason } => StoreError::Secret(reason),
            // 存储层不会产生上游错误；仅为反向转换完整性保留，降级为冲突。
            GeoError::Upstream { code, message } => {
                StoreError::Conflict(format!("upstream/{code}：{message}"))
            }
            GeoError::Io(io_error) => StoreError::Io(io_error),
            GeoError::Serde(serde_error) => StoreError::Serde(serde_error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn not_found_code_is_prefixed_with_kind() {
        let error = StoreError::not_found("project", "abc-123");
        assert_eq!(error.code(), "project/not_found");
        assert!(error.to_string().contains("abc-123"));
    }

    #[test]
    fn validation_message_contains_field_and_reason() {
        let error = StoreError::validation("competitor_ids", "不属于该项目");
        assert_eq!(error.code(), "validation/failed");
        assert!(error.to_string().contains("competitor_ids"));
        assert!(error.to_string().contains("不属于该项目"));
    }

    #[test]
    fn store_error_converts_to_geo_error_keeping_code() {
        let cases: Vec<StoreError> = vec![
            StoreError::not_found("prompt_set", "id-1"),
            StoreError::validation("text", "不能为空"),
            StoreError::conflict("版本冲突"),
            StoreError::Serde(serde_json::from_str::<u8>("nope").unwrap_err()),
            StoreError::secret("钥匙串不可用"),
            StoreError::Io(io::Error::other("磁盘满")),
            StoreError::Sqlx(sqlx::Error::RowNotFound),
        ];
        for error in cases {
            let expected = error.code();
            let geo = GeoError::from(error);
            assert_eq!(geo.code(), expected, "code 语义必须保持一致");
            assert!(!geo.user_message().is_empty());
        }
    }

    #[test]
    fn geo_error_converts_back_keeping_code() {
        let cases = vec![
            GeoError::not_found("project", "id-1"),
            GeoError::validation("brand_name", "不能为空"),
            GeoError::conflict("重复导入"),
            GeoError::config("缺少 API Key"),
            GeoError::Io(io::Error::other("磁盘满")),
        ];
        for geo in cases {
            let expected = geo.code();
            let store = StoreError::from(geo);
            assert_eq!(store.code(), expected);
        }
    }

    #[test]
    fn secret_error_message_never_carries_value() {
        // 约定：只描述原因，不拼接密钥内容。
        let error = StoreError::secret("钥匙串无该条目");
        assert!(!error.to_string().contains("sk-"));
    }
}

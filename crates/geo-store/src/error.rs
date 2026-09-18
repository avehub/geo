//! `geo-store` 的 crate 级错误，以及与 `geo_domain::GeoError` 的双向转换。
//!
//! 转换保持 `code()` 语义：`NotFound` → `{kind}/not_found`、`Validation` → `validation/failed`、
//! `Conflict` → `state/conflict`、`Serde` → `data/invalid`、`Io` → `io/failed`、
//! `Secret` ↔ `Config` → `config/invalid`。数据库层错误归入 `io/failed`，
//! 唯一约束冲突归入 `state/conflict`（`reason` 是稳定 key `duplicate`，驱动原文落 `value`）。
//!
//! `Display` 是**日志格式**（`"{code} {k}={v} …"`），与 `GeoError::Display`、壳里
//! `IpcError::with_params` 的兜底文案逐字同构，不是给人读的句子。
//!
//! **反向转换（`From<GeoError> for StoreError`）只为 code 守恒**：全仓库唯一的调用点是
//! 本文件测试模块里的往返用例，生产代码从不反向转换。因此 `Config` 分支一律映射回
//! `Secret`——非 `secret_unavailable` 的 config reason 经反向转换会被改写成
//! `secret_unavailable`，原 reason 仍在 `value` 里，不丢信息。

use std::collections::BTreeMap;
use std::fmt;
use std::io;

use geo_domain::GeoError;

/// 存储层错误。`Validation` / `Conflict` 的 `reason` 取 reason key 目录里的 key
/// （目录是 `crates/geo-domain/src/error.rs` 模块注释里那张表）。
#[derive(Debug)]
pub enum StoreError {
    /// 资源不存在，`kind` 为资源类别（如 `project`、`prompt_set`）。
    NotFound { kind: String, id: String },
    /// 输入或行数据校验失败：`extra` 是该 reason key 的配套参数
    /// （`limit` / `expected` / `value`），与 `GeoError::Validation` 同形。
    Validation {
        field: String,
        reason: String,
        extra: BTreeMap<String, String>,
    },
    /// 状态冲突（唯一约束、并发写冲突、CSV 写失败等）。
    Conflict {
        reason: String,
        extra: BTreeMap<String, String>,
    },
    /// 数据库驱动/迁移错误。
    Sqlx(sqlx::Error),
    /// JSON 列解析失败。
    Serde(serde_json::Error),
    /// 系统钥匙串读写失败。那个 `String` 是已 `redact` 的底层原文（**不得包含密钥值**）：
    /// `params()` 把它装进 `value`，`reason` 恒为 [`REASON_SECRET_UNAVAILABLE`]。
    Secret(String),
    /// 文件系统错误。
    Io(io::Error),
}

/// `config/invalid` 在存储层的固定 reason：钥匙串不可用。
///
/// `secret.rs` 已把 `keyring::Error::NoEntry` 在 `get` / `delete` 里当 `Ok(None)` /
/// `Ok(())` 吞掉（没存过不是错误），因此不存在「条目找不到」这种情形，只有这一个 key。
const REASON_SECRET_UNAVAILABLE: &str = "secret_unavailable";

/// 命中 SQLite 唯一约束/主键冲突时的 reason：目录里的稳定 key `duplicate`。
const REASON_DUPLICATE: &str = "duplicate";

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
            extra: BTreeMap::new(),
        }
    }

    pub fn conflict(reason: impl Into<String>) -> Self {
        Self::Conflict {
            reason: reason.into(),
            extra: BTreeMap::new(),
        }
    }

    pub fn secret(reason: impl Into<String>) -> Self {
        Self::Secret(reason.into())
    }

    /// 链式追加一个语言中立参数，落进 `Validation` / `Conflict` 的 `extra`。
    ///
    /// 与 `GeoError::with_param` 同语义（含 Task 3 的 M-1 守卫）：撞基础键或变体没有
    /// `extra` 都在 debug 构建里 `debug_assert!` 炸出来，因为两类误用都是**静默**的。
    pub fn with_param(self, key: &str, value: impl fmt::Display) -> Self {
        let value = value.to_string();
        match self {
            Self::Validation {
                field,
                reason,
                mut extra,
            } => {
                debug_assert!(
                    !matches!(key, "field" | "reason"),
                    "validation/failed 的基础键 field / reason 由变体字段提供，不能被 extra 覆盖（收到 {key}）"
                );
                extra.insert(key.to_string(), value);
                Self::Validation {
                    field,
                    reason,
                    extra,
                }
            }
            Self::Conflict { reason, mut extra } => {
                debug_assert!(
                    key != "reason",
                    "state/conflict 的基础键 reason 由变体字段提供，不能被 extra 覆盖（收到 {key}）"
                );
                extra.insert(key.to_string(), value);
                Self::Conflict { reason, extra }
            }
            other @ (Self::NotFound { .. }
            | Self::Sqlx(_)
            | Self::Serde(_)
            | Self::Secret(_)
            | Self::Io(_)) => {
                // panic 信息里只打 `code()`：`Debug` 输出**不经 `redact`**，
                // `Secret` / `Sqlx` 可能夹带疑似 Key 的片段（AGENTS 规则 3）。
                debug_assert!(
                    false,
                    "{} 的键集是固定的，参数 {key} 会被丢弃",
                    other.code()
                );
                other
            }
        }
    }

    /// 稳定错误码，与 `GeoError::code()` 对齐（见 `code_matches_geo_error` 测试）。
    pub fn code(&self) -> String {
        match self {
            Self::NotFound { kind, .. } => format!("{kind}/not_found"),
            Self::Validation { .. } => "validation/failed".to_string(),
            Self::Conflict { .. } => "state/conflict".to_string(),
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

    /// 语言中立参数，键名由 `contracts/error-codes.json` 冻结：
    /// `NotFound` → `{kind, id}`、`Validation` → `{field, reason} ∪ extra`、
    /// `Conflict` → `{reason} ∪ extra`、`Secret` → `{reason: secret_unavailable, value}`、
    /// `Sqlx` → 唯一约束时 `{reason: duplicate, value}`、否则 `{reason}`（驱动原文）、
    /// `Serde` / `Io` → `{reason}`（原文透传）。
    ///
    /// 这是 `code` 之外唯一的真值源：`Display`、`From<StoreError> for GeoError` 与壳里的
    /// `From<StoreError> for IpcError` 都复用它，不再各拼一份。
    pub fn params(&self) -> BTreeMap<String, String> {
        let mut params = BTreeMap::new();
        match self {
            Self::NotFound { kind, id } => {
                params.insert("kind".to_string(), kind.clone());
                params.insert("id".to_string(), id.clone());
            }
            Self::Validation {
                field,
                reason,
                extra,
            } => {
                params.insert("field".to_string(), field.clone());
                params.insert("reason".to_string(), reason.clone());
                params.extend(
                    extra
                        .iter()
                        .map(|(key, value)| (key.clone(), value.clone())),
                );
            }
            Self::Conflict { reason, extra } => {
                params.insert("reason".to_string(), reason.clone());
                params.extend(
                    extra
                        .iter()
                        .map(|(key, value)| (key.clone(), value.clone())),
                );
            }
            Self::Sqlx(sqlx_error) => {
                if is_unique_violation(sqlx_error) {
                    params.insert("reason".to_string(), REASON_DUPLICATE.to_string());
                    params.insert("value".to_string(), sqlx_error.to_string());
                } else {
                    params.insert("reason".to_string(), sqlx_error.to_string());
                }
            }
            Self::Serde(serde_error) => {
                params.insert("reason".to_string(), serde_error.to_string());
            }
            Self::Secret(reason) => {
                params.insert("reason".to_string(), REASON_SECRET_UNAVAILABLE.to_string());
                params.insert("value".to_string(), reason.clone());
            }
            Self::Io(io_error) => {
                params.insert("reason".to_string(), io_error.to_string());
            }
        }
        params
    }
}

/// 紧凑日志格式：`"{code} {k}={v} …"`，键序按 `BTreeMap`（字典序）。
///
/// 手写而不用派生宏的 `#[error("…")]` 模板：`code()` 对 `NotFound` 要动态拼前缀、
/// 对 `Sqlx` 要按唯一约束判定分岔，模板里都表达不了，而 `params()` 必须保持单一真值源。
impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.code())?;
        for (key, value) in self.params() {
            write!(f, " {key}={value}")?;
        }
        Ok(())
    }
}

impl std::error::Error for StoreError {}

/// 原 `#[from]` 语义：驱动 / 序列化 / 文件系统的错误用 `?` 直接上抛。
impl From<sqlx::Error> for StoreError {
    fn from(error: sqlx::Error) -> Self {
        Self::Sqlx(error)
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(error: serde_json::Error) -> Self {
        Self::Serde(error)
    }
}

impl From<io::Error> for StoreError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
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
            StoreError::Validation {
                field,
                reason,
                extra,
            } => GeoError::Validation {
                field,
                reason,
                extra,
            },
            StoreError::Conflict { reason, extra } => GeoError::Conflict { reason, extra },
            StoreError::Sqlx(sqlx_error) => {
                if is_unique_violation(&sqlx_error) {
                    // reason 必须是稳定 key：SQL 原文降级进 value。此前 reason 装的是
                    // 驱动原文，前端词典永远查不到它。
                    GeoError::conflict(REASON_DUPLICATE).with_param("value", sqlx_error)
                } else {
                    GeoError::Io(io::Error::other(sqlx_error.to_string()))
                }
            }
            StoreError::Serde(serde_error) => GeoError::Serde(serde_error),
            // keyring 原文是**数据**不是文案：reason 用稳定 key，原文落 value
            StoreError::Secret(reason) => {
                GeoError::config(REASON_SECRET_UNAVAILABLE).with_param("value", reason)
            }
            StoreError::Io(io_error) => GeoError::Io(io_error),
        }
    }
}

impl From<GeoError> for StoreError {
    fn from(error: GeoError) -> Self {
        match error {
            GeoError::NotFound { kind, id } => StoreError::NotFound { kind, id },
            GeoError::Validation {
                field,
                reason,
                extra,
            } => StoreError::Validation {
                field,
                reason,
                extra,
            },
            GeoError::Conflict { reason, extra } => StoreError::Conflict { reason, extra },
            // `config/invalid` 在存储层只来自密钥不可用，映射回 `Secret` 以保持 code 语义。
            // 正向把原文装进了 `value`，反向必须取回来，否则 `Secret(text) → Geo → Secret`
            // 会丢掉 `text`（见 `secret_round_trips_through_geo_error_keeping_the_raw_text`）。
            GeoError::Config { reason, extra } => {
                StoreError::Secret(extra.get("value").cloned().unwrap_or(reason))
            }
            // 存储层不会产生上游错误；仅为反向转换完整性保留，降级为冲突。
            GeoError::Upstream { code, message } => {
                StoreError::conflict(format!("upstream/{code}：{message}"))
            }
            GeoError::Io(io_error) => StoreError::Io(io_error),
            GeoError::Serde(serde_error) => StoreError::Serde(serde_error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 期望的 params：逐键相等，避免「只发子集也算过」的假绿。
    fn expected(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    #[test]
    fn not_found_code_is_prefixed_with_kind() {
        let error = StoreError::not_found("project", "abc-123");
        assert_eq!(error.code(), "project/not_found");
        assert_eq!(
            error.params(),
            expected(&[("id", "abc-123"), ("kind", "project")])
        );
        assert_eq!(
            error.to_string(),
            "project/not_found id=abc-123 kind=project"
        );
    }

    #[test]
    fn validation_carries_field_reason_and_extra() {
        let error =
            StoreError::validation("competitor_ids", "not_allowed").with_param("value", "x");
        assert_eq!(error.code(), "validation/failed");
        assert_eq!(
            error.params(),
            expected(&[
                ("field", "competitor_ids"),
                ("reason", "not_allowed"),
                ("value", "x")
            ])
        );
        assert!(error.to_string().contains("competitor_ids"));
    }

    /// Task 4：`params()` 是 IPC 边界唯一的真值源（壳侧 `From<StoreError>` 直接委托），
    /// 键集必须逐字等于 `contracts/error-codes.json` 给该 code 登记的 params。
    #[test]
    fn params_match_the_frozen_catalog() {
        assert_eq!(
            StoreError::not_found("prompt_set", "x").params(),
            expected(&[("id", "x"), ("kind", "prompt_set")])
        );
        // `Secret(String)` 形状不变：那个 String 就是已 `redact` 的底层原文，
        // `params()` 把它装进 `value`，`reason` 恒为目录里的 `secret_unavailable`
        assert_eq!(
            StoreError::secret("keyring_unavailable").params(),
            expected(&[
                ("reason", "secret_unavailable"),
                ("value", "keyring_unavailable")
            ])
        );
        assert_eq!(
            StoreError::conflict("duplicate")
                .with_param("value", "UNIQUE constraint failed")
                .params(),
            expected(&[
                ("reason", "duplicate"),
                ("value", "UNIQUE constraint failed")
            ])
        );

        // 非唯一约束的 sqlx 错误归 `io/failed`，reason 是驱动原文（raw passthrough）
        let sqlx_error = StoreError::Sqlx(sqlx::Error::RowNotFound);
        assert_eq!(sqlx_error.code(), "io/failed");
        assert_eq!(sqlx_error.params().len(), 1);
        assert!(!sqlx_error.params()["reason"].is_empty());

        let serde_error = StoreError::Serde(serde_json::from_str::<u8>("nope").unwrap_err());
        assert_eq!(serde_error.code(), "data/invalid");
        assert_eq!(serde_error.params().len(), 1);
        assert!(serde_error.params()["reason"].contains("expected ident"));

        let io_error = StoreError::Io(io::Error::other("disk full"));
        assert_eq!(io_error.params(), expected(&[("reason", "disk full")]));
    }

    /// `Display` 是紧凑日志格式，与 `GeoError::Display`、壳里 `IpcError::with_params`
    /// 的兜底文案同构；不再是中文散文（文案归前端词典，AGENTS 规则 7）。
    #[test]
    fn display_is_compact_log_format() {
        assert_eq!(
            StoreError::conflict("duplicate").to_string(),
            "state/conflict reason=duplicate"
        );
        assert_eq!(
            StoreError::secret("no_entry").to_string(),
            "config/invalid reason=secret_unavailable value=no_entry"
        );
        assert_eq!(
            StoreError::validation("text", "required").to_string(),
            "validation/failed field=text reason=required"
        );
    }

    #[test]
    fn store_error_converts_to_geo_error_keeping_code() {
        let cases: Vec<StoreError> = vec![
            StoreError::not_found("prompt_set", "id-1"),
            StoreError::validation("text", "required"),
            StoreError::conflict("duplicate").with_param("value", "UNIQUE constraint failed"),
            StoreError::Serde(serde_json::from_str::<u8>("nope").unwrap_err()),
            StoreError::secret("keyring_unavailable"),
            StoreError::Io(io::Error::other("disk full")),
            StoreError::Sqlx(sqlx::Error::RowNotFound),
        ];
        for error in cases {
            let expected_code = error.code();
            let expected_params = error.params();
            let geo = GeoError::from(error);
            assert_eq!(geo.code(), expected_code, "code 语义必须保持一致");
            assert_eq!(geo.params(), expected_params, "转换必须无损（含 extra）");
            assert!(!geo.user_message().is_empty());
        }
    }

    #[test]
    fn geo_error_converts_back_keeping_code() {
        let cases = vec![
            GeoError::not_found("project", "id-1"),
            GeoError::validation("brand_name", "required"),
            GeoError::conflict("duplicate"),
            GeoError::config("secret_unavailable"),
            GeoError::Io(io::Error::other("disk full")),
        ];
        for geo in cases {
            let expected = geo.code();
            let store = StoreError::from(geo);
            assert_eq!(store.code(), expected);
        }
    }

    /// R-B：正向把 `Secret(text)` 的原文装进 `value`，反向必须原样拿回同一个 `text`。
    #[test]
    fn secret_round_trips_through_geo_error_keeping_the_raw_text() {
        let geo = GeoError::from(StoreError::secret("keyring_unavailable"));
        assert_eq!(geo.code(), "config/invalid");
        assert_eq!(geo.params()["reason"], "secret_unavailable");

        let back = StoreError::from(geo);
        assert!(
            matches!(&back, StoreError::Secret(text) if text == "keyring_unavailable"),
            "往返必须拿回原 text，实际：{back:?}"
        );
        assert_eq!(
            back.params(),
            expected(&[
                ("reason", "secret_unavailable"),
                ("value", "keyring_unavailable")
            ])
        );
    }

    /// `extra` 也要无损往返：Task 3 留下的「`GeoError → StoreError` 丢掉 extra」在这里补齐。
    #[test]
    fn extra_round_trips_between_store_and_geo_error() {
        let too_long = expected(&[
            ("field", "brand_name"),
            ("limit", "60"),
            ("reason", "too_long"),
        ]);
        let validation = StoreError::from(
            GeoError::validation("brand_name", "too_long").with_param("limit", 60),
        );
        assert_eq!(validation.params(), too_long);
        assert_eq!(GeoError::from(validation).params(), too_long);

        let write_failed = expected(&[("reason", "write_failed"), ("value", "disk full")]);
        let conflict =
            StoreError::from(GeoError::conflict("write_failed").with_param("value", "disk full"));
        assert_eq!(conflict.params(), write_failed);
        assert_eq!(GeoError::from(conflict).params(), write_failed);
    }

    #[test]
    fn secret_error_message_never_carries_value() {
        // 约定：只描述原因，不拼接密钥内容。
        let error = StoreError::secret("no_entry");
        assert!(!error.to_string().contains("sk-"));
    }

    /// `with_param` 的基础键守卫，与 `GeoError::with_param`（Task 3 的 M-1）同语义：
    /// 基础键被 extra 顶掉后前端词典就查不到 key，而 `code()` / `Display` 照常输出。
    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "不能被 extra 覆盖")]
    fn with_param_refuses_to_shadow_the_validation_base_keys() {
        let _error =
            StoreError::validation("brand_name", "too_long").with_param("field", "aliases");
    }

    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "不能被 extra 覆盖")]
    fn with_param_refuses_to_shadow_the_conflict_reason_key() {
        let _error = StoreError::conflict("duplicate").with_param("reason", "disk full");
    }

    /// `Secret` / `NotFound` / `Sqlx` / `Serde` / `Io` 的键集是固定的（全部由变体自身推出），
    /// 参数会被丢弃，因此必须炸出来。panic 信息只打 `code()`、不打参数值：
    /// 值可能是密钥样式片段，而 `Debug` 输出不经 `redact`（AGENTS 规则 3）。
    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "键集是固定的")]
    fn with_param_on_a_fixed_keyset_variant_trips_the_debug_assert() {
        let _error = StoreError::secret("keyring_unavailable").with_param("value", "x");
    }

    /// `Display` / `Error` / `From` 改成手写之后，原 `#[from]` 语义仍在：
    /// `?` 与 `Box<dyn Error>` 都要能用。
    #[test]
    fn store_error_is_a_std_error_and_converts_from_io_serde_sqlx() {
        fn as_std_error(error: &dyn std::error::Error) -> String {
            error.to_string()
        }
        let from_io: StoreError = io::Error::other("disk full").into();
        assert!(matches!(from_io, StoreError::Io(_)));
        assert_eq!(as_std_error(&from_io), "io/failed reason=disk full");

        let from_serde: StoreError = serde_json::from_str::<u8>("nope").unwrap_err().into();
        assert!(matches!(from_serde, StoreError::Serde(_)));

        let from_sqlx: StoreError = sqlx::Error::RowNotFound.into();
        assert!(matches!(from_sqlx, StoreError::Sqlx(_)));
    }
}

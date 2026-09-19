//! 跨层统一错误类型。
//!
//! 后端不产出自然语言：每个错误都是「稳定 `code` + 语言中立 `params`」，
//! 文案由前端词典（`apps/desktop/ui/src/i18n`）按当前语言渲染，参数名由冻结的
//! `contracts/error-codes.json` 登记（契约见
//! `docs/superpowers/specs/2026-09-18-geo-desktop-demo-i18n-settings-design.md` §4.2）。
//! 因此 [`GeoError`] 的 `Display` 是**日志格式**，不是给人读的句子。
//!
//! # reason key 目录（Plan A Task 4/5/7 的唯一真值源）
//!
//! `Validation` / `Conflict` / `Config` 的 `reason` 取下列 key 之一，一律小写下划线。
//! 契约文件的 `note` 不再复制这份清单——两处清单必然漂移，以本注释为准。
//!
//! **适用范围**：本目录是后端所有 `reason` 参数的词表，不只属于 `GeoError`——
//! `missing_base_url` / `missing_model` 经 `LlmError::Config`（code `llm/config`）发出而不是
//! `GeoError::Config`；`unknown_provider` 挂**同一个 code** 却**不由 geo-llm 发出**——它在 geo-llm
//! 内零发射点，由壳侧（`state.rs` / `settings_service.rs`）直接构造 `IpcError`；
//! `row_invalid` / `missing_header`
//! 经 CSV 导入导出路径发出；`parse_failed` / `json_not_found` / `missing_choices` /
//! `validation_failed` 经 `LlmError::BadResponse` / `LlmError::Deserialize`
//! （code `llm/bad_response` / `llm/deserialize`）发出；`http_status` 与 `not_allowed`
//! 经 `CrawlerError::Network` / `CrawlerError::Blocked`（code `crawler/network` /
//! `crawler/blocked`）发出；`secret_unavailable` 与 `duplicate` 经 `StoreError::Secret` /
//! `StoreError::Sqlx`（命中唯一约束，code `config/invalid` / `state/conflict`）发出。
//!
//! | key | 语义 | 配套参数 |
//! | --- | --- | --- |
//! | `required` | 必填项缺失/为空（表单字段） | — |
//! | `empty` | 集合或文件整体为空 | — |
//! | `too_long` | **字符数**超过上限 | `limit` |
//! | `too_short` | **字符数**低于下限 | `limit` |
//! | `invalid_url` | 网址无法解析或缺少合法域名 | `value` |
//! | `invalid_id` | 不是合法 ID（UUID 等） | `value` |
//! | `invalid_format` | 我们自己写的形状/类型判据不通过（下标非法、父节点不是数组、协议不是 http/https） | `value` |
//! | `duplicate` | 重复（唯一约束、重复导入） | — |
//! | `out_of_range` | 数量或数值区间越界 | `expected`（`1~5` / `<=5` / `0~9`）、`value` |
//! | `not_allowed` | 协议/取值/内容不被允许（含广告法红线词） | `value` |
//! | `missing_header` | CSV 缺少必需列 | `value` |
//! | `row_invalid` | CSV 单行非法（行级错误，配 `CsvRowError`） | `value` |
//! | `unknown_provider` | 服务商档案不存在 | `value` |
//! | `missing_base_url` | 服务商缺 base_url | `value` |
//! | `missing_model` | 缺模型名 | `value` |
//! | `parse_failed` | 序列化/反序列化失败（上游响应、文件内容、请求体） | `value` |
//! | `json_not_found` | 模型输出里找不到合法 JSON | — |
//! | `missing_choices` | 上游响应缺 choices（多为网关拦截） | — |
//! | `http_status` | 上游返回非 2xx 状态码（配该 code 自己的 `status` 参数） | — |
//! | `unknown_field` | 字段路径指向未知字段（路径本身格式是对的） | `value` |
//! | `validation_failed` | 字段校验器判失败（校验器原文只进日志，不进参数） | — |
//! | `write_failed` | 导出/写文件失败（不是解析问题） | `value` |
//! | `secret_unavailable` | 系统钥匙串读写失败（`StoreError::Secret`） | `value` |
//!
//! 四条语义规则：
//!
//! 1. `required` = 必填项缺失/为空（**表单字段**）；`empty` = 集合或文件整体为空。
//! 2. `too_long` / `too_short` **只用于字符数**，配 `limit`；数量与数值区间一律
//!    `out_of_range`，配 `expected`（语言中立表达式）。`expected` 只有三种纯 ASCII 形态：
//!    `a~b`（闭区间）/ `<=n` / `<n`，**不带单位**——单位（字/个/家）属于文案，
//!    只能由词典模板给出，参数里出现「60 字」等于把中文塞回 params。
//! 3. `parse_failed` = **解析器/序列化器库**返回的 `Error`（csv / serde / url / html2text），
//!    `value` 装库原文；`invalid_format` = **我们自己写的形状/类型判据**（下标非法、
//!    父节点不是数组、协议不是 http/https），`value` 装出错的值。两者都不用于
//!    「上游说的原因」——那是 `upstream/*` 的 `upstream`。
//! 4. **raw passthrough 例外**：`io/failed` 与 `data/invalid` 的 `reason` 是操作系统 /
//!    serde 的**原文**，不是上表的 key（OS 错误没有有限词表，硬造 key 只会说谎）。
//!    同一规则覆盖 `upstream/*` 的 `upstream`（上游返回的原文报文）。
//!    由此定下前端词典规则（Task 7 依赖）：先查 `errors.reasons.<reason>`，
//!    **查不到就原样显示该值**。
//!
//! 参数值一律是语言中立的原始值（数字、URL、ID、字段名、下标、底层错误原文），
//! **绝不允许是句子**。密钥脱敏发生在 IPC 边界的 `IpcError::with_params`
//! （AGENTS 规则 3），领域层不做——本 crate 也不该知道哪些字段像密钥。

use std::collections::BTreeMap;
use std::fmt;

/// 领域错误。所有 crate 对外暴露的错误最终都转换为该类型，
/// 由桌面壳在 IPC 边界映射为稳定错误码 + 语言中立参数。
#[derive(Debug)]
pub enum GeoError {
    /// 输入校验失败：`field` 是字段名，`reason` 是目录里的 key，
    /// `extra` 是该 key 的配套参数（`limit` / `expected` / `value`）。
    Validation {
        field: String,
        reason: String,
        extra: BTreeMap<String, String>,
    },
    /// 资源不存在，`kind` 为资源类别（如 `project`、`prompt_set`）。
    NotFound { kind: String, id: String },
    /// 状态冲突（如重复导入、版本冲突、导出写失败）。
    Conflict {
        reason: String,
        extra: BTreeMap<String, String>,
    },
    /// 配置缺失或非法。
    Config {
        reason: String,
        extra: BTreeMap<String, String>,
    },
    /// 上游服务（LLM / 引擎 / 站点）返回的错误：`code` 是里层稳定码，
    /// `message` 是上游原文（不进词典，UI 以次要文本展示）。
    Upstream { code: String, message: String },
    /// IO 错误。`params()["reason"]` 是操作系统原文（raw passthrough）。
    Io(std::io::Error),
    /// 序列化/反序列化错误。`params()["reason"]` 是 serde 原文（raw passthrough）。
    Serde(serde_json::Error),
}

impl GeoError {
    pub fn validation(field: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::Validation {
            field: field.into(),
            reason: reason.into(),
            extra: BTreeMap::new(),
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
            extra: BTreeMap::new(),
        }
    }

    pub fn config(reason: impl Into<String>) -> Self {
        Self::Config {
            reason: reason.into(),
            extra: BTreeMap::new(),
        }
    }

    pub fn upstream(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Upstream {
            code: code.into(),
            message: message.into(),
        }
    }

    /// 链式追加一个语言中立参数，落进变体的 `extra`。
    ///
    /// `key` 必须是 `contracts/error-codes.json` 里该 code 登记的参数名
    /// （`limit` / `expected` / `value` …），`value` 是原始值而不是句子。
    ///
    /// 两类误用都在 debug 构建里 `debug_assert!` 炸出来（release 下原样返回，不 panic），
    /// 因为它们都是**静默**的：`code()` 照常、`Display` 照印、没有任何报警。
    ///
    /// 1. `key` 撞基础键：`params()` 里 `extra` 是最后 `extend` 的，同名键会把变体字段
    ///    提供的 `field` / `reason` 顶掉（`reason` key 被参数值替换 = 前端词典查不到）。
    /// 2. 变体没有 `extra`：`NotFound` / `Upstream` / `Io` / `Serde` 的键集是固定的，
    ///    参数会被丢弃。
    ///
    /// 注意与壳里的 `IpcError::with_param` 同名但不同层：脱敏（`redact`）只发生在
    /// IPC 边界，领域层原样保留值。
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
            Self::Config { reason, mut extra } => {
                debug_assert!(
                    key != "reason",
                    "config/invalid 的基础键 reason 由变体字段提供，不能被 extra 覆盖（收到 {key}）"
                );
                extra.insert(key.to_string(), value);
                Self::Config { reason, extra }
            }
            other @ (Self::NotFound { .. }
            | Self::Upstream { .. }
            | Self::Io(_)
            | Self::Serde(_)) => {
                // panic 信息里只打 `code()`，不打 `{other:?}` 也不打参数值：`Debug` 输出
                // **不经 `redact`**，`Upstream { message: "…sk-abc123…" }` 会把疑似 Key 的
                // 原文送进 panic 信息（AGENTS 规则 3「日志与错误信息中不得出现 Key」）。
                // `code()` 不含任何用户数据，定位足够了。
                debug_assert!(
                    false,
                    "{} 的键集是固定的，参数 {key} 会被丢弃",
                    other.code()
                );
                other
            }
        }
    }

    /// 稳定错误码，供前端分支处理。`NotFound` 会带上资源类别前缀，
    /// 例如 `project/not_found`；`Upstream` 套 `upstream/` 前缀。
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

    /// 语言中立参数：前端词典按这些键插值，键名由
    /// `contracts/error-codes.json` 冻结。
    ///
    /// 键集（与契约逐字一致）：
    /// `Validation` → `{field, reason} ∪ extra`、`NotFound` → `{kind, id}`、
    /// `Conflict`/`Config` → `{reason} ∪ extra`、`Upstream` → `{upstream_code, upstream}`、
    /// `Io`/`Serde` → `{reason}`（原文透传）。
    ///
    /// 这是 `code` 之外唯一的真值源：`Display` 与壳里的
    /// `From<GeoError> for IpcError` 都复用它，不再各拼一份。
    ///
    /// 插入顺序是**先 `extra` 后基础键**：`with_param` 撞基础键的守卫是
    /// `debug_assert!`，release 构建下不生效，此时插入顺序就是「基础键不被 `extra`
    /// 顶掉」的唯一保证（复审 M-2）。基础键的取值永远来自变体字段。
    pub fn params(&self) -> BTreeMap<String, String> {
        let mut params = BTreeMap::new();
        match self {
            Self::Validation {
                field,
                reason,
                extra,
            } => {
                params.extend(
                    extra
                        .iter()
                        .map(|(key, value)| (key.clone(), value.clone())),
                );
                params.insert("field".to_string(), field.clone());
                params.insert("reason".to_string(), reason.clone());
            }
            Self::Conflict { reason, extra } | Self::Config { reason, extra } => {
                params.extend(
                    extra
                        .iter()
                        .map(|(key, value)| (key.clone(), value.clone())),
                );
                params.insert("reason".to_string(), reason.clone());
            }
            Self::NotFound { kind, id } => {
                params.insert("kind".to_string(), kind.clone());
                params.insert("id".to_string(), id.clone());
            }
            Self::Upstream { code, message } => {
                // 上游原文按契约走包装族的两个键（不是 code/message）
                params.insert("upstream_code".to_string(), code.clone());
                params.insert("upstream".to_string(), message.clone());
            }
            Self::Io(io_error) => {
                params.insert("reason".to_string(), io_error.to_string());
            }
            Self::Serde(serde_error) => {
                params.insert("reason".to_string(), serde_error.to_string());
            }
        }
        params
    }

    /// 日志/兜底文案。**不再承诺中文散文**：内容是紧凑日志格式
    /// （`"{code} {k}={v} …"`），词典未命中时前端才会展示它。
    pub fn user_message(&self) -> String {
        self.to_string()
    }
}

/// 紧凑日志格式：`"{code} {k}={v} {k}={v}…"`，键序按 `BTreeMap`（字典序）。
///
/// 与壳里 `IpcError::with_params` 的兜底文案**逐字同构**，因此同一条错误在
/// 领域层日志与 IPC 兜底文案里长得一样，便于串起来查。
/// 手写而不用派生宏的 `#[error("…")]` 模板：`code()` 对 `NotFound` / `Upstream`
/// 要动态拼前缀，模板里表达不了，而 `params()` 必须保持单一真值源。
impl fmt::Display for GeoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.code())?;
        for (key, value) in self.params() {
            write!(f, " {key}={value}")?;
        }
        Ok(())
    }
}

impl std::error::Error for GeoError {}

impl From<std::io::Error> for GeoError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for GeoError {
    fn from(error: serde_json::Error) -> Self {
        Self::Serde(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_error_contains_field_and_reason() {
        let err = GeoError::validation("brand_name", "required");
        assert_eq!(err.code(), "validation/failed");
        assert!(err.user_message().contains("brand_name"));
        assert!(err.user_message().contains("required"));
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

    // -----------------------------------------------------------------
    // `params()` 与日志格式 `Display`（spec §4.2 / Plan A Task 3）。
    //
    // 断言只认 `code` + 语言中立的 `params` 键值，不认任何自然语言散文：
    // 文案由前端词典按当前语言渲染，后端一旦把散文塞进 params 就等于把
    // 一种语言焊死在契约里。
    // -----------------------------------------------------------------

    #[test]
    fn validation_params_carry_field_and_reason_key() {
        let err = GeoError::validation("brand_name", "required");
        let mut expected = BTreeMap::new();
        expected.insert("field".to_string(), "brand_name".to_string());
        expected.insert("reason".to_string(), "required".to_string());
        assert_eq!(err.params(), expected);
    }

    #[test]
    fn display_is_a_compact_log_line() {
        let err = GeoError::validation("brand_name", "required");
        assert_eq!(
            err.to_string(),
            "validation/failed field=brand_name reason=required"
        );
        assert_eq!(err.user_message(), err.to_string());
    }

    #[test]
    fn with_param_adds_a_language_neutral_value_in_lexical_order() {
        let err = GeoError::validation("brand_name", "too_long").with_param("limit", 60);
        assert_eq!(
            err.to_string(),
            "validation/failed field=brand_name limit=60 reason=too_long"
        );
        assert_eq!(err.params()["limit"], "60");
    }

    #[test]
    fn conflict_and_config_params_merge_extra() {
        let conflict = GeoError::conflict("write_failed").with_param("value", "disk full");
        assert_eq!(conflict.code(), "state/conflict");
        assert_eq!(conflict.params()["reason"], "write_failed");
        assert_eq!(conflict.params()["value"], "disk full");
        assert_eq!(conflict.params().len(), 2);

        let config = GeoError::config("missing_base_url");
        assert_eq!(config.params()["reason"], "missing_base_url");
        assert_eq!(config.params().len(), 1);
    }

    #[test]
    fn not_found_params_carry_kind_and_id() {
        let err = GeoError::not_found("project", "abc");
        assert_eq!(err.params()["kind"], "project");
        assert_eq!(err.params()["id"], "abc");
        assert_eq!(err.params().len(), 2);
        assert!(err.to_string().starts_with("project/not_found "), "{}", err);
    }

    #[test]
    fn upstream_params_use_the_wrapper_keys() {
        let err = GeoError::upstream("llm/server", "HTTP 503");
        assert_eq!(err.code(), "upstream/llm/server");
        assert_eq!(err.params()["upstream_code"], "llm/server");
        assert_eq!(err.params()["upstream"], "HTTP 503");
        assert_eq!(err.params().len(), 2);
        assert_eq!(
            err.to_string(),
            "upstream/llm/server upstream=HTTP 503 upstream_code=llm/server"
        );
    }

    /// 目录里的代表性 key：每个都带语言中立的原始值（数字 / 表达式 / 原始串），
    /// 绝不带句子。`write_failed` 挂在 `Conflict` 上（CSV 导出写失败是操作冲突）。
    #[test]
    fn representative_reason_keys_carry_language_neutral_values() {
        let cases: Vec<(GeoError, &str, &str, &str)> = vec![
            (
                GeoError::validation("website", "invalid_url").with_param("value", "not a url"),
                "invalid_url",
                "value",
                "not a url",
            ),
            (
                GeoError::validation("weight", "out_of_range").with_param("expected", "1~5"),
                "out_of_range",
                "expected",
                "1~5",
            ),
            (
                GeoError::validation("csv_header", "missing_header")
                    .with_param("value", "intent, source"),
                "missing_header",
                "value",
                "intent, source",
            ),
            (
                GeoError::validation("field_path", "unknown_field").with_param("value", "products"),
                "unknown_field",
                "value",
                "products",
            ),
            (
                GeoError::conflict("write_failed").with_param("value", "broken pipe"),
                "write_failed",
                "value",
                "broken pipe",
            ),
        ];
        for (err, reason, key, value) in cases {
            assert_eq!(err.params()["reason"], reason, "{err}");
            assert_eq!(err.params()[key], value, "{err}");
        }
    }

    /// raw passthrough 例外：`io/failed` 与 `data/invalid` 的 `reason` 是
    /// 操作系统 / serde 的原文，不是目录里的 key（前端查不到就原样显示）。
    #[test]
    fn io_and_serde_reasons_are_raw_passthrough() {
        let io_err = GeoError::Io(std::io::Error::other("disk full"));
        assert_eq!(io_err.code(), "io/failed");
        assert_eq!(io_err.params()["reason"], "disk full");
        assert_eq!(io_err.to_string(), "io/failed reason=disk full");

        let serde_err = GeoError::Serde(serde_json::from_str::<u8>("nope").unwrap_err());
        assert_eq!(serde_err.code(), "data/invalid");
        assert_eq!(serde_err.params().len(), 1);
        // serde 的原文照抄，不强造 key
        assert_eq!(
            serde_err.params()["reason"],
            "expected ident at line 1 column 2"
        );
    }

    /// `with_param` 用在键集固定的变体上必须被 `debug_assert!` 抓到，
    /// 不能静默吞掉参数。release 下 `debug_assert` 是空操作，故只在 debug 构建跑。
    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "键集是固定的")]
    fn with_param_on_a_fixed_keyset_variant_trips_the_debug_assert() {
        let _err = GeoError::not_found("project", "abc").with_param("value", "x");
    }

    /// M-1：`params()` 里 `extra` 最后 `extend`，同名键会把变体字段提供的基础键顶掉，
    /// 而 `code()` / `Display` 照常输出——静默到没有任何报警，因此必须 `debug_assert!`。
    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "不能被 extra 覆盖")]
    fn with_param_refuses_to_shadow_the_field_base_key() {
        let _err = GeoError::validation("brand_name", "too_long").with_param("field", "aliases");
        panic!("上面那行本该先炸");
    }

    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "不能被 extra 覆盖")]
    fn with_param_refuses_to_shadow_the_validation_reason_key() {
        let _err = GeoError::validation("brand_name", "too_long").with_param("reason", 60);
        panic!("上面那行本该先炸");
    }

    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "不能被 extra 覆盖")]
    fn with_param_refuses_to_shadow_the_conflict_reason_key() {
        let _err = GeoError::conflict("write_failed").with_param("reason", "disk full");
        panic!("上面那行本该先炸");
    }

    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "不能被 extra 覆盖")]
    fn with_param_refuses_to_shadow_the_config_reason_key() {
        let _err = GeoError::config("missing_base_url").with_param("reason", "x");
        panic!("上面那行本该先炸");
    }

    /// M-2：`debug_assert!` 只在 debug 构建生效，release 下 `extra` 里的同名键会
    /// **静默**顶掉变体字段，产出一个不在目录里的 `reason` 值（键集守卫比的是键不是值，
    /// 抓不到）。`params()` 因此先铺 `extra` 再插基础键，让插入顺序成为第二道防线。
    ///
    /// 这里直接构造 `extra`（绕过 `with_param`，免得上面那几条 `debug_assert!` 先炸），
    /// 断言基础键的取值永远来自变体字段、非基础键照常透传。
    #[test]
    fn base_keys_win_over_a_shadowing_extra_entry() {
        let mut extra = BTreeMap::new();
        extra.insert("reason".to_string(), "not_a_catalog_key".to_string());
        extra.insert("field".to_string(), "aliases".to_string());
        extra.insert("limit".to_string(), "60".to_string());

        let validation = GeoError::Validation {
            field: "brand_name".to_string(),
            reason: "too_long".to_string(),
            extra: extra.clone(),
        };
        let params = validation.params();
        assert_eq!(params["reason"], "too_long", "{params:?}");
        assert_eq!(params["field"], "brand_name", "{params:?}");
        assert_eq!(params["limit"], "60", "非基础键要照常透传：{params:?}");
        assert_eq!(params.len(), 3, "{params:?}");

        for error in [
            GeoError::Conflict {
                reason: "duplicate".to_string(),
                extra: extra.clone(),
            },
            GeoError::Config {
                reason: "secret_unavailable".to_string(),
                extra,
            },
        ] {
            let params = error.params();
            assert_eq!(params.len(), 3, "{params:?}");
            assert!(
                params["reason"] != "not_a_catalog_key",
                "extra 顶掉了基础键 reason：{params:?}"
            );
        }
    }

    /// M-3：panic 信息不得夹带用户数据（`Debug` 不经 `redact`）。
    /// `Upstream` 的 `message` 装的是上游原文，可能带疑似 Key 的片段。
    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "键集是固定的")]
    fn fixed_keyset_panic_message_never_echoes_the_upstream_payload() {
        let result = std::panic::catch_unwind(|| {
            let _err = GeoError::upstream("auth", "Bearer sk-abc123XYZ_-9 无效")
                .with_param("value", "sk-second0000");
        });
        let payload = result.unwrap_err();
        let text = payload
            .downcast_ref::<String>()
            .cloned()
            .unwrap_or_else(|| panic!("debug_assert 应当带 String 消息"));
        assert!(
            !text.contains("sk-"),
            "panic 信息里出现了疑似 Key 的原文：{text}"
        );
        assert!(text.contains("upstream/auth"), "{text}");
        panic!("{text}");
    }

    /// 领域错误仍是标准错误：`?` 与 `Box<dyn Error>` 都要能用（原 `#[from]` 语义）。
    #[test]
    fn geo_error_is_a_std_error_and_converts_from_io_and_serde() {
        fn as_std_error(err: &dyn std::error::Error) -> String {
            err.to_string()
        }
        let from_io: GeoError = std::io::Error::other("disk full").into();
        assert!(matches!(from_io, GeoError::Io(_)));
        assert_eq!(as_std_error(&from_io), "io/failed reason=disk full");

        let from_serde: GeoError = serde_json::from_str::<u8>("nope").unwrap_err().into();
        assert!(matches!(from_serde, GeoError::Serde(_)));
        assert_eq!(as_std_error(&from_serde), from_serde.to_string());
    }
}

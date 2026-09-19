//! LLM 层错误：稳定 `code` + 语言中立 `params`。
//!
//! 约定（见 AGENTS.md）：后端不产出自然语言，文案由前端词典按当前语言渲染；
//! API Key 与完整回答正文都不得出现在错误信息里，`params` 也不例外。
//!
//! `Display` 是**日志格式**（`"{code} {k}={v} …"`），与 `GeoError::Display`、
//! 壳里 `IpcError::with_params` 的兜底文案逐字同构，不是给人读的句子。
//!
//! `Config` 的 `reason` 取 reason key 目录里的 key（目录是
//! `crates/geo-domain/src/error.rs` 模块注释里那张表）。本 crate 实际只发三个：
//! `missing_base_url` / `missing_model`（`value` = `Provider::as_str()` 的稳定 id）与
//! `parse_failed`（`value` = serde 库原文）——配套参数一律装 `value`。
//! 目录里同挂 `llm/config` 的 `unknown_provider` **不由本 crate 发出**：它没有对应的
//! `LlmError` 变体，是壳侧解析 provider 串失败时直接发的（那条链路同样带 `value`）。
//! `BadResponse` 的 `reason` 取 `parse_failed` / `json_not_found` / `missing_choices`，
//! `Deserialize` 的 `reason` 取 `parse_failed` / `json_not_found` / `validation_failed`
//! （追问一次后仍抽不到 JSON 就是 `json_not_found`）；只有 `parse_failed` 会带 `value`
//! （库原文，经 [`library_reason`] 限长）。

use std::collections::BTreeMap;
use std::fmt;

use geo_domain::GeoError;

use crate::transport::TransportError;

#[derive(Debug)]
pub enum LlmError {
    /// 模型配置缺失或非法：`reason` 是目录里的 key，`extra` 是它的配套参数。
    Config {
        reason: String,
        extra: BTreeMap<String, String>,
    },
    /// 传输层失败。`params()["reason"]` 是 [`TransportError::reason_key`] 的三个
    /// 稳定 key 之一；底层原文只进日志，不进 params。
    Transport(TransportError),
    /// 触发限流。清单里 `llm/rate_limited` 没有 params。
    RateLimited,
    /// 上游返回非 2xx。
    Server { status: u16 },
    /// 上游响应不可用（不是合法 JSON、缺 choices）：`reason` 是目录里的 key
    /// （`parse_failed` / `json_not_found` / `missing_choices`），`extra` 是它的配套参数
    /// （只有 `parse_failed` 带 `value` = 库原文）。**不含**响应正文——被禁的是
    /// `upstream`（上游响应体原文），`value` 装的是 serde 的库消息，不是回答正文。
    BadResponse {
        reason: String,
        extra: BTreeMap<String, String>,
    },
    /// 带错误说明追问一次后，结构仍不符合预期：`reason` 是目录里的 key
    /// （`parse_failed` / `json_not_found` / `validation_failed`），`extra` 同上。
    /// 校验器原文（`validate` 闭包返回的那句）**只进日志**，不进 `extra`。
    Deserialize {
        reason: String,
        extra: BTreeMap<String, String>,
    },
    /// 未配置 API Key。清单里 `llm/missing_secret` 没有 params。
    MissingSecret,
}

impl LlmError {
    /// 配置类错误：`reason` 必须是目录里的 key，不是散文。
    pub fn config(reason: impl Into<String>) -> Self {
        Self::Config {
            reason: reason.into(),
            extra: BTreeMap::new(),
        }
    }

    /// 上游响应不可用：`reason` 必须是目录里的 key
    /// （`parse_failed` / `json_not_found` / `missing_choices`），不是散文。
    pub fn bad_response(reason: impl Into<String>) -> Self {
        Self::BadResponse {
            reason: reason.into(),
            extra: BTreeMap::new(),
        }
    }

    /// 结构化输出追问一次后仍不可用：`reason` 必须是目录里的 key
    /// （`parse_failed` / `json_not_found` / `validation_failed`），不是散文。
    pub fn deserialize(reason: impl Into<String>) -> Self {
        Self::Deserialize {
            reason: reason.into(),
            extra: BTreeMap::new(),
        }
    }

    /// 链式追加一个语言中立参数，落进带 `extra` 的三个变体
    /// （`Config` / `BadResponse` / `Deserialize`）。
    ///
    /// 与 `GeoError::with_param` 同语义（含 Task 3 的 M-1 守卫）：两类误用都在 debug
    /// 构建里 `debug_assert!` 炸出来，因为它们都是**静默**的——`code()` 照常、
    /// `Display` 照印、没有任何报警。release 构建下 `debug_assert!` 不生效，此时
    /// 兜底的是 `params()` 的插入顺序（先 `extra` 后基础键，见 M-2）。
    pub fn with_param(self, key: &str, value: impl fmt::Display) -> Self {
        let value = value.to_string();
        // 三个可追加的变体各自重装（不写 `_` 兜底：加变体时这里必须编译失败，
        // 逼实现者当场决定新变体带不带 extra）。
        match self {
            Self::Config { reason, extra } => Self::Config {
                reason,
                extra: push_extra(extra, key, &value, "llm/config"),
            },
            Self::BadResponse { reason, extra } => Self::BadResponse {
                reason,
                extra: push_extra(extra, key, &value, "llm/bad_response"),
            },
            Self::Deserialize { reason, extra } => Self::Deserialize {
                reason,
                extra: push_extra(extra, key, &value, "llm/deserialize"),
            },
            other @ (Self::Transport(_)
            | Self::RateLimited
            | Self::Server { .. }
            | Self::MissingSecret) => {
                // panic 信息里只打 `code()`：`Debug` 输出**不经 `redact`**，
                // `Transport` 可能夹带疑似 Key 的片段（AGENTS 规则 3）。
                debug_assert!(
                    false,
                    "{} 的键集是固定的，参数 {key} 会被丢弃",
                    other.code()
                );
                other
            }
        }
    }

    /// 稳定错误码，前端据此决定文案与是否可重试。
    pub fn code(&self) -> &'static str {
        match self {
            Self::Config { .. } => "llm/config",
            Self::Transport(_) => "llm/transport",
            Self::RateLimited => "llm/rate_limited",
            Self::Server { .. } => "llm/server",
            Self::BadResponse { .. } => "llm/bad_response",
            Self::Deserialize { .. } => "llm/deserialize",
            Self::MissingSecret => "llm/missing_secret",
        }
    }

    /// 语言中立参数，键名由 `contracts/error-codes.json` 冻结：
    /// `Config` / `BadResponse` / `Deserialize` → `{reason} ∪ extra`、
    /// `Transport` → `{reason}`（三个稳定 key 之一）、`Server` → `{status}`、
    /// `RateLimited` / `MissingSecret` → 空。
    ///
    /// 这是 `code` 之外唯一的真值源：`Display` 与壳里的
    /// `From<LlmError> for IpcError` 都复用它，不再各拼一份。
    ///
    /// 插入顺序是**先 `extra` 后基础键**：`with_param` 撞基础键的守卫是
    /// `debug_assert!`，release 构建下不生效，此时插入顺序就是「基础键不被 `extra`
    /// 顶掉」的唯一保证（复审 M-2）。基础键的取值永远来自变体字段。
    pub fn params(&self) -> BTreeMap<String, String> {
        let mut params = BTreeMap::new();
        match self {
            Self::Config { reason, extra }
            | Self::BadResponse { reason, extra }
            | Self::Deserialize { reason, extra } => {
                params.extend(
                    extra
                        .iter()
                        .map(|(key, value)| (key.clone(), value.clone())),
                );
                params.insert("reason".to_string(), reason.clone());
            }
            Self::Transport(error) => {
                params.insert("reason".to_string(), error.reason_key().to_string());
            }
            Self::Server { status } => {
                params.insert("status".to_string(), status.to_string());
            }
            Self::RateLimited | Self::MissingSecret => {}
        }
        params
    }

    /// 日志/兜底文案：紧凑格式，不承诺任何语言的散文。
    pub fn user_message(&self) -> String {
        self.to_string()
    }
}

/// 本 crate 会用到的 reason key（目录：`crates/geo-domain/src/error.rs` 模块注释那张表）。
///
/// 集中成常量而不是各站点写字面量：字面量拼错一个字母，前端词典就查不到、UI 直接显示
/// 裸记号，而漂移守卫比的是**键名**不是 `reason` 的取值，抓不到这种错。
/// `client.rs` 与 `json.rs` 共用 `REASON_PARSE_FAILED`，也只有跨文件的 key 才必须走常量。
pub(crate) const REASON_PARSE_FAILED: &str = "parse_failed";
/// 模型输出里找不到合法 JSON（`json.rs` 的 `extract_json`）。
pub(crate) const REASON_JSON_NOT_FOUND: &str = "json_not_found";
/// 上游响应缺 `choices`（多为网关拦截，`client.rs`）。
pub(crate) const REASON_MISSING_CHOICES: &str = "missing_choices";
/// 字段校验器判失败；校验器原文只进日志（裁定 G-3.1）。
pub(crate) const REASON_VALIDATION_FAILED: &str = "validation_failed";

/// 库原文（serde / csv / url 的 `Error`）当 `value` 时的统一整形：**按字符**截断到
/// [`MAX_LIBRARY_REASON_CHARS`]。
///
/// serde 在类型不匹配时会引用输入片段（`invalid type: string "…", expected u32`），
/// 那既是上游响应的原文片段、长度又无上界，所以裁定 G-3.2 要求限长。按**字符**而不是
/// 按字节切（`chars().take(n)`），否则会把 UTF-8 序列切碎成非法字符串。
///
/// **不**在这里调 `redact`：`redact` 在壳侧 `services/**`，crate 里引不到；响应体里
/// 出现 Key 的前提是上游把请求回显，那条路由 `service_flow.rs` 的
/// `!contains(TEST_API_KEY)` 断言看着（裁定 G-3.2 附带条款）。
pub(crate) fn library_reason(error: &dyn fmt::Display) -> String {
    error
        .to_string()
        .chars()
        .take(MAX_LIBRARY_REASON_CHARS)
        .collect()
}

/// `value` 里库原文的字符上限（裁定 G-3.2）。
pub(crate) const MAX_LIBRARY_REASON_CHARS: usize = 200;

/// `with_param` 的公共部分：撞基础键在 debug 构建里炸出来。
///
/// 误用是**静默**的（`code()` 照常、`Display` 照印），所以只能靠 `debug_assert!` 尽早
/// 报警；release 下的兜底是 `params()` 的插入顺序（M-2）。
fn push_extra(
    mut extra: BTreeMap<String, String>,
    key: &str,
    value: &str,
    code: &str,
) -> BTreeMap<String, String> {
    debug_assert!(
        key != "reason",
        "{code} 的基础键 reason 由变体字段提供，不能被 extra 覆盖（收到 {key}）"
    );
    extra.insert(key.to_string(), value.to_string());
    extra
}

/// 紧凑日志格式：`"{code} {k}={v} …"`，键序按 `BTreeMap`（字典序）。
///
/// 手写而不用派生宏的 `#[error("…")]` 模板：`params()` 必须保持单一真值源，
/// 模板里再拼一遍就是同一份映射存在两处（必然漂移）。
impl fmt::Display for LlmError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())?;
        for (key, value) in self.params() {
            write!(f, " {key}={value}")?;
        }
        Ok(())
    }
}

impl std::error::Error for LlmError {}

/// 原 `#[from]` 语义：传输层错误用 `?` 直接上抛。
impl From<TransportError> for LlmError {
    fn from(error: TransportError) -> Self {
        Self::Transport(error)
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

    use crate::provider::LlmProvider;

    /// 期望的 params：逐键相等，避免「只发子集也算过」的假绿。
    fn expected(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    fn cases() -> Vec<(LlmError, &'static str)> {
        vec![
            (LlmError::config("missing_base_url"), "llm/config"),
            (
                LlmError::Transport(TransportError::Timeout),
                "llm/transport",
            ),
            (LlmError::RateLimited, "llm/rate_limited"),
            (LlmError::Server { status: 500 }, "llm/server"),
            (
                LlmError::bad_response("missing_choices"),
                "llm/bad_response",
            ),
            (
                LlmError::bad_response("parse_failed")
                    .with_param("value", "expected value at line 1 column 1"),
                "llm/bad_response",
            ),
            (
                LlmError::deserialize("validation_failed"),
                "llm/deserialize",
            ),
            (
                LlmError::deserialize("parse_failed").with_param("value", "invalid type"),
                "llm/deserialize",
            ),
            (LlmError::MissingSecret, "llm/missing_secret"),
        ]
    }

    #[test]
    fn every_variant_has_a_stable_code() {
        for (error, code) in cases() {
            assert_eq!(error.code(), code, "{error:?} 的错误码不符");
        }
    }

    /// Task 4：`params()` 是 IPC 边界唯一的真值源（壳侧 `From<LlmError>` 直接委托），
    /// 键集必须逐字等于 `contracts/error-codes.json` 给该 code 登记的 params。
    ///
    /// 名字里的「frozen catalog」指的是**契约给该 code 登记的键集**，但本测试并不读
    /// `contracts/error-codes.json`（清单只在壳侧 `include_str!`，crate 层拿不到），
    /// 期望 map 是硬编码的。真正读契约文件的是壳侧的
    /// `catalog_params_equal_the_emitted_union` 与 `llm_and_crawler_params_follow_the_contract`
    /// ——契约改了而这里没跟上，红的是那两条（复审 M-6）。
    #[test]
    fn params_match_the_frozen_catalog() {
        // `llm/rate_limited` 与 `llm/missing_secret` 登记的是空数组：一个键都不许塞
        assert_eq!(LlmError::MissingSecret.code(), "llm/missing_secret");
        assert!(LlmError::MissingSecret.params().is_empty());
        assert!(LlmError::RateLimited.params().is_empty());

        assert_eq!(
            LlmError::Server { status: 500 }.params(),
            expected(&[("status", "500")])
        );

        // `llm/transport` 只有 reason，取值必须是三个稳定 key 之一（不是底层原文）
        assert_eq!(
            LlmError::Transport(TransportError::Timeout).params(),
            expected(&[("reason", "timeout")])
        );
        assert_eq!(
            LlmError::Transport(TransportError::Network("conn refused".into())).params(),
            expected(&[("reason", "network")])
        );
        assert_eq!(
            LlmError::Transport(TransportError::Other("fixture miss".into())).params(),
            expected(&[("reason", "other")])
        );

        // `llm/bad_response` / `llm/deserialize` 登记 `["reason","value"]`：reason 是目录里的
        // key（不再是散文），value 只有 `parse_failed` 会发（serde 库原文，已限长）。
        // 被禁的是 `upstream`（上游响应体原文），本轮不是把散文换个键名回退。
        assert_eq!(
            LlmError::bad_response("missing_choices").params(),
            expected(&[("reason", "missing_choices")])
        );
        assert_eq!(
            LlmError::bad_response("json_not_found").params(),
            expected(&[("reason", "json_not_found")])
        );
        assert_eq!(
            LlmError::bad_response("parse_failed")
                .with_param("value", "expected value at line 1 column 1")
                .params(),
            expected(&[
                ("reason", "parse_failed"),
                ("value", "expected value at line 1 column 1")
            ])
        );
        assert_eq!(
            LlmError::deserialize("validation_failed").params(),
            expected(&[("reason", "validation_failed")])
        );
        assert_eq!(
            LlmError::deserialize("parse_failed")
                .with_param("value", "invalid type")
                .params(),
            expected(&[("reason", "parse_failed"), ("value", "invalid type")])
        );

        // `llm/config` 是 `["reason","value"]`：reason 是目录 key，value 是语言中立原始值
        assert_eq!(
            LlmError::config("missing_model").params(),
            expected(&[("reason", "missing_model")])
        );
        assert_eq!(
            LlmError::config("missing_base_url")
                .with_param("value", "deep_seek")
                .params(),
            expected(&[("reason", "missing_base_url"), ("value", "deep_seek")])
        );
    }

    /// `Display` 是**日志格式**（`{code} k=v …`），与 `GeoError::Display` 及壳里
    /// `IpcError::with_params` 的兜底文案同构；不再是中文散文（AGENTS 规则 7）。
    #[test]
    fn display_is_compact_log_format() {
        for (error, code) in cases() {
            let message = error.user_message();
            assert!(!message.is_empty());
            assert_eq!(message, error.to_string());
            assert!(message.starts_with(code), "{message} 要以 code 开头");
        }
        assert_eq!(
            LlmError::Server { status: 502 }.to_string(),
            "llm/server status=502"
        );
        assert_eq!(LlmError::MissingSecret.to_string(), "llm/missing_secret");
        assert_eq!(
            LlmError::config("missing_base_url")
                .with_param("value", "custom")
                .to_string(),
            "llm/config reason=missing_base_url value=custom"
        );
    }

    /// `llm/config` 的 `value` 装 `Provider::as_str()` 的稳定 id：`label_zh()` 是中文，
    /// 进 params 等于把中文散文直送前端（en locale 下露馅）。
    #[test]
    fn config_params_stay_language_neutral() {
        let error = LlmError::config("missing_base_url")
            .with_param("value", LlmProvider::DeepSeek.as_str());
        let params = error.params();
        assert_eq!(params["reason"], "missing_base_url");
        assert_eq!(params["value"], "deep_seek");
        assert!(
            params.values().all(|value| value.is_ascii()),
            "params 里出现了非 ASCII 值：{params:?}"
        );
        assert!(!error.to_string().contains("深度求索"), "{error}");
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
        assert_eq!(geo.params()["upstream_code"], "llm/server");
        assert!(geo.params()["upstream"].contains("503"), "{geo}");

        let geo = GeoError::from(LlmError::MissingSecret);
        assert_eq!(geo.code(), "upstream/llm/missing_secret");
    }

    /// `with_param` 的基础键守卫，与 `GeoError::with_param`（Task 3 的 M-1）同语义：
    /// `reason` 由变体字段提供，被 extra 顶掉后前端词典就查不到 key，
    /// 而 `code()` / `Display` 照常输出——静默到没有报警，只能 `debug_assert!`。
    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "不能被 extra 覆盖")]
    fn with_param_refuses_to_shadow_the_config_reason_key() {
        let _error = LlmError::config("missing_model").with_param("reason", "x");
    }

    /// 键集固定的变体没有 `extra`，参数会被丢弃，同样必须炸出来。
    /// panic 信息只打 `code()`、不打参数值：值可能是密钥样式片段，
    /// 而 `Debug` 输出不经 `redact`（AGENTS 规则 3）。
    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "键集是固定的")]
    fn with_param_on_a_fixed_keyset_variant_trips_the_debug_assert() {
        let _error = LlmError::MissingSecret.with_param("value", "x");
    }

    /// M-2：`debug_assert!` 只在 debug 构建生效，release 下 `extra` 里的同名键会**静默**
    /// 顶掉变体字段，产出一个不在目录里的 `reason` 值（漂移守卫比的是键集不是取值，
    /// 抓不到）。`params()` 因此先铺 `extra` 再插基础键。这里直接构造 `extra`
    /// （绕过 `with_param`，免得 `debug_assert!` 在测试里先炸）。
    #[test]
    fn base_keys_win_over_a_shadowing_extra_entry() {
        let mut extra = BTreeMap::new();
        extra.insert("reason".to_string(), "not_a_catalog_key".to_string());
        extra.insert("value".to_string(), "expected value at line 1".to_string());

        for error in [
            LlmError::Config {
                reason: "missing_base_url".to_string(),
                extra: extra.clone(),
            },
            LlmError::BadResponse {
                reason: "parse_failed".to_string(),
                extra: extra.clone(),
            },
            LlmError::Deserialize {
                reason: "validation_failed".to_string(),
                extra,
            },
        ] {
            let params = error.params();
            assert_ne!(
                params["reason"], "not_a_catalog_key",
                "extra 顶掉了基础键 reason：{params:?}"
            );
            assert_eq!(params["value"], "expected value at line 1", "{params:?}");
            assert_eq!(params.len(), 2, "{params:?}");
        }
    }

    /// G-3.2：库原文当 `value` 时按**字符**截断到 200。
    ///
    /// serde 在类型不匹配时会引用输入片段（`invalid type: string "…", expected u32`），
    /// 长度无上界，因此必须限长；按字节切会把 UTF-8 序列切碎，所以用 `chars().take()`。
    #[test]
    fn library_reason_truncates_to_200_chars_not_bytes() {
        let short = library_reason(&"expected value at line 1");
        assert_eq!(short, "expected value at line 1");

        let long_ascii = "x".repeat(MAX_LIBRARY_REASON_CHARS + 50);
        let truncated = library_reason(&long_ascii);
        assert_eq!(truncated.chars().count(), MAX_LIBRARY_REASON_CHARS);
        assert_eq!(
            truncated.len(),
            MAX_LIBRARY_REASON_CHARS,
            "ASCII 下字符数 == 字节数"
        );

        // 多字节：截断到 200 个**字符**（600 字节），且结果仍是合法 UTF-8
        // （`String` 类型本身就保证了这一点——按字节切会 panic 或产出非法串）
        let long_cjk = "长".repeat(MAX_LIBRARY_REASON_CHARS + 50);
        let truncated = library_reason(&long_cjk);
        assert_eq!(truncated.chars().count(), MAX_LIBRARY_REASON_CHARS);
        assert_eq!(truncated.len(), MAX_LIBRARY_REASON_CHARS * 3);
        assert!(truncated.chars().all(|ch| ch == '长'));
    }

    /// `Display` / `Error` / `From` 改成手写之后原有语义仍在：
    /// `?` / `Box<dyn Error>` / `From<TransportError>`。
    #[test]
    fn llm_error_is_a_std_error_and_converts_from_transport() {
        fn as_std_error(error: &dyn std::error::Error) -> String {
            error.to_string()
        }
        let from_transport: LlmError = TransportError::Timeout.into();
        assert!(matches!(
            from_transport,
            LlmError::Transport(TransportError::Timeout)
        ));
        assert_eq!(
            as_std_error(&from_transport),
            "llm/transport reason=timeout"
        );
    }
}

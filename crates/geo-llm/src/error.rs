//! LLM 层错误：稳定 `code` + 语言中立 `params`。
//!
//! 约定（见 AGENTS.md）：后端不产出自然语言，文案由前端词典按当前语言渲染；
//! API Key 与完整回答正文都不得出现在错误信息里，`params` 也不例外。
//!
//! `Display` 是**日志格式**（`"{code} {k}={v} …"`），与 `GeoError::Display`、
//! 壳里 `IpcError::with_params` 的兜底文案逐字同构，不是给人读的句子。
//!
//! `Config` 的 `reason` 取 reason key 目录里的 key（目录是
//! `crates/geo-domain/src/error.rs` 模块注释里那张表）：`missing_base_url` /
//! `missing_model` / `unknown_provider` / `parse_failed`，配套参数一律装 `value`。

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
    /// 上游响应不可用（不是合法 JSON、缺 choices）。`reason` 是一段说明，
    /// **不含**响应正文。
    BadResponse(String),
    /// 带错误说明追问一次后，结构仍不符合预期。
    Deserialize(String),
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

    /// 链式追加一个语言中立参数，落进 `Config` 的 `extra`。
    ///
    /// 与 `GeoError::with_param` 同语义（含 Task 3 的 M-1 守卫）：两类误用都在 debug
    /// 构建里 `debug_assert!` 炸出来，因为它们都是**静默**的——`code()` 照常、
    /// `Display` 照印、没有任何报警。
    pub fn with_param(self, key: &str, value: impl fmt::Display) -> Self {
        let value = value.to_string();
        match self {
            Self::Config { reason, mut extra } => {
                debug_assert!(
                    key != "reason",
                    "llm/config 的基础键 reason 由变体字段提供，不能被 extra 覆盖（收到 {key}）"
                );
                extra.insert(key.to_string(), value);
                Self::Config { reason, extra }
            }
            other @ (Self::Transport(_)
            | Self::RateLimited
            | Self::Server { .. }
            | Self::BadResponse(_)
            | Self::Deserialize(_)
            | Self::MissingSecret) => {
                // panic 信息里只打 `code()`：`Debug` 输出**不经 `redact`**，
                // `Transport` / `BadResponse` 可能夹带疑似 Key 的片段（AGENTS 规则 3）。
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
            Self::BadResponse(_) => "llm/bad_response",
            Self::Deserialize(_) => "llm/deserialize",
            Self::MissingSecret => "llm/missing_secret",
        }
    }

    /// 语言中立参数，键名由 `contracts/error-codes.json` 冻结：
    /// `Config` → `{reason} ∪ extra`、`Transport` → `{reason}`（三个稳定 key 之一）、
    /// `Server` → `{status}`、`BadResponse` / `Deserialize` → `{reason}`、
    /// `RateLimited` / `MissingSecret` → 空。
    ///
    /// 这是 `code` 之外唯一的真值源：`Display` 与壳里的
    /// `From<LlmError> for IpcError` 都复用它，不再各拼一份。
    pub fn params(&self) -> BTreeMap<String, String> {
        let mut params = BTreeMap::new();
        match self {
            Self::Config { reason, extra } => {
                params.insert("reason".to_string(), reason.clone());
                params.extend(
                    extra
                        .iter()
                        .map(|(key, value)| (key.clone(), value.clone())),
                );
            }
            Self::Transport(error) => {
                params.insert("reason".to_string(), error.reason_key().to_string());
            }
            Self::Server { status } => {
                params.insert("status".to_string(), status.to_string());
            }
            Self::BadResponse(reason) | Self::Deserialize(reason) => {
                params.insert("reason".to_string(), reason.clone());
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
                LlmError::BadResponse("empty_choices".into()),
                "llm/bad_response",
            ),
            (
                LlmError::Deserialize("missing_field".into()),
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

        // `llm/bad_response` / `llm/deserialize` 收缩成 `["reason"]`：站点没有上游原文，
        // 把响应体塞进错误也违反「错误里不得出现完整回答正文」
        assert_eq!(
            LlmError::BadResponse("empty_choices".into()).params(),
            expected(&[("reason", "empty_choices")])
        );
        assert_eq!(
            LlmError::Deserialize("missing_field".into()).params(),
            expected(&[("reason", "missing_field")])
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

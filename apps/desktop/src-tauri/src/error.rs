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

/// 壳内直接用字面量发出的错误码。
///
/// 这些 code 不来自任何下游 crate 的 `code()`，只有壳自己知道，因此在这里定义一次、
/// 生产发射点与本文件测试模块的清单断言共用同一份常量：改了发射点的字面量，
/// `contracts/error-codes.json` 的断言会跟着炸，不会悄悄漏掉已冻结的契约。
/// 字符串值必须与 `contracts/error-codes.json` 里的 `code` 逐字一致。
pub(crate) mod err_codes {
    /// 内容命中广告法红线词（`services/prompt_service.rs`）。
    pub(crate) const COMPLIANCE_VIOLATION: &str = "compliance/violation";
    /// 整站抓取一页都没抓到（`services/entity_card_service.rs`）。
    pub(crate) const CRAWLER_EMPTY: &str = "crawler/empty";
    /// 模型配置缺失或非法（`state.rs`、`services/settings_service.rs`）。
    pub(crate) const LLM_CONFIG: &str = "llm/config";
    /// CSV 导入没有任何有效条目（`services/prompt_service.rs`）。
    pub(crate) const PROMPT_SET_EMPTY_IMPORT: &str = "prompt_set/empty_import";
    /// 壳内错误，见 [`super::IpcError::internal`]。
    pub(crate) const IPC_INTERNAL: &str = "ipc/internal";
}

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
        Self::new(err_codes::IPC_INTERNAL, message)
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
    use std::collections::HashSet;
    use std::io;

    /// 前后端共享的错误码真值源：`contracts/error-codes.json`。
    ///
    /// 用 `include_str!` 而不是运行时读盘——清单缺了就在编译期炸掉，
    /// 比 CI 里报「文件找不到」更早、更明确。目前只有测试消费它，
    /// 所以放在 `#[cfg(test)]` 里免得非测试构建报 dead_code；
    /// 等出现生产侧消费者（例如把清单塞进诊断信息）再上提到模块级。
    const ERROR_CATALOG: &str = include_str!("../../../../contracts/error-codes.json");

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

    // -----------------------------------------------------------------
    // `contracts/error-codes.json`：前后端共享的错误码真值源。
    //
    // Plan A 把后端错误改成 `code + params`、文案交给前端词典（spec §4.2），
    // 因此「后端会发出哪些 code」必须是**一份**清单，两侧都拿它做完整性断言：
    // Rust 侧是下面这四个用例（发射点穷举 + 清单自身形状），TS 侧是
    // `apps/desktop/ui/src/i18n/error-codes.test.ts`。新增 code 只改 JSON，
    // 两侧测试会同时提醒补词典与补发射点。
    // -----------------------------------------------------------------

    /// 仓库里实际用到的 `{kind}/not_found` 具体化。
    ///
    /// `GeoError::code()` 与 `StoreError::code()` 都是 `format!("{kind}/not_found")`
    /// 动态拼出来的，所以清单里必须逐个落地。取值来自
    /// `rg 'not_found\("' apps crates` 的实际调用点。
    const NOT_FOUND_KINDS: [&str; 5] = [
        "project",
        "entity_card",
        "prompt_set",
        "prompt_item",
        "competitor",
    ];

    fn llm_variants() -> Vec<LlmError> {
        vec![
            LlmError::Config("missing_base_url".into()),
            LlmError::Transport(TransportError::Timeout),
            LlmError::RateLimited,
            LlmError::Server { status: 500 },
            LlmError::BadResponse("empty_choices".into()),
            LlmError::Deserialize("missing_field".into()),
            LlmError::MissingSecret,
        ]
    }

    fn crawler_variants() -> Vec<CrawlerError> {
        vec![
            CrawlerError::Blocked {
                url: "https://a.example/x".into(),
                reason: "robots".into(),
            },
            CrawlerError::Timeout {
                url: "https://a.example/x".into(),
            },
            CrawlerError::Network("HTTP 500".into()),
            CrawlerError::TooLarge {
                url: "https://a.example/x".into(),
            },
            CrawlerError::InvalidUrl("abc".into()),
            CrawlerError::Decode("非法字节".into()),
        ]
    }

    /// `StoreError` 的全部 7 个变体。`Sqlx` 用 `RowNotFound` 造（不碰数据库、不联网），
    /// 它不满足 `is_unique_violation`，因此映射到 `io/failed`；唯一约束那条分支产出的是
    /// `state/conflict`，与 `StoreError::conflict` 同码，由 `store_code` 的 match 臂覆盖类型。
    fn store_variants() -> Vec<StoreError> {
        vec![
            StoreError::not_found("project", "x"),
            StoreError::validation("brand_name", "required"),
            StoreError::conflict("duplicate"),
            StoreError::Sqlx(sqlx::Error::RowNotFound),
            StoreError::Serde(serde_json::from_str::<u8>("nope").unwrap_err()),
            StoreError::secret("keyring unavailable"),
            StoreError::Io(io::Error::other("磁盘满")),
        ]
    }

    // -----------------------------------------------------------------
    // 编译器强制的穷举守卫。
    //
    // 下面四个 `match` **没有 `_` 兜底**：给任何一个错误类型加变体，这里立刻
    // `E0004 non-exhaustive patterns` 编译失败，逼实现者把新 code 补进已冻结的
    // `contracts/error-codes.json`（以及 Task 7 的双语词典）。它们不是装饰性断言：
    // 每个函数都真的产出 code 交给清单断言，所以「漏变体」和「漏登记」都会红。
    // 编译器管不到的只有 `{kind}/not_found` 的 kind（运行期字符串），
    // 由 `NOT_FOUND_KINDS` 显式列举。
    // -----------------------------------------------------------------

    fn llm_code(error: &LlmError) -> &'static str {
        match error {
            LlmError::Config(_)
            | LlmError::Transport(_)
            | LlmError::RateLimited
            | LlmError::Server { .. }
            | LlmError::BadResponse(_)
            | LlmError::Deserialize(_)
            | LlmError::MissingSecret => error.code(),
        }
    }

    fn crawler_code(error: &CrawlerError) -> &'static str {
        match error {
            CrawlerError::Blocked { .. }
            | CrawlerError::Timeout { .. }
            | CrawlerError::Network(_)
            | CrawlerError::TooLarge { .. }
            | CrawlerError::InvalidUrl(_)
            | CrawlerError::Decode(_) => error.code(),
        }
    }

    fn geo_code(error: &GeoError) -> String {
        match error {
            GeoError::Validation { .. }
            | GeoError::NotFound { .. }
            | GeoError::Conflict { .. }
            | GeoError::Config { .. }
            | GeoError::Upstream { .. }
            | GeoError::Io(_)
            | GeoError::Serde(_) => error.code(),
        }
    }

    fn store_code(error: &StoreError) -> String {
        match error {
            StoreError::NotFound { .. }
            | StoreError::Validation { .. }
            | StoreError::Conflict(_)
            | StoreError::Sqlx(_)
            | StoreError::Serde(_)
            | StoreError::Secret(_)
            | StoreError::Io(_) => error.code(),
        }
    }

    /// 解析共享清单，返回其中登记的 code 集合。
    fn catalog() -> HashSet<String> {
        let parsed: serde_json::Value = serde_json::from_str(ERROR_CATALOG).expect("清单可解析");
        parsed["codes"]
            .as_array()
            .expect("codes 是数组")
            .iter()
            .map(|entry| {
                entry["code"]
                    .as_str()
                    .expect("每条都要有字符串 code")
                    .to_string()
            })
            .collect()
    }

    #[test]
    fn every_code_the_backend_emits_is_in_the_shared_catalog() {
        let known = catalog();
        let emitted = vec![
            IpcError::from(GeoError::not_found("project", "x")).code,
            IpcError::from(GeoError::validation("brand_name", "required")).code,
            IpcError::from(LlmError::MissingSecret).code,
            IpcError::from(StoreError::Conflict("dup".into())).code,
            IpcError::from(CrawlerError::Timeout { url: "u".into() }).code,
            IpcError::internal("boom").code,
        ];
        for code in emitted {
            assert!(
                known.contains(code.as_str()),
                "{code} 不在 contracts/error-codes.json 里"
            );
        }
    }

    /// 穷举：每个错误变体的 code（含跨 crate 转成 `GeoError` 后带上的
    /// `upstream/` 前缀）都必须在清单里，否则前端词典不可能覆盖到它。
    /// 变体清单由上面四个无兜底 `match` 强制，加变体即编译失败。
    #[test]
    fn catalog_covers_every_variant_of_every_error_type() {
        let known = catalog();
        let mut emitted: Vec<String> = Vec::new();

        // LLM / 抓取：直接转 IpcError 用 `code()`，先转 GeoError 则套 `upstream/`。
        // code 一律经无兜底 match 取出，不用 `e.code()` 直调。
        let llm = llm_variants();
        let crawler = crawler_variants();
        emitted.extend(llm.iter().map(|error| llm_code(error).to_string()));
        emitted.extend(crawler.iter().map(|error| crawler_code(error).to_string()));
        emitted.extend(llm.into_iter().map(|e| geo_code(&GeoError::from(e))));
        emitted.extend(crawler.into_iter().map(|e| geo_code(&GeoError::from(e))));

        // 领域层：除 NotFound（kind 是运行期字符串，走下面的循环）外逐个变体过一遍
        let geo_cases = [
            GeoError::validation("brand_name", "required"),
            GeoError::conflict("duplicate"),
            GeoError::config("missing_base_url"),
            GeoError::upstream("llm/server", "HTTP 503"),
            GeoError::Io(io::Error::other("磁盘满")),
            GeoError::Serde(serde_json::from_str::<u8>("nope").unwrap_err()),
        ];
        emitted.extend(geo_cases.iter().map(geo_code));

        // 存储层：7 个变体逐个过一遍（含 Sqlx / Serde / Secret / Io）
        emitted.extend(store_variants().iter().map(store_code));

        // 动态的 `{kind}/not_found`：GeoError 与 StoreError 两条路都要在清单里
        for kind in NOT_FOUND_KINDS {
            emitted.push(geo_code(&GeoError::not_found(kind, "x")));
            emitted.push(store_code(&StoreError::not_found(kind, "x")));
        }

        // 壳内直接用字面量构造的 code：断言的是发射点共用的那份 `err_codes` 常量，
        // 不是在这里重打一遍字符串——改了发射点，这条断言跟着变。
        let shell_codes = [
            err_codes::COMPLIANCE_VIOLATION,
            err_codes::PROMPT_SET_EMPTY_IMPORT,
            err_codes::CRAWLER_EMPTY,
            err_codes::LLM_CONFIG,
            err_codes::IPC_INTERNAL,
        ];
        emitted.extend(
            shell_codes
                .into_iter()
                .map(|code| IpcError::new(code, "x").code),
        );

        for code in &emitted {
            assert!(
                known.contains(code.as_str()),
                "{code} 不在 contracts/error-codes.json 里"
            );
        }
    }

    /// 前端专属的码（`ipc/internal` 除外，它由 `IpcError::internal` 发出）：
    /// `ipc/invoke_failed` 由 `invoke` 自身 reject 时发出、
    /// `ipc/unknown_command` 由 demo 后端的运行时守卫发出（均为 Plan A 后续 task），
    /// `ipc/unknown` 是 `IpcRequestError` 在 payload.code 为空串时的兜底
    /// （`src/api/client.ts`，今天已存在）。Rust 侧都没有发射点，属预期，
    /// 但清单必须先收着，免得后面再改一次契约。
    #[test]
    fn catalog_reserves_the_frontend_only_ipc_codes() {
        let known = catalog();
        for code in [
            err_codes::IPC_INTERNAL,
            "ipc/invoke_failed",
            "ipc/unknown",
            "ipc/unknown_command",
        ] {
            assert!(
                known.contains(code),
                "{code} 不在 contracts/error-codes.json 里"
            );
        }
    }

    /// 与 TS 侧 `CODE_SHAPE = /^[a-z_]+(?:\/[a-z_]+)+$/` 等价：至少两段、
    /// 每段非空且只含小写字母与下划线。壳里没有 `regex` 依赖，因此手写判定；
    /// 三个辅助函数是 TS 那两条正则的逐字移植，改动必须两侧同步。
    fn matches_code_shape(code: &str) -> bool {
        let mut segments = code.split('/');
        let head_ok = segments.next().is_some_and(is_name_segment);
        let tail: Vec<&str> = segments.collect();
        head_ok && !tail.is_empty() && tail.iter().all(|segment| is_name_segment(segment))
    }

    /// 与 TS 侧 `PARAM_SHAPE = /^[a-z][a-z_]*$/` 等价：首字符是小写字母，其余小写字母或下划线。
    fn matches_param_shape(param: &str) -> bool {
        let mut chars = param.chars();
        chars.next().is_some_and(|ch| ch.is_ascii_lowercase())
            && chars.all(|ch| ch.is_ascii_lowercase() || ch == '_')
    }

    fn is_name_segment(segment: &str) -> bool {
        !segment.is_empty()
            && segment
                .chars()
                .all(|ch| ch.is_ascii_lowercase() || ch == '_')
    }

    /// 清单自身形状：按 code 升序（顺带排除重复）、code 与 param 名都匹配 TS 侧同一套正则、
    /// 每条都有非空 note 说明它从哪儿发出。TS 侧 `error-codes.test.ts` 断言同一套形状。
    #[test]
    fn catalog_is_sorted_unique_and_well_formed() {
        let parsed: serde_json::Value = serde_json::from_str(ERROR_CATALOG).expect("清单可解析");
        let entries = parsed["codes"].as_array().expect("codes 是数组");
        assert!(!entries.is_empty(), "清单不能为空");

        let mut previous: Option<&str> = None;
        for entry in entries {
            let code = entry["code"]
                .as_str()
                .unwrap_or_else(|| panic!("{entry} 缺 code"));
            assert!(
                matches_code_shape(code),
                "code 要匹配 TS 侧的 CODE_SHAPE /^[a-z_]+(?:\\/[a-z_]+)+$/：{code:?}"
            );

            let params = entry["params"]
                .as_array()
                .unwrap_or_else(|| panic!("{code} 的 params 必须是数组"));
            for param in params {
                let name = param
                    .as_str()
                    .unwrap_or_else(|| panic!("{code} 的 params 必须都是字符串"));
                assert!(
                    matches_param_shape(name),
                    "{code} 的 param 名要匹配 TS 侧的 PARAM_SHAPE /^[a-z][a-z_]*$/：{name:?}"
                );
            }

            assert!(
                entry["note"].as_str().is_some_and(|note| !note.is_empty()),
                "{code} 缺 note：要说清它从哪儿发出、params 从哪来"
            );

            if let Some(previous) = previous {
                assert!(
                    previous < code,
                    "清单要按 code 升序排列且不得重复：{previous} 之后是 {code}"
                );
            }
            previous = Some(code);
        }
    }
}

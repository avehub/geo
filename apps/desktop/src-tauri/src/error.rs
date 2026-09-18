//! IPC 边界的错误契约。
//!
//! 前端认三样东西：稳定的 `code`（用于分支处理，例如 `llm/missing_secret`
//! 就去引导用户填 Key）、语言中立的 `params`（`field` / `id` / `status` …，
//! 供词典按当前语言插值，参数名由冻结的 `contracts/error-codes.json` 登记）
//! 与兜底 `message`（词典未命中时展示、以及打日志用，不承诺任何语言的散文）。
//! 因此所有 crate 的错误都在这一层收敛成 [`IpcError`]，不允许把内部错误类型
//! 直接抛给 WebView。
//!
//! 这里还是密钥防泄漏的**最后一道关**：即便上游把 API Key 拼进了错误信息或
//! 参数值，[`redact`] 也会在送出前把它抹成 `***`。

use geo_crawler::CrawlerError;
use geo_domain::GeoError;
use geo_llm::LlmError;
use geo_store::StoreError;
use serde::Serialize;
use std::collections::BTreeMap;

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
    /// 语言中立参数：键是稳定标识符（snake_case），值是原始值，都不是散文。
    /// 每个 code 能带哪些键由 `contracts/error-codes.json` 冻结。
    /// 用 `BTreeMap` 而不是 `HashMap`：序列化顺序稳定，快照与日志可比对。
    pub params: BTreeMap<String, String>,
    pub message: String,
    pub detail: Option<serde_json::Value>,
}

impl IpcError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            params: BTreeMap::new(),
            message: redact(&message.into()),
            detail: None,
        }
    }

    /// 带语言中立参数构造。参数名必须来自 `contracts/error-codes.json` 里该
    /// code 登记的 `params`，值一律原样透传（不得是句子）。
    ///
    /// `message` 用紧凑日志格式 `"{code} {k}={v} …"` 兜底：它不含任何自然语言，
    /// 因此前端切语言时不会露出另一种语言的散文；词典命中时前端根本不用它。
    /// 该格式与 `GeoError::Display` 逐字同构（Task 3 已落地），因此
    /// `From<GeoError>` 直接委托 `Self::with_params(error.code(), error.params())`。
    pub fn with_params(
        code: impl Into<String>,
        params: impl IntoIterator<Item = (impl Into<String>, impl Into<String>)>,
    ) -> Self {
        let code = code.into();
        // 先收成 BTreeMap：兜底文案的键序因此稳定，日志与快照可比对
        let params: BTreeMap<String, String> = params
            .into_iter()
            .map(|(key, value)| (key.into(), value.into()))
            .collect();
        let mut message = code.clone();
        for (key, value) in &params {
            message.push(' ');
            message.push_str(key);
            message.push('=');
            message.push_str(value);
        }
        params
            .into_iter()
            .fold(Self::new(code, message), |error, (key, value)| {
                error.with_param(key, value)
            })
    }

    /// 追加一个参数。**这是 `params` 唯一的写入口**，值一律过 [`redact`]：
    /// params 是新增的出口，密钥不能从这里绕开最后一关直达 WebView（AGENTS 规则 3）。
    pub fn with_param(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.params.insert(key.into(), redact(&value.into()));
        self
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
        // `with_params` 造的兜底 message 已以 code 开头，再套前缀会重复成
        // `[validation/failed] validation/failed field=…`；那种情况只写 message。
        // 散文 message（`new` / `From` 四实现）仍以 `[code] ` 打头，日志靠它认码。
        if self.message.starts_with(&self.code) {
            f.write_str(&self.message)
        } else {
            write!(f, "[{}] {}", self.code, self.message)
        }
    }
}

impl std::error::Error for IpcError {}

// 下面三个 `From` 各自就地拼 params：键名一律逐字取自冻结的
// `contracts/error-codes.json`（测试 `params_keys_stay_inside_the_shared_catalog`
// 穷举核对），值原样透传，`match` 都不写 `_` 兜底——下游加变体这里立刻编译失败，
// 逼实现者当场决定新变体带哪些键（与本文件测试模块的穷举守卫同一思路）。
// 部分值今天仍是中文散文（`CrawlerError::Network` / `InvalidUrl` 那段
// 合并文本）：拆变体是 Task 4 的活，本层只负责把管道接通。
//
// **这三份映射是临时的**（控制器裁定）：Task 2 不为「将来好改」提前抽共享 helper，
// Task 4 把它们换成委托各自的 `params()` 并删掉整个 match——同一映射存在两份必然漂移。

// `From<GeoError>` 已经收编（Task 3）：领域层自己产出 `params()`，这里只做委托。
impl From<GeoError> for IpcError {
    fn from(error: GeoError) -> Self {
        Self::with_params(error.code(), error.params())
    }
}

impl From<StoreError> for IpcError {
    fn from(error: StoreError) -> Self {
        let ipc = Self::new(error.code(), error.to_string());
        // Task 4 删除点：改成 `Self::with_params(error.code(), error.params())`
        // `Sqlx` 按 code() 落到 state/conflict 或 io/failed，两者登记的都是 reason，
        // 因此这里不必重复 geo-store 私有的唯一约束判定。
        match error {
            StoreError::NotFound { kind, id } => ipc.with_param("kind", kind).with_param("id", id),
            StoreError::Validation { field, reason } => {
                ipc.with_param("field", field).with_param("reason", reason)
            }
            StoreError::Conflict(reason) => ipc.with_param("reason", reason),
            StoreError::Sqlx(sqlx_error) => ipc.with_param("reason", sqlx_error.to_string()),
            StoreError::Serde(serde_error) => ipc.with_param("reason", serde_error.to_string()),
            StoreError::Secret(reason) => ipc.with_param("reason", reason),
            StoreError::Io(io_error) => ipc.with_param("reason", io_error.to_string()),
        }
    }
}

impl From<LlmError> for IpcError {
    fn from(error: LlmError) -> Self {
        let ipc = Self::new(error.code(), error.user_message());
        // Task 4 删除点：改成 `Self::with_params(error.code(), error.params())`
        // rate_limited / missing_secret 在清单里 params 是空数组，一个键都不塞；
        // bad_response / deserialize 登记的 upstream 要等 Task 4 拆变体才填得上。
        match error {
            LlmError::Config(reason) => ipc.with_param("reason", reason),
            LlmError::Transport(transport_error) => {
                ipc.with_param("reason", transport_error.to_string())
            }
            LlmError::RateLimited | LlmError::MissingSecret => ipc,
            LlmError::Server { status } => ipc.with_param("status", status.to_string()),
            LlmError::BadResponse(reason) => ipc.with_param("reason", reason),
            LlmError::Deserialize(reason) => ipc.with_param("reason", reason),
        }
    }
}

impl From<CrawlerError> for IpcError {
    fn from(error: CrawlerError) -> Self {
        let ipc = Self::new(error.code(), error.user_message());
        // Task 4 删除点：改成 `Self::with_params(error.code(), error.params())`
        // 本 match 有 3 个 code 今天只能填清单键的**子集**，Task 4 拆变体后补齐
        // 并把断言从子集收紧成相等：
        // - `crawler/network`：变体 `Network(String)` 只有一段合并文本，实发 `reason`，
        //   缺清单登记的 `url`、`status`。
        // - `crawler/too_large`：变体 `TooLarge { url }` 没有 limit 字段，实发 `url`，缺 `limit`。
        // - `crawler/invalid_url`：变体 `InvalidUrl(String)` 装的同样是合并文本
        //   （`fetch.rs` 的代理地址那句、`extract.rs` 的 `url（error）`），因此落 `reason`
        //   而不是 `url`——与 `Network` / `Decode` 一致；实发 `reason`，缺 `url`。
        match error {
            CrawlerError::Blocked { url, reason } => {
                ipc.with_param("url", url).with_param("reason", reason)
            }
            CrawlerError::Timeout { url } => ipc.with_param("url", url),
            CrawlerError::Network(reason) => ipc.with_param("reason", reason),
            CrawlerError::TooLarge { url } => ipc.with_param("url", url),
            CrawlerError::InvalidUrl(reason) => ipc.with_param("reason", reason),
            CrawlerError::Decode(reason) => ipc.with_param("reason", reason),
        }
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
    use std::collections::{HashMap, HashSet};
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

    /// 与 Task 2 的 `…_reason_params` 区分：这条钉的是**兜底文案**。
    /// Task 3 之后它是紧凑日志格式（与 `GeoError::Display` 逐字同构），不再是中文散文。
    #[test]
    fn validation_error_carries_field_and_reason_message() {
        let error = IpcError::from(GeoError::validation("brand_name", "required"));
        assert_eq!(error.code, "validation/failed");
        assert_eq!(
            error.message,
            "validation/failed field=brand_name reason=required"
        );
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
        let error = IpcError::from(GeoError::conflict("duplicate"));
        let json = serde_json::to_value(&error).expect("可序列化");
        assert_eq!(json["code"], "state/conflict");
        assert_eq!(json["params"], serde_json::json!({ "reason": "duplicate" }));
        assert_eq!(json["message"], "state/conflict reason=duplicate");
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
        // params 是新增的出口，同样不得夹带 Key（AGENTS 规则 3）
        let upstream = leaked
            .params
            .get("upstream")
            .expect("upstream/* 带 upstream 参数");
        assert!(!upstream.contains("sk-abc123XYZ_-9"), "{upstream}");
        assert!(!upstream.contains("sk-second0000"), "{upstream}");
        assert!(upstream.contains("***"), "{upstream}");
    }

    #[test]
    fn redaction_leaves_ordinary_text_alone() {
        let error = IpcError::from(GeoError::config("missing_base_url"));
        assert_eq!(error.code, "config/invalid");
        assert_eq!(error.params["reason"], "missing_base_url");
        // 兜底文案是紧凑日志格式：不含自然语言，也没被 redact 误伤
        assert_eq!(error.message, "config/invalid reason=missing_base_url");
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

    /// `GeoError` 的代表性用例：除 `NotFound`（kind 是运行期字符串，由
    /// `NOT_FOUND_KINDS` 显式列举）外每个变体各一条。
    fn geo_cases() -> Vec<GeoError> {
        vec![
            GeoError::validation("brand_name", "required"),
            GeoError::conflict("duplicate"),
            GeoError::config("missing_base_url"),
            GeoError::upstream("llm/server", "HTTP 503"),
            GeoError::Io(io::Error::other("磁盘满")),
            GeoError::Serde(serde_json::from_str::<u8>("nope").unwrap_err()),
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
        emitted.extend(geo_cases().iter().map(geo_code));

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

    // -----------------------------------------------------------------
    // 语言中立 `params`（spec §4.2）。
    //
    // Plan A 的错误契约是「稳定 code + 语言中立 params」，文案由前端词典按当前
    // 语言渲染。因此下面只断言 `code` 与 `params` 的形状与取值，**不断言
    // `message` 的中文散文**——Task 3 会把 Display 改成紧凑日志格式，
    // 现在钉住的散文到时候必然全红。
    // -----------------------------------------------------------------

    /// 共享清单里每个 code 登记的 params 名（`contracts/error-codes.json`）。
    fn catalog_params() -> HashMap<String, Vec<String>> {
        let parsed: serde_json::Value = serde_json::from_str(ERROR_CATALOG).expect("清单可解析");
        parsed["codes"]
            .as_array()
            .expect("codes 是数组")
            .iter()
            .map(|entry| {
                let code = entry["code"]
                    .as_str()
                    .expect("每条都要有字符串 code")
                    .to_string();
                let params = entry["params"]
                    .as_array()
                    .expect("params 是数组")
                    .iter()
                    .map(|param| param.as_str().expect("params 必须都是字符串").to_string())
                    .collect();
                (code, params)
            })
            .collect()
    }

    #[test]
    fn not_found_error_carries_kind_and_id_params() {
        let error = IpcError::from(GeoError::not_found("project", "abc"));
        assert_eq!(error.code, "project/not_found");
        assert_eq!(error.params["kind"], "project");
        assert_eq!(error.params["id"], "abc");
        assert_eq!(error.params.len(), 2);

        let stored = IpcError::from(StoreError::not_found("prompt_set", "set-1"));
        assert_eq!(stored.code, "prompt_set/not_found");
        assert_eq!(stored.params["kind"], "prompt_set");
        assert_eq!(stored.params["id"], "set-1");
        assert_eq!(stored.params.len(), 2);
    }

    #[test]
    fn validation_error_carries_field_and_reason_params() {
        let error = IpcError::from(GeoError::validation("brand_name", "required"));
        assert_eq!(error.code, "validation/failed");
        assert_eq!(error.params["field"], "brand_name");
        assert_eq!(error.params["reason"], "required");
        assert_eq!(error.params.len(), 2);

        let stored = IpcError::from(StoreError::validation("domain", "invalid_url"));
        assert_eq!(stored.params["field"], "domain");
        assert_eq!(stored.params["reason"], "invalid_url");
        assert_eq!(stored.params.len(), 2);
    }

    /// Task 3：`From<GeoError>` 委托 `GeoError::params()`，壳内不再自己拼一份映射
    /// （同一映射存在两份必然漂移）。逐键相等，含 `extra` 带出来的键。
    #[test]
    fn geo_error_conversion_delegates_params_including_extra() {
        let geo = GeoError::validation("brand_name", "too_long").with_param("limit", 60);
        let expected = geo.params();
        assert_eq!(expected.len(), 3);

        let error = IpcError::from(geo);
        assert_eq!(error.code, "validation/failed");
        assert_eq!(
            error.params, expected,
            "壳内 params 必须逐键等于 GeoError::params()"
        );
        // 兜底文案与 `GeoError::Display` 逐字同构（都是紧凑日志格式）
        assert!(error.message.starts_with("validation/failed "), "{error}");
        assert!(error.message.contains("limit=60"), "{error}");
    }

    #[test]
    fn llm_and_crawler_params_follow_the_contract() {
        let server = IpcError::from(LlmError::Server { status: 500 });
        assert_eq!(server.code, "llm/server");
        assert_eq!(server.params["status"], "500");
        assert_eq!(server.params.len(), 1);

        // 清单里这两条的 params 是空数组，就不能凭空塞 key
        for error in [LlmError::RateLimited, LlmError::MissingSecret] {
            let ipc = IpcError::from(error);
            assert!(ipc.params.is_empty(), "{} 不该带 params", ipc.code);
        }

        let timeout = IpcError::from(CrawlerError::Timeout {
            url: "https://a.example/x".into(),
        });
        assert_eq!(timeout.code, "crawler/timeout");
        assert_eq!(timeout.params["url"], "https://a.example/x");
        assert_eq!(timeout.params.len(), 1);

        let blocked = IpcError::from(CrawlerError::Blocked {
            url: "https://a.example/x".into(),
            reason: "robots".into(),
        });
        assert_eq!(blocked.params["url"], "https://a.example/x");
        assert_eq!(blocked.params["reason"], "robots");
        assert_eq!(blocked.params.len(), 2);

        // `InvalidUrl(String)` 装的是合并文本（`fetch.rs` 的代理地址那句、
        // `extract.rs` 的 `url（error）`），不是裸 URL，因此落 `reason`——
        // 与同样装合并文本的 `Network` / `Decode` 对齐。清单给该 code 登记了
        // `["url","reason"]`，只发 `reason` 是合法子集，缺的 `url` 由 Task 4 拆变体补。
        let invalid_url = IpcError::from(CrawlerError::InvalidUrl("not a url".into()));
        assert_eq!(invalid_url.code, "crawler/invalid_url");
        assert_eq!(invalid_url.params["reason"], "not a url");
        assert!(
            !invalid_url.params.contains_key("url"),
            "合并文本不能冒充裸 URL：{:?}",
            invalid_url.params
        );
        assert_eq!(invalid_url.params.len(), 1);
    }

    /// 跨 crate 转成 `GeoError::Upstream` 后，params 换成包装族的那两个键
    /// （清单里 `upstream/*` 恒为 `["upstream_code","upstream"]`，与里层码的
    /// params 不相交，前端只能走共享包装键渲染）。
    #[test]
    fn upstream_conversion_wraps_code_and_raw_text() {
        let error = IpcError::from(GeoError::from(LlmError::Server { status: 503 }));
        assert_eq!(error.code, "upstream/llm/server");
        assert_eq!(error.params["upstream_code"], "llm/server");
        assert!(error.params.contains_key("upstream"));
        assert_eq!(error.params.len(), 2);

        let crawled = IpcError::from(GeoError::from(CrawlerError::Decode("非法字节".into())));
        assert_eq!(crawled.code, "upstream/crawler/decode");
        assert_eq!(crawled.params["upstream_code"], "crawler/decode");
        assert_eq!(crawled.params.len(), 2);
    }

    #[test]
    fn serialised_payload_includes_the_params_object() {
        let error = IpcError::from(GeoError::validation("brand_name", "required"));
        let json = serde_json::to_value(&error).expect("可序列化");
        assert_eq!(
            json["params"],
            serde_json::json!({ "field": "brand_name", "reason": "required" })
        );

        // 没有 params 时也要给出空对象，前端不必判空
        let empty = serde_json::to_value(IpcError::from(LlmError::RateLimited)).expect("可序列化");
        assert_eq!(empty["params"], serde_json::json!({}));
    }

    #[test]
    fn with_params_builds_a_language_neutral_error() {
        let error = IpcError::with_params(
            "validation/failed",
            [("field", "brand_name"), ("reason", "required")],
        );
        assert_eq!(error.code, "validation/failed");
        assert_eq!(error.params["field"], "brand_name");
        assert_eq!(error.params["reason"], "required");
        // 兜底文案是紧凑日志格式，不含任何自然语言散文
        assert!(error.message.starts_with("validation/failed"), "{error}");
        assert!(error.message.contains("field=brand_name"), "{error}");
        assert!(error.detail.is_none());
    }

    /// `with_params` 造的兜底 message 已以 code 开头，`Display` 不能再套一遍
    /// `[code] ` 前缀，否则日志里是 `[validation/failed] validation/failed field=…`。
    /// 普通 message 仍要保留前缀——日志靠它认码。两个分支都钉住。
    #[test]
    fn display_repeats_the_code_only_when_the_message_lacks_it() {
        let compact = IpcError::with_params(
            "validation/failed",
            [("field", "brand_name"), ("reason", "required")],
        );
        assert_eq!(
            compact.to_string(),
            "validation/failed field=brand_name reason=required"
        );

        let prose = IpcError::new(err_codes::CRAWLER_EMPTY, "no pages crawled");
        assert_eq!(prose.to_string(), "[crawler/empty] no pages crawled");
    }

    #[test]
    fn with_param_extends_an_existing_error_without_touching_its_message() {
        let error = IpcError::new(err_codes::CRAWLER_EMPTY, "no pages crawled")
            .with_param("domain", "a.example")
            .with_param("skipped", "https://a.example/admin");
        assert_eq!(error.message, "no pages crawled");
        assert_eq!(error.params["domain"], "a.example");
        assert_eq!(error.params["skipped"], "https://a.example/admin");
        assert_eq!(error.params.len(), 2);
    }

    #[test]
    fn param_values_are_redacted_before_reaching_the_frontend() {
        let error = IpcError::with_params("llm/config", [("reason", "sk-live-abc123 不可用")])
            .with_param("upstream", "Bearer sk-second9999");
        assert_eq!(error.params["reason"], "*** 不可用");
        assert_eq!(error.params["upstream"], "Bearer ***");
        assert!(
            !error.params.values().any(|value| value.contains("sk-")),
            "{:?}",
            error.params
        );
        assert!(
            !error.message.contains("sk-"),
            "兜底文案由 params 拼出，同样要脱敏：{}",
            error.message
        );
    }

    /// 穷举：每个错误变体转成 `IpcError` 后带的 params 键，都必须在共享清单里
    /// 该 code 的 `params` 数组内。清单是冻结的，因此这条断言把「后端凭空造
    /// 参数名」挡在编译期之后第一道测试里——前端词典按 params 名插值，
    /// 多一个没登记的键就是渲染出一个空占位符。
    ///
    /// 变体清单由上面四个无兜底 `match` 强制（加变体即编译失败）；
    /// 只断言「子集」而不是「相等」，因为部分变体今天携带的信息不足以填满清单
    /// （如 `CrawlerError::Network(String)` 拿不到独立的 url / status），
    /// 补齐属于 Task 4。
    #[test]
    fn params_keys_stay_inside_the_shared_catalog() {
        let allowed = catalog_params();
        let mut emitted: Vec<IpcError> = Vec::new();

        emitted.extend(llm_variants().into_iter().map(IpcError::from));
        emitted.extend(crawler_variants().into_iter().map(IpcError::from));
        emitted.extend(store_variants().into_iter().map(IpcError::from));
        emitted.extend(geo_cases().into_iter().map(IpcError::from));
        // 先转 GeoError::Upstream 的形态（upstream/{code}）
        emitted.extend(
            llm_variants()
                .into_iter()
                .map(|error| IpcError::from(GeoError::from(error))),
        );
        emitted.extend(
            crawler_variants()
                .into_iter()
                .map(|error| IpcError::from(GeoError::from(error))),
        );
        for kind in NOT_FOUND_KINDS {
            emitted.push(IpcError::from(GeoError::not_found(kind, "x")));
            emitted.push(IpcError::from(StoreError::not_found(kind, "x")));
        }
        // 壳内字面量站点：Task 5 才会逐个补 params，这里先保证 code 认得、键不越界
        emitted.push(IpcError::internal("boom"));
        emitted.extend(
            [
                err_codes::COMPLIANCE_VIOLATION,
                err_codes::PROMPT_SET_EMPTY_IMPORT,
                err_codes::CRAWLER_EMPTY,
                err_codes::LLM_CONFIG,
            ]
            .into_iter()
            .map(|code| IpcError::new(code, "x")),
        );

        assert!(!emitted.is_empty());
        // 防空跑：真有 params 被填出来，下面的「键不越界」才有意义
        let filled: usize = emitted.iter().map(|error| error.params.len()).sum();
        assert!(filled > 0, "没有任何错误带 params，这条断言等于没跑");
        for error in &emitted {
            let registered = allowed
                .get(&error.code)
                .unwrap_or_else(|| panic!("{} 不在 contracts/error-codes.json 里", error.code));
            for key in error.params.keys() {
                assert!(
                    registered.iter().any(|name| name == key),
                    "{} 的 params 带了清单外的键 {key}（清单登记：{registered:?}）",
                    error.code
                );
            }
        }
    }
}

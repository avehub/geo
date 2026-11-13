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

// 四个 `From` 一律委托下游自己的 `params()`：键名与取值都由各 crate 的错误类型单点
// 产出（`GeoError::params()` / `StoreError::params()` / `LlmError::params()` /
// `CrawlerError::params()`），本层只负责 `redact` 与紧凑兜底文案。
//
// Task 2 曾在这里就地拼三份映射，Task 4 按控制器裁定删掉整个 match——同一映射存在
// 两份必然漂移。「下游加变体这里立刻编译失败」的守卫职责移交给本文件测试模块的四个
// 无兜底 `match`（`llm_code` / `crawler_code` / `store_code` / `geo_code`），
// 「清单声明的 params 与实际发出的键集一致」由 `catalog_params_equal_the_emitted_union` 守。
impl From<GeoError> for IpcError {
    fn from(error: GeoError) -> Self {
        Self::with_params(error.code(), error.params())
    }
}

impl From<StoreError> for IpcError {
    fn from(error: StoreError) -> Self {
        Self::with_params(error.code(), error.params())
    }
}

impl From<LlmError> for IpcError {
    fn from(error: LlmError) -> Self {
        Self::with_params(error.code(), error.params())
    }
}

impl From<CrawlerError> for IpcError {
    fn from(error: CrawlerError) -> Self {
        Self::with_params(error.code(), error.params())
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
    // P2-07（2026-11-07 测试报告）：凭据形状不止 `sk-`。Google access token 是
    // `ya29.…`、refresh token 是 `1//…`；而 `Bearer <token>` 的 token 可能**不带任何
    // 前缀**（Bing Webmaster 的 API Key 就是裸串）。只认 `sk-` 时这些形状原样漏过。
    const PREFIXES: [&str; 3] = ["sk-", "ya29.", "1//"];
    /// `_scheme_` 词本身不是秘密（留着错误信息才可读），秘密是它后面那串 token。
    const BEARER: &str = "bearer ";

    let chars: Vec<char> = message.chars().collect();
    let lower: Vec<char> = chars
        .iter()
        .flat_map(|character| character.to_lowercase())
        .collect();
    let mut output = String::with_capacity(message.len());
    let mut index = 0;

    while index < chars.len() {
        if starts_with_at(&lower, index, BEARER) {
            let token_start = index + BEARER.chars().count();
            let end = token_end(&chars, token_start);
            output.extend(chars[index..token_start].iter());
            if end > token_start {
                output.push_str("***");
            }
            index = end;
            continue;
        }

        let prefix_len = PREFIXES
            .iter()
            .find(|prefix| starts_with_at(&lower, index, prefix))
            .map(|prefix| prefix.chars().count());

        if let Some(prefix_len) = prefix_len {
            let token_start = index + prefix_len;
            let end = token_end(&chars, token_start);
            // 前缀后面**没有** token 字符（孤立的 `ya29.` / 句末的 `sk-`）不算凭据，
            // 原样保留：宁可漏抹一个不完整的前缀，也不把普通文本吃掉。
            if end > token_start {
                output.push_str("***");
                index = end;
                continue;
            }
        }

        output.push(chars[index]);
        index += 1;
    }

    output
}

/// `haystack[index..]` 是否以 `needle` 开头（ASCII 大小写不敏感，haystack 需已小写化）。
fn starts_with_at(haystack: &[char], index: usize, needle: &str) -> bool {
    let needle: Vec<char> = needle.chars().collect();
    haystack.len() >= index + needle.len() && haystack[index..index + needle.len()] == needle[..]
}

/// 从 `token_start` 起第一个非 token 字符的位置（到尾则返回长度）。
fn token_end(chars: &[char], token_start: usize) -> usize {
    (token_start..chars.len())
        .find(|position| !is_token_char(chars[*position]))
        .unwrap_or(chars.len())
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
    use std::collections::{BTreeSet, HashMap, HashSet};
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

    /// P2-07（2026-11-07 测试报告）：凭据形状不止 `sk-`。Google access token 是
    /// `ya29.…`、refresh token 是 `1//…`，而 `Bearer <token>` 的 token 可能不带任何
    /// 前缀（Bing API Key 就是）。只认 `sk-` 的 [`redact`] 对这些形状是透明的。
    #[test]
    fn redaction_covers_non_sk_credential_shapes() {
        let access = IpcError::from(GeoError::upstream(
            "auth",
            "token 失效：ya29.aBcDeF123456_-x 请重新授权",
        ));
        assert!(
            !access.message.contains("ya29.aBcDeF123456_-x"),
            "{access:?}"
        );
        assert!(access.message.contains("***"), "{access:?}");

        let refresh = IpcError::from(GeoError::upstream(
            "auth",
            "refresh 1//aBcDeF123456GhI 被 Google 拒绝",
        ));
        assert!(
            !refresh.message.contains("1//aBcDeF123456GhI"),
            "{refresh:?}"
        );

        let bearer = IpcError::from(GeoError::upstream(
            "auth",
            "上游回 401：Bearer aBcDeF123456GhIjKl 无效",
        ));
        assert!(!bearer.message.contains("aBcDeF123456GhIjKl"), "{bearer:?}");
        // 「Bearer」这个_scheme_ 词本身不是秘密，保留它错误信息才可读
        assert!(bearer.message.contains("Bearer"), "{bearer:?}");
    }

    #[test]
    fn redaction_does_not_eat_ordinary_text() {
        // 斜杠、百分号与孤立数字都不是凭据形状，不能被误伤
        // 注：`1//<数字>` 与 refresh token 形状不可区分，会被抹掉——这是有意的取舍
        // （宁可误抹一个罕见写法，不漏抹真凭据），故普通文本样本里不放它。
        assert_eq!(
            redact("路径 a/1/2 与 100% 保持原样"),
            "路径 a/1/2 与 100% 保持原样"
        );
        assert_eq!(redact("Bearer"), "Bearer");
        assert_eq!(redact("ya29."), "ya29.");
    }

    /// `internal` 的 message 是「前端词典 miss」时的兜底渲染出口（**Task 7 建完词典后**才退化成
    /// 只进日志；在那之前它会经 `userMessage` 原样进 toast——见 `ipc/export.rs` 里同一时态的
    /// 说明），而 Plan A 的前提就是后端不再产出自然语言 ⇒ 它必须是 Task 3 那种紧凑日志串（`{code} {k}={v}`），
    /// 不是中文句子。原名 `internal_helper_produces_actionable_chinese_message` 钉的正是
    /// 被 Plan A 废掉的那个意图（裁定 A-3）；这里的取值逐字取自 `ipc/export.rs` 那个
    /// 唯一的生产调用点（裁定 A-2）。
    #[test]
    fn internal_helper_produces_a_language_neutral_message() {
        let error = IpcError::internal("ipc/internal reason=dialog_channel_closed");
        assert_eq!(error.code, "ipc/internal");
        assert_eq!(error.message, "ipc/internal reason=dialog_channel_closed");
        assert!(
            !error
                .message
                .chars()
                .any(|character| ('\u{4e00}'..='\u{9fa5}').contains(&character)),
            "兜底 message 不得含 CJK：{}",
            error.message
        );
        // 契约把 `ipc/internal` 的 params 冻结成 `[]`：`internal` 不得偷偷带参数，
        // 因此那个 `reason=` 只活在兜底文案里，不进 params。
        assert!(error.params.is_empty(), "{:?}", error.params);
        // `Display` 认得「message 已以 code 打头」这种形状，不再套第二层前缀
        assert_eq!(
            error.to_string(),
            "ipc/internal reason=dialog_channel_closed"
        );
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

    /// 发射点真实存在、但**刻意不进共享契约**的 `{kind}/not_found`：service 层会把它们
    /// 转成 `validation/failed { field, reason: invalid_id }`，前端永远看不到原码
    /// （2026-11-07 测试报告 P2-02）。列在这里是为了让下面的双向守卫能发现漂移：
    /// 新增发射点必须**显式**二选一——进契约（补两侧词典转正）或进本清单（确认已兜底）。
    const INTERNAL_NOT_FOUND_KINDS: [&str; 8] = [
        "article_direction",
        "article_schedule",
        "article_template",
        "faq",
        "kb_entry",
        "keyword",
        "search_opportunity",
        "site_patch",
    ];

    /// 构建期源码快照：`{kind}/not_found` 字面量发射点所在的**全部**文件。
    ///
    /// 用 `include_str!` 而不是运行期读文件：测试二进制不依赖工作目录。
    /// 漏列文件 ⇒ 派生集合缺 kind ⇒ 双向断言立刻红（P2-02 的旧守卫是单向的，
    /// 注释里那条 `rg` 取证命令跑出 13 个 kind、清单只写 5 个，却全绿）。
    const NOT_FOUND_SOURCE_FILES: [&str; 12] = [
        include_str!("services/project_service.rs"),
        include_str!("services/prompt_service.rs"),
        include_str!("services/entity_card_service.rs"),
        include_str!("services/collection_service.rs"),
        include_str!("../../../../crates/geo-store/src/repo/project.rs"),
        include_str!("../../../../crates/geo-store/src/repo/prompt_set.rs"),
        include_str!("../../../../crates/geo-store/src/repo/article.rs"),
        include_str!("../../../../crates/geo-store/src/repo/site_patch.rs"),
        include_str!("../../../../crates/geo-store/src/repo/kb.rs"),
        include_str!("../../../../crates/geo-store/src/repo/faq.rs"),
        include_str!("../../../../crates/geo-store/src/repo/search.rs"),
        include_str!("../../../../crates/geo-store/src/repo/keyword.rs"),
    ];

    /// 从源码快照里派生真实发射的 kind 集合（扫 `not_found("<kind>"` 字面量）。
    fn derived_not_found_kinds() -> BTreeSet<String> {
        let mut kinds = BTreeSet::new();
        for source in NOT_FOUND_SOURCE_FILES {
            let mut cursor = 0;
            while let Some(hit) = source[cursor..].find("not_found(\"") {
                let start = cursor + hit + "not_found(\"".len();
                let Some(end) = source[start..].find('"') else {
                    break;
                };
                kinds.insert(source[start..start + end].to_string());
                cursor = start + end;
            }
        }
        kinds
    }

    /// 双向守卫：派生集合必须**恰好等于**两份清单的并集。
    /// 旧版只断言「清单 ⊆ 发射点方向的反面」（emitted ⊆ catalog），漏登记的 kind 恒绿。
    #[test]
    fn not_found_kinds_match_the_emission_sites_exactly() {
        let derived = derived_not_found_kinds();
        let declared: BTreeSet<String> = NOT_FOUND_KINDS
            .iter()
            .chain(INTERNAL_NOT_FOUND_KINDS.iter())
            .map(|kind| (*kind).to_string())
            .collect();
        assert!(
            !derived.is_empty(),
            "派生集合为空：include_str! 快照或扫描逻辑坏了，这条守卫等于没跑"
        );
        assert_eq!(
            derived, declared,
            "发射点与清单漂移：左边多出来的是「新发射但没登记」，右边多出来的是「登记了但没人发」"
        );
    }

    /// INTERNAL 清单里的码**不得**进共享契约：它们一旦出现在
    /// `contracts/error-codes.json`，就说明该转正了（补两侧词典），应从 INTERNAL 移走。
    #[test]
    fn internal_not_found_kinds_stay_out_of_the_shared_catalog() {
        let known = catalog();
        for kind in INTERNAL_NOT_FOUND_KINDS {
            let code = format!("{kind}/not_found");
            assert!(
                !known.contains(code.as_str()),
                "{code} 已进共享契约：把它从 INTERNAL_NOT_FOUND_KINDS 移到 NOT_FOUND_KINDS，并补两侧词典"
            );
        }
    }

    fn llm_variants() -> Vec<LlmError> {
        vec![
            // `Config` 带上 `value`：清单给 `llm/config` 登记了 `["reason","value"]`，
            // 漂移守卫要求清单里存在能发出**全部**登记键的实例
            LlmError::config("missing_base_url").with_param("value", "deep_seek"),
            LlmError::Transport(TransportError::Timeout),
            LlmError::RateLimited,
            LlmError::Server { status: 500 },
            // `llm/bad_response` / `llm/deserialize` 登记 `["reason","value"]`，但只有
            // `parse_failed` 会发 `value`（`missing_choices` / `json_not_found` /
            // `validation_failed` 都不配套参数）⇒ 每个 code 各需两条实例，
            // 按并集才凑得齐（与 `Network` 同一写法，见 A-6）
            LlmError::bad_response("missing_choices"),
            LlmError::bad_response("parse_failed").with_param("value", "expected value at line 1"),
            LlmError::deserialize("validation_failed"),
            LlmError::deserialize("parse_failed").with_param("value", "invalid type"),
            LlmError::MissingSecret,
        ]
    }

    /// `CrawlerError` 的全部 6 个变体，`Network` 与 `Blocked` 各占两条：
    /// `Network` 一条带 `url` + `status`（拿到非 2xx 响应）、一条两者都拿不到
    /// （构造客户端失败）；`Blocked` 一条带 content-type、一条拿不到（`value` 发
    /// `unknown`）。清单给这两个 code 登记的键，按并集时才凑得齐。
    fn crawler_variants() -> Vec<CrawlerError> {
        vec![
            CrawlerError::Blocked {
                url: "https://a.example/x".into(),
                content_type: Some("application/pdf".into()),
            },
            CrawlerError::Blocked {
                url: "https://a.example/x".into(),
                content_type: None,
            },
            CrawlerError::Timeout {
                url: "https://a.example/x".into(),
            },
            CrawlerError::Network {
                url: Some("https://a.example/x".into()),
                status: Some(500),
                reason: "http_status".into(),
            },
            CrawlerError::Network {
                url: None,
                status: None,
                reason: "client build failed".into(),
            },
            CrawlerError::TooLarge {
                url: "https://a.example/x".into(),
                limit: 2 * 1024 * 1024,
            },
            CrawlerError::InvalidUrl {
                url: "abc".into(),
                reason: "relative URL without a base".into(),
            },
            CrawlerError::Decode("invalid byte sequence".into()),
        ]
    }

    /// `StoreError` 的全部 7 个变体。`Sqlx` 用 `RowNotFound` 造（不碰数据库、不联网），
    /// 它不满足 `is_unique_violation`，因此映射到 `io/failed`；唯一约束那条分支产出的是
    /// `state/conflict`，与 `StoreError::conflict` 同码，由 `store_code` 的 match 臂覆盖类型。
    /// `Conflict` 带上 `value`（唯一约束/CSV 写失败的真实形状），`Secret` 自己就会发出
    /// `config/invalid` 登记的 `["reason","value"]` 两个键。
    fn store_variants() -> Vec<StoreError> {
        vec![
            StoreError::not_found("project", "x"),
            StoreError::validation("brand_name", "required"),
            StoreError::conflict("duplicate").with_param("value", "UNIQUE constraint failed"),
            StoreError::Sqlx(sqlx::Error::RowNotFound),
            StoreError::Serde(serde_json::from_str::<u8>("nope").unwrap_err()),
            StoreError::secret("keyring_unavailable"),
            StoreError::Io(io::Error::other("disk full")),
        ]
    }

    /// `GeoError` 的代表性用例：除 `NotFound`（kind 是运行期字符串，由
    /// `NOT_FOUND_KINDS` 显式列举）外每个变体各一条，并覆盖 `Validation` / `Conflict` /
    /// `Config` 带 `extra` 的形状——漂移守卫按 code 取并集，清单登记的键少发一个就红。
    fn geo_cases() -> Vec<GeoError> {
        vec![
            GeoError::validation("brand_name", "required"),
            GeoError::validation("brand_name", "too_long").with_param("limit", 60),
            GeoError::validation("region", "out_of_range")
                .with_param("expected", "1~5")
                .with_param("value", "9"),
            GeoError::conflict("duplicate"),
            GeoError::conflict("write_failed").with_param("value", "disk full"),
            GeoError::config("missing_base_url"),
            // R-D / 复审 M-2：`config/invalid` 登记了 `["reason","value"]`，清单里必须有
            // 一个带 extra 的实例；否则 Task 5 写 `with_param("value", …)` 时发出清单外
            // 的键也不会有任何测试变红。
            GeoError::config("secret_unavailable").with_param("value", "keyring_unavailable"),
            GeoError::upstream("llm/server", "HTTP 503"),
            GeoError::Io(io::Error::other("disk full")),
            GeoError::Serde(serde_json::from_str::<u8>("nope").unwrap_err()),
        ]
    }

    /// 壳内字面量站点（`err_codes::` 那 5 个码）的**夹具**。
    ///
    /// 与上面四张变体清单不同，这些 code 不来自任何下游 crate 的 `code()`，只有壳自己发，
    /// 因此编译器强制不了穷举，只能在这里逐个列出。取值形态逐条对齐生产发射点
    /// （Task 5 已把它们全部 key 化，逐处清单见
    /// `.superpowers/sdd/2026-09-18-plan-a-i18n-foundation-and-demo-backend/task-5-report.md`
    /// 的 R-G 表）：
    ///
    /// - `compliance/violation` ← `services/prompt_service.rs` 的 `compliance_violation()`，
    ///   `terms` 装命中的红线词。**夹具必须挑 ASCII 词**（`100%`，
    ///   `crates/geo-domain/data/adlaw_terms.txt` 里就有）：`guard_instance_params_stay_ascii`
    ///   没有白名单，而它守的是「我们自己的夹具与常量」；生产环境 `terms` 装中文红线词
    ///   是**用户数据**、明确不在那条哨兵范围内，那条链路由 `tests/prompt_service.rs`
    ///   的真实用例钉（裁定 §J）。
    /// - `crawler/empty` ← `services/entity_card_service.rs`：两个键**永远都发**；
    ///   `skipped` 是至多 3 条 `"{url} {稳定记号}"` 用 `"; "` 连接的 ASCII 数据行，
    ///   记号由 `crates/geo-crawler/src/site.rs` 的 `SKIP_*` 常量给出（裁定 §G-5 / R-C4）。
    /// - `prompt_set/empty_import` ← `services/prompt_service.rs`：契约登记 `[]`，
    ///   逐行错误明细走 `detail` 不走 params，所以夹具是**无参数**实例。
    /// - `llm/config` ← `state.rs` 的 `config_from_settings` 与
    ///   `services/settings_service.rs` 的 `parse_provider`：三个 reason 各一条，
    ///   `value` 装**出错的那个值**（裁定 R-E：不是合法取值列表）。
    /// - `ipc/internal` ← `IpcError::internal`：**无参数码**。裁定 §I 给了两条路，
    ///   这里选的是「删掉契约里的 `reason` 声明」那一支——三个调用点全在
    ///   `ipc/export.rs`（不在 Task 5 的写入集里），且「对话框被中断」这类失败在
    ///   23 键目录里没有对应记号，而目录文件 `crates/geo-domain/src/error.rs` 同样禁改。
    fn shell_literal_cases() -> Vec<IpcError> {
        vec![
            IpcError::with_params(err_codes::COMPLIANCE_VIOLATION, [("terms", "100%")]),
            IpcError::with_params(
                err_codes::CRAWLER_EMPTY,
                [
                    ("domain", "https://a.example/"),
                    ("skipped", "https://a.example/admin robots_disallowed"),
                ],
            ),
            IpcError::new(err_codes::PROMPT_SET_EMPTY_IMPORT, "no valid rows imported"),
            IpcError::with_params(
                err_codes::LLM_CONFIG,
                [("reason", "unknown_provider"), ("value", "deep_seek")],
            ),
            IpcError::with_params(
                err_codes::LLM_CONFIG,
                [("reason", "missing_base_url"), ("value", "custom")],
            ),
            IpcError::with_params(
                err_codes::LLM_CONFIG,
                [("reason", "missing_model"), ("value", "custom")],
            ),
            IpcError::with_params("browser/unavailable", [("reason", "chrome_not_found")]),
            IpcError::internal("export dialog dismissed"),
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
            LlmError::Config { .. }
            | LlmError::Transport(_)
            | LlmError::RateLimited
            | LlmError::Server { .. }
            | LlmError::BadResponse { .. }
            | LlmError::Deserialize { .. }
            | LlmError::MissingSecret => error.code(),
        }
    }

    fn crawler_code(error: &CrawlerError) -> &'static str {
        match error {
            CrawlerError::Blocked { .. }
            | CrawlerError::Timeout { .. }
            | CrawlerError::Network { .. }
            | CrawlerError::TooLarge { .. }
            | CrawlerError::InvalidUrl { .. }
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
            | StoreError::Conflict { .. }
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
            IpcError::from(StoreError::conflict("dup")).code,
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
        // M-4：把「两层同构」焊成**跨层**断言。原先两层各写一份恰好相同的字面量
        // （`starts_with` + `contains`），反转 `GeoError::Display` 的键序时
        // `cargo test -p geo-desktop error::` 是 24 passed / 0 failed——只红一侧、不红「关系」。
        // 现在直接拿 `GeoError::Display` 的输出来比：改任何一侧的格式或键序都会红。
        //
        // 注：`redact` 在 IPC 边界生效，因此参数值里带疑似 Key 时两边会（有意地）不相等；
        // 同构断言针对不含密钥的普通值，密钥那条路由 `secret_shaped_strings_never_reach_the_frontend` 钉。
        assert_eq!(
            error.message,
            GeoError::validation("brand_name", "too_long")
                .with_param("limit", 60)
                .to_string(),
            "IpcError 的兜底文案必须与 GeoError::Display 逐字同构"
        );

        // 动态 code 前缀（`{kind}/not_found`）也要同构：`code()` 是方法调用，
        // 不是常量，最容易在两层之间走偏。
        let not_found_display = GeoError::not_found("project", "abc").to_string();
        assert_eq!(
            IpcError::from(GeoError::not_found("project", "abc")).message,
            not_found_display,
            "动态 code 前缀同样要与 GeoError::Display 逐字同构"
        );
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

        // A-1：`Blocked` 的 reason 恒为目录里的 `not_allowed`，content-type 落 `value`；
        // 拿不到 content-type 时 `value` 发 `unknown`（永远发 value，不留条件渲染）
        let blocked = IpcError::from(CrawlerError::Blocked {
            url: "https://a.example/x".into(),
            content_type: Some("application/pdf".into()),
        });
        assert_eq!(blocked.code, "crawler/blocked");
        assert_eq!(blocked.params["url"], "https://a.example/x");
        assert_eq!(blocked.params["reason"], "not_allowed");
        assert_eq!(blocked.params["value"], "application/pdf");
        assert_eq!(blocked.params.len(), 3);

        let blocked_unknown = IpcError::from(CrawlerError::Blocked {
            url: "https://a.example/x".into(),
            content_type: None,
        });
        assert_eq!(blocked_unknown.params["value"], "unknown");
        assert_eq!(blocked_unknown.params.len(), 3);

        // A-2：`llm/bad_response` / `llm/deserialize` 的 reason 是目录里的 key（不再是散文），
        // `value` 只有 `parse_failed` 会发（serde 库原文，已限长 200 字符）
        for error in [
            LlmError::bad_response("parse_failed").with_param("value", "expected value"),
            LlmError::deserialize("parse_failed").with_param("value", "invalid type"),
        ] {
            let ipc = IpcError::from(error);
            assert_eq!(ipc.params["reason"], "parse_failed", "{:?}", ipc.params);
            assert!(!ipc.params["value"].is_empty(), "{:?}", ipc.params);
            assert_eq!(ipc.params.len(), 2, "{:?}", ipc.params);
        }
        for error in [
            LlmError::bad_response("missing_choices"),
            LlmError::bad_response("json_not_found"),
            LlmError::deserialize("validation_failed"),
        ] {
            let ipc = IpcError::from(error);
            assert!(
                !ipc.params.contains_key("value"),
                "这些 key 不配套参数：{:?}",
                ipc.params
            );
            assert_eq!(ipc.params.len(), 1, "{:?}", ipc.params);
        }

        // Task 4 把 `InvalidUrl(String)` 富化成 `InvalidUrl { url, reason }`：
        // url 是裸地址、reason 是解析器原文，因此断言从「只发 reason 的合法子集」
        // 收紧成与清单登记的 `["url","reason"]` 逐键相等。
        let invalid_url = IpcError::from(CrawlerError::InvalidUrl {
            url: "not a url".into(),
            reason: "relative URL without a base".into(),
        });
        assert_eq!(invalid_url.code, "crawler/invalid_url");
        assert_eq!(invalid_url.params["url"], "not a url");
        assert_eq!(invalid_url.params["reason"], "relative URL without a base");
        assert!(
            invalid_url.params.contains_key("url"),
            "富化后必须带上裸 URL：{:?}",
            invalid_url.params
        );
        assert_eq!(invalid_url.params.len(), 2);

        // `Network` 同样富化：拿到非 2xx 响应时三个键都发，reason 是稳定记号而不是合并文本
        let network = IpcError::from(CrawlerError::Network {
            url: Some("https://a.example/x".into()),
            status: Some(500),
            reason: "http_status".into(),
        });
        assert_eq!(network.code, "crawler/network");
        assert_eq!(network.params["url"], "https://a.example/x");
        assert_eq!(network.params["status"], "500");
        assert_eq!(network.params["reason"], "http_status");
        assert_eq!(network.params.len(), 3);

        // `TooLarge` 补上 `limit`，前端才能说清「超过多少字节」
        let too_large = IpcError::from(CrawlerError::TooLarge {
            url: "https://a.example/x".into(),
            limit: 512,
        });
        assert_eq!(too_large.params["url"], "https://a.example/x");
        assert_eq!(too_large.params["limit"], "512");
        assert_eq!(too_large.params.len(), 2);

        // `llm/transport` 的 reason 是三个稳定 key 之一，不是 `TransportError` 的原文
        let transport = IpcError::from(LlmError::Transport(TransportError::Timeout));
        assert_eq!(transport.code, "llm/transport");
        assert_eq!(transport.params["reason"], "timeout");
        assert_eq!(transport.params.len(), 1);
    }

    /// Task 4：`StoreError::Secret(String)` 形状不变，但那个 String（已 `redact` 的
    /// 钥匙串底层原文）从 `reason` 降级进 `value`，`reason` 恒为目录里新增的第 19 个
    /// key `secret_unavailable`——否则前端词典永远查不到它。
    #[test]
    fn store_secret_params_follow_the_contract() {
        let secret = IpcError::from(StoreError::secret("keyring_unavailable"));
        assert_eq!(secret.code, "config/invalid");
        assert_eq!(secret.params["reason"], "secret_unavailable");
        assert_eq!(secret.params["value"], "keyring_unavailable");
        assert_eq!(secret.params.len(), 2);
        assert_eq!(
            secret.message,
            "config/invalid reason=secret_unavailable value=keyring_unavailable"
        );

        // 上游万一把密钥样式片段拼进钥匙串原文，IPC 这道关仍要抹掉（AGENTS 规则 3）
        let leaked = IpcError::from(StoreError::secret("write failed: sk-abc123XYZ_-9"));
        assert_eq!(leaked.params["reason"], "secret_unavailable");
        assert!(
            !leaked.params["value"].contains("sk-"),
            "{:?}",
            leaked.params
        );
        assert!(
            leaked.params["value"].contains("***"),
            "{:?}",
            leaked.params
        );
        assert!(!leaked.message.contains("sk-"), "{leaked}");
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

        let crawled = IpcError::from(GeoError::from(CrawlerError::Decode(
            "invalid byte sequence".into(),
        )));
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
    /// 变体清单由上面四个无兜底 `match` 强制（加变体即编译失败）；壳内字面量站点
    /// 编译器管不到，由 [`shell_literal_cases`] 显式列出。这里只断言「子集」；
    /// 「清单声明 == 实际发出键的并集」那条**相等**断言在
    /// [`catalog_params_equal_the_emitted_union`] 里。
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
        // 壳内字面量站点：Task 5 已逐个补上 params，因此这里用**带真实取值**的夹具，
        // 而不是 `IpcError::new(code, "x")` 那种空 params 占位——空占位对「键不越界」
        // 这条断言毫无贡献（没有键可查）。
        emitted.extend(shell_literal_cases());

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

    /// 漂移守卫（Task 4 · 控制器裁定）：**每个 code 的「清单声明 params」必须等于
    /// 「守卫清单里所有实例发出的键的并集」**——按 code 聚合取并集，不是逐实例相等
    /// （`CrawlerError::Network` 构造客户端失败时只有 `reason`，拿到非 2xx 时三个键都有，
    /// 逐实例相等会把这两种合法形态判成漂移）。
    ///
    /// 两端都用集合比较，避免键序造成假红。
    ///
    /// **边界（复审 M-1：别把它当全能网）**：并集语义有一个「少发」盲区——某个变体少发
    /// 一键，只要**同 code 的另一个实例**把它补上，并集仍等于清单声明，这条就不会红。
    /// 复审 M10 实证过：删掉 `StoreError::Secret` 的 `value`，本守卫**存活**（`geo_cases()`
    /// 里那条带 `value` 的 `GeoError::Config` 替 `config/invalid` 凑齐了两个键），真正红的是
    /// 逐实例的 `store_secret_params_follow_the_contract` 与 geo-store 的
    /// `params_match_the_frozen_catalog`。这是 R-D 钦定并集语义的必然结果，不是实现错。
    /// 分工因此是：**少发**方向由各 crate 的 `params_match_the_frozen_catalog`
    /// （逐变体、逐键相等的期望 map）与壳侧逐码断言
    /// （`llm_and_crawler_params_follow_the_contract` / `store_secret_params_follow_the_contract`）
    /// 兜住；本守卫负责**多发**方向（发出清单外的键，`params_keys_stay_inside_the_shared_catalog`
    /// 也管这个方向但只到「子集」为止）与「整个 code 谁都没发」。
    ///
    /// 覆盖范围 = 四张变体清单、`NOT_FOUND_KINDS`、跨 crate 的 `upstream/*` 包装形态，
    /// 外加 [`shell_literal_cases`]（壳内那 5 个 `err_codes::` 码，编译器穷举不到）。
    /// 只剩**前端专属**的码根本不由 Rust 发出，因此显式列在 `EXEMPT` 里豁免；
    /// 豁免清单本身也被断言，免得某个 code 因为「谁都没发它」而悄悄逃出上面的相等断言。
    #[test]
    fn catalog_params_equal_the_emitted_union() {
        let declared = catalog_params();

        let mut cases: Vec<IpcError> = Vec::new();
        cases.extend(llm_variants().into_iter().map(IpcError::from));
        cases.extend(crawler_variants().into_iter().map(IpcError::from));
        cases.extend(store_variants().into_iter().map(IpcError::from));
        cases.extend(geo_cases().into_iter().map(IpcError::from));
        // 先转 GeoError::Upstream 的形态（upstream/{code}），键集换成包装族那两个
        cases.extend(
            llm_variants()
                .into_iter()
                .map(|error| IpcError::from(GeoError::from(error))),
        );
        cases.extend(
            crawler_variants()
                .into_iter()
                .map(|error| IpcError::from(GeoError::from(error))),
        );
        // 动态的 `{kind}/not_found`：GeoError 与 StoreError 两条路都要覆盖
        for kind in NOT_FOUND_KINDS {
            cases.push(IpcError::from(GeoError::not_found(kind, "x")));
            cases.push(IpcError::from(StoreError::not_found(kind, "x")));
        }
        cases.extend(shell_literal_cases());
        assert!(!cases.is_empty());

        // 按 code 聚合取并集
        let mut union: HashMap<String, BTreeSet<String>> = HashMap::new();
        for case in &cases {
            union
                .entry(case.code.clone())
                .or_default()
                .extend(case.params.keys().cloned());
        }

        for (code, emitted) in &union {
            let registered: BTreeSet<String> = declared
                .get(code)
                .unwrap_or_else(|| panic!("{code} 不在 contracts/error-codes.json 里"))
                .iter()
                .cloned()
                .collect();
            assert_eq!(
                emitted, &registered,
                "{code} 的 params 与清单漂移（左：清单里所有实例发出键的并集，右：清单声明）"
            );
        }

        /// 本守卫**不覆盖**的 code，以及为什么。改动这里必须同时说明理由。
        ///
        /// Task 5 之前这里是 7 个：壳内那 4 个码（`compliance/violation`、`crawler/empty`、
        /// `prompt_set/empty_import`、`ipc/internal`）当时都发不出清单登记的键，只能豁免。
        /// 现在它们全部由 [`shell_literal_cases`] 提供实例、进入上面的相等断言，
        /// 只剩**前端专属**这一类：Rust 侧没有发射点，清单里先收着
        /// （见 `catalog_reserves_the_frontend_only_ipc_codes`）。
        ///
        /// 注：`ipc/internal` 走的是裁定 §I 的第二条路——契约里那个从来没人填的
        /// `reason` 声明已删（params-only 编辑，同一 commit），它因此是**无参数码**，
        /// 以「空集 == 空集」通过相等断言，不再需要豁免。
        const EXEMPT: [&str; 3] = ["ipc/invoke_failed", "ipc/unknown", "ipc/unknown_command"];
        let uncovered: BTreeSet<String> = declared
            .keys()
            .filter(|code| !union.contains_key(*code))
            .cloned()
            .collect();
        assert_eq!(
            uncovered,
            EXEMPT
                .iter()
                .map(|code| (*code).to_string())
                .collect::<BTreeSet<_>>(),
            "守卫的覆盖范围变了：豁免清单要同步（新增 code 记得决定它归谁发 params）"
        );
    }

    /// 中文散文哨兵（裁定 A-7.4 / G-8）：**键集**守卫管不住**取值语言**。
    ///
    /// 这正是 C-1 能溜过去的结构性原因——`crawler/blocked` 的 `reason` 曾是
    /// 「非 HTML 内容」、`llm/bad_response` 的 `reason` 曾是「响应体不是合法 JSON：…」，
    /// 键名一个都没错，值却是中文散文，en-US 下直接露馅（AGENTS 规则 7：面向用户的文案
    /// 只能由前端词典按 locale 渲染）。有了这条，将来任何人往 params 里写中文当场红。
    ///
    /// **边界（别让它看起来比实际更强）**：它只覆盖**本文件五张守卫清单里的夹具**
    /// （四张变体清单 + [`shell_literal_cases`]），不是全量证明。生产环境的 `value` 完全可能合法地带非 ASCII —— 那是**用户数据**
    /// （中文品牌名、中文别名、用户填的网址），由输入决定，本守卫不覆盖、也不该覆盖。
    /// 它证明的是一件更窄但更硬的事：**我们自己的夹具与常量里没有中文散文**，
    /// 因此「params 的取值只能是语言中立的数据或目录里的 reason key」在常量层面成立。
    ///
    /// 遇到带非 ASCII 数据的夹具就**改夹具**（本轮把 `io::Error::other("磁盘满")` 改成
    /// `"disk full"` 就是为此），**不许给这条守卫加白名单**——白名单等于给散文发通行证。
    #[test]
    fn guard_instance_params_stay_ascii() {
        let mut cases: Vec<IpcError> = Vec::new();
        cases.extend(llm_variants().into_iter().map(IpcError::from));
        cases.extend(crawler_variants().into_iter().map(IpcError::from));
        cases.extend(store_variants().into_iter().map(IpcError::from));
        cases.extend(geo_cases().into_iter().map(IpcError::from));
        // 跨 crate 包装形态（`upstream/{code}`）：`upstream` 那个键装的是里层的紧凑文案
        cases.extend(
            llm_variants()
                .into_iter()
                .map(|error| IpcError::from(GeoError::from(error))),
        );
        cases.extend(
            crawler_variants()
                .into_iter()
                .map(|error| IpcError::from(GeoError::from(error))),
        );
        for kind in NOT_FOUND_KINDS {
            cases.push(IpcError::from(GeoError::not_found(kind, "x")));
            cases.push(IpcError::from(StoreError::not_found(kind, "x")));
        }
        cases.extend(shell_literal_cases());
        assert!(!cases.is_empty());

        for case in &cases {
            for (key, value) in &case.params {
                assert!(
                    value.is_ascii(),
                    "{} 的 params[{key:?}] 含非 ASCII 字符：{value:?}\n\
                     params 的取值只能是语言中立的数据或目录里的 reason key，\n\
                     面向用户的文案由前端词典按 locale 渲染（AGENTS 规则 7）。\n\
                     若这是夹具带进来的非 ASCII 数据，改夹具，不要给本守卫加白名单。",
                    case.code
                );
            }
            // 兜底文案与 params 同源（`{code} k=v …`），一并守住
            assert!(
                case.message.is_ascii(),
                "{} 的兜底文案含非 ASCII 字符：{:?}",
                case.code,
                case.message
            );
        }
    }
}

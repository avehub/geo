//! 结构化输出：从模型回答里抽取 JSON，并在失败时带错误说明重试一次。
//!
//! 国产模型即使被要求 `response_format=json_object`，仍常见三种输出形态：
//! 裸 JSON、```json 代码块、以及夹带说明文字。这里统一抽取，
//! 抽取不到就明确报 `BadResponse`，由 `chat_json` 追问一次。
//!
//! 一次失败有**两副面孔**，本模块负责把它们分开（裁定 A-3）：
//! ① 给前端的 `reason` —— 目录里的稳定 key（`json_not_found` / `parse_failed` /
//! `validation_failed`），语言中立，配 `value` 时只装库原文；
//! ② 给模型的追问文案 —— 中文说明（含 serde / 校验器原文，模型要看得懂才能改对）。
//! 改造前这两者共用一个 `String`，于是「给模型看的中文」被迫同时当 `reason` 用，
//! `params` 里就出现了散文（AGENTS 规则 7：面向用户的文案只能由前端词典渲染）。
//! 追问文案是**模型输入**不是 UI 文案，因此继续用中文。

use serde::de::DeserializeOwned;

use crate::client::{ChatMessage, ChatRequest, LlmClient};
use crate::error::{
    library_reason, LlmError, REASON_JSON_NOT_FOUND, REASON_PARSE_FAILED, REASON_VALIDATION_FAILED,
};

/// 修复重试次数：解析或校验失败后只追问一次（spec FR-L3）。
const REPAIR_ATTEMPTS: u8 = 1;
/// 扫描 JSON 起点的最多尝试次数，避免超长输出把复杂度推到 O(n²)。
const MAX_SCAN_STARTS: usize = 64;

/// 抽取不到 JSON 时给模型看的追问说明（原文照搬改造前那句，模型侧行为不变）。
const HINT_JSON_NOT_FOUND: &str = "模型输出中未找到合法 JSON，请检查提示词或更换模型";

/// 一次解析/校验失败的两副面孔（见模块注释）。
#[derive(Debug)]
struct ParseFailure {
    /// 目录里的 reason key，进 `params()["reason"]`。
    reason_key: &'static str,
    /// 该 key 的配套 `value`：只有 `parse_failed` 有（serde 库原文，已限长）。
    value: Option<String>,
    /// 给模型看的中文追问说明（含底层原文，模型要看得懂才能改对）。**不进 params**。
    repair_hint: String,
}

impl ParseFailure {
    /// 上抛成 `llm/bad_response`（`extract_json` 这条路）。
    fn into_bad_response(self) -> LlmError {
        self.into_error(LlmError::bad_response)
    }

    /// 上抛成 `llm/deserialize`（追问一次后仍失败）。
    fn into_deserialize(self) -> LlmError {
        self.into_error(LlmError::deserialize)
    }

    fn into_error(self, make: fn(String) -> LlmError) -> LlmError {
        let error = make(self.reason_key.to_string());
        match self.value {
            Some(value) => error.with_param("value", value),
            None => error,
        }
    }
}

/// 从模型输出中抽取 JSON 文本。
///
/// 支持裸 JSON、```json 代码块、以及夹带在说明文字中的 JSON；
/// 三种形态返回同一份 JSON 文本，方便上层直接 `serde_json::from_str`。
///
/// 公开签名保持 `Result<String, LlmError>` 不变（裁定 A-3：`apps/**` 无人调用它，
/// 但它是 `pub`，改签名要动 `lib.rs` 的导出，不值得）；本体在 [`scan_json_body`]，
/// 它返回 [`ParseFailure`]，好让 [`parse_and_validate`] 拿到那副「给模型看」的面孔。
pub fn extract_json(text: &str) -> Result<String, LlmError> {
    scan_json_body(text).map_err(ParseFailure::into_bad_response)
}

/// [`extract_json`] 的本体：抽取失败时返回两副面孔都在的 [`ParseFailure`]。
fn scan_json_body(text: &str) -> Result<String, ParseFailure> {
    // 1. 优先取代码块内容：模型最常用的包裹方式。
    if let Some(fenced) = code_fence_content(text).filter(|content| is_json(content)) {
        return Ok(fenced);
    }

    // 2. 整段就是 JSON（允许首尾空白）。
    let trimmed = text.trim();
    if is_json(trimmed) {
        return Ok(trimmed.to_string());
    }

    // 3. 夹带文字：从第一个配平的 `{...}` / `[...]` 起尝试。
    if let Some(embedded) = scan_json(trimmed) {
        return Ok(embedded);
    }

    Err(ParseFailure {
        reason_key: REASON_JSON_NOT_FOUND,
        value: None,
        repair_hint: HINT_JSON_NOT_FOUND.to_string(),
    })
}

/// 要求模型输出结构化 JSON：解析或校验失败时，把错误说明作为 user 消息追问一次；
/// 第二次仍失败则返回 `LlmError::Deserialize`，由调用方决定降级（如无 Key 时走模板）。
pub async fn chat_json<T: DeserializeOwned>(
    client: &LlmClient,
    req: &ChatRequest,
    validate: impl Fn(&T) -> Result<(), String>,
) -> Result<T, LlmError> {
    let mut request = req.clone();
    // 首轮失败后才进入追问，因此 `failure` 不需要 `Option`：循环要么 `return Ok(..)`，
    // 要么带着上一轮的失败退出。
    let response = client.chat(&request).await?;
    let mut failure = match parse_and_validate::<T>(&response.content, &validate) {
        Ok(value) => return Ok(value),
        Err(failure) => failure,
    };
    for attempt in 1..=REPAIR_ATTEMPTS {
        // 日志里带 reason key（稳定、可聚合）；中文追问文案只进模型输入，不进 params。
        tracing::warn!(
            attempt,
            reason = failure.reason_key,
            "结构化输出失败，带错误说明追问一次"
        );
        tracing::debug!(attempt, hint = %failure.repair_hint, "追问文案与底层原文");
        request = request
            .clone()
            .with_message(ChatMessage::user(repair_prompt(&failure.repair_hint)));
        // 传输/限流/5xx 等错误由 `LlmClient` 自己的重试策略处理，这里直接上抛。
        let response = client.chat(&request).await?;
        match parse_and_validate::<T>(&response.content, &validate) {
            Ok(value) => return Ok(value),
            Err(next) => failure = next,
        }
    }
    Err(failure.into_deserialize())
}

/// 抽取 → 反序列化 → 业务校验，任一步失败都返回 [`ParseFailure`]。
fn parse_and_validate<T: DeserializeOwned>(
    content: &str,
    validate: &impl Fn(&T) -> Result<(), String>,
) -> Result<T, ParseFailure> {
    let json = scan_json_body(content)?;
    let value: T = serde_json::from_str(&json).map_err(|err| ParseFailure {
        reason_key: REASON_PARSE_FAILED,
        // `value` 装 serde 库原文（英文、已限长）；模型那边要看到同一段原文才改得对
        value: Some(library_reason(&err)),
        repair_hint: format!("JSON 反序列化失败：{err}"),
    })?;
    validate(&value).map_err(|detail| ParseFailure {
        // 裁定 G-3.1：校验器原文（来自 `services/**` 的 `error.user_message()`，可能是
        // 一整条紧凑错误串）塞进 `value` 会在 UI 里出现「错误套错误」的开发腔，
        // 因此 reason 用专门的 key、**不发 value**，原文只进日志与追问文案。
        reason_key: REASON_VALIDATION_FAILED,
        value: None,
        repair_hint: format!("字段校验失败：{detail}"),
    })?;
    Ok(value)
}

/// 追问文案：把上次的错误原样告诉模型，并强调只要 JSON 本体。
fn repair_prompt(reason: &str) -> String {
    format!(
        "上一次的输出无法使用，原因：{reason}。请重新输出，只给符合要求的 JSON 本体，\
         不要添加解释文字、Markdown 代码块或额外字段。"
    )
}

/// 取第一个 ``` 代码块里的内容（语言标记可有可无）。
fn code_fence_content(text: &str) -> Option<String> {
    let start = text.find("```")?;
    let after_fence = &text[start + 3..];
    let line_break = after_fence.find('\n')?;
    let content = &after_fence[line_break + 1..];
    let end = content.find("```")?;
    Some(content[..end].trim().to_string())
}

fn is_json(text: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(text).is_ok()
}

/// 依次尝试每个 `{` / `[` 起点，返回第一个既配平又能解析的片段。
///
/// 模板占位符（如「{品牌}」）会配平但不是 JSON，因此必须继续向后扫描。
fn scan_json(text: &str) -> Option<String> {
    text.char_indices()
        .filter(|(_, ch)| *ch == '{' || *ch == '[')
        .take(MAX_SCAN_STARTS)
        .filter_map(|(start, _)| balanced_slice(text, start))
        .find(|candidate| is_json(candidate))
        .map(str::to_string)
}

/// 从 `start`（必须是 `{` 或 `[`）起取配平的片段；识别字符串字面量里的括号与转义。
fn balanced_slice(text: &str, start: usize) -> Option<&str> {
    let mut depth: usize = 0;
    let mut in_string = false;
    let mut escaped = false;
    for (index, ch) in text.char_indices().skip_while(|(index, _)| *index < start) {
        if in_string {
            match ch {
                '\\' => escaped = !escaped,
                '"' if !escaped => in_string = false,
                _ => escaped = false,
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' | '[' => depth += 1,
            '}' | ']' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(&text[start..index + ch.len_utf8()]);
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPECTED: &str = r#"{"standard_name":"宏宇泵业","founded_year":2009}"#;

    #[test]
    fn extracts_bare_json() {
        assert_eq!(extract_json(EXPECTED).unwrap(), EXPECTED);
        assert_eq!(extract_json(&format!("  {EXPECTED}\n")).unwrap(), EXPECTED);
    }

    #[test]
    fn extracts_json_from_fenced_code_block() {
        let fenced = format!("```json\n{EXPECTED}\n```");
        assert_eq!(extract_json(&fenced).unwrap(), EXPECTED);
        let plain_fence = format!("```\n{EXPECTED}\n```");
        assert_eq!(extract_json(&plain_fence).unwrap(), EXPECTED);
    }

    #[test]
    fn extracts_json_embedded_in_prose() {
        let prose = format!("好的，已按实体卡字段整理如下：\n{EXPECTED}\n如需调整请告诉我。");
        assert_eq!(extract_json(&prose).unwrap(), EXPECTED);
    }

    #[test]
    fn all_wrapping_forms_yield_identical_json() {
        let forms = [
            EXPECTED.to_string(),
            format!("```json\n{EXPECTED}\n```"),
            format!("结果：{EXPECTED} 以上"),
        ];
        let extracted: Vec<String> = forms
            .iter()
            .map(|form| extract_json(form).unwrap())
            .collect();
        assert!(
            extracted.iter().all(|item| item == EXPECTED),
            "实际：{extracted:?}"
        );
    }

    #[test]
    fn extracts_json_array() {
        let array = r#"[{"text":"工业水泵哪个牌子靠谱吗","intent":"purchase_recommendation"}]"#;
        assert_eq!(extract_json(&format!("题库如下：{array}")).unwrap(), array);
    }

    #[test]
    fn braces_inside_json_strings_do_not_break_the_scan() {
        let payload = r#"{"note":"参数含 } 与 { 符号","ok":true}"#;
        assert_eq!(
            extract_json(&format!("说明：{payload} 完毕")).unwrap(),
            payload
        );
    }

    #[test]
    fn skips_leading_placeholder_braces() {
        // 模板占位符「{品牌}」不是 JSON，应继续向后扫描
        let prose = format!("模板：{{品牌}} 的结果是 {EXPECTED}");
        assert_eq!(extract_json(&prose).unwrap(), EXPECTED);
    }

    #[test]
    fn text_without_json_is_bad_response() {
        let error = extract_json("没有 JSON").unwrap_err();
        assert!(
            matches!(error, LlmError::BadResponse { .. }),
            "实际：{error:?}"
        );
        assert_eq!(error.code(), "llm/bad_response");
        // A-7.3：reason 是目录里的稳定 key，不是那句中文说明；
        // `json_not_found` 不配套参数，因此 params 里**没有** `value` 键
        assert_eq!(error.params()["reason"], "json_not_found", "{error}");
        assert!(!error.params().contains_key("value"), "{error}");
        assert_eq!(error.params().len(), 1, "{error}");
        assert!(extract_json("").is_err());
        assert!(extract_json("```json\n```").is_err());
    }

    #[test]
    fn truncated_json_is_rejected() {
        assert!(extract_json(r#"{"standard_name":"宏宇泵业""#).is_err());
        assert!(extract_json(r#"{"a":1}"#).is_ok());
    }
}

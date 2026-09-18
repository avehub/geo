//! 结构化输出：从模型回答里抽取 JSON，并在失败时带错误说明重试一次。
//!
//! 国产模型即使被要求 `response_format=json_object`，仍常见三种输出形态：
//! 裸 JSON、```json 代码块、以及前后夹带说明文字。这里统一抽取，
//! 抽取不到就明确报 `BadResponse`，由 `chat_json` 追问一次。

use serde::de::DeserializeOwned;

use crate::client::{ChatMessage, ChatRequest, LlmClient};
use crate::error::LlmError;

/// 修复重试次数：解析或校验失败后只追问一次（spec FR-L3）。
const REPAIR_ATTEMPTS: u8 = 1;
/// 扫描 JSON 起点的最多尝试次数，避免超长输出把复杂度推到 O(n²)。
const MAX_SCAN_STARTS: usize = 64;

/// 从模型输出中抽取 JSON 文本。
///
/// 支持裸 JSON、```json 代码块、以及夹带在说明文字中的 JSON；
/// 三种形态返回同一份 JSON 文本，方便上层直接 `serde_json::from_str`。
pub fn extract_json(text: &str) -> Result<String, LlmError> {
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

    Err(LlmError::BadResponse(
        "模型输出中未找到合法 JSON，请检查提示词或更换模型".to_string(),
    ))
}

/// 要求模型输出结构化 JSON：解析或校验失败时，把错误说明作为 user 消息追问一次；
/// 第二次仍失败则返回 `LlmError::Deserialize`，由调用方决定降级（如无 Key 时走模板）。
pub async fn chat_json<T: DeserializeOwned>(
    client: &LlmClient,
    req: &ChatRequest,
    validate: impl Fn(&T) -> Result<(), String>,
) -> Result<T, LlmError> {
    let mut request = req.clone();
    let mut reason = String::new();
    for attempt in 0..=REPAIR_ATTEMPTS {
        if attempt > 0 {
            tracing::warn!(attempt, reason = %reason, "结构化输出失败，带错误说明追问一次");
            request = request
                .clone()
                .with_message(ChatMessage::user(repair_prompt(&reason)));
        }
        // 传输/限流/5xx 等错误由 `LlmClient` 自己的重试策略处理，这里直接上抛。
        let response = client.chat(&request).await?;
        match parse_and_validate::<T>(&response.content, &validate) {
            Ok(value) => return Ok(value),
            Err(failure) => reason = failure,
        }
    }
    Err(LlmError::Deserialize(reason))
}

/// 抽取 → 反序列化 → 业务校验，任一步失败都返回中文原因。
fn parse_and_validate<T: DeserializeOwned>(
    content: &str,
    validate: &impl Fn(&T) -> Result<(), String>,
) -> Result<T, String> {
    let json = extract_json(content).map_err(|err| err.user_message())?;
    let value: T =
        serde_json::from_str(&json).map_err(|err| format!("JSON 反序列化失败：{err}"))?;
    validate(&value).map_err(|err| format!("字段校验失败：{err}"))?;
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
        assert!(matches!(error, LlmError::BadResponse(_)), "实际：{error:?}");
        assert_eq!(error.code(), "llm/bad_response");
        assert!(extract_json("").is_err());
        assert!(extract_json("```json\n```").is_err());
    }

    #[test]
    fn truncated_json_is_rejected() {
        assert!(extract_json(r#"{"standard_name":"宏宇泵业""#).is_err());
        assert!(extract_json(r#"{"a":1}"#).is_ok());
    }
}

//! Task 12 验收：结构化输出抽取与「带错误说明重试一次」。

mod support;

use std::sync::Arc;

use geo_llm::client::{ChatMessage, ChatRequest, LlmClient};
use geo_llm::error::LlmError;
use geo_llm::json::{chat_json, extract_json};
use geo_llm::provider::{LlmConfig, LlmProvider};
use serde::Deserialize;
use support::{openai_response, ScriptedTransport};

#[derive(Debug, Deserialize, PartialEq)]
struct BrandCard {
    standard_name: String,
    founded_year: Option<i32>,
}

fn test_client(transport: Arc<ScriptedTransport>) -> LlmClient {
    let mut config = LlmConfig::for_provider(LlmProvider::Custom, "keyring://llm/test");
    config.base_url = "https://llm.example.com/v1".to_string();
    config.model = "test-model".to_string();
    config.max_retries = 0;
    LlmClient::new(config, "sk-test", transport)
}

fn request() -> ChatRequest {
    ChatRequest::new(vec![
        ChatMessage::system("你是品牌信息抽取助手，只输出 JSON。"),
        ChatMessage::user("请抽取品牌实体卡"),
    ])
    .json()
}

const VALID: &str = r#"{"standard_name":"宏宇泵业","founded_year":2009}"#;

#[tokio::test]
async fn parses_structured_output_on_first_try() {
    let transport = ScriptedTransport::new(vec![openai_response(VALID)]);
    let client = test_client(transport.clone());

    let card: BrandCard = chat_json(&client, &request(), |_| Ok(())).await.unwrap();

    assert_eq!(card.standard_name, "宏宇泵业");
    assert_eq!(card.founded_year, Some(2009));
    assert_eq!(transport.request_count(), 1);
}

#[tokio::test]
async fn invalid_then_valid_json_succeeds_with_two_requests() {
    let transport = ScriptedTransport::new(vec![
        openai_response("好的，结果如下：{\"standard_name\":\"宏宇泵业\""),
        openai_response(&format!("```json\n{VALID}\n```")),
    ]);
    let client = test_client(transport.clone());

    let card: BrandCard = chat_json(&client, &request(), |_| Ok(())).await.unwrap();

    assert_eq!(card.standard_name, "宏宇泵业");
    assert_eq!(transport.request_count(), 2, "只允许重试一次");
}

#[tokio::test]
async fn repair_retry_carries_the_previous_reason() {
    let transport =
        ScriptedTransport::new(vec![openai_response("没有 JSON"), openai_response(VALID)]);
    let client = test_client(transport.clone());

    chat_json::<BrandCard>(&client, &request(), |_| Ok(()))
        .await
        .unwrap();

    let requests = transport.requests();
    assert_eq!(requests.len(), 2);
    let retry_body: serde_json::Value = serde_json::from_str(&requests[1].body).unwrap();
    let messages = retry_body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 3, "追问应追加一条 user 消息");
    assert_eq!(messages[2]["role"], "user");
    let repair = messages[2]["content"].as_str().unwrap();
    assert!(
        repair.contains("没有 JSON") || repair.contains("未找到"),
        "实际：{repair}"
    );
    // 首次请求不应带追问
    let first_body: serde_json::Value = serde_json::from_str(&requests[0].body).unwrap();
    assert_eq!(first_body["messages"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn validation_failure_triggers_exactly_one_repair_retry() {
    let wrong = r#"{"standard_name":"","founded_year":2009}"#;
    let transport = ScriptedTransport::new(vec![openai_response(wrong), openai_response(VALID)]);
    let client = test_client(transport.clone());

    let card: BrandCard = chat_json::<BrandCard>(&client, &request(), |value| {
        if value.standard_name.trim().is_empty() {
            return Err("标准名称不能为空".to_string());
        }
        Ok(())
    })
    .await
    .unwrap();

    assert_eq!(card.standard_name, "宏宇泵业");
    assert_eq!(transport.request_count(), 2);
}

/// A-3 / G-3.1 的核心分工：**给模型看的追问文案继续带底层原文（中文也没关系，那是模型
/// 输入），给前端的 `params` 只有稳定 key**。
///
/// 校验器那句「标准名称不能为空」改造前会经 `LlmError::Deserialize(String)` 直接变成
/// `llm/deserialize` 的 `reason`（进而落进 IPC 载荷、由前端原样显示）；现在它只出现在
/// 追问文案与日志里，`params` 只有 `{reason:"validation_failed"}`。
#[tokio::test]
async fn validator_detail_reaches_the_model_but_never_the_params() {
    let wrong = r#"{"standard_name":"","founded_year":2009}"#;
    let transport = ScriptedTransport::new(vec![openai_response(wrong), openai_response(wrong)]);
    let client = test_client(transport.clone());

    let error = chat_json::<BrandCard>(&client, &request(), |value| {
        if value.standard_name.trim().is_empty() {
            return Err("标准名称不能为空".to_string());
        }
        Ok(())
    })
    .await
    .unwrap_err();

    // 前端那一面：只有目录里的 key，没有 `value`，没有中文
    assert_eq!(error.params()["reason"], "validation_failed", "{error}");
    assert!(!error.params().contains_key("value"), "{error}");
    assert_eq!(error.params().len(), 1, "{error}");
    assert!(
        error.params().values().all(|value| value.is_ascii()),
        "params 里出现了非 ASCII 值：{error:?}"
    );

    // 模型那一面：追问文案带着校验器原文，否则模型无从改起
    let requests = transport.requests();
    assert_eq!(requests.len(), 2, "只追问一次");
    let repair: serde_json::Value = serde_json::from_str(&requests[1].body).unwrap();
    let messages = repair["messages"].as_array().unwrap();
    let last = messages.last().unwrap()["content"].as_str().unwrap();
    assert!(last.contains("上一次的输出无法使用"), "{last}");
    assert!(last.contains("字段校验失败"), "{last}");
    assert!(last.contains("标准名称不能为空"), "{last}");
}

/// A-3 / G-3.2：`parse_failed` 的 `value` 装 serde 库原文（英文、限长 200 字符），
/// 而追问文案里带的是**完整**原文——两边用途不同，限长只约束进 params 的那一份。
#[tokio::test]
async fn serde_detail_is_truncated_in_params_but_full_in_the_repair_prompt() {
    let transport = ScriptedTransport::new(vec![
        openai_response(r#"{"standard_name":123}"#),
        openai_response(VALID),
    ]);
    let client = test_client(transport.clone());

    let card: BrandCard = chat_json(&client, &request(), |_| Ok(()))
        .await
        .expect("追问一次后应成功");
    assert_eq!(card.standard_name, "宏宇泵业");

    let requests = transport.requests();
    let repair: serde_json::Value = serde_json::from_str(&requests[1].body).unwrap();
    let last = repair["messages"].as_array().unwrap().last().unwrap()["content"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(last.contains("JSON 反序列化失败"), "{last}");
    assert!(
        last.contains("invalid type"),
        "追问文案要带 serde 原文：{last}"
    );
}

#[tokio::test]
async fn two_invalid_outputs_report_deserialize_error() {
    let transport = ScriptedTransport::new(vec![
        openai_response("我不知道"),
        openai_response("还是不知道"),
    ]);
    let client = test_client(transport.clone());

    let error = chat_json::<BrandCard>(&client, &request(), |_| Ok(()))
        .await
        .unwrap_err();

    assert!(
        matches!(error, LlmError::Deserialize { .. }),
        "实际：{error:?}"
    );
    assert_eq!(error.code(), "llm/deserialize");
    // 两轮输出里都找不到 JSON ⇒ 目录里的 `json_not_found`（不配套参数，无 `value`）。
    // 改造前这里是那句中文说明「模型输出中未找到合法 JSON…」，现在它只当追问文案用。
    assert_eq!(error.params()["reason"], "json_not_found", "{error}");
    assert!(!error.params().contains_key("value"), "{error}");
    assert_eq!(transport.request_count(), 2, "重试一次后就放弃");
}

#[tokio::test]
async fn schema_mismatch_reports_deserialize_error() {
    let transport = ScriptedTransport::new(vec![
        openai_response(r#"{"standard_name":123}"#),
        openai_response(r#"{"standard_name":456}"#),
    ]);
    let client = test_client(transport.clone());

    let error = chat_json::<BrandCard>(&client, &request(), |_| Ok(()))
        .await
        .unwrap_err();

    assert!(
        matches!(error, LlmError::Deserialize { .. }),
        "实际：{error:?}"
    );
    // 抽到了 JSON 但类型不符 ⇒ `parse_failed` + `value` 装 serde 库原文（英文、已限长）。
    // 「反序列化」那句中文现在只进追问文案与日志，不再出现在 params / Display 里。
    assert_eq!(error.params()["reason"], "parse_failed", "{error}");
    assert!(error.params()["value"].contains("invalid type"), "{error}");
    assert!(!error.user_message().contains("反序列化"), "实际：{error}");
}

#[tokio::test]
async fn transport_failure_propagates_without_repair_retry() {
    let transport = ScriptedTransport::new(vec![]);
    let client = test_client(transport.clone());

    let error = chat_json::<BrandCard>(&client, &request(), |_| Ok(()))
        .await
        .unwrap_err();

    assert!(matches!(error, LlmError::Transport(_)), "实际：{error:?}");
    assert_eq!(transport.request_count(), 1);
}

#[test]
fn extract_json_is_reexported_from_crate_root() {
    assert_eq!(
        geo_llm::extract_json(&format!("结果：{VALID}")).unwrap(),
        VALID
    );
    let _: fn(&str) -> Result<String, LlmError> = extract_json;
}

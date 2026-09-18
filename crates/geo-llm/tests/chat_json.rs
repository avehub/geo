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

    assert!(matches!(error, LlmError::Deserialize(_)), "实际：{error:?}");
    assert_eq!(error.code(), "llm/deserialize");
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

    assert!(matches!(error, LlmError::Deserialize(_)), "实际：{error:?}");
    assert!(error.user_message().contains("反序列化"), "实际：{error}");
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

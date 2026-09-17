//! `LlmClient` 的单元测试：覆盖请求体拼装、重试归类与日志脱敏等私有实现。
//!
//! 需要外部 HTTP 的验收测试在 `crates/geo-llm/tests/chat_client.rs`。

use super::*;
use crate::provider::LlmProvider;
use serde_json::json;

fn deepseek_client() -> LlmClient {
    LlmClient::new(
        LlmConfig::for_provider(LlmProvider::DeepSeek, "keyring://llm/deepseek"),
        "sk-secret-value",
        Arc::new(crate::transport::FixtureTransport::default()),
    )
}

fn response(status: u16) -> HttpResponse {
    HttpResponse {
        status,
        body: String::new(),
    }
}

#[test]
fn message_constructors_set_roles() {
    assert_eq!(ChatMessage::system("你是助手").role, ChatRole::System);
    assert_eq!(ChatMessage::user("问题").role, ChatRole::User);
    assert_eq!(ChatMessage::assistant("回答").role, ChatRole::Assistant);
    assert_eq!(ChatMessage::user("问题").content, "问题");
    assert_eq!(ChatRole::System.as_str(), "system");
    assert_eq!(
        serde_json::to_string(&ChatRole::Assistant).unwrap(),
        "\"assistant\""
    );
}

#[test]
fn request_defaults_and_builders() {
    let req = ChatRequest::new(vec![ChatMessage::user("你好")]);
    assert!(!req.response_format_json);
    assert!(req.temperature.is_none());

    let req = req
        .json()
        .with_temperature(0.2)
        .with_message(ChatMessage::user("再来"));
    assert!(req.response_format_json);
    assert_eq!(req.temperature, Some(0.2));
    assert_eq!(req.messages.len(), 2);
}

#[test]
fn build_body_matches_openai_wire_shape() {
    let client = deepseek_client();
    let req = ChatRequest::new(vec![
        ChatMessage::system("你是抽取助手"),
        ChatMessage::user("抽取品牌信息"),
    ]);
    let body: serde_json::Value = serde_json::from_str(&client.build_body(&req).unwrap()).unwrap();

    assert_eq!(body["model"], "deepseek-chat");
    assert_eq!(body["messages"].as_array().unwrap().len(), 2);
    assert_eq!(
        body["messages"][0],
        json!({ "role": "system", "content": "你是抽取助手" })
    );
    // f32 经 serde 输出最短表示（0.3），与配置值按字符串对齐比较
    assert_eq!(
        body["temperature"].to_string(),
        client.config().temperature.to_string()
    );
    assert!(
        body.get("response_format").is_none(),
        "未要求结构化输出时不应出现 response_format"
    );
}

#[test]
fn build_body_adds_response_format_and_request_temperature() {
    let client = deepseek_client();
    let req = ChatRequest::new(vec![ChatMessage::user("给我 JSON")])
        .json()
        .with_temperature(0.1);
    let body: serde_json::Value = serde_json::from_str(&client.build_body(&req).unwrap()).unwrap();

    assert_eq!(body["response_format"], json!({ "type": "json_object" }));
    assert_eq!(body["temperature"], json!(0.1));
}

#[test]
fn classify_marks_retryable_failures() {
    assert!(matches!(
        classify(Ok(response(429))),
        Attempt::Retry(LlmError::RateLimited)
    ));
    assert!(matches!(
        classify(Ok(response(503))),
        Attempt::Retry(LlmError::Server { status: 503 })
    ));
    assert!(matches!(
        classify(Err(TransportError::Timeout)),
        Attempt::Retry(LlmError::Transport(TransportError::Timeout))
    ));
    assert!(matches!(
        classify(Err(TransportError::Network("连接被拒绝".into()))),
        Attempt::Retry(LlmError::Transport(TransportError::Network(_)))
    ));
}

#[test]
fn classify_marks_fatal_failures() {
    // 4xx（除 429）重试也不会变好，必须立即失败
    assert!(matches!(
        classify(Ok(response(400))),
        Attempt::Fatal(LlmError::Server { status: 400 })
    ));
    assert!(matches!(
        classify(Ok(response(401))),
        Attempt::Fatal(LlmError::Server { status: 401 })
    ));
    // fixture 未命中属于测试数据缺失，不是网络抖动
    assert!(matches!(
        classify(Err(TransportError::Other("fixture miss: x".into()))),
        Attempt::Fatal(LlmError::Transport(TransportError::Other(_)))
    ));
    assert!(matches!(classify(Ok(response(200))), Attempt::Success(_)));
}

#[test]
fn preview_truncates_by_char_count() {
    assert_eq!(preview("可见度提升", 200), "可见度提升");
    let long = "泵".repeat(250);
    let truncated = preview(&long, 200);
    assert_eq!(truncated.chars().count(), 201);
    assert!(truncated.ends_with('…'));
}

#[test]
fn debug_output_redacts_api_key() {
    let debug = format!("{:?}", deepseek_client());
    assert!(!debug.contains("sk-secret-value"), "日志里不得出现 API Key");
    assert!(debug.contains("<redacted>"));
    // secret_ref 只是钥匙串引用，可以出现
    assert!(debug.contains("keyring://llm/deepseek"));
}

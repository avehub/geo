//! Task 11 验收：重试策略、用量解析与成本记账（wiremock，不触外网）。

use std::sync::Arc;
use std::time::Duration;

use geo_llm::client::{ChatMessage, ChatRequest, ChatRole, LlmClient, Usage};
use geo_llm::error::LlmError;
use geo_llm::provider::{LlmConfig, LlmProvider};
use geo_llm::transport::{ReqwestTransport, Transport};
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// 退避基数设为 1ms，保证重试类测试跑得快；超时留 2s 给 wiremock。
fn test_config(provider: LlmProvider, base_url: &str, max_retries: u32) -> LlmConfig {
    let mut config = LlmConfig::for_provider(provider, "keyring://llm/test");
    // 真实 Provider 的 base_url 都带版本前缀，这里照抄同样的形态。
    config.base_url = format!("{}/v1", base_url.trim_end_matches('/'));
    config.model = "test-model".to_string();
    config.max_retries = max_retries;
    config.retry_backoff_ms = 1;
    config.timeout_secs = 2;
    config
}

fn client(config: LlmConfig, api_key: &str) -> LlmClient {
    let transport: Arc<dyn Transport> = Arc::new(
        ReqwestTransport::new(Duration::from_millis(config.timeout_secs * 1_000), None).unwrap(),
    );
    LlmClient::new(config, api_key, transport)
}

fn openai_body(content: &str, prompt_tokens: u32, completion_tokens: u32) -> serde_json::Value {
    json!({
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": content },
            "finish_reason": "stop",
        }],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    })
}

fn hello_request() -> ChatRequest {
    ChatRequest::new(vec![
        ChatMessage::system("你是抽取助手"),
        ChatMessage::user("抽取品牌信息"),
    ])
}

fn ok_mock(content: &str, prompt: u32, completion: u32) -> Mock {
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(openai_body(content, prompt, completion)),
        )
}

#[tokio::test]
async fn retries_429_twice_then_succeeds_with_three_requests() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429).set_body_string("限流"))
        .up_to_n_times(2)
        .expect(2)
        .mount(&server)
        .await;
    ok_mock("好的", 10, 5).expect(1).mount(&server).await;

    let client = client(
        test_config(LlmProvider::Custom, &server.uri(), 3),
        "sk-test",
    );
    let response = client.chat(&hello_request()).await.unwrap();

    assert_eq!(response.content, "好的");
    assert_eq!(response.finish_reason.as_deref(), Some("stop"));
    assert_eq!(server.received_requests().await.unwrap().len(), 3);
}

#[tokio::test]
async fn client_error_400_is_not_retried() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(400).set_body_string("参数错误"))
        .expect(1)
        .mount(&server)
        .await;

    let client = client(
        test_config(LlmProvider::Custom, &server.uri(), 3),
        "sk-test",
    );
    let error = client.chat(&hello_request()).await.unwrap_err();

    assert!(
        matches!(error, LlmError::Server { status: 400 }),
        "实际：{error:?}"
    );
    assert_eq!(error.code(), "llm/server");
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn server_error_500_retries_until_max_retries_then_fails() {
    let server = MockServer::start().await;
    let max_retries = 2;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(500).set_body_string("炸了"))
        .expect(u64::from(1 + max_retries))
        .mount(&server)
        .await;

    let client = client(
        test_config(LlmProvider::Custom, &server.uri(), max_retries),
        "sk-test",
    );
    let error = client.chat(&hello_request()).await.unwrap_err();

    assert!(
        matches!(error, LlmError::Server { status: 500 }),
        "实际：{error:?}"
    );
    assert_eq!(
        server.received_requests().await.unwrap().len(),
        1 + max_retries as usize
    );
}

#[tokio::test]
async fn exhausted_rate_limit_reports_rate_limited() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429))
        .expect(2)
        .mount(&server)
        .await;

    let client = client(
        test_config(LlmProvider::Custom, &server.uri(), 1),
        "sk-test",
    );
    let error = client.chat(&hello_request()).await.unwrap_err();

    assert!(matches!(error, LlmError::RateLimited), "实际：{error:?}");
    assert_eq!(error.code(), "llm/rate_limited");
}

#[tokio::test]
async fn timeout_is_retried_and_surfaces_as_transport_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(openai_body("迟到", 1, 1))
                .set_delay(Duration::from_millis(600)),
        )
        .expect(2)
        .mount(&server)
        .await;

    let mut config = test_config(LlmProvider::Custom, &server.uri(), 1);
    config.timeout_secs = 0;
    let transport: Arc<dyn Transport> =
        Arc::new(ReqwestTransport::new(Duration::from_millis(100), None).unwrap());
    let client = LlmClient::new(config, "sk-test", transport);

    let error = client.chat(&hello_request()).await.unwrap_err();
    assert!(matches!(error, LlmError::Transport(_)), "实际：{error:?}");
    assert_eq!(error.code(), "llm/transport");
    assert_eq!(server.received_requests().await.unwrap().len(), 2);
}

#[tokio::test]
async fn parses_usage_model_and_finish_reason() {
    let server = MockServer::start().await;
    ok_mock("内容", 1_200, 340).expect(1).mount(&server).await;

    let client = client(
        test_config(LlmProvider::Custom, &server.uri(), 0),
        "sk-test",
    );
    let response = client.chat(&hello_request()).await.unwrap();

    assert_eq!(response.model, "test-model");
    assert_eq!(
        response.usage,
        Usage {
            prompt_tokens: 1_200,
            completion_tokens: 340,
            total_tokens: 1_540,
        }
    );
}

#[tokio::test]
async fn chat_with_cost_uses_provider_pricing() {
    let server = MockServer::start().await;
    ok_mock("内容", 1_000_000, 500_000)
        .expect(1)
        .mount(&server)
        .await;

    let config = test_config(LlmProvider::DeepSeek, &server.uri(), 0);
    let client = client(config.clone(), "sk-test");
    let (response, cost) = client.chat_with_cost(&hello_request()).await.unwrap();

    let expected = LlmProvider::DeepSeek.pricing().cost_cny(&response.usage);
    assert!((cost - expected).abs() < 1e-9);
    // DeepSeek 预设：1M×2.0 + 0.5M×8.0 = 6.00 元
    assert!((cost - 6.0).abs() < 1e-9, "实际：{cost}");
}

#[tokio::test]
async fn missing_api_key_short_circuits_without_request() {
    let server = MockServer::start().await;
    ok_mock("不会被调用", 1, 1).expect(0).mount(&server).await;

    let client = client(test_config(LlmProvider::Custom, &server.uri(), 3), "  ");
    let error = client.chat(&hello_request()).await.unwrap_err();

    assert!(matches!(error, LlmError::MissingSecret), "实际：{error:?}");
    assert_eq!(error.code(), "llm/missing_secret");
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn custom_provider_without_base_url_is_config_error() {
    let client = client(LlmConfig::for_provider(LlmProvider::Custom, ""), "sk-test");
    let error = client.chat(&hello_request()).await.unwrap_err();

    assert!(matches!(error, LlmError::Config { .. }), "实际：{error:?}");
    assert_eq!(error.code(), "llm/config");
    // reason 是稳定 key，value 是 `Provider::as_str()` 的稳定 id（不是 `label_zh()` 的中文）
    let params = error.params();
    assert_eq!(params["reason"], "missing_base_url", "{error}");
    assert_eq!(params["value"], "custom", "{error}");
    assert_eq!(params.len(), 2, "{params:?}");
}

/// 缺模型名走 `missing_model`（清单给 `llm/config` 登记了 `value`，但这个 key 没有配套值）。
#[tokio::test]
async fn blank_model_is_a_config_error_with_the_missing_model_key() {
    let mut config = LlmConfig::for_provider(LlmProvider::Custom, "keyring://llm/test");
    config.base_url = "https://api.example.com/v1".to_string();
    config.model = "   ".to_string();
    let client = client(config, "sk-test");
    let error = client.chat(&hello_request()).await.unwrap_err();

    assert_eq!(error.code(), "llm/config");
    assert_eq!(error.params()["reason"], "missing_model", "{error}");
    assert_eq!(error.params().len(), 1, "{error:?}");
    assert_eq!(error.to_string(), "llm/config reason=missing_model");
}

#[tokio::test]
async fn wire_format_matches_openai_chat_completions() {
    let server = MockServer::start().await;
    ok_mock("好的", 1, 1).expect(2).mount(&server).await;

    let client = client(
        test_config(LlmProvider::Custom, &server.uri(), 0),
        "sk-secret",
    );
    client.chat(&hello_request()).await.unwrap();
    client
        .chat(&hello_request().json().with_temperature(0.1))
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 2);
    for request in &requests {
        assert_eq!(request.url.path(), "/v1/chat/completions");
        assert_eq!(
            request
                .headers
                .get("authorization")
                .unwrap()
                .to_str()
                .unwrap(),
            "Bearer sk-secret"
        );
        assert_eq!(
            request
                .headers
                .get("content-type")
                .unwrap()
                .to_str()
                .unwrap(),
            "application/json"
        );
    }

    let plain: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(plain["model"], "test-model");
    assert_eq!(
        plain["messages"][0]["role"],
        json!(ChatRole::System.as_str())
    );
    assert_eq!(plain["messages"][0]["content"], "你是抽取助手");
    assert_eq!(plain["messages"][1]["role"], "user");
    assert!(
        plain.get("response_format").is_none(),
        "未要求 JSON 时不应带 response_format"
    );

    let structured: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert_eq!(
        structured["response_format"],
        json!({ "type": "json_object" })
    );
    assert_eq!(structured["temperature"], json!(0.1));
}

#[tokio::test]
async fn malformed_200_body_is_bad_response_without_retry() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_string("<html>网关错误</html>"))
        .expect(1)
        .mount(&server)
        .await;

    let client = client(
        test_config(LlmProvider::Custom, &server.uri(), 3),
        "sk-test",
    );
    let error = client.chat(&hello_request()).await.unwrap_err();

    assert!(matches!(error, LlmError::BadResponse(_)), "实际：{error:?}");
    assert_eq!(error.code(), "llm/bad_response");
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn response_without_choices_is_bad_response() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "id": "x" })))
        .expect(1)
        .mount(&server)
        .await;

    let client = client(
        test_config(LlmProvider::Custom, &server.uri(), 0),
        "sk-test",
    );
    let error = client.chat(&hello_request()).await.unwrap_err();

    assert!(matches!(error, LlmError::BadResponse(_)), "实际：{error:?}");
}

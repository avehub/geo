//! Task 10 验收：`ReqwestTransport` 对真实 HTTP 语义的处理（wiremock，不触外网）。

use std::time::Duration;

use geo_llm::transport::{HttpRequest, ReqwestTransport, Transport, TransportError};
use wiremock::matchers::method;
use wiremock::{Mock, MockServer, ResponseTemplate};

fn request(url: String) -> HttpRequest {
    HttpRequest::bearer_json(url, "sk-test", r#"{"model":"deepseek-chat"}"#)
}

#[tokio::test]
async fn send_returns_status_and_body() {
    let server = MockServer::start().await;
    let payload = serde_json::json!({ "id": "chatcmpl-1", "model": "deepseek-chat" });
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&payload))
        .expect(1)
        .mount(&server)
        .await;

    let transport = ReqwestTransport::new(Duration::from_secs(5), None).unwrap();
    let response = transport.send(request(server.uri())).await.unwrap();

    assert_eq!(response.status, 200);
    assert!(response.is_success());
    let parsed: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(parsed["id"], "chatcmpl-1");
}

#[tokio::test]
async fn send_propagates_error_status_without_failing() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429).set_body_string("rate limited"))
        .expect(1)
        .mount(&server)
        .await;

    let transport = ReqwestTransport::new(Duration::from_secs(5), None).unwrap();
    let response = transport.send(request(server.uri())).await.unwrap();

    assert_eq!(response.status, 429);
    assert!(!response.is_success());
    assert_eq!(response.body, "rate limited");
}

#[tokio::test]
async fn slow_response_yields_timeout() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_string("迟到")
                .set_delay(Duration::from_millis(1_000)),
        )
        .expect(1)
        .mount(&server)
        .await;

    let transport = ReqwestTransport::new(Duration::from_millis(100), None).unwrap();
    let error = transport.send(request(server.uri())).await.unwrap_err();

    assert_eq!(error, TransportError::Timeout);
    assert_eq!(error.to_string(), "请求超时");
}

#[tokio::test]
async fn unreachable_host_yields_network_error() {
    // 端口 1 上没有服务，连接会被立即拒绝（不访问外网）。
    let transport = ReqwestTransport::new(Duration::from_secs(2), None).unwrap();
    let error = transport
        .send(request("http://127.0.0.1:1/chat/completions".to_string()))
        .await
        .unwrap_err();

    assert!(
        matches!(error, TransportError::Network(_) | TransportError::Timeout),
        "实际：{error:?}"
    );
}

#[tokio::test]
async fn request_headers_reach_the_server() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;

    let transport = ReqwestTransport::new(Duration::from_secs(5), None).unwrap();
    transport.send(request(server.uri())).await.unwrap();

    let received = &server.received_requests().await.unwrap()[0];
    assert_eq!(
        received
            .headers
            .get("authorization")
            .unwrap()
            .to_str()
            .unwrap(),
        "Bearer sk-test"
    );
    assert_eq!(
        received
            .headers
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap(),
        "application/json"
    );
}

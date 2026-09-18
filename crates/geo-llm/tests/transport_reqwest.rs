//! Task 10 验收：`ReqwestTransport` 对真实 HTTP 语义的处理（wiremock，不触外网）。

use std::time::Duration;

use geo_llm::transport::{HttpRequest, ReqwestTransport, Transport, TransportError};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn request(url: String) -> HttpRequest {
    HttpRequest::bearer_json(url, "sk-test", r#"{"model":"deepseek-chat"}"#)
}

/// 代理环境变量的串行锁。
///
/// 环境变量是**进程级全局状态**：同一测试二进制里的用例并行跑，谁在「设变量 →
/// 构造 client → 发请求 → 恢复变量」这段窗口里构造 client，就会读到别人设的代理。
/// 用这把锁把整段窗口串行化，避免互踩。
///
/// 用 `tokio::sync::Mutex` 而不是 `std::sync::Mutex`：锁必须跨 `await` 持有
/// （请求本身就在这个窗口里），持有 `std` 的 guard 跨 await 会触发
/// `clippy::await_holding_lock`，而门禁是 `-D warnings`。
static ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// reqwest 自动探测时会读的代理变量（三者都读，只设一个不足以复现劫持）。
const PROXY_ENV_VARS: [&str; 3] = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"];

/// 把代理变量指向一个不可达地址，`Drop` 时恢复原值。
///
/// 用 RAII 而不是在测试尾部手动 `remove_var`：断言 panic 时也必须恢复，
/// 否则会把污染留给同一二进制里后续的用例。
struct BogusProxyEnv {
    saved: Vec<(&'static str, Option<String>)>,
}

impl BogusProxyEnv {
    /// 调用方必须已持有 [`ENV_LOCK`]。
    fn install(unreachable_proxy: &str) -> Self {
        let saved = PROXY_ENV_VARS
            .iter()
            .map(|name| (*name, std::env::var(name).ok()))
            .collect();
        for name in PROXY_ENV_VARS {
            // SAFETY: 调用方持有 `ENV_LOCK`，本文件只有这一处改环境变量；
            // 且未配置代理的 client 一律 `no_proxy()`，并行用例不会读这三个变量。
            unsafe { std::env::set_var(name, unreachable_proxy) };
        }
        Self { saved }
    }
}

impl Drop for BogusProxyEnv {
    fn drop(&mut self) {
        for (name, value) in self.saved.drain(..) {
            // SAFETY: 与 `install` 同处一把 `ENV_LOCK` 的保护窗口内。
            match value {
                Some(value) => unsafe { std::env::set_var(name, value) },
                None => unsafe { std::env::remove_var(name) },
            }
        }
    }
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

/// 回归：reqwest 默认自动探测环境变量与宿主机系统代理（workspace 开了 `system-proxy`
/// feature），连回环流量也会被送进代理。没配 proxy 就必须显式 `no_proxy()`，
/// 否则在开了系统代理的机器上，所有本地 wiremock 用例都会被劫持。
///
/// 断言的是**行为**（请求成功拿到 body），不去断言 reqwest 内部的代理配置。
#[tokio::test]
async fn unset_proxy_ignores_proxy_env_and_reaches_chat_completions() {
    let server = MockServer::start().await;
    let payload = serde_json::json!({ "id": "chatcmpl-direct", "model": "deepseek-chat" });
    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&payload))
        .expect(1)
        .mount(&server)
        .await;

    let _serialized = ENV_LOCK.lock().await;
    // 端口 1 上没有服务：只要请求被送去这个代理就一定失败，直连才能成功。
    let _proxy_env = BogusProxyEnv::install("http://127.0.0.1:1");

    let transport = ReqwestTransport::new(Duration::from_secs(5), None).unwrap();
    let response = transport
        .send(request(format!("{}/chat/completions", server.uri())))
        .await
        .expect("未配置代理时应直连本地服务，不得被环境/系统代理劫持");

    assert_eq!(response.status, 200);
    assert!(response.is_success());
    let parsed: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(parsed["id"], "chatcmpl-direct");
}

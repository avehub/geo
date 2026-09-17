//! 传输层抽象：真实 HTTP（reqwest + rustls）与 fixture 回放。
//!
//! 上层客户端只依赖 `Transport` trait，因此测试可以完全离线：
//! 要么用 `wiremock` 起本地服务配 `ReqwestTransport`，要么用 `FixtureTransport`
//! 回放 `fixtures/llm/` 里的录制响应（见 `fixtures/llm/README.md`）。

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use sha2::{Digest, Sha256};

/// fixture key 的十六进制长度：`sha256(url + body)` 取前 16 位。
const FIXTURE_KEY_HEX_LEN: usize = 16;

/// 一次 HTTP 请求的最小描述。
///
/// API Key 只出现在 `headers` 里，任何日志都不得整体打印本结构体。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl HttpRequest {
    /// OpenAI 兼容服务统一用的 JSON POST 请求。
    pub fn bearer_json(url: impl Into<String>, api_key: &str, body: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            headers: vec![
                ("Authorization".to_string(), format!("Bearer {api_key}")),
                ("Content-Type".to_string(), "application/json".to_string()),
            ],
            body: body.into(),
        }
    }

    /// 大小写不敏感地取请求头，便于测试断言。
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// 一次 HTTP 响应的最小描述。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

impl HttpResponse {
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

/// 传输层错误：网络不可达、超时，以及 fixture 未命中等其它情况。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TransportError {
    #[error("网络连接失败：{0}")]
    Network(String),
    #[error("请求超时")]
    Timeout,
    #[error("传输层错误：{0}")]
    Other(String),
}

/// 传输抽象。真实实现走 reqwest，测试实现走 fixture 回放。
#[async_trait]
pub trait Transport: Send + Sync {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, TransportError>;
}

/// fixture key：`sha256(url + body)` 的前 16 位十六进制。
pub fn fixture_key(url: &str, body: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(url.as_bytes());
    hasher.update(body.as_bytes());
    hasher
        .finalize()
        .iter()
        .take(FIXTURE_KEY_HEX_LEN / 2)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// 真实 HTTP 传输：rustls（ring provider）、超时与可选代理。
#[derive(Debug, Clone)]
pub struct ReqwestTransport {
    client: reqwest::Client,
}

impl ReqwestTransport {
    /// 构造客户端。`timeout` 同时作为连接与整体读取超时。
    pub fn new(timeout: Duration, proxy: Option<String>) -> Result<Self, TransportError> {
        // workspace 里 reqwest 用的是 rustls-no-provider：进程内安装一次 ring provider，
        // 已安装时返回 Err，此处按约定忽略，保证多次构造不 panic。
        let _ = rustls::crypto::ring::default_provider().install_default();

        let mut builder = reqwest::Client::builder()
            .timeout(timeout)
            .connect_timeout(timeout);
        if let Some(proxy) = proxy
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            let parsed = reqwest::Proxy::all(&proxy)
                .map_err(|err| TransportError::Other(format!("代理地址无效：{err}")))?;
            builder = builder.proxy(parsed);
        }
        let client = builder
            .build()
            .map_err(|err| TransportError::Network(err.to_string()))?;
        Ok(Self { client })
    }
}

#[async_trait]
impl Transport for ReqwestTransport {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, TransportError> {
        let mut request = self.client.post(&req.url);
        for (name, value) in &req.headers {
            request = request.header(name.as_str(), value.as_str());
        }
        let response = request
            .body(req.body)
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(map_reqwest_error)?;
        Ok(HttpResponse { status, body })
    }
}

/// reqwest 错误归一化：超时单独成类，便于上层区分「重试」与「换网络」。
fn map_reqwest_error(err: reqwest::Error) -> TransportError {
    if err.is_timeout() {
        return TransportError::Timeout;
    }
    if err.is_connect() || err.is_request() {
        return TransportError::Network(err.to_string());
    }
    TransportError::Other(err.to_string())
}

/// 同一 key 的录制响应：单条时重复回放，多条时按调用顺序播放并停在最后一条。
#[derive(Debug)]
struct FixtureResponses {
    bodies: Vec<String>,
    cursor: Mutex<usize>,
}

impl FixtureResponses {
    fn new(bodies: Vec<String>) -> Self {
        Self {
            bodies,
            cursor: Mutex::new(0),
        }
    }

    fn next(&self) -> Option<&str> {
        if self.bodies.is_empty() {
            return None;
        }
        let mut cursor = self
            .cursor
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let index = (*cursor).min(self.bodies.len() - 1);
        *cursor = cursor.saturating_add(1);
        Some(self.bodies[index].as_str())
    }
}

/// 录制回放传输：测试专用，永不触网。
///
/// key 由 `fixture_key(url, body)` 计算；未命中返回带 key 的明确错误，
/// 方便照着提示补录 fixture。
#[derive(Debug, Default)]
pub struct FixtureTransport {
    responses: BTreeMap<String, FixtureResponses>,
}

impl FixtureTransport {
    /// 从目录加载 `*.json`：**文件名（去扩展名）即 fixture key**。
    ///
    /// 文件内容既可以是单条响应体，也可以是 `{"responses":[...]}` 顺序序列
    /// （约定见 `fixtures/llm/README.md`）。
    pub fn from_dir(path: &Path) -> Result<Self, TransportError> {
        let entries = std::fs::read_dir(path)
            .map_err(|err| TransportError::Other(format!("fixture 目录读取失败：{err}")))?;
        let mut responses = BTreeMap::new();
        for entry in entries {
            let entry = entry
                .map_err(|err| TransportError::Other(format!("fixture 目录读取失败：{err}")))?;
            let file_path = entry.path();
            if !file_path.is_file()
                || file_path.extension().and_then(|ext| ext.to_str()) != Some("json")
            {
                continue;
            }
            let key = file_path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .ok_or_else(|| {
                    TransportError::Other(format!("fixture 文件名非法：{}", file_path.display()))
                })?
                .to_string();
            let content = std::fs::read_to_string(&file_path)
                .map_err(|err| TransportError::Other(format!("fixture 读取失败：{err}")))?;
            responses.insert(key, FixtureResponses::new(parse_fixture_bodies(&content)));
        }
        Ok(Self { responses })
    }

    /// 直接用内存里的 `key → 响应体` 构造。
    pub fn from_map(responses: BTreeMap<String, String>) -> Self {
        Self {
            responses: responses
                .into_iter()
                .map(|(key, body)| (key, FixtureResponses::new(vec![body])))
                .collect(),
        }
    }
}

/// 解析 fixture 文件内容：`{"responses":[...]}` 展开为序列，其余原样作为单条响应体。
fn parse_fixture_bodies(content: &str) -> Vec<String> {
    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(value) => value,
        Err(_) => return vec![content.to_string()],
    };
    match parsed.get("responses").and_then(|value| value.as_array()) {
        Some(items) => items
            .iter()
            .map(serde_json::to_string)
            .filter_map(Result::ok)
            .collect(),
        None => vec![content.to_string()],
    }
}

#[async_trait]
impl Transport for FixtureTransport {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, TransportError> {
        let key = fixture_key(&req.url, &req.body);
        let recorded = self
            .responses
            .get(&key)
            .ok_or_else(|| TransportError::Other(format!("fixture miss: {key}")))?;
        match recorded.next() {
            Some(body) => Ok(HttpResponse {
                status: 200,
                body: body.to_string(),
            }),
            None => Err(TransportError::Other(format!("fixture 内容为空: {key}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "https://api.example.com/v1/chat/completions";
    const BODY: &str = r#"{"model":"deepseek-chat"}"#;

    fn request(body: &str) -> HttpRequest {
        HttpRequest::bearer_json(URL, "sk-test", body)
    }

    #[test]
    fn fixture_key_is_first_16_hex_of_sha256() {
        // 已知答案：printf '%s' '<url><body>' | shasum -a 256
        assert_eq!(fixture_key(URL, BODY), "a57e3f6a17b3cd70");
        assert_eq!(fixture_key(URL, BODY).len(), 16);
        assert!(fixture_key(URL, BODY)
            .chars()
            .all(|ch| ch.is_ascii_hexdigit()));
    }

    #[test]
    fn fixture_key_changes_with_url_or_body() {
        assert_ne!(
            fixture_key(URL, BODY),
            fixture_key(URL, r#"{"model":"kimi"}"#)
        );
        assert_ne!(
            fixture_key(URL, BODY),
            fixture_key("https://api.example.com/v2/chat/completions", BODY)
        );
        assert_eq!(fixture_key(URL, BODY), fixture_key(URL, BODY));
    }

    #[tokio::test]
    async fn bearer_json_request_carries_auth_and_content_type() {
        let req = request(BODY);
        assert_eq!(req.url, URL);
        assert_eq!(req.body, BODY);
        assert_eq!(req.header("content-type"), Some("application/json"));
        assert_eq!(req.header("authorization"), Some("Bearer sk-test"));
    }

    #[tokio::test]
    async fn fixture_transport_replays_recorded_response() {
        let recorded = r#"{"id":"chatcmpl-1","choices":[]}"#;
        let mut responses = BTreeMap::new();
        responses.insert(fixture_key(URL, BODY), recorded.to_string());
        let transport = FixtureTransport::from_map(responses);

        let response = transport.send(request(BODY)).await.unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body, recorded);
        assert!(response.is_success());
    }

    #[tokio::test]
    async fn fixture_transport_miss_reports_key() {
        let transport = FixtureTransport::from_map(BTreeMap::new());
        let error = transport.send(request(BODY)).await.unwrap_err();
        let message = error.to_string();
        assert!(message.contains("fixture miss"), "实际：{message}");
        assert!(message.contains(&fixture_key(URL, BODY)));
        assert!(
            matches!(&error, TransportError::Other(reason) if reason == &format!(
                "fixture miss: {}",
                fixture_key(URL, BODY)
            )),
            "错误详情需带上未命中的 key，便于补录 fixture"
        );
    }

    #[tokio::test]
    async fn from_dir_resolves_key_from_file_stem() {
        let dir = tempfile::tempdir().unwrap();
        let key = fixture_key(URL, BODY);
        std::fs::write(dir.path().join(format!("{key}.json")), BODY).unwrap();
        // 非 json 文件应被忽略
        std::fs::write(dir.path().join("README.md"), "忽略我").unwrap();

        let transport = FixtureTransport::from_dir(dir.path()).unwrap();
        let response = transport.send(request(BODY)).await.unwrap();
        assert_eq!(response.body, BODY);
    }

    #[tokio::test]
    async fn from_dir_replays_sequence_fixture_in_order() {
        let dir = tempfile::tempdir().unwrap();
        let key = fixture_key(URL, BODY);
        let sequence = r#"{"responses":[{"id":"bad"},{"id":"good"}]}"#;
        std::fs::write(dir.path().join(format!("{key}.json")), sequence).unwrap();

        let transport = FixtureTransport::from_dir(dir.path()).unwrap();
        assert_eq!(
            transport.send(request(BODY)).await.unwrap().body,
            r#"{"id":"bad"}"#
        );
        assert_eq!(
            transport.send(request(BODY)).await.unwrap().body,
            r#"{"id":"good"}"#
        );
        // 播完停在最后一条，保证重复调用仍然可用
        assert_eq!(
            transport.send(request(BODY)).await.unwrap().body,
            r#"{"id":"good"}"#
        );
    }

    #[test]
    fn reqwest_transport_can_be_built_twice() {
        // rustls 的 crypto provider 全局只能安装一次，第二次构造不应 panic。
        let first = ReqwestTransport::new(Duration::from_secs(5), None);
        let second = ReqwestTransport::new(
            Duration::from_secs(5),
            Some("http://127.0.0.1:7890".to_string()),
        );
        assert!(first.is_ok());
        assert!(second.is_ok());
        // 非法代理地址要给出可读错误，而不是构造出一个必然失败的客户端
        let invalid =
            ReqwestTransport::new(Duration::from_secs(5), Some("http://[::1".to_string()))
                .unwrap_err();
        assert!(invalid.to_string().contains("代理"), "实际：{invalid}");
    }
}

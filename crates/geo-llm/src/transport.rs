//! 传输层抽象：真实 HTTP（reqwest + rustls）与 fixture 回放。
//!
//! 上层客户端只依赖 `Transport` trait，因此测试可以完全离线：
//! 要么用 `wiremock` 起本地服务配 `ReqwestTransport`，要么用 `FixtureTransport`
//! 回放 `fixtures/llm/` 里的录制响应（见 `fixtures/llm/README.md`）。

use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use async_trait::async_trait;
use sha2::{Digest, Sha256};

/// fixture key 的十六进制长度：`sha256(url + body)` 取前 16 位。
const FIXTURE_KEY_HEX_LEN: usize = 16;

/// HTTP 方法。当前只需要 GET / POST。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum HttpMethod {
    Get,
    #[default]
    Post,
}

impl HttpMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
        }
    }
}

/// 一次 HTTP 请求的最小描述。
///
/// 🔴 密钥**不只在 `headers` 里**：Bing Webmaster 官方推荐的认证方式就是把 API Key 放进
/// `?apikey=…` 查询参数（见 `search_oauth.rs::fetch_bing_metrics`），别的接口也可能带
/// `key` / `token` / `access_token`。因此 [`Debug`] 是手写实现：敏感请求头**和** URL 查询串里
/// 的敏感参数值一律打码，即使上层把整个结构体丢进 `tracing::debug!` 或 panic 消息也不漏密钥。
///
/// 打码只作用于 `Debug` 视图：`url` / `headers` 字段本身仍是真实值，请求照原样发出去。
#[derive(Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub method: HttpMethod,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

/// 需要打码的请求头（小写比对）。
const SECRET_HEADERS: [&str; 4] = [
    "authorization",
    "proxy-authorization",
    "api-key",
    "x-api-key",
];

fn is_secret_header(name: &str) -> bool {
    SECRET_HEADERS
        .iter()
        .any(|secret| name.eq_ignore_ascii_case(secret))
}

/// 需要在 URL 查询串里打码的参数名（**整段**、大小写不敏感比对）。
///
/// 整段比对是刻意的：`monkey=` / `keyboard=` 这类形近参数不能被误伤，否则排查时
/// 连真正的入参都看不见。
const SECRET_QUERY_PARAMS: [&str; 4] = ["apikey", "key", "token", "access_token"];

fn is_secret_query_param(name: &str) -> bool {
    SECRET_QUERY_PARAMS
        .iter()
        .any(|secret| name.eq_ignore_ascii_case(secret))
}

/// 把 URL 查询串里的敏感参数值换成 `***`：参数名、其它参数与 fragment 原样保留。
///
/// 没有敏感参数时返回 `None`，`Debug` 直接渲染原串，不做无谓分配。
fn mask_secret_query(url: &str) -> Option<String> {
    let (base, query) = url.split_once('?')?;
    let mut masked_query = String::with_capacity(query.len());
    let mut changed = false;
    for (index, param) in query.split('&').enumerate() {
        if index > 0 {
            masked_query.push('&');
        }
        match param.split_once('=') {
            Some((name, _)) if is_secret_query_param(name) => {
                changed = true;
                masked_query.push_str(name);
                masked_query.push_str("=***");
            }
            _ => masked_query.push_str(param),
        }
    }
    changed.then(|| format!("{base}?{masked_query}"))
}

/// 只服务于 `Debug` 的 URL 视图：查询串里的敏感参数值换成 `***`。
struct MaskedUrl<'a>(&'a str);

impl fmt::Debug for MaskedUrl<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match mask_secret_query(self.0) {
            Some(masked) => fmt::Debug::fmt(masked.as_str(), f),
            None => fmt::Debug::fmt(self.0, f),
        }
    }
}

/// 只服务于 `Debug` 的请求头视图：敏感值换成 `***`，头名保留以便排查。
struct MaskedHeaders<'a>(&'a [(String, String)]);

impl fmt::Debug for MaskedHeaders<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut list = f.debug_list();
        for (name, value) in self.0 {
            if is_secret_header(name) {
                list.entry(&format_args!("{name}: ***"));
            } else {
                list.entry(&format_args!("{name}: {value}"));
            }
        }
        list.finish()
    }
}

impl fmt::Debug for HttpRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HttpRequest")
            .field("method", &self.method)
            .field("url", &MaskedUrl(&self.url))
            .field("headers", &MaskedHeaders(&self.headers))
            .field("body", &self.body)
            .finish()
    }
}

impl HttpRequest {
    /// OpenAI 兼容服务统一用的 JSON POST 请求。
    pub fn bearer_json(url: impl Into<String>, api_key: &str, body: impl Into<String>) -> Self {
        Self {
            method: HttpMethod::Post,
            url: url.into(),
            headers: vec![
                ("Authorization".to_string(), format!("Bearer {api_key}")),
                ("Content-Type".to_string(), "application/json".to_string()),
            ],
            body: body.into(),
        }
    }

    /// 只带请求头的 GET（模型清单等只读接口用）。
    pub fn get(url: impl Into<String>, headers: Vec<(String, String)>) -> Self {
        Self {
            method: HttpMethod::Get,
            url: url.into(),
            headers,
            body: String::new(),
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
///
/// `Display` 是紧凑日志格式（[`reason_key`](Self::reason_key) 打头，有底层原文时挂
/// `reason=`）。进 `params` 的**只有** `reason_key()`：清单给 `llm/transport` 登记的
/// 就是这三个 key，底层原文（可能夹带上游回显的 Authorization）只留给日志。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    Network(String),
    Timeout,
    Other(String),
}

impl TransportError {
    /// `llm/transport` 的 `reason` 取值：契约登记的三个稳定 key。
    pub fn reason_key(&self) -> &'static str {
        match self {
            Self::Network(_) => "network",
            Self::Timeout => "timeout",
            Self::Other(_) => "other",
        }
    }
}

impl fmt::Display for TransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.reason_key())?;
        match self {
            Self::Network(reason) | Self::Other(reason) => write!(f, " reason={reason}"),
            Self::Timeout => Ok(()),
        }
    }
}

impl std::error::Error for TransportError {}

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
    ///
    /// `proxy` 为 `None` 或空白时不走**任何**代理：必须显式 `no_proxy()`，否则
    /// reqwest 会自动探测环境变量与宿主机系统代理（workspace 开了 `system-proxy`
    /// feature），连回环流量也会被送进代理，语义就成了「没配代理反而走代理」。
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
        } else {
            builder = builder.no_proxy();
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
        let mut request = self.client.request(
            match req.method {
                HttpMethod::Get => reqwest::Method::GET,
                HttpMethod::Post => reqwest::Method::POST,
            },
            &req.url,
        );
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
///
/// 🔴 错误串里可能嵌着**完整 URL**（reqwest 的 Display 形如
/// `error sending request for url (https://…?siteUrl=a&apikey=SECRET)`），而
/// `client.rs` 会把 `TransportError` 写进滚动日志 ⇒ 进日志前必须抹掉查询串里的凭据值。
fn map_reqwest_error(err: reqwest::Error) -> TransportError {
    if err.is_timeout() {
        return TransportError::Timeout;
    }
    let masked = mask_secret_params(&err.to_string());
    if err.is_connect() || err.is_request() {
        return TransportError::Network(masked);
    }
    TransportError::Other(masked)
}

/// 抹掉文本里 `apikey=` / `key=` / `token=` / `access_token=` 的参数值（保留参数名）。
///
/// 值跑到 `&`、`)`、空白、引号或串尾为止；与 [`MaskedUrl`] 同一口径，但作用于
/// **任意错误文本**（reqwest 把 URL 嵌在句子里，拿不到 `Url` 对象）。
fn mask_secret_params(text: &str) -> String {
    const PARAMS: [&str; 4] = ["apikey=", "key=", "token=", "access_token="];
    let lower: Vec<char> = text.chars().flat_map(|c| c.to_lowercase()).collect();
    let chars: Vec<char> = text.chars().collect();
    let mut output = String::with_capacity(text.len());
    let mut index = 0;
    while index < chars.len() {
        // 最长优先匹配，避免 `access_token=` 被 `key=`/`token=` 抢先截断
        let hit = PARAMS
            .iter()
            .filter(|param| {
                let needle: Vec<char> = param.chars().collect();
                lower.len() >= index + needle.len()
                    && lower[index..index + needle.len()] == needle[..]
            })
            .max_by_key(|param| param.len());
        match hit {
            Some(param) => {
                output.push_str(param);
                let value_start = index + param.chars().count();
                let end = (value_start..chars.len())
                    .find(|position| matches!(chars[*position], '&' | ')' | '"' | '\'' | ' '))
                    .unwrap_or(chars.len());
                if end > value_start {
                    output.push_str("***");
                }
                index = end;
            }
            None => {
                output.push(chars[index]);
                index += 1;
            }
        }
    }
    output
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
    fn debug_output_masks_secret_headers() {
        let rendered = format!("{:?}", request(BODY));
        assert!(
            !rendered.contains("sk-test"),
            "Debug 输出不得回显密钥：{rendered}"
        );
        assert!(
            !format!("{:#?}", request(BODY)).contains("sk-test"),
            " pretty Debug 同样不得回显密钥"
        );
        // 排查仍需要看得见「有哪些头」与非敏感内容
        assert!(rendered.contains("Authorization"), "{rendered}");
        assert!(rendered.contains("Content-Type"), "{rendered}");
        assert!(rendered.contains(URL), "{rendered}");
        // body 里的引号会被 Debug 转义，这里只断言内容片段可见
        assert!(rendered.contains("deepseek-chat"), "{rendered}");
    }

    #[test]
    fn debug_output_masks_other_secret_header_names() {
        let req = HttpRequest {
            method: HttpMethod::Post,
            url: URL.to_string(),
            headers: vec![
                ("api-key".to_string(), "sk-qn-secret".to_string()),
                ("X-Api-Key".to_string(), "sk-hy-secret".to_string()),
                ("X-Trace-Id".to_string(), "trace-1".to_string()),
            ],
            body: BODY.to_string(),
        };
        let rendered = format!("{req:?}");
        assert!(!rendered.contains("sk-qn-secret"), "{rendered}");
        assert!(!rendered.contains("sk-hy-secret"), "{rendered}");
        assert!(
            rendered.contains("trace-1"),
            "非敏感头应原样可见：{rendered}"
        );
    }

    /// P2-06：Bing 官方推荐的认证方式是把 API Key 放进 `?apikey=…` 查询参数
    /// （见 `search_oauth.rs::fetch_bing_metrics`），所以 `url` 也必须打码，
    /// 不能只打码头。
    #[test]
    fn debug_output_masks_secret_query_params_in_the_url() {
        let req = HttpRequest {
            method: HttpMethod::Get,
            url: "https://x/?siteUrl=a&apikey=SECRET123".to_string(),
            headers: Vec::new(),
            body: String::new(),
        };
        let rendered = format!("{req:?}");
        assert!(!rendered.contains("SECRET123"), "{rendered}");
        assert!(
            !format!("{req:#?}").contains("SECRET123"),
            "pretty Debug 同样不得回显密钥"
        );
        // 排查仍需要看得见「带了哪些参数」：非敏感参数原样保留，敏感参数只留名字
        assert!(rendered.contains("siteUrl=a"), "{rendered}");
        assert!(rendered.contains("apikey="), "{rendered}");
        // 🔴 脱敏只作用于 Debug 视图：真正发出去的 URL 仍然带着 Key
        assert!(req.url.contains("apikey=SECRET123"), "{:?}", req.url);
    }

    #[test]
    fn debug_output_masks_every_secret_query_param_name() {
        let cases = [
            (
                "https://api.example.com/v1?siteUrl=a&key=KEY-SECRET",
                "KEY-SECRET",
            ),
            ("https://api.example.com/v1?token=TOK-SECRET", "TOK-SECRET"),
            (
                "https://api.example.com/v1?access_token=AT-SECRET&x=1",
                "AT-SECRET",
            ),
            // 参数名大小写不敏感
            ("https://api.example.com/v1?APIKEY=UP-SECRET", "UP-SECRET"),
            (
                "https://api.example.com/v1?ApiKey=Mixed-SECRET",
                "Mixed-SECRET",
            ),
            // 同名参数出现多次
            ("https://api.example.com/v1?apikey=S1&apikey=S2", "S1"),
        ];
        for (url, secret) in cases {
            let req = HttpRequest {
                method: HttpMethod::Get,
                url: url.to_string(),
                headers: Vec::new(),
                body: String::new(),
            };
            let rendered = format!("{req:?}");
            assert!(!rendered.contains(secret), "{url} -> {rendered}");
            assert!(rendered.contains("***"), "{url} -> {rendered}");
        }
        // 双份同名参数两份都要打码
        let both = format!(
            "{:?}",
            HttpRequest {
                method: HttpMethod::Get,
                url: "https://api.example.com/v1?apikey=S1&apikey=S2".to_string(),
                headers: Vec::new(),
                body: String::new(),
            }
        );
        assert!(!both.contains("S2"), "{both}");
    }

    /// 参数名是**整段**比对：形近的名字（`monkey` / `keyboard`）不能被误伤，
    /// 否则排查时看不到真正的入参。
    #[test]
    fn debug_output_keeps_lookalike_params_visible() {
        let req = HttpRequest {
            method: HttpMethod::Get,
            url: "https://api.example.com/v1?monkey=plain&keyboard=layout&keys=1".to_string(),
            headers: Vec::new(),
            body: String::new(),
        };
        let rendered = format!("{req:?}");
        assert!(rendered.contains("monkey=plain"), "{rendered}");
        assert!(rendered.contains("keyboard=layout"), "{rendered}");
        assert!(rendered.contains("keys=1"), "{rendered}");
    }

    #[test]
    fn debug_output_leaves_urls_without_secret_params_untouched() {
        let url = "https://api.example.com/v1/chat/completions?model=deepseek-chat";
        let req = HttpRequest {
            method: HttpMethod::Get,
            url: url.to_string(),
            headers: Vec::new(),
            body: String::new(),
        };
        assert!(format!("{req:?}").contains(url), "{req:?}");
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

    /// Task 4：`llm/transport` 的 `reason` 必须是这三个稳定 key（契约 note 早就这么写），
    /// 而不是底层原文——原文只进日志，不进 params。
    #[test]
    fn reason_key_is_one_of_the_three_catalog_keys() {
        assert_eq!(
            TransportError::Network("conn refused".into()).reason_key(),
            "network"
        );
        assert_eq!(TransportError::Timeout.reason_key(), "timeout");
        assert_eq!(
            TransportError::Other("fixture miss".into()).reason_key(),
            "other"
        );
    }

    /// `Display` 转紧凑日志格式：`{reason_key}` 打头，有底层原文时挂 `reason=`。
    #[test]
    fn display_is_compact_log_format() {
        assert_eq!(TransportError::Timeout.to_string(), "timeout");
        assert_eq!(
            TransportError::Network("conn refused".into()).to_string(),
            "network reason=conn refused"
        );
        assert_eq!(
            TransportError::Other("fixture miss: abc".into()).to_string(),
            "other reason=fixture miss: abc"
        );
    }

    /// `Display` / `Error` 改成手写之后，`TransportError` 仍是标准错误类型
    /// （`Box<dyn Error>` 可用）。
    #[test]
    fn transport_error_is_a_std_error() {
        fn as_std_error(error: &dyn std::error::Error) -> String {
            error.to_string()
        }
        assert_eq!(as_std_error(&TransportError::Timeout), "timeout");
    }

    #[test]
    fn mask_secret_params_redacts_query_values_in_error_text() {
        let text = "error sending request for url (https://ssl.bing.com/api.svc/json/GetQueryStats?siteUrl=https%3A%2F%2Fx.cn&apikey=SECRET123)";
        let masked = super::mask_secret_params(text);
        assert!(!masked.contains("SECRET123"), "{masked}");
        assert!(masked.contains("apikey=***"), "{masked}");
        assert!(masked.contains("siteUrl=https%3A%2F%2Fx.cn"), "{masked}");
    }

    #[test]
    fn mask_secret_params_leaves_ordinary_text_alone() {
        assert_eq!(
            super::mask_secret_params("timeout waiting for pool"),
            "timeout waiting for pool"
        );
        // 没有值的参数名不被改写
        assert_eq!(
            super::mask_secret_params("missing key= in config"),
            "missing key= in config"
        );
    }
}

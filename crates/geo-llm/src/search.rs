//! 官方 AI 搜索接口的最小客户端。
//!
//! 目标不是“再包一层 LLM”，而是把**搜索结果**作为采集的一等输入：
//! 先向引擎官方搜索/检索接口拿结构化结果，再让该引擎自己的对话模型基于结果回答。
//! 这样引用链接、来源站点与标题都来自平台返回，而不是模型在正文里“自述来源”。
//!
//! 已接：
//! - Kimi `POST /v1/tools/search`
//! - 百度千帆 `POST /v2/ai_search/web_search`
//! - 火山豆包搜索 `POST /search_api/web_search`
//! - 秘塔 `POST /v1/search`（不同账号返回字段略有差异，解析器做容错）
//!
//! 所有请求都走 [`Transport`]，测试用 fixture / wiremock，不联网。
//! API Key 只进请求头；`SearchClient` 的 Debug 不打印 Key。

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{library_reason, LlmError, REASON_PARSE_FAILED};
use crate::transport::{HttpRequest, Transport, TransportError};

/// 一条搜索结果。字段刻意保持语言中立：只存平台返回的数据，不在这里翻译。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchHit {
    pub title: String,
    pub url: String,
    #[serde(default)]
    pub snippet: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub site_name: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub authority: Option<String>,
}

/// 已接入的官方搜索接口。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchEngine {
    Kimi,
    Baidu,
    Doubao,
    Metaso,
}

impl SearchEngine {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Kimi => "kimi",
            Self::Baidu => "baidu",
            Self::Doubao => "doubao",
            Self::Metaso => "metaso",
        }
    }

    fn default_endpoint(&self) -> &'static str {
        match self {
            Self::Kimi => "https://api.moonshot.cn/v1/tools/search",
            Self::Baidu => "https://qianfan.baidubce.com/v2/ai_search/web_search",
            Self::Doubao => "https://open.feedcoopapi.com/search_api/web_search",
            Self::Metaso => "https://api.metaso.cn/v1/search",
        }
    }
}

/// 官方搜索客户端。`endpoint` 可覆盖，测试/企业网关用。
#[derive(Clone)]
pub struct SearchClient {
    engine: SearchEngine,
    endpoint: String,
    api_key: String,
    transport: Arc<dyn Transport>,
}

impl std::fmt::Debug for SearchClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SearchClient")
            .field("engine", &self.engine)
            .field("endpoint", &self.endpoint)
            .field("api_key", &"<redacted>")
            .finish()
    }
}

impl SearchClient {
    pub fn new(
        engine: SearchEngine,
        api_key: impl Into<String>,
        transport: Arc<dyn Transport>,
    ) -> Self {
        Self {
            engine,
            endpoint: engine.default_endpoint().to_string(),
            api_key: api_key.into(),
            transport,
        }
    }

    /// 企业网关 / 测试服务器用：覆盖默认 endpoint。
    pub fn with_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.endpoint = endpoint.into();
        self
    }

    pub fn engine(&self) -> SearchEngine {
        self.engine
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// 发起一次搜索。失败只回稳定错误码，不把响应正文塞进错误。
    pub async fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>, LlmError> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let limit = limit.clamp(1, 50);
        let body = match self.engine {
            SearchEngine::Kimi => json!({
                "text_query": query,
                "limit": limit,
                "timeout_seconds": 20,
                "include_content": true,
            }),
            SearchEngine::Baidu => json!({
                "messages": [{ "role": "user", "content": query }],
                "search_source": "baidu_search_v2",
                "resource_type_filter": [{ "type": "web", "top_k": limit }],
                "query_policy": { "enable_rewrite": true },
            }),
            SearchEngine::Doubao => json!({
                "Query": query,
                "SearchType": "web",
                "Count": limit,
                "Filter": { "NeedContent": true, "NeedUrl": true },
                "QueryControl": { "QueryRewrite": false },
            }),
            SearchEngine::Metaso => json!({
                "query": query,
                "mode": "web",
                "sources": ["web"],
                "includeSummary": true,
            }),
        };
        let request = HttpRequest::bearer_json(&self.endpoint, &self.api_key, body.to_string());
        let response = self
            .transport
            .send(request)
            .await
            .map_err(map_transport_error)?;
        if !response.is_success() {
            return Err(match response.status {
                429 => LlmError::RateLimited,
                status => LlmError::Server { status },
            });
        }
        let payload: Value = serde_json::from_str(&response.body).map_err(|error| {
            LlmError::bad_response(REASON_PARSE_FAILED).with_param("value", library_reason(&error))
        })?;
        Ok(match self.engine {
            SearchEngine::Kimi => parse_kimi(&payload),
            SearchEngine::Baidu => parse_baidu(&payload),
            SearchEngine::Doubao => parse_doubao(&payload),
            SearchEngine::Metaso => parse_tolerant(&payload),
        })
    }
}

fn map_transport_error(error: TransportError) -> LlmError {
    LlmError::Transport(error)
}

fn parse_kimi(payload: &Value) -> Vec<SearchHit> {
    payload
        .get("search_results")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().filter_map(hit_from_value).collect())
        .unwrap_or_default()
}

fn parse_baidu(payload: &Value) -> Vec<SearchHit> {
    payload
        .get("references")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let title = string_field(row, &["title", "web_anchor"])?;
                    let url = string_field(row, &["url", "link"])?;
                    Some(SearchHit {
                        title,
                        url,
                        snippet: string_field(row, &["snippet", "content"]).unwrap_or_default(),
                        content: string_field(row, &["content"]),
                        site_name: string_field(row, &["website", "site_name"]),
                        date: string_field(row, &["date", "publish_time"]),
                        authority: string_field(row, &["web_anchor", "type"]),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_doubao(payload: &Value) -> Vec<SearchHit> {
    payload
        .get("Result")
        .and_then(|result| result.get("WebResults"))
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    let title = string_field(row, &["Title", "title"])?;
                    let url = string_field(row, &["Url", "url"])?;
                    Some(SearchHit {
                        title,
                        url,
                        snippet: string_field(row, &["Summary", "Snippet"]).unwrap_or_default(),
                        content: string_field(row, &["Content", "Summary"]),
                        site_name: string_field(row, &["SiteName", "site_name"]),
                        date: string_field(row, &["PublishTime", "publish_time"]),
                        authority: string_field(row, &["AuthInfoDes", "AuthInfoLevel"]),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 秘塔的返回形状随账号/版本变化：递归找“同时有 title 与 url 的对象”，并去重。
fn parse_tolerant(payload: &Value) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    collect_hits(payload, &mut hits);
    let mut seen = std::collections::HashSet::new();
    hits.retain(|hit| seen.insert(hit.url.clone()));
    hits
}

fn collect_hits(value: &Value, out: &mut Vec<SearchHit>) {
    match value {
        Value::Array(rows) => rows.iter().for_each(|row| collect_hits(row, out)),
        Value::Object(map) => {
            if let Some(hit) = hit_from_value(value) {
                out.push(hit);
                return;
            }
            for child in map.values() {
                collect_hits(child, out);
            }
        }
        _ => {}
    }
}

fn hit_from_value(value: &Value) -> Option<SearchHit> {
    let title = string_field(value, &["title", "name", "web_anchor"])?;
    let url = string_field(value, &["url", "link", "href"])?;
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return None;
    }
    Some(SearchHit {
        title,
        url,
        snippet: string_field(value, &["snippet", "summary", "description"]).unwrap_or_default(),
        content: string_field(value, &["content", "text", "summary"]),
        site_name: string_field(value, &["site_name", "siteName", "website"]),
        date: string_field(value, &["date", "publish_time", "publishTime"]),
        authority: string_field(value, &["authority", "auth_info", "rank_score"]),
    })
}

/// 大小写不敏感地取第一个非空字符串字段；数字也转成字符串（部分搜索接口的 rank/权威度是数字）。
pub(crate) fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    for key in keys {
        let found = object
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(key))
            .map(|(_, value)| value)?;
        let text = match found {
            Value::String(text) => text.trim().to_string(),
            Value::Number(number) => number.to_string(),
            Value::Bool(flag) => flag.to_string(),
            _ => continue,
        };
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

/// 把 Qwen `search_info.search_results` 之类的数组转成统一 hit。
pub(crate) fn hits_from_search_info(value: &Value) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    collect_hits(value, &mut hits);
    hits
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::{HttpResponse, Transport};
    use async_trait::async_trait;
    use std::sync::Mutex;

    #[derive(Default)]
    struct StaticTransport {
        body: String,
        requests: Mutex<Vec<HttpRequest>>,
    }

    #[async_trait]
    impl Transport for StaticTransport {
        async fn send(&self, req: HttpRequest) -> Result<HttpResponse, TransportError> {
            self.requests.lock().unwrap().push(req);
            Ok(HttpResponse {
                status: 200,
                body: self.body.clone(),
            })
        }
    }

    fn test_client(engine: SearchEngine, body: &str) -> (SearchClient, Arc<StaticTransport>) {
        let transport = Arc::new(StaticTransport {
            body: body.to_string(),
            ..Default::default()
        });
        (
            SearchClient::new(engine, "test-key", transport.clone()),
            transport,
        )
    }

    #[tokio::test]
    async fn kimi_search_maps_results_and_never_puts_the_key_in_the_body() {
        let body = r#"{"search_results":[{"title":"标题","url":"https://example.com/a","snippet":"摘要","site_name":"站点"}]}"#;
        let (client, transport) = test_client(SearchEngine::Kimi, body);
        let hits = client.search("  问题  ", 5).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "标题");
        assert_eq!(hits[0].url, "https://example.com/a");
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].header("authorization"), Some("Bearer test-key"));
        assert!(!requests[0].body.contains("test-key"));
        assert!(requests[0].body.contains("\"text_query\":\"问题\""));
    }

    #[tokio::test]
    async fn baidu_and_doubao_use_their_native_request_shapes() {
        let baidu = r#"{"references":[{"title":"百度结果","url":"https://example.com/b","snippet":"s","website":"站点"}]}"#;
        let (client, transport) = test_client(SearchEngine::Baidu, baidu);
        let hits = client.search("问题", 10).await.unwrap();
        assert_eq!(hits[0].title, "百度结果");
        let baidu_body = {
            let requests = transport.requests.lock().unwrap();
            requests[0].body.clone()
        };
        assert!(baidu_body.contains("baidu_search_v2"));
        assert!(baidu_body.contains("resource_type_filter"));

        let doubao = r#"{"Result":{"WebResults":[{"Title":"豆包结果","Url":"https://example.com/c","Summary":"摘要","AuthInfoDes":"非常权威"}]}}"#;
        let (client, transport) = test_client(SearchEngine::Doubao, doubao);
        let hits = client.search("问题", 10).await.unwrap();
        assert_eq!(hits[0].title, "豆包结果");
        let doubao_body = {
            let requests = transport.requests.lock().unwrap();
            requests[0].body.clone()
        };
        assert!(doubao_body.contains("\"SearchType\":\"web\""));
    }

    #[tokio::test]
    async fn metaso_parser_is_tolerant_of_nested_shapes_and_dedupes_urls() {
        let body = r#"{"data":{"webpages":[
            {"title":"A","url":"https://example.com/a","summary":"s"},
            {"title":"A again","url":"https://example.com/a","summary":"s"},
            {"nested":{"title":"B","url":"https://example.com/b"}}
        ]}}"#;
        let (client, _) = test_client(SearchEngine::Metaso, body);
        let hits = client.search("问题", 10).await.unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].url, "https://example.com/a");
        assert_eq!(hits[1].url, "https://example.com/b");
    }

    #[tokio::test]
    async fn empty_query_does_not_send_a_request() {
        let (client, transport) = test_client(SearchEngine::Kimi, "{}");
        assert!(client.search("   ", 10).await.unwrap().is_empty());
        assert!(transport.requests.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn non_2xx_maps_to_stable_errors_without_the_body() {
        struct FailTransport;
        #[async_trait]
        impl Transport for FailTransport {
            async fn send(&self, _req: HttpRequest) -> Result<HttpResponse, TransportError> {
                Ok(HttpResponse {
                    status: 429,
                    body: "secret body".into(),
                })
            }
        }
        let client = SearchClient::new(SearchEngine::Kimi, "k", Arc::new(FailTransport));
        assert!(matches!(
            client.search("q", 5).await,
            Err(LlmError::RateLimited)
        ));
    }
}

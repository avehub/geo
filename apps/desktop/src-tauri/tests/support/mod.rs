//! 集成测试替身：可编程 LLM 传输、wiremock 站点、离线 `AppState`。
//!
//! 红线（`AGENTS.md` 规则 2）：这里的任何测试都不得访问真实网络——
//! HTTP 由 wiremock 回放 `fixtures/http/`，LLM 由脚本传输回放 `fixtures/llm/`。
//!
//! 之所以自己实现脚本传输而不直接用 `FixtureTransport`：`chat_json` 的修复重试
//! 会改变请求体，`sha256(url+body)` 的 key 每次都不同；而自动建档的正文又来自
//! 抓取结果，key 无法预先录制。按调用顺序回放既确定又能复用真实录制内容。

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use geo_crawler::{FetchLimits, SiteFetcher};
use geo_domain::{CompetitorDraft, Industry, Language, ProductSpec, Project, ProjectDraft};
use geo_llm::transport::{HttpRequest, HttpResponse, Transport, TransportError};
use geo_llm::LlmProvider;
use geo_store::{MemorySecretStore, SecretStore};
use url::Url;
use wiremock::MockServer;

use geo_desktop_lib::services::ProjectService;
use geo_desktop_lib::state::{AppState, LlmFactory, MAX_CRAWL_PAGES, USER_AGENT};

/// 仓库根目录（`CARGO_MANIFEST_DIR` = `apps/desktop/src-tauri`）。
pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

pub fn http_fixtures_dir() -> PathBuf {
    repo_root().join("fixtures/http")
}

pub fn llm_fixtures_dir() -> PathBuf {
    repo_root().join("fixtures/llm")
}

/// 读取夹具原始字节（GBK 夹具必须按字节读）。
pub fn fixture_bytes(dir: &Path, name: &str) -> Vec<u8> {
    std::fs::read(dir.join(name)).unwrap_or_else(|error| panic!("读取夹具 {name} 失败：{error}"))
}

/// 读取 `fixtures/llm/<name>.json` 并按约定展开成响应体序列：
/// `{"responses":[...]}` → 多条顺序响应；否则整份文件即单条响应。
pub fn llm_bodies(name: &str) -> Vec<String> {
    let bytes = fixture_bytes(&llm_fixtures_dir(), &format!("{name}.json"));
    let content = String::from_utf8(bytes).expect("LLM 夹具是 UTF-8");
    let parsed: serde_json::Value = serde_json::from_str(&content)
        .unwrap_or_else(|error| panic!("夹具 {name} 非法 JSON：{error}"));
    match parsed.get("responses").and_then(|value| value.as_array()) {
        Some(items) => items
            .iter()
            .map(serde_json::to_string)
            .filter_map(Result::ok)
            .collect(),
        None => vec![content],
    }
}

/// 把模型输出包成 OpenAI 兼容响应体（测试里现编响应时用）。
pub fn openai_response(content: &str) -> String {
    serde_json::json!({
        "id": "chatcmpl-test",
        "model": "test-model",
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": content },
            "finish_reason": "stop",
        }],
        "usage": { "prompt_tokens": 120, "completion_tokens": 80, "total_tokens": 200 }
    })
    .to_string()
}

/// 按调用顺序回放响应体的传输替身，同时记录收到的请求（可断言提示词内容）。
#[derive(Debug, Default)]
pub struct ScriptedTransport {
    bodies: Vec<String>,
    cursor: Mutex<usize>,
    requests: Mutex<Vec<HttpRequest>>,
}

impl ScriptedTransport {
    pub fn new(bodies: Vec<String>) -> Arc<Self> {
        Arc::new(Self {
            bodies,
            ..Self::default()
        })
    }

    pub fn request_count(&self) -> usize {
        self.requests.lock().expect("lock").len()
    }

    pub fn requests(&self) -> Vec<HttpRequest> {
        self.requests.lock().expect("lock").clone()
    }
}

#[async_trait]
impl Transport for ScriptedTransport {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, TransportError> {
        self.requests.lock().expect("lock").push(req);
        if self.bodies.is_empty() {
            return Err(TransportError::Other("脚本响应为空".to_string()));
        }
        let mut cursor = self.cursor.lock().expect("lock");
        let index = (*cursor).min(self.bodies.len() - 1);
        *cursor = cursor.saturating_add(1);
        Ok(HttpResponse {
            status: 200,
            body: self.bodies[index].clone(),
        })
    }
}

/// 永远失败的传输：用来验证「LLM 不可用时降级而不是报错」。
#[derive(Debug, Default)]
pub struct OfflineTransport {
    calls: Mutex<usize>,
}

impl OfflineTransport {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn call_count(&self) -> usize {
        *self.calls.lock().expect("lock")
    }
}

#[async_trait]
impl Transport for OfflineTransport {
    async fn send(&self, _req: HttpRequest) -> Result<HttpResponse, TransportError> {
        *self.calls.lock().expect("lock") += 1;
        Err(TransportError::Other("离线：无可用模型".to_string()))
    }
}

/// 模拟「把 Authorization 头回显进错误体」的网关/代理。
///
/// 现实里这类上游会把 `Bearer sk-...` 原样贴回 4xx 响应，因此它是验证
/// 「密钥不外泄到 UI / notes / 日志」（AGENTS 规则 3）的最坏输入。
#[derive(Debug, Default)]
pub struct KeyEchoingTransport;

impl KeyEchoingTransport {
    pub fn new() -> Arc<Self> {
        Arc::new(Self)
    }
}

#[async_trait]
impl Transport for KeyEchoingTransport {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, TransportError> {
        let auth = req
            .headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("authorization"))
            .map(|(_, value)| value.clone())
            .unwrap_or_default();
        Err(TransportError::Other(format!("上游 401：{auth} 无效")))
    }
}

/// 挂载 `fixtures/http/` 的虚构企业站（宏宇泵业），`server.uri()` 即站点根。
pub async fn mount_fixture_site(server: &MockServer) {
    for (path, fixture) in [
        ("/", "index.html"),
        ("/about.html", "about.html"),
        ("/products.html", "products.html"),
        ("/faq.html", "faq.html"),
        ("/contact.html", "contact.html"),
        ("/admin/secret", "admin.html"),
    ] {
        mount_raw(
            server,
            path,
            &fixture_bytes(&http_fixtures_dir(), fixture),
            "text/html; charset=utf-8",
        )
        .await;
    }
    mount_raw(
        server,
        "/robots.txt",
        &fixture_bytes(&http_fixtures_dir(), "robots.txt"),
        "text/plain; charset=utf-8",
    )
    .await;
}

async fn mount_raw(server: &MockServer, path: &str, bytes: &[u8], mime: &str) {
    wiremock::Mock::given(wiremock::matchers::method("GET"))
        .and(wiremock::matchers::path(path))
        .respond_with(wiremock::ResponseTemplate::new(200).set_body_raw(bytes.to_vec(), mime))
        .mount(server)
        .await;
}

/// 测试用抓取限额：够跑完 5 页夹具站，超时收紧以便失败快速暴露。
pub fn test_limits() -> FetchLimits {
    FetchLimits {
        max_pages: MAX_CRAWL_PAGES,
        per_page_timeout: Duration::from_secs(5),
        total_timeout: Duration::from_secs(20),
        max_bytes: 2 * 1024 * 1024,
    }
}

pub fn test_fetcher() -> Arc<SiteFetcher> {
    Arc::new(SiteFetcher::new(test_limits(), USER_AGENT, None).expect("抓取器可构造"))
}

/// 离线 `AppState`：内存 SQLite + 内存钥匙串 + 指定传输 + 指向 wiremock 的抓取器。
///
/// 返回的 `MockServer` 必须与 `AppState` 同生命周期（持有它，站点才在线）。
/// 不预置 API Key（要 Key 用 [`state_with_transport`]）。
pub async fn test_state(
    transport: Arc<dyn Transport>,
) -> (AppState, MockServer, Arc<MemorySecretStore>) {
    let server = MockServer::start().await;
    mount_fixture_site(&server).await;
    let (state, secrets) = state_with_pool(transport).await;
    (state, server, secrets)
}

/// 站点一个页面都没有（wiremock 全 404）：验证「一页也抓不到」时的中文错误。
pub async fn empty_site_state() -> (AppState, MockServer, Arc<MemorySecretStore>) {
    let server = MockServer::start().await;
    let (state, secrets) = state_with_pool(OfflineTransport::new()).await;
    (state, server, secrets)
}

async fn state_with_pool(transport: Arc<dyn Transport>) -> (AppState, Arc<MemorySecretStore>) {
    let pool = geo_store::open_in_memory().await.expect("内存库可用");
    let secrets = Arc::new(MemorySecretStore::default());
    let state = AppState::for_test(
        pool,
        secrets.clone(),
        Arc::new(LlmFactory::new(transport)),
        test_fetcher(),
    );
    (state, secrets)
}

/// 同 [`test_state`]，但按默认 provider（deepseek）预置一把测试 Key。
pub async fn state_with_transport(
    transport: Arc<dyn Transport>,
) -> (AppState, MockServer, Arc<MemorySecretStore>) {
    let (state, server, secrets) = test_state(transport).await;
    seed_secret(&secrets).await;
    (state, server, secrets)
}

/// 用指定响应序列装配 `AppState` 并预置 Key。
///
/// 序列语义与 `ScriptedTransport` 一致：按调用顺序回放，播完停在最后一条。
pub async fn state_with_bodies(
    bodies: Vec<String>,
) -> (AppState, MockServer, Arc<MemorySecretStore>) {
    state_with_transport(ScriptedTransport::new(bodies)).await
}

/// 自动建档用：回放录制的实体卡抽取响应。
pub async fn entity_card_state() -> (AppState, MockServer, Arc<MemorySecretStore>) {
    state_with_bodies(llm_bodies("entity_card")).await
}

/// 结构化输出修复重试用：首次响应非法，第二次成功。
pub async fn invalid_then_ok_state() -> (AppState, MockServer, Arc<MemorySecretStore>) {
    state_with_bodies(llm_bodies("entity_card_invalid_then_ok")).await
}

/// 题库生成用：意图扩写 + 口语化改写两次调用。
pub async fn prompt_state() -> (AppState, MockServer, Arc<MemorySecretStore>) {
    let bodies = [llm_bodies("prompt_expand"), llm_bodies("prompt_rewrite")].concat();
    state_with_bodies(bodies).await
}

/// LLM 完全不可用（传输永远失败）：验证降级路径。
pub async fn offline_state() -> (AppState, MockServer, Arc<MemorySecretStore>) {
    state_with_transport(OfflineTransport::new()).await
}

/// 没配 Key：自动建档同样必须降级而不是报错。
pub async fn state_without_secret() -> (AppState, MockServer, Arc<MemorySecretStore>) {
    let bodies = [llm_bodies("entity_card"), llm_bodies("prompt_expand")].concat();
    test_state(ScriptedTransport::new(bodies)).await
}

/// 默认 provider 的密钥引用串。**必须**由 `LlmProvider::as_str()` 推出，
/// 手写字符串会与 `config_from_settings` 的取值口径漂移（`deep_seek` ≠ `deepseek`）。
pub fn default_secret_ref() -> String {
    geo_store::secret_ref("llm", LlmProvider::DeepSeek.as_str())
}

/// 按 `AppSettings::default()` 的 provider 写入一把测试 Key（值仅存在于内存钥匙串）。
pub async fn seed_secret(secrets: &MemorySecretStore) {
    secrets
        .set(&default_secret_ref(), TEST_API_KEY)
        .await
        .expect("内存钥匙串可写");
}

/// 测试用假 Key。断言「密钥不外泄」时用它当 canary。
pub const TEST_API_KEY: &str = "sk-test-offline";

/// 固定时间戳：领域对象的时间一律由调用方注入，测试必须可复现。
pub fn now() -> DateTime<Utc> {
    DateTime::from_timestamp(1_789_000_000, 0).expect("固定时间戳")
}

/// 建项向导样本：B2B 制造（宏宇泵业），3 家竞品、2 条产品线。
pub fn sample_draft() -> ProjectDraft {
    ProjectDraft {
        brand_name: "宏宇泵业".to_string(),
        aliases: vec!["上海宏宇水泵".to_string(), "Hongyu Pump".to_string()],
        name: Some("宏宇泵业 GEO 项目".to_string()),
        website: Some("https://www.hongyu-pump.example".to_string()),
        core_pages: vec!["https://www.hongyu-pump.example/products.html".to_string()],
        products: vec![
            ProductSpec {
                name: "HY-ISG 立式管道离心泵".to_string(),
                params: vec!["流量 6～400 m³/h".to_string(), "扬程 15～125 m".to_string()],
                note: Some("楼宇二次供水与暖通循环".to_string()),
            },
            ProductSpec {
                name: "HY-WQ 潜水排污泵".to_string(),
                params: vec!["流量 10～600 m³/h".to_string()],
                note: None,
            },
        ],
        service_scope: Some("全国 26 个省级行政区".to_string()),
        region: Some("上海".to_string()),
        language: Language::ZhCn,
        industry: Industry::B2bManufacturing,
        industry_label: None,
        tags: vec!["工业水泵".to_string()],
        competitors: vec![
            CompetitorDraft {
                name: "南方泵业".to_string(),
                aliases: vec!["CNP".to_string()],
                website: Some("https://www.nanfang-pump.example".to_string()),
                note: None,
            },
            CompetitorDraft {
                name: "凯泉泵业".to_string(),
                aliases: vec![],
                website: None,
                note: Some("华东渠道强".to_string()),
            },
            CompetitorDraft {
                name: "格兰富".to_string(),
                aliases: vec!["Grundfos".to_string()],
                website: None,
                note: None,
            },
        ],
    }
}

/// 建一个带 3 家竞品的项目，返回落库后的 `Project`。
pub async fn seeded_project(state: &AppState) -> Project {
    ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目成功")
}

/// wiremock 站点根（含末尾斜杠的 origin 字符串）。
pub fn site_origin(server: &MockServer) -> Url {
    Url::parse(&server.uri()).expect("wiremock 地址可解析")
}

//! M5.5 站长数据服务集成测试（Plan C 第五切片第一段）。

mod support;

use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use geo_domain::{
    ProjectId, SearchActionLevel, SearchCompleteness, SearchOpportunity, SearchOpportunityId,
    SearchOpportunityStatus, SearchPrescriptionCategory, SearchSourceKind, SearchSurface,
    SiteChannelStatus, SiteCredentialsState, WindowSource,
};
use geo_llm::transport::{HttpMethod, HttpRequest, HttpResponse, Transport, TransportError};
use geo_store::{SearchRepo, SecretStore};
use support::{now, sample_draft, test_state, OfflineTransport, ScriptedTransport};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use geo_desktop_lib::services::{
    fetch_bing_metrics, fetch_gsc_metrics, oauth_exchange, BingAuth, GscFlowError, ProjectService,
    SearchService,
};

async fn project(state: &geo_desktop_lib::state::AppState) -> ProjectId {
    ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目")
        .id
}

fn binding(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect()
}

/// 可指定 HTTP 状态码的传输替身：token 4xx 这类负路径不能靠只回 200 的
/// `ScriptedTransport` 表达。
#[derive(Default)]
struct CodedTransport {
    replies: Mutex<VecDeque<(u16, String)>>,
    requests: Mutex<Vec<HttpRequest>>,
}

impl CodedTransport {
    fn new(replies: Vec<(u16, &str)>) -> Arc<Self> {
        Arc::new(Self {
            replies: Mutex::new(
                replies
                    .into_iter()
                    .map(|(status, body)| (status, body.to_string()))
                    .collect(),
            ),
            requests: Mutex::new(Vec::new()),
        })
    }

    fn requests(&self) -> Vec<HttpRequest> {
        self.requests.lock().expect("lock").clone()
    }
}

#[async_trait]
impl Transport for CodedTransport {
    async fn send(&self, req: HttpRequest) -> Result<HttpResponse, TransportError> {
        self.requests.lock().expect("lock").push(req);
        let reply = self
            .replies
            .lock()
            .expect("lock")
            .pop_front()
            .ok_or_else(|| TransportError::Other("脚本响应为空".to_string()))?;
        Ok(HttpResponse {
            status: reply.0,
            body: reply.1,
        })
    }
}

fn token_body() -> String {
    serde_json::json!({
        "access_token": "ya29.test-access",
        "refresh_token": "1//test-refresh",
        "expires_in": 3600,
        "token_type": "Bearer"
    })
    .to_string()
}

fn bing_stats_body() -> String {
    serde_json::json!({
        "d": [
            {
                "Query": "dust collector",
                "Impressions": 300,
                "Clicks": 12,
                "Ctr": 0.04,
                "Date": "2026-09-20"
            },
            {
                "query": "bag filter",
                "IMPRESSIONS": 120,
                "CLICKS": 4,
                "CTR": 0.0333,
                "date": "2026-09-21"
            }
        ]
    })
    .to_string()
}

fn gsc_body() -> String {
    serde_json::json!({
        "rows": [
            {
                "keys": ["dust collector", "https://example.com/products/bag-filter"],
                "clicks": 12.0,
                "impressions": 300.0,
                "ctr": 0.04
            },
            {
                "keys": ["bag filter", "https://example.com/"],
                "clicks": 4.0,
                "impressions": 120.0,
                "ctr": 0.0333
            }
        ]
    })
    .to_string()
}

async fn call_oauth_callback(redirect_uri: &str, query: &str) -> String {
    let parsed = url::Url::parse(redirect_uri).expect("redirect_uri 可解析");
    let host = parsed.host_str().expect("有 host");
    let port = parsed.port().expect("有端口");
    let mut stream = tokio::net::TcpStream::connect((host, port))
        .await
        .expect("回环监听已就绪");
    let request = format!(
        "GET /oauth2callback?{query} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .await
        .expect("写回调请求");
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .await
        .expect("读回调响应");
    response
}

async fn wait_for_source(
    state: &geo_desktop_lib::state::AppState,
    project_id: ProjectId,
    kind: SearchSourceKind,
    status: SiteChannelStatus,
) -> geo_domain::SearchSource {
    for _ in 0..200 {
        let sources = SearchRepo::new(state.pool.clone())
            .sources(project_id)
            .await
            .expect("读源");
        if let Some(source) = sources
            .into_iter()
            .find(|source| source.kind == kind && source.status == status)
        {
            return source;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("等待 {kind:?} 进入 {status:?} 超时");
}

#[tokio::test]
async fn board_on_empty_project_returns_only_the_as_of_anchor() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let board = SearchService::from_state(&state)
        .board(project_id)
        .await
        .expect("读 board");
    assert_eq!(board.as_of, chrono::Utc::now().date_naive().to_string());
    assert!(board.sources.is_empty());
    assert!(board.metrics.is_empty());
    assert!(board.ai_overviews.is_empty());
    assert!(board.native_extras.is_empty());
    assert!(board.opportunities.is_empty());
    assert!(board.self_index_summary.is_none());
    assert!(board.self_index_snapshots.is_empty());
    assert!(board.traffic_split.is_empty());
}

#[tokio::test]
async fn upsert_source_derives_catalog_fields_and_clears_check_state() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    let source = service
        .upsert_source(
            project_id,
            SearchSourceKind::Gsc,
            binding(&[
                ("siteUrl", "  https://example.com  "),
                ("client_id", "client-123.apps.googleusercontent.com"),
                ("password", "hunter2"),
            ]),
            Some("  海外站  ".to_string()),
            now(),
        )
        .await
        .expect("新增");
    assert_eq!(
        source.binding.get("siteUrl").map(String::as_str),
        Some("https://example.com")
    );
    assert!(
        !source.binding.contains_key("password"),
        "凭据形状的键不进 binding"
    );
    assert_eq!(source.status, SiteChannelStatus::PendingVerify);
    assert_eq!(source.credentials_state, SiteCredentialsState::Missing);
    assert_eq!(source.secret_ref.as_deref(), Some("keyring://search/gsc"));
    assert_eq!(source.note.as_deref(), Some("海外站"));

    // 直接写一条带自检结论的旧行，再 upsert：id/created_at/data_through 保留，自检清空。
    sqlx::query(
        "UPDATE search_sources SET data_through = ?, checked_at = ?, check_detail = ? WHERE id = ?",
    )
    .bind("2026-10-01")
    .bind("2026-09-16T08:00:00.000000000Z")
    .bind("{\"code\":\"legacy\",\"params\":{}}")
    .bind(source.id.to_string())
    .execute(&state.pool)
    .await
    .expect("种旧结论");
    let next = service
        .upsert_source(project_id, SearchSourceKind::Gsc, binding(&[]), None, now())
        .await
        .expect("更新");
    assert_eq!(next.id, source.id);
    assert_eq!(next.created_at, source.created_at);
    assert_eq!(next.data_through.as_deref(), Some("2026-10-01"));
    assert!(next.checked_at.is_none());
    assert!(next.check_detail.is_none());
    assert_eq!(next.status, SiteChannelStatus::NotConfigured);
}

#[tokio::test]
async fn manual_source_is_ready_without_binding_or_credentials() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let source = SearchService::from_state(&state)
        .upsert_source(
            project_id,
            SearchSourceKind::Manual,
            BTreeMap::new(),
            None,
            now(),
        )
        .await
        .expect("人工填报");
    assert_eq!(source.status, SiteChannelStatus::Ready);
    assert_eq!(source.credentials_state, SiteCredentialsState::NotRequired);
    assert!(source.secret_ref.is_none());
}

#[tokio::test]
async fn phase_two_source_is_rejected() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let error = SearchService::from_state(&state)
        .upsert_source(
            project_id,
            SearchSourceKind::Sogou,
            binding(&[]),
            None,
            now(),
        )
        .await
        .expect_err("二期源必须拒绝");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(error.params["field"], "source_kind");
}

#[tokio::test]
async fn remove_source_is_idempotent_and_returns_remaining_snapshot() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    service
        .upsert_source(
            project_id,
            SearchSourceKind::BaiduZiyuan,
            binding(&[("siteUrl", "https://a.example")]),
            None,
            now(),
        )
        .await
        .expect("源一");
    service
        .upsert_source(
            project_id,
            SearchSourceKind::Manual,
            BTreeMap::new(),
            None,
            now(),
        )
        .await
        .expect("源二");
    let remaining = service
        .remove_source(project_id, SearchSourceKind::BaiduZiyuan)
        .await
        .expect("删除");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].kind, SearchSourceKind::Manual);
    assert_eq!(
        service
            .remove_source(project_id, SearchSourceKind::BaiduZiyuan)
            .await
            .unwrap(),
        remaining
    );
}

#[tokio::test]
async fn opportunity_update_flips_status_and_rejects_unknown_id() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let opportunity = SearchOpportunity {
        id: SearchOpportunityId::new(),
        project_id,
        rule_id: 1,
        title_key: "high_impression_low_ctr".to_string(),
        basis: "曝光 1200，点击 12".to_string(),
        evidence_metric_ids: vec!["metric-1".to_string()],
        prescription_category: SearchPrescriptionCategory::ContentProduction,
        impact: SearchActionLevel::High,
        difficulty: SearchActionLevel::Medium,
        confidence: 0.82,
        status: SearchOpportunityStatus::New,
        created_at: now(),
        updated_at: now(),
    };
    let repo = SearchRepo::new(state.pool.clone());
    repo.insert_opportunity(&opportunity).await.expect("种机会");
    let service = SearchService::from_state(&state);
    let updated = service
        .update_opportunity(opportunity.id, SearchOpportunityStatus::Adopted, now())
        .await
        .expect("翻状态");
    assert_eq!(updated.status, SearchOpportunityStatus::Adopted);
    assert_eq!(updated.evidence_metric_ids, opportunity.evidence_metric_ids);

    let error = service
        .update_opportunity(
            SearchOpportunityId::new(),
            SearchOpportunityStatus::Ignored,
            now(),
        )
        .await
        .expect_err("未知机会必须拒绝");
    assert_eq!(error.params["field"], "opportunity_id");
}

#[tokio::test]
async fn missing_project_is_project_not_found() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = SearchService::from_state(&state)
        .board(ProjectId::new())
        .await
        .expect_err("未知项目必须报 project/not_found");
    assert_eq!(error.code, "project/not_found");
}

#[tokio::test]
async fn test_source_probes_reachable_site_and_marks_ready() {
    let (state, server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    let source = service
        .upsert_source(
            project_id,
            SearchSourceKind::BaiduZiyuan,
            binding(&[("siteUrl", server.uri().as_str())]),
            None,
            now(),
        )
        .await
        .expect("新增");
    let tested = service
        .test_source(project_id, SearchSourceKind::BaiduZiyuan, now())
        .await
        .expect("自检");
    assert_eq!(tested.id, source.id);
    assert_eq!(tested.status, SiteChannelStatus::Ready);
    let detail = tested.check_detail.unwrap();
    assert_eq!(detail.code, "search_reachable");
    assert_eq!(detail.params.get("status").map(String::as_str), Some("200"));
    assert_eq!(tested.data_through, source.data_through, "自检不动数据");
}

#[tokio::test]
async fn test_source_missing_binding_reports_the_required_fields() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    let tested = service
        .test_source(project_id, SearchSourceKind::BaiduZiyuan, now())
        .await
        .expect("自检即建档");
    assert_eq!(tested.status, SiteChannelStatus::NotConfigured);
    let detail = tested.check_detail.unwrap();
    assert_eq!(detail.code, "search_binding_missing");
    assert_eq!(
        detail.params.get("fields").map(String::as_str),
        Some("siteUrl")
    );
}

#[tokio::test]
async fn test_source_manual_is_ready_without_probe() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let tested = SearchService::from_state(&state)
        .test_source(project_id, SearchSourceKind::Manual, now())
        .await
        .expect("自检");
    assert_eq!(tested.status, SiteChannelStatus::Ready);
    assert_eq!(tested.check_detail.unwrap().code, "search_manual_no_probe");
}

#[tokio::test]
async fn test_source_oauth_without_credentials_is_pending_verify() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let tested = SearchService::from_state(&state)
        .test_source(project_id, SearchSourceKind::Gsc, now())
        .await
        .expect("自检");
    assert_eq!(tested.status, SiteChannelStatus::PendingVerify);
    let detail = tested.check_detail.unwrap();
    assert_eq!(detail.code, "search_credentials_missing");
    assert_eq!(detail.params.get("kind").map(String::as_str), Some("gsc"));
}

#[tokio::test]
async fn test_source_bing_reports_stored_when_an_api_key_is_present() {
    // Bing 的凭据就是这个 API Key（官方推荐路径）；存了就不该报「缺失」。
    let (state, _server, secrets) = test_state(OfflineTransport::new()).await;
    secrets
        .set("keyring://llm/bing_wmt", "bing-key-123")
        .await
        .expect("写钥匙串");
    let project_id = project(&state).await;
    let tested = SearchService::from_state(&state)
        .test_source(project_id, SearchSourceKind::BingWmt, now())
        .await
        .expect("自检");
    assert_eq!(tested.status, SiteChannelStatus::PendingVerify);
    let detail = tested.check_detail.unwrap();
    assert_eq!(detail.code, "search_credentials_stored");
    assert_eq!(
        detail.params.get("kind").map(String::as_str),
        Some("bing_wmt")
    );
    assert_eq!(tested.credentials_state, SiteCredentialsState::Stored);
}

#[tokio::test]
async fn test_source_unreachable_reports_stable_reason() {
    let (state, server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    service
        .upsert_source(
            project_id,
            SearchSourceKind::BaiduZiyuan,
            binding(&[("siteUrl", format!("{}/missing", server.uri()).as_str())]),
            None,
            now(),
        )
        .await
        .expect("新增");
    let tested = service
        .test_source(project_id, SearchSourceKind::BaiduZiyuan, now())
        .await
        .expect("自检");
    assert_eq!(tested.status, SiteChannelStatus::Failed);
    let detail = tested.check_detail.unwrap();
    assert_eq!(detail.code, "search_unreachable");
    assert!(detail.params.contains_key("reason"));
}

const AI_TABLE: &str = "关键词\tAI引用量\tAI曝光量\tAI点击量\tAI点击率\n工业除尘器\t40\t1200\t8\t0.2\n布袋除尘器\t20\t500\t4\t0.2\n";
const AI_SUMMARY: &str =
    "citations,impressions,ai_clicks,ai_ctr_check,cited_pages\n40,6106,8,0.2,6\n";

#[tokio::test]
async fn import_query_table_populates_board_and_marks_source_ready() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    let result = service
        .import_metrics(
            project_id,
            SearchSourceKind::BaiduZiyuanAi,
            AI_TABLE.to_string(),
            "2026-08-01".to_string(),
            "2026-09-05".to_string(),
            now(),
        )
        .await
        .expect("导入");
    assert_eq!(result.metrics.len(), 2);
    assert_eq!(result.errors.len(), 0);
    assert_eq!(result.data_through.as_deref(), Some("2026-09-05"));
    let board = service.board(project_id).await.unwrap();
    assert_eq!(board.metrics.len(), 2);
    let source = board
        .sources
        .iter()
        .find(|source| source.kind == SearchSourceKind::BaiduZiyuanAi)
        .unwrap();
    assert_eq!(source.status, SiteChannelStatus::Ready);
    assert_eq!(source.data_through.as_deref(), Some("2026-09-05"));
}

#[tokio::test]
async fn header_only_import_keeps_previous_rows() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    service
        .import_metrics(
            project_id,
            SearchSourceKind::BaiduZiyuanAi,
            AI_TABLE.to_string(),
            "2026-09-01".to_string(),
            "2026-09-30".to_string(),
            now(),
        )
        .await
        .expect("首次导入");
    let empty = service
        .import_metrics(
            project_id,
            SearchSourceKind::BaiduZiyuanAi,
            "关键词\tAI引用量\tAI曝光量\tAI点击量\tAI点击率\n".to_string(),
            "2026-09-01".to_string(),
            "2026-09-30".to_string(),
            now(),
        )
        .await
        .expect("空表导入");
    assert!(empty.metrics.is_empty());
    assert_eq!(service.board(project_id).await.unwrap().metrics.len(), 2);
}

#[tokio::test]
async fn import_ai_summary_populates_overview_and_cited_pages_extra() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    let result = service
        .import_metrics(
            project_id,
            SearchSourceKind::BaiduZiyuanAi,
            AI_SUMMARY.to_string(),
            "2026-09-01".to_string(),
            "2026-09-30".to_string(),
            now(),
        )
        .await
        .expect("导入汇总");
    assert_eq!(result.ai_overviews.len(), 1);
    assert_eq!(result.ai_overviews[0].ai_ctr, Some(0.2));
    let board = service.board(project_id).await.unwrap();
    assert_eq!(board.ai_overviews.len(), 1);
    assert!(board
        .native_extras
        .iter()
        .any(|extra| extra.label == "AI引用页面量"));
}

#[tokio::test]
async fn all_rows_invalid_is_a_payload_error_with_detail() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let error = SearchService::from_state(&state)
        .import_metrics(
            project_id,
            SearchSourceKind::BaiduZiyuanAi,
            "关键词\tAI引用量\tAI曝光量\tAI点击量\tAI点击率\n工业除尘器\tabc\t1200\t8\t0.2\n"
                .to_string(),
            "2026-09-01".to_string(),
            "2026-09-30".to_string(),
            now(),
        )
        .await
        .expect_err("全行失败必须整批拒绝");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(error.params["field"], "payload");
    assert!(error.detail.is_some());
}

#[tokio::test]
async fn removing_source_cascades_imported_metrics() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    service
        .import_metrics(
            project_id,
            SearchSourceKind::BaiduZiyuanAi,
            AI_TABLE.to_string(),
            "2026-09-01".to_string(),
            "2026-09-30".to_string(),
            now(),
        )
        .await
        .expect("导入");
    service
        .remove_source(project_id, SearchSourceKind::BaiduZiyuanAi)
        .await
        .expect("移除");
    let board = service.board(project_id).await.unwrap();
    assert!(board.metrics.is_empty());
}

const LOW_CTR_TABLE: &str = "query,page,impressions,clicks\n冷门长尾需求词,,1000,5\n";

#[tokio::test]
async fn board_derives_opportunities_from_imported_metrics_and_persists_them() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    service
        .import_metrics(
            project_id,
            SearchSourceKind::BaiduZiyuan,
            LOW_CTR_TABLE.to_string(),
            "2026-09-01".to_string(),
            "2026-09-30".to_string(),
            now(),
        )
        .await
        .expect("导入指标");

    let board = service.board(project_id).await.expect("读 board");
    assert!(
        !board.opportunities.is_empty(),
        "有指标后 board 必须出现真实机会"
    );
    assert!(board.opportunities.iter().any(|item| item.rule_id == 1));
    assert!(board
        .opportunities
        .iter()
        .all(|item| item.status == SearchOpportunityStatus::New));
    let persisted = SearchRepo::new(state.pool.clone())
        .opportunities(project_id)
        .await
        .expect("读持久化机会");
    assert_eq!(persisted, board.opportunities);
}

#[tokio::test]
async fn board_recalculation_keeps_manual_opportunity_status() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    service
        .import_metrics(
            project_id,
            SearchSourceKind::BaiduZiyuan,
            LOW_CTR_TABLE.to_string(),
            "2026-09-01".to_string(),
            "2026-09-30".to_string(),
            now(),
        )
        .await
        .expect("导入指标");
    let first = service.board(project_id).await.expect("第一次重算");
    let target = first
        .opportunities
        .iter()
        .find(|item| item.rule_id == 1)
        .expect("规则 1 机会")
        .clone();
    service
        .update_opportunity(target.id, SearchOpportunityStatus::Adopted, now())
        .await
        .expect("采纳");

    let second = service.board(project_id).await.expect("第二次重算");
    let adopted = second
        .opportunities
        .iter()
        .find(|item| item.rule_id == target.rule_id && item.title_key == target.title_key)
        .expect("重算后同一规则仍在");
    assert_eq!(adopted.status, SearchOpportunityStatus::Adopted);
}

#[tokio::test]
async fn board_without_metrics_clears_stale_opportunities() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let stale = SearchOpportunity {
        id: SearchOpportunityId::new(),
        project_id,
        rule_id: 1,
        title_key: "webmasterData.rules.high_impression_low_ctr.name".to_string(),
        basis: "上一轮遗留".to_string(),
        evidence_metric_ids: Vec::new(),
        prescription_category: SearchPrescriptionCategory::SiteStructure,
        impact: SearchActionLevel::High,
        difficulty: SearchActionLevel::Low,
        confidence: 0.9,
        status: SearchOpportunityStatus::New,
        created_at: now(),
        updated_at: now(),
    };
    SearchRepo::new(state.pool.clone())
        .insert_opportunity(&stale)
        .await
        .expect("种旧机会");
    let board = SearchService::from_state(&state)
        .board(project_id)
        .await
        .expect("空项目 board");
    assert!(board.opportunities.is_empty());
    assert!(SearchRepo::new(state.pool.clone())
        .opportunities(project_id)
        .await
        .unwrap()
        .is_empty());
}

// ---------------------------------------------------------------------------
// GSC OAuth：PKCE + 回环回调 + 数据拉取（全程离线：token / GSC 都由传输替身回放）
// ---------------------------------------------------------------------------

#[tokio::test]
async fn gsc_oauth_begin_builds_google_pkce_authorization_url() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    service
        .upsert_source(
            project_id,
            SearchSourceKind::Gsc,
            binding(&[
                ("siteUrl", "https://example.com/"),
                ("client_id", "client-123.apps.googleusercontent.com"),
            ]),
            None,
            now(),
        )
        .await
        .expect("建 GSC 源");

    let start = service
        .oauth_begin(project_id, SearchSourceKind::Gsc)
        .await
        .expect("开始授权");

    let url = url::Url::parse(&start.auth_url).expect("auth_url 可解析");
    assert_eq!(url.scheme(), "https");
    assert_eq!(url.host_str(), Some("accounts.google.com"));
    assert_eq!(url.path(), "/o/oauth2/v2/auth");
    let params: BTreeMap<String, String> = url.query_pairs().into_owned().collect();
    assert_eq!(
        params.get("client_id").map(String::as_str),
        Some("client-123.apps.googleusercontent.com")
    );
    assert_eq!(
        params.get("response_type").map(String::as_str),
        Some("code")
    );
    assert_eq!(
        params.get("scope").map(String::as_str),
        Some("https://www.googleapis.com/auth/webmasters.readonly")
    );
    assert_eq!(
        params.get("code_challenge_method").map(String::as_str),
        Some("S256")
    );
    assert_eq!(
        params.get("access_type").map(String::as_str),
        Some("offline")
    );
    assert_eq!(params.get("prompt").map(String::as_str), Some("consent"));
    assert_eq!(
        params.get("state").map(String::as_str),
        Some(start.state.as_str())
    );
    assert_eq!(
        params.get("redirect_uri").map(String::as_str),
        Some(start.redirect_uri.as_str())
    );
    assert!(params
        .get("code_challenge")
        .is_some_and(|value| !value.is_empty()));
    assert!(!params.contains_key("code_verifier"), "verifier 只留在本地");
    assert!(start.redirect_uri.starts_with("http://127.0.0.1:"));
    assert!(start.redirect_uri.ends_with("/oauth2callback"));
}

#[tokio::test]
async fn oauth_begin_rejects_non_oauth_sources_and_missing_client_id() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);

    let not_allowed = service
        .oauth_begin(project_id, SearchSourceKind::BaiduZiyuan)
        .await
        .expect_err("百度站长没有可用的 OAuth 通道");
    assert_eq!(not_allowed.code, "validation/failed");
    assert_eq!(not_allowed.params["field"], "kind");
    assert_eq!(not_allowed.params["reason"], "not_allowed");

    service
        .upsert_source(
            project_id,
            SearchSourceKind::Gsc,
            binding(&[("siteUrl", "https://example.com/")]),
            None,
            now(),
        )
        .await
        .expect("建缺 client_id 的 GSC 源");
    let missing = service
        .oauth_begin(project_id, SearchSourceKind::Gsc)
        .await
        .expect_err("缺 client_id 必须拒绝");
    assert_eq!(missing.code, "validation/failed");
    assert_eq!(missing.params["field"], "client_id");
    assert_eq!(missing.params["reason"], "required");
}

#[tokio::test]
async fn gsc_oauth_callback_success_stores_token_and_imports_metrics() {
    let transport = ScriptedTransport::new(vec![token_body(), gsc_body()]);
    let (state, _server, secrets) = test_state(transport.clone()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    service
        .upsert_source(
            project_id,
            SearchSourceKind::Gsc,
            binding(&[
                ("siteUrl", "https://example.com/"),
                ("client_id", "client-123.apps.googleusercontent.com"),
            ]),
            None,
            now(),
        )
        .await
        .expect("建 GSC 源");

    let start = service
        .oauth_begin(project_id, SearchSourceKind::Gsc)
        .await
        .expect("开始授权");
    let response = call_oauth_callback(
        &start.redirect_uri,
        &format!("code=good-code&state={}", start.state),
    )
    .await;
    assert!(
        response.starts_with("HTTP/1.1 200"),
        "回调应回 200：{response}"
    );

    let source = wait_for_source(
        &state,
        project_id,
        SearchSourceKind::Gsc,
        SiteChannelStatus::Ready,
    )
    .await;
    assert_eq!(source.credentials_state, SiteCredentialsState::Stored);
    let today = chrono::Utc::now().date_naive();
    let end = (today - chrono::Days::new(3)).to_string();
    assert_eq!(source.data_through.as_deref(), Some(end.as_str()));

    let stored = secrets
        .get("keyring://search/gsc")
        .await
        .expect("读钥匙串")
        .expect("token 已落钥匙串");
    let parsed: serde_json::Value = serde_json::from_str(&stored).expect("token JSON");
    assert_eq!(parsed["access_token"], "ya29.test-access");
    assert_eq!(parsed["refresh_token"], "1//test-refresh");
    assert_eq!(parsed["token_type"], "Bearer");
    assert!(parsed["expires_at"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));

    let board = service.board(project_id).await.expect("读 board");
    assert_eq!(board.metrics.len(), 2);
    let first = board
        .metrics
        .iter()
        .find(|row| row.query == "dust collector")
        .expect("第一条指标");
    assert_eq!(first.source_kind, SearchSourceKind::Gsc);
    assert_eq!(first.surface, SearchSurface::WebSearch);
    assert_eq!(
        first.page_url.as_deref(),
        Some("https://example.com/products/bag-filter")
    );
    assert_eq!(first.clicks, Some(12));
    assert_eq!(first.impressions, Some(300));
    assert_eq!(first.ctr, Some(0.04));
    assert_eq!(first.citations, None);
    assert_eq!(first.completeness, SearchCompleteness::Full);
    assert_eq!(first.window_source, WindowSource::Platform);
    assert_eq!(first.period_end, end);
    assert_eq!(first.data_through, end);
    assert_eq!(first.mapping_version, geo_domain::MAPPING_VERSION);

    let requests = transport.requests();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].url.contains("oauth2.googleapis.com/token"));
    assert!(requests[0].body.contains("grant_type=authorization_code"));
    assert!(requests[0].body.contains("code_verifier="));
    assert!(
        !requests[0].body.contains("client_secret="),
        "未配 secret 时走纯 PKCE"
    );
    assert!(requests[1]
        .url
        .contains("sites/https%3A%2F%2Fexample.com%2F/searchAnalytics/query"));
    assert_eq!(
        requests[1].header("Authorization"),
        Some("Bearer ya29.test-access")
    );
    let body: serde_json::Value = serde_json::from_str(&requests[1].body).expect("GSC 请求体");
    assert_eq!(body["dimensions"], serde_json::json!(["query", "page"]));
    assert_eq!(body["rowLimit"], 25000);
}

#[tokio::test]
async fn gsc_oauth_callback_rejects_state_mismatch_without_exchanging_token() {
    let transport = ScriptedTransport::new(vec![token_body(), gsc_body()]);
    let (state, _server, _secrets) = test_state(transport.clone()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    service
        .upsert_source(
            project_id,
            SearchSourceKind::Gsc,
            binding(&[
                ("siteUrl", "https://example.com/"),
                ("client_id", "client-123.apps.googleusercontent.com"),
            ]),
            None,
            now(),
        )
        .await
        .expect("建 GSC 源");
    let start = service
        .oauth_begin(project_id, SearchSourceKind::Gsc)
        .await
        .expect("开始授权");

    let response =
        call_oauth_callback(&start.redirect_uri, "code=good-code&state=wrong-state").await;
    assert!(
        response.starts_with("HTTP/1.1 400"),
        "state 不符应回 400：{response}"
    );

    let source = wait_for_source(
        &state,
        project_id,
        SearchSourceKind::Gsc,
        SiteChannelStatus::Failed,
    )
    .await;
    assert_eq!(
        source
            .check_detail
            .as_ref()
            .map(|detail| detail.code.as_str()),
        Some("search_oauth_failed")
    );
    assert_eq!(
        transport.request_count(),
        0,
        "state 不符时不得发 token 请求"
    );
}

#[tokio::test]
async fn oauth_exchange_maps_token_http_error_to_stable_failure() {
    let transport = CodedTransport::new(vec![(400, r#"{"error":"invalid_grant"}"#)]);
    let error = oauth_exchange(
        transport.as_ref(),
        "client-123.apps.googleusercontent.com",
        None,
        "bad-code",
        "verifier-123",
        "http://127.0.0.1:4567/oauth2callback",
        now(),
    )
    .await
    .expect_err("token 4xx 必须失败");
    assert_eq!(error, GscFlowError::OAuthFailed);
    let requests = transport.requests();
    assert_eq!(requests[0].method, HttpMethod::Post);
    assert!(requests[0].body.contains("code=bad-code"));
    assert!(requests[0].body.contains("code_verifier=verifier-123"));
}

#[tokio::test]
async fn oauth_exchange_includes_optional_client_secret() {
    let transport = CodedTransport::new(vec![(200, &token_body())]);
    oauth_exchange(
        transport.as_ref(),
        "client-123.apps.googleusercontent.com",
        Some("shh-secret"),
        "good-code",
        "verifier-123",
        "http://127.0.0.1:4567/oauth2callback",
        now(),
    )
    .await
    .expect("token 成功");
    let requests = transport.requests();
    assert!(requests[0].body.contains("client_secret=shh-secret"));
}

#[tokio::test]
async fn gsc_fetch_accepts_an_empty_rows_response() {
    let transport = ScriptedTransport::new(vec![r#"{"rows":[]}"#.to_string()]);
    let metrics = fetch_gsc_metrics(
        transport.as_ref(),
        ProjectId::new(),
        "ya29.test-access",
        "sc-domain:example.com",
        "2026-09-01",
        "2026-09-28",
        now(),
    )
    .await
    .expect("空 rows 是合法响应");
    assert!(metrics.is_empty());
    assert!(transport.requests()[0]
        .url
        .contains("sites/sc-domain%3Aexample.com/searchAnalytics/query"));
}

#[tokio::test]
async fn gsc_source_test_recognizes_a_stored_token() {
    let (state, _server, secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SearchService::from_state(&state);
    service
        .upsert_source(
            project_id,
            SearchSourceKind::Gsc,
            binding(&[
                ("siteUrl", "https://example.com/"),
                ("client_id", "client-123.apps.googleusercontent.com"),
            ]),
            None,
            now(),
        )
        .await
        .expect("建 GSC 源");
    secrets
        .set("keyring://search/gsc", r#"{"access_token":"ya29.test"}"#)
        .await
        .expect("写钥匙串");

    let tested = service
        .test_source(project_id, SearchSourceKind::Gsc, now())
        .await
        .expect("自检");
    assert_eq!(tested.credentials_state, SiteCredentialsState::Stored);
    assert_eq!(
        tested
            .check_detail
            .as_ref()
            .map(|detail| detail.code.as_str()),
        Some("search_credentials_stored")
    );
}

#[tokio::test]
async fn daily_refresh_uses_refresh_token_and_updates_metrics() {
    let refresh_body = serde_json::json!({
        "access_token": "ya29.refreshed",
        "expires_in": 3600,
        "token_type": "Bearer"
    })
    .to_string();
    let transport = CodedTransport::new(vec![(200, &refresh_body), (200, &gsc_body())]);
    let (state, _server, secrets) = test_state(transport.clone()).await;
    let project_id = project(&state).await;
    SearchService::from_state(&state)
        .upsert_source(
            project_id,
            SearchSourceKind::Gsc,
            binding(&[
                ("siteUrl", "https://example.com/"),
                ("client_id", "client-123.apps.googleusercontent.com"),
            ]),
            None,
            now(),
        )
        .await
        .expect("建 GSC 源");
    let expired = serde_json::json!({
        "access_token": "ya29.expired",
        "refresh_token": "1//refresh",
        "expires_at": "2020-01-01T00:00:00Z",
        "token_type": "Bearer"
    })
    .to_string();
    secrets
        .set("keyring://search/gsc", &expired)
        .await
        .expect("写过期 token");

    let count = geo_desktop_lib::services::search_oauth::refresh_all_gsc(
        state.pool.clone(),
        secrets.clone(),
        transport.clone(),
    )
    .await;
    assert_eq!(count, 1);
    assert!(transport.requests()[0]
        .body
        .contains("grant_type=refresh_token"));
    let board = SearchService::from_state(&state)
        .board(project_id)
        .await
        .expect("读 board");
    assert!(!board.metrics.is_empty());
    assert_eq!(
        board.sources[0].credentials_state,
        SiteCredentialsState::Stored
    );
}

// ---------------------------------------------------------------------------
// Bing Webmaster：API Key 取数（官方推荐路径，全程离线）；GSC OAuth 在上一节
// ---------------------------------------------------------------------------

#[tokio::test]
async fn bing_fetch_maps_query_stats_case_insensitively() {
    let transport = ScriptedTransport::new(vec![bing_stats_body()]);
    let metrics = fetch_bing_metrics(
        transport.as_ref(),
        ProjectId::new(),
        &BingAuth::Bearer("bing.access".to_string()),
        "https://example.com/",
        "2026-09-01",
        "2026-09-28",
        now(),
    )
    .await
    .expect("GetQueryStats 映射成功");
    assert_eq!(metrics.len(), 2);
    let first = &metrics[0];
    assert_eq!(first.query, "dust collector");
    assert_eq!(first.source_kind, SearchSourceKind::BingWmt);
    assert_eq!(first.surface, SearchSurface::WebSearch);
    assert_eq!(first.impressions, Some(300));
    assert_eq!(first.clicks, Some(12));
    assert_eq!(first.ctr, Some(0.04));
    assert_eq!(first.period_start, "2026-09-01");
    assert_eq!(first.period_end, "2026-09-28");
    assert_eq!(first.data_through, "2026-09-28");
    assert_eq!(first.completeness, SearchCompleteness::Full);
    assert_eq!(first.window_source, WindowSource::Platform);
    assert_eq!(first.mapping_version, geo_domain::MAPPING_VERSION);
    let second = &metrics[1];
    assert_eq!(second.query, "bag filter", "小写字段名也认");
    assert_eq!(second.impressions, Some(120));
    assert_eq!(second.clicks, Some(4));
    assert_eq!(second.ctr, Some(0.0333));

    let requests = transport.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, HttpMethod::Get);
    assert!(requests[0]
        .url
        .starts_with("https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats?siteUrl="));
    assert!(requests[0]
        .url
        .contains("siteUrl=https%3A%2F%2Fexample.com%2F"));
    assert_eq!(
        requests[0].header("Authorization"),
        Some("Bearer bing.access")
    );
}

#[tokio::test]
async fn bing_fetch_maps_404_and_malformed_body_to_fetch_failed() {
    let not_found = CodedTransport::new(vec![(404, r#"{"error":"gone"}"#)]);
    let error = fetch_bing_metrics(
        not_found.as_ref(),
        ProjectId::new(),
        &BingAuth::Bearer("bing.access".to_string()),
        "https://example.com/",
        "2026-09-01",
        "2026-09-28",
        now(),
    )
    .await
    .expect_err("404 必须失败");
    assert_eq!(error, GscFlowError::FetchFailed);

    let malformed = CodedTransport::new(vec![(200, "not json")]);
    let error = fetch_bing_metrics(
        malformed.as_ref(),
        ProjectId::new(),
        &BingAuth::Bearer("bing.access".to_string()),
        "https://example.com/",
        "2026-09-01",
        "2026-09-28",
        now(),
    )
    .await
    .expect_err("解析失败必须失败");
    assert_eq!(error, GscFlowError::FetchFailed);
}

#[tokio::test]
async fn bing_fetch_accepts_an_empty_d_array() {
    let transport = ScriptedTransport::new(vec![r#"{"d":[]}"#.to_string()]);
    let metrics = fetch_bing_metrics(
        transport.as_ref(),
        ProjectId::new(),
        &BingAuth::Bearer("bing.access".to_string()),
        "https://example.com/",
        "2026-09-01",
        "2026-09-28",
        now(),
    )
    .await
    .expect("空 d 是合法响应");
    assert!(metrics.is_empty());
}

#[tokio::test]
async fn bing_fetch_uses_api_key_query_param_and_no_authorization_header() {
    // Bing 官方推荐 API Key 认证：`?apikey=…`，不需要 OAuth 回调地址
    // （Bing 的 OAuth 控制台不接受 loopback 重定向，这是那条路的硬阻塞）。
    let transport = ScriptedTransport::new(vec![bing_stats_body()]);
    let metrics = fetch_bing_metrics(
        transport.as_ref(),
        ProjectId::new(),
        &BingAuth::ApiKey("bing-key-123".to_string()),
        "https://example.com/",
        "2026-09-01",
        "2026-09-28",
        now(),
    )
    .await
    .expect("API Key 认证也能映射成功");
    assert_eq!(metrics.len(), 2);

    let requests = transport.requests();
    assert_eq!(requests.len(), 1);
    assert!(
        requests[0].url.contains("apikey=bing-key-123"),
        "API Key 必须走查询参数：{}",
        requests[0].url
    );
    assert_eq!(
        requests[0].header("Authorization"),
        None,
        "API Key 模式下不得同时发 Bearer"
    );
}

#[tokio::test]
async fn daily_bing_refresh_works_with_only_an_api_key() {
    // 用户的实际配置：Bing 只存了 API Key，没有 client_id、没有 token。
    // 每日拉取必须直接走 `?apikey=`，不能因为缺 client_id 而跳过。
    let transport = CodedTransport::new(vec![(200, &bing_stats_body())]);
    let (state, _server, secrets) = test_state(transport.clone()).await;
    let project_id = project(&state).await;
    SearchService::from_state(&state)
        .upsert_source(
            project_id,
            SearchSourceKind::BingWmt,
            binding(&[("siteUrl", "https://example.com/")]),
            None,
            now(),
        )
        .await
        .expect("建 Bing 源");
    secrets
        .set("keyring://llm/bing_wmt", "bing-key-123")
        .await
        .expect("写 API Key");

    let count = geo_desktop_lib::services::search_oauth::refresh_all_bing(
        state.pool.clone(),
        secrets.clone(),
        transport.clone(),
    )
    .await;
    assert_eq!(count, 1);

    let requests = transport.requests();
    assert_eq!(requests.len(), 1, "API Key 路径不应再打 token 端点");
    assert!(requests[0].url.contains("apikey=bing-key-123"));
    assert_eq!(requests[0].header("Authorization"), None);

    let board = SearchService::from_state(&state)
        .board(project_id)
        .await
        .expect("读 board");
    assert_eq!(board.metrics.len(), 2);
    let source = board
        .sources
        .iter()
        .find(|source| source.kind == SearchSourceKind::BingWmt)
        .expect("Bing 源");
    assert_eq!(source.status, SiteChannelStatus::Ready);
    assert_eq!(source.credentials_state, SiteCredentialsState::Stored);
}

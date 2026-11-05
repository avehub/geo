//! M5.5 站长数据服务集成测试（Plan C 第五切片第一段）。

mod support;

use std::collections::BTreeMap;

use geo_domain::{
    ProjectId, SearchActionLevel, SearchOpportunity, SearchOpportunityId, SearchOpportunityStatus,
    SearchPrescriptionCategory, SearchSourceKind, SiteChannelStatus, SiteCredentialsState,
};
use geo_store::SearchRepo;
use support::{now, sample_draft, test_state, OfflineTransport};

use geo_desktop_lib::services::{ProjectService, SearchService};

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

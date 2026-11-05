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
    .bind("old")
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

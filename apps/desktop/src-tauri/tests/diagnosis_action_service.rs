//! M5 诊断 + M6 行动读路径服务集成测试（Plan C M3–M7 读路径）。

mod support;

use geo_domain::{
    ActionBoard, ActionCategory, ActionItem, ActionLevel, ActionStatus, AlertItem, AlertKind,
    AlertSeverity, AttributionCard, AttributionMetric, AttributionMetricKey, CollectionRound,
    CompetitorMatrix, CompetitorMatrixRow, ContentStatus, DiagnosisDimension, DiagnosisOverview,
    DimensionScore, EngineId, EngineScore, ExportFormat, FunnelRow, FunnelStage, GeneratedContent,
    IntentFunnel, ProjectId, RoundStatus, SampleSizeGrade, TrendPoint,
};
use geo_store::{CollectionRepo, DiagnosisRepo};
use support::{now, sample_draft, test_state, OfflineTransport};

use geo_desktop_lib::services::{ActionService, DiagnosisService, ProjectService};

async fn seed_round(state: &geo_desktop_lib::state::AppState) -> ProjectId {
    let project_id = ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目")
        .id;
    CollectionRepo::new(state.pool.clone())
        .insert_round(&CollectionRound {
            id: "round-1".to_string(),
            project_id: project_id.to_string(),
            prompt_set_id: "set-1".to_string(),
            prompt_set_label: "题库".to_string(),
            prompt_set_version: 1,
            label: "第 1 轮".to_string(),
            round_index: 1,
            status: RoundStatus::Succeeded,
            engine_scope: vec![EngineId::Doubao],
            repeat_count: 1,
            planned_queries: 1,
            completed_queries: 1,
            failed_queries: 0,
            success_rate: 1.0,
            started_at: Some(now()),
            finished_at: Some(now()),
            metric_spec_version: "geo-metrics-v1".to_string(),
            sample_size_grade: SampleSizeGrade::Sufficient,
            notes: None,
        })
        .await
        .expect("轮次");
    project_id
}

fn overview(project_id: ProjectId) -> DiagnosisOverview {
    DiagnosisOverview {
        project_id: project_id.to_string(),
        round_id: "round-1".to_string(),
        round_label: "第 1 轮".to_string(),
        collected_at: now(),
        total_score: 55.0,
        score_margin: 4.0,
        sample_size: 62,
        sample_size_grade: SampleSizeGrade::Sufficient,
        dimensions: vec![DimensionScore {
            dimension: DiagnosisDimension::Visibility,
            score: 60.0,
            weight: 0.35,
            sample_size: 62,
            detail: "提及 26 / 62".to_string(),
        }],
        brand_coverage: 0.55,
        brand_coverage_margin: 0.05,
        share_of_voice: 0.38,
        fact_accuracy: 0.9,
        distinct_cited_domains: 47,
        trend: vec![TrendPoint {
            round_id: "round-1".to_string(),
            round_label: "第 1 轮".to_string(),
            collected_at: now(),
            status: RoundStatus::Succeeded,
            brand_coverage: 0.55,
            coverage_margin: 0.05,
            total_score: 55.0,
            fact_accuracy: 0.9,
            sample_size: 62,
        }],
        alerts: vec![AlertItem {
            id: "alert-1".to_string(),
            project_id: project_id.to_string(),
            round_id: "round-1".to_string(),
            kind: AlertKind::CoverageDrop,
            severity: AlertSeverity::Warning,
            engine: Some(EngineId::Doubao),
            metric: "brand_coverage".to_string(),
            delta: Some(-5.0),
            detail: "覆盖下降".to_string(),
            acknowledged: false,
            raised_at: now(),
        }],
        metric_spec_version: "geo-metrics-v1".to_string(),
    }
}

fn matrix() -> CompetitorMatrix {
    CompetitorMatrix {
        round_id: "round-1".to_string(),
        sample_size: 62,
        head_to_head_prompt_count: 20,
        rows: vec![CompetitorMatrixRow {
            brand: "澜舟".to_string(),
            is_self: true,
            coverage: 0.55,
            share_of_voice: 0.38,
            top1_rate: 0.2,
            top3_rate: 0.34,
            mention_only_rate: 0.21,
            positive_rate: 0.8,
            negative_rate: 0.05,
            fact_error_count: 15,
            cited_domain_count: 47,
        }],
    }
}

fn funnel() -> IntentFunnel {
    IntentFunnel {
        round_id: "round-1".to_string(),
        rows: vec![FunnelRow {
            stage: FunnelStage::Awareness,
            prompt_count: 20,
            mention_rate: 0.6,
            top3_rate: 0.3,
        }],
        diagnosis_note: "认知层有、推荐层无".to_string(),
    }
}

fn engines() -> Vec<EngineScore> {
    vec![EngineScore {
        engine: EngineId::Doubao,
        sample_size: 20,
        coverage: 0.6,
        top3_rate: 0.3,
        positive_rate: 0.8,
        fact_error_rate: 0.1,
        success_rate: 0.95,
        avg_latency_ms: 2300,
    }]
}

fn action_board(project_id: ProjectId) -> ActionBoard {
    ActionBoard {
        actions: vec![ActionItem {
            id: "action-1".to_string(),
            project_id: project_id.to_string(),
            round_id: "round-1".to_string(),
            category: ActionCategory::SiteStructure,
            rank: 1,
            title: "补齐产品页定义句".to_string(),
            rationale: "18 道题未提及".to_string(),
            impact: ActionLevel::High,
            difficulty: ActionLevel::Medium,
            owner_hint: "市场负责人".to_string(),
            deliverable: "定义句与参数表".to_string(),
            affected_prompt_count: 18,
            affected_engines: vec![EngineId::Doubao],
            evidence_issue_ids: vec!["issue-1".to_string()],
            quick_win: true,
            status: ActionStatus::Todo,
            completed_at: None,
            updated_at: now(),
        }],
        attribution: vec![AttributionCard {
            id: "attr-1".to_string(),
            project_id: project_id.to_string(),
            baseline_round_id: "round-1".to_string(),
            baseline_label: "第 1 轮".to_string(),
            retest_round_id: "round-2".to_string(),
            retest_label: "第 2 轮".to_string(),
            action_ids: vec!["action-1".to_string()],
            summary: "完成 1 项".to_string(),
            metrics: vec![AttributionMetric {
                metric: AttributionMetricKey::BrandCoverage,
                before: 0.42,
                after: 0.55,
                unit: "percent".to_string(),
            }],
        }],
        contents: Vec::new(),
        templates: Vec::new(),
    }
}

#[tokio::test]
async fn diagnosis_four_views_read_snapshots() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = seed_round(&state).await;
    let repo = DiagnosisRepo::new(state.pool.clone());
    repo.save_snapshot(
        "round-1",
        "overview",
        &serde_json::to_string(&overview(project_id)).unwrap(),
    )
    .await
    .unwrap();
    repo.save_snapshot(
        "round-1",
        "competitors",
        &serde_json::to_string(&matrix()).unwrap(),
    )
    .await
    .unwrap();
    repo.save_snapshot(
        "round-1",
        "funnel",
        &serde_json::to_string(&funnel()).unwrap(),
    )
    .await
    .unwrap();
    repo.save_snapshot(
        "round-1",
        "engines",
        &serde_json::to_string(&engines()).unwrap(),
    )
    .await
    .unwrap();
    let service = DiagnosisService::from_state(&state);
    assert_eq!(
        service
            .overview("round-1".to_string())
            .await
            .unwrap()
            .unwrap()
            .total_score,
        55.0
    );
    assert_eq!(
        service
            .competitors("round-1".to_string())
            .await
            .unwrap()
            .unwrap()
            .rows
            .len(),
        1
    );
    assert_eq!(
        service
            .funnel("round-1".to_string())
            .await
            .unwrap()
            .unwrap()
            .rows
            .len(),
        1
    );
    assert_eq!(
        service.engines("round-1".to_string()).await.unwrap().len(),
        1
    );
}

#[tokio::test]
async fn missing_diagnosis_snapshots_are_null_or_empty() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    seed_round(&state).await;
    let service = DiagnosisService::from_state(&state);
    assert!(service
        .overview("round-1".to_string())
        .await
        .unwrap()
        .is_none());
    assert!(service
        .competitors("round-1".to_string())
        .await
        .unwrap()
        .is_none());
    assert!(service
        .funnel("round-1".to_string())
        .await
        .unwrap()
        .is_none());
    assert!(service
        .engines("round-1".to_string())
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn diagnosis_unknown_round_is_invalid_id() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = DiagnosisService::from_state(&state)
        .overview("missing".to_string())
        .await
        .expect_err("未知轮次");
    assert_eq!(error.params["field"], "round_id");
}

#[tokio::test]
async fn action_board_reads_snapshot_or_empty() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = seed_round(&state).await;
    let service = ActionService::from_state(&state);
    assert!(service.board(project_id).await.unwrap().actions.is_empty());

    DiagnosisRepo::new(state.pool.clone())
        .save_action_board(
            &project_id.to_string(),
            &serde_json::to_string(&action_board(project_id)).unwrap(),
            &now().to_rfc3339(),
        )
        .await
        .unwrap();
    let board = service.board(project_id).await.unwrap();
    assert_eq!(board.actions.len(), 1);
    assert_eq!(board.attribution.len(), 1);
}

#[tokio::test]
async fn action_board_missing_project_is_project_not_found() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = ActionService::from_state(&state)
        .board(ProjectId::new())
        .await
        .expect_err("未知项目");
    assert_eq!(error.code, "project/not_found");
}

#[tokio::test]
async fn alert_acknowledge_updates_overview_snapshot() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = seed_round(&state).await;
    DiagnosisRepo::new(state.pool.clone())
        .save_snapshot(
            "round-1",
            "overview",
            &serde_json::to_string(&overview(project_id)).unwrap(),
        )
        .await
        .unwrap();
    let service = DiagnosisService::from_state(&state);
    let alert = service
        .acknowledge_alert("alert-1".to_string(), true)
        .await
        .expect("标记已读");
    assert!(alert.acknowledged);
    let stored = service
        .overview("round-1".to_string())
        .await
        .unwrap()
        .unwrap();
    assert!(stored.alerts[0].acknowledged);
    let error = service
        .acknowledge_alert("missing".to_string(), true)
        .await
        .expect_err("未知告警");
    assert_eq!(error.params["field"], "alert_id");
}

#[tokio::test]
async fn action_status_flips_completion_time() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = seed_round(&state).await;
    DiagnosisRepo::new(state.pool.clone())
        .save_action_board(
            &project_id.to_string(),
            &serde_json::to_string(&action_board(project_id)).unwrap(),
            &now().to_rfc3339(),
        )
        .await
        .unwrap();
    let service = ActionService::from_state(&state);
    let done = service
        .update_action_status("action-1".to_string(), ActionStatus::Done)
        .await
        .expect("完成");
    assert_eq!(done.status, ActionStatus::Done);
    assert!(done.completed_at.is_some());
    let reopened = service
        .update_action_status("action-1".to_string(), ActionStatus::Todo)
        .await
        .expect("退回");
    assert_eq!(reopened.status, ActionStatus::Todo);
    assert!(reopened.completed_at.is_none());
    let error = service
        .update_action_status("missing".to_string(), ActionStatus::Done)
        .await
        .expect_err("未知处方");
    assert_eq!(error.params["field"], "action_id");
}

#[tokio::test]
async fn content_status_flips_and_unknown_id_is_invalid() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = seed_round(&state).await;
    let mut board = action_board(project_id);
    board.contents.push(GeneratedContent {
        id: "content-1".to_string(),
        project_id: project_id.to_string(),
        action_id: Some("action-1".to_string()),
        template_id: "template-1".to_string(),
        title: "文稿".to_string(),
        body_markdown: "正文".to_string(),
        status: ContentStatus::PendingReview,
        compliance_checked: true,
        export_formats: vec![ExportFormat::Markdown],
        created_at: now(),
        updated_at: now(),
    });
    DiagnosisRepo::new(state.pool.clone())
        .save_action_board(
            &project_id.to_string(),
            &serde_json::to_string(&board).unwrap(),
            &now().to_rfc3339(),
        )
        .await
        .unwrap();
    let service = ActionService::from_state(&state);
    let approved = service
        .update_content_status("content-1".to_string(), ContentStatus::Approved)
        .await
        .expect("审核");
    assert_eq!(approved.status, ContentStatus::Approved);
    let error = service
        .update_content_status("missing".to_string(), ContentStatus::Approved)
        .await
        .expect_err("未知文稿");
    assert_eq!(error.params["field"], "content_id");
}

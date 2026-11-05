//! M7 报告组装服务集成测试（Plan C M3–M7 读路径）。

mod support;

use geo_domain::{
    ActionBoard, ActionCategory, ActionItem, ActionLevel, ActionStatus, CollectionRecord,
    CollectionRecordDetail, CollectionRound, CollectionStatus, CompetitorMatrix,
    CompetitorMatrixRow, DiagnosisDimension, DiagnosisOverview, DimensionScore, EngineChannel,
    EngineId, EngineScore, FunnelRow, FunnelStage, IntentCategory, IntentFunnel, ProjectId,
    ReportBlock, ReportRenderOptions, ReportVariant, RoundStatus, SampleSizeGrade,
};
use geo_store::{CollectionRepo, DiagnosisRepo};
use support::{now, sample_draft, test_state, OfflineTransport};

use geo_desktop_lib::services::{ProjectService, ReportService};

async fn seed_round(state: &geo_desktop_lib::state::AppState, status: RoundStatus) -> ProjectId {
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
            prompt_set_version: 3,
            label: "第 1 轮".to_string(),
            round_index: 1,
            status,
            engine_scope: vec![EngineId::Doubao],
            repeat_count: 2,
            planned_queries: 10,
            completed_queries: 9,
            failed_queries: 1,
            success_rate: 0.9,
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
        trend: Vec::new(),
        alerts: Vec::new(),
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
            fact_error_count: 1,
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
        actions: vec![
            ActionItem {
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
                evidence_issue_ids: Vec::new(),
                quick_win: true,
                status: ActionStatus::Todo,
                completed_at: None,
                updated_at: now(),
            },
            ActionItem {
                id: "action-2".to_string(),
                project_id: project_id.to_string(),
                round_id: "round-1".to_string(),
                category: ActionCategory::ContentProduction,
                rank: 2,
                title: "更新价格页".to_string(),
                rationale: "价格过时".to_string(),
                impact: ActionLevel::Medium,
                difficulty: ActionLevel::Low,
                owner_hint: "市场负责人".to_string(),
                deliverable: "价格页".to_string(),
                affected_prompt_count: 5,
                affected_engines: vec![EngineId::Doubao],
                evidence_issue_ids: Vec::new(),
                quick_win: false,
                status: ActionStatus::Done,
                completed_at: Some(now()),
                updated_at: now(),
            },
        ],
        attribution: Vec::new(),
        contents: Vec::new(),
        templates: Vec::new(),
    }
}

async fn seed_records_and_issues(state: &geo_desktop_lib::state::AppState) {
    CollectionRepo::new(state.pool.clone())
        .insert_record(&CollectionRecordDetail {
            record: CollectionRecord {
                id: "record-1".to_string(),
                round_id: "round-1".to_string(),
                prompt_id: "prompt-1".to_string(),
                prompt_text: "哪家好用".to_string(),
                intent: IntentCategory::PurchaseRecommendation,
                engine: EngineId::Doubao,
                model: "demo-model".to_string(),
                channel: EngineChannel::OfficialApi,
                status: CollectionStatus::Succeeded,
                failure_reason: None,
                mentioned: true,
                rank: Some(2),
                sentiment: None,
                citation_count: 1,
                collected_at: now(),
                latency_ms: 1200,
                prompt_tokens: 100,
                completion_tokens: 50,
                repeat_index: 0,
            },
            answer_text: "推荐澜舟，价格 199 元起。".to_string(),
            citations: Vec::new(),
            screenshot_path: None,
        })
        .await
        .expect("记录");
    sqlx::query(
        "INSERT INTO fact_check_issues (id, round_id, record_id, prompt_id, prompt_text, engine, \
         kind, field_path, answer_excerpt, entity_value, confidence, status, correction_channel, \
         note, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
    )
    .bind("issue-1")
    .bind("round-1")
    .bind("record-1")
    .bind("prompt-1")
    .bind("哪家好用")
    .bind("doubao")
    .bind("wrong")
    .bind("pricing")
    .bind("价格 199 元起")
    .bind("价格 299 元起")
    .bind(0.9_f64)
    .bind("open")
    .bind("official_site")
    .execute(&state.pool)
    .await
    .expect("核查问题");
}

async fn seed_all(state: &geo_desktop_lib::state::AppState) -> ProjectId {
    let project_id = seed_round(state, RoundStatus::Succeeded).await;
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
    repo.save_action_board(
        &project_id.to_string(),
        &serde_json::to_string(&action_board(project_id)).unwrap(),
        &now().to_rfc3339(),
    )
    .await
    .unwrap();
    seed_records_and_issues(state).await;
    project_id
}

fn section_ids(document: &geo_domain::ReportDocument) -> Vec<&str> {
    document
        .sections
        .iter()
        .map(|section| section.id.as_str())
        .collect()
}

#[tokio::test]
async fn executive_report_only_has_conclusion_and_pending_next_steps() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = seed_all(&state).await;
    let document = ReportService::from_state(&state)
        .render(
            project_id,
            "round-1".to_string(),
            ReportRenderOptions::default(),
        )
        .await
        .expect("渲染报告");
    assert_eq!(document.variant, ReportVariant::Executive);
    assert_eq!(section_ids(&document), vec!["conclusion"]);
    assert_eq!(document.brand_name, sample_draft().brand_name);
    assert_eq!(document.next_steps, vec!["补齐产品页定义句".to_string()]);
    assert_eq!(document.methodology.sample_size, 62);
    assert_eq!(document.methodology.repeat_count, 2);
    assert!(document.methodology.model_versions.is_empty());
}

#[tokio::test]
async fn detailed_report_includes_all_sections() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = seed_all(&state).await;
    let document = ReportService::from_state(&state)
        .render(
            project_id,
            "round-1".to_string(),
            ReportRenderOptions {
                variant: Some(ReportVariant::Detailed),
                ..ReportRenderOptions::default()
            },
        )
        .await
        .expect("渲染报告");
    assert_eq!(
        section_ids(&document),
        vec![
            "conclusion",
            "coverage",
            "competitors",
            "engines",
            "funnel",
            "fact_check",
            "actions"
        ]
    );
    let actions = document
        .sections
        .iter()
        .find(|section| section.id == "actions")
        .expect("行动章节");
    match &actions.blocks[0] {
        ReportBlock::List { items } => {
            assert_eq!(items.len(), 2, "报告列出全部行动，不只待办");
        }
        other => panic!("行动章节应为 List，实际 {other:?}"),
    }
}

#[tokio::test]
async fn white_label_report_drops_internal_sections() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = seed_all(&state).await;
    let document = ReportService::from_state(&state)
        .render(
            project_id,
            "round-1".to_string(),
            ReportRenderOptions {
                variant: Some(ReportVariant::WhiteLabel),
                ..ReportRenderOptions::default()
            },
        )
        .await
        .expect("渲染报告");
    let ids = section_ids(&document);
    assert_eq!(
        ids,
        vec!["conclusion", "coverage", "competitors", "actions"]
    );
    assert!(!ids.contains(&"funnel"));
    assert!(!ids.contains(&"fact_check"));
}

#[tokio::test]
async fn evidence_appendix_is_appended_when_requested() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = seed_all(&state).await;
    let document = ReportService::from_state(&state)
        .render(
            project_id,
            "round-1".to_string(),
            ReportRenderOptions {
                variant: Some(ReportVariant::Detailed),
                include_evidence: true,
                ..ReportRenderOptions::default()
            },
        )
        .await
        .expect("渲染报告");
    let evidence = document
        .sections
        .iter()
        .find(|section| section.id == "evidence")
        .expect("证据附录");
    match &evidence.blocks[0] {
        ReportBlock::Table { column_keys, rows } => {
            assert_eq!(column_keys.len(), 6);
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0][3], "mentioned");
            assert_eq!(rows[0][4], "2");
            assert!(rows[0][5].contains("推荐澜舟"));
        }
        other => panic!("证据附录应为 Table，实际 {other:?}"),
    }
}

#[tokio::test]
async fn report_rejects_unfinished_round() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = seed_round(&state, RoundStatus::Running).await;
    let error = ReportService::from_state(&state)
        .render(
            project_id,
            "round-1".to_string(),
            ReportRenderOptions::default(),
        )
        .await
        .expect_err("未完成轮次不能出报告");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(error.params["field"], "round_id");
    assert_eq!(error.params["reason"], "invalid_format");
}

#[tokio::test]
async fn report_rejects_unknown_round() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = seed_round(&state, RoundStatus::Succeeded).await;
    let error = ReportService::from_state(&state)
        .render(
            project_id,
            "missing".to_string(),
            ReportRenderOptions::default(),
        )
        .await
        .expect_err("未知轮次");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(error.params["field"], "round_id");
    assert_eq!(error.params["reason"], "invalid_id");
}

#[tokio::test]
async fn report_rejects_round_of_another_project() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = seed_all(&state).await;
    let other = ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("第二个项目")
        .id;
    assert_ne!(other, project_id);
    let error = ReportService::from_state(&state)
        .render(other, "round-1".to_string(), ReportRenderOptions::default())
        .await
        .expect_err("轮次不属于该项目");
    assert_eq!(error.params["reason"], "invalid_id");
}

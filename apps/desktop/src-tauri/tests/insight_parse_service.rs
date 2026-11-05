//! 采集后自动解析（M4）集成测试：抽取 → 事实核查 → 汇总 → 引用落库。

mod support;

use geo_domain::{
    BrandRole, FactIssueKind, FactIssueStatus, IntentCategory, ProjectId, PromptItem, PromptSet,
    RiskFlag, Sentiment, SourceType,
};
use geo_store::{CollectionRepo, PromptSetRepo};
use support::{now, openai_response, sample_draft, state_with_transport, ScriptedTransport};

use geo_desktop_lib::services::{
    ActionService, CollectionService, CollectionStartOptions, DiagnosisService, InsightService,
    ProjectService,
};

fn parse_body(confidence: f64) -> String {
    openai_response(
        &serde_json::json!({
            "mentions": [
                {
                    "brand": "澜舟", "role": "self", "count": 2, "sentiment": "positive",
                    "rank": 2, "in_comparison_table": true, "excerpt": "推荐澜舟"
                },
                {
                    "brand": "南方泵业", "role": "competitor", "count": 1, "sentiment": "neutral",
                    "rank": 1, "in_comparison_table": true, "excerpt": "南方泵业排第一"
                }
            ],
            "self_mentioned": true,
            "self_rank": 2,
            "self_sentiment": "positive",
            "answer_shape": { "has_conclusion": true, "has_table": true, "asks_back": false, "refused": false },
            "sources": [{ "url": "https://www.example.com/guide", "title": "选型指南", "type": "owned_page" }],
            "risks": ["absolute_wording"],
            "issues": [{
                "kind": "wrong", "field_path": "price_range",
                "answer_excerpt": "199 元起", "entity_value": "299 元起", "confidence": 0.9
            }],
            "confidence": confidence
        })
        .to_string(),
    )
}

async fn seed_set(state: &geo_desktop_lib::state::AppState) -> (ProjectId, String) {
    let project_id = ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目")
        .id;
    let set_id = geo_domain::PromptSetId::new();
    let set = PromptSet::new(
        project_id,
        1,
        "题库",
        vec![PromptItem::new(
            set_id,
            "工业除尘器怎么选",
            IntentCategory::PurchaseRecommendation,
        )],
        now(),
        None,
    );
    PromptSetRepo::new(state.pool.clone())
        .create(&set)
        .await
        .expect("建题库");
    (project_id, set.id.to_string())
}

async fn collect_once(state: &geo_desktop_lib::state::AppState) -> (ProjectId, String) {
    let (project_id, set_id) = seed_set(state).await;
    let service = CollectionService::from_state(state);
    let round = service
        .start(
            project_id,
            CollectionStartOptions {
                prompt_set_id: set_id,
                engine_scope: vec![geo_domain::EngineId::Deepseek],
                repeat_count: 1,
                label: None,
            },
        )
        .await
        .expect("排一轮");
    service.execute_round(&round.id).await.expect("采集 + 解析");
    (project_id, round.id)
}

#[tokio::test]
async fn collection_triggers_parsing_fact_check_and_citations() {
    let (state, _server, _secrets) = state_with_transport(ScriptedTransport::new(vec![
        openai_response("推荐宏宇泵业（第二），价格 199 元起。南方泵业排第一。"),
        parse_body(0.9),
    ]))
    .await;
    let (project_id, round_id) = collect_once(&state).await;
    let insight_service = InsightService::from_state(&state);
    let insights = insight_service
        .insight_list(round_id.clone(), geo_domain::InsightFilter::default())
        .await
        .expect("解析结果");
    assert_eq!(insights.len(), 1);
    let insight = &insights[0];
    assert!(insight.self_mentioned);
    assert_eq!(insight.self_rank, Some(2));
    assert_eq!(insight.self_sentiment, Some(Sentiment::Positive));
    assert_eq!(insight.mentions.len(), 2);
    assert_eq!(insight.mentions[0].role, BrandRole::Self_);
    assert_eq!(
        insight.mentions[0].brand, "宏宇泵业",
        "解析器不信任模型写的本品牌名"
    );
    assert_eq!(insight.mentions[0].count, 2);
    assert_eq!(insight.mentions[1].role, BrandRole::Competitor);
    assert!(insight.answer_shape.has_table);
    assert!(!insight.needs_review);
    assert_eq!(insight.risks, vec![RiskFlag::AbsoluteWording]);
    assert_eq!(insight.source_types.get("owned_page"), Some(&1));

    let diagnosis = DiagnosisService::from_state(&state);
    let overview = diagnosis
        .overview(round_id.clone())
        .await
        .expect("诊断快照")
        .expect("本轮有诊断");
    assert_eq!(overview.sample_size, 1);
    assert_eq!(overview.brand_coverage, 1.0);
    assert_eq!(overview.dimensions.len(), 5);
    assert!(
        (overview.total_score - 65.5).abs() < 0.001,
        "{}",
        overview.total_score
    );
    assert_eq!(overview.alerts.len(), 1, "事实准确率低于门槛");
    let self_row = diagnosis
        .competitors(round_id.clone())
        .await
        .expect("竞品矩阵")
        .expect("存在");
    assert_eq!(self_row.rows[0].brand, "宏宇泵业");
    assert!(self_row.rows[0].is_self);
    assert_eq!(self_row.rows[0].fact_error_count, 1);
    assert_eq!(self_row.rows[0].cited_domain_count, 1);
    assert!((self_row.rows[0].share_of_voice - 2.0 / 3.0).abs() < 0.001);
    let funnel = diagnosis
        .funnel(round_id.clone())
        .await
        .expect("漏斗")
        .expect("存在");
    assert_eq!(funnel.rows.len(), 1);
    assert_eq!(
        funnel.rows[0].stage,
        geo_domain::FunnelStage::Recommendation
    );
    assert_eq!(funnel.rows[0].prompt_count, 1);
    assert_eq!(funnel.rows[0].mention_rate, 1.0);
    assert_eq!(funnel.rows[0].top3_rate, 1.0);
    let engines = diagnosis.engines(round_id.clone()).await.expect("引擎差异");
    assert_eq!(engines.len(), 1);
    assert_eq!(engines[0].sample_size, 1);
    assert_eq!(engines[0].coverage, 1.0);
    assert_eq!(engines[0].fact_error_rate, 1.0);

    let action_service = ActionService::from_state(&state);
    let action_board = action_service.board(project_id).await.expect("行动看板");
    assert_eq!(action_board.templates.len(), 7);
    let fact_action = action_board
        .actions
        .iter()
        .find(|action| action.id == format!("action-{round_id}-fact-price_range"))
        .expect("事实纠错处方");
    assert_eq!(fact_action.status, geo_domain::ActionStatus::Todo);
    assert_eq!(
        fact_action.affected_engines,
        vec![geo_domain::EngineId::Deepseek]
    );
    assert!(!fact_action.evidence_issue_ids.is_empty());
    action_service
        .update_action_status(fact_action.id.clone(), geo_domain::ActionStatus::Done)
        .await
        .expect("完成处方");
    insight_service
        .parse_round(&round_id)
        .await
        .expect("重建看板");
    let rebuilt_board = action_service.board(project_id).await.expect("行动看板");
    assert_eq!(
        rebuilt_board
            .actions
            .iter()
            .find(|action| action.id == fact_action.id)
            .expect("处方仍在")
            .status,
        geo_domain::ActionStatus::Done,
        "重建不覆盖人工完成状态"
    );

    let board = insight_service
        .fact_check_list(round_id.clone())
        .await
        .expect("核查");
    assert_eq!(board.issues.len(), 1);
    assert_eq!(board.issues[0].kind, FactIssueKind::Wrong);
    assert_eq!(board.issues[0].status, FactIssueStatus::Open);
    assert_eq!(board.issues[0].field_path, "price_range");
    let summary = board.summary.expect("汇总");
    assert_eq!(summary.checked_answers, 1);
    assert_eq!(summary.by_kind.get(&FactIssueKind::Wrong), Some(&1));
    assert_eq!(summary.fact_accuracy, 0.0);
    assert_eq!(summary.false_positive_count, 0);

    let repo = CollectionRepo::new(state.pool.clone());
    let record = repo.records(&round_id).await.expect("记录")[0].clone();
    assert_eq!(record.citation_count, 1);
    let detail = repo.record(&record.id).await.expect("证据").expect("存在");
    assert_eq!(detail.citations.len(), 1);
    assert_eq!(detail.citations[0].domain, "www.example.com");
    assert_eq!(detail.citations[0].source_type, SourceType::OwnedPage);

    // 幂等：再跑一次不会重复插入解析行。
    assert_eq!(
        insight_service
            .parse_round(&round_id)
            .await
            .expect("重复解析"),
        0
    );
    assert_eq!(
        insight_service
            .insight_list(round_id.clone(), geo_domain::InsightFilter::default())
            .await
            .expect("解析结果")
            .len(),
        1
    );

    // 已读状态在诊断重建后必须保留。
    let alert_id = overview.alerts[0].id.clone();
    diagnosis
        .acknowledge_alert(alert_id.clone(), true)
        .await
        .expect("标记已读");
    insight_service
        .parse_round(&round_id)
        .await
        .expect("重建诊断");
    let rebuilt = diagnosis
        .overview(round_id.clone())
        .await
        .expect("诊断快照")
        .expect("存在");
    assert_eq!(rebuilt.alerts.len(), 1);
    assert_eq!(rebuilt.alerts[0].id, alert_id, "告警 id 在重建后保持稳定");
    assert!(rebuilt.alerts[0].acknowledged, "已读状态不能被重建洗掉");

    // 标记误报后重算汇总：准确率回到 1.0，误报数 1。
    let issue_id = board.issues[0].id.clone();
    insight_service
        .resolve_fact_issue(
            issue_id,
            "false_positive".to_string(),
            Some("金额口径看错".to_string()),
            now(),
        )
        .await
        .expect("标记误报");
    let board = insight_service
        .fact_check_list(round_id.clone())
        .await
        .expect("核查");
    let summary = board.summary.expect("汇总");
    assert_eq!(summary.false_positive_count, 1);
    assert_eq!(summary.fact_accuracy, 1.0);
    let rebuilt_board = action_service.board(project_id).await.expect("行动看板");
    assert!(
        rebuilt_board
            .actions
            .iter()
            .all(|action| !action.id.contains("-fact-")),
        "误报排除后事实纠错处方应消失"
    );
    assert!(
        rebuilt_board
            .actions
            .iter()
            .any(|action| action.id == format!("action-{round_id}-maintain")),
        "没有阻塞问题时留一条复测动作"
    );
    let overview = diagnosis
        .overview(round_id)
        .await
        .expect("诊断快照")
        .expect("存在");
    assert_eq!(overview.fact_accuracy, 1.0);
    assert!(
        (overview.total_score - 90.5).abs() < 0.001,
        "{}",
        overview.total_score
    );
    assert!(overview.alerts.is_empty(), "误报后事实告警应消失");
    assert_eq!(overview.alerts.len(), 0);
    // 旧告警已读状态只对仍存在的告警有意义；这里告警已消失，重建不报错即可。
    let _ = alert_id;
}

#[tokio::test]
async fn manual_correction_rebuilds_diagnosis_and_actions() {
    let (state, _server, _secrets) = state_with_transport(ScriptedTransport::new(vec![
        openai_response("推荐宏宇泵业（第二），价格 199 元起。南方泵业排第一。"),
        parse_body(0.9),
    ]))
    .await;
    let (project_id, round_id) = collect_once(&state).await;
    let insight_service = InsightService::from_state(&state);
    let insight = insight_service
        .insight_list(round_id.clone(), geo_domain::InsightFilter::default())
        .await
        .expect("解析结果")[0]
        .clone();
    insight_service
        .correct_insight(
            insight.id,
            geo_domain::InsightCorrection {
                self_mentioned: Some(false),
                ..geo_domain::InsightCorrection::default()
            },
            now(),
        )
        .await
        .expect("人工纠正");
    let overview = DiagnosisService::from_state(&state)
        .overview(round_id)
        .await
        .expect("诊断快照")
        .expect("存在");
    assert_eq!(overview.brand_coverage, 0.0, "纠正后覆盖率同步下降");
    let board = ActionService::from_state(&state)
        .board(project_id)
        .await
        .expect("行动看板");
    assert!(
        board
            .actions
            .iter()
            .any(|action| action.category == geo_domain::ActionCategory::SiteStructure),
        "覆盖率掉到门槛下后应生成官网结构处方"
    );
}

#[tokio::test]
async fn low_confidence_insight_enters_review_queue() {
    let (state, _server, _secrets) = state_with_transport(ScriptedTransport::new(vec![
        openai_response("推荐澜舟。"),
        parse_body(0.5),
    ]))
    .await;
    let (_project_id, round_id) = collect_once(&state).await;
    let insights = InsightService::from_state(&state)
        .insight_list(round_id, geo_domain::InsightFilter::default())
        .await
        .expect("解析结果");
    assert_eq!(insights.len(), 1);
    assert!(insights[0].needs_review);
    assert_eq!(insights[0].confidence, 0.5);
}

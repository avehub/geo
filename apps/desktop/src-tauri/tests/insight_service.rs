//! M4 解析与核查读路径服务集成测试（Plan C M3–M7 第二段）。

mod support;

use std::collections::BTreeMap;

use geo_domain::{
    AnswerInsight, AnswerShape, BrandMention, BrandRole, CollectionRecord, CollectionRecordDetail,
    CollectionRound, CollectionStatus, CorrectionChannel, EngineChannel, EngineId, FactCheckIssue,
    FactCheckSummary, FactIssueKind, FactIssueStatus, InsightCorrection, InsightFilter, RiskFlag,
    RoundStatus, SampleSizeGrade, Sentiment,
};
use geo_store::{CollectionRepo, InsightRepo};
use support::{now, sample_draft, test_state, OfflineTransport};

use geo_desktop_lib::services::{InsightService, ProjectService};

async fn seed_round(state: &geo_desktop_lib::state::AppState) {
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
}

fn insight(id: &str, engine: EngineId, needs_review: bool) -> AnswerInsight {
    AnswerInsight {
        id: id.to_string(),
        round_id: "round-1".to_string(),
        record_id: format!("rec-{id}"),
        prompt_id: format!("prompt-{id}"),
        prompt_text: "问题".to_string(),
        engine,
        mentions: vec![BrandMention {
            brand: "澜舟".to_string(),
            role: BrandRole::Self_,
            count: 1,
            sentiment: Sentiment::Positive,
            rank: Some(1),
            in_comparison_table: false,
            excerpt: "片段".to_string(),
        }],
        self_mentioned: true,
        self_rank: Some(1),
        self_sentiment: Some(Sentiment::Positive),
        answer_shape: AnswerShape {
            has_conclusion: true,
            has_table: false,
            asks_back: false,
            refused: false,
        },
        source_types: BTreeMap::new(),
        confidence: 0.9,
        needs_review,
        risks: if needs_review {
            vec![RiskFlag::AbsoluteWording]
        } else {
            Vec::new()
        },
        corrected_fields: Vec::new(),
        reviewed_at: None,
    }
}

fn issue(id: &str, kind: FactIssueKind) -> FactCheckIssue {
    FactCheckIssue {
        id: id.to_string(),
        round_id: "round-1".to_string(),
        record_id: format!("rec-{id}"),
        prompt_id: format!("prompt-{id}"),
        prompt_text: "问题".to_string(),
        engine: EngineId::Doubao,
        kind,
        field_path: "qualifications".to_string(),
        answer_excerpt: "片段".to_string(),
        entity_value: "ISO9001".to_string(),
        confidence: 0.88,
        status: FactIssueStatus::Open,
        correction_channel: CorrectionChannel::OfficialSite,
        note: None,
        resolved_at: None,
    }
}

#[tokio::test]
async fn insight_list_applies_filters() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    seed_round(&state).await;
    let repo = InsightRepo::new(state.pool.clone());
    repo.insert_insight(&insight("i1", EngineId::Doubao, true))
        .await
        .expect("i1");
    repo.insert_insight(&insight("i2", EngineId::Kimi, false))
        .await
        .expect("i2");
    let service = InsightService::from_state(&state);
    assert_eq!(
        service
            .insight_list("round-1".to_string(), InsightFilter::default())
            .await
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        service
            .insight_list(
                "round-1".to_string(),
                InsightFilter {
                    needs_review: Some(true),
                    ..Default::default()
                }
            )
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        service
            .insight_list(
                "round-1".to_string(),
                InsightFilter {
                    engine: Some(EngineId::Kimi),
                    ..Default::default()
                }
            )
            .await
            .unwrap()[0]
            .id,
        "i2"
    );
    assert_eq!(
        service
            .insight_list(
                "round-1".to_string(),
                InsightFilter {
                    risk: Some(RiskFlag::AbsoluteWording),
                    ..Default::default()
                }
            )
            .await
            .unwrap()[0]
            .id,
        "i1"
    );
}

#[tokio::test]
async fn fact_check_list_returns_issues_and_summary() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    seed_round(&state).await;
    let repo = InsightRepo::new(state.pool.clone());
    repo.insert_issue(&issue("f1", FactIssueKind::Wrong))
        .await
        .expect("f1");
    repo.insert_issue(&issue("f2", FactIssueKind::Outdated))
        .await
        .expect("f2");
    repo.insert_summary(&FactCheckSummary {
        round_id: "round-1".to_string(),
        by_kind: BTreeMap::from([(FactIssueKind::Wrong, 1), (FactIssueKind::Outdated, 1)]),
        checked_answers: 20,
        fact_accuracy: 0.9,
        false_positive_count: 1,
    })
    .await
    .expect("summary");
    let board = InsightService::from_state(&state)
        .fact_check_list("round-1".to_string())
        .await
        .expect("核查看板");
    assert_eq!(board.issues.len(), 2);
    assert_eq!(board.summary.unwrap().fact_accuracy, 0.9);
}

#[tokio::test]
async fn insight_list_unknown_round_is_invalid_id() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = InsightService::from_state(&state)
        .insight_list("missing".to_string(), InsightFilter::default())
        .await
        .expect_err("未知轮次");
    assert_eq!(error.params["field"], "round_id");
}

#[tokio::test]
async fn fact_check_list_unknown_round_is_invalid_id() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = InsightService::from_state(&state)
        .fact_check_list("missing".to_string())
        .await
        .expect_err("未知轮次");
    assert_eq!(error.params["field"], "round_id");
}

fn record(id: &str) -> CollectionRecordDetail {
    CollectionRecordDetail {
        record: CollectionRecord {
            id: id.to_string(),
            round_id: "round-1".to_string(),
            prompt_id: "prompt-1".to_string(),
            prompt_text: "问题".to_string(),
            intent: geo_domain::IntentCategory::CategoryAwareness,
            engine: EngineId::Doubao,
            model: "model-x".to_string(),
            channel: EngineChannel::OfficialApi,
            status: CollectionStatus::Succeeded,
            failure_reason: None,
            mentioned: true,
            rank: Some(1),
            sentiment: Some(Sentiment::Positive),
            citation_count: 0,
            collected_at: now(),
            latency_ms: 1000,
            prompt_tokens: 10,
            completion_tokens: 5,
            repeat_index: 1,
        },
        answer_text: "回答".to_string(),
        citations: Vec::new(),
        screenshot_path: None,
    }
}

#[tokio::test]
async fn correction_clears_rank_and_syncs_record_projection() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    seed_round(&state).await;
    CollectionRepo::new(state.pool.clone())
        .insert_record(&record("rec-i1"))
        .await
        .expect("记录");
    let repo = InsightRepo::new(state.pool.clone());
    repo.insert_insight(&insight("i1", EngineId::Doubao, true))
        .await
        .expect("解析");
    let service = InsightService::from_state(&state);
    let corrected = service
        .correct_insight(
            "i1".to_string(),
            InsightCorrection {
                self_mentioned: Some(false),
                self_rank: Some(Some(2)),
                self_sentiment: Some(Some(Sentiment::Negative)),
            },
            now(),
        )
        .await
        .expect("纠正");
    assert!(!corrected.self_mentioned);
    assert!(corrected.self_rank.is_none());
    assert!(corrected.self_sentiment.is_none());
    assert_eq!(
        corrected.corrected_fields,
        vec!["self_mentioned".to_string()]
    );
    assert!(!corrected.needs_review);
    assert!(corrected.reviewed_at.is_some());

    let stored = CollectionRepo::new(state.pool.clone())
        .record("rec-i1")
        .await
        .unwrap()
        .unwrap()
        .record;
    assert!(!stored.mentioned);
    assert!(stored.rank.is_none());
    assert!(stored.sentiment.is_none());
}

#[tokio::test]
async fn correction_rejects_invalid_rank() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    seed_round(&state).await;
    InsightRepo::new(state.pool.clone())
        .insert_insight(&insight("i1", EngineId::Doubao, true))
        .await
        .unwrap();
    let error = InsightService::from_state(&state)
        .correct_insight(
            "i1".to_string(),
            InsightCorrection {
                self_rank: Some(Some(0)),
                ..Default::default()
            },
            now(),
        )
        .await
        .expect_err("非法位次必须拒绝");
    assert_eq!(error.params["field"], "self_rank");
}

#[tokio::test]
async fn correction_unknown_id_is_invalid_id() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = InsightService::from_state(&state)
        .correct_insight("missing".to_string(), InsightCorrection::default(), now())
        .await
        .expect_err("未知解析结果");
    assert_eq!(error.params["field"], "insight_id");
}

#[tokio::test]
async fn fact_issue_resolve_and_reopen_preserve_note() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    seed_round(&state).await;
    InsightRepo::new(state.pool.clone())
        .insert_issue(&issue("f1", FactIssueKind::Wrong))
        .await
        .unwrap();
    let service = InsightService::from_state(&state);
    let resolved = service
        .resolve_fact_issue(
            "f1".to_string(),
            "corrected".to_string(),
            Some("已改官网".to_string()),
            now(),
        )
        .await
        .expect("结办");
    assert_eq!(resolved.status, FactIssueStatus::Corrected);
    assert_eq!(resolved.note.as_deref(), Some("已改官网"));
    assert!(resolved.resolved_at.is_some());

    let reopened = service
        .resolve_fact_issue("f1".to_string(), "open".to_string(), None, now())
        .await
        .expect("重新打开");
    assert_eq!(reopened.status, FactIssueStatus::Open);
    assert!(reopened.resolved_at.is_none());
    assert_eq!(reopened.note.as_deref(), Some("已改官网"));
}

#[tokio::test]
async fn fact_issue_unknown_id_is_invalid_id() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = InsightService::from_state(&state)
        .resolve_fact_issue("missing".to_string(), "corrected".to_string(), None, now())
        .await
        .expect_err("未知核查问题");
    assert_eq!(error.params["field"], "issue_id");
}

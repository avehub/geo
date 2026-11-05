//! M3 采集读路径服务集成测试（Plan C M3–M7 第一段）。

mod support;

use chrono::Duration;
use geo_domain::{
    Citation, CollectionRecord, CollectionRecordDetail, CollectionRound, CollectionStatus,
    CollectionTask, EngineChannel, EngineId, EngineRun, FailureReason, IntentCategory, ProjectId,
    RecordFilter, RoundStatus, SampleSizeGrade, Sentiment, SourceType,
};
use geo_store::CollectionRepo;
use support::{now, sample_draft, test_state, OfflineTransport};

use geo_desktop_lib::services::{CollectionService, ProjectService};

async fn project(state: &geo_desktop_lib::state::AppState) -> ProjectId {
    ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目")
        .id
}

fn round(project_id: ProjectId) -> CollectionRound {
    CollectionRound {
        id: "round-1".to_string(),
        project_id: project_id.to_string(),
        prompt_set_id: "set-1".to_string(),
        prompt_set_label: "核心题库".to_string(),
        prompt_set_version: 1,
        label: "第 1 轮 · 基线体检".to_string(),
        round_index: 1,
        status: RoundStatus::Succeeded,
        engine_scope: vec![EngineId::Doubao, EngineId::Kimi],
        repeat_count: 1,
        planned_queries: 4,
        completed_queries: 3,
        failed_queries: 1,
        success_rate: 0.75,
        started_at: Some(now()),
        finished_at: Some(now() + Duration::seconds(60)),
        metric_spec_version: "geo-metrics-v1".to_string(),
        sample_size_grade: SampleSizeGrade::Sufficient,
        notes: None,
    }
}

fn record(id: &str, engine: EngineId, mentioned: bool) -> CollectionRecordDetail {
    CollectionRecordDetail {
        record: CollectionRecord {
            id: id.to_string(),
            round_id: "round-1".to_string(),
            prompt_id: format!("prompt-{id}"),
            prompt_text: "什么是脉冲布袋除尘器？".to_string(),
            intent: IntentCategory::CategoryAwareness,
            engine,
            model: "model-x".to_string(),
            channel: EngineChannel::OfficialApi,
            status: if mentioned {
                CollectionStatus::Succeeded
            } else {
                CollectionStatus::Failed
            },
            failure_reason: if mentioned {
                None
            } else {
                Some(FailureReason::Timeout)
            },
            mentioned,
            rank: if mentioned { Some(1) } else { None },
            sentiment: if mentioned {
                Some(Sentiment::Positive)
            } else {
                None
            },
            citation_count: if mentioned { 1 } else { 0 },
            collected_at: now() + Duration::seconds(if mentioned { 10 } else { 20 }),
            latency_ms: 2000,
            prompt_tokens: 100,
            completion_tokens: 50,
            repeat_index: 1,
        },
        answer_text: "回答全文".to_string(),
        citations: if mentioned {
            vec![Citation {
                url: "https://example.com/page".to_string(),
                domain: "example.com".to_string(),
                title: Some("页面".to_string()),
                source_type: SourceType::OwnedPage,
            }]
        } else {
            Vec::new()
        },
        screenshot_path: None,
    }
}

async fn seed(state: &geo_desktop_lib::state::AppState, project_id: ProjectId) {
    let repo = CollectionRepo::new(state.pool.clone());
    repo.insert_round(&round(project_id)).await.expect("轮次");
    repo.insert_engine_run(
        "round-1",
        &EngineRun {
            engine: EngineId::Doubao,
            channel: EngineChannel::OfficialApi,
            model: "model-x".to_string(),
            planned: 2,
            succeeded: 1,
            failed: 1,
            avg_latency_ms: 2000,
            prompt_tokens: 100,
            completion_tokens: 50,
        },
    )
    .await
    .expect("引擎汇总");
    repo.insert_task(&CollectionTask {
        id: "task-1".to_string(),
        round_id: "round-1".to_string(),
        prompt_id: "prompt-rec-1".to_string(),
        prompt_text: "什么是脉冲布袋除尘器？".to_string(),
        intent: IntentCategory::CategoryAwareness,
        engine: EngineId::Doubao,
        channel: EngineChannel::OfficialApi,
        status: CollectionStatus::Succeeded,
        attempt: 1,
        failure_reason: None,
        record_id: Some("rec-1".to_string()),
        queued_at: now(),
        finished_at: Some(now() + Duration::seconds(5)),
        latency_ms: Some(2000),
    })
    .await
    .expect("任务");
    repo.insert_record(&record("rec-1", EngineId::Doubao, true))
        .await
        .expect("记录一");
    repo.insert_record(&record("rec-2", EngineId::Kimi, false))
        .await
        .expect("记录二");
}

#[tokio::test]
async fn board_returns_rounds_and_usage_sums() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    seed(&state, project_id).await;
    let board = CollectionService::from_state(&state)
        .board(project_id)
        .await
        .expect("board");
    assert_eq!(board.rounds.len(), 1);
    assert_eq!(board.usage.rows.len(), 1);
    assert_eq!(board.usage.total_queries, 4);
    assert_eq!(board.usage.total_tokens, 150);
    assert!(!board.usage.quota_exceeded);
}

#[tokio::test]
async fn round_get_returns_engine_runs_and_tasks() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    seed(&state, project_id).await;
    let detail = CollectionService::from_state(&state)
        .round_get("round-1".to_string())
        .await
        .expect("轮次详情");
    assert_eq!(detail.engines.len(), 1);
    assert_eq!(detail.tasks.len(), 1);
    assert_eq!(detail.round.id, "round-1");
}

#[tokio::test]
async fn record_list_applies_and_filters() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    seed(&state, project_id).await;
    let service = CollectionService::from_state(&state);
    assert_eq!(
        service
            .record_list("round-1".to_string(), RecordFilter::default())
            .await
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        service
            .record_list(
                "round-1".to_string(),
                RecordFilter {
                    engine: Some(EngineId::Doubao),
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
            .record_list(
                "round-1".to_string(),
                RecordFilter {
                    mentioned: Some(false),
                    ..Default::default()
                }
            )
            .await
            .unwrap()[0]
            .id,
        "rec-2"
    );
}

#[tokio::test]
async fn record_get_returns_answer_and_citations() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    seed(&state, project_id).await;
    let detail = CollectionService::from_state(&state)
        .record_get("rec-1".to_string())
        .await
        .expect("证据");
    assert_eq!(detail.record.id, "rec-1");
    assert_eq!(detail.answer_text, "回答全文");
    assert_eq!(detail.citations.len(), 1);
    assert_eq!(detail.citations[0].domain, "example.com");
}

#[tokio::test]
async fn unknown_round_and_record_are_invalid_id() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let service = CollectionService::from_state(&state);
    let round_error = service
        .round_get("missing".to_string())
        .await
        .expect_err("未知轮次");
    assert_eq!(round_error.params["field"], "round_id");
    let record_error = service
        .record_get("missing".to_string())
        .await
        .expect_err("未知证据");
    assert_eq!(record_error.params["field"], "record_id");
}

#[tokio::test]
async fn missing_project_is_project_not_found() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = CollectionService::from_state(&state)
        .board(ProjectId::new())
        .await
        .expect_err("未知项目");
    assert_eq!(error.code, "project/not_found");
}

//! `collection_start` / `collection_task_retry` 的采集执行集成测试（全程离线）。

mod support;

use geo_domain::{
    CollectionStatus, EngineId, IntentCategory, ProjectId, PromptItem, PromptSet, RoundStatus,
};
use geo_store::{PromptSetRepo, SecretStore};
use support::{
    now, openai_response, sample_draft, state_with_transport, ScriptedTransport, TEST_API_KEY,
};

use geo_desktop_lib::services::{CollectionService, CollectionStartOptions, ProjectService};

async fn seed_set(state: &geo_desktop_lib::state::AppState, items: usize) -> (ProjectId, String) {
    let project_id = ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目")
        .id;
    let set_id = geo_domain::PromptSetId::new();
    let prompts = (0..items)
        .map(|index| {
            PromptItem::new(
                set_id,
                format!("问题 {index}"),
                IntentCategory::PurchaseRecommendation,
            )
        })
        .collect();
    let set = PromptSet::new(project_id, 1, "题库", prompts, now(), None);
    PromptSetRepo::new(state.pool.clone())
        .create(&set)
        .await
        .expect("建题库");
    (project_id, set.id.to_string())
}

fn options(set_id: &str, engines: Vec<EngineId>, repeat: i32) -> CollectionStartOptions {
    CollectionStartOptions {
        prompt_set_id: set_id.to_string(),
        engine_scope: engines,
        repeat_count: repeat,
        label: None,
    }
}

#[tokio::test]
async fn start_queues_tasks_and_executes_deepseek() {
    let transport = ScriptedTransport::new(vec![openai_response("推荐澜舟，价格 199 元起。")]);
    let (state, _server, _secrets) = state_with_transport(transport.clone()).await;
    let (project_id, set_id) = seed_set(&state, 1).await;
    let service = CollectionService::from_state(&state);
    let round = service
        .start(project_id, options(&set_id, vec![EngineId::Deepseek], 1))
        .await
        .expect("排一轮");
    assert_eq!(round.status, RoundStatus::Queued);
    assert_eq!(round.planned_queries, 1);
    assert_eq!(round.engine_scope, vec![EngineId::Deepseek]);

    let tasks = state.pool.clone();
    let queued = geo_store::CollectionRepo::new(tasks)
        .tasks(&round.id)
        .await
        .expect("任务");
    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0].status, CollectionStatus::Queued);

    service.execute_round(&round.id).await.expect("执行");
    let repo = geo_store::CollectionRepo::new(state.pool.clone());
    let done = repo.tasks(&round.id).await.expect("任务");
    assert_eq!(done[0].status, CollectionStatus::Succeeded);
    assert!(done[0].record_id.is_some());
    let records = repo.records(&round.id).await.expect("记录");
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].engine, EngineId::Deepseek);
    assert!(records[0].prompt_tokens > 0);
    assert!(!records[0].mentioned, "采集不判定提及");
    let detail = repo
        .record(done[0].record_id.as_deref().unwrap())
        .await
        .expect("证据")
        .expect("存在");
    assert!(detail.answer_text.contains("澜舟"));

    let round = repo.round(&round.id).await.expect("轮次").expect("存在");
    assert_eq!(round.status, RoundStatus::Succeeded);
    assert_eq!(round.completed_queries, 1);
    assert_eq!(round.success_rate, 1.0);
    assert!(round.finished_at.is_some());
    let runs = repo.engine_runs(&round.id).await.expect("引擎汇总");
    assert_eq!(runs[0].succeeded, 1);
    assert_eq!(runs[0].failed, 0);
    assert!(runs[0].prompt_tokens > 0);
    assert_eq!(transport.request_count(), 1);
}

#[tokio::test]
async fn unsupported_engines_are_skipped_and_retry_is_refused() {
    let (state, _server, _secrets) = state_with_transport(ScriptedTransport::new(Vec::new())).await;
    let (project_id, set_id) = seed_set(&state, 1).await;
    let service = CollectionService::from_state(&state);
    let round = service
        .start(project_id, options(&set_id, vec![EngineId::Yuanbao], 1))
        .await
        .expect("排一轮");
    service.execute_round(&round.id).await.expect("执行");
    let repo = geo_store::CollectionRepo::new(state.pool.clone());
    let tasks = repo.tasks(&round.id).await.expect("任务");
    assert_eq!(tasks[0].status, CollectionStatus::Skipped);
    assert_eq!(tasks[0].failure_reason, None);
    let round = repo.round(&round.id).await.expect("轮次").expect("存在");
    assert_eq!(round.status, RoundStatus::Failed);
    assert_eq!(round.failed_queries, 1);
    let runs = repo.engine_runs(&tasks[0].round_id).await.expect("汇总");
    assert_eq!(runs[0].failed, 1, "跳过在引擎汇总里计为失败");

    let error = service
        .retry_task(tasks[0].id.clone())
        .await
        .expect_err("跳过的任务不能重跑");
    assert_eq!(error.code, "state/conflict");
    assert_eq!(error.params["reason"], "not_allowed");
    assert_eq!(error.params["value"], "skipped");
}

#[tokio::test]
async fn missing_key_fails_login_required_then_retry_succeeds() {
    let transport = ScriptedTransport::new(vec![openai_response("Kimi 的回答")]);
    let (state, _server, secrets) = state_with_transport(transport.clone()).await;
    let (project_id, set_id) = seed_set(&state, 1).await;
    let service = CollectionService::from_state(&state);
    let round = service
        .start(project_id, options(&set_id, vec![EngineId::Kimi], 1))
        .await
        .expect("排一轮");
    service.execute_round(&round.id).await.expect("执行");
    let repo = geo_store::CollectionRepo::new(state.pool.clone());
    let tasks = repo.tasks(&round.id).await.expect("任务");
    assert_eq!(tasks[0].status, CollectionStatus::Failed);
    assert_eq!(
        tasks[0].failure_reason,
        Some(geo_domain::FailureReason::LoginRequired)
    );
    assert_eq!(transport.request_count(), 0, "没有 Key 时不发请求");

    secrets
        .set(&geo_store::secret_ref("llm", "moonshot"), TEST_API_KEY)
        .await
        .expect("写 Key");
    let retried = service.retry_task(tasks[0].id.clone()).await.expect("重跑");
    assert_eq!(retried.status, CollectionStatus::Succeeded);
    assert_eq!(retried.attempt, 2);
    assert!(retried.record_id.is_some());
    assert_eq!(transport.request_count(), 1);
    let round = repo.round(&round.id).await.expect("轮次").expect("存在");
    assert_eq!(round.status, RoundStatus::Succeeded);
}

#[tokio::test]
async fn start_validates_scope_repeat_and_prompt_set() {
    let (state, _server, _secrets) = state_with_transport(ScriptedTransport::new(Vec::new())).await;
    let (project_id, set_id) = seed_set(&state, 1).await;
    let service = CollectionService::from_state(&state);

    let empty_scope = service
        .start(project_id, options(&set_id, Vec::new(), 1))
        .await
        .expect_err("空引擎");
    assert_eq!(empty_scope.params["field"], "engine_scope");
    assert_eq!(empty_scope.params["reason"], "empty");

    let bad_repeat = service
        .start(project_id, options(&set_id, vec![EngineId::Deepseek], 4))
        .await
        .expect_err("重复次数越界");
    assert_eq!(bad_repeat.params["field"], "repeat_count");
    assert_eq!(bad_repeat.params["reason"], "out_of_range");
    assert_eq!(bad_repeat.params["expected"], "1~3");

    let missing = service
        .start(
            project_id,
            options(
                &geo_domain::PromptSetId::new().to_string(),
                vec![EngineId::Deepseek],
                1,
            ),
        )
        .await
        .expect_err("题库不存在");
    assert_eq!(missing.code, "prompt_set/not_found");
    assert_eq!(missing.params["kind"], "prompt_set");
}

#[tokio::test]
async fn resume_pending_executes_unfinished_rounds() {
    let (state, _server, _secrets) =
        state_with_transport(ScriptedTransport::new(vec![openai_response("续跑回答")])).await;
    let (project_id, set_id) = seed_set(&state, 1).await;
    let service = CollectionService::from_state(&state);
    let round = service
        .start(project_id, options(&set_id, vec![EngineId::Deepseek], 1))
        .await
        .expect("排一轮");
    let resumed = service.resume_pending().await.expect("续跑");
    assert_eq!(resumed, vec![round.id.clone()]);
    let round = geo_store::CollectionRepo::new(state.pool.clone())
        .round(&round.id)
        .await
        .expect("轮次")
        .expect("存在");
    assert_eq!(round.status, RoundStatus::Succeeded);
}

#[tokio::test]
async fn start_counts_prompt_times_engine_times_repeat() {
    let (state, _server, _secrets) = state_with_transport(ScriptedTransport::new(Vec::new())).await;
    let (project_id, set_id) = seed_set(&state, 2).await;
    let service = CollectionService::from_state(&state);
    let round = service
        .start(
            project_id,
            options(&set_id, vec![EngineId::Deepseek, EngineId::Qwen], 2),
        )
        .await
        .expect("排一轮");
    assert_eq!(round.planned_queries, 8, "2 题 × 2 引擎 × 2 次");
    let tasks = geo_store::CollectionRepo::new(state.pool.clone())
        .tasks(&round.id)
        .await
        .expect("任务");
    assert_eq!(tasks.len(), 8);
}

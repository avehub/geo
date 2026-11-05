//! M3 多引擎采集服务（读路径 + 官方 API 采集执行）。
//!
//! 六条命令：`collection_board` / `collection_round_get` / `collection_record_list` /
//! `collection_record_get` / `collection_start` / `collection_task_retry`。
//!
//! 🔴 只走官方 API（AGENTS 规则 11）：豆包 / DeepSeek / Kimi / 千问 / 百度五家复用
//! 「模型服务商」里已填的 Key；元宝与秘塔没有公开对话 API，任务直接 `Skipped`
//! （引擎汇总里计为 failed，界面上看得出来）。**不碰浏览器自动化 / 模拟登录**。
//!
//! 🔴 采集只落原始回答：`mentioned` / `rank` / `sentiment` 留给 M4 解析，
//! 本层一律 `false` / `None`，不在这里发明提及判定。
//!
//! 用量看板只从引擎执行汇总**求和**（查询数 + token），不做金额估算（DR-8）。

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use geo_domain::{
    sample_size_grade, CollectionBoard, CollectionRecord, CollectionRecordDetail, CollectionRound,
    CollectionRoundDetail, CollectionStatus, CollectionTask, EngineChannel, EngineId, EngineRun,
    FailureReason, GeoError, ProjectId, PromptSetId, RecordFilter, RoundStatus, UsageBoard,
    UsageRow,
};
use geo_llm::{ChatMessage, ChatRequest, LlmClient, LlmError, LlmProvider};
use geo_store::{
    CollectionRepo, ProjectRepo, PromptSetRepo, SecretStore, SettingsRepo, StoreError,
};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::{AppState, LlmFactory};

/// `collection_start` 的入参（与前端 `CollectionStartOptions` 逐字一致）。
#[derive(Debug, Clone, Deserialize)]
pub struct CollectionStartOptions {
    pub prompt_set_id: String,
    pub engine_scope: Vec<EngineId>,
    pub repeat_count: i32,
    #[serde(default)]
    pub label: Option<String>,
}

/// 重复采样上限（产品定义 §3.5：1/2/3）。
const REPEAT_LIMIT: i32 = 3;

/// 采集只问一句：模型直接回答用户问题，不加任何引导。
const COLLECTION_SYSTEM_PROMPT: &str =
    "你是一个中文 AI 搜索助手。请直接、完整地回答用户问题，必要时列出要点。";

#[derive(Clone)]
pub struct CollectionService {
    pool: SqlitePool,
    llm: Arc<LlmFactory>,
    secrets: Arc<dyn SecretStore>,
}

impl CollectionService {
    pub fn new(pool: SqlitePool, llm: Arc<LlmFactory>, secrets: Arc<dyn SecretStore>) -> Self {
        Self { pool, llm, secrets }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone(), state.llm.clone(), state.secrets.clone())
    }

    fn collection(&self) -> CollectionRepo {
        CollectionRepo::new(self.pool.clone())
    }

    fn projects(&self) -> ProjectRepo {
        ProjectRepo::new(self.pool.clone())
    }

    async fn require_project(&self, project_id: ProjectId) -> Result<(), IpcError> {
        self.projects().get(project_id).await?;
        Ok(())
    }

    async fn require_round(&self, round_id: &str) -> Result<CollectionRound, IpcError> {
        match self.collection().round(round_id).await? {
            Some(round) => Ok(round),
            None => Err(GeoError::validation("round_id", "invalid_id")
                .with_param("value", round_id)
                .into()),
        }
    }

    /// 排一轮采集：建轮次 + 任务 + 引擎汇总（全部 `queued`），**不在这里跑**。
    /// IPC 层把 `execute_round` 丢到后台，命令立即返回，界面能看见排队态。
    pub async fn start(
        &self,
        project_id: ProjectId,
        options: CollectionStartOptions,
    ) -> Result<CollectionRound, IpcError> {
        self.require_project(project_id).await?;
        if options.engine_scope.is_empty() {
            return Err(GeoError::validation("engine_scope", "empty").into());
        }
        if !(1..=REPEAT_LIMIT).contains(&options.repeat_count) {
            return Err(GeoError::validation("repeat_count", "out_of_range")
                .with_param("expected", format!("1~{REPEAT_LIMIT}"))
                .with_param("value", options.repeat_count)
                .into());
        }
        let set_id: PromptSetId = options.prompt_set_id.trim().parse().map_err(|_| {
            GeoError::validation("prompt_set_id", "invalid_id")
                .with_param("value", options.prompt_set_id.trim())
        })?;
        let set = match PromptSetRepo::new(self.pool.clone()).get(set_id).await {
            Ok(set) if set.project_id == project_id => set,
            Ok(_) | Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::not_found("prompt_set", set_id).into());
            }
            Err(error) => return Err(error.into()),
        };

        let mut engines = Vec::new();
        for engine in &options.engine_scope {
            if !engines.contains(engine) {
                engines.push(*engine);
            }
        }
        let now = Utc::now();
        let rounds = self.collection().rounds(&project_id.to_string()).await?;
        let round_index = rounds
            .iter()
            .map(|round| round.round_index)
            .max()
            .unwrap_or(0)
            + 1;
        let planned = i32::try_from(
            set.items.len() * engines.len() * usize::try_from(options.repeat_count).unwrap_or(1),
        )
        .unwrap_or(i32::MAX);
        let round = CollectionRound {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: project_id.to_string(),
            prompt_set_id: set.id.to_string(),
            prompt_set_label: set.label.clone(),
            prompt_set_version: set.version,
            label: options
                .label
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| set.label.clone()),
            round_index,
            status: RoundStatus::Queued,
            engine_scope: engines.clone(),
            repeat_count: options.repeat_count,
            planned_queries: planned,
            completed_queries: 0,
            failed_queries: 0,
            success_rate: 0.0,
            started_at: None,
            finished_at: None,
            metric_spec_version: set.metric_spec_version.clone(),
            sample_size_grade: geo_domain::SampleSizeGrade::Insufficient,
            notes: None,
        };
        self.collection().insert_round(&round).await?;
        for engine in &engines {
            self.collection()
                .insert_engine_run(
                    &round.id,
                    &EngineRun {
                        engine: *engine,
                        channel: EngineChannel::OfficialApi,
                        model: String::new(),
                        planned: i32::try_from(
                            set.items.len() * usize::try_from(options.repeat_count).unwrap_or(1),
                        )
                        .unwrap_or(i32::MAX),
                        succeeded: 0,
                        failed: 0,
                        avg_latency_ms: 0,
                        prompt_tokens: 0,
                        completion_tokens: 0,
                    },
                )
                .await?;
        }
        for item in &set.items {
            for engine in &engines {
                for repeat in 1..=options.repeat_count {
                    let task = CollectionTask {
                        id: uuid::Uuid::new_v4().to_string(),
                        round_id: round.id.clone(),
                        prompt_id: item.id.to_string(),
                        prompt_text: item.text.clone(),
                        intent: item.intent,
                        engine: *engine,
                        channel: EngineChannel::OfficialApi,
                        status: CollectionStatus::Queued,
                        attempt: 1,
                        failure_reason: None,
                        record_id: None,
                        queued_at: now,
                        finished_at: None,
                        latency_ms: None,
                    };
                    let _ = repeat;
                    self.collection().insert_task(&task).await?;
                }
            }
        }
        Ok(round)
    }

    /// 后台执行一轮：逐引擎、逐任务顺序跑（频控优先，不并发打上游）。
    pub async fn execute_round(&self, round_id: &str) -> Result<(), IpcError> {
        let mut round = self.require_round(round_id).await?;
        if round.status == RoundStatus::Succeeded
            || round.status == RoundStatus::Partial
            || round.status == RoundStatus::Failed
        {
            return Ok(());
        }
        round.status = RoundStatus::Running;
        if round.started_at.is_none() {
            round.started_at = Some(Utc::now());
        }
        self.collection().update_round(&round).await?;

        let settings = SettingsRepo::new(self.pool.clone()).get().await?;
        let tasks = self.collection().tasks(round_id).await?;
        for engine in round.engine_scope.clone() {
            let client = self.engine_client(&settings, engine).await;
            for mut task in tasks.iter().filter(|task| task.engine == engine).cloned() {
                if !matches!(
                    task.status,
                    CollectionStatus::Queued | CollectionStatus::Running
                ) {
                    continue;
                }
                if engine_provider(engine).is_none() {
                    self.skip_task(&mut task).await?;
                    continue;
                }
                match &client {
                    Ok(client) => {
                        self.execute_task(round_id, &mut task, client).await?;
                    }
                    Err(reason) => {
                        self.fail_task(&mut task, *reason).await?;
                    }
                }
            }
        }
        self.recompute_round(round_id).await?;
        Ok(())
    }

    /// 启动时续跑：把上次没跑完的轮次（`queued` / `running`）按轮次顺序跑完。
    /// 单轮失败不阻断其它轮次；返回本轮尝试续跑的轮次 id。
    pub async fn resume_pending(&self) -> Result<Vec<String>, IpcError> {
        let ids: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM collection_rounds WHERE status IN ('queued', 'running') \
             ORDER BY round_index ASC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        for id in &ids {
            if let Err(error) = self.execute_round(id).await {
                tracing::warn!(
                    round_id = id.as_str(),
                    code = error.code.as_str(),
                    "resume collection round failed"
                );
            }
        }
        Ok(ids)
    }

    /// 重跑一条失败任务（尝试次数 +1），返回更新后的任务。
    pub async fn retry_task(&self, task_id: String) -> Result<CollectionTask, IpcError> {
        let mut task = match self.collection().task(&task_id).await? {
            Some(task) => task,
            None => {
                return Err(GeoError::validation("task_id", "invalid_id")
                    .with_param("value", task_id)
                    .into());
            }
        };
        if task.status != CollectionStatus::Failed {
            return Err(GeoError::conflict("not_allowed")
                .with_param("value", status_str(task.status))
                .into());
        }
        if engine_provider(task.engine).is_none() {
            return Err(GeoError::conflict("not_allowed")
                .with_param("value", "unsupported_engine")
                .into());
        }
        let settings = SettingsRepo::new(self.pool.clone()).get().await?;
        task.attempt += 1;
        match self.engine_client(&settings, task.engine).await {
            Ok(client) => {
                self.execute_task(&task.round_id.clone(), &mut task, &client)
                    .await?
            }
            Err(reason) => self.fail_task(&mut task, reason).await?,
        }
        self.recompute_round(&task.round_id).await?;
        Ok(task)
    }

    /// 按引擎装配客户端：复用用户已填的「模型服务商」Key（产品负责人 2026-11-05 裁定）。
    async fn engine_client(
        &self,
        settings: &geo_store::AppSettings,
        engine: EngineId,
    ) -> Result<LlmClient, FailureReason> {
        let provider = engine_provider(engine).ok_or(FailureReason::LoginRequired)?;
        let mut settings = settings.clone();
        let configured = LlmProvider::parse(&settings.model.provider) == Some(provider);
        settings.model.provider = provider.as_str().to_string();
        if !configured {
            settings.model.model = None;
            // 用户为别家填的 base_url 不能带到这家来。
            settings.model.base_url = None;
        }
        let config = LlmFactory::config_from_settings(&settings)
            .map_err(|_| FailureReason::LoginRequired)?;
        let api_key = self
            .secrets
            .get(&config.secret_ref)
            .await
            .map_err(|_| FailureReason::LoginRequired)?
            .filter(|key| !key.trim().is_empty())
            .ok_or(FailureReason::LoginRequired)?;
        Ok(self.llm.client(config, &api_key))
    }

    async fn execute_task(
        &self,
        round_id: &str,
        task: &mut CollectionTask,
        client: &LlmClient,
    ) -> Result<(), IpcError> {
        let started = Instant::now();
        let request = ChatRequest::new(vec![
            ChatMessage::system(COLLECTION_SYSTEM_PROMPT),
            ChatMessage::user(task.prompt_text.clone()),
        ]);
        let now = Utc::now();
        let attempt_index = self
            .collection()
            .count_records_for(round_id, &task.prompt_id, task.engine)
            .await?;
        let repeat_index = i32::try_from(attempt_index + 1).unwrap_or(i32::MAX);
        let (status, failure_reason, answer, model, prompt_tokens, completion_tokens) =
            match client.chat(&request).await {
                Ok(response) => (
                    CollectionStatus::Succeeded,
                    None,
                    response.content,
                    response.model,
                    i64::from(response.usage.prompt_tokens),
                    i64::from(response.usage.completion_tokens),
                ),
                Err(error) => (
                    CollectionStatus::Failed,
                    Some(failure_reason(&error)),
                    String::new(),
                    client.config().model.clone(),
                    0,
                    0,
                ),
            };
        let latency_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
        let record = CollectionRecord {
            id: uuid::Uuid::new_v4().to_string(),
            round_id: round_id.to_string(),
            prompt_id: task.prompt_id.clone(),
            prompt_text: task.prompt_text.clone(),
            intent: task.intent,
            engine: task.engine,
            model,
            channel: EngineChannel::OfficialApi,
            status,
            failure_reason,
            mentioned: false,
            rank: None,
            sentiment: None,
            citation_count: 0,
            collected_at: now,
            latency_ms,
            prompt_tokens,
            completion_tokens,
            repeat_index,
        };
        self.collection()
            .insert_record(&CollectionRecordDetail {
                record: record.clone(),
                answer_text: answer,
                citations: Vec::new(),
                screenshot_path: None,
            })
            .await?;
        task.status = status;
        task.failure_reason = failure_reason;
        task.record_id = Some(record.id);
        task.finished_at = Some(now);
        task.latency_ms = Some(latency_ms);
        self.collection().update_task(task).await?;
        Ok(())
    }

    async fn skip_task(&self, task: &mut CollectionTask) -> Result<(), IpcError> {
        let now = Utc::now();
        task.status = CollectionStatus::Skipped;
        task.failure_reason = None;
        task.finished_at = Some(now);
        task.latency_ms = Some(0);
        self.collection().update_task(task).await?;
        Ok(())
    }

    async fn fail_task(
        &self,
        task: &mut CollectionTask,
        reason: FailureReason,
    ) -> Result<(), IpcError> {
        let now = Utc::now();
        task.status = CollectionStatus::Failed;
        task.failure_reason = Some(reason);
        task.finished_at = Some(now);
        task.latency_ms = Some(0);
        self.collection().update_task(task).await?;
        Ok(())
    }

    /// 从任务与记录重算轮次 / 引擎汇总（每次写操作后都重算，界面进度不会停在旧数字）。
    async fn recompute_round(&self, round_id: &str) -> Result<(), IpcError> {
        let Some(mut round) = self.collection().round(round_id).await? else {
            return Ok(());
        };
        let tasks = self.collection().tasks(round_id).await?;
        let records = self.collection().records(round_id).await?;
        let planned = i32::try_from(tasks.len()).unwrap_or(i32::MAX);
        let succeeded = tasks
            .iter()
            .filter(|task| task.status == CollectionStatus::Succeeded)
            .count();
        let failed = tasks
            .iter()
            .filter(|task| task.status == CollectionStatus::Failed)
            .count()
            + tasks
                .iter()
                .filter(|task| task.status == CollectionStatus::Skipped)
                .count();
        let pending = tasks
            .iter()
            .filter(|task| {
                matches!(
                    task.status,
                    CollectionStatus::Queued | CollectionStatus::Running
                )
            })
            .count();
        // 样本量按**不同题目**算，不把重复采样当成独立样本。
        let distinct_prompts: HashSet<&str> = tasks
            .iter()
            .filter(|task| task.status == CollectionStatus::Succeeded)
            .map(|task| task.prompt_id.as_str())
            .collect();
        round.planned_queries = planned;
        round.completed_queries = i32::try_from(succeeded + failed).unwrap_or(i32::MAX);
        round.failed_queries = i32::try_from(failed).unwrap_or(i32::MAX);
        round.success_rate = if planned > 0 {
            succeeded as f64 / f64::from(planned)
        } else {
            0.0
        };
        round.sample_size_grade = sample_size_grade(distinct_prompts.len());
        round.status = if pending > 0 {
            RoundStatus::Running
        } else if succeeded == usize::try_from(planned).unwrap_or(0) {
            RoundStatus::Succeeded
        } else if succeeded > 0 {
            RoundStatus::Partial
        } else {
            RoundStatus::Failed
        };
        round.finished_at = if pending == 0 { Some(Utc::now()) } else { None };
        self.collection().update_round(&round).await?;

        for engine in &round.engine_scope {
            let engine_tasks: Vec<&CollectionTask> =
                tasks.iter().filter(|task| task.engine == *engine).collect();
            let engine_records: Vec<&CollectionRecord> = records
                .iter()
                .filter(|record| record.engine == *engine)
                .collect();
            let succeeded = engine_tasks
                .iter()
                .filter(|task| task.status == CollectionStatus::Succeeded)
                .count();
            let failed = engine_tasks
                .iter()
                .filter(|task| {
                    matches!(
                        task.status,
                        CollectionStatus::Failed | CollectionStatus::Skipped
                    )
                })
                .count();
            let prompt_tokens = engine_records
                .iter()
                .map(|record| record.prompt_tokens)
                .sum();
            let completion_tokens = engine_records
                .iter()
                .map(|record| record.completion_tokens)
                .sum();
            let avg_latency_ms = if engine_records.is_empty() {
                0
            } else {
                engine_records
                    .iter()
                    .map(|record| record.latency_ms)
                    .sum::<i64>()
                    / i64::try_from(engine_records.len()).unwrap_or(1)
            };
            let model = engine_records
                .first()
                .map(|record| record.model.clone())
                .unwrap_or_default();
            self.collection()
                .upsert_engine_run(
                    round_id,
                    &EngineRun {
                        engine: *engine,
                        channel: EngineChannel::OfficialApi,
                        model,
                        planned: i32::try_from(engine_tasks.len()).unwrap_or(i32::MAX),
                        succeeded: i32::try_from(succeeded).unwrap_or(i32::MAX),
                        failed: i32::try_from(failed).unwrap_or(i32::MAX),
                        avg_latency_ms,
                        prompt_tokens,
                        completion_tokens,
                    },
                )
                .await?;
        }
        Ok(())
    }

    pub async fn board(&self, project_id: ProjectId) -> Result<CollectionBoard, IpcError> {
        self.require_project(project_id).await?;
        let rounds = self.collection().rounds(&project_id.to_string()).await?;
        let mut rows = Vec::with_capacity(rounds.len());
        for round in &rounds {
            let runs = self.collection().engine_runs(&round.id).await?;
            let prompt_tokens: i64 = runs.iter().map(|run| run.prompt_tokens).sum();
            let completion_tokens: i64 = runs.iter().map(|run| run.completion_tokens).sum();
            rows.push(UsageRow {
                round_id: round.id.clone(),
                round_label: round.label.clone(),
                queries: i64::from(round.completed_queries + round.failed_queries),
                prompt_tokens,
                completion_tokens,
                total_tokens: prompt_tokens + completion_tokens,
            });
        }
        let total_queries = rows.iter().map(|row| row.queries).sum();
        let total_tokens = rows.iter().map(|row| row.total_tokens).sum();
        Ok(CollectionBoard {
            rounds,
            usage: UsageBoard {
                project_id: project_id.to_string(),
                rows,
                total_queries,
                total_tokens,
                quota_queries: None,
                quota_tokens: None,
                quota_exceeded: false,
            },
        })
    }

    pub async fn round_get(&self, round_id: String) -> Result<CollectionRoundDetail, IpcError> {
        let round = self.require_round(&round_id).await?;
        Ok(CollectionRoundDetail {
            engines: self.collection().engine_runs(&round_id).await?,
            tasks: self.collection().tasks(&round_id).await?,
            round,
        })
    }

    pub async fn record_list(
        &self,
        round_id: String,
        filter: RecordFilter,
    ) -> Result<Vec<geo_domain::CollectionRecord>, IpcError> {
        self.require_round(&round_id).await?;
        Ok(self
            .collection()
            .records(&round_id)
            .await?
            .into_iter()
            .filter(|record| record.matches(&filter))
            .collect())
    }

    pub async fn record_get(
        &self,
        record_id: String,
    ) -> Result<geo_domain::CollectionRecordDetail, IpcError> {
        match self.collection().record(&record_id).await? {
            Some(detail) => Ok(detail),
            None => Err(GeoError::validation("record_id", "invalid_id")
                .with_param("value", record_id)
                .into()),
        }
    }
}

/// 引擎 → 模型服务商（官方 API 兼容的那五家）。元宝 / 秘塔没有公开对话 API。
fn engine_provider(engine: EngineId) -> Option<LlmProvider> {
    match engine {
        EngineId::Doubao => Some(LlmProvider::VolcengineArk),
        EngineId::Deepseek => Some(LlmProvider::DeepSeek),
        EngineId::Kimi => Some(LlmProvider::Moonshot),
        EngineId::Qwen => Some(LlmProvider::AliBailian),
        EngineId::BaiduAi => Some(LlmProvider::BaiduQianfan),
        EngineId::Yuanbao | EngineId::Metaso => None,
    }
}

/// 上游错误 → 记录里的稳定失败原因（契约只有五个档，不新增枚举值）。
fn failure_reason(error: &LlmError) -> FailureReason {
    match error {
        LlmError::RateLimited => FailureReason::RateLimited,
        LlmError::Transport(geo_llm::TransportError::Timeout) => FailureReason::Timeout,
        LlmError::Transport(_) => FailureReason::Transport,
        LlmError::Server { status } if *status == 401 || *status == 403 => {
            FailureReason::LoginRequired
        }
        LlmError::Server { .. } => FailureReason::Transport,
        LlmError::MissingSecret => FailureReason::LoginRequired,
        LlmError::Config { .. } | LlmError::BadResponse { .. } | LlmError::Deserialize { .. } => {
            FailureReason::EmptyAnswer
        }
    }
}

fn status_str(status: CollectionStatus) -> &'static str {
    match status {
        CollectionStatus::Queued => "queued",
        CollectionStatus::Running => "running",
        CollectionStatus::Succeeded => "succeeded",
        CollectionStatus::Failed => "failed",
        CollectionStatus::Skipped => "skipped",
    }
}

//! M3 多引擎采集服务（读路径 + 官方 API 采集执行）。
//!
//! 六条命令：`collection_board` / `collection_round_get` / `collection_record_list` /
//! `collection_record_get` / `collection_start` / `collection_task_retry`。
//!
//! 🔴 只走官方搜索 / 官方 API（AGENTS 规则 11）：
//! - Kimi / 百度 / 豆包：官方搜索接口取结果，再用本家对话模型基于结果回答；
//! - 千问：Chat Completions `enable_search` 单次调用；
//! - DeepSeek：无官方搜索接口，借用 Kimi/百度搜索（通道记 `gateway`）；
//! - 秘塔：官方搜索接口 + 用户当前对话模型（通道记 `gateway`）；
//! - 元宝：本地 Chrome 浏览器自动化，用户自己扫码登录；不代登录、不绕验证码。
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
use geo_llm::{
    ChatMessage, ChatRequest, LlmClient, LlmError, LlmProvider, SearchClient, SearchEngine,
    SearchHit,
};
use geo_store::{
    CollectionRepo, ProjectRepo, PromptSetRepo, SecretStore, SettingsRepo, StoreError,
};
use serde::Deserialize;
use serde_json::json;
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

/// 没有搜索结果时的兜底：模型直接回答。
const COLLECTION_SYSTEM_PROMPT: &str =
    "你是一个中文 AI 搜索助手。请直接、完整地回答用户问题，必要时列出要点。";

/// 有搜索结果时：只允许基于给定结果回答，并用角标标注来源。
const GROUNDED_SYSTEM_PROMPT: &str = "你是中文 AI 搜索助手。请只依据用户给出的搜索结果作答；\
每条关键结论后用 [1]、[2] 这样的角标标注来源编号；搜索结果不足以回答时直接说明，不要编造。";

/// 单次采样送给模型的搜索结果条数上限。
const MAX_SEARCH_HITS: usize = 10;
/// 每条搜索结果的正文截断长度（字符），避免把整页塞爆上下文。
const MAX_HIT_TEXT_CHARS: usize = 1200;

/// 一个引擎本次执行需要的客户端。
struct EngineBundle {
    answer: LlmClient,
    search: Option<SearchClient>,
    /// Qwen 走 `enable_search` 单次调用；其余引擎先搜后答。
    direct_search: bool,
    channel: EngineChannel,
}

#[derive(Clone)]
pub struct CollectionService {
    pool: SqlitePool,
    llm: Arc<LlmFactory>,
    secrets: Arc<dyn SecretStore>,
    screenshots_dir: std::path::PathBuf,
    /// 元宝浏览器通道的 profile 基目录：一律取自 `AppState::browser_profile_dir`
    /// （app data dir 下），服务内部不再自己拼临时目录（P3-06b）。
    browser_profile_dir: std::path::PathBuf,
}

impl CollectionService {
    pub fn new(
        pool: SqlitePool,
        llm: Arc<LlmFactory>,
        secrets: Arc<dyn SecretStore>,
        browser_profile_dir: std::path::PathBuf,
    ) -> Self {
        Self {
            pool,
            llm,
            secrets,
            screenshots_dir: std::env::temp_dir().join("gdk-geo").join("screenshots"),
            browser_profile_dir,
        }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self {
            pool: state.pool.clone(),
            llm: state.llm.clone(),
            secrets: state.secrets.clone(),
            screenshots_dir: state.screenshots_dir.clone(),
            browser_profile_dir: state.browser_profile_dir.clone(),
        }
    }

    fn collection(&self) -> CollectionRepo {
        CollectionRepo::new(self.pool.clone())
    }

    fn projects(&self) -> ProjectRepo {
        ProjectRepo::new(self.pool.clone())
    }

    fn insights(&self) -> crate::services::InsightService {
        crate::services::InsightService::new(
            self.pool.clone(),
            self.llm.clone(),
            self.secrets.clone(),
        )
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
                        channel: engine_channel(*engine),
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
                        channel: engine_channel(*engine),
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
        let project_website = self.round_project_website(&round).await.ok().flatten();
        let tasks = self.collection().tasks(round_id).await?;
        for engine in round.engine_scope.clone() {
            if engine == EngineId::Yuanbao {
                self.execute_yuanbao_round(round_id, &tasks, project_website.as_deref())
                    .await?;
                continue;
            }
            let bundle = self.engine_bundle(&settings, engine).await;
            let interval = std::time::Duration::from_millis(settings.rate_limit.min_interval_ms);
            let mut first_task = true;
            for mut task in tasks.iter().filter(|task| task.engine == engine).cloned() {
                if !first_task && !interval.is_zero() {
                    tokio::time::sleep(interval).await;
                }
                first_task = false;
                if !matches!(
                    task.status,
                    CollectionStatus::Queued | CollectionStatus::Running
                ) {
                    continue;
                }
                match &bundle {
                    Ok(bundle) => {
                        self.execute_task(round_id, &mut task, bundle, project_website.as_deref())
                            .await?;
                    }
                    Err(reason) => {
                        self.fail_task(&mut task, *reason).await?;
                    }
                }
            }
        }
        self.recompute_round(round_id).await?;
        self.parse_round_quietly(round_id).await;
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
        let settings = SettingsRepo::new(self.pool.clone()).get().await?;
        let round = self.require_round(&task.round_id).await?;
        let project_website = self.round_project_website(&round).await.ok().flatten();
        task.attempt += 1;
        if task.engine == EngineId::Yuanbao {
            self.execute_yuanbao_task(&mut task, project_website.as_deref())
                .await?;
            self.recompute_round(&task.round_id).await?;
            self.parse_round_quietly(&task.round_id).await;
            return Ok(task);
        }
        match self.engine_bundle(&settings, task.engine).await {
            Ok(bundle) => {
                self.execute_task(
                    &task.round_id.clone(),
                    &mut task,
                    &bundle,
                    project_website.as_deref(),
                )
                .await?
            }
            Err(reason) => self.fail_task(&mut task, reason).await?,
        }
        self.recompute_round(&task.round_id).await?;
        self.parse_round_quietly(&task.round_id).await;
        Ok(task)
    }

    /// 解析失败不改变采集结果（轮次仍然成功），只写日志等下次续跑补。
    async fn parse_round_quietly(&self, round_id: &str) {
        if let Err(error) = self.insights().parse_round(round_id).await {
            tracing::warn!(
                round_id,
                code = error.code.as_str(),
                "answer parsing stopped with an error"
            );
        }
    }

    /// 一轮所属项目的官网（用于把“自有页引用”识别出来）。
    async fn round_project_website(
        &self,
        round: &CollectionRound,
    ) -> Result<Option<String>, IpcError> {
        let project_id = round
            .project_id
            .parse()
            .map_err(|_| GeoError::validation("project_id", "invalid_id"))?;
        let project = self.projects().get(project_id).await?;
        Ok(project.website)
    }

    /// 取某个 provider 的 Key。找不到就回 `LoginRequired`，不把 Key 带进错误。
    async fn secret_for_provider(&self, provider: LlmProvider) -> Result<String, FailureReason> {
        let reference = geo_store::secret_ref("llm", provider.as_str());
        self.secrets
            .get(&reference)
            .await
            .map_err(|_| FailureReason::LoginRequired)?
            .filter(|key| !key.trim().is_empty())
            .ok_or(FailureReason::LoginRequired)
    }

    async fn secret_for_name(&self, name: &str) -> Result<String, FailureReason> {
        let reference = geo_store::secret_ref("llm", name);
        self.secrets
            .get(&reference)
            .await
            .map_err(|_| FailureReason::LoginRequired)?
            .filter(|key| !key.trim().is_empty())
            .ok_or(FailureReason::LoginRequired)
    }

    /// 按引擎装配「搜索 + 回答」两只客户端。
    ///
    /// - Kimi / 豆包 / 百度：官方搜索接口 + 本家对话模型；
    /// - 千问：`enable_search` 单次调用（平台直接返回 search_info）；
    /// - DeepSeek：没有官方搜索接口，借用 Kimi/百度搜索作 L1 检索层（channel=Gateway）；
    /// - 秘塔：官方搜索接口 + 用户当前配置的对话模型（channel=Gateway）；
    /// - 元宝：浏览器自动化（`services::browser`，另行装配）。
    async fn engine_bundle(
        &self,
        settings: &geo_store::AppSettings,
        engine: EngineId,
    ) -> Result<EngineBundle, FailureReason> {
        if engine == EngineId::Yuanbao {
            // 元宝走浏览器自动化，由 `execute_yuanbao_*` 单独处理；这里只用于类型穷尽。
            return Err(FailureReason::LoginRequired);
        }
        if engine == EngineId::Metaso {
            let main_provider =
                LlmProvider::parse(&settings.model.provider).ok_or(FailureReason::LoginRequired)?;
            let answer = self.answer_client(settings, main_provider).await?;
            let key = self.secret_for_name("metaso").await?;
            return Ok(EngineBundle {
                answer,
                search: Some(SearchClient::new(
                    SearchEngine::Metaso,
                    key,
                    self.llm.transport(),
                )),
                direct_search: false,
                channel: EngineChannel::Gateway,
            });
        }
        let provider = engine_provider(engine).ok_or(FailureReason::LoginRequired)?;
        let answer = self.answer_client(settings, provider).await?;
        match engine {
            EngineId::Qwen => Ok(EngineBundle {
                answer,
                search: None,
                direct_search: true,
                channel: EngineChannel::OfficialApi,
            }),
            EngineId::Kimi => Ok(self
                .search_bundle(answer, SearchEngine::Kimi, provider)
                .await?),
            EngineId::Doubao => Ok(self
                .search_bundle(answer, SearchEngine::Doubao, provider)
                .await?),
            EngineId::BaiduAi => Ok(self
                .search_bundle(answer, SearchEngine::Baidu, provider)
                .await?),
            EngineId::Deepseek => {
                // DeepSeek 没有官方搜索接口：优先借 Kimi，其次百度；都没有就退回纯对话。
                for (candidate, search_engine) in [
                    (LlmProvider::Moonshot, SearchEngine::Kimi),
                    (LlmProvider::BaiduQianfan, SearchEngine::Baidu),
                ] {
                    if let Ok(key) = self.secret_for_provider(candidate).await {
                        return Ok(EngineBundle {
                            answer,
                            search: Some(SearchClient::new(
                                search_engine,
                                key,
                                self.llm.transport(),
                            )),
                            direct_search: false,
                            channel: EngineChannel::Gateway,
                        });
                    }
                }
                Ok(EngineBundle {
                    answer,
                    search: None,
                    direct_search: false,
                    channel: EngineChannel::OfficialApi,
                })
            }
            EngineId::Yuanbao | EngineId::Metaso => unreachable!("已在前面的分支处理"),
        }
    }

    async fn search_bundle(
        &self,
        answer: LlmClient,
        search_engine: SearchEngine,
        provider: LlmProvider,
    ) -> Result<EngineBundle, FailureReason> {
        let key = self.secret_for_provider(provider).await?;
        Ok(EngineBundle {
            answer,
            search: Some(SearchClient::new(search_engine, key, self.llm.transport())),
            direct_search: false,
            channel: EngineChannel::OfficialApi,
        })
    }

    /// 对话客户端：目标 provider 与用户当前配置一致时沿用其模型名；否则用该 provider 默认。
    async fn answer_client(
        &self,
        settings: &geo_store::AppSettings,
        provider: LlmProvider,
    ) -> Result<LlmClient, FailureReason> {
        let mut settings = settings.clone();
        let configured = LlmProvider::parse(&settings.model.provider) == Some(provider);
        settings.model.provider = provider.as_str().to_string();
        if !configured {
            settings.model.model = None;
            // 用户为别家填的 base_url 不能带到这家来。
            settings.model.base_url = None;
        }
        let mut config = LlmFactory::config_from_settings(&settings)
            .map_err(|_| FailureReason::LoginRequired)?;
        config.max_retries = u32::from(settings.rate_limit.retry_max);
        let api_key = self.secret_for_provider(provider).await?;
        Ok(self.llm.client(config, &api_key))
    }

    async fn execute_task(
        &self,
        round_id: &str,
        task: &mut CollectionTask,
        bundle: &EngineBundle,
        project_website: Option<&str>,
    ) -> Result<(), IpcError> {
        let started = Instant::now();
        let now = Utc::now();
        let attempt_index = self
            .collection()
            .count_records_for(round_id, &task.prompt_id, task.engine)
            .await?;
        let repeat_index = i32::try_from(attempt_index + 1).unwrap_or(i32::MAX);

        let mut citations = Vec::new();
        let mut answer = String::new();
        let mut model = bundle.answer.config().model.clone();
        let mut prompt_tokens = 0;
        let mut completion_tokens = 0;
        let mut status = CollectionStatus::Succeeded;
        let mut failure = None;

        if bundle.direct_search {
            let request = ChatRequest::new(vec![
                ChatMessage::system(COLLECTION_SYSTEM_PROMPT),
                ChatMessage::user(task.prompt_text.clone()),
            ])
            .with_extra("enable_search", json!(true))
            .with_extra(
                "search_options",
                json!({ "search_strategy": "max", "enable_source": true, "enable_citation": true }),
            );
            match bundle.answer.chat(&request).await {
                Ok(response) => {
                    answer = response.content;
                    model = response.model;
                    prompt_tokens = i64::from(response.usage.prompt_tokens);
                    completion_tokens = i64::from(response.usage.completion_tokens);
                    citations = response
                        .citations
                        .iter()
                        .map(|hit| citation_from_hit(hit, project_website))
                        .collect();
                }
                Err(error) => {
                    status = CollectionStatus::Failed;
                    failure = Some(failure_reason(&error));
                }
            }
        } else {
            let hits = match &bundle.search {
                Some(search) => match search.search(&task.prompt_text, MAX_SEARCH_HITS).await {
                    Ok(hits) => hits,
                    Err(error) => {
                        status = CollectionStatus::Failed;
                        failure = Some(failure_reason(&error));
                        Vec::new()
                    }
                },
                None => Vec::new(),
            };
            if status == CollectionStatus::Succeeded {
                let request = grounded_request(&task.prompt_text, &hits);
                match bundle.answer.chat(&request).await {
                    Ok(response) => {
                        answer = response.content;
                        model = response.model;
                        prompt_tokens = i64::from(response.usage.prompt_tokens);
                        completion_tokens = i64::from(response.usage.completion_tokens);
                        citations = hits
                            .iter()
                            .map(|hit| citation_from_hit(hit, project_website))
                            .collect();
                    }
                    Err(error) => {
                        status = CollectionStatus::Failed;
                        failure = Some(failure_reason(&error));
                    }
                }
            }
        }

        let latency_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
        let record = CollectionRecord {
            id: uuid::Uuid::new_v4().to_string(),
            round_id: round_id.to_string(),
            prompt_id: task.prompt_id.clone(),
            prompt_text: task.prompt_text.clone(),
            intent: task.intent,
            engine: task.engine,
            model,
            channel: bundle.channel,
            status,
            failure_reason: failure,
            mentioned: false,
            rank: None,
            sentiment: None,
            citation_count: i32::try_from(citations.len()).unwrap_or(i32::MAX),
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
                citations,
                screenshot_path: None,
            })
            .await?;
        task.status = status;
        task.failure_reason = failure;
        task.record_id = Some(record.id);
        task.finished_at = Some(now);
        task.latency_ms = Some(latency_ms);
        self.collection().update_task(task).await?;
        Ok(())
    }

    async fn execute_yuanbao_round(
        &self,
        round_id: &str,
        tasks: &[CollectionTask],
        project_website: Option<&str>,
    ) -> Result<(), IpcError> {
        crate::build_flavor::reject_in_store_build("yuanbao")?;
        for mut task in tasks
            .iter()
            .filter(|task| task.engine == EngineId::Yuanbao)
            .cloned()
        {
            if !matches!(
                task.status,
                CollectionStatus::Queued | CollectionStatus::Running
            ) {
                continue;
            }
            self.execute_yuanbao_task(&mut task, project_website)
                .await?;
        }
        let _ = round_id;
        Ok(())
    }

    async fn execute_yuanbao_task(
        &self,
        task: &mut CollectionTask,
        project_website: Option<&str>,
    ) -> Result<(), IpcError> {
        crate::build_flavor::reject_in_store_build("yuanbao")?;
        let started = Instant::now();
        let now = Utc::now();
        let attempt_index = self
            .collection()
            .count_records_for(&task.round_id, &task.prompt_id, task.engine)
            .await?;
        let repeat_index = i32::try_from(attempt_index + 1).unwrap_or(i32::MAX);
        let outcome = crate::services::browser::ask_yuanbao(
            &task.prompt_text,
            &self.screenshots_dir,
            &self.browser_profile_dir,
        )
        .await;
        let latency_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
        let (status, failure, answer, model, screenshot_path, citations) = match outcome {
            Ok(answer) => (
                CollectionStatus::Succeeded,
                None,
                answer.answer,
                answer.model,
                answer.screenshot_path,
                answer.citations,
            ),
            Err(error) => (
                CollectionStatus::Failed,
                Some(browser_failure(&error)),
                String::new(),
                "yuanbao-web".to_string(),
                None,
                Vec::new(),
            ),
        };
        let citations: Vec<geo_domain::Citation> = citations
            .iter()
            .map(|hit| citation_from_hit(hit, project_website))
            .collect();
        let record = CollectionRecord {
            id: uuid::Uuid::new_v4().to_string(),
            round_id: task.round_id.clone(),
            prompt_id: task.prompt_id.clone(),
            prompt_text: task.prompt_text.clone(),
            intent: task.intent,
            engine: task.engine,
            model,
            channel: EngineChannel::BrowserAutomation,
            status,
            failure_reason: failure,
            mentioned: false,
            rank: None,
            sentiment: None,
            citation_count: i32::try_from(citations.len()).unwrap_or(i32::MAX),
            collected_at: now,
            latency_ms,
            prompt_tokens: 0,
            completion_tokens: 0,
            repeat_index,
        };
        self.collection()
            .insert_record(&CollectionRecordDetail {
                record: record.clone(),
                answer_text: answer,
                citations,
                screenshot_path,
            })
            .await?;
        task.status = status;
        task.failure_reason = failure;
        task.record_id = Some(record.id);
        task.finished_at = Some(now);
        task.latency_ms = Some(latency_ms);
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
                        channel: engine_records
                            .first()
                            .map(|record| record.channel)
                            .unwrap_or_else(|| engine_channel(*engine)),
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

/// 有搜索结果时的提问模板：把标题/URL/摘要作为唯一事实来源。
fn grounded_request(prompt: &str, hits: &[SearchHit]) -> ChatRequest {
    let mut sources = String::new();
    for (index, hit) in hits.iter().take(MAX_SEARCH_HITS).enumerate() {
        let text = hit.content.as_deref().unwrap_or(&hit.snippet);
        let text: String = text.chars().take(MAX_HIT_TEXT_CHARS).collect();
        sources.push_str(&format!(
            "[{}] {}\n{}\n{}\n\n",
            index + 1,
            hit.title,
            hit.url,
            text
        ));
    }
    let user = if sources.is_empty() {
        prompt.to_string()
    } else {
        format!(
            "用户问题：{prompt}\n\n搜索结果：\n{sources}\n请只基于以上搜索结果回答；关键结论后用 [1]、[2] 标注来源编号。"
        )
    };
    let system = if sources.is_empty() {
        COLLECTION_SYSTEM_PROMPT
    } else {
        GROUNDED_SYSTEM_PROMPT
    };
    ChatRequest::new(vec![ChatMessage::system(system), ChatMessage::user(user)])
}

fn citation_from_hit(hit: &SearchHit, project_website: Option<&str>) -> geo_domain::Citation {
    let domain = url::Url::parse(&hit.url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_string();
    let source_type = classify_source(&domain, project_website);
    geo_domain::Citation {
        url: hit.url.clone(),
        domain,
        title: Some(hit.title.clone()),
        source_type,
    }
}

fn classify_source(domain: &str, project_website: Option<&str>) -> geo_domain::SourceType {
    use geo_domain::SourceType;
    let project_host = project_website
        .and_then(|raw| url::Url::parse(raw).ok())
        .and_then(|url| url.host_str().map(str::to_string))
        .unwrap_or_default()
        .trim_start_matches("www.")
        .to_string();
    if !project_host.is_empty() && domain == project_host {
        return SourceType::OwnedPage;
    }
    let lower = domain.to_ascii_lowercase();
    if lower.contains("baike") {
        SourceType::Baike
    } else if lower.contains("zhihu") {
        SourceType::Zhihu
    } else if lower.contains("xiaohongshu") || lower.contains("xhslink") {
        SourceType::Xiaohongshu
    } else if ["taobao", "tmall", "jd.com", "1688", "pinduoduo", "amazon"]
        .iter()
        .any(|needle| lower.contains(needle))
    {
        SourceType::Ecommerce
    } else if lower.ends_with(".gov.cn")
        || lower.ends_with(".edu.cn")
        || lower.contains("gov")
        || lower.contains("edu")
        || lower.contains("standard")
        || lower.contains("iso.org")
    {
        SourceType::OfficialDoc
    } else if [
        "news", "sina", "sohu", "163.com", "qq.com", "people", "xinhua", "36kr", "ifeng",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        SourceType::NewsMedia
    } else if ["tieba", "forum", "bbs", "discuz"]
        .iter()
        .any(|needle| lower.contains(needle))
    {
        SourceType::Forum
    } else {
        SourceType::Other
    }
}

/// 引擎的默认采集通道：元宝浏览器、DeepSeek/秘塔网关、其余官方 API。
fn engine_channel(engine: EngineId) -> EngineChannel {
    match engine {
        EngineId::Yuanbao => EngineChannel::BrowserAutomation,
        EngineId::Deepseek | EngineId::Metaso => EngineChannel::Gateway,
        EngineId::Doubao | EngineId::Kimi | EngineId::Qwen | EngineId::BaiduAi => {
            EngineChannel::OfficialApi
        }
    }
}

fn browser_failure(error: &crate::services::browser::BrowserError) -> FailureReason {
    use crate::services::browser::BrowserError;
    match error {
        BrowserError::LoginRequired => FailureReason::LoginRequired,
        BrowserError::Timeout => FailureReason::Timeout,
        BrowserError::Blocked => FailureReason::Blocked,
        BrowserError::EmptyAnswer => FailureReason::EmptyAnswer,
        BrowserError::Unavailable | BrowserError::Other => FailureReason::Transport,
    }
}

/// 引擎 → 对话模型服务商。元宝走浏览器、秘塔用当前主模型，均不走这里。
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    /// P3-06b：元宝通道的 profile 必须挂在 `AppState::browser_profile_dir`（app data dir）
    /// 之下，不能是服务内部随手拼的临时目录。
    #[tokio::test]
    async fn from_state_wires_the_app_data_browser_profile_dir() {
        let state = AppState::for_test(
            geo_store::open_in_memory().await.expect("内存库可用"),
            Arc::new(geo_store::MemorySecretStore::default()),
            Arc::new(LlmFactory::fixture_map(BTreeMap::new())),
            Arc::new(
                geo_crawler::SiteFetcher::new(
                    geo_crawler::FetchLimits::default(),
                    crate::state::USER_AGENT,
                    None,
                )
                .expect("抓取器可构造"),
            ),
        );

        let service = CollectionService::from_state(&state);
        assert_eq!(service.browser_profile_dir, state.browser_profile_dir);

        let profile = crate::services::browser::profile_dir(&service.browser_profile_dir);
        assert!(
            profile.starts_with(&state.browser_profile_dir),
            "元宝 profile 必须在 app data dir 之下：{profile:?}"
        );
        assert_eq!(
            profile.file_name().and_then(|value| value.to_str()),
            Some("yuanbao"),
            "子目录名沿用 `yuanbao`：{profile:?}"
        );
    }
}

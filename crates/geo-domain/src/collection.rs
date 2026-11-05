//! M3 多引擎采集的读模型（Plan C M3–M7 读路径第一段）。
//!
//! 设计规格：`docs/superpowers/specs/2026-09-28-demo-m3-m7-closed-loop-design.md`。
//!
//! 🔴 本模块只定义 DTO / 枚举 / 过滤条件，不做采集、不调模型、不算成功率。
//! 采集写路径（`collection_start` / `collection_task_retry`）仍留在 demo-only；
//! 本切片只让桌面端的采集页从 `ipc/unknown_command` 变成能渲染空态与已有数据。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::prompt::{IntentCategory, SampleSizeGrade};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineId {
    Doubao,
    Deepseek,
    Kimi,
    Qwen,
    Yuanbao,
    BaiduAi,
    Metaso,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineChannel {
    OfficialApi,
    BrowserAutomation,
    Gateway,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CollectionStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoundStatus {
    Queued,
    Running,
    Succeeded,
    Partial,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureReason {
    RateLimited,
    Timeout,
    Blocked,
    LoginRequired,
    EmptyAnswer,
    Transport,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceType {
    OwnedPage,
    Baike,
    NewsMedia,
    Zhihu,
    Xiaohongshu,
    Ecommerce,
    OfficialDoc,
    Forum,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Sentiment {
    Positive,
    Neutral,
    Negative,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollectionRound {
    pub id: String,
    pub project_id: String,
    pub prompt_set_id: String,
    pub prompt_set_label: String,
    pub prompt_set_version: i32,
    pub label: String,
    pub round_index: i32,
    pub status: RoundStatus,
    pub engine_scope: Vec<EngineId>,
    pub repeat_count: i32,
    pub planned_queries: i32,
    pub completed_queries: i32,
    pub failed_queries: i32,
    pub success_rate: f64,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub metric_spec_version: String,
    pub sample_size_grade: SampleSizeGrade,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineRun {
    pub engine: EngineId,
    pub channel: EngineChannel,
    pub model: String,
    pub planned: i32,
    pub succeeded: i32,
    pub failed: i32,
    pub avg_latency_ms: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollectionTask {
    pub id: String,
    pub round_id: String,
    pub prompt_id: String,
    pub prompt_text: String,
    pub intent: IntentCategory,
    pub engine: EngineId,
    pub channel: EngineChannel,
    pub status: CollectionStatus,
    pub attempt: i32,
    pub failure_reason: Option<FailureReason>,
    pub record_id: Option<String>,
    pub queued_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub latency_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Citation {
    pub url: String,
    pub domain: String,
    pub title: Option<String>,
    pub source_type: SourceType,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollectionRecord {
    pub id: String,
    pub round_id: String,
    pub prompt_id: String,
    pub prompt_text: String,
    pub intent: IntentCategory,
    pub engine: EngineId,
    pub model: String,
    pub channel: EngineChannel,
    pub status: CollectionStatus,
    pub failure_reason: Option<FailureReason>,
    pub mentioned: bool,
    pub rank: Option<i32>,
    pub sentiment: Option<Sentiment>,
    pub citation_count: i32,
    pub collected_at: DateTime<Utc>,
    pub latency_ms: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub repeat_index: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollectionRecordDetail {
    #[serde(flatten)]
    pub record: CollectionRecord,
    pub answer_text: String,
    pub citations: Vec<Citation>,
    pub screenshot_path: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RecordFilter {
    #[serde(default)]
    pub engine: Option<EngineId>,
    #[serde(default)]
    pub intent: Option<IntentCategory>,
    #[serde(default)]
    pub mentioned: Option<bool>,
    #[serde(default)]
    pub status: Option<CollectionStatus>,
}

impl CollectionRecord {
    pub fn matches(&self, filter: &RecordFilter) -> bool {
        filter.engine.is_none_or(|engine| self.engine == engine)
            && filter.intent.is_none_or(|intent| self.intent == intent)
            && filter
                .mentioned
                .is_none_or(|mentioned| self.mentioned == mentioned)
            && filter.status.is_none_or(|status| self.status == status)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UsageRow {
    pub round_id: String,
    pub round_label: String,
    pub queries: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UsageBoard {
    pub project_id: String,
    pub rows: Vec<UsageRow>,
    pub total_queries: i64,
    pub total_tokens: i64,
    pub quota_queries: Option<i64>,
    pub quota_tokens: Option<i64>,
    pub quota_exceeded: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollectionBoard {
    pub rounds: Vec<CollectionRound>,
    pub usage: UsageBoard,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CollectionRoundDetail {
    pub round: CollectionRound,
    pub engines: Vec<EngineRun>,
    pub tasks: Vec<CollectionTask>,
}

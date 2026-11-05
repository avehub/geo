//! M5 可见度诊断与竞品对标的读模型（Plan C M3–M7 读路径）。
//!
//! 🔴 所有分数都是分析快照的**原样读出**；五维加权、覆盖率、SOV 等
//! 计算属于后续写路径的领域纯函数，本模块不做任何算术。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::collection::{EngineId, RoundStatus};
use crate::prompt::SampleSizeGrade;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosisDimension {
    Visibility,
    Recommendation,
    Sentiment,
    FactAccuracy,
    SourceHealth,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FunnelStage {
    Awareness,
    Recommendation,
    Decision,
}

impl FunnelStage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Awareness => "awareness",
            Self::Recommendation => "recommendation",
            Self::Decision => "decision",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertKind {
    CoverageDrop,
    NegativeSentiment,
    FactError,
    CompetitorOvertake,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertSeverity {
    Info,
    Warning,
    Critical,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DimensionScore {
    pub dimension: DiagnosisDimension,
    pub score: f64,
    pub weight: f64,
    pub sample_size: i64,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrendPoint {
    pub round_id: String,
    pub round_label: String,
    pub collected_at: DateTime<Utc>,
    pub status: RoundStatus,
    pub brand_coverage: f64,
    pub coverage_margin: f64,
    pub total_score: f64,
    pub fact_accuracy: f64,
    pub sample_size: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AlertItem {
    pub id: String,
    pub project_id: String,
    pub round_id: String,
    pub kind: AlertKind,
    pub severity: AlertSeverity,
    pub engine: Option<EngineId>,
    pub metric: String,
    pub delta: Option<f64>,
    pub detail: String,
    pub acknowledged: bool,
    pub raised_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiagnosisOverview {
    pub project_id: String,
    pub round_id: String,
    pub round_label: String,
    pub collected_at: DateTime<Utc>,
    pub total_score: f64,
    pub score_margin: f64,
    pub sample_size: i64,
    pub sample_size_grade: SampleSizeGrade,
    pub dimensions: Vec<DimensionScore>,
    pub brand_coverage: f64,
    pub brand_coverage_margin: f64,
    pub share_of_voice: f64,
    pub fact_accuracy: f64,
    pub distinct_cited_domains: i64,
    pub trend: Vec<TrendPoint>,
    pub alerts: Vec<AlertItem>,
    pub metric_spec_version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompetitorMatrixRow {
    pub brand: String,
    pub is_self: bool,
    pub coverage: f64,
    pub share_of_voice: f64,
    pub top1_rate: f64,
    pub top3_rate: f64,
    pub mention_only_rate: f64,
    pub positive_rate: f64,
    pub negative_rate: f64,
    pub fact_error_count: i64,
    pub cited_domain_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompetitorMatrix {
    pub round_id: String,
    pub sample_size: i64,
    pub head_to_head_prompt_count: i64,
    pub rows: Vec<CompetitorMatrixRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FunnelRow {
    pub stage: FunnelStage,
    pub prompt_count: i64,
    pub mention_rate: f64,
    pub top3_rate: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IntentFunnel {
    pub round_id: String,
    pub rows: Vec<FunnelRow>,
    pub diagnosis_note: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineScore {
    pub engine: EngineId,
    pub sample_size: i64,
    pub coverage: f64,
    pub top3_rate: f64,
    pub positive_rate: f64,
    pub fact_error_rate: f64,
    pub success_rate: f64,
    pub avg_latency_ms: i64,
}

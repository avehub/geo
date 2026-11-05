//! M6 行动中心的读模型（Plan C M3–M7 读路径）。
//!
//! 🔴 处方生成、归因与文稿生成都不在本模块；本切片只把已有快照原样读出。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::collection::EngineId;
use crate::compliance::ContentStatus;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionCategory {
    SiteStructure,
    SourceLayout,
    FactCorrection,
    ContentProduction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionStatus {
    Todo,
    InProgress,
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionLevel {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttributionMetricKey {
    BrandCoverage,
    Top3Rate,
    FactErrorCount,
    NegativeRate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentTemplateKind {
    QaArticle,
    ComparisonTable,
    SpecCard,
    CaseCard,
    FaqPage,
    GlossaryPage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Markdown,
    Html,
    Csv,
    Docx,
    Pdf,
    Png,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionItem {
    pub id: String,
    pub project_id: String,
    pub round_id: String,
    pub category: ActionCategory,
    pub rank: i32,
    pub title: String,
    pub rationale: String,
    pub impact: ActionLevel,
    pub difficulty: ActionLevel,
    pub owner_hint: String,
    pub deliverable: String,
    pub affected_prompt_count: i32,
    pub affected_engines: Vec<EngineId>,
    pub evidence_issue_ids: Vec<String>,
    pub quick_win: bool,
    pub status: ActionStatus,
    pub completed_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttributionMetric {
    pub metric: AttributionMetricKey,
    pub before: f64,
    pub after: f64,
    pub unit: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttributionCard {
    pub id: String,
    pub project_id: String,
    pub baseline_round_id: String,
    pub baseline_label: String,
    pub retest_round_id: String,
    pub retest_label: String,
    pub action_ids: Vec<String>,
    pub summary: String,
    pub metrics: Vec<AttributionMetric>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContentTemplate {
    pub id: String,
    pub kind: ContentTemplateKind,
    pub section_keys: Vec<String>,
    pub export_formats: Vec<ExportFormat>,
    pub target_categories: Vec<ActionCategory>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GeneratedContent {
    pub id: String,
    pub project_id: String,
    pub action_id: Option<String>,
    pub template_id: String,
    pub title: String,
    pub body_markdown: String,
    pub status: ContentStatus,
    pub compliance_checked: bool,
    pub export_formats: Vec<ExportFormat>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionBoard {
    pub actions: Vec<ActionItem>,
    pub attribution: Vec<AttributionCard>,
    pub contents: Vec<GeneratedContent>,
    pub templates: Vec<ContentTemplate>,
}

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

impl ContentTemplateKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::QaArticle => "qa_article",
            Self::ComparisonTable => "comparison_table",
            Self::SpecCard => "spec_card",
            Self::CaseCard => "case_card",
            Self::FaqPage => "faq_page",
            Self::GlossaryPage => "glossary_page",
        }
    }
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

/// 行动中心的内容模板目录（真实后端的内置清单，不随项目变化）。
///
/// 🔴 与 demo 种子逐条同构：id 是稳定记号，`section_keys` 只用于生成提示词与前端预览，
/// `target_categories` 决定「哪类处方能选到它」。模板不是用户数据，因此不落库。
pub fn content_templates() -> Vec<ContentTemplate> {
    vec![
        ContentTemplate {
            id: "tpl-glossary-page".to_string(),
            kind: ContentTemplateKind::GlossaryPage,
            section_keys: strings(&[
                "term_definition",
                "working_principle",
                "selection_guide",
                "related_terms",
                "references",
            ]),
            export_formats: formats(&[
                ExportFormat::Markdown,
                ExportFormat::Html,
                ExportFormat::Docx,
            ]),
            target_categories: vec![
                ActionCategory::ContentProduction,
                ActionCategory::SiteStructure,
            ],
        },
        ContentTemplate {
            id: "tpl-qa-article".to_string(),
            kind: ContentTemplateKind::QaArticle,
            section_keys: strings(&["question", "short_answer", "detail", "faq", "sources"]),
            export_formats: formats(&[
                ExportFormat::Markdown,
                ExportFormat::Html,
                ExportFormat::Docx,
            ]),
            target_categories: vec![
                ActionCategory::ContentProduction,
                ActionCategory::SiteStructure,
            ],
        },
        ContentTemplate {
            id: "tpl-comparison-table".to_string(),
            kind: ContentTemplateKind::ComparisonTable,
            section_keys: strings(&["scope", "criteria", "table", "how_to_read", "sources"]),
            export_formats: formats(&[
                ExportFormat::Markdown,
                ExportFormat::Html,
                ExportFormat::Csv,
            ]),
            target_categories: vec![
                ActionCategory::ContentProduction,
                ActionCategory::SourceLayout,
            ],
        },
        ContentTemplate {
            id: "tpl-spec-card".to_string(),
            kind: ContentTemplateKind::SpecCard,
            section_keys: strings(&[
                "model",
                "parameters",
                "applications",
                "certification",
                "delivery",
            ]),
            export_formats: formats(&[
                ExportFormat::Markdown,
                ExportFormat::Html,
                ExportFormat::Csv,
            ]),
            target_categories: vec![
                ActionCategory::SiteStructure,
                ActionCategory::ContentProduction,
            ],
        },
        ContentTemplate {
            id: "tpl-case-card".to_string(),
            kind: ContentTemplateKind::CaseCard,
            section_keys: strings(&[
                "client_context",
                "challenge",
                "solution",
                "results",
                "verification",
            ]),
            export_formats: formats(&[
                ExportFormat::Markdown,
                ExportFormat::Html,
                ExportFormat::Docx,
            ]),
            target_categories: vec![
                ActionCategory::ContentProduction,
                ActionCategory::SourceLayout,
            ],
        },
        ContentTemplate {
            id: "tpl-fact-correction".to_string(),
            kind: ContentTemplateKind::QaArticle,
            section_keys: strings(&["question", "short_answer", "detail", "sources"]),
            export_formats: formats(&[
                ExportFormat::Markdown,
                ExportFormat::Html,
                ExportFormat::Docx,
            ]),
            target_categories: vec![ActionCategory::FactCorrection],
        },
        ContentTemplate {
            id: "tpl-faq-page".to_string(),
            kind: ContentTemplateKind::FaqPage,
            section_keys: strings(&["faq_price", "faq_delivery", "faq_service", "schema_note"]),
            export_formats: formats(&[ExportFormat::Markdown, ExportFormat::Html]),
            target_categories: vec![
                ActionCategory::SiteStructure,
                ActionCategory::ContentProduction,
            ],
        },
    ]
}

/// 按 id 取模板；认不出返回 `None`（调用方发 `validation/failed {field:'template_id'}`）。
pub fn content_template(id: &str) -> Option<ContentTemplate> {
    content_templates()
        .into_iter()
        .find(|template| template.id == id)
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

fn formats(values: &[ExportFormat]) -> Vec<ExportFormat> {
    values.to_vec()
}

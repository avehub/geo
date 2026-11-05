//! M7 报告的结构化文档（Plan C M3–M7 读路径）。
//!
//! 报告只发**稳定记号 + 数据**；标题 / 表头 / 免责声明由前端词典渲染。
//! 本模块不生成叙述、不排版、不调模型。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::collection::EngineId;
use crate::prompt::SampleSizeGrade;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportVariant {
    Executive,
    Detailed,
    WhiteLabel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportMetricUnit {
    Percent,
    Score,
    Count,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReportBlock {
    Paragraph {
        text: String,
    },
    Metric {
        metric: String,
        value: f64,
        unit: ReportMetricUnit,
        delta: Option<f64>,
    },
    Table {
        column_keys: Vec<String>,
        rows: Vec<Vec<String>>,
    },
    List {
        items: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReportSection {
    pub id: String,
    pub blocks: Vec<ReportBlock>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReportMethodology {
    pub round_label: String,
    pub sample_size: i64,
    pub sample_size_grade: SampleSizeGrade,
    pub collected_at: DateTime<Utc>,
    pub engines: Vec<EngineId>,
    pub model_versions: Vec<String>,
    pub prompt_set_label: String,
    pub prompt_set_version: i32,
    pub metric_spec_version: String,
    pub repeat_count: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WhiteLabelProfile {
    pub agency_name: String,
    pub contact: String,
    pub logo_url: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ReportRenderOptions {
    #[serde(default)]
    pub variant: Option<ReportVariant>,
    #[serde(default)]
    pub white_label: Option<WhiteLabelProfile>,
    #[serde(default)]
    pub include_evidence: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReportDocument {
    pub project_id: String,
    pub round_id: String,
    pub variant: ReportVariant,
    pub brand_name: String,
    pub round_label: String,
    pub generated_at: DateTime<Utc>,
    pub headline: Vec<ReportBlock>,
    pub next_steps: Vec<String>,
    pub sections: Vec<ReportSection>,
    pub methodology: ReportMethodology,
    pub white_label: Option<WhiteLabelProfile>,
}

impl ReportVariant {
    pub fn section_ids(&self) -> &'static [&'static str] {
        match self {
            Self::Executive => &["conclusion"],
            Self::Detailed => &[
                "conclusion",
                "coverage",
                "competitors",
                "engines",
                "funnel",
                "fact_check",
                "actions",
            ],
            Self::WhiteLabel => &["conclusion", "coverage", "competitors", "actions"],
        }
    }
}

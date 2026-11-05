//! 站长数据指标 / AI 汇总 / 平台独有留档的 DTO（M5.5）。
//!
//! 🔴 汇总（A 类求和、B 类重算、区间收敛）仍在前端 compose 层；本模块只定义落库形状。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::ids::{ProjectId, SearchAiOverviewId, SearchMetricId, SearchNativeExtraId};
use crate::search::SearchSourceKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchSurface {
    WebSearch,
    AiAnswer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchCompleteness {
    Full,
    Partial,
    Sampled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowSource {
    Platform,
    UserStated,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchQueryMetric {
    pub id: SearchMetricId,
    pub project_id: ProjectId,
    pub source_kind: SearchSourceKind,
    pub surface: SearchSurface,
    pub query: String,
    pub page_url: Option<String>,
    pub impressions: Option<i64>,
    pub clicks: Option<i64>,
    pub ctr: Option<f64>,
    pub citations: Option<i64>,
    pub ai_clicks: Option<i64>,
    pub period_start: String,
    pub period_end: String,
    pub data_through: String,
    pub imported_at: DateTime<Utc>,
    pub completeness: SearchCompleteness,
    pub window_source: WindowSource,
    pub mapping_version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchAiOverview {
    pub id: SearchAiOverviewId,
    pub project_id: ProjectId,
    pub source_kind: SearchSourceKind,
    pub citations: Option<i64>,
    pub ai_impressions: Option<i64>,
    pub ai_clicks: Option<i64>,
    pub ai_ctr: Option<f64>,
    pub cited_pages: Option<i64>,
    pub period_start: String,
    pub period_end: String,
    pub data_through: String,
    pub imported_at: DateTime<Utc>,
    pub completeness: SearchCompleteness,
    pub window_source: WindowSource,
    pub mapping_version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchNativeExtra {
    pub id: SearchNativeExtraId,
    pub project_id: ProjectId,
    pub source_kind: SearchSourceKind,
    pub label: String,
    pub value: Option<serde_json::Value>,
    pub metric_id: Option<String>,
    pub observed_at: DateTime<Utc>,
}

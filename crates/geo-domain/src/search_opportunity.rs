//! 站长数据优化机会模型（M5.5）。
//!
//! 🔴 机会**不是本模块算出来的**：DR-100 的六条规则在后续切片落 `geo-domain` 纯函数。
//! 本切片只提供 DTO 与状态翻转；没有创建命令，导入长机会也尚未落地。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::ids::{ProjectId, SearchOpportunityId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchOpportunityStatus {
    New,
    Adopted,
    Ignored,
}

/// 处方类别（与 `ActionCategory` 同值；行动族落 Rust 后再收口到同一类型）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchPrescriptionCategory {
    SiteStructure,
    SourceLayout,
    FactCorrection,
    ContentProduction,
}

/// 影响 / 难度三档（与 `ActionLevel` 同值）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchActionLevel {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SearchOpportunity {
    pub id: SearchOpportunityId,
    pub project_id: ProjectId,
    /// DR-100 的规则序号 1..=6。
    pub rule_id: u8,
    /// 词典键（`webmasterData.rules.<key>.name`），不是自然语言。
    pub title_key: String,
    /// 依据（数据级中文：把判据用到的数字摊开）。
    pub basis: String,
    pub evidence_metric_ids: Vec<String>,
    pub prescription_category: SearchPrescriptionCategory,
    pub impact: SearchActionLevel,
    pub difficulty: SearchActionLevel,
    pub confidence: f64,
    pub status: SearchOpportunityStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

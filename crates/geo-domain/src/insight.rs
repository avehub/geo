//! M4 回答解析与事实核查的读模型（Plan C M3–M7 读路径第二段）。
//!
//! 抽取与核查在真后端是 LLM + 规则双通道的产物；本模块只定义 DTO 与筛选，
//! 不跑模型、不重算置信度 / 准确率。

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};

use crate::collection::{EngineId, Sentiment, SourceType};

/// 解析置信度低于此值时进入人工复核队列（与前端 `api/constants.ts` 同值）。
pub const REVIEW_CONFIDENCE_FLOOR: f64 = 0.75;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrandRole {
    #[serde(rename = "self")]
    Self_,
    Competitor,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactIssueKind {
    Wrong,
    Outdated,
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactIssueStatus {
    Open,
    FalsePositive,
    Corrected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskFlag {
    RegulatedClaim,
    AbsoluteWording,
    SuspectedHallucination,
    NegativeBuzz,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CorrectionChannel {
    OfficialSite,
    BaikeEntry,
    ThirdPartyPage,
    ServiceScript,
    BusinessDirectory,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AnswerShape {
    pub has_conclusion: bool,
    pub has_table: bool,
    pub asks_back: bool,
    pub refused: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrandMention {
    pub brand: String,
    pub role: BrandRole,
    pub count: i32,
    pub sentiment: Sentiment,
    pub rank: Option<i32>,
    pub in_comparison_table: bool,
    pub excerpt: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnswerInsight {
    pub id: String,
    pub round_id: String,
    pub record_id: String,
    pub prompt_id: String,
    pub prompt_text: String,
    pub engine: EngineId,
    pub mentions: Vec<BrandMention>,
    pub self_mentioned: bool,
    pub self_rank: Option<i32>,
    pub self_sentiment: Option<Sentiment>,
    pub answer_shape: AnswerShape,
    pub source_types: BTreeMap<String, i64>,
    pub confidence: f64,
    pub needs_review: bool,
    pub risks: Vec<RiskFlag>,
    pub corrected_fields: Vec<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
}

fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// 人工纠正入参：只允许改提及与否 / 推荐位次 / 情感。
/// `self_rank` / `self_sentiment` 用双层 `Option` 区分「没传」与「显式传 null」。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct InsightCorrection {
    #[serde(default)]
    pub self_mentioned: Option<bool>,
    #[serde(default, deserialize_with = "double_option")]
    pub self_rank: Option<Option<i32>>,
    #[serde(default, deserialize_with = "double_option")]
    pub self_sentiment: Option<Option<Sentiment>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct InsightFilter {
    #[serde(default)]
    pub engine: Option<EngineId>,
    #[serde(default)]
    pub needs_review: Option<bool>,
    #[serde(default)]
    pub self_mentioned: Option<bool>,
    #[serde(default)]
    pub risk: Option<RiskFlag>,
}

impl AnswerInsight {
    pub fn matches(&self, filter: &InsightFilter) -> bool {
        filter.engine.is_none_or(|engine| self.engine == engine)
            && filter
                .needs_review
                .is_none_or(|needs_review| self.needs_review == needs_review)
            && filter
                .self_mentioned
                .is_none_or(|mentioned| self.self_mentioned == mentioned)
            && filter.risk.is_none_or(|risk| self.risks.contains(&risk))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FactCheckIssue {
    pub id: String,
    pub round_id: String,
    pub record_id: String,
    pub prompt_id: String,
    pub prompt_text: String,
    pub engine: EngineId,
    pub kind: FactIssueKind,
    pub field_path: String,
    pub answer_excerpt: String,
    pub entity_value: String,
    pub confidence: f64,
    pub status: FactIssueStatus,
    pub correction_channel: CorrectionChannel,
    pub note: Option<String>,
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FactCheckSummary {
    pub round_id: String,
    pub by_kind: BTreeMap<FactIssueKind, i64>,
    pub checked_answers: i64,
    pub fact_accuracy: f64,
    pub false_positive_count: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FactCheckBoard {
    pub issues: Vec<FactCheckIssue>,
    pub summary: Option<FactCheckSummary>,
}

/// 保持 `SourceType` 在契约中显式（`source_types` 的键是它的 snake_case 值）。
const _: Option<SourceType> = None;

#[cfg(test)]
mod tests {
    use super::*;

    fn insight() -> AnswerInsight {
        AnswerInsight {
            id: "i1".to_string(),
            round_id: "r1".to_string(),
            record_id: "rec1".to_string(),
            prompt_id: "p1".to_string(),
            prompt_text: "问题".to_string(),
            engine: EngineId::Doubao,
            mentions: Vec::new(),
            self_mentioned: true,
            self_rank: Some(1),
            self_sentiment: Some(Sentiment::Positive),
            answer_shape: AnswerShape {
                has_conclusion: true,
                has_table: false,
                asks_back: false,
                refused: false,
            },
            source_types: BTreeMap::new(),
            confidence: 0.9,
            needs_review: true,
            risks: vec![RiskFlag::AbsoluteWording],
            corrected_fields: Vec::new(),
            reviewed_at: None,
        }
    }

    #[test]
    fn brand_role_serializes_as_self() {
        assert_eq!(
            serde_json::to_string(&BrandRole::Self_).unwrap(),
            "\"self\""
        );
        let parsed: BrandRole = serde_json::from_str("\"self\"").unwrap();
        assert_eq!(parsed, BrandRole::Self_);
    }

    #[test]
    fn filter_is_and_combined() {
        let value = insight();
        assert!(value.matches(&InsightFilter::default()));
        assert!(value.matches(&InsightFilter {
            engine: Some(EngineId::Doubao),
            needs_review: Some(true),
            self_mentioned: Some(true),
            risk: Some(RiskFlag::AbsoluteWording),
        }));
        assert!(!value.matches(&InsightFilter {
            engine: Some(EngineId::Kimi),
            ..Default::default()
        }));
        assert!(!value.matches(&InsightFilter {
            risk: Some(RiskFlag::NegativeBuzz),
            ..Default::default()
        }));
    }
}

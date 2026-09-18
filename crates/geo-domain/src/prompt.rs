//! Prompt 题库模型、意图分层与样本量纪律（产品文档 M2、第 4 节统计纪律）。

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::GeoError;
use crate::ids::{CompetitorId, ProjectId, PromptId, PromptSetId};

/// 指标口径版本，随每个 prompt 集快照存档，保证跨轮次可比。
pub const METRIC_SPEC_VERSION: &str = "geo-metrics-v1";

/// 样本量下限：达到该值才给出精确分数。
pub const SUFFICIENT_SAMPLE_SIZE: usize = 60;
/// 低于该值不提供任何精确分数。
pub const MINIMUM_SAMPLE_SIZE: usize = 30;

pub const MAX_PROMPT_CHARS: usize = 300;
pub const MAX_WEIGHT: u8 = 5;
pub const MAX_REPEAT_COUNT: u8 = 3;

/// 七类意图。序列化值即数据库存储值与前端契约。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntentCategory {
    CategoryAwareness,
    PurchaseRecommendation,
    BrandComparison,
    PricingPlan,
    LocalService,
    AfterSalesReputation,
    ProfessionalLongTail,
}

impl IntentCategory {
    pub fn all() -> [Self; 7] {
        [
            Self::CategoryAwareness,
            Self::PurchaseRecommendation,
            Self::BrandComparison,
            Self::PricingPlan,
            Self::LocalService,
            Self::AfterSalesReputation,
            Self::ProfessionalLongTail,
        ]
    }

    pub fn label_zh(&self) -> &'static str {
        match self {
            Self::CategoryAwareness => "品类认知",
            Self::PurchaseRecommendation => "选购推荐",
            Self::BrandComparison => "品牌对比",
            Self::PricingPlan => "价格方案",
            Self::LocalService => "本地服务",
            Self::AfterSalesReputation => "售后口碑",
            Self::ProfessionalLongTail => "专业长尾",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        Self::all()
            .into_iter()
            .find(|intent| intent.as_str() == raw)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CategoryAwareness => "category_awareness",
            Self::PurchaseRecommendation => "purchase_recommendation",
            Self::BrandComparison => "brand_comparison",
            Self::PricingPlan => "pricing_plan",
            Self::LocalService => "local_service",
            Self::AfterSalesReputation => "after_sales_reputation",
            Self::ProfessionalLongTail => "professional_long_tail",
        }
    }

    /// 意图漏斗分层（P0-C 复用）：认知层 → 推荐层 → 决策层。
    pub fn funnel_stage(&self) -> &'static str {
        match self {
            Self::CategoryAwareness | Self::ProfessionalLongTail => "认知层",
            Self::PurchaseRecommendation | Self::AfterSalesReputation => "推荐层",
            Self::BrandComparison | Self::PricingPlan | Self::LocalService => "决策层",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum PromptSource {
    #[default]
    Template,
    Generated,
    Rewritten,
    Manual,
    Imported,
}

impl PromptSource {
    pub fn all() -> [Self; 5] {
        [
            Self::Template,
            Self::Generated,
            Self::Rewritten,
            Self::Manual,
            Self::Imported,
        ]
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Template => "template",
            Self::Generated => "generated",
            Self::Rewritten => "rewritten",
            Self::Manual => "manual",
            Self::Imported => "imported",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        Self::all()
            .into_iter()
            .find(|source| source.as_str() == raw)
    }

    pub fn label_zh(&self) -> &'static str {
        match self {
            Self::Template => "模板",
            Self::Generated => "AI 生成",
            Self::Rewritten => "口语化改写",
            Self::Manual => "手动",
            Self::Imported => "导入",
        }
    }
}

/// 样本量分级：决定 UI 是否展示精确分数与提示文案。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SampleSizeGrade {
    Sufficient,
    Directional,
    Insufficient,
}

impl SampleSizeGrade {
    pub fn label_zh(&self) -> &'static str {
        match self {
            Self::Sufficient => "样本充足",
            Self::Directional => "样本偏少",
            Self::Insufficient => "样本不足",
        }
    }

    /// 需要在报告与 UI 上展示的警示文案；样本充足时为 `None`。
    pub fn warning_zh(&self) -> Option<String> {
        match self {
            Self::Sufficient => None,
            Self::Directional => Some(
                "样本不足，仅供方向性参考：当前 prompt 数低于 60 条，波动区间较大。".to_string(),
            ),
            Self::Insufficient => {
                Some("样本不足（<30 条），不提供精确分数，仅供方向性参考。".to_string())
            }
        }
    }

    /// 是否允许展示精确分数。
    pub fn allows_precise_score(&self) -> bool {
        matches!(self, Self::Sufficient | Self::Directional)
    }
}

pub fn sample_size_grade(count: usize) -> SampleSizeGrade {
    if count >= SUFFICIENT_SAMPLE_SIZE {
        SampleSizeGrade::Sufficient
    } else if count >= MINIMUM_SAMPLE_SIZE {
        SampleSizeGrade::Directional
    } else {
        SampleSizeGrade::Insufficient
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PromptItem {
    pub id: PromptId,
    pub set_id: PromptSetId,
    pub text: String,
    pub intent: IntentCategory,
    /// 核心词加权，1..=5。
    pub weight: u8,
    pub group_name: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub source: PromptSource,
    /// 同框竞品，用于计算 Share of Voice。
    #[serde(default)]
    pub competitor_ids: Vec<CompetitorId>,
    /// 重复采样次数 1..=3，输出波动区间而非单点值。
    pub repeat_count: u8,
    pub position: i32,
}

impl PromptItem {
    pub fn new(set_id: PromptSetId, text: impl Into<String>, intent: IntentCategory) -> Self {
        Self {
            id: PromptId::new(),
            set_id,
            text: text.into(),
            intent,
            weight: 3,
            group_name: Some(intent.label_zh().to_string()),
            tags: Vec::new(),
            source: PromptSource::Template,
            competitor_ids: Vec::new(),
            repeat_count: 1,
            position: 0,
        }
    }

    pub fn validate(&self) -> Result<(), GeoError> {
        let text = self.text.trim();
        if text.is_empty() {
            return Err(GeoError::validation("text", "prompt 不能为空"));
        }
        if text.chars().count() > MAX_PROMPT_CHARS {
            return Err(GeoError::validation(
                "text",
                format!("prompt 不能超过 {MAX_PROMPT_CHARS} 字"),
            ));
        }
        if !(1..=MAX_WEIGHT).contains(&self.weight) {
            return Err(GeoError::validation(
                "weight",
                format!("权重需在 1~{MAX_WEIGHT} 之间"),
            ));
        }
        if !(1..=MAX_REPEAT_COUNT).contains(&self.repeat_count) {
            return Err(GeoError::validation(
                "repeat_count",
                format!("重复采样次数需在 1~{MAX_REPEAT_COUNT} 之间"),
            ));
        }
        Ok(())
    }

    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = tags;
        self
    }

    pub fn with_weight(mut self, weight: u8) -> Self {
        self.weight = weight;
        self
    }

    pub fn with_competitors(mut self, competitor_ids: Vec<CompetitorId>) -> Self {
        self.competitor_ids = competitor_ids;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PromptSet {
    pub id: PromptSetId,
    pub project_id: ProjectId,
    pub version: i32,
    pub label: String,
    pub items: Vec<PromptItem>,
    pub content_hash: String,
    /// 生成时选定的引擎列表；P0-A 为空，P0-B 写入实际引擎。
    #[serde(default)]
    pub engine_scope: Vec<String>,
    pub metric_spec_version: String,
    pub sample_size_grade: SampleSizeGrade,
    pub created_at: DateTime<Utc>,
    pub notes: Option<String>,
}

impl PromptSet {
    pub fn new(
        project_id: ProjectId,
        version: i32,
        label: impl Into<String>,
        items: Vec<PromptItem>,
        created_at: DateTime<Utc>,
        notes: Option<String>,
    ) -> Self {
        let sample_size_grade = sample_size_grade(items.len());
        let content_hash = content_hash(&items);
        Self {
            id: PromptSetId::new(),
            project_id,
            version,
            label: label.into(),
            items,
            content_hash,
            engine_scope: Vec::new(),
            metric_spec_version: METRIC_SPEC_VERSION.to_string(),
            sample_size_grade,
            created_at,
            notes,
        }
    }

    /// 条目变更后重算派生字段。
    pub fn refresh(&mut self) {
        self.reindex();
        self.content_hash = content_hash(&self.items);
        self.sample_size_grade = sample_size_grade(self.items.len());
    }

    /// 按当前顺序写入 `position` 与 `set_id`。
    pub fn reindex(&mut self) {
        for (index, item) in self.items.iter_mut().enumerate() {
            item.position = index as i32;
            item.set_id = self.id;
        }
    }

    pub fn intent_coverage(&self) -> HashSet<IntentCategory> {
        self.items.iter().map(|item| item.intent).collect()
    }

    pub fn count_by_intent(&self) -> Vec<(IntentCategory, usize)> {
        IntentCategory::all()
            .into_iter()
            .map(|intent| {
                (
                    intent,
                    self.items
                        .iter()
                        .filter(|item| item.intent == intent)
                        .count(),
                )
            })
            .collect()
    }

    /// 样本量或意图覆盖不足时的补齐建议（不静默通过）。
    pub fn shortfall_advice(&self, target_count: usize) -> Vec<String> {
        let mut advice = Vec::new();
        if self.items.len() < target_count {
            advice.push(format!(
                "当前 {} 条，距离目标 {} 条还差 {} 条，建议补充后再生成报告。",
                self.items.len(),
                target_count,
                target_count - self.items.len()
            ));
        }
        if let Some(warning) = self.sample_size_grade.warning_zh() {
            advice.push(warning);
        }
        let covered = self.intent_coverage();
        for intent in IntentCategory::all() {
            if !covered.contains(&intent) {
                advice.push(format!(
                    "缺少「{}」类意图的 prompt，建议至少补充 3 条。",
                    intent.label_zh()
                ));
            }
        }
        advice
    }

    pub fn validate(&self) -> Result<(), GeoError> {
        for item in &self.items {
            item.validate()?;
        }
        Ok(())
    }
}

/// 内容指纹：对 `intent|weight|text` 排序后拼接取 sha256，保证与条目顺序无关。
pub fn content_hash(items: &[PromptItem]) -> String {
    let mut lines: Vec<String> = items
        .iter()
        .map(|item| {
            format!(
                "{}|{}|{}",
                item.intent.as_str(),
                item.weight,
                item.text.trim()
            )
        })
        .collect();
    lines.sort();
    let mut hasher = Sha256::new();
    hasher.update(lines.join("\n").as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(16);
    for byte in &digest[..8] {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> DateTime<Utc> {
        DateTime::from_timestamp(1_780_000_000, 0).expect("固定时间戳")
    }

    fn item(text: &str, intent: IntentCategory, weight: u8) -> PromptItem {
        PromptItem::new(PromptSetId::new(), text, intent).with_weight(weight)
    }

    #[test]
    fn sample_size_grade_boundaries() {
        assert_eq!(sample_size_grade(60), SampleSizeGrade::Sufficient);
        assert_eq!(sample_size_grade(100), SampleSizeGrade::Sufficient);
        assert_eq!(sample_size_grade(59), SampleSizeGrade::Directional);
        assert_eq!(sample_size_grade(30), SampleSizeGrade::Directional);
        assert_eq!(sample_size_grade(29), SampleSizeGrade::Insufficient);
        assert_eq!(sample_size_grade(0), SampleSizeGrade::Insufficient);
    }

    #[test]
    fn insufficient_grade_warns_and_blocks_precise_score() {
        assert_eq!(SampleSizeGrade::Sufficient.warning_zh(), None);
        let warning = SampleSizeGrade::Directional.warning_zh().unwrap();
        assert!(warning.contains("样本不足"));
        assert!(SampleSizeGrade::Insufficient
            .warning_zh()
            .unwrap()
            .contains("<30"));
        assert!(!SampleSizeGrade::Insufficient.allows_precise_score());
        assert!(SampleSizeGrade::Sufficient.allows_precise_score());
    }

    #[test]
    fn content_hash_is_order_independent_but_content_sensitive() {
        let a = vec![
            item(
                "国内做工业水泵的厂家有哪些？",
                IntentCategory::CategoryAwareness,
                3,
            ),
            item(
                "预算10万以内工业水泵推荐哪几家？",
                IntentCategory::PurchaseRecommendation,
                4,
            ),
        ];
        let mut b = a.clone();
        b.reverse();
        assert_eq!(content_hash(&a), content_hash(&b));
        let mut c = a.clone();
        c[0].text = "国内做工业风机的厂家有哪些？".into();
        assert_ne!(content_hash(&a), content_hash(&c));
        let mut d = a.clone();
        d[0].weight = 5;
        assert_ne!(content_hash(&a), content_hash(&d));
        assert_eq!(content_hash(&a).len(), 16);
    }

    #[test]
    fn prompt_set_new_derives_hash_and_grade() {
        let items: Vec<PromptItem> = (0..60)
            .map(|index| item(&format!("问题 {index}"), IntentCategory::PricingPlan, 3))
            .collect();
        let set = PromptSet::new(ProjectId::new(), 1, "基线", items, now(), None);
        assert_eq!(set.sample_size_grade, SampleSizeGrade::Sufficient);
        assert_eq!(set.metric_spec_version, METRIC_SPEC_VERSION);
        assert!(!set.content_hash.is_empty());
        assert!(set.engine_scope.is_empty());
    }

    #[test]
    fn refresh_reindexes_and_recomputes() {
        let mut set = PromptSet::new(
            ProjectId::new(),
            1,
            "基线",
            vec![item("问题一", IntentCategory::LocalService, 3)],
            now(),
            None,
        );
        let old_hash = set.content_hash.clone();
        set.items
            .push(item("问题二", IntentCategory::LocalService, 3));
        set.refresh();
        assert_eq!(set.items.len(), 2);
        assert_eq!(set.items[1].position, 1);
        assert_eq!(set.items[0].set_id, set.id);
        assert_ne!(set.content_hash, old_hash);
        assert_eq!(set.sample_size_grade, SampleSizeGrade::Insufficient);
    }

    #[test]
    fn shortfall_advice_names_missing_intents() {
        let set = PromptSet::new(
            ProjectId::new(),
            1,
            "基线",
            vec![
                item("问题一", IntentCategory::CategoryAwareness, 3),
                item("问题二", IntentCategory::CategoryAwareness, 3),
            ],
            now(),
            None,
        );
        let advice = set.shortfall_advice(60);
        // 条数不足 1 条 + 样本不足警示 1 条 + 缺失 6 类意图
        assert_eq!(advice.len(), 8);
        assert!(advice.iter().any(|line| line.contains("品牌对比")));
        assert!(advice.iter().any(|line| line.contains("售后口碑")));
        assert!(!advice.iter().any(|line| line.contains("品类认知")));
    }

    #[test]
    fn intent_coverage_and_counts() {
        let set = PromptSet::new(
            ProjectId::new(),
            1,
            "基线",
            vec![
                item("问题一", IntentCategory::CategoryAwareness, 3),
                item("问题二", IntentCategory::CategoryAwareness, 4),
                item("问题三", IntentCategory::BrandComparison, 3),
            ],
            now(),
            None,
        );
        assert_eq!(set.intent_coverage().len(), 2);
        let counts: std::collections::HashMap<_, _> = set.count_by_intent().into_iter().collect();
        assert_eq!(counts[&IntentCategory::CategoryAwareness], 2);
        assert_eq!(counts[&IntentCategory::PricingPlan], 0);
    }

    #[test]
    fn item_validation_bounds() {
        let set_id = PromptSetId::new();
        assert!(PromptItem::new(set_id, "  ", IntentCategory::PricingPlan)
            .validate()
            .is_err());
        assert!(
            PromptItem::new(set_id, "问".repeat(301), IntentCategory::PricingPlan)
                .validate()
                .is_err()
        );
        assert!(
            PromptItem::new(set_id, "正常问题", IntentCategory::PricingPlan)
                .with_weight(9)
                .validate()
                .is_err()
        );
        let mut ok = PromptItem::new(set_id, "正常问题", IntentCategory::PricingPlan);
        ok.repeat_count = 4;
        assert!(ok.validate().is_err());
        assert!(
            PromptItem::new(set_id, "正常问题", IntentCategory::PricingPlan)
                .validate()
                .is_ok()
        );
    }

    #[test]
    fn intent_contract_strings() {
        assert_eq!(IntentCategory::all().len(), 7);
        assert_eq!(
            serde_json::to_string(&IntentCategory::PurchaseRecommendation).unwrap(),
            "\"purchase_recommendation\""
        );
        assert_eq!(
            IntentCategory::parse("professional_long_tail"),
            Some(IntentCategory::ProfessionalLongTail)
        );
        assert_eq!(IntentCategory::parse("nope"), None);
        assert_eq!(IntentCategory::BrandComparison.label_zh(), "品牌对比");
        assert_eq!(IntentCategory::BrandComparison.funnel_stage(), "决策层");
    }
}

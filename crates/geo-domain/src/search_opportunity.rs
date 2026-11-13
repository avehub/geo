//! 站长数据优化机会模型与 DR-100 规则（M5.5）。
//!
//! 🔴 本模块是 `geo-domain` 纯函数：不依赖仓库内其他 crate、不做 IO；当前时间由调用方注入。
//! 六条规则的阈值全部是 `pub const`，服务层只负责取数、落库与保留人工状态。

use std::collections::{BTreeMap, BTreeSet, HashMap};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::diagnosis::DiagnosisOverview;
use crate::ids::{ProjectId, SearchOpportunityId};
use crate::insight::REVIEW_CONFIDENCE_FLOOR;
use crate::keyword::{KeywordItem, KeywordKind};
use crate::search_metrics::{SearchAiOverview, SearchQueryMetric, SearchSurface};
use crate::site::{SitePage, SitePageRole};

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

/// 规则 1：曝光达到下限且点击率低于保守经验下界。DTO 没有位次字段，因此一律用保守常量。
pub const HIGH_IMPRESSION_LOW_CTR_MIN_IMPRESSIONS: i64 = 500;
/// 无位次数据时使用的同位次经验下界（0.01 = 1%）。合规表述只能是“经验下界”。
pub const HIGH_IMPRESSION_LOW_CTR_RATE_FLOOR: f64 = 0.01;

/// 规则 2：有需求但站内没有承接内容时，查询至少要有这么多曝光。
pub const DEMAND_WITHOUT_CONTENT_MIN_IMPRESSIONS: i64 = 100;

/// 规则 3：传统搜索面至少这么多次点击，才判 AI 引用缺口。
pub const AI_CITATION_GAP_MIN_WEB_CLICKS: i64 = 1;

/// 规则 4：站点页面流量合计下限。
pub const LANDING_ROLE_MISMATCH_MIN_IMPRESSIONS: i64 = 500;
/// 规则 4：role=other 页面占站点页面流量的比例下限。
pub const LANDING_ROLE_MISMATCH_OTHER_SHARE: f64 = 0.60;

/// 规则 5：页面至少要有这么多次曝光，才判“被挡且有需求”。
pub const CRAWL_BLOCKED_MIN_IMPRESSIONS: i64 = 1;

/// 规则 6：品牌词曝光相对变化超过该比例才算“升 / 降”。
pub const TREND_DIVERGENCE_MIN_VOLUME_RATIO: f64 = 0.20;
/// 规则 6：品牌覆盖率变化超过该绝对值才算方向变化。
pub const TREND_DIVERGENCE_MIN_COVERAGE_DELTA: f64 = 0.05;

/// `build_search_opportunities` 的输入。
///
/// `previous_overview` 可选：没有上一轮诊断趋势时，规则 6 直接跳过。
pub struct SearchOpportunityInput<'a> {
    pub project_id: ProjectId,
    pub metrics: &'a [SearchQueryMetric],
    pub ai_overviews: &'a [SearchAiOverview],
    pub keywords: &'a [KeywordItem],
    pub pages: &'a [SitePage],
    pub previous_overview: Option<&'a DiagnosisOverview>,
    pub now: DateTime<Utc>,
}

#[derive(Debug, Default)]
struct QueryAggregate {
    impressions: i64,
    clicks: i64,
    web_impressions: i64,
    web_clicks: i64,
    ai_citations: i64,
    ai_citations_known: bool,
    has_web: bool,
    has_ai: bool,
    metric_ids: Vec<String>,
}

impl QueryAggregate {
    fn merge_metric(&mut self, metric: &SearchQueryMetric) {
        self.impressions += metric.impressions.unwrap_or(0);
        self.clicks += metric.clicks.unwrap_or(0);
        match metric.surface {
            SearchSurface::WebSearch => {
                self.has_web = true;
                self.web_impressions += metric.impressions.unwrap_or(0);
                self.web_clicks += metric.clicks.unwrap_or(0);
            }
            SearchSurface::AiAnswer => {
                self.has_ai = true;
                if let Some(citations) = metric.citations {
                    self.ai_citations_known = true;
                    self.ai_citations += citations;
                }
            }
        }
        self.metric_ids.push(metric.id.to_string());
    }

    fn web_ctr(&self) -> Option<f64> {
        (self.web_impressions > 0).then(|| self.web_clicks as f64 / self.web_impressions as f64)
    }
}

/// 按 DR-100 生成机会。输出按 `(rule_id, title_key, basis)` 稳定排序并去重；
/// 同一输入 + 同一 `now` 重复调用结果逐字相同（ID 由稳定键哈希得到）。
pub fn build_search_opportunities(input: SearchOpportunityInput<'_>) -> Vec<SearchOpportunity> {
    let aggregates = aggregate_queries(input.metrics);
    let mut candidates = Vec::new();
    rule_high_impression_low_ctr(&input, &aggregates, &mut candidates);
    rule_demand_without_content(&input, &aggregates, &mut candidates);
    rule_ai_citation_gap(&input, &aggregates, &mut candidates);
    rule_landing_role_mismatch(&input, &mut candidates);
    rule_crawl_blocked_with_demand(&input, &mut candidates);
    rule_trend_divergence(&input, &mut candidates);

    let mut deduped: BTreeMap<(u8, String, String), SearchOpportunity> = BTreeMap::new();
    for opportunity in candidates {
        deduped
            .entry(opportunity_key(&opportunity))
            .or_insert(opportunity);
    }
    let mut items: Vec<_> = deduped.into_values().collect();
    items.sort_by(|left, right| {
        (left.rule_id, left.title_key.as_str(), left.basis.as_str()).cmp(&(
            right.rule_id,
            right.title_key.as_str(),
            right.basis.as_str(),
        ))
    });
    items
}

fn aggregate_queries(metrics: &[SearchQueryMetric]) -> BTreeMap<String, QueryAggregate> {
    let mut aggregates = BTreeMap::new();
    for metric in metrics {
        aggregates
            .entry(normalize(&metric.query))
            .or_insert_with(QueryAggregate::default)
            .merge_metric(metric);
    }
    aggregates
}

fn rule_high_impression_low_ctr(
    input: &SearchOpportunityInput<'_>,
    aggregates: &BTreeMap<String, QueryAggregate>,
    out: &mut Vec<SearchOpportunity>,
) {
    for aggregate in aggregates.values() {
        if aggregate.web_impressions < HIGH_IMPRESSION_LOW_CTR_MIN_IMPRESSIONS {
            continue;
        }
        let Some(ctr) = aggregate.web_ctr() else {
            continue;
        };
        if ctr >= HIGH_IMPRESSION_LOW_CTR_RATE_FLOOR {
            continue;
        }
        let query = display_query(input.metrics, aggregate);
        let basis = format!(
            "「{query}」在传统搜索面合计 {} 次曝光、{} 次点击，重算点击率 {:.2}%；低于无位次数据时采用的经验下界 {:.2}%。",
            aggregate.web_impressions,
            aggregate.web_clicks,
            ctr * 100.0,
            HIGH_IMPRESSION_LOW_CTR_RATE_FLOOR * 100.0,
        );
        push(
            out,
            input,
            1,
            basis,
            SearchPrescriptionCategory::SiteStructure,
            SearchActionLevel::High,
            SearchActionLevel::Low,
            confidence_for(
                aggregate.web_impressions,
                HIGH_IMPRESSION_LOW_CTR_MIN_IMPRESSIONS,
            ),
            &aggregate.metric_ids,
        );
    }
}

fn rule_demand_without_content(
    input: &SearchOpportunityInput<'_>,
    aggregates: &BTreeMap<String, QueryAggregate>,
    out: &mut Vec<SearchOpportunity>,
) {
    let keyword_texts: BTreeSet<String> = input
        .keywords
        .iter()
        .map(|keyword| normalize(&keyword.text))
        .collect();
    let page_texts: Vec<String> = input.pages.iter().map(page_search_text).collect();

    for (normalized_query, aggregate) in aggregates {
        if aggregate.impressions < DEMAND_WITHOUT_CONTENT_MIN_IMPRESSIONS {
            continue;
        }
        if keyword_texts.contains(normalized_query) {
            continue;
        }
        if page_texts
            .iter()
            .any(|text| text.contains(normalized_query.as_str()))
        {
            continue;
        }
        let query = display_query(input.metrics, aggregate);
        let basis = format!(
            "「{query}」合计 {} 次曝光、{} 次点击；关键词库没有该词，站点页面清单里也没有承接它的主题页。",
            aggregate.impressions, aggregate.clicks,
        );
        push(
            out,
            input,
            2,
            basis,
            SearchPrescriptionCategory::ContentProduction,
            SearchActionLevel::Medium,
            SearchActionLevel::Medium,
            confidence_for(
                aggregate.impressions,
                DEMAND_WITHOUT_CONTENT_MIN_IMPRESSIONS,
            ),
            &aggregate.metric_ids,
        );
    }
}

fn rule_ai_citation_gap(
    input: &SearchOpportunityInput<'_>,
    aggregates: &BTreeMap<String, QueryAggregate>,
    out: &mut Vec<SearchOpportunity>,
) {
    let has_ai_data = input
        .metrics
        .iter()
        .any(|metric| metric.surface == SearchSurface::AiAnswer)
        || !input.ai_overviews.is_empty();
    if !has_ai_data {
        return;
    }
    let overview_citations: Option<i64> = input
        .ai_overviews
        .iter()
        .filter_map(|overview| overview.citations)
        .reduce(|left, right| left + right);
    let overview_is_empty = input.ai_overviews.is_empty() || overview_citations.unwrap_or(0) == 0;

    for aggregate in aggregates.values() {
        if !aggregate.has_web || aggregate.web_clicks < AI_CITATION_GAP_MIN_WEB_CLICKS {
            continue;
        }
        let gap = if aggregate.has_ai {
            !aggregate.ai_citations_known || aggregate.ai_citations == 0
        } else {
            overview_is_empty
        };
        if !gap {
            continue;
        }
        let query = display_query(input.metrics, aggregate);
        let ai_detail = if aggregate.has_ai {
            if aggregate.ai_citations_known {
                format!("AI 面引用量为 {}，处于缺口状态", aggregate.ai_citations)
            } else {
                "AI 面没有给出引用量".to_string()
            }
        } else {
            "AI 面没有这个词的引用记录".to_string()
        };
        let basis = format!(
            "「{query}」传统搜索面 {} 次曝光、{} 次点击，{ai_detail}：真实需求已经存在，AI 答案里却没有我们。",
            aggregate.web_impressions, aggregate.web_clicks,
        );
        push(
            out,
            input,
            3,
            basis,
            SearchPrescriptionCategory::SourceLayout,
            SearchActionLevel::High,
            SearchActionLevel::Medium,
            confidence_for(aggregate.web_clicks, AI_CITATION_GAP_MIN_WEB_CLICKS),
            &aggregate.metric_ids,
        );
    }
}

fn rule_landing_role_mismatch(
    input: &SearchOpportunityInput<'_>,
    out: &mut Vec<SearchOpportunity>,
) {
    let pages: BTreeMap<String, &SitePage> = input
        .pages
        .iter()
        .map(|page| (normalize(&page.url), page))
        .collect();
    let mut traffic: HashMap<SitePageRole, (i64, Vec<String>)> = HashMap::new();
    for metric in input.metrics {
        let Some(page_url) = metric.page_url.as_deref() else {
            continue;
        };
        let Some(page) = pages.get(&normalize(page_url)) else {
            continue;
        };
        let impressions = metric.impressions.unwrap_or(0);
        if impressions <= 0 {
            continue;
        }
        let entry = traffic.entry(page.role).or_default();
        entry.0 += impressions;
        entry.1.push(metric.id.to_string());
    }
    let total: i64 = traffic.values().map(|(impressions, _)| *impressions).sum();
    if total < LANDING_ROLE_MISMATCH_MIN_IMPRESSIONS {
        return;
    }
    let other = traffic
        .get(&SitePageRole::Other)
        .map(|(impressions, _)| *impressions)
        .unwrap_or(0);
    let home = traffic
        .get(&SitePageRole::Home)
        .map(|(impressions, _)| *impressions)
        .unwrap_or(0);
    let product = traffic
        .get(&SitePageRole::Product)
        .map(|(impressions, _)| *impressions)
        .unwrap_or(0);
    let share = other as f64 / total as f64;
    if other == 0 || share < LANDING_ROLE_MISMATCH_OTHER_SHARE || home + product > 0 {
        return;
    }
    let evidence = traffic
        .values()
        .flat_map(|(_, ids)| ids.iter().cloned())
        .collect::<Vec<_>>();
    let basis = format!(
        "站点页面流量合计 {total} 次曝光，其中 role=other 页面 {other} 次（{:.1}%）；home 与 product 角色页面为 0 次。",
        share * 100.0,
    );
    push(
        out,
        input,
        4,
        basis,
        SearchPrescriptionCategory::SiteStructure,
        SearchActionLevel::Medium,
        SearchActionLevel::High,
        confidence_for(total, LANDING_ROLE_MISMATCH_MIN_IMPRESSIONS),
        &evidence,
    );
}

fn rule_crawl_blocked_with_demand(
    input: &SearchOpportunityInput<'_>,
    out: &mut Vec<SearchOpportunity>,
) {
    if input.pages.is_empty() {
        return;
    }
    let pages: BTreeMap<String, &SitePage> = input
        .pages
        .iter()
        .map(|page| (normalize(&page.url), page))
        .collect();
    let mut page_traffic: BTreeMap<String, (i64, BTreeSet<String>, &str)> = BTreeMap::new();
    for metric in input.metrics {
        let Some(page_url) = metric.page_url.as_deref() else {
            continue;
        };
        let impressions = metric.impressions.unwrap_or(0);
        if impressions <= 0 {
            continue;
        }
        let key = normalize(page_url);
        if !pages.contains_key(&key) {
            continue;
        }
        let entry = page_traffic
            .entry(key)
            .or_insert_with(|| (0, BTreeSet::new(), page_url));
        entry.0 += impressions;
        entry.1.insert(metric.id.to_string());
    }
    for (key, (impressions, ids, page_url)) in page_traffic {
        let Some(page) = pages.get(&key) else {
            continue;
        };
        if page.crawlable || impressions < CRAWL_BLOCKED_MIN_IMPRESSIONS {
            continue;
        }
        let evidence: Vec<String> = ids.into_iter().collect();
        let basis = format!(
            "页面 {page_url} 有 {impressions} 次曝光（{} 个查询），但站点页面清单里 crawlable=false。",
            evidence.len(),
        );
        push(
            out,
            input,
            5,
            basis,
            SearchPrescriptionCategory::SiteStructure,
            SearchActionLevel::High,
            SearchActionLevel::Low,
            confidence_for(impressions, CRAWL_BLOCKED_MIN_IMPRESSIONS),
            &evidence,
        );
    }
}

fn rule_trend_divergence(input: &SearchOpportunityInput<'_>, out: &mut Vec<SearchOpportunity>) {
    let Some(overview) = input.previous_overview else {
        return;
    };
    let brand_queries: BTreeSet<String> = input
        .keywords
        .iter()
        .filter(|keyword| keyword.kind == KeywordKind::Brand)
        .map(|keyword| normalize(&keyword.text))
        .collect();
    if brand_queries.is_empty() {
        return;
    }

    let mut volume_by_period: BTreeMap<String, i64> = BTreeMap::new();
    let mut evidence = Vec::new();
    for metric in input.metrics {
        if !brand_queries.contains(&normalize(&metric.query)) {
            continue;
        }
        *volume_by_period
            .entry(metric.period_end.clone())
            .or_default() += metric.impressions.unwrap_or(0);
        evidence.push(metric.id.to_string());
    }
    if volume_by_period.len() < 2 {
        return;
    }
    let periods: Vec<(String, i64)> = volume_by_period.into_iter().collect();
    let (latest_period, latest_volume) = &periods[periods.len() - 1];
    let (previous_period, previous_volume) = &periods[periods.len() - 2];
    if *previous_volume <= 0 || *latest_volume <= 0 {
        return;
    }
    let volume_ratio = (*latest_volume - *previous_volume) as f64 / *previous_volume as f64;

    let Some(prior) = overview
        .trend
        .iter()
        .filter(|point| point.round_id != overview.round_id)
        .max_by_key(|point| point.collected_at)
    else {
        return;
    };
    let coverage_delta = overview.brand_coverage - prior.brand_coverage;
    let volume_up = volume_ratio >= TREND_DIVERGENCE_MIN_VOLUME_RATIO;
    let volume_down = volume_ratio <= -TREND_DIVERGENCE_MIN_VOLUME_RATIO;
    let coverage_up = coverage_delta >= TREND_DIVERGENCE_MIN_COVERAGE_DELTA;
    let coverage_down = coverage_delta <= -TREND_DIVERGENCE_MIN_COVERAGE_DELTA;
    if !((volume_up && coverage_down) || (volume_down && coverage_up)) {
        return;
    }
    let basis = format!(
        "品牌词曝光在 {previous_period}→{latest_period} 从 {previous_volume} 变为 {latest_volume}（{:+.1}%），而品牌覆盖率从 {:.1}% 变为 {:.1}%（{:+.1} 个百分点）：两条趋势方向相反。",
        volume_ratio * 100.0,
        prior.brand_coverage * 100.0,
        overview.brand_coverage * 100.0,
        coverage_delta * 100.0,
    );
    push(
        out,
        input,
        6,
        basis,
        SearchPrescriptionCategory::SourceLayout,
        SearchActionLevel::Medium,
        SearchActionLevel::Medium,
        confidence_for(*latest_volume, DEMAND_WITHOUT_CONTENT_MIN_IMPRESSIONS)
            .max(REVIEW_CONFIDENCE_FLOOR),
        &evidence,
    );
}

#[allow(clippy::too_many_arguments)]
fn push(
    out: &mut Vec<SearchOpportunity>,
    input: &SearchOpportunityInput<'_>,
    rule_id: u8,
    basis: String,
    prescription_category: SearchPrescriptionCategory,
    impact: SearchActionLevel,
    difficulty: SearchActionLevel,
    confidence: f64,
    evidence_metric_ids: &[String],
) {
    let title_key = format!("webmasterData.rules.{}.name", rule_key(rule_id));
    let mut evidence = evidence_metric_ids.to_vec();
    evidence.sort();
    evidence.dedup();
    out.push(SearchOpportunity {
        id: deterministic_id(input.project_id, rule_id, &title_key, &basis),
        project_id: input.project_id,
        rule_id,
        title_key,
        basis,
        evidence_metric_ids: evidence,
        prescription_category,
        impact,
        difficulty,
        confidence,
        status: SearchOpportunityStatus::New,
        created_at: input.now,
        updated_at: input.now,
    });
}

fn rule_key(rule_id: u8) -> &'static str {
    match rule_id {
        1 => "high_impression_low_ctr",
        2 => "demand_without_content",
        3 => "ai_citation_gap",
        4 => "landing_role_mismatch",
        5 => "crawl_blocked_with_demand",
        6 => "trend_divergence",
        _ => "unknown",
    }
}

fn confidence_for(sample: i64, floor: i64) -> f64 {
    let ratio = sample as f64 / floor.max(1) as f64;
    (REVIEW_CONFIDENCE_FLOOR + 0.10 * (ratio - 1.0).clamp(0.0, 2.0)).min(0.95)
}

fn deterministic_id(
    project_id: ProjectId,
    rule_id: u8,
    title_key: &str,
    basis: &str,
) -> SearchOpportunityId {
    let mut hasher = Sha256::new();
    hasher.update(project_id.to_string().as_bytes());
    hasher.update([0]);
    hasher.update([rule_id]);
    hasher.update([0]);
    hasher.update(title_key.as_bytes());
    hasher.update([0]);
    hasher.update(basis.as_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    SearchOpportunityId::from_uuid(uuid::Uuid::from_bytes(bytes))
}

fn opportunity_key(opportunity: &SearchOpportunity) -> (u8, String, String) {
    (
        opportunity.rule_id,
        opportunity.title_key.clone(),
        opportunity.basis.clone(),
    )
}

fn display_query(metrics: &[SearchQueryMetric], aggregate: &QueryAggregate) -> String {
    for id in &aggregate.metric_ids {
        if let Some(metric) = metrics.iter().find(|metric| metric.id.to_string() == *id) {
            return metric.query.clone();
        }
    }
    String::new()
}

fn page_search_text(page: &SitePage) -> String {
    let mut text = normalize(&page.url);
    if let Some(title) = &page.title {
        text.push_str(&normalize(title));
    }
    text
}

fn normalize(text: &str) -> String {
    text.chars()
        .filter(|value| {
            !value.is_whitespace()
                && !value.is_ascii_punctuation()
                && !matches!(
                    value,
                    '，' | '。' | '、' | '？' | '！' | '：' | '；' | '（' | '）' | '“' | '”'
                )
        })
        .flat_map(|value| value.to_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collection::RoundStatus;
    use crate::compliance::ContentStatus;
    use crate::diagnosis::TrendPoint;
    use crate::keyword::{KeywordKind, LibrarySource};
    use crate::prompt::{IntentCategory, SampleSizeGrade};
    use crate::search::SearchSourceKind;
    use crate::search_metrics::{SearchCompleteness, WindowSource};
    use crate::site::SitePageRole;
    use chrono::TimeZone;

    fn ts(day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, day, 0, 0, 0).unwrap()
    }

    fn project() -> ProjectId {
        ProjectId::new()
    }

    #[allow(clippy::too_many_arguments)]
    fn metric(
        project_id: ProjectId,
        query: &str,
        surface: SearchSurface,
        page_url: Option<&str>,
        impressions: i64,
        clicks: i64,
        ctr: f64,
        citations: Option<i64>,
        period: &str,
    ) -> SearchQueryMetric {
        SearchQueryMetric {
            id: crate::ids::SearchMetricId::new(),
            project_id,
            source_kind: if surface == SearchSurface::AiAnswer {
                SearchSourceKind::BaiduZiyuanAi
            } else {
                SearchSourceKind::BaiduZiyuan
            },
            surface,
            query: query.to_string(),
            page_url: page_url.map(str::to_string),
            impressions: Some(impressions),
            clicks: Some(clicks),
            ctr: Some(ctr),
            citations,
            ai_clicks: None,
            period_start: period.to_string(),
            period_end: period.to_string(),
            data_through: period.to_string(),
            imported_at: ts(1),
            completeness: SearchCompleteness::Partial,
            window_source: WindowSource::UserStated,
            mapping_version: "test".to_string(),
        }
    }

    fn keyword(project_id: ProjectId, text: &str, kind: KeywordKind) -> KeywordItem {
        KeywordItem {
            id: crate::ids::KeywordId::new(),
            project_id,
            text: text.to_string(),
            kind,
            intent: IntentCategory::CategoryAwareness,
            monthly_volume: None,
            difficulty: None,
            priority: 3,
            status: ContentStatus::Approved,
            note: None,
            source: LibrarySource::Manual,
            position: 0,
            created_at: ts(1),
            updated_at: ts(1),
        }
    }

    fn page(project_id: ProjectId, url: &str, role: SitePageRole, crawlable: bool) -> SitePage {
        SitePage {
            id: url.to_string(),
            project_id,
            url: url.to_string(),
            role,
            title: Some(url.to_string()),
            last_checked_at: None,
            crawlable,
        }
    }

    fn previous_overview(
        project_id: ProjectId,
        previous_coverage: f64,
        current_coverage: f64,
    ) -> DiagnosisOverview {
        let point = |round: &str, day: u32, coverage: f64| TrendPoint {
            round_id: round.to_string(),
            round_label: round.to_string(),
            collected_at: ts(day),
            status: RoundStatus::Succeeded,
            brand_coverage: coverage,
            coverage_margin: 0.0,
            total_score: 60.0,
            fact_accuracy: 0.9,
            sample_size: 40,
        };
        DiagnosisOverview {
            project_id: project_id.to_string(),
            round_id: "r2".to_string(),
            round_label: "第 2 轮".to_string(),
            collected_at: ts(20),
            total_score: 60.0,
            score_margin: 0.0,
            sample_size: 40,
            sample_size_grade: SampleSizeGrade::Sufficient,
            dimensions: Vec::new(),
            brand_coverage: current_coverage,
            brand_coverage_margin: current_coverage - previous_coverage,
            share_of_voice: 0.2,
            fact_accuracy: 0.9,
            distinct_cited_domains: 5,
            trend: vec![
                point("r1", 10, previous_coverage),
                point("r2", 20, current_coverage),
            ],
            alerts: Vec::new(),
            metric_spec_version: "test".to_string(),
        }
    }

    fn input<'a>(
        project_id: ProjectId,
        metrics: &'a [SearchQueryMetric],
        overviews: &'a [SearchAiOverview],
        keywords: &'a [KeywordItem],
        pages: &'a [SitePage],
        previous: Option<&'a DiagnosisOverview>,
    ) -> SearchOpportunityInput<'a> {
        SearchOpportunityInput {
            project_id,
            metrics,
            ai_overviews: overviews,
            keywords,
            pages,
            previous_overview: previous,
            now: ts(30),
        }
    }

    #[test]
    fn rule_one_hits_only_with_enough_impressions_and_low_ctr() {
        let project_id = project();
        let pages = vec![page(
            project_id,
            "https://example.com/",
            SitePageRole::Home,
            true,
        )];
        let hit = vec![metric(
            project_id,
            "工业除尘器",
            SearchSurface::WebSearch,
            Some("https://example.com/"),
            1_000,
            5,
            0.005,
            None,
            "2026-09-30",
        )];
        let opportunities =
            build_search_opportunities(input(project_id, &hit, &[], &[], &pages, None));
        assert!(opportunities.iter().any(|item| item.rule_id == 1));

        let low_sample = vec![metric(
            project_id,
            "工业除尘器",
            SearchSurface::WebSearch,
            Some("https://example.com/"),
            100,
            0,
            0.0,
            None,
            "2026-09-30",
        )];
        let opportunities =
            build_search_opportunities(input(project_id, &low_sample, &[], &[], &pages, None));
        assert!(!opportunities.iter().any(|item| item.rule_id == 1));

        let healthy = vec![metric(
            project_id,
            "工业除尘器",
            SearchSurface::WebSearch,
            Some("https://example.com/"),
            1_000,
            50,
            0.05,
            None,
            "2026-09-30",
        )];
        let opportunities =
            build_search_opportunities(input(project_id, &healthy, &[], &[], &pages, None));
        assert!(!opportunities.iter().any(|item| item.rule_id == 1));
    }

    #[test]
    fn rule_two_hits_when_keyword_and_topic_page_are_missing() {
        let project_id = project();
        let pages = vec![page(
            project_id,
            "https://example.com/about",
            SitePageRole::About,
            true,
        )];
        let metrics = vec![metric(
            project_id,
            "除尘器防爆合格证怎么办",
            SearchSurface::WebSearch,
            Some("https://example.com/qualification"),
            640,
            9,
            0.014,
            None,
            "2026-09-30",
        )];
        let opportunities =
            build_search_opportunities(input(project_id, &metrics, &[], &[], &pages, None));
        assert!(opportunities.iter().any(|item| item.rule_id == 2));

        let keywords = vec![keyword(
            project_id,
            "除尘器防爆合格证怎么办",
            KeywordKind::Question,
        )];
        let opportunities =
            build_search_opportunities(input(project_id, &metrics, &[], &keywords, &pages, None));
        assert!(!opportunities.iter().any(|item| item.rule_id == 2));
    }

    #[test]
    fn rule_three_hits_when_web_clicks_exist_but_ai_citations_are_zero_or_missing() {
        let project_id = project();
        let pages = vec![page(
            project_id,
            "https://example.com/news",
            SitePageRole::News,
            true,
        )];
        let metrics = vec![
            metric(
                project_id,
                "锅炉烟气除尘改造",
                SearchSurface::WebSearch,
                Some("https://example.com/news"),
                890,
                41,
                0.046,
                None,
                "2026-09-30",
            ),
            metric(
                project_id,
                "锅炉烟气除尘改造",
                SearchSurface::AiAnswer,
                Some("https://example.com/news"),
                96,
                3,
                0.031,
                Some(0),
                "2026-09-30",
            ),
        ];
        let opportunities =
            build_search_opportunities(input(project_id, &metrics, &[], &[], &pages, None));
        assert!(opportunities.iter().any(|item| item.rule_id == 3));

        let mut cited = metrics.clone();
        cited[1].citations = Some(12);
        let opportunities =
            build_search_opportunities(input(project_id, &cited, &[], &[], &pages, None));
        assert!(!opportunities.iter().any(|item| item.rule_id == 3));

        let web_only = vec![metrics[0].clone()];
        let opportunities =
            build_search_opportunities(input(project_id, &web_only, &[], &[], &pages, None));
        assert!(!opportunities.iter().any(|item| item.rule_id == 3));
    }

    #[test]
    fn rule_four_hits_when_traffic_is_on_other_pages_and_home_product_are_empty() {
        let project_id = project();
        let pages = vec![
            page(project_id, "https://example.com/", SitePageRole::Home, true),
            page(
                project_id,
                "https://example.com/products",
                SitePageRole::Product,
                true,
            ),
            page(
                project_id,
                "https://example.com/news",
                SitePageRole::Other,
                true,
            ),
        ];
        let metrics = vec![
            metric(
                project_id,
                "方案",
                SearchSurface::WebSearch,
                Some("https://example.com/news"),
                800,
                20,
                0.025,
                None,
                "2026-09-30",
            ),
            metric(
                project_id,
                "改造",
                SearchSurface::WebSearch,
                Some("https://example.com/news"),
                200,
                5,
                0.025,
                None,
                "2026-09-30",
            ),
        ];
        let opportunities =
            build_search_opportunities(input(project_id, &metrics, &[], &[], &pages, None));
        assert!(opportunities.iter().any(|item| item.rule_id == 4));

        let mut with_home = metrics.clone();
        with_home.push(metric(
            project_id,
            "品牌",
            SearchSurface::WebSearch,
            Some("https://example.com/"),
            100,
            5,
            0.05,
            None,
            "2026-09-30",
        ));
        let opportunities =
            build_search_opportunities(input(project_id, &with_home, &[], &[], &pages, None));
        assert!(!opportunities.iter().any(|item| item.rule_id == 4));

        let no_page_traffic = vec![metric(
            project_id,
            "方案",
            SearchSurface::WebSearch,
            None,
            800,
            20,
            0.025,
            None,
            "2026-09-30",
        )];
        let opportunities =
            build_search_opportunities(input(project_id, &no_page_traffic, &[], &[], &pages, None));
        assert!(!opportunities.iter().any(|item| item.rule_id == 4));
    }

    #[test]
    fn rule_five_hits_only_for_uncrawlable_pages_with_demand() {
        let project_id = project();
        let blocked = vec![page(
            project_id,
            "https://example.com/service",
            SitePageRole::Service,
            false,
        )];
        let metrics = vec![metric(
            project_id,
            "滤筒更换周期",
            SearchSurface::WebSearch,
            Some("https://example.com/service"),
            410,
            21,
            0.051,
            None,
            "2026-09-30",
        )];
        let opportunities =
            build_search_opportunities(input(project_id, &metrics, &[], &[], &blocked, None));
        assert!(opportunities.iter().any(|item| item.rule_id == 5));

        let crawlable = vec![page(
            project_id,
            "https://example.com/service",
            SitePageRole::Service,
            true,
        )];
        let opportunities =
            build_search_opportunities(input(project_id, &metrics, &[], &[], &crawlable, None));
        assert!(!opportunities.iter().any(|item| item.rule_id == 5));
    }

    #[test]
    fn rule_six_hits_only_when_brand_volume_and_coverage_diverge() {
        let project_id = project();
        let keywords = vec![keyword(
            project_id,
            "澜舟除尘设备怎么样",
            KeywordKind::Brand,
        )];
        let metrics = vec![
            metric(
                project_id,
                "澜舟除尘设备怎么样",
                SearchSurface::AiAnswer,
                None,
                100,
                10,
                0.1,
                Some(20),
                "2026-08-31",
            ),
            metric(
                project_id,
                "澜舟除尘设备怎么样",
                SearchSurface::AiAnswer,
                None,
                200,
                20,
                0.1,
                Some(40),
                "2026-09-30",
            ),
        ];
        let diverging = previous_overview(project_id, 0.5, 0.4);
        let opportunities = build_search_opportunities(input(
            project_id,
            &metrics,
            &[],
            &keywords,
            &[],
            Some(&diverging),
        ));
        assert!(opportunities.iter().any(|item| item.rule_id == 6));

        let same_direction = previous_overview(project_id, 0.4, 0.5);
        let opportunities = build_search_opportunities(input(
            project_id,
            &metrics,
            &[],
            &keywords,
            &[],
            Some(&same_direction),
        ));
        assert!(!opportunities.iter().any(|item| item.rule_id == 6));

        let opportunities =
            build_search_opportunities(input(project_id, &metrics, &[], &keywords, &[], None));
        assert!(!opportunities.iter().any(|item| item.rule_id == 6));
    }

    #[test]
    fn repeated_calls_are_deterministic_and_deduplicated() {
        let project_id = project();
        let pages = vec![page(
            project_id,
            "https://example.com/service",
            SitePageRole::Service,
            false,
        )];
        let metrics = vec![
            metric(
                project_id,
                "工业除尘器",
                SearchSurface::WebSearch,
                Some("https://example.com/service"),
                1_000,
                5,
                0.005,
                None,
                "2026-09-30",
            ),
            metric(
                project_id,
                "冷门需求词",
                SearchSurface::WebSearch,
                None,
                300,
                3,
                0.01,
                None,
                "2026-09-30",
            ),
        ];
        let first = build_search_opportunities(input(project_id, &metrics, &[], &[], &pages, None));
        let second =
            build_search_opportunities(input(project_id, &metrics, &[], &[], &pages, None));
        assert_eq!(first, second);
        assert!(!first.is_empty());

        let mut keys: Vec<_> = first
            .iter()
            .map(|item| (item.rule_id, item.title_key.clone(), item.basis.clone()))
            .collect();
        let before = keys.len();
        keys.sort();
        keys.dedup();
        assert_eq!(before, keys.len());
    }
}

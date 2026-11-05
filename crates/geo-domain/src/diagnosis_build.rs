//! M5 诊断快照的领域纯函数：从解析结果 / 核查问题 / 引擎汇总算出四份快照。
//!
//! 🔴 本模块不读库、不调模型；DB 读写与快照落盘在 `InsightService`。
//! 口径是**本轮先落地的最小闭环**，权重与阈值集中在本文件顶部，后续按产品裁定调整时
//! 只改常量并补测试（不散落在服务层）。

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use chrono::{DateTime, Utc};

use crate::collection::Sentiment;
use crate::collection::{CollectionRecord, CollectionRound, EngineId, EngineRun, RoundStatus};
use crate::diagnosis::{
    AlertItem, AlertKind, AlertSeverity, CompetitorMatrix, CompetitorMatrixRow, DiagnosisDimension,
    DiagnosisOverview, DimensionScore, EngineScore, FunnelRow, FunnelStage, IntentFunnel,
    TrendPoint,
};
use crate::insight::{AnswerInsight, BrandRole, FactCheckIssue, FactIssueStatus};
use crate::prompt::{sample_size_grade, IntentCategory};

/// 五维权重（合计 1.0）。Visibility / Recommendation / Sentiment / FactAccuracy / SourceHealth。
pub const DIMENSION_WEIGHTS: [f64; 5] = [0.30, 0.20, 0.15, 0.25, 0.10];
/// 引用域名数达到该值即拿满 SourceHealth 分。
pub const CITATION_BREADTH_TARGET: f64 = 20.0;
/// 覆盖率较上轮下降达到该值触发告警。
pub const COVERAGE_DROP_THRESHOLD: f64 = 0.10;
/// 事实准确率低于该值触发告警。
pub const FACT_ACCURACY_FLOOR: f64 = 0.90;
/// 负面提及占比高于该值触发告警。
pub const NEGATIVE_RATE_CEILING: f64 = 0.20;
/// 竞品覆盖率领先本品牌达到该值触发反超告警。
pub const OVERTAKE_MARGIN: f64 = 0.05;

pub struct DiagnosisInput<'a> {
    pub round: &'a CollectionRound,
    pub self_brand: &'a str,
    pub records: &'a [CollectionRecord],
    pub insights: &'a [AnswerInsight],
    pub issues: &'a [FactCheckIssue],
    pub citation_domains: &'a [String],
    pub competitors: &'a [String],
    pub engine_runs: &'a [EngineRun],
    pub previous: Option<&'a DiagnosisOverview>,
    pub previous_matrix: Option<&'a CompetitorMatrix>,
    pub now: DateTime<Utc>,
}

pub struct DiagnosisOutput {
    pub overview: DiagnosisOverview,
    pub competitors: CompetitorMatrix,
    pub funnel: IntentFunnel,
    pub engines: Vec<EngineScore>,
}

pub fn build_diagnosis(input: DiagnosisInput<'_>) -> DiagnosisOutput {
    let total_prompts = distinct_prompts(input.insights);
    let sample_size = i64::try_from(total_prompts.len()).unwrap_or(i64::MAX);
    let self_prompts = prompts_where_self_mentioned(input.insights);
    let brand_coverage = ratio(self_prompts.len(), total_prompts.len());
    let share_of_voice = share_of_voice(input.insights, input.self_brand, input.competitors);
    let fact_accuracy = fact_accuracy(input.insights.len(), input.issues);
    let distinct_domains = input
        .citation_domains
        .iter()
        .map(|domain| domain.trim().to_lowercase())
        .filter(|domain| !domain.is_empty())
        .collect::<HashSet<_>>()
        .len();

    let (_top1, top3, mentioned) = self_rank_counts(input.insights);
    let (positive, negative, with_sentiment) = self_sentiment_counts(input.insights);
    let dimensions = dimension_scores(
        brand_coverage,
        ratio(top3, mentioned),
        ratio(positive, with_sentiment),
        fact_accuracy,
        distinct_domains,
        sample_size,
        total_prompts.len(),
        self_prompts.len(),
        top3,
        mentioned,
        positive,
        effective_issue_count(input.issues),
        input.insights.len(),
        distinct_domains,
    );
    let total_score: f64 = dimensions
        .iter()
        .map(|dimension| dimension.score * dimension.weight)
        .sum();
    let score_margin = input
        .previous
        .map(|previous| total_score - previous.total_score)
        .unwrap_or(0.0);
    let brand_coverage_margin = input
        .previous
        .map(|previous| brand_coverage - previous.brand_coverage)
        .unwrap_or(0.0);
    let collected_at = input
        .round
        .finished_at
        .or(input.round.started_at)
        .unwrap_or(input.now);

    let mut trend = input
        .previous
        .map(|previous| previous.trend.clone())
        .unwrap_or_default();
    if trend.is_empty() {
        if let Some(previous) = input.previous {
            trend.push(TrendPoint {
                round_id: previous.round_id.clone(),
                round_label: previous.round_label.clone(),
                collected_at: previous.collected_at,
                status: RoundStatus::Succeeded,
                brand_coverage: previous.brand_coverage,
                coverage_margin: previous.brand_coverage_margin,
                total_score: previous.total_score,
                fact_accuracy: previous.fact_accuracy,
                sample_size: previous.sample_size,
            });
        }
    }
    trend.retain(|point| point.round_id != input.round.id);
    trend.push(TrendPoint {
        round_id: input.round.id.clone(),
        round_label: input.round.label.clone(),
        collected_at,
        status: input.round.status,
        brand_coverage,
        coverage_margin: brand_coverage_margin,
        total_score,
        fact_accuracy,
        sample_size,
    });
    if trend.len() > 12 {
        trend = trend.split_off(trend.len() - 12);
    }

    let competitor_matrix = build_competitors(&input, sample_size, brand_coverage);
    let negative_rate = ratio(negative, with_sentiment);
    let alerts = build_alerts(
        &input,
        brand_coverage,
        total_score,
        fact_accuracy,
        negative_rate,
        &competitor_matrix,
    );

    DiagnosisOutput {
        overview: DiagnosisOverview {
            project_id: input.round.project_id.clone(),
            round_id: input.round.id.clone(),
            round_label: input.round.label.clone(),
            collected_at,
            total_score,
            score_margin,
            sample_size,
            sample_size_grade: sample_size_grade(total_prompts.len()),
            dimensions,
            brand_coverage,
            brand_coverage_margin,
            share_of_voice,
            fact_accuracy,
            distinct_cited_domains: i64::try_from(distinct_domains).unwrap_or(i64::MAX),
            trend,
            alerts,
            metric_spec_version: input.round.metric_spec_version.clone(),
        },
        competitors: competitor_matrix,
        funnel: build_funnel(&input, &total_prompts),
        engines: build_engines(&input),
    }
}

fn distinct_prompts(insights: &[AnswerInsight]) -> BTreeSet<String> {
    insights
        .iter()
        .map(|insight| insight.prompt_id.clone())
        .collect()
}

fn prompts_where_self_mentioned(insights: &[AnswerInsight]) -> BTreeSet<String> {
    insights
        .iter()
        .filter(|insight| insight.self_mentioned)
        .map(|insight| insight.prompt_id.clone())
        .collect()
}

fn effective_issue_count(issues: &[FactCheckIssue]) -> usize {
    issues
        .iter()
        .filter(|issue| issue.status != FactIssueStatus::FalsePositive)
        .count()
}

fn fact_accuracy(checked: usize, issues: &[FactCheckIssue]) -> f64 {
    if checked == 0 {
        return 0.0;
    }
    (1.0 - effective_issue_count(issues) as f64 / checked as f64).clamp(0.0, 1.0)
}

fn ratio(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        numerator as f64 / denominator as f64
    }
}

fn self_rank_counts(insights: &[AnswerInsight]) -> (usize, usize, usize) {
    let mentioned = insights
        .iter()
        .filter(|insight| insight.self_mentioned)
        .count();
    let top1 = insights
        .iter()
        .filter(|insight| insight.self_mentioned && insight.self_rank == Some(1))
        .count();
    let top3 = insights
        .iter()
        .filter(|insight| insight.self_mentioned && insight.self_rank.is_some_and(|rank| rank <= 3))
        .count();
    (top1, top3, mentioned)
}

fn self_sentiment_counts(insights: &[AnswerInsight]) -> (usize, usize, usize) {
    let with_sentiment = insights
        .iter()
        .filter(|insight| insight.self_mentioned && insight.self_sentiment.is_some())
        .count();
    let positive = insights
        .iter()
        .filter(|insight| {
            insight.self_mentioned && insight.self_sentiment == Some(Sentiment::Positive)
        })
        .count();
    let negative = insights
        .iter()
        .filter(|insight| {
            insight.self_mentioned && insight.self_sentiment == Some(Sentiment::Negative)
        })
        .count();
    (positive, negative, with_sentiment)
}

fn mention_weight(insight: &AnswerInsight, brand: &str, is_self: bool) -> i64 {
    let matching = insight
        .mentions
        .iter()
        .filter(|mention| {
            if is_self {
                mention.role == BrandRole::Self_
            } else {
                mention.brand.eq_ignore_ascii_case(brand)
            }
        })
        .map(|mention| i64::from(mention.count.max(1)))
        .sum::<i64>();
    if matching > 0 {
        return matching;
    }
    if is_self && insight.self_mentioned {
        1
    } else {
        0
    }
}

fn share_of_voice(insights: &[AnswerInsight], self_brand: &str, competitors: &[String]) -> f64 {
    let self_mentions: i64 = insights
        .iter()
        .map(|insight| mention_weight(insight, self_brand, true))
        .sum();
    let competitor_mentions: i64 = competitors
        .iter()
        .map(|brand| {
            insights
                .iter()
                .map(|insight| mention_weight(insight, brand, false))
                .sum::<i64>()
        })
        .sum();
    let total = self_mentions + competitor_mentions;
    if total == 0 {
        0.0
    } else {
        self_mentions as f64 / total as f64
    }
}

#[allow(clippy::too_many_arguments)]
fn dimension_scores(
    coverage: f64,
    top3_rate: f64,
    positive_rate: f64,
    fact_accuracy: f64,
    distinct_domains: usize,
    sample_size: i64,
    total_prompts: usize,
    covered_prompts: usize,
    top3: usize,
    mentioned: usize,
    positive: usize,
    issue_count: usize,
    checked: usize,
    domains: usize,
) -> Vec<DimensionScore> {
    let source_score = (domains as f64 / CITATION_BREADTH_TARGET).clamp(0.0, 1.0);
    vec![
        DimensionScore {
            dimension: DiagnosisDimension::Visibility,
            score: coverage * 100.0,
            weight: DIMENSION_WEIGHTS[0],
            sample_size,
            detail: format!("{covered_prompts} / {total_prompts}"),
        },
        DimensionScore {
            dimension: DiagnosisDimension::Recommendation,
            score: top3_rate * 100.0,
            weight: DIMENSION_WEIGHTS[1],
            sample_size,
            detail: format!("{top3} / {mentioned}"),
        },
        DimensionScore {
            dimension: DiagnosisDimension::Sentiment,
            score: positive_rate * 100.0,
            weight: DIMENSION_WEIGHTS[2],
            sample_size,
            detail: format!("{positive} / {mentioned}"),
        },
        DimensionScore {
            dimension: DiagnosisDimension::FactAccuracy,
            score: fact_accuracy * 100.0,
            weight: DIMENSION_WEIGHTS[3],
            sample_size,
            detail: format!("{issue_count} / {checked}"),
        },
        DimensionScore {
            dimension: DiagnosisDimension::SourceHealth,
            score: source_score * 100.0,
            weight: DIMENSION_WEIGHTS[4],
            sample_size,
            detail: format!("{distinct_domains}"),
        },
    ]
}

fn build_competitors(
    input: &DiagnosisInput<'_>,
    sample_size: i64,
    self_coverage: f64,
) -> CompetitorMatrix {
    let total_prompts = distinct_prompts(input.insights);
    let mut brands: Vec<String> = input.competitors.to_vec();
    brands.sort();
    brands.dedup();
    let mut rows = Vec::new();
    let self_row = row_for_brand(input, input.self_brand, true, self_coverage);
    rows.push(self_row);
    for brand in brands {
        let coverage = coverage_for_brand(input.insights, &brand, &total_prompts);
        rows.push(row_for_brand(input, &brand, false, coverage));
    }
    rows.sort_by(|left, right| {
        right
            .is_self
            .cmp(&left.is_self)
            .then_with(|| right.coverage.total_cmp(&left.coverage))
            .then_with(|| left.brand.cmp(&right.brand))
    });
    let self_prompts = prompts_where_self_mentioned(input.insights);
    let head_to_head = input
        .insights
        .iter()
        .filter(|insight| insight.self_mentioned)
        .filter(|insight| {
            input
                .competitors
                .iter()
                .any(|brand| mention_weight(insight, brand, false) > 0)
        })
        .map(|insight| insight.prompt_id.as_str())
        .collect::<HashSet<_>>()
        .len();
    let _ = self_prompts;
    CompetitorMatrix {
        round_id: input.round.id.clone(),
        sample_size,
        head_to_head_prompt_count: i64::try_from(head_to_head).unwrap_or(i64::MAX),
        rows,
    }
}

fn coverage_for_brand(
    insights: &[AnswerInsight],
    brand: &str,
    total_prompts: &BTreeSet<String>,
) -> f64 {
    let prompts = insights
        .iter()
        .filter(|insight| mention_weight(insight, brand, false) > 0)
        .map(|insight| insight.prompt_id.as_str())
        .collect::<HashSet<_>>()
        .len();
    ratio(prompts, total_prompts.len())
}

fn row_for_brand(
    input: &DiagnosisInput<'_>,
    brand: &str,
    is_self: bool,
    coverage: f64,
) -> CompetitorMatrixRow {
    let appearances: Vec<(&AnswerInsight, Option<i32>, Option<Sentiment>)> = input
        .insights
        .iter()
        .filter_map(|insight| {
            if is_self {
                insight.self_mentioned.then_some((
                    insight,
                    insight.self_rank,
                    insight.self_sentiment,
                ))
            } else {
                insight
                    .mentions
                    .iter()
                    .find(|mention| mention.brand.eq_ignore_ascii_case(brand))
                    .map(|mention| (insight, mention.rank, Some(mention.sentiment)))
            }
        })
        .collect();
    let mentioned = appearances.len();
    let rank_of = |target: i32| {
        appearances
            .iter()
            .filter(|(_, rank, _)| *rank == Some(target))
            .count()
    };
    let mention_only = appearances
        .iter()
        .filter(|(_, rank, _)| rank.is_none())
        .count();
    let positive = appearances
        .iter()
        .filter(|(_, _, sentiment)| *sentiment == Some(Sentiment::Positive))
        .count();
    let negative = appearances
        .iter()
        .filter(|(_, _, sentiment)| *sentiment == Some(Sentiment::Negative))
        .count();
    let total_mentions: i64 = input
        .insights
        .iter()
        .map(|insight| mention_weight(insight, brand, is_self))
        .sum();
    let self_mentions: i64 = input
        .insights
        .iter()
        .map(|insight| mention_weight(insight, input.self_brand, true))
        .sum();
    let competitor_mentions: i64 = input
        .competitors
        .iter()
        .map(|brand| {
            input
                .insights
                .iter()
                .map(|insight| mention_weight(insight, brand, false))
                .sum::<i64>()
        })
        .sum();
    let denominators = self_mentions + competitor_mentions;
    CompetitorMatrixRow {
        brand: brand.to_string(),
        is_self,
        coverage,
        share_of_voice: if denominators == 0 {
            0.0
        } else {
            total_mentions as f64 / denominators as f64
        },
        top1_rate: ratio(rank_of(1), mentioned),
        top3_rate: ratio(rank_of(1) + rank_of(2) + rank_of(3), mentioned),
        mention_only_rate: ratio(mention_only, mentioned),
        positive_rate: ratio(positive, mentioned),
        negative_rate: ratio(negative, mentioned),
        fact_error_count: if is_self {
            i64::try_from(effective_issue_count(input.issues)).unwrap_or(i64::MAX)
        } else {
            0
        },
        cited_domain_count: if is_self {
            i64::try_from(input.citation_domains.len()).unwrap_or(i64::MAX)
        } else {
            0
        },
    }
}

fn build_funnel(input: &DiagnosisInput<'_>, total_prompts: &BTreeSet<String>) -> IntentFunnel {
    let intent_of: HashMap<&str, IntentCategory> = input
        .records
        .iter()
        .map(|record| (record.prompt_id.as_str(), record.intent))
        .collect();
    let mut by_stage: BTreeMap<FunnelStage, (BTreeSet<&str>, BTreeSet<&str>)> = BTreeMap::new();
    for prompt_id in total_prompts {
        let intent = intent_of
            .get(prompt_id.as_str())
            .copied()
            .unwrap_or(IntentCategory::CategoryAwareness);
        let stage = stage_of(intent);
        by_stage
            .entry(stage)
            .or_default()
            .0
            .insert(prompt_id.as_str());
    }
    for insight in input.insights {
        if !insight.self_mentioned {
            continue;
        }
        let intent = intent_of
            .get(insight.prompt_id.as_str())
            .copied()
            .unwrap_or(IntentCategory::CategoryAwareness);
        let stage = stage_of(intent);
        let entry = by_stage.entry(stage).or_default();
        entry.1.insert(insight.prompt_id.as_str());
    }
    let mut rows = Vec::new();
    let mut notes = Vec::new();
    let empty = (BTreeSet::new(), BTreeSet::new());
    for stage in [
        FunnelStage::Awareness,
        FunnelStage::Recommendation,
        FunnelStage::Decision,
    ] {
        let (prompts, covered) = by_stage.get(&stage).unwrap_or(&empty);
        let top3_prompts: BTreeSet<&str> = input
            .insights
            .iter()
            .filter(|insight| {
                insight.self_mentioned && insight.self_rank.is_some_and(|rank| rank <= 3)
            })
            .filter(|insight| {
                stage_of(
                    intent_of
                        .get(insight.prompt_id.as_str())
                        .copied()
                        .unwrap_or(IntentCategory::CategoryAwareness),
                ) == stage
            })
            .map(|insight| insight.prompt_id.as_str())
            .collect();
        let mention_rate = ratio(covered.len(), prompts.len());
        let top3_rate = ratio(top3_prompts.len(), prompts.len());
        notes.push(format!(
            "{} {:.2}/{:.2}",
            stage.as_str(),
            mention_rate,
            top3_rate
        ));
        rows.push(FunnelRow {
            stage,
            prompt_count: i64::try_from(prompts.len()).unwrap_or(i64::MAX),
            mention_rate,
            top3_rate,
        });
    }
    IntentFunnel {
        round_id: input.round.id.clone(),
        rows,
        diagnosis_note: notes.join("; "),
    }
}

fn stage_of(intent: IntentCategory) -> FunnelStage {
    match intent {
        IntentCategory::CategoryAwareness | IntentCategory::ProfessionalLongTail => {
            FunnelStage::Awareness
        }
        IntentCategory::PurchaseRecommendation | IntentCategory::BrandComparison => {
            FunnelStage::Recommendation
        }
        IntentCategory::PricingPlan
        | IntentCategory::LocalService
        | IntentCategory::AfterSalesReputation => FunnelStage::Decision,
    }
}

fn build_engines(input: &DiagnosisInput<'_>) -> Vec<EngineScore> {
    let mut engines = Vec::new();
    for engine in &input.round.engine_scope {
        let insights: Vec<&AnswerInsight> = input
            .insights
            .iter()
            .filter(|insight| insight.engine == *engine)
            .collect();
        let prompts = distinct_prompts(
            &insights
                .iter()
                .map(|insight| (*insight).clone())
                .collect::<Vec<_>>(),
        );
        let covered = prompts_where_self_mentioned(
            &insights
                .iter()
                .map(|insight| (*insight).clone())
                .collect::<Vec<_>>(),
        );
        let mentioned = insights
            .iter()
            .filter(|insight| insight.self_mentioned)
            .count();
        let top3 = insights
            .iter()
            .filter(|insight| {
                insight.self_mentioned && insight.self_rank.is_some_and(|rank| rank <= 3)
            })
            .count();
        let positive = insights
            .iter()
            .filter(|insight| {
                insight.self_mentioned && insight.self_sentiment == Some(Sentiment::Positive)
            })
            .count();
        let issues = input
            .issues
            .iter()
            .filter(|issue| issue.engine == *engine)
            .count();
        let run = input.engine_runs.iter().find(|run| run.engine == *engine);
        engines.push(EngineScore {
            engine: *engine,
            sample_size: i64::try_from(insights.len()).unwrap_or(i64::MAX),
            coverage: ratio(covered.len(), prompts.len()),
            top3_rate: ratio(top3, mentioned),
            positive_rate: ratio(positive, mentioned),
            fact_error_rate: ratio(issues, insights.len()),
            success_rate: run
                .map(|run| {
                    let planned = run.succeeded + run.failed;
                    if planned <= 0 {
                        0.0
                    } else {
                        f64::from(run.succeeded) / f64::from(planned)
                    }
                })
                .unwrap_or(0.0),
            avg_latency_ms: run.map(|run| run.avg_latency_ms).unwrap_or(0),
        });
    }
    engines
}

fn build_alerts(
    input: &DiagnosisInput<'_>,
    coverage: f64,
    _total_score: f64,
    fact_accuracy: f64,
    negative_rate: f64,
    matrix: &CompetitorMatrix,
) -> Vec<AlertItem> {
    let mut alerts = Vec::new();
    let make = |kind: AlertKind,
                severity: AlertSeverity,
                engine: Option<EngineId>,
                metric: &str,
                delta: Option<f64>,
                detail: String| AlertItem {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: input.round.project_id.clone(),
        round_id: input.round.id.clone(),
        kind,
        severity,
        engine,
        metric: metric.to_string(),
        delta,
        detail,
        acknowledged: false,
        raised_at: input.now,
    };
    if let Some(previous) = input.previous {
        let drop = previous.brand_coverage - coverage;
        if drop >= COVERAGE_DROP_THRESHOLD {
            alerts.push(make(
                AlertKind::CoverageDrop,
                AlertSeverity::Warning,
                None,
                "brand_coverage",
                Some(-drop * 100.0),
                format!("{:.2} -> {:.2}", previous.brand_coverage, coverage),
            ));
        }
    }
    if fact_accuracy < FACT_ACCURACY_FLOOR {
        alerts.push(make(
            AlertKind::FactError,
            AlertSeverity::Warning,
            None,
            "fact_error_count",
            None,
            format!("fact_accuracy={fact_accuracy:.2}"),
        ));
    }
    if negative_rate > NEGATIVE_RATE_CEILING {
        alerts.push(make(
            AlertKind::NegativeSentiment,
            AlertSeverity::Warning,
            None,
            "negative_rate",
            None,
            format!("negative_rate={negative_rate:.2}"),
        ));
    }
    if let Some(previous) = input.previous_matrix {
        let self_coverage = matrix
            .rows
            .iter()
            .find(|row| row.is_self)
            .map(|row| row.coverage)
            .unwrap_or(coverage);
        for row in matrix.rows.iter().filter(|row| !row.is_self) {
            let was_behind = previous
                .rows
                .iter()
                .find(|previous_row| previous_row.brand == row.brand)
                .map(|previous_row| previous_row.coverage < self_coverage)
                .unwrap_or(false);
            if was_behind && row.coverage >= self_coverage + OVERTAKE_MARGIN {
                alerts.push(make(
                    AlertKind::CompetitorOvertake,
                    AlertSeverity::Critical,
                    None,
                    "brand_coverage",
                    Some((row.coverage - self_coverage) * 100.0),
                    row.brand.clone(),
                ));
            }
        }
    }
    alerts
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnosis::{AlertKind, CompetitorMatrixRow};
    use crate::prompt::SampleSizeGrade;

    fn round() -> CollectionRound {
        CollectionRound {
            id: "round-2".to_string(),
            project_id: "11111111-1111-4111-8111-111111111111".to_string(),
            prompt_set_id: "set".to_string(),
            prompt_set_label: "题库".to_string(),
            prompt_set_version: 1,
            label: "第 2 轮".to_string(),
            round_index: 2,
            status: RoundStatus::Succeeded,
            engine_scope: vec![EngineId::Deepseek],
            repeat_count: 1,
            planned_queries: 1,
            completed_queries: 1,
            failed_queries: 0,
            success_rate: 1.0,
            started_at: Some(Utc::now()),
            finished_at: Some(Utc::now()),
            metric_spec_version: "geo-metrics-v1".to_string(),
            sample_size_grade: SampleSizeGrade::Insufficient,
            notes: None,
        }
    }

    fn previous_overview() -> DiagnosisOverview {
        DiagnosisOverview {
            project_id: round().project_id,
            round_id: "round-1".to_string(),
            round_label: "第 1 轮".to_string(),
            collected_at: Utc::now(),
            total_score: 70.0,
            score_margin: 0.0,
            sample_size: 10,
            sample_size_grade: SampleSizeGrade::Insufficient,
            dimensions: Vec::new(),
            brand_coverage: 0.80,
            brand_coverage_margin: 0.0,
            share_of_voice: 0.5,
            fact_accuracy: 0.95,
            distinct_cited_domains: 5,
            trend: Vec::new(),
            alerts: Vec::new(),
            metric_spec_version: "geo-metrics-v1".to_string(),
        }
    }

    fn matrix(self_coverage: f64, competitor_coverage: f64) -> CompetitorMatrix {
        CompetitorMatrix {
            round_id: "round-1".to_string(),
            sample_size: 10,
            head_to_head_prompt_count: 5,
            rows: vec![
                CompetitorMatrixRow {
                    brand: "本品牌".to_string(),
                    is_self: true,
                    coverage: self_coverage,
                    share_of_voice: 0.5,
                    top1_rate: 0.1,
                    top3_rate: 0.3,
                    mention_only_rate: 0.5,
                    positive_rate: 0.6,
                    negative_rate: 0.1,
                    fact_error_count: 0,
                    cited_domain_count: 5,
                },
                CompetitorMatrixRow {
                    brand: "南方泵业".to_string(),
                    is_self: false,
                    coverage: competitor_coverage,
                    share_of_voice: 0.3,
                    top1_rate: 0.2,
                    top3_rate: 0.4,
                    mention_only_rate: 0.4,
                    positive_rate: 0.7,
                    negative_rate: 0.05,
                    fact_error_count: 0,
                    cited_domain_count: 0,
                },
            ],
        }
    }

    #[test]
    fn dimension_weights_sum_to_one() {
        let sum: f64 = DIMENSION_WEIGHTS.iter().sum();
        assert!((sum - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn coverage_drop_and_competitor_overtake_raise_alerts() {
        let round = round();
        let previous = previous_overview();
        let previous_matrix = matrix(0.80, 0.50);
        let current_matrix = matrix(0.60, 0.70);
        let input = DiagnosisInput {
            round: &round,
            self_brand: "本品牌",
            records: &[],
            insights: &[],
            issues: &[],
            citation_domains: &[],
            competitors: &["南方泵业".to_string()],
            engine_runs: &[],
            previous: Some(&previous),
            previous_matrix: Some(&previous_matrix),
            now: Utc::now(),
        };
        let alerts = build_alerts(&input, 0.60, 60.0, 1.0, 0.0, &current_matrix);
        assert!(alerts
            .iter()
            .any(|alert| alert.kind == AlertKind::CoverageDrop));
        assert!(alerts
            .iter()
            .any(|alert| alert.kind == AlertKind::CompetitorOvertake));
    }
}

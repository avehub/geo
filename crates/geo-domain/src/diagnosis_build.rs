//! M5 诊断快照的领域纯函数：从解析结果 / 核查问题 / 引擎汇总算出四份快照。
//!
//! 🔴 本模块不读库、不调模型；DB 读写与快照落盘在 `InsightService`。
//! 口径是**本轮先落地的最小闭环**，权重与阈值集中在本文件顶部，后续按产品裁定调整时
//! 只改常量并补测试（不散落在服务层）。

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use chrono::{DateTime, Utc};

use crate::collection::Sentiment;
use crate::collection::{
    Citation, CollectionRecord, CollectionRound, EngineId, EngineRun, RoundStatus, SourceType,
};
use crate::diagnosis::{
    AlertItem, AlertKind, AlertSeverity, CompetitorMatrix, CompetitorMatrixRow, DiagnosisDimension,
    DiagnosisOverview, DimensionScore, EngineScore, FunnelRow, FunnelStage, IntentFunnel,
    TrendPoint,
};
use crate::insight::{AnswerInsight, BrandRole, FactCheckIssue, FactIssueStatus};
use crate::prompt::{sample_size_grade, IntentCategory};

/// 五维权重（合计 1.0）。Visibility / Recommendation / Sentiment / FactAccuracy / SourceHealth。
/// 与产品定义附录 C 一致：0.35 / 0.25 / 0.15 / 0.15 / 0.10。
pub const DIMENSION_WEIGHTS: [f64; 5] = [0.35, 0.25, 0.15, 0.15, 0.10];
/// 引用域名数达到该值即拿满 SourceHealth 的域名分。
///
/// 与 demo 基线轮的手算口径对齐：47 个去重域名 ≈ 0.78 归一化，配合 31% 的
/// 自有页 / 权威源占比得到约 50 分（0.31×60 + 47/60×40）。
pub const CITATION_BREADTH_TARGET: f64 = 60.0;
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
    pub citations: &'a [Citation],
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
    let self_answers = input
        .insights
        .iter()
        .filter(|insight| insight.self_mentioned)
        .count();
    let fact_accuracy = fact_accuracy(self_answers, input.issues);
    let citation_count = input.citations.len();
    let authoritative = input
        .citations
        .iter()
        .filter(|citation| is_authoritative(citation.source_type))
        .count();
    let authority_share = ratio(authoritative, citation_count);
    let distinct_domains = distinct_citation_domains(input.citations);
    let domain_breadth = (distinct_domains as f64 / CITATION_BREADTH_TARGET).clamp(0.0, 1.0);
    let source_health = authority_share * 60.0 + domain_breadth * 40.0;

    let (top1, top23, mention_only, _mentioned) = self_rank_prompt_counts(input.insights);
    let recommendation_rate = ratio_f64(
        top1 as f64 + top23 as f64 * 0.7 + mention_only as f64 * 0.3,
        total_prompts.len(),
    );
    let (positive, negative, with_sentiment) = self_sentiment_counts(input.insights);
    let positive_rate = ratio(positive, with_sentiment);
    let negative_rate = ratio(negative, with_sentiment);
    let (dimensions, dimension_margins) = dimension_scores(
        brand_coverage,
        recommendation_rate,
        positive_rate,
        negative_rate,
        fact_accuracy,
        source_health,
        total_prompts.len(),
        self_prompts.len(),
        top1,
        top23,
        mention_only,
        positive,
        negative,
        with_sentiment,
        effective_issue_count(input.issues),
        self_answers,
        distinct_domains,
        citation_count,
    );
    let total_score: f64 = dimensions
        .iter()
        .map(|dimension| dimension.score * dimension.weight)
        .sum();
    // margin 是 95% 区间半宽（±），不是与上一轮的差值。
    // 总分区间 = 各维度区间半宽的加权和。
    let score_margin: f64 = dimension_margins
        .iter()
        .zip(DIMENSION_WEIGHTS)
        .map(|(margin, weight)| margin * weight)
        .sum();
    let brand_coverage_margin = wilson_half_width(brand_coverage, total_prompts.len());
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
                coverage_margin: 0.0,
                total_score: previous.total_score,
                fact_accuracy: previous.fact_accuracy,
                sample_size: previous.sample_size,
            });
        }
    }
    // 历史趋势点可能来自旧口径（环比差值）；这里统一按该点自己的覆盖率与样本量
    // 重算 Wilson 半宽，保证趋势图的 ± 语义一致。
    for point in &mut trend {
        let n = usize::try_from(point.sample_size).unwrap_or(0);
        point.coverage_margin = wilson_half_width(point.brand_coverage, n);
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

/// 事实准确的分母是「涉及本品牌的回答数」（`self_mentioned` 的 insight），
/// 不是全部 insight 数。
fn fact_accuracy(self_answers: usize, issues: &[FactCheckIssue]) -> f64 {
    if self_answers == 0 {
        return 0.0;
    }
    (1.0 - effective_issue_count(issues) as f64 / self_answers as f64).clamp(0.0, 1.0)
}

fn ratio(numerator: usize, denominator: usize) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        numerator as f64 / denominator as f64
    }
}

fn ratio_f64(numerator: f64, denominator: usize) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        numerator / denominator as f64
    }
}

/// Wilson 95% 置信区间半宽（z = 1.96），返回 0~1 比例尺度。
///
/// 用于可见度 / 推荐力 / 情感 / 事实准确这类比例型维度。区间在 0 或 1 附近
/// 被截断时按截断后的实际区间计算半宽，避免把「不可能越界」的部分算进误差。
fn wilson_half_width(proportion: f64, n: usize) -> f64 {
    if n == 0 {
        return 0.0;
    }
    let p = proportion.clamp(0.0, 1.0);
    let n = n as f64;
    let z = 1.96_f64;
    let z2 = z * z;
    let denominator = 1.0 + z2 / n;
    let center = (p + z2 / (2.0 * n)) / denominator;
    let half = (z / denominator) * (p * (1.0 - p) / n + z2 / (4.0 * n * n)).max(0.0).sqrt();
    let lower = (center - half).max(0.0);
    let upper = (center + half).min(1.0);
    (upper - lower) / 2.0
}

/// 信源健康没有单一比例分母，按引用条数用 1/√n 做保守近似（0~100 分尺度）。
fn source_health_margin(citation_count: usize) -> f64 {
    if citation_count == 0 {
        0.0
    } else {
        100.0 / (citation_count as f64).sqrt()
    }
}

fn is_authoritative(source_type: SourceType) -> bool {
    matches!(
        source_type,
        SourceType::OwnedPage | SourceType::Baike | SourceType::OfficialDoc | SourceType::NewsMedia
    )
}

fn distinct_citation_domains(citations: &[Citation]) -> usize {
    citations
        .iter()
        .map(|citation| citation.domain.trim().to_lowercase())
        .filter(|domain| !domain.is_empty())
        .collect::<HashSet<_>>()
        .len()
}

/// 推荐力按「题目」而不是按回答条数计：同一道题被多个引擎 / 多次采样提及时只取
/// 最好的位次归档。返回值 `(Top1 题数, 第 2-3 名题数, 仅提及题数, 被提及题数)`。
fn self_rank_prompt_counts(insights: &[AnswerInsight]) -> (usize, usize, usize, usize) {
    #[derive(Default)]
    struct Category {
        top1: bool,
        top23: bool,
    }

    let mut by_prompt: BTreeMap<&str, Category> = BTreeMap::new();
    for insight in insights.iter().filter(|insight| insight.self_mentioned) {
        let category = by_prompt.entry(insight.prompt_id.as_str()).or_default();
        match insight.self_rank {
            Some(1) => category.top1 = true,
            Some(rank) if rank <= 3 => category.top23 = true,
            _ => {}
        }
    }
    let top1 = by_prompt.values().filter(|category| category.top1).count();
    let top23 = by_prompt
        .values()
        .filter(|category| !category.top1 && category.top23)
        .count();
    let mention_only = by_prompt.len() - top1 - top23;
    (top1, top23, mention_only, by_prompt.len())
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
    recommendation_rate: f64,
    positive_rate: f64,
    negative_rate: f64,
    fact_accuracy: f64,
    source_health: f64,
    total_prompts: usize,
    covered_prompts: usize,
    top1: usize,
    top23: usize,
    mention_only: usize,
    positive: usize,
    negative: usize,
    with_sentiment: usize,
    issue_count: usize,
    self_answers: usize,
    domains: usize,
    citation_count: usize,
) -> (Vec<DimensionScore>, [f64; 5]) {
    let sentiment_score = (positive_rate * 100.0 - negative_rate * 50.0).max(0.0);
    let margins = [
        wilson_half_width(coverage, total_prompts) * 100.0,
        wilson_half_width(recommendation_rate, total_prompts) * 100.0,
        wilson_half_width(positive_rate, with_sentiment) * 100.0
            + wilson_half_width(negative_rate, with_sentiment) * 50.0,
        wilson_half_width(fact_accuracy, self_answers) * 100.0,
        source_health_margin(citation_count),
    ];
    let dimensions = vec![
        DimensionScore {
            dimension: DiagnosisDimension::Visibility,
            score: coverage * 100.0,
            weight: DIMENSION_WEIGHTS[0],
            sample_size: i64::try_from(total_prompts).unwrap_or(i64::MAX),
            detail: format!("{covered_prompts} / {total_prompts}"),
        },
        DimensionScore {
            dimension: DiagnosisDimension::Recommendation,
            score: recommendation_rate * 100.0,
            weight: DIMENSION_WEIGHTS[1],
            sample_size: i64::try_from(total_prompts).unwrap_or(i64::MAX),
            detail: format!("{top1} / {top23} / {mention_only} / {total_prompts}"),
        },
        DimensionScore {
            dimension: DiagnosisDimension::Sentiment,
            score: sentiment_score,
            weight: DIMENSION_WEIGHTS[2],
            sample_size: i64::try_from(with_sentiment).unwrap_or(i64::MAX),
            detail: format!("{positive} / {negative} / {with_sentiment}"),
        },
        DimensionScore {
            dimension: DiagnosisDimension::FactAccuracy,
            score: fact_accuracy * 100.0,
            weight: DIMENSION_WEIGHTS[3],
            sample_size: i64::try_from(self_answers).unwrap_or(i64::MAX),
            detail: format!("{issue_count} / {self_answers}"),
        },
        DimensionScore {
            dimension: DiagnosisDimension::SourceHealth,
            score: source_health,
            weight: DIMENSION_WEIGHTS[4],
            sample_size: i64::try_from(citation_count).unwrap_or(i64::MAX),
            detail: format!("{domains}"),
        },
    ];
    (dimensions, margins)
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
            i64::try_from(distinct_citation_domains(input.citations)).unwrap_or(i64::MAX)
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
    use crate::insight::{AnswerShape, CorrectionChannel, FactIssueKind};
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
            citations: &[],
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

    /// demo 基线轮（第 2 轮）的数字：62 道题、26 道提及、Top1 4 / 第 2-3 名 9 /
    /// 仅提及 13、正面 12 / 中性 9 / 负面 5、涉及本品牌回答 168 条、事实问题 27 条、
    /// 自有页与权威源占比 31%、去重域名 47 个。
    fn demo_baseline() -> (
        CollectionRound,
        Vec<AnswerInsight>,
        Vec<FactCheckIssue>,
        Vec<Citation>,
    ) {
        let round = round();
        let mut insights = Vec::new();
        for index in 0..168 {
            let prompt_index = index % 26;
            let (rank, sentiment) = if index < 26 {
                match prompt_index {
                    0..=3 => (Some(1), Some(Sentiment::Positive)),
                    4..=11 => (Some(2), Some(Sentiment::Positive)),
                    12 => (Some(2), Some(Sentiment::Neutral)),
                    13..=20 => (None, Some(Sentiment::Neutral)),
                    _ => (None, Some(Sentiment::Negative)),
                }
            } else {
                (None, None)
            };
            insights.push(AnswerInsight {
                id: format!("insight-{index}"),
                round_id: round.id.clone(),
                record_id: format!("record-{index}"),
                prompt_id: format!("prompt-{prompt_index:02}"),
                prompt_text: format!("题目 {prompt_index}"),
                engine: EngineId::Deepseek,
                mentions: Vec::new(),
                self_mentioned: true,
                self_rank: rank,
                self_sentiment: sentiment,
                answer_shape: AnswerShape::default(),
                source_types: BTreeMap::new(),
                confidence: 0.9,
                needs_review: false,
                risks: Vec::new(),
                corrected_fields: Vec::new(),
                reviewed_at: None,
            });
        }
        for prompt_index in 26..62 {
            insights.push(AnswerInsight {
                id: format!("insight-not-mentioned-{prompt_index}"),
                round_id: round.id.clone(),
                record_id: format!("record-not-mentioned-{prompt_index}"),
                prompt_id: format!("prompt-{prompt_index:02}"),
                prompt_text: format!("题目 {prompt_index}"),
                engine: EngineId::Deepseek,
                mentions: Vec::new(),
                self_mentioned: false,
                self_rank: None,
                self_sentiment: None,
                answer_shape: AnswerShape::default(),
                source_types: BTreeMap::new(),
                confidence: 0.9,
                needs_review: false,
                risks: Vec::new(),
                corrected_fields: Vec::new(),
                reviewed_at: None,
            });
        }

        let issues = (0..27)
            .map(|index| FactCheckIssue {
                id: format!("issue-{index}"),
                round_id: round.id.clone(),
                record_id: format!("record-{index}"),
                prompt_id: format!("prompt-{:02}", index % 26),
                prompt_text: "题目".to_string(),
                engine: EngineId::Deepseek,
                kind: FactIssueKind::Wrong,
                field_path: "price_range".to_string(),
                answer_excerpt: "旧价格".to_string(),
                entity_value: "新价格".to_string(),
                confidence: 0.9,
                status: FactIssueStatus::Open,
                correction_channel: CorrectionChannel::OfficialSite,
                note: None,
                resolved_at: None,
            })
            .collect();

        let authority = [
            SourceType::OwnedPage,
            SourceType::Baike,
            SourceType::OfficialDoc,
            SourceType::NewsMedia,
        ];
        let mut citations = Vec::new();
        for index in 0..47 {
            citations.push(Citation {
                url: format!("https://source-{index}.example.com/page"),
                domain: format!("source-{index}.example.com"),
                title: None,
                source_type: if index < 31 {
                    authority[index % authority.len()]
                } else {
                    SourceType::Other
                },
            });
        }
        for index in 47..100 {
            let domain_index = index % 47;
            citations.push(Citation {
                url: format!("https://source-{domain_index}.example.com/other"),
                domain: format!("source-{domain_index}.example.com"),
                title: None,
                source_type: SourceType::Other,
            });
        }
        (round, insights, issues, citations)
    }

    #[test]
    fn demo_baseline_matches_appendix_c() {
        let (round, insights, issues, citations) = demo_baseline();
        let output = build_diagnosis(DiagnosisInput {
            round: &round,
            self_brand: "澜舟",
            records: &[],
            insights: &insights,
            issues: &issues,
            citations: &citations,
            competitors: &[],
            engine_runs: &[],
            previous: None,
            previous_matrix: None,
            now: Utc::now(),
        });
        let overview = output.overview;
        let score = |dimension: DiagnosisDimension| {
            overview
                .dimensions
                .iter()
                .find(|item| item.dimension == dimension)
                .expect("五维齐全")
                .score
        };
        assert!(
            (score(DiagnosisDimension::Recommendation) - 23.0).abs() < 1.0,
            "推荐力 {}",
            score(DiagnosisDimension::Recommendation)
        );
        assert!(
            (score(DiagnosisDimension::Sentiment) - 37.0).abs() < 1.0,
            "口碑情感 {}",
            score(DiagnosisDimension::Sentiment)
        );
        assert!(
            (score(DiagnosisDimension::FactAccuracy) - 84.0).abs() < 1.0,
            "事实准确 {}",
            score(DiagnosisDimension::FactAccuracy)
        );
        assert!(
            (score(DiagnosisDimension::SourceHealth) - 50.0).abs() < 1.0,
            "信源健康 {}",
            score(DiagnosisDimension::SourceHealth)
        );
        assert!(
            (overview.total_score - 44.0).abs() < 1.0,
            "总分 {}",
            overview.total_score
        );
    }

    #[test]
    fn margins_are_interval_half_widths_not_round_deltas() {
        let (round, insights, issues, citations) = demo_baseline();
        let mut previous = previous_overview();
        previous.total_score = 10.0;
        previous.brand_coverage = 0.10;
        let output = build_diagnosis(DiagnosisInput {
            round: &round,
            self_brand: "澜舟",
            records: &[],
            insights: &insights,
            issues: &issues,
            citations: &citations,
            competitors: &[],
            engine_runs: &[],
            previous: Some(&previous),
            previous_matrix: None,
            now: Utc::now(),
        });
        let overview = output.overview;
        let expected = wilson_half_width(26.0 / 62.0, 62);
        assert!(
            (overview.brand_coverage_margin - expected).abs() < 1e-9,
            "覆盖率 margin 应是 Wilson 半宽"
        );
        assert!(overview.brand_coverage_margin > 0.0);
        let round_delta = overview.brand_coverage - previous.brand_coverage;
        assert!(
            (overview.brand_coverage_margin - round_delta).abs() > 0.1,
            "覆盖率 margin 不是与上一轮的差值"
        );
        assert!(overview.score_margin > 0.0);
        assert!(
            (overview.score_margin - (overview.total_score - previous.total_score)).abs() > 1.0,
            "总分 margin 不是与上一轮的差值"
        );
        let last = overview.trend.last().expect("趋势含本轮");
        assert_eq!(last.round_id, round.id);
        assert_eq!(last.coverage_margin, overview.brand_coverage_margin);
    }
}

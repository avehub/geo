//! M6 处方生成的领域纯函数：从诊断快照 / 核查问题推导可执行动作。
//!
//! 只做确定性映射，不调模型。动作的 `title` / `rationale` / `deliverable` 是**生成内容**
//! （与题库题干、报告数据同性质），按用户设置的生成内容语言输出中/英文；
//! id 按 `本轮 + 规则键` 确定，重建时能保住人工改过的状态。

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Utc};

use crate::action::{ActionCategory, ActionItem, ActionLevel, ActionStatus};
use crate::collection::{CollectionRound, EngineId};
use crate::diagnosis::{AlertKind, CompetitorMatrix, DiagnosisOverview};
use crate::insight::{FactCheckIssue, FactIssueKind, FactIssueStatus};
use crate::project::Language;
use crate::ProjectId;

pub struct ActionBuildInput<'a> {
    pub project_id: ProjectId,
    pub round: &'a CollectionRound,
    pub overview: &'a DiagnosisOverview,
    pub matrix: &'a CompetitorMatrix,
    pub issues: &'a [FactCheckIssue],
    pub language: Language,
    pub now: DateTime<Utc>,
}

/// 生成一套处方（按 rank 升序）。
pub fn build_actions(input: ActionBuildInput<'_>) -> Vec<ActionItem> {
    let zh = input.language == Language::ZhCn;
    let mut actions = Vec::new();
    let open_issues: Vec<&FactCheckIssue> = input
        .issues
        .iter()
        .filter(|issue| issue.status != FactIssueStatus::FalsePositive)
        .collect();

    // ① 事实纠错：按字段聚合，一条动作对一类字段。
    let mut by_field: BTreeMap<&str, Vec<&FactCheckIssue>> = BTreeMap::new();
    for issue in &open_issues {
        by_field
            .entry(issue.field_path.as_str())
            .or_default()
            .push(issue);
    }
    for (field, issues) in &by_field {
        let kind = issues
            .iter()
            .map(|issue| issue.kind)
            .min()
            .unwrap_or(FactIssueKind::Missing);
        let mut engines: Vec<EngineId> = Vec::new();
        for issue in issues {
            if !engines.contains(&issue.engine) {
                engines.push(issue.engine);
            }
        }
        let prompt_count = issues
            .iter()
            .map(|issue| issue.prompt_id.as_str())
            .collect::<BTreeSet<_>>()
            .len();
        let label = field_label(field, zh);
        let kind_label = kind_label(kind, zh);
        actions.push(ActionItem {
            id: format!("action-{}-fact-{}", input.round.id, sanitize(field)),
            project_id: input.project_id.to_string(),
            round_id: input.round.id.clone(),
            category: ActionCategory::FactCorrection,
            rank: 0,
            title: if zh {
                format!("修正「{label}」口径")
            } else {
                format!("Correct the {label} statement")
            },
            rationale: if zh {
                format!("{kind_label} × {} 条证据", issues.len())
            } else {
                format!("{kind_label} x {} evidence items", issues.len())
            },
            impact: if issues.len() >= 3 {
                ActionLevel::High
            } else {
                ActionLevel::Medium
            },
            difficulty: ActionLevel::Low,
            owner_hint: owner(zh),
            deliverable: if zh {
                "官方口径更正说明".to_string()
            } else {
                "Official correction note".to_string()
            },
            affected_prompt_count: i32::try_from(prompt_count).unwrap_or(i32::MAX),
            affected_engines: engines,
            evidence_issue_ids: issues.iter().map(|issue| issue.id.clone()).collect(),
            quick_win: true,
            status: ActionStatus::Todo,
            completed_at: None,
            updated_at: input.now,
        });
    }

    // ② 覆盖率不足：官网结构与定义句。
    if input.overview.brand_coverage < 0.60 {
        let uncovered = ((1.0 - input.overview.brand_coverage) * input.overview.sample_size as f64)
            .round()
            .max(0.0) as i32;
        actions.push(ActionItem {
            id: format!("action-{}-coverage", input.round.id),
            project_id: input.project_id.to_string(),
            round_id: input.round.id.clone(),
            category: ActionCategory::SiteStructure,
            rank: 0,
            title: if zh {
                "补齐官网定义句与结构化数据".to_string()
            } else {
                "Add definition sentences and structured data to the site".to_string()
            },
            rationale: format!(
                "brand_coverage={:.2}; uncovered~{uncovered}",
                input.overview.brand_coverage
            ),
            impact: ActionLevel::High,
            difficulty: ActionLevel::Medium,
            owner_hint: owner(zh),
            deliverable: if zh {
                "产品页定义句 + Organization/Product 结构化数据".to_string()
            } else {
                "Product definition copy + Organization/Product structured data".to_string()
            },
            affected_prompt_count: uncovered,
            affected_engines: input.round.engine_scope.clone(),
            evidence_issue_ids: Vec::new(),
            quick_win: false,
            status: ActionStatus::Todo,
            completed_at: None,
            updated_at: input.now,
        });
    }

    // ③ 推荐位次不足：内容生产。
    let top3_rate = input
        .overview
        .dimensions
        .iter()
        .find(|dimension| {
            dimension.dimension == crate::diagnosis::DiagnosisDimension::Recommendation
        })
        .map(|dimension| dimension.score / 100.0)
        .unwrap_or(0.0);
    if top3_rate < 0.30 {
        actions.push(ActionItem {
            id: format!("action-{}-recommendation", input.round.id),
            project_id: input.project_id.to_string(),
            round_id: input.round.id.clone(),
            category: ActionCategory::ContentProduction,
            rank: 0,
            title: if zh {
                "生产问答式内容，争取进入推荐列表".to_string()
            } else {
                "Publish Q&A content to earn recommendation slots".to_string()
            },
            rationale: format!("top3_rate={top3_rate:.2}"),
            impact: ActionLevel::High,
            difficulty: ActionLevel::Medium,
            owner_hint: owner(zh),
            deliverable: if zh {
                "问答稿 + 对比表".to_string()
            } else {
                "Q&A article + comparison table".to_string()
            },
            affected_prompt_count: input.overview.sample_size as i32,
            affected_engines: input.round.engine_scope.clone(),
            evidence_issue_ids: Vec::new(),
            quick_win: false,
            status: ActionStatus::Todo,
            completed_at: None,
            updated_at: input.now,
        });
    }

    // ④ 提及份额低 / 竞品反超：第三方信源与横向对比。
    let overtake = input
        .overview
        .alerts
        .iter()
        .any(|alert| alert.kind == AlertKind::CompetitorOvertake);
    if input.overview.share_of_voice < 0.40 || overtake {
        actions.push(ActionItem {
            id: format!("action-{}-source", input.round.id),
            project_id: input.project_id.to_string(),
            round_id: input.round.id.clone(),
            category: ActionCategory::SourceLayout,
            rank: 0,
            title: if zh {
                "补齐第三方信源与横向对比内容".to_string()
            } else {
                "Add third-party sources and comparison content".to_string()
            },
            rationale: format!(
                "share_of_voice={:.2}; competitor_overtake={overtake}",
                input.overview.share_of_voice
            ),
            impact: ActionLevel::Medium,
            difficulty: ActionLevel::Medium,
            owner_hint: owner(zh),
            deliverable: if zh {
                "第三方信源清单 + 对比页".to_string()
            } else {
                "Third-party source list + comparison page".to_string()
            },
            affected_prompt_count: input.matrix.head_to_head_prompt_count as i32,
            affected_engines: input.round.engine_scope.clone(),
            evidence_issue_ids: Vec::new(),
            quick_win: false,
            status: ActionStatus::Todo,
            completed_at: None,
            updated_at: input.now,
        });
    }

    // ⑤ 兜底：至少给一条可执行的复测动作。
    if actions.is_empty() {
        actions.push(ActionItem {
            id: format!("action-{}-maintain", input.round.id),
            project_id: input.project_id.to_string(),
            round_id: input.round.id.clone(),
            category: ActionCategory::ContentProduction,
            rank: 0,
            title: if zh {
                "保持内容更新频率并安排下一轮复测".to_string()
            } else {
                "Keep publishing and schedule the next retest".to_string()
            },
            rationale: "no_blocking_findings".to_string(),
            impact: ActionLevel::Low,
            difficulty: ActionLevel::Low,
            owner_hint: owner(zh),
            deliverable: if zh {
                "下一轮采集".to_string()
            } else {
                "Next collection round".to_string()
            },
            affected_prompt_count: 0,
            affected_engines: input.round.engine_scope.clone(),
            evidence_issue_ids: Vec::new(),
            quick_win: true,
            status: ActionStatus::Todo,
            completed_at: None,
            updated_at: input.now,
        });
    }

    actions.sort_by(|left, right| {
        impact_rank(right.impact)
            .cmp(&impact_rank(left.impact))
            .then_with(|| left.title.cmp(&right.title))
    });
    for (rank, action) in actions.iter_mut().enumerate() {
        action.rank = i32::try_from(rank + 1).unwrap_or(i32::MAX);
    }
    actions
}

fn impact_rank(level: ActionLevel) -> u8 {
    match level {
        ActionLevel::High => 3,
        ActionLevel::Medium => 2,
        ActionLevel::Low => 1,
    }
}

fn owner(zh: bool) -> String {
    if zh {
        "市场负责人".to_string()
    } else {
        "Marketing lead".to_string()
    }
}

fn kind_label(kind: FactIssueKind, zh: bool) -> &'static str {
    match (kind, zh) {
        (FactIssueKind::Wrong, true) => "说错了",
        (FactIssueKind::Outdated, true) => "说旧了",
        (FactIssueKind::Missing, true) => "漏说了",
        (FactIssueKind::Wrong, false) => "wrong",
        (FactIssueKind::Outdated, false) => "outdated",
        (FactIssueKind::Missing, false) => "missing",
    }
}

fn field_label(field: &str, zh: bool) -> &'static str {
    match (field, zh) {
        ("price_range", true) => "价格区间",
        ("founded_year", true) => "成立年份",
        ("qualifications", true) => "资质认证",
        ("products", true) => "产品参数",
        ("service_regions", true) => "服务地域",
        ("contact", true) => "联系方式",
        ("price_range", false) => "price range",
        ("founded_year", false) => "founding year",
        ("qualifications", false) => "qualifications",
        ("products", false) => "product specifications",
        ("service_regions", false) => "service regions",
        ("contact", false) => "contact details",
        _ => "brand facts",
    }
}

fn sanitize(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collection::{EngineId, RoundStatus};
    use crate::diagnosis::{
        AlertItem, AlertSeverity, CompetitorMatrixRow, DiagnosisDimension, DimensionScore,
        TrendPoint,
    };
    use crate::prompt::SampleSizeGrade;

    fn round() -> CollectionRound {
        CollectionRound {
            id: "round-1".to_string(),
            project_id: ProjectId::new().to_string(),
            prompt_set_id: "set".to_string(),
            prompt_set_label: "题库".to_string(),
            prompt_set_version: 1,
            label: "第 1 轮".to_string(),
            round_index: 1,
            status: RoundStatus::Succeeded,
            engine_scope: vec![EngineId::Deepseek],
            repeat_count: 1,
            planned_queries: 10,
            completed_queries: 10,
            failed_queries: 0,
            success_rate: 1.0,
            started_at: Some(Utc::now()),
            finished_at: Some(Utc::now()),
            metric_spec_version: "geo-metrics-v1".to_string(),
            sample_size_grade: SampleSizeGrade::Insufficient,
            notes: None,
        }
    }

    fn overview(round: &CollectionRound) -> DiagnosisOverview {
        DiagnosisOverview {
            project_id: round.project_id.clone(),
            round_id: round.id.clone(),
            round_label: round.label.clone(),
            collected_at: Utc::now(),
            total_score: 55.0,
            score_margin: 0.0,
            sample_size: 10,
            sample_size_grade: SampleSizeGrade::Insufficient,
            dimensions: vec![DimensionScore {
                dimension: DiagnosisDimension::Recommendation,
                score: 20.0,
                weight: 0.2,
                sample_size: 10,
                detail: "2 / 10".to_string(),
            }],
            brand_coverage: 0.50,
            brand_coverage_margin: 0.0,
            share_of_voice: 0.30,
            fact_accuracy: 0.80,
            distinct_cited_domains: 5,
            trend: Vec::<TrendPoint>::new(),
            alerts: vec![AlertItem {
                id: "a1".to_string(),
                project_id: round.project_id.clone(),
                round_id: round.id.clone(),
                kind: AlertKind::CompetitorOvertake,
                severity: AlertSeverity::Critical,
                engine: None,
                metric: "brand_coverage".to_string(),
                delta: Some(10.0),
                detail: "南方泵业".to_string(),
                acknowledged: false,
                raised_at: Utc::now(),
            }],
            metric_spec_version: "geo-metrics-v1".to_string(),
        }
    }

    fn matrix(round: &CollectionRound) -> CompetitorMatrix {
        CompetitorMatrix {
            round_id: round.id.clone(),
            sample_size: 10,
            head_to_head_prompt_count: 4,
            rows: vec![CompetitorMatrixRow {
                brand: "本品牌".to_string(),
                is_self: true,
                coverage: 0.5,
                share_of_voice: 0.3,
                top1_rate: 0.1,
                top3_rate: 0.2,
                mention_only_rate: 0.3,
                positive_rate: 0.6,
                negative_rate: 0.1,
                fact_error_count: 2,
                cited_domain_count: 5,
            }],
        }
    }

    #[test]
    fn builds_fact_and_funnel_actions_with_deterministic_ids() {
        let round = round();
        let overview = overview(&round);
        let matrix = matrix(&round);
        let issue = FactCheckIssue {
            id: "issue-1".to_string(),
            round_id: round.id.clone(),
            record_id: "r1".to_string(),
            prompt_id: "p1".to_string(),
            prompt_text: "问题".to_string(),
            engine: EngineId::Deepseek,
            kind: FactIssueKind::Wrong,
            field_path: "price_range".to_string(),
            answer_excerpt: "199".to_string(),
            entity_value: "299".to_string(),
            confidence: 0.9,
            status: FactIssueStatus::Open,
            correction_channel: crate::insight::CorrectionChannel::OfficialSite,
            note: None,
            resolved_at: None,
        };
        let actions = build_actions(ActionBuildInput {
            project_id: round.project_id.parse().unwrap(),
            round: &round,
            overview: &overview,
            matrix: &matrix,
            issues: &[issue],
            language: Language::ZhCn,
            now: Utc::now(),
        });
        assert!(actions
            .iter()
            .any(|action| action.id == "action-round-1-fact-price_range"));
        assert!(actions
            .iter()
            .any(|action| action.id == "action-round-1-coverage"));
        assert!(actions
            .iter()
            .any(|action| action.id == "action-round-1-recommendation"));
        assert!(actions
            .iter()
            .any(|action| action.id == "action-round-1-source"));
        assert_eq!(actions[0].rank, 1);
        assert!(actions
            .iter()
            .all(|action| action.status == ActionStatus::Todo));
    }
}

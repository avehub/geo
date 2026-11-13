//! M7 报告渲染服务（Plan C M3–M7 读路径）。
//!
//! 只做**结构化组装**：诊断快照 / 竞品矩阵 / 漏斗 / 核查 / 行动 / 证据 → `ReportDocument`。
//! 不调模型、不生成散文、不排版；标题与表头由前端词典渲染。

use std::collections::HashMap;

use chrono::Utc;
use geo_domain::{
    ActionBoard, ActionStatus, CompetitorMatrix, DiagnosisOverview, EngineScore, FactCheckIssue,
    GeoError, IntentFunnel, ProjectId, ReportBlock, ReportDocument, ReportMethodology,
    ReportRenderOptions, ReportSection, ReportVariant,
};
use geo_store::{CollectionRepo, DiagnosisRepo, InsightRepo, ProjectRepo, StoreError};
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct ReportService {
    pool: SqlitePool,
}

impl ReportService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone())
    }

    pub async fn render(
        &self,
        project_id: ProjectId,
        round_id: String,
        options: ReportRenderOptions,
    ) -> Result<ReportDocument, IpcError> {
        let project = ProjectRepo::new(self.pool.clone()).get(project_id).await?;
        let round = match CollectionRepo::new(self.pool.clone())
            .round(&round_id)
            .await?
        {
            Some(round) if round.project_id == project_id.to_string() => round,
            _ => {
                return Err(GeoError::validation("round_id", "invalid_id")
                    .with_param("value", round_id)
                    .into());
            }
        };
        if !matches!(
            round.status,
            geo_domain::RoundStatus::Succeeded | geo_domain::RoundStatus::Partial
        ) {
            return Err(GeoError::validation("round_id", "invalid_format")
                .with_param("value", round_id)
                .into());
        }
        let variant = options.variant.unwrap_or(ReportVariant::Executive);
        let snapshots = DiagnosisRepo::new(self.pool.clone());
        let overview =
            decode_required::<DiagnosisOverview>(snapshots.snapshot(&round_id, "overview").await?)?;
        let competitors: Option<CompetitorMatrix> =
            decode_optional(snapshots.snapshot(&round_id, "competitors").await?)?;
        let funnel: Option<IntentFunnel> =
            decode_optional(snapshots.snapshot(&round_id, "funnel").await?)?;
        let engines: Vec<EngineScore> =
            decode_optional::<Vec<EngineScore>>(snapshots.snapshot(&round_id, "engines").await?)?
                .unwrap_or_default();
        let issues = InsightRepo::new(self.pool.clone())
            .fact_issues(&round_id)
            .await?;
        let board: Option<ActionBoard> =
            decode_optional(snapshots.action_board(&project_id.to_string()).await?)?;
        let actions = board.map(|board| board.actions).unwrap_or_default();
        let mut model_versions: Vec<String> = CollectionRepo::new(self.pool.clone())
            .engine_runs(&round_id)
            .await?
            .into_iter()
            .map(|run| run.model)
            .filter(|model| !model.trim().is_empty())
            .collect();
        model_versions.sort();
        model_versions.dedup();

        let mut next_steps: Vec<String> = actions
            .iter()
            .filter(|action| action.status != ActionStatus::Done)
            .take(3)
            .map(|action| action.title.clone())
            .collect();
        if next_steps.is_empty() {
            next_steps = actions
                .iter()
                .take(3)
                .map(|action| action.title.clone())
                .collect();
        }

        // 环比：取同项目上一轮“有 overview 快照”的诊断。没有上一轮时 delta 全为 null。
        let previous = previous_overview(&self.pool, &round).await?;
        let headline = vec![
            metric(
                "brand_coverage",
                overview.brand_coverage,
                "percent",
                previous
                    .as_ref()
                    .map(|value| (overview.brand_coverage - value.brand_coverage) * 100.0),
            ),
            metric(
                "total_score",
                overview.total_score,
                "score",
                previous
                    .as_ref()
                    .map(|value| overview.total_score - value.total_score),
            ),
            metric("fact_error_count", issues.len() as f64, "count", None),
        ];
        let mut sections = Vec::new();
        for id in variant.section_ids() {
            let blocks = match *id {
                "conclusion" => {
                    let mut blocks = headline.clone();
                    if !next_steps.is_empty() {
                        blocks.push(ReportBlock::List {
                            items: next_steps.clone(),
                        });
                    }
                    blocks
                }
                "coverage" => {
                    if overview.dimensions.is_empty() {
                        Vec::new()
                    } else {
                        vec![ReportBlock::List {
                            items: overview
                                .dimensions
                                .iter()
                                .map(|dimension| dimension.detail.clone())
                                .collect(),
                        }]
                    }
                }
                "competitors" => competitors
                    .as_ref()
                    .map(|matrix| {
                        vec![ReportBlock::Table {
                            column_keys: vec![
                                "brand".to_string(),
                                "coverage".to_string(),
                                "share_of_voice".to_string(),
                                "top3_rate".to_string(),
                            ],
                            rows: matrix
                                .rows
                                .iter()
                                .map(|row| {
                                    vec![
                                        row.brand.clone(),
                                        pct(row.coverage),
                                        pct(row.share_of_voice),
                                        pct(row.top3_rate),
                                    ]
                                })
                                .collect(),
                        }]
                    })
                    .unwrap_or_default(),
                "engines" => {
                    if engines.is_empty() {
                        Vec::new()
                    } else {
                        vec![ReportBlock::Table {
                            column_keys: vec![
                                "engine".to_string(),
                                "coverage".to_string(),
                                "top3_rate".to_string(),
                                "success_rate".to_string(),
                                "avg_latency_ms".to_string(),
                            ],
                            rows: engines
                                .iter()
                                .map(|engine| {
                                    vec![
                                        engine.engine_string(),
                                        pct(engine.coverage),
                                        pct(engine.top3_rate),
                                        pct(engine.success_rate),
                                        engine.avg_latency_ms.to_string(),
                                    ]
                                })
                                .collect(),
                        }]
                    }
                }
                "funnel" => funnel
                    .as_ref()
                    .map(|funnel| {
                        vec![ReportBlock::Table {
                            column_keys: vec![
                                "stage".to_string(),
                                "prompt_count".to_string(),
                                "mention_rate".to_string(),
                                "top3_rate".to_string(),
                            ],
                            rows: funnel
                                .rows
                                .iter()
                                .map(|row| {
                                    vec![
                                        stage_string(row.stage),
                                        row.prompt_count.to_string(),
                                        pct(row.mention_rate),
                                        pct(row.top3_rate),
                                    ]
                                })
                                .collect(),
                        }]
                    })
                    .unwrap_or_default(),
                "fact_check" => {
                    if issues.is_empty() {
                        Vec::new()
                    } else {
                        vec![ReportBlock::Table {
                            column_keys: vec![
                                "prompt_text".to_string(),
                                "engine".to_string(),
                                "answer_excerpt".to_string(),
                            ],
                            rows: issues
                                .iter()
                                .map(|issue| {
                                    vec![
                                        issue.prompt_text.clone(),
                                        issue.engine_string(),
                                        issue.answer_excerpt.clone(),
                                    ]
                                })
                                .collect(),
                        }]
                    }
                }
                "actions" => {
                    if actions.is_empty() {
                        Vec::new()
                    } else {
                        vec![ReportBlock::List {
                            items: actions.iter().map(|action| action.title.clone()).collect(),
                        }]
                    }
                }
                _ => Vec::new(),
            };
            if !blocks.is_empty() {
                sections.push(ReportSection {
                    id: (*id).to_string(),
                    blocks,
                });
            }
        }

        if options.include_evidence {
            let records = CollectionRepo::new(self.pool.clone())
                .records(&round_id)
                .await?;
            let answers: HashMap<String, String> = CollectionRepo::new(self.pool.clone())
                .answer_texts(&round_id)
                .await?
                .into_iter()
                .collect();
            let rows = records
                .iter()
                .map(|record| {
                    vec![
                        record.prompt_text.clone(),
                        record.engine_string(),
                        record.collected_at.to_rfc3339(),
                        if record.mentioned {
                            "mentioned".to_string()
                        } else {
                            "not_mentioned".to_string()
                        },
                        record
                            .rank
                            .map(|rank| rank.to_string())
                            .unwrap_or_else(|| "-".to_string()),
                        answers
                            .get(&record.id)
                            .map(|text| text.chars().take(120).collect())
                            .unwrap_or_default(),
                    ]
                })
                .collect();
            sections.push(ReportSection {
                id: "evidence".to_string(),
                blocks: vec![ReportBlock::Table {
                    column_keys: vec![
                        "prompt_text".to_string(),
                        "engine".to_string(),
                        "collected_at".to_string(),
                        "mention".to_string(),
                        "rank".to_string(),
                        "answer_excerpt".to_string(),
                    ],
                    rows,
                }],
            });
        }

        Ok(ReportDocument {
            project_id: project_id.to_string(),
            round_id: round.id.clone(),
            variant,
            brand_name: project.brand_name,
            round_label: round.label.clone(),
            generated_at: Utc::now(),
            headline,
            next_steps,
            sections,
            methodology: ReportMethodology {
                round_label: round.label.clone(),
                sample_size: overview.sample_size,
                sample_size_grade: overview.sample_size_grade,
                collected_at: overview.collected_at,
                engines: round.engine_scope.clone(),
                model_versions,
                prompt_set_label: round.prompt_set_label.clone(),
                prompt_set_version: round.prompt_set_version,
                metric_spec_version: round.metric_spec_version.clone(),
                repeat_count: round.repeat_count,
            },
            white_label: options.white_label,
        })
    }
}

async fn previous_overview(
    pool: &SqlitePool,
    round: &geo_domain::CollectionRound,
) -> Result<Option<DiagnosisOverview>, IpcError> {
    let snapshots = DiagnosisRepo::new(pool.clone());
    let mut rounds = CollectionRepo::new(pool.clone())
        .rounds(&round.project_id)
        .await?;
    rounds.sort_by_key(|candidate| std::cmp::Reverse(candidate.round_index));
    for candidate in rounds
        .into_iter()
        .filter(|candidate| candidate.round_index < round.round_index)
    {
        if let Some(payload) = snapshots.snapshot(&candidate.id, "overview").await? {
            let overview: DiagnosisOverview = serde_json::from_str(&payload)
                .map_err(|error| IpcError::from(StoreError::Serde(error)))?;
            return Ok(Some(overview));
        }
    }
    Ok(None)
}

fn metric(metric: &str, value: f64, unit: &str, delta: Option<f64>) -> ReportBlock {
    ReportBlock::Metric {
        metric: metric.to_string(),
        value,
        unit: match unit {
            "percent" => geo_domain::ReportMetricUnit::Percent,
            "count" => geo_domain::ReportMetricUnit::Count,
            _ => geo_domain::ReportMetricUnit::Score,
        },
        delta,
    }
}

fn pct(value: f64) -> String {
    format!("{:.0}%", value * 100.0)
}

fn stage_string(stage: geo_domain::FunnelStage) -> String {
    stage.as_str().to_string()
}

trait EngineName {
    fn engine_string(&self) -> String;
}

impl EngineName for EngineScore {
    fn engine_string(&self) -> String {
        self.engine.as_str().to_string()
    }
}

impl EngineName for FactCheckIssue {
    fn engine_string(&self) -> String {
        self.engine.as_str().to_string()
    }
}

impl EngineName for geo_domain::CollectionRecord {
    fn engine_string(&self) -> String {
        self.engine.as_str().to_string()
    }
}

fn decode_required<T: serde::de::DeserializeOwned>(raw: Option<String>) -> Result<T, IpcError> {
    match raw {
        Some(payload) => Ok(serde_json::from_str(&payload)
            .map_err(|error| IpcError::from(StoreError::Serde(error)))?),
        None => Err(GeoError::validation("round_id", "invalid_format").into()),
    }
}

fn decode_optional<T: serde::de::DeserializeOwned>(
    raw: Option<String>,
) -> Result<Option<T>, IpcError> {
    match raw {
        Some(payload) => {
            Ok(Some(serde_json::from_str(&payload).map_err(|error| {
                IpcError::from(StoreError::Serde(error))
            })?))
        }
        None => Ok(None),
    }
}

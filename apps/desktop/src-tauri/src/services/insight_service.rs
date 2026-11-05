//! M4 解析与核查服务（读路径 + LLM 抽取 / 事实核查流水线）。
//!
//! 两条命令：`insight_list` / `fact_check_list`；采集完成后由 `CollectionService`
//! 调用 [`InsightService::parse_round`] 自动补齐解析结果。
//!
//! 🔴 采集层只落原始回答，本层才判提及 / 位次 / 情感 / 事实问题。
//! 解析使用用户当前配置的「模型服务商」，与采集引擎的 Key 相互独立。

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use geo_domain::{
    AnswerInsight, AnswerShape, BrandMention, BrandRole, Citation, CollectionRecord,
    CollectionRound, CorrectionChannel, FactCheckBoard, FactCheckIssue, FactCheckSummary,
    FactIssueKind, FactIssueStatus, GeoError, InsightCorrection, InsightFilter, RiskFlag,
    Sentiment, SourceType, REVIEW_CONFIDENCE_FLOOR,
};
use geo_llm::{chat_json, ChatMessage, ChatRequest, LlmClient, LlmError};
use geo_store::{
    CollectionRepo, CompetitorRepo, DiagnosisRepo, EntityCardRepo, InsightRepo, ProjectRepo,
    SecretStore, SettingsRepo, StoreError,
};
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::{AppState, LlmFactory};

#[derive(Clone)]
pub struct InsightService {
    pool: SqlitePool,
    llm: Arc<LlmFactory>,
    secrets: Arc<dyn SecretStore>,
}

impl InsightService {
    pub fn new(pool: SqlitePool, llm: Arc<LlmFactory>, secrets: Arc<dyn SecretStore>) -> Self {
        Self { pool, llm, secrets }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone(), state.llm.clone(), state.secrets.clone())
    }

    async fn client(&self) -> Result<LlmClient, IpcError> {
        let settings = SettingsRepo::new(self.pool.clone()).get().await?;
        let config = LlmFactory::config_from_settings(&settings)?;
        let api_key = self
            .secrets
            .get(&config.secret_ref)
            .await?
            .filter(|key| !key.trim().is_empty())
            .ok_or(IpcError::from(LlmError::MissingSecret))?;
        Ok(self.llm.client(config, &api_key))
    }

    fn insights(&self) -> InsightRepo {
        InsightRepo::new(self.pool.clone())
    }

    fn collection(&self) -> CollectionRepo {
        CollectionRepo::new(self.pool.clone())
    }

    async fn require_round(&self, round_id: &str) -> Result<(), IpcError> {
        match self.collection().round(round_id).await? {
            Some(_) => Ok(()),
            None => Err(GeoError::validation("round_id", "invalid_id")
                .with_param("value", round_id)
                .into()),
        }
    }

    pub async fn insight_list(
        &self,
        round_id: String,
        filter: InsightFilter,
    ) -> Result<Vec<AnswerInsight>, IpcError> {
        self.require_round(&round_id).await?;
        Ok(self
            .insights()
            .insights(&round_id)
            .await?
            .into_iter()
            .filter(|insight| insight.matches(&filter))
            .collect())
    }

    pub async fn fact_check_list(&self, round_id: String) -> Result<FactCheckBoard, IpcError> {
        self.require_round(&round_id).await?;
        Ok(FactCheckBoard {
            issues: self.insights().fact_issues(&round_id).await?,
            summary: self.insights().fact_summary(&round_id).await?,
        })
    }
    /// 人工纠正：只改提及 / 位次 / 情感；同步证据投影与提及明细里的本品牌行。
    pub async fn correct_insight(
        &self,
        id: String,
        correction: InsightCorrection,
        now: DateTime<Utc>,
    ) -> Result<AnswerInsight, IpcError> {
        let mut insight = match self.insights().get_insight(&id).await? {
            Some(insight) => insight,
            None => {
                return Err(GeoError::validation("insight_id", "invalid_id")
                    .with_param("value", id)
                    .into());
            }
        };

        let mut corrected = Vec::new();
        if let Some(mentioned) = correction.self_mentioned {
            insight.self_mentioned = mentioned;
            corrected.push("self_mentioned".to_string());
            if !mentioned {
                insight.self_rank = None;
                insight.self_sentiment = None;
            }
        }
        if let Some(rank) = correction.self_rank {
            if let Some(value) = rank {
                if value < 1 {
                    return Err(GeoError::validation("self_rank", "out_of_range")
                        .with_param("expected", ">=1")
                        .with_param("value", value.to_string())
                        .into());
                }
            }
            if insight.self_mentioned {
                insight.self_rank = rank;
                corrected.push("self_rank".to_string());
            }
        }
        if insight.self_mentioned {
            if let Some(sentiment) = correction.self_sentiment {
                insight.self_sentiment = sentiment;
                corrected.push("self_sentiment".to_string());
            }
        }
        for field in corrected {
            if !insight.corrected_fields.contains(&field) {
                insight.corrected_fields.push(field);
            }
        }
        insight.needs_review = false;
        insight.reviewed_at = Some(now);
        if let Some(mention) = insight
            .mentions
            .iter_mut()
            .find(|mention| mention.role == geo_domain::BrandRole::Self_)
        {
            mention.rank = insight.self_rank;
            mention.sentiment = insight.self_sentiment.unwrap_or(Sentiment::Neutral);
        }
        self.insights().save_insight_correction(&insight).await?;
        Ok(insight)
    }

    /// 结办核查问题：`corrected` / `false_positive` 盖 resolved_at，`open` 清掉。
    /// 契约外的 status 收敛成 `open`（最保守：不声称已处理）。
    pub async fn resolve_fact_issue(
        &self,
        id: String,
        status: String,
        note: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<FactCheckIssue, IpcError> {
        let status = match status.as_str() {
            "false_positive" => FactIssueStatus::FalsePositive,
            "corrected" => FactIssueStatus::Corrected,
            _ => FactIssueStatus::Open,
        };
        let note = note
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let resolved_at = if status == FactIssueStatus::Open {
            None
        } else {
            Some(now)
        };
        match self
            .insights()
            .save_issue_resolution(&id, status, note.as_deref(), resolved_at)
            .await
        {
            Ok(()) => {}
            Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("issue_id", "invalid_id")
                    .with_param("value", id)
                    .into());
            }
            Err(error) => return Err(error.into()),
        }
        Ok(self
            .insights()
            .get_issue(&id)
            .await?
            .expect("刚写入的核查问题必须可读"))
    }
    /// 解析一轮里所有还没解析过的成功记录；返回本次新增的解析条数。
    ///
    /// 幂等：已有 `answer_insights` 的 record_id 直接跳过，所以启动续跑 /
    /// 重复调用都只会补缺口。
    pub async fn parse_round(&self, round_id: &str) -> Result<usize, IpcError> {
        let round = match CollectionRepo::new(self.pool.clone())
            .round(round_id)
            .await?
        {
            Some(round) => round,
            None => {
                return Err(GeoError::validation("round_id", "invalid_id")
                    .with_param("value", round_id)
                    .into());
            }
        };
        let repo = self.insights();
        let existing: HashSet<String> = repo
            .insights(round_id)
            .await?
            .into_iter()
            .map(|insight| insight.record_id)
            .collect();
        let records = CollectionRepo::new(self.pool.clone())
            .records(round_id)
            .await?;
        let answers: HashMap<String, String> = CollectionRepo::new(self.pool.clone())
            .answer_texts(round_id)
            .await?
            .into_iter()
            .collect();
        let pending: Vec<CollectionRecord> = records
            .into_iter()
            .filter(|record| {
                record.status == geo_domain::CollectionStatus::Succeeded
                    && !existing.contains(&record.id)
            })
            .collect();
        if pending.is_empty() {
            self.recompute_summary(round_id).await?;
            if let Err(error) = self.rebuild_diagnosis(round_id).await {
                tracing::warn!(
                    round_id,
                    code = error.code.as_str(),
                    "diagnosis rebuild stopped with an error"
                );
            }
            return Ok(0);
        }
        let client = self.client().await?;
        let context = self.parse_context(&round).await?;
        let mut parsed = 0;
        for record in pending {
            let Some(answer) = answers.get(&record.id) else {
                continue;
            };
            match self.parse_record(&client, &context, &record, answer).await {
                Ok((insight, issues, citations)) => {
                    repo.insert_insight(&insight).await?;
                    for issue in &issues {
                        repo.insert_issue(issue).await?;
                    }
                    CollectionRepo::new(self.pool.clone())
                        .replace_citations(&record.id, &citations)
                        .await?;
                    parsed += 1;
                }
                Err(error) => {
                    tracing::warn!(
                        record_id = record.id.as_str(),
                        code = error.code.as_str(),
                        "answer parsing failed"
                    );
                }
            }
        }
        self.recompute_summary(round_id).await?;
        if let Err(error) = self.rebuild_diagnosis(round_id).await {
            tracing::warn!(
                round_id,
                code = error.code.as_str(),
                "diagnosis rebuild stopped with an error"
            );
        }
        Ok(parsed)
    }

    /// 从当前解析结果重算 M5 四份快照。告警的已读状态按 `(kind, metric, detail)`
    /// 从同轮旧快照继承，重建不会把用户点过的「已读」洗掉。
    async fn rebuild_diagnosis(&self, round_id: &str) -> Result<(), IpcError> {
        let collection = CollectionRepo::new(self.pool.clone());
        let round = match collection.round(round_id).await? {
            Some(round)
                if matches!(
                    round.status,
                    geo_domain::RoundStatus::Succeeded | geo_domain::RoundStatus::Partial
                ) =>
            {
                round
            }
            _ => return Ok(()),
        };
        let insights = self.insights().insights(round_id).await?;
        if insights.is_empty() {
            return Ok(());
        }
        let project_id = round
            .project_id
            .parse()
            .map_err(|_| GeoError::validation("project_id", "invalid_id"))?;
        let project = ProjectRepo::new(self.pool.clone()).get(project_id).await?;
        let card = EntityCardRepo::new(self.pool.clone())
            .get(project_id)
            .await?;
        let self_brand = card
            .as_ref()
            .map(|card| card.fields.standard_name.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| project.brand_name.clone());
        let competitors = CompetitorRepo::new(self.pool.clone())
            .list_by_project(project_id)
            .await?
            .into_iter()
            .map(|competitor| competitor.name)
            .collect::<Vec<_>>();
        let records = collection.records(round_id).await?;
        let issues = self.insights().fact_issues(round_id).await?;
        let citation_domains = collection.citation_domains(round_id).await?;
        let engine_runs = collection.engine_runs(round_id).await?;
        let snapshots = DiagnosisRepo::new(self.pool.clone());
        let previous_round = collection
            .rounds(&round.project_id)
            .await?
            .into_iter()
            .filter(|candidate| candidate.round_index < round.round_index)
            .max_by_key(|candidate| candidate.round_index);
        let previous = match &previous_round {
            Some(previous) => {
                decode_optional_overview(snapshots.snapshot(&previous.id, "overview").await?)?
            }
            None => None,
        };
        let previous_matrix = match &previous_round {
            Some(previous) => {
                decode_optional_matrix(snapshots.snapshot(&previous.id, "competitors").await?)?
            }
            None => None,
        };
        let output = geo_domain::build_diagnosis(geo_domain::DiagnosisInput {
            round: &round,
            self_brand: &self_brand,
            records: &records,
            insights: &insights,
            issues: &issues,
            citation_domains: &citation_domains,
            competitors: &competitors,
            engine_runs: &engine_runs,
            previous: previous.as_ref(),
            previous_matrix: previous_matrix.as_ref(),
            now: Utc::now(),
        });
        let mut overview = output.overview;
        if let Some(existing) =
            decode_optional_overview(snapshots.snapshot(round_id, "overview").await?)?
        {
            let known: std::collections::HashMap<(String, String, String), (String, bool)> =
                existing
                    .alerts
                    .into_iter()
                    .map(|alert| {
                        (
                            (
                                serde_key(alert.kind),
                                alert.metric.clone(),
                                alert.detail.clone(),
                            ),
                            (alert.id, alert.acknowledged),
                        )
                    })
                    .collect();
            for alert in &mut overview.alerts {
                if let Some((id, acknowledged)) = known.get(&(
                    serde_key(alert.kind),
                    alert.metric.clone(),
                    alert.detail.clone(),
                )) {
                    alert.id = id.clone();
                    alert.acknowledged = *acknowledged;
                }
            }
        }
        snapshots
            .save_snapshot(
                round_id,
                "overview",
                &serde_json::to_string(&overview)
                    .map_err(|error| IpcError::from(StoreError::Serde(error)))?,
            )
            .await?;
        snapshots
            .save_snapshot(
                round_id,
                "competitors",
                &serde_json::to_string(&output.competitors)
                    .map_err(|error| IpcError::from(StoreError::Serde(error)))?,
            )
            .await?;
        snapshots
            .save_snapshot(
                round_id,
                "funnel",
                &serde_json::to_string(&output.funnel)
                    .map_err(|error| IpcError::from(StoreError::Serde(error)))?,
            )
            .await?;
        snapshots
            .save_snapshot(
                round_id,
                "engines",
                &serde_json::to_string(&output.engines)
                    .map_err(|error| IpcError::from(StoreError::Serde(error)))?,
            )
            .await?;
        let actions = crate::services::ActionService::new(
            self.pool.clone(),
            self.llm.clone(),
            self.secrets.clone(),
        );
        if let Err(error) = actions.rebuild_actions(project_id, round_id).await {
            tracing::warn!(
                round_id,
                code = error.code.as_str(),
                "action board rebuild stopped with an error"
            );
        }
        Ok(())
    }

    async fn parse_context(&self, round: &CollectionRound) -> Result<ParseContext, IpcError> {
        let project_id = round
            .project_id
            .parse()
            .map_err(|_| GeoError::validation("project_id", "invalid_id"))?;
        let project = ProjectRepo::new(self.pool.clone()).get(project_id).await?;
        let card = EntityCardRepo::new(self.pool.clone())
            .get(project_id)
            .await?;
        let competitors = CompetitorRepo::new(self.pool.clone())
            .list_by_project(project_id)
            .await?;
        let brand = card
            .as_ref()
            .map(|card| card.fields.standard_name.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| project.brand_name.clone());
        let aliases = card
            .as_ref()
            .map(|card| card.fields.aliases.join("、"))
            .unwrap_or_default();
        let ground_truth = card.as_ref().map(render_entity_fields).unwrap_or_else(|| {
            format!(
                "品牌：{}；行业：{}",
                project.brand_name,
                project.industry.label_zh()
            )
        });
        Ok(ParseContext {
            brand,
            aliases: if aliases.is_empty() {
                "无".to_string()
            } else {
                aliases
            },
            ground_truth,
            competitors: competitors
                .iter()
                .map(|competitor| competitor.name.clone())
                .collect(),
        })
    }

    async fn parse_record(
        &self,
        client: &LlmClient,
        context: &ParseContext,
        record: &CollectionRecord,
        answer: &str,
    ) -> Result<(AnswerInsight, Vec<FactCheckIssue>, Vec<Citation>), IpcError> {
        let answer_excerpt: String = answer.chars().take(6_000).collect();
        let competitors = if context.competitors.is_empty() {
            "无".to_string()
        } else {
            context.competitors.join("、")
        };
        let prompt = format!(
            "本品牌：{brand}；别名：{aliases}\n竞品：{competitors}\n实体卡（事实真值）：{ground_truth}\n\
             用户问题：{prompt_text}\n回答原文：{answer}\n\
             请解析这段回答并只输出 JSON：\n\
             {{\"mentions\":[{{\"brand\":\"...\",\"role\":\"self|competitor|other\",\
             \"count\":1,\"sentiment\":\"positive|neutral|negative\",\"rank\":1或null,\
             \"in_comparison_table\":false,\"excerpt\":\"原文片段\"}}],\
             \"self_mentioned\":true,\"self_rank\":1或null,\"self_sentiment\":\"positive|neutral|negative\",\
             \"answer_shape\":{{\"has_conclusion\":true,\"has_table\":false,\"asks_back\":false,\"refused\":false}},\
             \"sources\":[{{\"url\":\"https://...\",\"title\":null,\
             \"type\":\"owned_page|baike|news_media|zhihu|xiaohongshu|ecommerce|official_doc|forum|other\"}}],\
             \"risks\":[\"regulated_claim|absolute_wording|suspected_hallucination|negative_buzz\"],\
             \"issues\":[{{\"kind\":\"wrong|outdated|missing\",\"field_path\":\"price_range\",\
             \"answer_excerpt\":\"原文片段\",\"entity_value\":\"实体卡口径\",\"confidence\":0.9}}],\
             \"confidence\":0.0到1.0}}。\n\
             只把**确实出现在原文里**的品牌/来源/问题写进结果；没有就给空数组。",
            brand = context.brand,
            aliases = context.aliases,
            competitors = competitors,
            ground_truth = context.ground_truth,
            prompt_text = record.prompt_text,
            answer = answer_excerpt,
        );
        let request = ChatRequest::new(vec![
            ChatMessage::system("你是 GEO 回答解析器，只输出 JSON，不输出解释。"),
            ChatMessage::user(prompt),
        ])
        .json();
        let parsed: ParsedAnswer = chat_json(client, &request, |value: &ParsedAnswer| {
            if !(0.0..=1.0).contains(&value.confidence.unwrap_or(0.8)) {
                return Err("confidence_out_of_range".to_string());
            }
            Ok(())
        })
        .await?;

        let mut mentions: Vec<BrandMention> = parsed
            .mentions
            .into_iter()
            .filter(|mention| !mention.brand.trim().is_empty())
            .map(|mention| BrandMention {
                brand: if mention.role == BrandRole::Self_ {
                    context.brand.clone()
                } else {
                    mention.brand.trim().to_string()
                },
                role: mention.role,
                count: mention.count.unwrap_or(1).max(1),
                sentiment: mention.sentiment.unwrap_or(Sentiment::Neutral),
                rank: mention.rank.filter(|rank| *rank >= 1),
                in_comparison_table: mention.in_comparison_table,
                excerpt: mention.excerpt,
            })
            .collect();
        let self_mention = mentions
            .iter()
            .find(|mention| mention.role == BrandRole::Self_)
            .cloned();
        let self_mentioned = parsed.self_mentioned || self_mention.is_some();
        let self_rank = if self_mentioned {
            parsed
                .self_rank
                .filter(|rank| *rank >= 1)
                .or_else(|| self_mention.as_ref().and_then(|mention| mention.rank))
        } else {
            None
        };
        let self_sentiment = if self_mentioned {
            parsed
                .self_sentiment
                .or_else(|| self_mention.as_ref().map(|mention| mention.sentiment))
        } else {
            None
        };
        if let Some(mention) = mentions
            .iter_mut()
            .find(|mention| mention.role == BrandRole::Self_)
        {
            mention.rank = self_rank;
            mention.sentiment = self_sentiment.unwrap_or(Sentiment::Neutral);
        }
        let confidence = parsed.confidence.unwrap_or(0.8).clamp(0.0, 1.0);
        let insight = AnswerInsight {
            id: uuid::Uuid::new_v4().to_string(),
            round_id: record.round_id.clone(),
            record_id: record.id.clone(),
            prompt_id: record.prompt_id.clone(),
            prompt_text: record.prompt_text.clone(),
            engine: record.engine,
            mentions,
            self_mentioned,
            self_rank,
            self_sentiment,
            answer_shape: parsed.answer_shape.unwrap_or_default(),
            source_types: source_type_counts(&parsed.sources),
            confidence,
            needs_review: confidence < REVIEW_CONFIDENCE_FLOOR,
            risks: parsed
                .risks
                .iter()
                .filter_map(|risk| parse_risk(risk))
                .collect(),
            corrected_fields: Vec::new(),
            reviewed_at: None,
        };
        let issues = parsed
            .issues
            .into_iter()
            .filter(|issue| issue.answer_excerpt.trim() != "" || issue.entity_value.trim() != "")
            .map(|issue| FactCheckIssue {
                id: uuid::Uuid::new_v4().to_string(),
                round_id: record.round_id.clone(),
                record_id: record.id.clone(),
                prompt_id: record.prompt_id.clone(),
                prompt_text: record.prompt_text.clone(),
                engine: record.engine,
                kind: issue.kind,
                field_path: if issue.field_path.trim().is_empty() {
                    "unknown".to_string()
                } else {
                    issue.field_path.trim().to_string()
                },
                answer_excerpt: issue.answer_excerpt,
                entity_value: issue.entity_value,
                confidence: issue.confidence.unwrap_or(confidence).clamp(0.0, 1.0),
                status: FactIssueStatus::Open,
                correction_channel: channel_for(&issue.field_path),
                note: None,
                resolved_at: None,
            })
            .collect::<Vec<_>>();
        let citations = parsed
            .sources
            .into_iter()
            .filter_map(citation_of)
            .collect::<Vec<_>>();
        Ok((insight, issues, citations))
    }

    async fn recompute_summary(&self, round_id: &str) -> Result<(), IpcError> {
        let insights = self.insights().insights(round_id).await?;
        let issues = self.insights().fact_issues(round_id).await?;
        let mut by_kind: BTreeMap<FactIssueKind, i64> = BTreeMap::new();
        for issue in &issues {
            *by_kind.entry(issue.kind).or_insert(0) += 1;
        }
        let checked = i64::try_from(insights.len()).unwrap_or(i64::MAX);
        let effective_errors = issues
            .iter()
            .filter(|issue| issue.status != FactIssueStatus::FalsePositive)
            .count();
        let fact_accuracy = if checked > 0 {
            (1.0 - effective_errors as f64 / checked as f64).clamp(0.0, 1.0)
        } else {
            0.0
        };
        self.insights()
            .save_summary(&FactCheckSummary {
                round_id: round_id.to_string(),
                by_kind,
                checked_answers: checked,
                fact_accuracy,
                false_positive_count: i64::try_from(
                    issues
                        .iter()
                        .filter(|issue| issue.status == FactIssueStatus::FalsePositive)
                        .count(),
                )
                .unwrap_or(i64::MAX),
            })
            .await?;
        Ok(())
    }
}

#[derive(Debug, Clone)]
struct ParseContext {
    brand: String,
    aliases: String,
    ground_truth: String,
    competitors: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ParsedAnswer {
    #[serde(default)]
    mentions: Vec<ParsedMention>,
    #[serde(default)]
    self_mentioned: bool,
    #[serde(default)]
    self_rank: Option<i32>,
    #[serde(default)]
    self_sentiment: Option<Sentiment>,
    #[serde(default)]
    answer_shape: Option<AnswerShape>,
    #[serde(default)]
    sources: Vec<ParsedSource>,
    #[serde(default)]
    risks: Vec<String>,
    #[serde(default)]
    issues: Vec<ParsedIssue>,
    #[serde(default)]
    confidence: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct ParsedMention {
    brand: String,
    role: BrandRole,
    #[serde(default)]
    count: Option<i32>,
    #[serde(default)]
    sentiment: Option<Sentiment>,
    #[serde(default)]
    rank: Option<i32>,
    #[serde(default)]
    in_comparison_table: bool,
    #[serde(default)]
    excerpt: String,
}

#[derive(Debug, Deserialize)]
struct ParsedSource {
    url: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    r#type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ParsedIssue {
    kind: FactIssueKind,
    #[serde(default)]
    field_path: String,
    #[serde(default)]
    answer_excerpt: String,
    #[serde(default)]
    entity_value: String,
    #[serde(default)]
    confidence: Option<f64>,
}

fn render_entity_fields(card: &geo_domain::EntityCard) -> String {
    let fields = &card.fields;
    let products = fields
        .products
        .iter()
        .map(|product| {
            if product.params.is_empty() {
                product.name.clone()
            } else {
                format!("{}({})", product.name, product.params.join("、"))
            }
        })
        .collect::<Vec<_>>()
        .join("；");
    format!(
        "标准名称：{}；成立年份：{}；资质：{}；产品：{}；价格区间：{}；服务地域：{}；差异化：{}；官方口径：{}",
        fields.standard_name,
        fields
            .founded_year
            .map(|year| year.to_string())
            .unwrap_or_else(|| "未填写".to_string()),
        if fields.qualifications.is_empty() {
            "未填写".to_string()
        } else {
            fields.qualifications.join("、")
        },
        if products.is_empty() { "未填写".to_string() } else { products },
        fields.price_range.as_deref().unwrap_or("未填写"),
        if fields.service_regions.is_empty() {
            "未填写".to_string()
        } else {
            fields.service_regions.join("、")
        },
        if fields.differentiators.is_empty() {
            "未填写".to_string()
        } else {
            fields.differentiators.join("、")
        },
        fields.official_tone.as_deref().unwrap_or("未填写"),
    )
}

fn parse_risk(raw: &str) -> Option<RiskFlag> {
    match raw.trim() {
        "regulated_claim" => Some(RiskFlag::RegulatedClaim),
        "absolute_wording" => Some(RiskFlag::AbsoluteWording),
        "suspected_hallucination" => Some(RiskFlag::SuspectedHallucination),
        "negative_buzz" => Some(RiskFlag::NegativeBuzz),
        _ => None,
    }
}

fn parse_source_type(raw: &str) -> SourceType {
    match raw.trim() {
        "owned_page" => SourceType::OwnedPage,
        "baike" => SourceType::Baike,
        "news_media" => SourceType::NewsMedia,
        "zhihu" => SourceType::Zhihu,
        "xiaohongshu" => SourceType::Xiaohongshu,
        "ecommerce" => SourceType::Ecommerce,
        "official_doc" => SourceType::OfficialDoc,
        "forum" => SourceType::Forum,
        _ => SourceType::Other,
    }
}

fn source_type_counts(sources: &[ParsedSource]) -> BTreeMap<String, i64> {
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    for source in sources {
        let kind = parse_source_type(source.r#type.as_deref().unwrap_or("other"));
        *counts.entry(source_kind_key(kind)).or_insert(0) += 1;
    }
    counts
}

fn source_kind_key(kind: SourceType) -> String {
    serde_json::to_value(kind)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "other".to_string())
}

fn citation_of(source: ParsedSource) -> Option<Citation> {
    let parsed = url::Url::parse(source.url.trim()).ok()?;
    let domain = parsed.host_str()?.to_string();
    Some(Citation {
        url: parsed.to_string(),
        domain,
        title: source.title,
        source_type: parse_source_type(source.r#type.as_deref().unwrap_or("other")),
    })
}

fn channel_for(field_path: &str) -> CorrectionChannel {
    match field_path.trim() {
        "price_range" | "products" | "qualifications" => CorrectionChannel::OfficialSite,
        "founded_year" => CorrectionChannel::BaikeEntry,
        "service_regions" | "contact" => CorrectionChannel::BusinessDirectory,
        _ => CorrectionChannel::ThirdPartyPage,
    }
}

fn decode_optional_overview(
    raw: Option<String>,
) -> Result<Option<geo_domain::DiagnosisOverview>, IpcError> {
    raw.map(|payload| {
        serde_json::from_str(&payload).map_err(|error| IpcError::from(StoreError::Serde(error)))
    })
    .transpose()
}

fn decode_optional_matrix(
    raw: Option<String>,
) -> Result<Option<geo_domain::CompetitorMatrix>, IpcError> {
    raw.map(|payload| {
        serde_json::from_str(&payload).map_err(|error| IpcError::from(StoreError::Serde(error)))
    })
    .transpose()
}

fn serde_key<T: serde::Serialize>(value: T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

//! M4 解析结果与事实核查仓储（Plan C M3–M7 读路径第二段）。
//!
//! 只提供读取与测试用写入；`insight_correct` / `fact_check_resolve` 仍 demo-only。

use geo_domain::{
    AnswerInsight, AnswerShape, BrandMention, CorrectionChannel, EngineId, FactCheckIssue,
    FactCheckSummary, FactIssueKind, FactIssueStatus, RiskFlag, Sentiment,
};
use sqlx::{FromRow, SqlitePool};

use crate::codec;
use crate::error::StoreError;

const SELECT_INSIGHTS: &str = concat!(
    "SELECT id, round_id, record_id, prompt_id, prompt_text, engine, mentions, self_mentioned, ",
    "self_rank, self_sentiment, answer_shape, source_types, confidence, needs_review, risks, ",
    "corrected_fields, reviewed_at FROM answer_insights WHERE round_id = ? ORDER BY id ASC"
);

const SELECT_ISSUES: &str = concat!(
    "SELECT id, round_id, record_id, prompt_id, prompt_text, engine, kind, field_path, ",
    "answer_excerpt, entity_value, confidence, status, correction_channel, note, resolved_at ",
    "FROM fact_check_issues WHERE round_id = ? ORDER BY kind ASC, id ASC"
);

#[derive(Debug, FromRow)]
struct InsightRow {
    id: String,
    round_id: String,
    record_id: String,
    prompt_id: String,
    prompt_text: String,
    engine: String,
    mentions: String,
    self_mentioned: i64,
    self_rank: Option<i32>,
    self_sentiment: Option<String>,
    answer_shape: String,
    source_types: String,
    confidence: f64,
    needs_review: i64,
    risks: String,
    corrected_fields: String,
    reviewed_at: Option<String>,
}

impl InsightRow {
    fn into_insight(self) -> Result<AnswerInsight, StoreError> {
        Ok(AnswerInsight {
            id: self.id,
            round_id: self.round_id,
            record_id: self.record_id,
            prompt_id: self.prompt_id,
            prompt_text: self.prompt_text,
            engine: codec::decode_scalar::<EngineId>(&self.engine)?,
            mentions: codec::decode_json::<Vec<BrandMention>>(&self.mentions)?,
            self_mentioned: self.self_mentioned != 0,
            self_rank: self.self_rank,
            self_sentiment: match self.self_sentiment {
                Some(raw) => Some(codec::decode_scalar::<Sentiment>(&raw)?),
                None => None,
            },
            answer_shape: codec::decode_json::<AnswerShape>(&self.answer_shape)?,
            source_types: codec::decode_json(&self.source_types)?,
            confidence: self.confidence,
            needs_review: self.needs_review != 0,
            risks: codec::decode_json::<Vec<RiskFlag>>(&self.risks)?,
            corrected_fields: codec::decode_json(&self.corrected_fields)?,
            reviewed_at: match self.reviewed_at {
                Some(raw) => Some(codec::decode_time(&raw)?),
                None => None,
            },
        })
    }
}

#[derive(Debug, FromRow)]
struct IssueRow {
    id: String,
    round_id: String,
    record_id: String,
    prompt_id: String,
    prompt_text: String,
    engine: String,
    kind: String,
    field_path: String,
    answer_excerpt: String,
    entity_value: String,
    confidence: f64,
    status: String,
    correction_channel: String,
    note: Option<String>,
    resolved_at: Option<String>,
}

impl IssueRow {
    fn into_issue(self) -> Result<FactCheckIssue, StoreError> {
        Ok(FactCheckIssue {
            id: self.id,
            round_id: self.round_id,
            record_id: self.record_id,
            prompt_id: self.prompt_id,
            prompt_text: self.prompt_text,
            engine: codec::decode_scalar::<EngineId>(&self.engine)?,
            kind: codec::decode_scalar::<FactIssueKind>(&self.kind)?,
            field_path: self.field_path,
            answer_excerpt: self.answer_excerpt,
            entity_value: self.entity_value,
            confidence: self.confidence,
            status: codec::decode_scalar::<FactIssueStatus>(&self.status)?,
            correction_channel: codec::decode_scalar::<CorrectionChannel>(
                &self.correction_channel,
            )?,
            note: self.note,
            resolved_at: match self.resolved_at {
                Some(raw) => Some(codec::decode_time(&raw)?),
                None => None,
            },
        })
    }
}

#[derive(Debug, Clone)]
pub struct InsightRepo {
    pool: SqlitePool,
}

impl InsightRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insights(&self, round_id: &str) -> Result<Vec<AnswerInsight>, StoreError> {
        let rows = sqlx::query_as::<_, InsightRow>(SELECT_INSIGHTS)
            .bind(round_id)
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(InsightRow::into_insight).collect()
    }

    pub async fn fact_issues(&self, round_id: &str) -> Result<Vec<FactCheckIssue>, StoreError> {
        let rows = sqlx::query_as::<_, IssueRow>(SELECT_ISSUES)
            .bind(round_id)
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(IssueRow::into_issue).collect()
    }

    pub async fn fact_summary(
        &self,
        round_id: &str,
    ) -> Result<Option<FactCheckSummary>, StoreError> {
        let row = sqlx::query_as::<_, (String, i64, f64, i64)>(
            "SELECT by_kind, checked_answers, fact_accuracy, false_positive_count \
             FROM fact_check_summaries WHERE round_id = ?",
        )
        .bind(round_id)
        .fetch_optional(&self.pool)
        .await?;
        match row {
            Some((by_kind, checked_answers, fact_accuracy, false_positive_count)) => {
                Ok(Some(FactCheckSummary {
                    round_id: round_id.to_string(),
                    by_kind: codec::decode_json(&by_kind)?,
                    checked_answers,
                    fact_accuracy,
                    false_positive_count,
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn insert_insight(&self, insight: &AnswerInsight) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO answer_insights (id, round_id, record_id, prompt_id, prompt_text, ",
            "engine, mentions, self_mentioned, self_rank, self_sentiment, answer_shape, ",
            "source_types, confidence, needs_review, risks, corrected_fields, reviewed_at) ",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(&insight.id)
        .bind(&insight.round_id)
        .bind(&insight.record_id)
        .bind(&insight.prompt_id)
        .bind(&insight.prompt_text)
        .bind(codec::encode_scalar(&insight.engine)?)
        .bind(codec::encode_json(&insight.mentions)?)
        .bind(i64::from(insight.self_mentioned))
        .bind(insight.self_rank)
        .bind(
            insight
                .self_sentiment
                .map(|value| codec::encode_scalar(&value))
                .transpose()?,
        )
        .bind(codec::encode_json(&insight.answer_shape)?)
        .bind(codec::encode_json(&insight.source_types)?)
        .bind(insight.confidence)
        .bind(i64::from(insight.needs_review))
        .bind(codec::encode_json(&insight.risks)?)
        .bind(codec::encode_json(&insight.corrected_fields)?)
        .bind(insight.reviewed_at.map(|value| codec::encode_time(&value)))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn insert_issue(&self, issue: &FactCheckIssue) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO fact_check_issues (id, round_id, record_id, prompt_id, prompt_text, ",
            "engine, kind, field_path, answer_excerpt, entity_value, confidence, status, ",
            "correction_channel, note, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(&issue.id)
        .bind(&issue.round_id)
        .bind(&issue.record_id)
        .bind(&issue.prompt_id)
        .bind(&issue.prompt_text)
        .bind(codec::encode_scalar(&issue.engine)?)
        .bind(codec::encode_scalar(&issue.kind)?)
        .bind(&issue.field_path)
        .bind(&issue.answer_excerpt)
        .bind(&issue.entity_value)
        .bind(issue.confidence)
        .bind(codec::encode_scalar(&issue.status)?)
        .bind(codec::encode_scalar(&issue.correction_channel)?)
        .bind(&issue.note)
        .bind(issue.resolved_at.map(|value| codec::encode_time(&value)))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn insert_summary(&self, summary: &FactCheckSummary) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO fact_check_summaries (round_id, by_kind, checked_answers, ",
            "fact_accuracy, false_positive_count) VALUES (?, ?, ?, ?, ?)"
        ))
        .bind(&summary.round_id)
        .bind(codec::encode_json(&summary.by_kind)?)
        .bind(summary.checked_answers)
        .bind(summary.fact_accuracy)
        .bind(summary.false_positive_count)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

//! M3 采集读模型仓储（Plan C M3–M7 读路径第一段）。
//!
//! 只提供读取与测试用写入；采集写路径（启动 / 重跑）仍 demo-only。

use geo_domain::{
    Citation, CollectionRecord, CollectionRecordDetail, CollectionRound, CollectionStatus,
    CollectionTask, EngineChannel, EngineId, EngineRun, FailureReason, IntentCategory, RoundStatus,
    SampleSizeGrade, Sentiment, SourceType,
};
use sqlx::{FromRow, SqlitePool};

use crate::codec;
use crate::error::StoreError;

const SELECT_ROUNDS: &str = concat!(
    "SELECT id, project_id, prompt_set_id, prompt_set_label, prompt_set_version, label, ",
    "round_index, status, engine_scope, repeat_count, planned_queries, completed_queries, ",
    "failed_queries, success_rate, started_at, finished_at, metric_spec_version, ",
    "sample_size_grade, notes FROM collection_rounds WHERE project_id = ? ",
    "ORDER BY round_index ASC, id ASC"
);

const SELECT_ROUND: &str = concat!(
    "SELECT id, project_id, prompt_set_id, prompt_set_label, prompt_set_version, label, ",
    "round_index, status, engine_scope, repeat_count, planned_queries, completed_queries, ",
    "failed_queries, success_rate, started_at, finished_at, metric_spec_version, ",
    "sample_size_grade, notes FROM collection_rounds WHERE id = ?"
);

const SELECT_RECORDS: &str = concat!(
    "SELECT id, round_id, prompt_id, prompt_text, intent, engine, model, channel, status, ",
    "failure_reason, mentioned, rank, sentiment, citation_count, collected_at, latency_ms, ",
    "prompt_tokens, completion_tokens, repeat_index, answer_text, screenshot_path ",
    "FROM collection_records WHERE round_id = ? ORDER BY collected_at DESC, id ASC"
);

#[derive(Debug, FromRow)]
struct RoundRow {
    id: String,
    project_id: String,
    prompt_set_id: String,
    prompt_set_label: String,
    prompt_set_version: i32,
    label: String,
    round_index: i32,
    status: String,
    engine_scope: String,
    repeat_count: i32,
    planned_queries: i32,
    completed_queries: i32,
    failed_queries: i32,
    success_rate: f64,
    started_at: Option<String>,
    finished_at: Option<String>,
    metric_spec_version: String,
    sample_size_grade: String,
    notes: Option<String>,
}

impl RoundRow {
    fn into_round(self) -> Result<CollectionRound, StoreError> {
        Ok(CollectionRound {
            id: self.id,
            project_id: self.project_id,
            prompt_set_id: self.prompt_set_id,
            prompt_set_label: self.prompt_set_label,
            prompt_set_version: self.prompt_set_version,
            label: self.label,
            round_index: self.round_index,
            status: codec::decode_scalar::<RoundStatus>(&self.status)?,
            engine_scope: codec::decode_json(&self.engine_scope)?,
            repeat_count: self.repeat_count,
            planned_queries: self.planned_queries,
            completed_queries: self.completed_queries,
            failed_queries: self.failed_queries,
            success_rate: self.success_rate,
            started_at: match self.started_at {
                Some(raw) => Some(codec::decode_time(&raw)?),
                None => None,
            },
            finished_at: match self.finished_at {
                Some(raw) => Some(codec::decode_time(&raw)?),
                None => None,
            },
            metric_spec_version: self.metric_spec_version,
            sample_size_grade: codec::decode_scalar::<SampleSizeGrade>(&self.sample_size_grade)?,
            notes: self.notes,
        })
    }
}

#[derive(Debug, FromRow)]
struct EngineRunRow {
    engine: String,
    channel: String,
    model: String,
    planned: i32,
    succeeded: i32,
    failed: i32,
    avg_latency_ms: i64,
    prompt_tokens: i64,
    completion_tokens: i64,
}

#[derive(Debug, FromRow)]
struct TaskRow {
    id: String,
    round_id: String,
    prompt_id: String,
    prompt_text: String,
    intent: String,
    engine: String,
    channel: String,
    status: String,
    attempt: i32,
    failure_reason: Option<String>,
    record_id: Option<String>,
    queued_at: String,
    finished_at: Option<String>,
    latency_ms: Option<i64>,
}

#[derive(Debug, FromRow)]
struct RecordRow {
    id: String,
    round_id: String,
    prompt_id: String,
    prompt_text: String,
    intent: String,
    engine: String,
    model: String,
    channel: String,
    status: String,
    failure_reason: Option<String>,
    mentioned: i64,
    rank: Option<i32>,
    sentiment: Option<String>,
    citation_count: i32,
    collected_at: String,
    latency_ms: i64,
    prompt_tokens: i64,
    completion_tokens: i64,
    repeat_index: i32,
    answer_text: String,
    screenshot_path: Option<String>,
}

impl RecordRow {
    fn into_record(self) -> Result<CollectionRecord, StoreError> {
        Ok(CollectionRecord {
            id: self.id,
            round_id: self.round_id,
            prompt_id: self.prompt_id,
            prompt_text: self.prompt_text,
            intent: codec::decode_scalar::<IntentCategory>(&self.intent)?,
            engine: codec::decode_scalar::<EngineId>(&self.engine)?,
            model: self.model,
            channel: codec::decode_scalar::<EngineChannel>(&self.channel)?,
            status: codec::decode_scalar::<CollectionStatus>(&self.status)?,
            failure_reason: match self.failure_reason {
                Some(raw) => Some(codec::decode_scalar::<FailureReason>(&raw)?),
                None => None,
            },
            mentioned: self.mentioned != 0,
            rank: self.rank,
            sentiment: match self.sentiment {
                Some(raw) => Some(codec::decode_scalar::<Sentiment>(&raw)?),
                None => None,
            },
            citation_count: self.citation_count,
            collected_at: codec::decode_time(&self.collected_at)?,
            latency_ms: self.latency_ms,
            prompt_tokens: self.prompt_tokens,
            completion_tokens: self.completion_tokens,
            repeat_index: self.repeat_index,
        })
    }
}

#[derive(Debug, Clone)]
pub struct CollectionRepo {
    pool: SqlitePool,
}

impl CollectionRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn rounds(&self, project_id: &str) -> Result<Vec<CollectionRound>, StoreError> {
        let rows = sqlx::query_as::<_, RoundRow>(SELECT_ROUNDS)
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(RoundRow::into_round).collect()
    }

    pub async fn round(&self, round_id: &str) -> Result<Option<CollectionRound>, StoreError> {
        let row = sqlx::query_as::<_, RoundRow>(SELECT_ROUND)
            .bind(round_id)
            .fetch_optional(&self.pool)
            .await?;
        row.map(RoundRow::into_round).transpose()
    }

    pub async fn engine_runs(&self, round_id: &str) -> Result<Vec<EngineRun>, StoreError> {
        let rows = sqlx::query_as::<_, EngineRunRow>(
            "SELECT engine, channel, model, planned, succeeded, failed, avg_latency_ms, \
             prompt_tokens, completion_tokens FROM collection_engine_runs WHERE round_id = ? \
             ORDER BY engine ASC",
        )
        .bind(round_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(EngineRun {
                    engine: codec::decode_scalar(&row.engine)?,
                    channel: codec::decode_scalar(&row.channel)?,
                    model: row.model,
                    planned: row.planned,
                    succeeded: row.succeeded,
                    failed: row.failed,
                    avg_latency_ms: row.avg_latency_ms,
                    prompt_tokens: row.prompt_tokens,
                    completion_tokens: row.completion_tokens,
                })
            })
            .collect()
    }

    pub async fn tasks(&self, round_id: &str) -> Result<Vec<CollectionTask>, StoreError> {
        let rows = sqlx::query_as::<_, TaskRow>(
            "SELECT id, round_id, prompt_id, prompt_text, intent, engine, channel, status, \
             attempt, failure_reason, record_id, queued_at, finished_at, latency_ms \
             FROM collection_tasks WHERE round_id = ? ORDER BY queued_at ASC, id ASC",
        )
        .bind(round_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(CollectionTask {
                    id: row.id,
                    round_id: row.round_id,
                    prompt_id: row.prompt_id,
                    prompt_text: row.prompt_text,
                    intent: codec::decode_scalar(&row.intent)?,
                    engine: codec::decode_scalar(&row.engine)?,
                    channel: codec::decode_scalar(&row.channel)?,
                    status: codec::decode_scalar(&row.status)?,
                    attempt: row.attempt,
                    failure_reason: match row.failure_reason {
                        Some(raw) => Some(codec::decode_scalar(&raw)?),
                        None => None,
                    },
                    record_id: row.record_id,
                    queued_at: codec::decode_time(&row.queued_at)?,
                    finished_at: match row.finished_at {
                        Some(raw) => Some(codec::decode_time(&raw)?),
                        None => None,
                    },
                    latency_ms: row.latency_ms,
                })
            })
            .collect()
    }

    pub async fn records(&self, round_id: &str) -> Result<Vec<CollectionRecord>, StoreError> {
        let rows = sqlx::query_as::<_, RecordRow>(SELECT_RECORDS)
            .bind(round_id)
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(RecordRow::into_record).collect()
    }

    pub async fn record(
        &self,
        record_id: &str,
    ) -> Result<Option<CollectionRecordDetail>, StoreError> {
        let row = sqlx::query_as::<_, RecordRow>(concat!(
            "SELECT id, round_id, prompt_id, prompt_text, intent, engine, model, channel, status, ",
            "failure_reason, mentioned, rank, sentiment, citation_count, collected_at, latency_ms, ",
            "prompt_tokens, completion_tokens, repeat_index, answer_text, screenshot_path ",
            "FROM collection_records WHERE id = ?"
        ))
        .bind(record_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else { return Ok(None) };
        let answer_text = row.answer_text.clone();
        let screenshot_path = row.screenshot_path.clone();
        let record = row.into_record()?;
        let rows = sqlx::query_as::<_, (String, String, Option<String>, String)>(
            "SELECT url, domain, title, source_type FROM collection_citations \
             WHERE record_id = ? ORDER BY position ASC",
        )
        .bind(record_id)
        .fetch_all(&self.pool)
        .await?;
        let citations = rows
            .into_iter()
            .map(|(url, domain, title, source_type)| {
                Ok(Citation {
                    url,
                    domain,
                    title,
                    source_type: codec::decode_scalar::<SourceType>(&source_type)?,
                })
            })
            .collect::<Result<Vec<_>, StoreError>>()?;
        Ok(Some(CollectionRecordDetail {
            record,
            answer_text,
            citations,
            screenshot_path,
        }))
    }
    pub async fn insert_round(&self, round: &CollectionRound) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO collection_rounds (id, project_id, prompt_set_id, prompt_set_label, ",
            "prompt_set_version, label, round_index, status, engine_scope, repeat_count, ",
            "planned_queries, completed_queries, failed_queries, success_rate, started_at, ",
            "finished_at, metric_spec_version, sample_size_grade, notes) ",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(&round.id)
        .bind(&round.project_id)
        .bind(&round.prompt_set_id)
        .bind(&round.prompt_set_label)
        .bind(round.prompt_set_version)
        .bind(&round.label)
        .bind(round.round_index)
        .bind(codec::encode_scalar(&round.status)?)
        .bind(codec::encode_json(&round.engine_scope)?)
        .bind(round.repeat_count)
        .bind(round.planned_queries)
        .bind(round.completed_queries)
        .bind(round.failed_queries)
        .bind(round.success_rate)
        .bind(round.started_at.map(|value| codec::encode_time(&value)))
        .bind(round.finished_at.map(|value| codec::encode_time(&value)))
        .bind(&round.metric_spec_version)
        .bind(codec::encode_scalar(&round.sample_size_grade)?)
        .bind(&round.notes)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn task(&self, task_id: &str) -> Result<Option<CollectionTask>, StoreError> {
        let row = sqlx::query_as::<_, TaskRow>(
            "SELECT id, round_id, prompt_id, prompt_text, intent, engine, channel, status, \
             attempt, failure_reason, record_id, queued_at, finished_at, latency_ms \
             FROM collection_tasks WHERE id = ?",
        )
        .bind(task_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(CollectionTask {
                id: row.id,
                round_id: row.round_id,
                prompt_id: row.prompt_id,
                prompt_text: row.prompt_text,
                intent: codec::decode_scalar(&row.intent)?,
                engine: codec::decode_scalar(&row.engine)?,
                channel: codec::decode_scalar(&row.channel)?,
                status: codec::decode_scalar(&row.status)?,
                attempt: row.attempt,
                failure_reason: match row.failure_reason {
                    Some(raw) => Some(codec::decode_scalar(&raw)?),
                    None => None,
                },
                record_id: row.record_id,
                queued_at: codec::decode_time(&row.queued_at)?,
                finished_at: match row.finished_at {
                    Some(raw) => Some(codec::decode_time(&raw)?),
                    None => None,
                },
                latency_ms: row.latency_ms,
            })
        })
        .transpose()
    }

    pub async fn count_records_for(
        &self,
        round_id: &str,
        prompt_id: &str,
        engine: EngineId,
    ) -> Result<i64, StoreError> {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM collection_records WHERE round_id = ? AND prompt_id = ? \
             AND engine = ?",
        )
        .bind(round_id)
        .bind(prompt_id)
        .bind(codec::encode_scalar(&engine)?)
        .fetch_one(&self.pool)
        .await
        .map_err(StoreError::from)
    }

    pub async fn update_round(&self, round: &CollectionRound) -> Result<(), StoreError> {
        let result = sqlx::query(concat!(
            "UPDATE collection_rounds SET status = ?, completed_queries = ?, failed_queries = ?, ",
            "success_rate = ?, started_at = ?, finished_at = ?, sample_size_grade = ?, ",
            "notes = ? WHERE id = ?"
        ))
        .bind(codec::encode_scalar(&round.status)?)
        .bind(round.completed_queries)
        .bind(round.failed_queries)
        .bind(round.success_rate)
        .bind(round.started_at.map(|value| codec::encode_time(&value)))
        .bind(round.finished_at.map(|value| codec::encode_time(&value)))
        .bind(codec::encode_scalar(&round.sample_size_grade)?)
        .bind(&round.notes)
        .bind(&round.id)
        .execute(&self.pool)
        .await?;
        crate::repo::require_found(result.rows_affected(), "collection_round", &round.id)
    }

    pub async fn update_task(&self, task: &CollectionTask) -> Result<(), StoreError> {
        let result = sqlx::query(concat!(
            "UPDATE collection_tasks SET status = ?, attempt = ?, failure_reason = ?, ",
            "record_id = ?, finished_at = ?, latency_ms = ? WHERE id = ?"
        ))
        .bind(codec::encode_scalar(&task.status)?)
        .bind(task.attempt)
        .bind(
            task.failure_reason
                .map(|value| codec::encode_scalar(&value))
                .transpose()?,
        )
        .bind(&task.record_id)
        .bind(task.finished_at.map(|value| codec::encode_time(&value)))
        .bind(task.latency_ms)
        .bind(&task.id)
        .execute(&self.pool)
        .await?;
        crate::repo::require_found(result.rows_affected(), "collection_task", &task.id)
    }

    pub async fn upsert_engine_run(
        &self,
        round_id: &str,
        run: &EngineRun,
    ) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO collection_engine_runs (round_id, engine, channel, model, planned, ",
            "succeeded, failed, avg_latency_ms, prompt_tokens, completion_tokens) ",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(round_id, engine) DO UPDATE SET ",
            "channel = excluded.channel, model = excluded.model, planned = excluded.planned, ",
            "succeeded = excluded.succeeded, failed = excluded.failed, ",
            "avg_latency_ms = excluded.avg_latency_ms, prompt_tokens = excluded.prompt_tokens, ",
            "completion_tokens = excluded.completion_tokens"
        ))
        .bind(round_id)
        .bind(codec::encode_scalar(&run.engine)?)
        .bind(codec::encode_scalar(&run.channel)?)
        .bind(&run.model)
        .bind(run.planned)
        .bind(run.succeeded)
        .bind(run.failed)
        .bind(run.avg_latency_ms)
        .bind(run.prompt_tokens)
        .bind(run.completion_tokens)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn insert_engine_run(
        &self,
        round_id: &str,
        run: &EngineRun,
    ) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO collection_engine_runs (round_id, engine, channel, model, planned, ",
            "succeeded, failed, avg_latency_ms, prompt_tokens, completion_tokens) ",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(round_id)
        .bind(codec::encode_scalar(&run.engine)?)
        .bind(codec::encode_scalar(&run.channel)?)
        .bind(&run.model)
        .bind(run.planned)
        .bind(run.succeeded)
        .bind(run.failed)
        .bind(run.avg_latency_ms)
        .bind(run.prompt_tokens)
        .bind(run.completion_tokens)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn insert_task(&self, task: &CollectionTask) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO collection_tasks (id, round_id, prompt_id, prompt_text, intent, engine, ",
            "channel, status, attempt, failure_reason, record_id, queued_at, finished_at, ",
            "latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(&task.id)
        .bind(&task.round_id)
        .bind(&task.prompt_id)
        .bind(&task.prompt_text)
        .bind(codec::encode_scalar(&task.intent)?)
        .bind(codec::encode_scalar(&task.engine)?)
        .bind(codec::encode_scalar(&task.channel)?)
        .bind(codec::encode_scalar(&task.status)?)
        .bind(task.attempt)
        .bind(
            task.failure_reason
                .map(|value| codec::encode_scalar(&value))
                .transpose()?,
        )
        .bind(&task.record_id)
        .bind(codec::encode_time(&task.queued_at))
        .bind(task.finished_at.map(|value| codec::encode_time(&value)))
        .bind(task.latency_ms)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn insert_record(&self, detail: &CollectionRecordDetail) -> Result<(), StoreError> {
        let record = &detail.record;
        let mut transaction = self.pool.begin().await?;
        sqlx::query(concat!(
            "INSERT INTO collection_records (id, round_id, prompt_id, prompt_text, intent, ",
            "engine, model, channel, status, failure_reason, mentioned, rank, sentiment, ",
            "citation_count, collected_at, latency_ms, prompt_tokens, completion_tokens, ",
            "repeat_index, answer_text, screenshot_path) ",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(&record.id)
        .bind(&record.round_id)
        .bind(&record.prompt_id)
        .bind(&record.prompt_text)
        .bind(codec::encode_scalar(&record.intent)?)
        .bind(codec::encode_scalar(&record.engine)?)
        .bind(&record.model)
        .bind(codec::encode_scalar(&record.channel)?)
        .bind(codec::encode_scalar(&record.status)?)
        .bind(
            record
                .failure_reason
                .map(|value| codec::encode_scalar(&value))
                .transpose()?,
        )
        .bind(i64::from(record.mentioned))
        .bind(record.rank)
        .bind(
            record
                .sentiment
                .map(|value| codec::encode_scalar(&value))
                .transpose()?,
        )
        .bind(record.citation_count)
        .bind(codec::encode_time(&record.collected_at))
        .bind(record.latency_ms)
        .bind(record.prompt_tokens)
        .bind(record.completion_tokens)
        .bind(record.repeat_index)
        .bind(&detail.answer_text)
        .bind(&detail.screenshot_path)
        .execute(&mut *transaction)
        .await?;
        for (position, citation) in detail.citations.iter().enumerate() {
            sqlx::query(concat!(
                "INSERT INTO collection_citations (record_id, position, url, domain, title, ",
                "source_type) VALUES (?, ?, ?, ?, ?, ?)"
            ))
            .bind(&record.id)
            .bind(i32::try_from(position).unwrap_or(0))
            .bind(&citation.url)
            .bind(&citation.domain)
            .bind(&citation.title)
            .bind(codec::encode_scalar(&citation.source_type)?)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }
    /// 解析后覆盖一条记录的引用（先删后插入，位置从 0 开始）。
    pub async fn replace_citations(
        &self,
        record_id: &str,
        citations: &[Citation],
    ) -> Result<(), StoreError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("DELETE FROM collection_citations WHERE record_id = ?")
            .bind(record_id)
            .execute(&mut *transaction)
            .await?;
        for (position, citation) in citations.iter().enumerate() {
            sqlx::query(concat!(
                "INSERT INTO collection_citations (record_id, position, url, domain, title, ",
                "source_type) VALUES (?, ?, ?, ?, ?, ?)"
            ))
            .bind(record_id)
            .bind(i32::try_from(position).unwrap_or(0))
            .bind(&citation.url)
            .bind(&citation.domain)
            .bind(&citation.title)
            .bind(codec::encode_scalar(&citation.source_type)?)
            .execute(&mut *transaction)
            .await?;
        }
        sqlx::query("UPDATE collection_records SET citation_count = ? WHERE id = ?")
            .bind(i32::try_from(citations.len()).unwrap_or(i32::MAX))
            .bind(record_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    /// 证据附录用：一次取回 id → 回答全文，避免逐条 record_get 的 N+1。
    pub async fn answer_texts(&self, round_id: &str) -> Result<Vec<(String, String)>, StoreError> {
        let rows = sqlx::query_as::<_, (String, String)>(
            "SELECT id, answer_text FROM collection_records WHERE round_id = ?",
        )
        .bind(round_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }
}

//! M3 多引擎采集读路径服务（Plan C M3–M7 第一段）。
//!
//! 四条命令：`collection_board` / `collection_round_get` / `collection_record_list` /
//! `collection_record_get`。采集写路径（`collection_start` / `collection_task_retry`）仍 demo-only。
//!
//! 用量看板只从引擎执行汇总**求和**（查询数 + token），不做金额估算（DR-8）。

use geo_domain::{
    CollectionBoard, CollectionRound, CollectionRoundDetail, GeoError, ProjectId, RecordFilter,
    UsageBoard, UsageRow,
};
use geo_store::{CollectionRepo, ProjectRepo};
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct CollectionService {
    pool: SqlitePool,
}

impl CollectionService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone())
    }

    fn collection(&self) -> CollectionRepo {
        CollectionRepo::new(self.pool.clone())
    }

    fn projects(&self) -> ProjectRepo {
        ProjectRepo::new(self.pool.clone())
    }

    async fn require_project(&self, project_id: ProjectId) -> Result<(), IpcError> {
        self.projects().get(project_id).await?;
        Ok(())
    }

    async fn require_round(&self, round_id: &str) -> Result<CollectionRound, IpcError> {
        match self.collection().round(round_id).await? {
            Some(round) => Ok(round),
            None => Err(GeoError::validation("round_id", "invalid_id")
                .with_param("value", round_id)
                .into()),
        }
    }

    pub async fn board(&self, project_id: ProjectId) -> Result<CollectionBoard, IpcError> {
        self.require_project(project_id).await?;
        let rounds = self.collection().rounds(&project_id.to_string()).await?;
        let mut rows = Vec::with_capacity(rounds.len());
        for round in &rounds {
            let runs = self.collection().engine_runs(&round.id).await?;
            let prompt_tokens: i64 = runs.iter().map(|run| run.prompt_tokens).sum();
            let completion_tokens: i64 = runs.iter().map(|run| run.completion_tokens).sum();
            rows.push(UsageRow {
                round_id: round.id.clone(),
                round_label: round.label.clone(),
                queries: i64::from(round.completed_queries + round.failed_queries),
                prompt_tokens,
                completion_tokens,
                total_tokens: prompt_tokens + completion_tokens,
            });
        }
        let total_queries = rows.iter().map(|row| row.queries).sum();
        let total_tokens = rows.iter().map(|row| row.total_tokens).sum();
        Ok(CollectionBoard {
            rounds,
            usage: UsageBoard {
                project_id: project_id.to_string(),
                rows,
                total_queries,
                total_tokens,
                quota_queries: None,
                quota_tokens: None,
                quota_exceeded: false,
            },
        })
    }

    pub async fn round_get(&self, round_id: String) -> Result<CollectionRoundDetail, IpcError> {
        let round = self.require_round(&round_id).await?;
        Ok(CollectionRoundDetail {
            engines: self.collection().engine_runs(&round_id).await?,
            tasks: self.collection().tasks(&round_id).await?,
            round,
        })
    }

    pub async fn record_list(
        &self,
        round_id: String,
        filter: RecordFilter,
    ) -> Result<Vec<geo_domain::CollectionRecord>, IpcError> {
        self.require_round(&round_id).await?;
        Ok(self
            .collection()
            .records(&round_id)
            .await?
            .into_iter()
            .filter(|record| record.matches(&filter))
            .collect())
    }

    pub async fn record_get(
        &self,
        record_id: String,
    ) -> Result<geo_domain::CollectionRecordDetail, IpcError> {
        match self.collection().record(&record_id).await? {
            Some(detail) => Ok(detail),
            None => Err(GeoError::validation("record_id", "invalid_id")
                .with_param("value", record_id)
                .into()),
        }
    }
}

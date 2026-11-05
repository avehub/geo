//! M4 解析与核查读路径服务（Plan C M3–M7 读路径第二段）。
//!
//! 两条命令：`insight_list` / `fact_check_list`。纠正与结办仍 demo-only。

use geo_domain::{AnswerInsight, FactCheckBoard, GeoError, InsightFilter};
use geo_store::{CollectionRepo, InsightRepo};
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct InsightService {
    pool: SqlitePool,
}

impl InsightService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone())
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
}

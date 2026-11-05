//! M5 诊断四视图读路径服务（Plan C M3–M7 读路径）。
//!
//! 快照按轮次整份读出；缺失时 overview / competitors / funnel 回 `null`、engines 回 `[]`。

use geo_domain::{CompetitorMatrix, DiagnosisOverview, EngineScore, GeoError, IntentFunnel};
use geo_store::{CollectionRepo, DiagnosisRepo, StoreError};
use serde::de::DeserializeOwned;
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct DiagnosisService {
    pool: SqlitePool,
}

impl DiagnosisService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone())
    }

    fn snapshots(&self) -> DiagnosisRepo {
        DiagnosisRepo::new(self.pool.clone())
    }

    async fn require_round(&self, round_id: &str) -> Result<(), IpcError> {
        match CollectionRepo::new(self.pool.clone())
            .round(round_id)
            .await?
        {
            Some(_) => Ok(()),
            None => Err(GeoError::validation("round_id", "invalid_id")
                .with_param("value", round_id)
                .into()),
        }
    }

    pub async fn overview(&self, round_id: String) -> Result<Option<DiagnosisOverview>, IpcError> {
        self.require_round(&round_id).await?;
        decode(self.snapshots().snapshot(&round_id, "overview").await?)
    }

    pub async fn competitors(
        &self,
        round_id: String,
    ) -> Result<Option<CompetitorMatrix>, IpcError> {
        self.require_round(&round_id).await?;
        decode(self.snapshots().snapshot(&round_id, "competitors").await?)
    }

    pub async fn funnel(&self, round_id: String) -> Result<Option<IntentFunnel>, IpcError> {
        self.require_round(&round_id).await?;
        decode(self.snapshots().snapshot(&round_id, "funnel").await?)
    }

    pub async fn engines(&self, round_id: String) -> Result<Vec<EngineScore>, IpcError> {
        self.require_round(&round_id).await?;
        Ok(
            decode::<Vec<EngineScore>>(self.snapshots().snapshot(&round_id, "engines").await?)?
                .unwrap_or_default(),
        )
    }
}

fn decode<T: DeserializeOwned>(raw: Option<String>) -> Result<Option<T>, IpcError> {
    match raw {
        Some(payload) => {
            Ok(Some(serde_json::from_str(&payload).map_err(|error| {
                IpcError::from(StoreError::Serde(error))
            })?))
        }
        None => Ok(None),
    }
}

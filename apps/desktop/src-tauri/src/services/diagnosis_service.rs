//! M5 诊断四视图读路径服务（Plan C M3–M7 读路径）。
//!
//! 快照按轮次整份读出；缺失时 overview / competitors / funnel 回 `null`、engines 回 `[]`。
//! 告警已读只改 overview 快照里的那一条（写路径落地后再拆关系表）。

use geo_domain::{
    AlertItem, CompetitorMatrix, DiagnosisOverview, EngineScore, GeoError, IntentFunnel,
};
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

    /// 标记告警已读 / 取消已读。告警只存在于 overview 快照里，按 alert id 扫快照并写回。
    pub async fn acknowledge_alert(
        &self,
        alert_id: String,
        acknowledged: bool,
    ) -> Result<AlertItem, IpcError> {
        for (round_id, payload) in self.snapshots().snapshots_of_kind("overview").await? {
            let mut overview: DiagnosisOverview = serde_json::from_str(&payload)
                .map_err(|error| IpcError::from(StoreError::Serde(error)))?;
            if let Some(index) = overview
                .alerts
                .iter()
                .position(|alert| alert.id == alert_id)
            {
                overview.alerts[index].acknowledged = acknowledged;
                let alert = overview.alerts[index].clone();
                let next = serde_json::to_string(&overview)
                    .map_err(|error| IpcError::from(StoreError::Serde(error)))?;
                self.snapshots()
                    .save_snapshot(&round_id, "overview", &next)
                    .await?;
                return Ok(alert);
            }
        }
        Err(GeoError::validation("alert_id", "invalid_id")
            .with_param("value", alert_id)
            .into())
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

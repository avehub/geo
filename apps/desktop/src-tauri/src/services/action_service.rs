//! M6 行动中心读路径服务（Plan C M3–M7 读路径）。
//!
//! 看板按项目整份读出；没有快照时回空数组，而不是报错。

use geo_domain::{ActionBoard, ProjectId};
use geo_store::{DiagnosisRepo, ProjectRepo};
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct ActionService {
    pool: SqlitePool,
}

impl ActionService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone())
    }

    pub async fn board(&self, project_id: ProjectId) -> Result<ActionBoard, IpcError> {
        ProjectRepo::new(self.pool.clone()).get(project_id).await?;
        let payload = DiagnosisRepo::new(self.pool.clone())
            .action_board(&project_id.to_string())
            .await?;
        match payload {
            Some(payload) => Ok(serde_json::from_str(&payload)
                .map_err(|error| IpcError::from(geo_store::StoreError::Serde(error)))?),
            None => Ok(ActionBoard {
                actions: Vec::new(),
                attribution: Vec::new(),
                contents: Vec::new(),
                templates: Vec::new(),
            }),
        }
    }
}

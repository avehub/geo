//! M6 行动中心读路径服务（Plan C M3–M7 读路径）。
//!
//! 看板按项目整份读出；没有快照时回空数组，而不是报错。

use chrono::Utc;
use geo_domain::{
    ActionBoard, ActionItem, ActionStatus, ContentStatus, GeneratedContent, GeoError, ProjectId,
};
use geo_store::{DiagnosisRepo, ProjectRepo, StoreError};
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
    /// 翻处方状态：`done` 首次完成时盖 `completed_at`，回退时清掉；`updated_at` 每次刷新。
    pub async fn update_action_status(
        &self,
        action_id: String,
        status: ActionStatus,
    ) -> Result<ActionItem, IpcError> {
        let now = Utc::now();
        for (project_id, payload) in self.boards().all_action_boards().await? {
            let mut board: ActionBoard = serde_json::from_str(&payload)
                .map_err(|error| IpcError::from(StoreError::Serde(error)))?;
            if let Some(index) = board
                .actions
                .iter()
                .position(|action| action.id == action_id)
            {
                let action = &mut board.actions[index];
                action.status = status;
                if status == ActionStatus::Done {
                    if action.completed_at.is_none() {
                        action.completed_at = Some(now);
                    }
                } else {
                    action.completed_at = None;
                }
                action.updated_at = now;
                let updated = action.clone();
                self.save_board(&project_id, &board).await?;
                return Ok(updated);
            }
        }
        Err(GeoError::validation("action_id", "invalid_id")
            .with_param("value", action_id)
            .into())
    }

    /// 人工审核一份文稿：只翻状态与 `updated_at`。
    pub async fn update_content_status(
        &self,
        content_id: String,
        status: ContentStatus,
    ) -> Result<GeneratedContent, IpcError> {
        let now = Utc::now();
        for (project_id, payload) in self.boards().all_action_boards().await? {
            let mut board: ActionBoard = serde_json::from_str(&payload)
                .map_err(|error| IpcError::from(StoreError::Serde(error)))?;
            if let Some(index) = board
                .contents
                .iter()
                .position(|content| content.id == content_id)
            {
                let content = &mut board.contents[index];
                content.status = status;
                content.updated_at = now;
                let updated = content.clone();
                self.save_board(&project_id, &board).await?;
                return Ok(updated);
            }
        }
        Err(GeoError::validation("content_id", "invalid_id")
            .with_param("value", content_id)
            .into())
    }

    fn boards(&self) -> DiagnosisRepo {
        DiagnosisRepo::new(self.pool.clone())
    }

    async fn save_board(&self, project_id: &str, board: &ActionBoard) -> Result<(), IpcError> {
        let payload = serde_json::to_string(board)
            .map_err(|error| IpcError::from(StoreError::Serde(error)))?;
        self.boards()
            .save_action_board(project_id, &payload, &Utc::now().to_rfc3339())
            .await?;
        Ok(())
    }
}

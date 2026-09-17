//! M1 实体卡命令：自动建档、读取、字段级编辑与修订历史。

use chrono::Utc;
use geo_domain::{EntityCard, EntityCardRevision, FieldStatus, ProjectId};
use serde_json::Value;
use tauri::State;

use crate::error::IpcError;
use crate::services::EntityCardService;
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn entity_card_autobuild(
    state: State<'_, AppState>,
    project_id: ProjectId,
    domain: String,
) -> Result<EntityCard, IpcError> {
    EntityCardService::from_state(&state)
        .autobuild(project_id, &domain, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn entity_card_get(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<Option<EntityCard>, IpcError> {
    EntityCardService::from_state(&state).get(project_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn entity_card_update_field(
    state: State<'_, AppState>,
    project_id: ProjectId,
    path: String,
    value: Value,
    status: FieldStatus,
    note: Option<String>,
) -> Result<EntityCardRevision, IpcError> {
    EntityCardService::from_state(&state)
        .update_field(project_id, &path, value, status, note, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn entity_card_revisions(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<Vec<EntityCardRevision>, IpcError> {
    EntityCardService::from_state(&state)
        .revisions(project_id)
        .await
}

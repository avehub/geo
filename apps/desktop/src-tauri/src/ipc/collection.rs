//! M3 多引擎采集命令（Plan C M3–M7 读路径第一段）。
//!
//! `collection_start` / `collection_task_retry` 仍留在 demo-only。

use geo_domain::{
    CollectionBoard, CollectionRecord, CollectionRecordDetail, CollectionRoundDetail, ProjectId,
    RecordFilter,
};
use tauri::State;

use crate::error::IpcError;
use crate::services::CollectionService;
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn collection_board(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<CollectionBoard, IpcError> {
    CollectionService::from_state(&state)
        .board(project_id)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn collection_round_get(
    state: State<'_, AppState>,
    round_id: String,
) -> Result<CollectionRoundDetail, IpcError> {
    CollectionService::from_state(&state)
        .round_get(round_id)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn collection_record_list(
    state: State<'_, AppState>,
    round_id: String,
    filter: RecordFilter,
) -> Result<Vec<CollectionRecord>, IpcError> {
    CollectionService::from_state(&state)
        .record_list(round_id, filter)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn collection_record_get(
    state: State<'_, AppState>,
    record_id: String,
) -> Result<CollectionRecordDetail, IpcError> {
    CollectionService::from_state(&state)
        .record_get(record_id)
        .await
}

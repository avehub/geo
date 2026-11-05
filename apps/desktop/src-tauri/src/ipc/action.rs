//! M6 行动中心命令（Plan C M3–M7 读路径）。
//!
//! `content_generate` 调模型成文，产物恒 `pending_review`。

use geo_domain::{
    ActionBoard, ActionItem, ActionStatus, ContentStatus, GeneratedContent, ProjectId,
};
use tauri::State;

use crate::error::IpcError;
use crate::services::ActionService;
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn action_board(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<ActionBoard, IpcError> {
    ActionService::from_state(&state).board(project_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn action_update_status(
    state: State<'_, AppState>,
    action_id: String,
    status: ActionStatus,
) -> Result<ActionItem, IpcError> {
    ActionService::from_state(&state)
        .update_action_status(action_id, status)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn content_update_status(
    state: State<'_, AppState>,
    content_id: String,
    status: ContentStatus,
) -> Result<GeneratedContent, IpcError> {
    ActionService::from_state(&state)
        .update_content_status(content_id, status)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn content_generate(
    state: State<'_, AppState>,
    project_id: ProjectId,
    template_id: String,
    action_id: Option<String>,
) -> Result<GeneratedContent, IpcError> {
    ActionService::from_state(&state)
        .generate_content(project_id, template_id, action_id)
        .await
}

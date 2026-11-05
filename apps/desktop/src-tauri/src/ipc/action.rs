//! M6 行动中心命令（Plan C M3–M7 读路径）。
//!
//! `action_update_status` / `content_generate` / `content_update_status` 仍留在 demo-only。

use geo_domain::{ActionBoard, ProjectId};
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

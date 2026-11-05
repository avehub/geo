//! M4 解析与核查命令（Plan C M3–M7 读路径第二段）。
//!
//! `insight_correct` / `fact_check_resolve` 仍留在 demo-only。

use geo_domain::{AnswerInsight, FactCheckBoard, InsightFilter};
use tauri::State;

use crate::error::IpcError;
use crate::services::InsightService;
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn insight_list(
    state: State<'_, AppState>,
    round_id: String,
    filter: InsightFilter,
) -> Result<Vec<AnswerInsight>, IpcError> {
    InsightService::from_state(&state)
        .insight_list(round_id, filter)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn fact_check_list(
    state: State<'_, AppState>,
    round_id: String,
) -> Result<FactCheckBoard, IpcError> {
    InsightService::from_state(&state)
        .fact_check_list(round_id)
        .await
}

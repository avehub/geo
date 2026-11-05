//! M4 解析与核查命令（Plan C M3–M7 读路径第二段）。
//!

use chrono::Utc;
use geo_domain::{AnswerInsight, FactCheckBoard, FactCheckIssue, InsightCorrection, InsightFilter};
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

#[tauri::command(rename_all = "snake_case")]
pub async fn insight_correct(
    state: State<'_, AppState>,
    id: String,
    correction: InsightCorrection,
) -> Result<AnswerInsight, IpcError> {
    InsightService::from_state(&state)
        .correct_insight(id, correction, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn fact_check_resolve(
    state: State<'_, AppState>,
    id: String,
    status: String,
    note: Option<String>,
) -> Result<FactCheckIssue, IpcError> {
    InsightService::from_state(&state)
        .resolve_fact_issue(id, status, note, Utc::now())
        .await
}

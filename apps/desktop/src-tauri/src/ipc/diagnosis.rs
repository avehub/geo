//! M5 诊断命令（Plan C M3–M7 读路径）。
//!
//! `diagnosis_alert_acknowledge` 仍留在 demo-only。

use geo_domain::{CompetitorMatrix, DiagnosisOverview, EngineScore, IntentFunnel};
use tauri::State;

use crate::error::IpcError;
use crate::services::DiagnosisService;
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn diagnosis_overview(
    state: State<'_, AppState>,
    round_id: String,
) -> Result<Option<DiagnosisOverview>, IpcError> {
    DiagnosisService::from_state(&state)
        .overview(round_id)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn diagnosis_competitors(
    state: State<'_, AppState>,
    round_id: String,
) -> Result<Option<CompetitorMatrix>, IpcError> {
    DiagnosisService::from_state(&state)
        .competitors(round_id)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn diagnosis_funnel(
    state: State<'_, AppState>,
    round_id: String,
) -> Result<Option<IntentFunnel>, IpcError> {
    DiagnosisService::from_state(&state).funnel(round_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn diagnosis_engines(
    state: State<'_, AppState>,
    round_id: String,
) -> Result<Vec<EngineScore>, IpcError> {
    DiagnosisService::from_state(&state).engines(round_id).await
}

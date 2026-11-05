//! M5.5 站长数据命令（Plan C 第五切片第一段）。
//!

use std::collections::BTreeMap;

use chrono::Utc;
use geo_domain::{
    ProjectId, SearchOpportunity, SearchOpportunityId, SearchOpportunityStatus, SearchSource,
    SearchSourceKind,
};
use tauri::State;

use crate::error::IpcError;
use crate::services::{SearchBoardResult, SearchMetricImportResult, SearchService};
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn search_board(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<SearchBoardResult, IpcError> {
    SearchService::from_state(&state).board(project_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn search_source_upsert(
    state: State<'_, AppState>,
    project_id: ProjectId,
    kind: SearchSourceKind,
    binding: BTreeMap<String, String>,
    note: Option<String>,
) -> Result<SearchSource, IpcError> {
    SearchService::from_state(&state)
        .upsert_source(project_id, kind, binding, note, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn search_source_remove(
    state: State<'_, AppState>,
    project_id: ProjectId,
    kind: SearchSourceKind,
) -> Result<Vec<SearchSource>, IpcError> {
    SearchService::from_state(&state)
        .remove_source(project_id, kind)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn search_opportunity_update(
    state: State<'_, AppState>,
    opportunity_id: SearchOpportunityId,
    status: SearchOpportunityStatus,
) -> Result<SearchOpportunity, IpcError> {
    SearchService::from_state(&state)
        .update_opportunity(opportunity_id, status, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn search_source_test(
    state: State<'_, AppState>,
    project_id: ProjectId,
    kind: SearchSourceKind,
) -> Result<SearchSource, IpcError> {
    SearchService::from_state(&state)
        .test_source(project_id, kind, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn search_metric_import_csv(
    state: State<'_, AppState>,
    project_id: ProjectId,
    kind: SearchSourceKind,
    payload: String,
    period_start: String,
    period_end: String,
) -> Result<SearchMetricImportResult, IpcError> {
    SearchService::from_state(&state)
        .import_metrics(
            project_id,
            kind,
            payload,
            period_start,
            period_end,
            Utc::now(),
        )
        .await
}

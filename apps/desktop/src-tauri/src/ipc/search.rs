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
use crate::services::{
    browser_capture, browser_open, SearchBoardResult, SearchBrowserSession,
    SearchMetricImportResult, SearchOAuthStart, SearchService,
};
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn search_board(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<SearchBoardResult, IpcError> {
    SearchService::from_state(&state).board(project_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn search_oauth_begin(
    state: State<'_, AppState>,
    project_id: ProjectId,
    kind: SearchSourceKind,
) -> Result<SearchOAuthStart, IpcError> {
    SearchService::from_state(&state)
        .oauth_begin(project_id, kind)
        .await
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

/// 打开系统 Chrome/Edge（独立 profile）并返回 CDP 地址。
///
/// 🔴 只支持百度站长两个面；不代登录、不注入账号密码、不绕验证码。
/// 返回后 Chrome **保持运行**：用户要继续在同一个窗口里操作。
#[tauri::command(rename_all = "snake_case")]
pub async fn search_browser_open(
    state: State<'_, AppState>,
    project_id: ProjectId,
    kind: SearchSourceKind,
) -> Result<SearchBrowserSession, IpcError> {
    crate::build_flavor::reject_in_store_build("search_browser")?;
    browser_open(&state, project_id, kind).await
}

/// 连接已打开的系统 Chrome，把当前可见表格交给既有导入管线。
///
/// 只读 DOM（`Runtime.evaluate` 之外的私有接口一概不碰），不读 cookie / localStorage。
#[tauri::command(rename_all = "snake_case")]
pub async fn search_browser_capture(
    state: State<'_, AppState>,
    project_id: ProjectId,
    kind: SearchSourceKind,
    ws_url: String,
    period_start: String,
    period_end: String,
) -> Result<SearchMetricImportResult, IpcError> {
    crate::build_flavor::reject_in_store_build("search_browser")?;
    browser_capture(
        &state,
        project_id,
        kind,
        ws_url,
        period_start,
        period_end,
        Utc::now(),
    )
    .await
}

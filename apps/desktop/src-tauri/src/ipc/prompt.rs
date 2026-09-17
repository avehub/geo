//! M2 题库命令：生成、版本快照管理、单条编辑、去重与 CSV 往返。

use chrono::Utc;
use geo_domain::{
    CsvImportResult, DedupeReport, ProjectId, PromptId, PromptItem, PromptSet, PromptSetId,
};
use geo_store::PromptSetSummary;
use tauri::State;

use crate::error::IpcError;
use crate::services::{GenerateOptions, PromptDraft, PromptService};
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn prompt_set_generate(
    state: State<'_, AppState>,
    project_id: ProjectId,
    options: Option<GenerateOptions>,
) -> Result<PromptSet, IpcError> {
    PromptService::from_state(&state)
        .generate(project_id, options.unwrap_or_default(), Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn prompt_set_list(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<Vec<PromptSetSummary>, IpcError> {
    PromptService::from_state(&state).list(project_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn prompt_set_get(
    state: State<'_, AppState>,
    id: PromptSetId,
) -> Result<PromptSet, IpcError> {
    PromptService::from_state(&state).get(id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn prompt_set_rename(
    state: State<'_, AppState>,
    id: PromptSetId,
    label: String,
) -> Result<PromptSetSummary, IpcError> {
    PromptService::from_state(&state).rename(id, &label).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn prompt_set_delete(
    state: State<'_, AppState>,
    id: PromptSetId,
) -> Result<(), IpcError> {
    PromptService::from_state(&state).delete(id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn prompt_item_update(
    state: State<'_, AppState>,
    item: PromptItem,
) -> Result<PromptItem, IpcError> {
    PromptService::from_state(&state).update_item(item).await
}

/// 人工新增条目。返回整份快照：前端直接覆盖缓存，避免自己拼 position。
#[tauri::command(rename_all = "snake_case")]
pub async fn prompt_item_add(
    state: State<'_, AppState>,
    set_id: PromptSetId,
    items: Vec<PromptDraft>,
) -> Result<PromptSet, IpcError> {
    PromptService::from_state(&state)
        .add_items(set_id, items, Utc::now())
        .await
}

/// 批量删除条目。同样返回整份快照（position 与内容哈希都变了）。
#[tauri::command(rename_all = "snake_case")]
pub async fn prompt_item_delete(
    state: State<'_, AppState>,
    set_id: PromptSetId,
    ids: Vec<PromptId>,
) -> Result<PromptSet, IpcError> {
    PromptService::from_state(&state)
        .delete_items(set_id, &ids, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn prompt_set_dedupe(
    state: State<'_, AppState>,
    id: PromptSetId,
) -> Result<DedupeReport, IpcError> {
    PromptService::from_state(&state)
        .dedupe_set(id, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn prompt_set_export_csv(
    state: State<'_, AppState>,
    id: PromptSetId,
) -> Result<String, IpcError> {
    PromptService::from_state(&state).export_csv(id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn prompt_set_import_csv(
    state: State<'_, AppState>,
    id: PromptSetId,
    payload: String,
) -> Result<CsvImportResult, IpcError> {
    PromptService::from_state(&state)
        .import_csv(id, &payload, Utc::now())
        .await
}

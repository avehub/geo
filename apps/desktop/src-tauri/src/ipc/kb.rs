//! M1.2b 知识库命令（Plan C 第三个纵向切片）。
//!
//! `kb_generate` 调模型成文并跑广告法红线扫描。

use chrono::Utc;
use geo_domain::{KbEntry, KbEntryDraft, KbEntryId, ProjectId};
use tauri::State;

use crate::error::IpcError;
use crate::services::{KbBoard, KbGenerateOptions, KbService};
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn kb_board(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<KbBoard, IpcError> {
    KbService::from_state(&state).board(project_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn kb_entry_add(
    state: State<'_, AppState>,
    project_id: ProjectId,
    drafts: Vec<KbEntryDraft>,
) -> Result<Vec<KbEntry>, IpcError> {
    KbService::from_state(&state)
        .add(project_id, drafts, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn kb_entry_update(
    state: State<'_, AppState>,
    entry: KbEntry,
) -> Result<KbEntry, IpcError> {
    KbService::from_state(&state)
        .update(entry, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn kb_entry_delete(
    state: State<'_, AppState>,
    project_id: ProjectId,
    ids: Vec<KbEntryId>,
) -> Result<Vec<KbEntry>, IpcError> {
    KbService::from_state(&state).delete(project_id, ids).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn kb_entry_verify(
    state: State<'_, AppState>,
    project_id: ProjectId,
    ids: Vec<KbEntryId>,
) -> Result<Vec<KbEntry>, IpcError> {
    KbService::from_state(&state)
        .verify(project_id, ids, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn kb_generate(
    state: State<'_, AppState>,
    project_id: ProjectId,
    options: KbGenerateOptions,
) -> Result<Vec<KbEntry>, IpcError> {
    KbService::from_state(&state)
        .generate(project_id, options, Utc::now())
        .await
}

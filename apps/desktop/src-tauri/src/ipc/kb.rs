//! M1.2b 知识库命令（Plan C 第三个纵向切片）。
//!
//! `kb_generate` 仍留在 demo-only 清单，本文件不提供伪造实现。

use chrono::Utc;
use geo_domain::{KbEntry, KbEntryDraft, KbEntryId, ProjectId};
use tauri::State;

use crate::error::IpcError;
use crate::services::{KbBoard, KbService};
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

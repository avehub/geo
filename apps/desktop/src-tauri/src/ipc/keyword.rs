//! M1.5 关键词素材库命令（Plan C 第一个纵向切片）。
//!
//! 只做参数解析与错误映射，业务全在 `services::KeywordService`。
//! `keyword_generate` 仍留在 demo-only 清单，本文件不提供伪造实现。

use chrono::Utc;
use geo_domain::{KeywordDraft, KeywordId, KeywordItem, ProjectId};
use tauri::State;

use crate::error::IpcError;
use crate::services::KeywordService;
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn keyword_list(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<Vec<KeywordItem>, IpcError> {
    KeywordService::from_state(&state).list(project_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn keyword_add(
    state: State<'_, AppState>,
    project_id: ProjectId,
    drafts: Vec<KeywordDraft>,
) -> Result<Vec<KeywordItem>, IpcError> {
    KeywordService::from_state(&state)
        .add(project_id, drafts, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn keyword_update(
    state: State<'_, AppState>,
    item: KeywordItem,
) -> Result<KeywordItem, IpcError> {
    KeywordService::from_state(&state)
        .update(item, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn keyword_delete(
    state: State<'_, AppState>,
    project_id: ProjectId,
    ids: Vec<KeywordId>,
) -> Result<Vec<KeywordItem>, IpcError> {
    KeywordService::from_state(&state)
        .delete(project_id, ids)
        .await
}

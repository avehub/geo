//! M1.5 FAQ 素材库命令（Plan C 第二个纵向切片）。
//!
//! `faq_generate` 调模型成文并跑广告法红线扫描。

use chrono::Utc;
use geo_domain::{FaqDraft, FaqId, FaqItem, ProjectId};
use tauri::State;

use crate::error::IpcError;
use crate::services::{FaqGenerateOptions, FaqService};
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn faq_list(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<Vec<FaqItem>, IpcError> {
    FaqService::from_state(&state).list(project_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn faq_add(
    state: State<'_, AppState>,
    project_id: ProjectId,
    drafts: Vec<FaqDraft>,
) -> Result<Vec<FaqItem>, IpcError> {
    FaqService::from_state(&state)
        .add(project_id, drafts, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn faq_update(state: State<'_, AppState>, item: FaqItem) -> Result<FaqItem, IpcError> {
    FaqService::from_state(&state)
        .update(item, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn faq_delete(
    state: State<'_, AppState>,
    project_id: ProjectId,
    ids: Vec<FaqId>,
) -> Result<Vec<FaqItem>, IpcError> {
    FaqService::from_state(&state).delete(project_id, ids).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn faq_generate(
    state: State<'_, AppState>,
    project_id: ProjectId,
    options: FaqGenerateOptions,
) -> Result<Vec<FaqItem>, IpcError> {
    FaqService::from_state(&state)
        .generate(project_id, options, Utc::now())
        .await
}

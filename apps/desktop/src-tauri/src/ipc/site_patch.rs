//! M6.5 站点补丁台账命令（Plan C 第四切片第二段）。
//!
//! `site_patch_generate` 从行动看板读取处方，调模型生成待审草案。

use chrono::Utc;
use geo_domain::{
    ProjectId, SitePatch, SitePatchDraft, SitePatchEvent, SitePatchId, SitePatchKind,
    SitePatchTransition,
};
use tauri::State;

use crate::error::IpcError;
use crate::services::SitePatchService;
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn site_patch_add(
    state: State<'_, AppState>,
    project_id: ProjectId,
    draft: SitePatchDraft,
) -> Result<SitePatch, IpcError> {
    SitePatchService::from_state(&state)
        .add(project_id, draft, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn site_patch_save(
    state: State<'_, AppState>,
    patch: SitePatch,
) -> Result<SitePatch, IpcError> {
    SitePatchService::from_state(&state)
        .save(patch, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn site_patch_transition(
    state: State<'_, AppState>,
    patch_id: SitePatchId,
    transition: SitePatchTransition,
) -> Result<SitePatch, IpcError> {
    SitePatchService::from_state(&state)
        .transition(patch_id, transition, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn site_patch_history(
    state: State<'_, AppState>,
    patch_id: SitePatchId,
) -> Result<Vec<SitePatchEvent>, IpcError> {
    SitePatchService::from_state(&state).history(patch_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn site_patch_delete(
    state: State<'_, AppState>,
    project_id: ProjectId,
    ids: Vec<SitePatchId>,
) -> Result<Vec<SitePatch>, IpcError> {
    SitePatchService::from_state(&state)
        .delete(project_id, ids)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn site_patch_generate(
    state: State<'_, AppState>,
    project_id: ProjectId,
    action_id: String,
    kinds: Vec<SitePatchKind>,
) -> Result<Vec<SitePatch>, IpcError> {
    SitePatchService::from_state(&state)
        .generate(project_id, action_id, kinds, Utc::now())
        .await
}

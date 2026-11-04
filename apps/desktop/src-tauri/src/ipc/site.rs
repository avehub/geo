//! M6.5 站点档案与下发通道命令（Plan C 第四切片）。
//!
//! `site_channel_test` 与补丁台账仍留在 demo-only 清单，本文件不提供伪造实现。

use chrono::Utc;
use geo_domain::{
    ProjectId, SiteChannel, SiteChannelKind, SiteOwnership, SitePlatform, SiteProfile,
};
use tauri::State;

use crate::error::IpcError;
use crate::services::{SiteBoard, SiteService};
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn site_board(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<SiteBoard, IpcError> {
    SiteService::from_state(&state).board(project_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn site_profile_save(
    state: State<'_, AppState>,
    project_id: ProjectId,
    platform: SitePlatform,
    ownership: SiteOwnership,
    note: Option<String>,
) -> Result<SiteProfile, IpcError> {
    SiteService::from_state(&state)
        .save_profile(project_id, platform, ownership, note, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn site_channel_upsert(
    state: State<'_, AppState>,
    project_id: ProjectId,
    kind: SiteChannelKind,
    endpoint: Option<String>,
    username: Option<String>,
    note: Option<String>,
) -> Result<SiteChannel, IpcError> {
    SiteService::from_state(&state)
        .upsert_channel(project_id, kind, endpoint, username, note, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn site_channel_remove(
    state: State<'_, AppState>,
    project_id: ProjectId,
    kind: SiteChannelKind,
) -> Result<Vec<SiteChannel>, IpcError> {
    SiteService::from_state(&state)
        .remove_channel(project_id, kind)
        .await
}

//! 远程内容（数据面）命令族 —— 12 条。
//!
//! 🔴 12 条命令名与 `apps/desktop/ui/src/api/client.ts` 的 `IPC_COMMANDS` 逐字一致，
//! 参数键名沿用 `rename_all = "snake_case"`。
//!
//! 语义分野：
//! - `remote_sync` 是**唯一**会发网络请求的命令（用户手动点"立即同步"或启动时调用）；
//! - 其余 `remote_*_get/list` 只读本地缓存 + 内置兜底，永不联网
//!   （例外：`remote_rulepack_get` 会按已验签索引里的 digest 懒取一次正文）。
//! - 所有失败都降级为"返回内置版本 + degraded=true"，**不弹错误框**（I-1）。

use serde_json::Value;
use tauri::State;

use crate::error::IpcError;
use crate::services::{
    RemoteEndpointConfig, RemoteJsonItem, RemoteStatus, RemoteTextItem, SyncReport,
};
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn remote_status(state: State<'_, AppState>) -> Result<RemoteStatus, IpcError> {
    state.remote.status().await
}

/// 手动同步。🔴 失败不抛错：返回 `status=unavailable` 的报告，由 UI 展示。
#[tauri::command(rename_all = "snake_case")]
pub async fn remote_sync(state: State<'_, AppState>) -> Result<SyncReport, IpcError> {
    state.remote.sync().await
}

/// 客户端**实际生效**的清单（由缓存重建，不是服务器上那份原文）。
#[tauri::command(rename_all = "snake_case")]
pub async fn remote_manifest_get(state: State<'_, AppState>) -> Result<Value, IpcError> {
    state.remote.effective_manifest().await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn remote_rulepack_list(state: State<'_, AppState>) -> Result<RemoteJsonItem, IpcError> {
    state.remote.rulepack_list().await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn remote_rulepack_get(
    state: State<'_, AppState>,
    engine_code: String,
) -> Result<RemoteJsonItem, IpcError> {
    state.remote.rulepack_get(&engine_code).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn remote_provider_presets(
    state: State<'_, AppState>,
) -> Result<RemoteJsonItem, IpcError> {
    state
        .remote
        .get_json(geo_domain::remote::ItemKey::Providers)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn remote_compliance_terms(
    state: State<'_, AppState>,
) -> Result<RemoteJsonItem, IpcError> {
    state
        .remote
        .get_json(geo_domain::remote::ItemKey::Compliance)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn remote_legal_index(state: State<'_, AppState>) -> Result<RemoteJsonItem, IpcError> {
    state.remote.legal_index().await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn remote_legal_get(
    state: State<'_, AppState>,
    doc_id: String,
    locale: String,
) -> Result<RemoteTextItem, IpcError> {
    state.remote.legal_get(&doc_id, &locale).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn remote_privacy_facts(state: State<'_, AppState>) -> Result<RemoteJsonItem, IpcError> {
    state
        .remote
        .get_json(geo_domain::remote::ItemKey::Privacy)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn remote_notice_list(state: State<'_, AppState>) -> Result<RemoteJsonItem, IpcError> {
    state
        .remote
        .get_json(geo_domain::remote::ItemKey::Notices)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn remote_endpoint_config(
    state: State<'_, AppState>,
) -> Result<RemoteEndpointConfig, IpcError> {
    Ok(state.remote.endpoint_config())
}

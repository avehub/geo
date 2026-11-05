//! 应用设置命令：读写全量设置（代理、并发、频控、模型预设、语言、通知）。

use geo_store::AppSettings;
use tauri::State;

use crate::error::IpcError;
use crate::services::{LlmModelsQuery, ModelsListResult, SettingsService};
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn settings_get(state: State<'_, AppState>) -> Result<AppSettings, IpcError> {
    SettingsService::from_state(&state).get().await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn settings_update(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, IpcError> {
    SettingsService::from_state(&state).update(settings).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn llm_models_list(
    state: State<'_, AppState>,
    query: LlmModelsQuery,
) -> Result<ModelsListResult, IpcError> {
    SettingsService::from_state(&state).list_models(query).await
}

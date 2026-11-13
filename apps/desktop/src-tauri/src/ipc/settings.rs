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

/// 按界面草稿拉模型清单。
///
/// 🔴 IPC 参数必须是**扁平的四个键**（`provider` / `protocol` / `base_url` / `api_key`），
/// 与 `apps/desktop/ui/src/api/client.ts` 的 `llmModelsList` 逐字对齐。曾把整份入参
/// 收成 `query: LlmModelsQuery`，Tauri 便要求外层多一个 `query` 键，桌面端任意服务商
/// 点「拉取模型列表」都会报 `missing required key query`（2026-11-06 用户报障，
/// 回归测试在 `tests/ipc_llm_models_list.rs`）。
#[tauri::command(rename_all = "snake_case")]
pub async fn llm_models_list(
    state: State<'_, AppState>,
    provider: String,
    protocol: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
) -> Result<ModelsListResult, IpcError> {
    let query = LlmModelsQuery {
        provider,
        protocol,
        base_url,
        api_key,
    };
    SettingsService::from_state(&state).list_models(query).await
}

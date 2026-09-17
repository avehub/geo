//! 密钥与模型命令：API Key 存取（只走系统钥匙串）、Provider 预设与连通性测试。
//!
//! 红线（AGENTS.md 规则 3）：命令入参里的 `value` 只往下传给 `SecretStore`，
//! 不写日志、不进错误信息；`secret_status` 的返回类型里根本没有值字段。

use tauri::State;

use crate::error::IpcError;
use crate::services::{LlmTestResult, ProviderInfo, SecretStatus, SettingsService};
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn secret_set(
    state: State<'_, AppState>,
    provider: String,
    value: String,
) -> Result<(), IpcError> {
    SettingsService::from_state(&state)
        .set_secret(&provider, &value)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn secret_status(
    state: State<'_, AppState>,
    provider: String,
) -> Result<SecretStatus, IpcError> {
    SettingsService::from_state(&state)
        .secret_status(&provider)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn secret_delete(state: State<'_, AppState>, provider: String) -> Result<(), IpcError> {
    SettingsService::from_state(&state)
        .delete_secret(&provider)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn llm_provider_test(
    state: State<'_, AppState>,
    provider: String,
) -> Result<LlmTestResult, IpcError> {
    SettingsService::from_state(&state)
        .provider_test(&provider)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn llm_providers(state: State<'_, AppState>) -> Result<Vec<ProviderInfo>, IpcError> {
    Ok(SettingsService::from_state(&state).providers())
}

//! 本机环境命令（`app_environment`）。
//!
//! 路径解析留在 IPC 层（`tauri` 只在这里出现），服务层拿到的是纯 `PathBuf`。

use geo_domain::AppEnvironment;
use tauri::{AppHandle, Manager, State};

use crate::error::IpcError;
use crate::services::{EnvironmentPaths, EnvironmentService};
use crate::state::{AppState, DB_FILE_NAME};

/// 没有 CI 注入构建号时用 `dev`：不编一个看起来像版本号的数字。
const BUILD_NUMBER: &str = match option_env!("GEO_BUILD_NUMBER") {
    Some(value) => value,
    None => "dev",
};

#[tauri::command(rename_all = "snake_case")]
pub async fn app_environment(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppEnvironment, IpcError> {
    let path = app.path();
    let data_dir = path
        .app_data_dir()
        .map_err(|_| IpcError::internal("ipc/internal reason=app_data_dir_unavailable"))?;
    // 与 `lib.rs` 的 `init_logging(&app.path().app_log_dir()?)` 取同一个目录，
    // 保证「设置 → 存储 → 日志目录」指到的就是真的有日志文件的那个地方。
    let log_dir = path
        .app_log_dir()
        .map_err(|_| IpcError::internal("ipc/internal reason=app_log_dir_unavailable"))?;
    let paths = EnvironmentPaths::under(data_dir, DB_FILE_NAME, log_dir);
    let version = app.package_info().version.to_string();
    EnvironmentService::new(state.pool.clone(), paths, version, BUILD_NUMBER)
        .get()
        .await
}

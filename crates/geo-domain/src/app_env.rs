//! 本机环境事实（Plan B 的 `app_environment` 契约，Plan C 落 Rust）。
//!
//! 🔴 本模块只有 DTO，不读文件系统、不查系统权限：路径与字节数由桌面壳采集，
//! 权限状态在没有原生探针时一律 `not_determined`（不冒充 `granted`）。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionState {
    Granted,
    Denied,
    NotDetermined,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Permissions {
    pub notification: PermissionState,
    pub files_and_folders: PermissionState,
    pub screen_recording: PermissionState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppStorageInfo {
    pub data_dir: String,
    pub db_path: String,
    pub db_size_bytes: i64,
    pub screenshots_dir: String,
    pub log_dir: String,
    pub export_dir: Option<String>,
    pub migrations_applied: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppEnvironment {
    pub app_version: String,
    pub build_number: String,
    pub permissions: Permissions,
    pub storage: AppStorageInfo,
}

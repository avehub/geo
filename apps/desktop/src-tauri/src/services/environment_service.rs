//! 本机环境事实服务（`app_environment`）。
//!
//! 路径由桌面壳传入（服务层不依赖 `tauri`），本层只做三件事：
//! 读数据库文件大小、数已应用迁移、把权限状态如实标注。
//!
//! 🔴 权限三项目前**没有原生探针**：通知 / 文件与文件夹 / 屏幕录制都回
//! `not_determined`（"尚未询问"）。回 `granted` 是假声明，回 `unsupported`
//! 也不对——桌面端确实有这些能力，只是还没实现申请与查询。

use std::path::{Path, PathBuf};

use geo_domain::{AppEnvironment, AppStorageInfo, PermissionState, Permissions};
use sqlx::SqlitePool;

use crate::error::IpcError;

#[derive(Debug, Clone)]
pub struct EnvironmentPaths {
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub screenshots_dir: PathBuf,
    pub log_dir: PathBuf,
}

impl EnvironmentPaths {
    pub fn under(data_dir: impl Into<PathBuf>, db_name: &str) -> Self {
        let data_dir = data_dir.into();
        Self {
            db_path: data_dir.join(db_name),
            screenshots_dir: data_dir.join("screenshots"),
            log_dir: data_dir.join("logs"),
            data_dir,
        }
    }
}

#[derive(Debug, Clone)]
pub struct EnvironmentService {
    pool: SqlitePool,
    paths: EnvironmentPaths,
    app_version: String,
    build_number: String,
}

impl EnvironmentService {
    pub fn new(
        pool: SqlitePool,
        paths: EnvironmentPaths,
        app_version: impl Into<String>,
        build_number: impl Into<String>,
    ) -> Self {
        Self {
            pool,
            paths,
            app_version: app_version.into(),
            build_number: build_number.into(),
        }
    }

    pub async fn get(&self) -> Result<AppEnvironment, IpcError> {
        Ok(AppEnvironment {
            app_version: self.app_version.clone(),
            build_number: self.build_number.clone(),
            permissions: unprobed_permissions(),
            storage: AppStorageInfo {
                data_dir: display(&self.paths.data_dir),
                db_path: display(&self.paths.db_path),
                db_size_bytes: file_size(&self.paths.db_path).await,
                screenshots_dir: display(&self.paths.screenshots_dir),
                log_dir: display(&self.paths.log_dir),
                // `AppSettings` 没有 storage 段，桌面端今天没有"上次导出目录"可读。
                export_dir: None,
                migrations_applied: sqlx::query_scalar::<_, i64>(
                    "SELECT COUNT(*) FROM _sqlx_migrations WHERE success = 1",
                )
                .fetch_one(&self.pool)
                .await?,
            },
        })
    }
}

/// 三项权限统一回 `not_determined`：应用还没向系统申请过它们。
fn unprobed_permissions() -> Permissions {
    Permissions {
        notification: PermissionState::NotDetermined,
        files_and_folders: PermissionState::NotDetermined,
        screen_recording: PermissionState::NotDetermined,
    }
}

fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

async fn file_size(path: &Path) -> i64 {
    match tokio::fs::metadata(path).await {
        Ok(metadata) => i64::try_from(metadata.len()).unwrap_or(i64::MAX),
        Err(_) => 0,
    }
}

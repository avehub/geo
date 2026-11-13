//! `app_environment` 服务集成测试：路径、字节数、迁移数与权限口径。

mod support;

use std::path::PathBuf;

use geo_domain::PermissionState;
use geo_store::{AppSettings, SettingsRepo, StorageConfig};
use support::repo_root;

use geo_desktop_lib::services::{EnvironmentPaths, EnvironmentService};
use geo_desktop_lib::state::DB_FILE_NAME;

fn temp_dir(tag: &str) -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("geo-{tag}-{}-{stamp}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("临时目录");
    dir
}

fn migration_count() -> i64 {
    let dir = repo_root().join("crates/geo-store/migrations");
    i64::try_from(
        std::fs::read_dir(dir)
            .expect("迁移目录")
            .filter_map(Result::ok)
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "sql"))
            .count(),
    )
    .expect("迁移数可转换")
}

#[tokio::test]
async fn environment_reports_real_paths_size_and_migrations() {
    let dir = temp_dir("env");
    let log_dir = temp_dir("env-logs");
    let db_path = dir.join(DB_FILE_NAME);
    let pool = geo_store::open(&db_path).await.expect("文件库");
    let export_dir = dir.join("exports").to_string_lossy().into_owned();
    SettingsRepo::new(pool.clone())
        .update(&AppSettings {
            storage: StorageConfig {
                last_export_dir: Some(export_dir.clone()),
            },
            ..AppSettings::default()
        })
        .await
        .expect("写入上次导出目录");
    let service = EnvironmentService::new(
        pool,
        EnvironmentPaths::under(&dir, DB_FILE_NAME, &log_dir),
        "9.9.9",
        "build-1",
    );
    let environment = service.get().await.expect("读环境");
    assert_eq!(environment.app_version, "9.9.9");
    assert_eq!(environment.build_number, "build-1");
    assert_eq!(environment.storage.data_dir, dir.to_string_lossy());
    assert_eq!(environment.storage.db_path, db_path.to_string_lossy());
    assert!(environment.storage.db_size_bytes > 0);
    assert_eq!(environment.storage.migrations_applied, migration_count());
    assert_eq!(
        environment.storage.screenshots_dir,
        dir.join("screenshots").to_string_lossy()
    );
    // 日志目录报的是注入进来的那个，不是 data_dir/logs（两者在 macOS 上不同目录）
    assert_eq!(environment.storage.log_dir, log_dir.to_string_lossy());
    assert_ne!(
        environment.storage.log_dir,
        dir.join("logs").to_string_lossy()
    );
    assert_eq!(
        environment.storage.export_dir.as_deref(),
        Some(export_dir.as_str())
    );
    for state in [
        environment.permissions.notification,
        environment.permissions.files_and_folders,
        environment.permissions.screen_recording,
    ] {
        assert_eq!(state, PermissionState::NotDetermined);
    }
    drop(service);
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&log_dir);
}

/// 防回归（2026-11-11）：`app_environment` 报告的日志目录**必须**来自桌面壳的
/// `app_log_dir()`，不能在服务层从 `data_dir` 拼一个 `logs` 子目录。
///
/// macOS 上两者是不同的地方：`app_data_dir` = `~/Library/Application Support/<id>`，
/// `app_log_dir` = `~/Library/Logs/<id>`。`lib.rs` 的 `init_logging` 写的是后者，
/// 所以设置页照前者显示的路径去找，会看到一个**空目录**——隐私政策里
/// 「彻底删除」的指引也因此不准确。
#[test]
fn log_dir_is_resolved_by_the_desktop_shell_not_derived_from_data_dir() {
    let ipc = include_str!("../src/ipc/environment.rs");
    assert!(
        ipc.contains("app_log_dir"),
        "ipc/environment.rs 必须用 app.path().app_log_dir() 解析日志目录，\
         否则设置页显示的路径与 lib.rs 实际写日志的路径不是同一个"
    );

    // 只判**代码**，不判注释：服务层的文档注释里会解释这个坑，
    // 里面不可避免地出现 `data_dir.join("logs")` 这个字面量。
    let service = include_str!("../src/services/environment_service.rs");
    let code: String = service
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        !code.contains("data_dir.join(\"logs\")"),
        "environment_service.rs 不得再从 data_dir 拼 logs —— log_dir 必须由调用方注入"
    );
}

/// `EnvironmentPaths::under` 现在要求显式传入日志目录：注入什么就报什么，
/// 与 `data_dir` 不再有派生关系。
#[test]
fn environment_paths_reports_the_injected_log_dir_verbatim() {
    let data = temp_dir("env-paths-data");
    let logs = temp_dir("env-paths-logs");
    let paths = EnvironmentPaths::under(&data, DB_FILE_NAME, &logs);
    assert_eq!(paths.log_dir, logs);
    assert_eq!(paths.data_dir, data);
    assert_eq!(paths.db_path, data.join(DB_FILE_NAME));
    assert_eq!(paths.screenshots_dir, data.join("screenshots"));
    assert_ne!(
        paths.log_dir,
        data.join("logs"),
        "log_dir 不得等于 data_dir/logs（那正是本 bug 的成因）"
    );
    let _ = std::fs::remove_dir_all(&data);
    let _ = std::fs::remove_dir_all(&logs);
}

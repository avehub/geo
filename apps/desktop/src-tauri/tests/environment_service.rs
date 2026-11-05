//! `app_environment` 服务集成测试：路径、字节数、迁移数与权限口径。

mod support;

use std::path::PathBuf;

use geo_domain::PermissionState;
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
    let db_path = dir.join(DB_FILE_NAME);
    let pool = geo_store::open(&db_path).await.expect("文件库");
    let service = EnvironmentService::new(
        pool,
        EnvironmentPaths::under(&dir, DB_FILE_NAME),
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
    assert_eq!(
        environment.storage.log_dir,
        dir.join("logs").to_string_lossy()
    );
    assert_eq!(environment.storage.export_dir, None);
    for state in [
        environment.permissions.notification,
        environment.permissions.files_and_folders,
        environment.permissions.screen_recording,
    ] {
        assert_eq!(state, PermissionState::NotDetermined);
    }
    drop(service);
    let _ = std::fs::remove_dir_all(&dir);
}

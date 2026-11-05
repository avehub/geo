//! 稿得快 GEO 客户端桌面壳。
//!
//! 分层：`ipc` 只做 Tauri 命令与 DTO 转换，`services` 负责编排（不依赖 `tauri::*`，
//! 因此集成测试可以直接构造 service 调用，无需启动 WebView）。

pub mod error;
pub mod ipc;
pub mod services;
pub mod state;

use std::path::Path;

use state::AppState;
use tauri::Manager;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

/// 日志文件前缀：实际文件名形如 `gdk-geo.log.2026-09-17`（每日滚动）。
pub const LOG_FILE_PREFIX: &str = "gdk-geo.log";

/// 初始化日志：stdout + 每日滚动文件（写在 Tauri 的 `app_log_dir`），
/// 并把依赖的 `log` 记录桥接进 tracing，保证一个文件里能看到全链路。
///
/// **全局只能有一个 `log` 后端**：`try_init()` 会顺带装上 `LogTracer`，此后
/// 任何再调 `log::set_logger` 的插件（例如 `tauri-plugin-log`）都会初始化失败，
/// 让 `Builder::run` 返回 `Err`、`run()` 直接 panic（P0-A 评审 C1）。
/// 重复调用静默跳过，因此测试与二次初始化都安全。
pub fn init_logging(log_dir: &Path) {
    let file = tracing_appender::rolling::daily(log_dir, LOG_FILE_PREFIX);
    let _ = tracing_subscriber::registry()
        .with(log_filter())
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stdout))
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(file),
        )
        .try_init();
}

/// 日志级别：`GEO_LOG` 优先，其次 `RUST_LOG`，都没有则 `info`。
///
/// 桌面应用不该被宿主 shell 里遗留的 `RUST_LOG=warn` 悄悄降级——诊断日志打包
/// （P0-D）要靠 info 级事件，所以这里给本项目一个独立的开关。
fn log_filter() -> EnvFilter {
    filter_from(
        std::env::var("GEO_LOG").ok().as_deref(),
        std::env::var("RUST_LOG").ok().as_deref(),
    )
}

/// 纯函数版本（便于测试，不碰进程环境）：`GEO_LOG` > `RUST_LOG` > `info`，
/// 语法非法时回落 `info`。指令语法即 `EnvFilter` 语法（`debug`、
/// `geo_desktop_lib=debug,info` 等）。
fn filter_from(geo_log: Option<&str>, rust_log: Option<&str>) -> EnvFilter {
    let directives = geo_log
        .filter(|value| !value.trim().is_empty())
        .or_else(|| rust_log.filter(|value| !value.trim().is_empty()))
        .unwrap_or("info");
    EnvFilter::try_new(directives).unwrap_or_else(|_| EnvFilter::new("info"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 日志先于业务初始化：迁移与钥匙串失败时才有据可查。
            init_logging(&app.path().app_log_dir()?);
            let state = AppState::initialize(app.handle())?;
            app.manage(state);
            // 文章排期：每分钟扫一次已启用且到点的排期（无外部 cron）。
            let article_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let service = {
                    let state = article_handle.state::<AppState>();
                    services::ArticleService::from_state(&state)
                };
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                loop {
                    interval.tick().await;
                    if let Err(error) = service.run_due(chrono::Utc::now()).await {
                        tracing::warn!(code = error.code.as_str(), "article scheduler failed");
                    }
                }
            });
            // 断点续跑：上次退出时停在 queued / running 的轮次，启动后接着跑。
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let service = {
                    let state = handle.state::<AppState>();
                    services::CollectionService::from_state(&state)
                };
                if let Err(error) = service.resume_pending().await {
                    tracing::warn!(
                        code = error.code.as_str(),
                        "resume pending collections failed"
                    );
                }
            });
            Ok(())
        })
        .invoke_handler(ipc::handler())
        .run(tauri::generate_context!())
        .expect("启动 GEO 客户端失败");
}

#[cfg(test)]
mod tests {
    use super::{filter_from, init_logging, LOG_FILE_PREFIX};

    /// 日志初始化必须幂等：`run()` 之外的路径（测试、二次调用）不能 panic。
    #[test]
    fn init_logging_is_idempotent_and_installs_a_global_subscriber() {
        let dir = tempfile::tempdir().expect("临时目录可建");
        init_logging(dir.path());
        init_logging(dir.path());

        // 端到端证明：事件确实经全局 subscriber 落到了滚动文件里。
        // 用 error 级：宿主环境可能带着 `RUST_LOG=warn`，info 会被过滤掉。
        tracing::error!(target: "geo-desktop-test", "LOG_SMOKE_MARKER");
        let files: Vec<String> = std::fs::read_dir(dir.path())
            .expect("日志目录可读")
            .filter_map(|entry| {
                entry
                    .ok()
                    .map(|e| e.file_name().to_string_lossy().into_owned())
            })
            .collect();
        assert!(
            files.iter().any(|name| name.starts_with(LOG_FILE_PREFIX)),
            "应生成 {LOG_FILE_PREFIX}* 日志文件，实际 {files:?}"
        );
        let dumped = files
            .iter()
            .filter_map(|name| std::fs::read_to_string(dir.path().join(name)).ok())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            dumped.contains("LOG_SMOKE_MARKER"),
            "tracing 事件应写进滚动文件，实际内容：{dumped}"
        );
    }

    /// 级别开关：`GEO_LOG` 优先于宿主遗留的 `RUST_LOG`，非法/空值回落 info。
    #[test]
    fn log_filter_prefers_geo_log_and_falls_back_to_info() {
        assert!(filter_from(None, None).to_string().contains("info"));
        assert!(filter_from(None, Some("warn")).to_string().contains("warn"));
        assert!(filter_from(Some("debug"), Some("warn"))
            .to_string()
            .contains("debug"));
        assert!(
            filter_from(Some("geo=不是合法级别"), None)
                .to_string()
                .contains("info"),
            "非法指令要回落到 info，而不是让日志全灭"
        );
        assert!(filter_from(Some("  "), Some("warn"))
            .to_string()
            .contains("warn"));
    }

    /// `init_logging` 用 `try_init()` 把 `log` 桥接进 tracing，因此依赖里
    /// **不能再有第二个 `log` 后端**——否则插件初始化会因
    /// "attempted to set a logger after the logging system was already initialized"
    /// 失败，`run()` 直接 panic（P0-A 收尾评审的 C1）。
    #[test]
    fn manifest_has_no_second_log_backend() {
        let manifest = include_str!("../Cargo.toml");
        assert!(
            !manifest.contains("tauri-plugin-log"),
            "不要重新引入 tauri-plugin-log：它与 tracing 的 log 桥接冲突，会让应用启动即 panic"
        );
        assert!(
            manifest.contains("tracing-appender"),
            "滚动文件日志由 tracing-appender 提供"
        );
    }
}

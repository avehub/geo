//! 稿得快 GEO 客户端桌面壳。
//!
//! 分层：`ipc` 只做 Tauri 命令与 DTO 转换，`services` 负责编排（不依赖 `tauri::*`，
//! 因此集成测试可以直接构造 service 调用，无需启动 WebView）。

pub mod error;
pub mod ipc;
pub mod services;
pub mod state;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = AppState::initialize(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(ipc::handler())
        .run(tauri::generate_context!())
        .expect("启动 GEO 客户端失败");
}

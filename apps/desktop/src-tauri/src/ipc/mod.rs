//! Tauri 命令层：只做参数解析、DTO 转换与错误映射，业务全在 `services`。
//!
//! 所有命令统一 `#[tauri::command(rename_all = "snake_case")]`，
//! 因此前端 `invoke` 的参数键也是 snake_case，与 `src/api/client.ts` 完全对齐。

pub mod entity_card;
pub mod project;
pub mod prompt;
pub mod secret;
pub mod settings;

/// 注册全部 IPC 命令。
pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![]
}

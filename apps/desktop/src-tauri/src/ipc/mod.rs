//! Tauri 命令层：只做参数解析、DTO 转换与错误映射，业务全在 `services`。
//!
//! 所有命令统一 `#[tauri::command(rename_all = "snake_case")]`，
//! 因此前端 `invoke` 的参数键也是 snake_case，与 `src/api/client.ts` 完全对齐。
//! 命令清单以 `client.ts` 的 `IPC_COMMANDS` 为准：漏注册会在前端表现为
//! `ipc/internal` 拒绝，加命令时两边一起改。

pub mod entity_card;
pub mod project;
pub mod prompt;
pub mod secret;
pub mod settings;

/// 注册全部 IPC 命令。
pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        project::project_create,
        project::project_list,
        project::project_get,
        project::project_update,
        project::project_archive,
        project::project_delete,
        project::project_export,
        project::project_import,
        project::competitor_upsert,
        project::competitor_list,
        project::competitor_delete,
        project::competitor_reorder,
        project::asset_add,
        project::asset_list,
        project::asset_delete,
        entity_card::entity_card_autobuild,
        entity_card::entity_card_get,
        entity_card::entity_card_update_field,
        entity_card::entity_card_revisions,
    ]
}

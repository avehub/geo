//! Tauri 命令层：只做参数解析、DTO 转换与错误映射，业务全在 `services`。
//!
//! 所有命令统一 `#[tauri::command(rename_all = "snake_case")]`，
//! 因此前端 `invoke` 的参数键也是 snake_case，与 `src/api/client.ts` 完全对齐。
//! 命令清单以 `client.ts` 的 `IPC_COMMANDS` 为准：漏注册会在前端表现为
//! `ipc/internal` 拒绝，加命令时两边一起改。

pub mod collection;
pub mod entity_card;
pub mod export;
pub mod faq;
pub mod kb;
pub mod keyword;
pub mod project;
pub mod prompt;
pub mod search;
pub mod secret;
pub mod settings;
pub mod site;
pub mod site_patch;

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
        project::project_export_competitors_csv,
        project::project_export_assets_csv,
        project::competitor_upsert,
        project::competitor_list,
        project::competitor_delete,
        project::competitor_reorder,
        project::asset_add,
        project::asset_list,
        project::asset_delete,
        collection::collection_board,
        collection::collection_round_get,
        collection::collection_record_list,
        collection::collection_record_get,
        entity_card::entity_card_autobuild,
        entity_card::entity_card_get,
        entity_card::entity_card_update_field,
        entity_card::entity_card_revisions,
        prompt::prompt_set_generate,
        prompt::prompt_set_list,
        prompt::prompt_set_get,
        prompt::prompt_set_rename,
        prompt::prompt_set_delete,
        prompt::prompt_item_update,
        prompt::prompt_item_add,
        prompt::prompt_item_delete,
        prompt::prompt_set_dedupe,
        prompt::prompt_set_export_csv,
        prompt::prompt_set_import_csv,
        keyword::keyword_list,
        keyword::keyword_add,
        keyword::keyword_update,
        keyword::keyword_delete,
        keyword::keyword_generate,
        kb::kb_board,
        kb::kb_entry_add,
        kb::kb_entry_update,
        kb::kb_entry_delete,
        kb::kb_entry_verify,
        kb::kb_generate,
        faq::faq_list,
        faq::faq_add,
        faq::faq_update,
        faq::faq_delete,
        faq::faq_generate,
        export::export_write_file,
        settings::settings_get,
        settings::settings_update,
        secret::secret_set,
        secret::secret_status,
        secret::secret_delete,
        secret::llm_provider_test,
        secret::llm_providers,
        search::search_board,
        search::search_source_upsert,
        search::search_source_remove,
        search::search_opportunity_update,
        search::search_source_test,
        search::search_metric_import_csv,
        site::site_board,
        site::site_profile_save,
        site::site_channel_upsert,
        site::site_channel_remove,
        site::site_channel_test,
        site_patch::site_patch_add,
        site_patch::site_patch_save,
        site_patch::site_patch_transition,
        site_patch::site_patch_history,
        site_patch::site_patch_delete,
    ]
}

//! 业务编排层。**不依赖 `tauri::*`**，因此集成测试可以直接构造调用，无需启动 WebView。

pub mod entity_card_service;
pub mod faq_service;
pub mod kb_service;
pub mod keyword_service;
pub mod project_service;
pub mod project_transfer;
pub mod prompt_service;
pub mod search_service;
pub mod settings_service;
pub mod site_patch_service;
pub mod site_service;
pub mod templates;

pub use entity_card_service::{EntityCardService, MAX_SITE_TEXT_CHARS};
pub use faq_service::{FaqGenerateOptions, FaqService};
pub use kb_service::{KbBoard, KbGenerateOptions, KbService};
pub use keyword_service::{KeywordGenerateOptions, KeywordService};
pub use project_service::{ProjectDetail, ProjectService};
pub use project_transfer::{ImportReport, ProjectExport, EXPORT_FORMAT_VERSION};
pub use prompt_service::{GenerateOptions, PromptDraft, PromptService, DEFAULT_TARGET_COUNT};
pub use search_service::{SearchBoardResult, SearchService};
pub use settings_service::{
    active_proxy, LlmTestResult, ProviderInfo, SecretStatus, SettingsService, SECRET_KIND,
};
pub use site_patch_service::SitePatchService;
pub use site_service::{SiteBoard, SiteService};

use geo_domain::compliance;

use crate::error::{err_codes, IpcError};

/// 素材生成条数：与前端 `LIBRARY_GENERATE_MIN..MAX` 同一档（1..=20）。
pub(crate) const LIBRARY_GENERATE_MIN: u16 = 1;
pub(crate) const LIBRARY_GENERATE_MAX: u16 = 20;

/// 生成条数一律夹到 1..=20（spec §6），不做「0 条」或「一次 100 条」。
pub(crate) fn clamp_generate_target(value: u16) -> u16 {
    value.clamp(LIBRARY_GENERATE_MIN, LIBRARY_GENERATE_MAX)
}

/// `compliance/violation` 的 `terms`：命中的红线词（数据，不是文案），去重排序。
pub(crate) fn violation_terms(text: &str) -> String {
    let mut terms: Vec<String> = compliance::scan(text)
        .into_iter()
        .map(|violation| violation.term)
        .collect();
    terms.sort();
    terms.dedup();
    terms.join("、")
}

/// 生成内容命中广告法红线词时统一发 `compliance/violation`。
pub(crate) fn compliance_violation(text: &str) -> IpcError {
    IpcError::with_params(
        err_codes::COMPLIANCE_VIOLATION,
        [("terms", violation_terms(text).as_str())],
    )
}

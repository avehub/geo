//! 业务编排层。**不依赖 `tauri::*`**，因此集成测试可以直接构造调用，无需启动 WebView。

pub mod entity_card_service;
pub mod faq_service;
pub mod keyword_service;
pub mod project_service;
pub mod project_transfer;
pub mod prompt_service;
pub mod settings_service;
pub mod templates;

pub use entity_card_service::{EntityCardService, MAX_SITE_TEXT_CHARS};
pub use faq_service::FaqService;
pub use keyword_service::KeywordService;
pub use project_service::{ProjectDetail, ProjectService};
pub use project_transfer::{ImportReport, ProjectExport, EXPORT_FORMAT_VERSION};
pub use prompt_service::{GenerateOptions, PromptDraft, PromptService, DEFAULT_TARGET_COUNT};
pub use settings_service::{
    active_proxy, LlmTestResult, ProviderInfo, SecretStatus, SettingsService, SECRET_KIND,
};

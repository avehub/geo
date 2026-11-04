//! GEO 领域模型与纯规则。
//!
//! 约束（见 `AGENTS.md`）：本 crate 不依赖仓库内其他 crate，也不做 IO
//! （不访问网络/数据库/文件系统；当前时间一律由调用方以参数注入）。

pub mod asset;
pub mod compliance;
pub mod csv_io;
pub mod dedupe;
pub mod entity_card;
pub mod error;
pub mod faq;
pub mod ids;
pub mod kb;
pub mod keyword;
pub mod project;
pub mod prompt;

pub use asset::{clean_optional, normalize_url, AssetKind, ProjectAsset};
pub use compliance::{ContentStatus, Violation};
pub use csv_io::{
    assets_to_csv, competitors_to_csv, prompts_from_csv, prompts_to_csv, CsvImportResult,
    CsvRowError, ASSET_CSV_HEADER, COMPETITOR_CSV_HEADER, PROMPT_CSV_HEADER,
};
pub use dedupe::{dedupe, similarity, DedupeReport, RemovedItem, DUPLICATE_THRESHOLD, NGRAM_SIZE};
pub use entity_card::{
    fields_from_draft, Contact, EntityCard, EntityCardRevision, EntityCardSource, EntityFields,
    FieldStatus, ProductSpec, ALL_FIELDS, REQUIRED_FIELDS,
};
pub use error::GeoError;
pub use faq::{FaqDraft, FaqItem};
pub use ids::{
    AssetId, CompetitorId, FaqId, KbEntryId, KeywordId, ProjectId, PromptId, PromptSetId,
    RevisionId,
};
pub use kb::{
    verify_revision, KbEntry, KbEntryDraft, KbEntryKind, KbEntryRevision, KbModule, KbScenario,
    KbSource, KbStats, KB_REVISION_BODY_LIMIT,
};
pub use keyword::{
    KeywordDraft, KeywordItem, KeywordKind, LibrarySource, MAX_DIFFICULTY, MAX_KEYWORD_CHARS,
    MAX_PRIORITY, MIN_PRIORITY,
};
pub use project::{
    Competitor, CompetitorDraft, Industry, Language, Project, ProjectDraft, ProjectStatus,
    MAX_ALIASES, MAX_BRAND_NAME_CHARS, MAX_COMPETITORS, MAX_PROJECT_NAME_CHARS, MAX_TAGS,
};
pub use prompt::{
    content_hash, sample_size_grade, IntentCategory, PromptItem, PromptSet, PromptSource,
    SampleSizeGrade, MAX_PROMPT_CHARS, MAX_REPEAT_COUNT, MAX_WEIGHT, METRIC_SPEC_VERSION,
    MINIMUM_SAMPLE_SIZE, SUFFICIENT_SAMPLE_SIZE,
};

/// 指标口径版本：写入每个 prompt 集快照，保证跨轮次可比。
pub const SPEC_VERSION: &str = "geo-p0a-v1";

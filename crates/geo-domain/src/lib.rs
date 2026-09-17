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
pub mod ids;
pub mod project;
pub mod prompt;

pub use asset::{AssetKind, ProjectAsset};
pub use compliance::{ContentStatus, Violation};
pub use entity_card::{
    Contact, EntityCard, EntityCardRevision, EntityCardSource, EntityFields, FieldStatus,
    ProductSpec, REQUIRED_FIELDS,
};
pub use error::GeoError;
pub use ids::{AssetId, CompetitorId, ProjectId, PromptId, PromptSetId, RevisionId};
pub use project::{Competitor, Industry, Language, Project, ProjectDraft, ProjectStatus};
pub use prompt::{
    IntentCategory, PromptItem, PromptSet, PromptSource, SampleSizeGrade, METRIC_SPEC_VERSION,
};

/// 指标口径版本：写入每个 prompt 集快照，保证跨轮次可比。
pub const SPEC_VERSION: &str = "geo-p0a-v1";

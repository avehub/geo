//! GEO 领域模型与纯规则。
//!
//! 约束（见 `AGENTS.md`）：本 crate 不依赖仓库内其他 crate，也不做 IO
//! （不访问网络/数据库/文件系统；当前时间一律由调用方以参数注入）。

pub mod action;
pub mod action_build;
pub mod app_env;
pub mod article;
pub mod asset;
pub mod check;
pub mod collection;
pub mod compliance;
pub mod csv_io;
pub mod dedupe;
pub mod diagnosis;
pub mod diagnosis_build;
pub mod entity_card;
pub mod error;
pub mod faq;
pub mod ids;
pub mod insight;
pub mod kb;
pub mod keyword;
pub mod project;
pub mod prompt;
pub mod report;
pub mod search;
pub mod search_import;
pub mod search_metrics;
pub mod search_opportunity;
pub mod site;
pub mod site_patch;

pub use action::{
    content_template, content_templates, ActionBoard, ActionCategory, ActionEvent, ActionItem,
    ActionLevel, ActionStatus, AttributionCard, AttributionMetric, AttributionMetricKey,
    ContentTemplate, ContentTemplateKind, ExportFormat, GeneratedContent,
};
pub use action_build::{build_actions, ActionBuildInput};
pub use app_env::{AppEnvironment, AppStorageInfo, PermissionState, Permissions};
pub use article::{
    clamp_article_length, normalize_schedule_time, render_prompt, Article, ArticleDirection,
    ArticleDirectionDraft, ArticleDirectionSource, ArticleDirectionStatus, ArticleFreq,
    ArticleListQuery, ArticleReviewRequest, ArticleSchedule, ArticleScheduleDraft, ArticleSlot,
    ArticleSource, ArticleStatus, ArticleTemplate, ArticleTemplateBindings, ArticleTemplateDraft,
    ARTICLE_LENGTH_MAX, ARTICLE_LENGTH_MIN, ARTICLE_WEEKDAY_MAX, ARTICLE_WEEKDAY_MIN,
};
pub use asset::{clean_optional, normalize_url, AssetKind, ProjectAsset};
pub use check::CheckDetail;
pub use collection::{
    Citation, CollectionBoard, CollectionRecord, CollectionRecordDetail, CollectionRound,
    CollectionRoundDetail, CollectionStatus, CollectionTask, EngineChannel, EngineId, EngineRun,
    FailureReason, RecordFilter, RoundStatus, Sentiment, SourceType, UsageBoard, UsageRow,
};
pub use compliance::{ContentStatus, Violation};
pub use csv_io::{
    assets_to_csv, competitors_to_csv, prompts_from_csv, prompts_to_csv, CsvImportResult,
    CsvRowError, ASSET_CSV_HEADER, COMPETITOR_CSV_HEADER, PROMPT_CSV_HEADER,
};
pub use dedupe::{dedupe, similarity, DedupeReport, RemovedItem, DUPLICATE_THRESHOLD, NGRAM_SIZE};
pub use diagnosis::{
    AlertItem, AlertKind, AlertSeverity, CompetitorMatrix, CompetitorMatrixRow, DiagnosisDimension,
    DiagnosisOverview, DimensionScore, EngineScore, FunnelRow, FunnelStage, IntentFunnel,
    TrendPoint,
};
pub use diagnosis_build::{
    build_diagnosis, DiagnosisInput, DiagnosisOutput, CITATION_BREADTH_TARGET,
    COVERAGE_DROP_THRESHOLD, DIMENSION_WEIGHTS, FACT_ACCURACY_FLOOR, NEGATIVE_RATE_CEILING,
    OVERTAKE_MARGIN,
};
pub use entity_card::{
    fields_from_draft, Contact, EntityCard, EntityCardRevision, EntityCardSource, EntityFields,
    FieldStatus, ProductSpec, ALL_FIELDS, REQUIRED_FIELDS,
};
pub use error::GeoError;
pub use faq::{FaqDraft, FaqItem};
pub use ids::{
    AssetId, CompetitorId, FaqId, KbEntryId, KeywordId, ProjectId, PromptId, PromptSetId,
    RevisionId, SearchAiOverviewId, SearchMetricId, SearchNativeExtraId, SearchOpportunityId,
    SearchSourceId, SiteChannelId, SitePatchEventId, SitePatchId, SiteProfileId,
};
pub use insight::{
    AnswerInsight, AnswerShape, BrandMention, BrandRole, CorrectionChannel, FactCheckBoard,
    FactCheckIssue, FactCheckSummary, FactIssueKind, FactIssueStatus, InsightCorrection,
    InsightFilter, RiskFlag, REVIEW_CONFIDENCE_FLOOR,
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
pub use report::{
    ReportBlock, ReportDocument, ReportMethodology, ReportMetricUnit, ReportRenderOptions,
    ReportSection, ReportVariant, WhiteLabelProfile,
};
pub use search::{
    clean_binding, credentials_state, secret_ref, source_status, SearchAuthMode,
    SearchBindingField, SearchGroup, SearchIngestMode, SearchRegion, SearchSource,
    SearchSourceCatalog, SearchSourceKind, SEARCH_CATALOG,
};
pub use search_import::{
    parse_search_table, ParseInput, ParsedSearchImport, SearchTableError, SearchTableWarning,
    MAPPING_VERSION,
};
pub use search_metrics::{
    SearchAiOverview, SearchCompleteness, SearchNativeExtra, SearchQueryMetric, SearchSurface,
    WindowSource,
};
pub use search_opportunity::{
    build_search_opportunities, SearchActionLevel, SearchOpportunity, SearchOpportunityInput,
    SearchOpportunityStatus, SearchPrescriptionCategory,
};
pub use site::{
    channel_secret_ref, channel_status, page_from_asset, page_role_for_url, SiteChannel,
    SiteChannelKind, SiteChannelStatus, SiteCredentialsState, SiteOwnership, SitePage,
    SitePageRole, SitePlatform, SiteProfile,
};
pub use site_patch::{
    SitePatch, SitePatchDraft, SitePatchEvent, SitePatchEventKind, SitePatchKind, SitePatchStatus,
    SitePatchTransition,
};

/// 指标口径版本：写入每个 prompt 集快照，保证跨轮次可比。
pub const SPEC_VERSION: &str = "geo-p0a-v1";

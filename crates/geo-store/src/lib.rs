//! `geo-store`：SQLite 仓储、迁移与系统钥匙串密钥存储。
//!
//! 约定（见 `AGENTS.md` 与 spec 3.1）：ID 存 UUIDv4 文本，时间存 RFC3339 UTC 文本，
//! 集合/嵌套结构存 `serde_json` 文本，枚举存其 snake_case 序列化值。
//! 领域对象 ↔ 行 的转换全部收敛在本 crate（`geo-domain` 不感知 sqlx）。
//! 密钥永不入库：数据库只存 `secret_ref` 字符串，值由 [`SecretStore`] 存进系统钥匙串。

mod codec;
pub mod db;
pub mod error;
pub mod repo;
pub mod secret;
pub mod settings;

#[cfg(test)]
mod testutil;

pub use db::{open, open_in_memory};
pub use error::StoreError;
pub use repo::{
    AssetRepo, CollectionRepo, CompetitorRepo, EntityCardRepo, FaqRepo, KbRepo, KeywordRepo,
    ProjectFilter, ProjectRepo, PromptSetRepo, PromptSetSummary, SearchMetricRepo, SearchRepo,
    SitePatchRepo, SiteRepo,
};
pub use secret::{
    parse_secret_ref, secret_ref, KeyringSecretStore, MemorySecretStore, SecretStore,
};
pub use settings::{
    AppSettings, ConcurrencyConfig, ModelConfig, NotifyConfig, ProxyConfig, RateLimitConfig,
    SettingsRepo,
};

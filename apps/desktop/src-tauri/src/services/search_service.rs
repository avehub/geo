//! 站长数据服务（M5.5，Plan C 第五切片第一段）。
//!
//! 四条命令：`search_board` / `search_source_upsert` / `search_source_remove` /
//! `search_opportunity_update`。`search_source_test`（需要真实探测与 `check_detail` 契约）
//! 与 `search_metric_import_csv`（CSV / xlsx 解析）仍留在 demo-only。
//!
//! 🔴 本切片只建源与机会状态：指标 / AI 汇总 / C 类留档 / 自建索引 / 流量分布还没有写入路径，
//! `search_board` 对这些字段返回空数组（或 `null`），不伪造种子数据。

use std::collections::BTreeMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use geo_crawler::{CrawlerError, SiteFetcher};
use geo_domain::{
    clean_binding, credentials_state, secret_ref, source_status, CheckDetail, GeoError, ProjectId,
    SearchAuthMode, SearchOpportunity, SearchOpportunityId, SearchOpportunityStatus, SearchSource,
    SearchSourceId, SearchSourceKind, SiteChannelStatus,
};
use geo_store::{ProjectRepo, SearchRepo, StoreError};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct SearchBoardResult {
    pub as_of: String,
    pub sources: Vec<SearchSource>,
    pub metrics: Vec<serde_json::Value>,
    pub ai_overviews: Vec<serde_json::Value>,
    pub native_extras: Vec<serde_json::Value>,
    pub opportunities: Vec<SearchOpportunity>,
    pub self_index_summary: Option<serde_json::Value>,
    pub self_index_snapshots: Vec<serde_json::Value>,
    pub traffic_split: Vec<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct SearchService {
    pool: SqlitePool,
    fetcher: Arc<SiteFetcher>,
}

impl SearchService {
    pub fn new(pool: SqlitePool, fetcher: Arc<SiteFetcher>) -> Self {
        Self { pool, fetcher }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone(), state.fetcher.clone())
    }

    fn search(&self) -> SearchRepo {
        SearchRepo::new(self.pool.clone())
    }

    fn projects(&self) -> ProjectRepo {
        ProjectRepo::new(self.pool.clone())
    }

    async fn require_project(&self, project_id: ProjectId) -> Result<(), IpcError> {
        self.projects().get(project_id).await?;
        Ok(())
    }

    pub async fn board(&self, project_id: ProjectId) -> Result<SearchBoardResult, IpcError> {
        self.require_project(project_id).await?;
        Ok(SearchBoardResult {
            as_of: Utc::now().date_naive().to_string(),
            sources: self.search().sources(project_id).await?,
            metrics: Vec::new(),
            ai_overviews: Vec::new(),
            native_extras: Vec::new(),
            opportunities: self.search().opportunities(project_id).await?,
            self_index_summary: None,
            self_index_snapshots: Vec::new(),
            traffic_split: Vec::new(),
        })
    }

    /// 增改一个源：同 kind 覆盖；改配置清空旧自检结论但保留 `data_through`。
    pub async fn upsert_source(
        &self,
        project_id: ProjectId,
        kind: SearchSourceKind,
        binding: BTreeMap<String, String>,
        note: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<SearchSource, IpcError> {
        self.require_project(project_id).await?;
        let catalog = kind.catalog();
        if catalog.phase != 1 {
            return Err(GeoError::validation("source_kind", "not_allowed")
                .with_param("value", kind.as_str())
                .into());
        }
        let existing = self
            .search()
            .sources(project_id)
            .await?
            .into_iter()
            .find(|source| source.kind == kind);
        let binding = clean_binding(kind, &binding);
        let source = SearchSource {
            id: existing
                .as_ref()
                .map(|source| source.id)
                .unwrap_or_else(SearchSourceId::new),
            project_id,
            kind,
            auth_mode: if catalog.auth_mode == SearchAuthMode::None {
                SearchAuthMode::None
            } else {
                SearchAuthMode::Oauth
            },
            ingest_modes: catalog.ingest_modes.to_vec(),
            status: source_status(kind, &binding),
            region: catalog.region,
            group: catalog.group,
            binding,
            credentials_state: credentials_state(kind),
            secret_ref: secret_ref(kind),
            data_through: existing
                .as_ref()
                .and_then(|source| source.data_through.clone()),
            checked_at: None,
            check_detail: None,
            note: note
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            created_at: existing
                .as_ref()
                .map(|source| source.created_at)
                .unwrap_or(now),
            updated_at: now,
        };
        self.search().upsert_source(&source).await?;
        Ok(source)
    }

    pub async fn remove_source(
        &self,
        project_id: ProjectId,
        kind: SearchSourceKind,
    ) -> Result<Vec<SearchSource>, IpcError> {
        self.require_project(project_id).await?;
        if kind.catalog().phase != 1 {
            return Err(GeoError::validation("source_kind", "not_allowed")
                .with_param("value", kind.as_str())
                .into());
        }
        Ok(self.search().remove_source(project_id, kind).await?)
    }

    /// 只翻机会状态，不重算依据（DR-99）。
    pub async fn update_opportunity(
        &self,
        opportunity_id: SearchOpportunityId,
        status: SearchOpportunityStatus,
        now: DateTime<Utc>,
    ) -> Result<SearchOpportunity, IpcError> {
        let mut opportunity = match self.search().get_opportunity(opportunity_id).await {
            Ok(opportunity) => opportunity,
            Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("opportunity_id", "invalid_id")
                    .with_param("value", opportunity_id.to_string())
                    .into());
            }
            Err(error) => return Err(error.into()),
        };
        self.search()
            .update_opportunity_status(opportunity_id, status, now)
            .await?;
        opportunity.status = status;
        opportunity.updated_at = now;
        Ok(opportunity)
    }
    /// 跑一次源自检：不伪造结论。可探测的源真发一次 HTTP GET；OAuth 源在未授权时只报缺少授权。
    pub async fn test_source(
        &self,
        project_id: ProjectId,
        kind: SearchSourceKind,
        now: DateTime<Utc>,
    ) -> Result<SearchSource, IpcError> {
        self.require_project(project_id).await?;
        let catalog = kind.catalog();
        if catalog.phase != 1 {
            return Err(GeoError::validation("source_kind", "not_allowed")
                .with_param("value", kind.as_str())
                .into());
        }
        let mut source = match self
            .search()
            .sources(project_id)
            .await?
            .into_iter()
            .find(|source| source.kind == kind)
        {
            Some(source) => source,
            None => SearchSource {
                id: SearchSourceId::new(),
                project_id,
                kind,
                auth_mode: catalog.auth_mode,
                ingest_modes: catalog.ingest_modes.to_vec(),
                status: SiteChannelStatus::NotConfigured,
                region: catalog.region,
                group: catalog.group,
                binding: BTreeMap::new(),
                credentials_state: credentials_state(kind),
                secret_ref: secret_ref(kind),
                data_through: None,
                checked_at: None,
                check_detail: None,
                note: None,
                created_at: now,
                updated_at: now,
            },
        };

        let (status, detail) = if kind == SearchSourceKind::Manual {
            (
                SiteChannelStatus::Ready,
                CheckDetail::new("search_manual_no_probe"),
            )
        } else if catalog.auth_mode == SearchAuthMode::Oauth {
            (
                SiteChannelStatus::PendingVerify,
                CheckDetail::new("search_credentials_missing").with_param("kind", kind.as_str()),
            )
        } else if catalog
            .binding_fields
            .iter()
            .any(|field| !source.binding.contains_key(field.as_str()))
        {
            let fields = catalog
                .binding_fields
                .iter()
                .map(|field| field.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            (
                SiteChannelStatus::NotConfigured,
                CheckDetail::new("search_binding_missing").with_param("fields", fields),
            )
        } else {
            match source
                .binding
                .get("siteUrl")
                .and_then(|raw| url::Url::parse(raw).ok())
            {
                None => (
                    SiteChannelStatus::Failed,
                    CheckDetail::new("search_unreachable").with_param("reason", "invalid_url"),
                ),
                Some(target) => match self.fetcher.fetch(&target).await {
                    Ok(page) => (
                        SiteChannelStatus::Ready,
                        CheckDetail::new("search_reachable")
                            .with_param("status", page.status.to_string()),
                    ),
                    Err(error) => {
                        let (reason, status_code) = crawler_reason(&error);
                        let mut detail =
                            CheckDetail::new("search_unreachable").with_param("reason", reason);
                        if let Some(code) = status_code {
                            detail = detail.with_param("status", code);
                        }
                        (SiteChannelStatus::Failed, detail)
                    }
                },
            }
        };

        source.status = status;
        source.check_detail = Some(detail);
        source.checked_at = Some(now);
        source.updated_at = now;
        self.search().upsert_source(&source).await?;
        Ok(source)
    }
}

fn crawler_reason(error: &CrawlerError) -> (&'static str, Option<String>) {
    match error {
        CrawlerError::Timeout { .. } => ("timeout", None),
        CrawlerError::Network { status, .. } => (
            if status.is_some() {
                "http_status"
            } else {
                "network"
            },
            status.map(|value| value.to_string()),
        ),
        CrawlerError::InvalidUrl { .. } => ("invalid_url", None),
        CrawlerError::Blocked { .. } => ("blocked", None),
        CrawlerError::TooLarge { .. } => ("too_large", None),
        CrawlerError::Decode(_) => ("decode", None),
    }
}

//! 站长数据服务（M5.5，Plan C 第五切片第一段）。
//!
//! 七条命令：`search_board` / `search_source_upsert` / `search_source_remove` /
//! `search_source_test` / `search_metric_import_csv` / `search_opportunity_update` /
//! `search_oauth_begin`。其中 OAuth 只实现 GSC（PKCE + loopback，见 `search_oauth`）；
//! Bing 仍是 API key / 手工通道，百度站长没有读 API，二者不伪造授权。
//!
//! 🔴 `search_board` 读取指标后按 DR-100 重算机会并持久化；人工状态按
//! `(rule_id, title_key)` 继承。C 类留档 / 自建索引 / 流量分布仍无写入路径，
//! 这些字段返回空数组（或 `null`），不伪造种子数据。

use std::collections::BTreeMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use geo_crawler::{CrawlerError, SiteFetcher};
use geo_domain::{
    build_search_opportunities, clean_binding, credentials_state, page_from_asset,
    parse_search_table, secret_ref, source_status, CheckDetail, DiagnosisOverview, GeoError,
    ParseInput, ProjectId, SearchAiOverview, SearchAuthMode, SearchNativeExtra, SearchOpportunity,
    SearchOpportunityId, SearchOpportunityInput, SearchOpportunityStatus, SearchQueryMetric,
    SearchSource, SearchSourceId, SearchSourceKind, SearchTableError, SearchTableWarning,
    SiteChannelStatus, SiteCredentialsState, SitePage,
};
use geo_llm::transport::Transport;
use geo_store::{
    AssetRepo, DiagnosisRepo, KeywordRepo, ProjectRepo, SearchMetricRepo, SearchRepo, SecretStore,
    StoreError,
};
use serde::Serialize;
use sqlx::SqlitePool;
use tokio::net::TcpListener;

use crate::error::IpcError;
use crate::services::search_oauth::{
    bind_failed, build_authorization, load_bing_api_key, GscOAuthFlow, OAuthFlowContext,
    SearchOAuthStart, GOOGLE_OAUTH_SECRET_REF, GSC_CLIENT_ID_FIELD, GSC_TOKEN_REF,
};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
pub struct SearchBoardResult {
    pub as_of: String,
    pub sources: Vec<SearchSource>,
    pub metrics: Vec<SearchQueryMetric>,
    pub ai_overviews: Vec<SearchAiOverview>,
    pub native_extras: Vec<SearchNativeExtra>,
    pub opportunities: Vec<SearchOpportunity>,
    pub self_index_summary: Option<serde_json::Value>,
    pub self_index_snapshots: Vec<serde_json::Value>,
    pub traffic_split: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchMetricImportResult {
    pub metrics: Vec<SearchQueryMetric>,
    pub ai_overviews: Vec<SearchAiOverview>,
    pub native_extras: Vec<SearchNativeExtra>,
    pub errors: Vec<SearchTableError>,
    pub warnings: Vec<SearchTableWarning>,
    pub data_through: Option<String>,
}

#[derive(Clone)]
pub struct SearchService {
    pool: SqlitePool,
    fetcher: Arc<SiteFetcher>,
    transport: Arc<dyn Transport>,
    secrets: Arc<dyn SecretStore>,
}

impl SearchService {
    pub fn new(
        pool: SqlitePool,
        fetcher: Arc<SiteFetcher>,
        transport: Arc<dyn Transport>,
        secrets: Arc<dyn SecretStore>,
    ) -> Self {
        Self {
            pool,
            fetcher,
            transport,
            secrets,
        }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(
            state.pool.clone(),
            state.fetcher.clone(),
            state.llm.transport(),
            state.secrets.clone(),
        )
    }

    /// 启动一次站长平台授权：GSC 用临时端口 + PKCE。
    ///
    /// 只支持 `gsc`。Bing 的 OAuth 控制台不接受 loopback 重定向地址，改走官方
    /// API Key（`keyring://llm/bing_wmt`，见 `search_oauth::refresh_all_bing`）；
    /// 其他源（百度站长等）没有可用的 OAuth 通道。两者都一律 `kind/not_allowed`，
    /// 不伪造授权入口。后台任务只 accept 一次回调，随后兑换 token、拉数并落库。
    pub async fn oauth_begin(
        &self,
        project_id: ProjectId,
        kind: SearchSourceKind,
    ) -> Result<SearchOAuthStart, IpcError> {
        if kind != SearchSourceKind::Gsc {
            return Err(GeoError::validation("kind", "not_allowed")
                .with_param("value", kind.as_str())
                .into());
        }
        self.require_project(project_id).await?;
        let source = self
            .search()
            .sources(project_id)
            .await?
            .into_iter()
            .find(|source| source.kind == kind)
            .ok_or_else(|| {
                GeoError::validation("kind", "not_configured").with_param("value", kind.as_str())
            })?;

        let client_id = source
            .binding
            .get(GSC_CLIENT_ID_FIELD)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| GeoError::validation(GSC_CLIENT_ID_FIELD, "required"))?;
        let site_url = source
            .binding
            .get("siteUrl")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| GeoError::validation("siteUrl", "required"))?;

        if kind == SearchSourceKind::Gsc {
            let client_secret = self
                .secrets
                .get(GOOGLE_OAUTH_SECRET_REF)
                .await?
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());

            let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|error| {
                tracing::warn!(reason = %error, "GSC OAuth 无法绑定 loopback 端口");
                bind_failed()
            })?;
            let port = listener.local_addr().map_err(|_| bind_failed())?.port();
            let redirect_uri = format!("http://127.0.0.1:{port}/oauth2callback");
            let (auth_url, state, verifier) = build_authorization(&client_id, &redirect_uri);

            let flow = GscOAuthFlow::new(
                self.pool.clone(),
                self.secrets.clone(),
                self.transport.clone(),
            );
            let context = OAuthFlowContext {
                project_id,
                client_id,
                client_secret,
                site_url,
                state: state.clone(),
                verifier,
                redirect_uri: redirect_uri.clone(),
            };
            tokio::spawn(async move { flow.run(listener, context).await });

            Ok(SearchOAuthStart {
                auth_url,
                state,
                redirect_uri,
            })
        } else {
            unreachable!("上面已限定只有 GSC")
        }
    }

    fn search(&self) -> SearchRepo {
        SearchRepo::new(self.pool.clone())
    }

    fn metrics(&self) -> SearchMetricRepo {
        SearchMetricRepo::new(self.pool.clone())
    }

    fn projects(&self) -> ProjectRepo {
        ProjectRepo::new(self.pool.clone())
    }

    fn keywords(&self) -> KeywordRepo {
        KeywordRepo::new(self.pool.clone())
    }

    fn assets(&self) -> AssetRepo {
        AssetRepo::new(self.pool.clone())
    }

    fn diagnosis(&self) -> DiagnosisRepo {
        DiagnosisRepo::new(self.pool.clone())
    }

    pub(crate) async fn require_project(&self, project_id: ProjectId) -> Result<(), IpcError> {
        self.projects().get(project_id).await?;
        Ok(())
    }

    /// 读 board 时按 DR-100 重算机会并持久化：人工状态按 `(rule_id, title_key)` 继承，
    /// 新机会为 `new`，不再命中的旧机会在本轮删除。
    pub async fn board(&self, project_id: ProjectId) -> Result<SearchBoardResult, IpcError> {
        self.require_project(project_id).await?;
        let now = Utc::now();
        let metrics = self.metrics().metrics(project_id).await?;
        let ai_overviews = self.metrics().overviews(project_id).await?;
        let keywords = self.keywords().list_by_project(project_id).await?;
        let pages: Vec<SitePage> = self
            .assets()
            .list_by_project(project_id)
            .await?
            .iter()
            .filter_map(page_from_asset)
            .collect();
        let previous = self.previous_overview(project_id).await?;
        let generated = build_search_opportunities(SearchOpportunityInput {
            project_id,
            metrics: &metrics,
            ai_overviews: &ai_overviews,
            keywords: &keywords,
            pages: &pages,
            previous_overview: previous.as_ref(),
            now,
        });
        let existing = self.search().opportunities(project_id).await?;
        let opportunities = inherit_manual_status(generated, &existing);
        self.search()
            .replace_opportunities(project_id, &opportunities)
            .await?;

        Ok(SearchBoardResult {
            as_of: now.date_naive().to_string(),
            sources: self.search().sources(project_id).await?,
            metrics,
            ai_overviews,
            native_extras: self.metrics().extras(project_id).await?,
            opportunities,
            self_index_summary: None,
            self_index_snapshots: Vec::new(),
            traffic_split: Vec::new(),
        })
    }

    /// 取本项目最近一轮诊断概览；没有快照时返回 `None`（规则 6 会跳过）。
    async fn previous_overview(
        &self,
        project_id: ProjectId,
    ) -> Result<Option<DiagnosisOverview>, IpcError> {
        let mut latest: Option<DiagnosisOverview> = None;
        for (_round_id, payload) in self.diagnosis().snapshots_of_kind("overview").await? {
            let Ok(overview) = serde_json::from_str::<DiagnosisOverview>(&payload) else {
                continue;
            };
            if overview.project_id != project_id.to_string() {
                continue;
            }
            if latest
                .as_ref()
                .is_none_or(|current| overview.collected_at > current.collected_at)
            {
                latest = Some(overview);
            }
        }
        Ok(latest)
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
            // 已授权过的 GSC 不能因为改一次绑定就掉回 `missing`（令牌仍在钥匙串里）；
            // 没授权过的新行仍由目录表推导为 `missing`。
            credentials_state: existing
                .as_ref()
                .map(|source| source.credentials_state)
                .unwrap_or_else(|| credentials_state(kind)),
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
        self.metrics().delete_for_source(project_id, kind).await?;
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

        // 凭据是否已就位：GSC 看 OAuth token；Bing 看 API Key（官方推荐路径），
        // 也认 OAuth token（备选路径）。
        let credentials_stored = match kind {
            SearchSourceKind::Gsc => self.secrets.exists(GSC_TOKEN_REF).await?,
            SearchSourceKind::BingWmt => load_bing_api_key(self.secrets.as_ref()).await.is_some(),
            _ => false,
        };
        let (status, detail) = if kind == SearchSourceKind::Manual {
            (
                SiteChannelStatus::Ready,
                CheckDetail::new("search_manual_no_probe"),
            )
        } else if catalog.auth_mode == SearchAuthMode::Oauth {
            source.credentials_state = if credentials_stored {
                SiteCredentialsState::Stored
            } else {
                SiteCredentialsState::Missing
            };
            let code = if credentials_stored {
                "search_credentials_stored"
            } else {
                "search_credentials_missing"
            };
            (
                SiteChannelStatus::PendingVerify,
                CheckDetail::new(code).with_param("kind", kind.as_str()),
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

    /// 导入 Baidu AI / 规范列名的文本表。行级容错；表头级错误整批拒绝。
    pub async fn import_metrics(
        &self,
        project_id: ProjectId,
        kind: SearchSourceKind,
        payload: String,
        period_start: String,
        period_end: String,
        now: DateTime<Utc>,
    ) -> Result<SearchMetricImportResult, IpcError> {
        self.require_project(project_id).await?;
        if kind.catalog().phase != 1 {
            return Err(GeoError::validation("source_kind", "not_allowed")
                .with_param("value", kind.as_str())
                .into());
        }
        for (field, value) in [("period_start", &period_start), ("period_end", &period_end)] {
            if !is_date(value) {
                return Err(GeoError::validation(field, "invalid_format")
                    .with_param("value", value)
                    .into());
            }
        }
        if period_start > period_end {
            return Err(GeoError::validation("period_start", "out_of_range")
                .with_param("value", &period_start)
                .with_param("expected", format!("<={period_end}"))
                .into());
        }
        let data_through = {
            let today = now.date_naive().to_string();
            if today < period_end {
                today
            } else {
                period_end.clone()
            }
        };
        let parsed = parse_search_table(ParseInput {
            payload: &payload,
            project_id,
            kind,
            period_start: &period_start,
            period_end: &period_end,
            data_through: &data_through,
            imported_at: now,
        })?;
        if parsed.metrics.is_empty() && parsed.ai_overviews.is_empty() && !parsed.errors.is_empty()
        {
            let first = &parsed.errors[0];
            let mut error = IpcError::with_params(
                "validation/failed",
                [
                    ("field", "payload"),
                    ("reason", first.reason.as_str()),
                    ("value", ""),
                ],
            );
            error.detail = serde_json::to_value(&parsed.errors).ok();
            return Err(error);
        }

        if let Some(overview) = parsed.ai_overviews.first() {
            let table_extras: Vec<_> = parsed
                .native_extras
                .iter()
                .filter(|extra| extra.metric_id.is_none())
                .cloned()
                .collect();
            self.metrics()
                .replace_ai_slot(
                    project_id,
                    kind,
                    &period_start,
                    &period_end,
                    overview,
                    &table_extras,
                )
                .await?;
        } else if !parsed.metrics.is_empty() {
            self.metrics()
                .replace_metrics_slot(
                    project_id,
                    kind,
                    &period_start,
                    &period_end,
                    &parsed.metrics,
                    &parsed.native_extras,
                )
                .await?;
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
                auth_mode: kind.catalog().auth_mode,
                ingest_modes: kind.catalog().ingest_modes.to_vec(),
                status: SiteChannelStatus::NotConfigured,
                region: kind.catalog().region,
                group: kind.catalog().group,
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
        source.status = SiteChannelStatus::Ready;
        source.data_through = Some(data_through.clone());
        source.updated_at = now;
        self.search().upsert_source(&source).await?;

        Ok(SearchMetricImportResult {
            metrics: parsed.metrics,
            ai_overviews: parsed.ai_overviews,
            native_extras: parsed.native_extras,
            errors: parsed.errors,
            warnings: parsed.warnings,
            data_through: Some(data_through),
        })
    }
}

/// 旧机会的人工状态按 `(rule_id, title_key)` 继承；同一键有多条时取最近更新的一条。
fn inherit_manual_status(
    mut generated: Vec<SearchOpportunity>,
    existing: &[SearchOpportunity],
) -> Vec<SearchOpportunity> {
    let mut manual: BTreeMap<(u8, String), &SearchOpportunity> = BTreeMap::new();
    for opportunity in existing {
        if opportunity.status == SearchOpportunityStatus::New {
            continue;
        }
        let key = (opportunity.rule_id, opportunity.title_key.clone());
        match manual.get(&key) {
            Some(current) if current.updated_at >= opportunity.updated_at => {}
            _ => {
                manual.insert(key, opportunity);
            }
        }
    }
    for opportunity in &mut generated {
        if let Some(previous) = manual.get(&(opportunity.rule_id, opportunity.title_key.clone())) {
            opportunity.status = previous.status;
            opportunity.created_at = previous.created_at;
            opportunity.updated_at = previous.updated_at;
        }
    }
    generated
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

pub(crate) fn is_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

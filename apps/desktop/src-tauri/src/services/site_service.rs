//! M6.5 站点档案与下发通道服务（Plan C 第四切片）。
//!
//! 四条命令：`site_board` / `site_profile_save` / `site_channel_upsert` /
//! `site_channel_remove`。`site_channel_test` 与补丁台账仍留在 demo-only 清单：
//! 前者的 `check_detail` 目前是演示中文数据，真后端要改成稳定码 + params 后才能落（E-57）。
//!
//! 🔴 规则 3：通道只存 `keyring://site/<kind>/<project_id>` 引用串，绝不收凭据值。

use std::sync::Arc;

use chrono::{DateTime, Utc};
use geo_crawler::{CrawlerError, SiteFetcher};
use geo_domain::{
    channel_secret_ref, channel_status, page_from_asset, CheckDetail, ProjectId, SiteChannel,
    SiteChannelId, SiteChannelKind, SiteChannelStatus, SiteOwnership, SitePage, SitePatch,
    SitePlatform, SiteProfile, SiteProfileId,
};
use geo_store::{AssetRepo, ProjectRepo, SitePatchRepo, SiteRepo};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::AppState;

/// `site_board` 的聚合返回。补丁台账尚未落 Rust，`patches` / `pool` 本轮恒为空数组。
#[derive(Debug, Clone, Serialize)]
pub struct SiteBoard {
    pub profile: Option<SiteProfile>,
    pub pages: Vec<SitePage>,
    pub channels: Vec<SiteChannel>,
    pub patches: Vec<SitePatch>,
    pub pool: Vec<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct SiteService {
    pool: SqlitePool,
    fetcher: Arc<SiteFetcher>,
}

impl SiteService {
    pub fn new(pool: SqlitePool, fetcher: Arc<SiteFetcher>) -> Self {
        Self { pool, fetcher }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone(), state.fetcher.clone())
    }

    fn sites(&self) -> SiteRepo {
        SiteRepo::new(self.pool.clone())
    }

    fn projects(&self) -> ProjectRepo {
        ProjectRepo::new(self.pool.clone())
    }

    fn assets(&self) -> AssetRepo {
        AssetRepo::new(self.pool.clone())
    }

    fn patches(&self) -> SitePatchRepo {
        SitePatchRepo::new(self.pool.clone())
    }

    async fn require_project(
        &self,
        project_id: ProjectId,
    ) -> Result<geo_domain::Project, IpcError> {
        Ok(self.projects().get(project_id).await?)
    }

    pub async fn board(&self, project_id: ProjectId) -> Result<SiteBoard, IpcError> {
        self.require_project(project_id).await?;
        let pages = self
            .assets()
            .list_by_project(project_id)
            .await?
            .iter()
            .filter_map(page_from_asset)
            .collect();
        Ok(SiteBoard {
            profile: self.sites().profile(project_id).await?,
            pages,
            channels: self.sites().channels(project_id).await?,
            patches: self.patches().list_by_project(project_id).await?,
            pool: Vec::new(),
        })
    }

    /// 建档 / 更新档案。`domain` 逐字取 `Project.website`，不接受入参覆盖。
    pub async fn save_profile(
        &self,
        project_id: ProjectId,
        platform: SitePlatform,
        ownership: SiteOwnership,
        note: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<SiteProfile, IpcError> {
        let project = self.require_project(project_id).await?;
        let existing = self.sites().profile(project_id).await?;
        let profile = SiteProfile {
            id: existing
                .as_ref()
                .map(|value| value.id)
                .unwrap_or_else(SiteProfileId::new),
            project_id,
            domain: project.website.unwrap_or_default(),
            platform,
            ownership,
            note: note
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            created_at: existing
                .as_ref()
                .map(|value| value.created_at)
                .unwrap_or(now),
            updated_at: now,
        };
        self.sites().save_profile(&profile).await?;
        Ok(profile)
    }

    /// 增改一条通道：同 kind 覆盖；改配置清掉旧自检结论；`bundle` 不收 endpoint / username。
    pub async fn upsert_channel(
        &self,
        project_id: ProjectId,
        kind: SiteChannelKind,
        endpoint: Option<String>,
        username: Option<String>,
        note: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<SiteChannel, IpcError> {
        self.require_project(project_id).await?;
        let existing = self.sites().channel(project_id, kind).await?;
        let endpoint = if kind.ready_without_config() {
            None
        } else {
            endpoint
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };
        let username = if kind.ready_without_config() {
            None
        } else {
            username
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };
        let channel = SiteChannel {
            id: existing
                .as_ref()
                .map(|value| value.id)
                .unwrap_or_else(SiteChannelId::new),
            project_id,
            kind,
            status: channel_status(kind, endpoint.as_deref()),
            endpoint,
            username,
            note: note
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            credentials_state: kind.credentials_state(),
            secret_ref: channel_secret_ref(kind, project_id),
            checked_at: None,
            check_detail: None,
            updated_at: now,
        };
        self.sites().save_channel(&channel).await?;
        Ok(channel)
    }

    /// 删除一条通道（幂等），回剩余快照。
    pub async fn remove_channel(
        &self,
        project_id: ProjectId,
        kind: SiteChannelKind,
    ) -> Result<Vec<SiteChannel>, IpcError> {
        self.require_project(project_id).await?;
        Ok(self.sites().remove_channel(project_id, kind).await?)
    }
    /// 跑一次通道自检：不伪造结论。落地包恒可用；边缘函数真发一次 GET；CMS / 仓库只报还缺什么。
    pub async fn test_channel(
        &self,
        project_id: ProjectId,
        kind: SiteChannelKind,
        now: DateTime<Utc>,
    ) -> Result<SiteChannel, IpcError> {
        self.require_project(project_id).await?;
        let mut channel = match self.sites().channel(project_id, kind).await? {
            Some(channel) => channel,
            None => SiteChannel {
                id: SiteChannelId::new(),
                project_id,
                kind,
                status: channel_status(kind, None),
                endpoint: None,
                username: None,
                note: None,
                credentials_state: kind.credentials_state(),
                secret_ref: channel_secret_ref(kind, project_id),
                checked_at: None,
                check_detail: None,
                updated_at: now,
            },
        };

        let (status, detail) = match kind {
            SiteChannelKind::Bundle => (
                SiteChannelStatus::Ready,
                CheckDetail::new("site_bundle_ready"),
            ),
            SiteChannelKind::Cms => match channel.endpoint.as_deref() {
                None => (
                    SiteChannelStatus::NotConfigured,
                    CheckDetail::new("site_cms_not_configured"),
                ),
                Some(_) => (
                    SiteChannelStatus::PendingVerify,
                    CheckDetail::new("site_credentials_missing").with_param("kind", "cms"),
                ),
            },
            SiteChannelKind::Repo => match channel.endpoint.as_deref() {
                None => (
                    SiteChannelStatus::NotConfigured,
                    CheckDetail::new("site_repo_not_configured"),
                ),
                Some(_) => (
                    SiteChannelStatus::PendingVerify,
                    CheckDetail::new("site_repo_manual_check"),
                ),
            },
            SiteChannelKind::Edge => match channel.endpoint.as_deref() {
                None => (
                    SiteChannelStatus::NotConfigured,
                    CheckDetail::new("site_edge_not_deployed").with_param("status", "404"),
                ),
                Some(endpoint) => match url::Url::parse(endpoint) {
                    Ok(target) => match self.fetcher.fetch(&target).await {
                        Ok(page) => (
                            SiteChannelStatus::Ready,
                            CheckDetail::new("site_reachable")
                                .with_param("status", page.status.to_string()),
                        ),
                        Err(error) => {
                            let (reason, code) = crawler_reason(&error);
                            let mut detail =
                                CheckDetail::new("site_unreachable").with_param("reason", reason);
                            if let Some(code) = code {
                                detail = detail.with_param("status", code);
                            }
                            (SiteChannelStatus::Failed, detail)
                        }
                    },
                    Err(_) => (
                        SiteChannelStatus::Failed,
                        CheckDetail::new("site_unreachable").with_param("reason", "invalid_url"),
                    ),
                },
            },
        };

        channel.status = status;
        channel.check_detail = Some(detail);
        channel.checked_at = Some(now);
        channel.updated_at = now;
        self.sites().save_channel(&channel).await?;
        Ok(channel)
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

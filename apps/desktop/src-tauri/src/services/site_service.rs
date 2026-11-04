//! M6.5 站点档案与下发通道服务（Plan C 第四切片）。
//!
//! 四条命令：`site_board` / `site_profile_save` / `site_channel_upsert` /
//! `site_channel_remove`。`site_channel_test` 与补丁台账仍留在 demo-only 清单：
//! 前者的 `check_detail` 目前是演示中文数据，真后端要改成稳定码 + params 后才能落（E-57）。
//!
//! 🔴 规则 3：通道只存 `keyring://site/<kind>/<project_id>` 引用串，绝不收凭据值。

use chrono::{DateTime, Utc};
use geo_domain::{
    channel_secret_ref, channel_status, page_from_asset, ProjectId, SiteChannel, SiteChannelId,
    SiteChannelKind, SiteOwnership, SitePage, SitePlatform, SiteProfile, SiteProfileId,
};
use geo_store::{AssetRepo, ProjectRepo, SiteRepo};
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
    pub patches: Vec<serde_json::Value>,
    pub pool: Vec<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct SiteService {
    pool: SqlitePool,
}

impl SiteService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone())
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
            patches: Vec::new(),
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
}

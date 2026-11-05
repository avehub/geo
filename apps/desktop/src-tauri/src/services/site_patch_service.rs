//! 站点补丁台账服务（M6.5，Plan C 第四切片第二段）。
//!
//! 五条命令：`site_patch_add` / `site_patch_save` / `site_patch_transition` /
//! `site_patch_history` / `site_patch_delete`。`site_patch_generate` 依赖行动中心
//! （`action_*` 尚未落 Rust），继续留在 demo-only。
//!
//! 🔴 本切片只做**手动补丁**：`action_id` 非空一律拒绝（否则会写出指向不存在处方的悬空链接）；
//! `round_id` 留空串，等行动 / 轮次族落地后再补归因。

use chrono::{DateTime, Utc};
use geo_domain::{
    GeoError, ProjectId, SitePatch, SitePatchDraft, SitePatchEvent, SitePatchEventId,
    SitePatchEventKind, SitePatchId, SitePatchStatus, SitePatchTransition,
};
use geo_store::{ProjectRepo, SitePatchRepo};
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct SitePatchService {
    pool: SqlitePool,
}

impl SitePatchService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone())
    }

    fn patches(&self) -> SitePatchRepo {
        SitePatchRepo::new(self.pool.clone())
    }

    fn projects(&self) -> ProjectRepo {
        ProjectRepo::new(self.pool.clone())
    }

    async fn require_project(&self, project_id: ProjectId) -> Result<(), IpcError> {
        self.projects().get(project_id).await?;
        Ok(())
    }

    pub async fn list(&self, project_id: ProjectId) -> Result<Vec<SitePatch>, IpcError> {
        Ok(self.patches().list_by_project(project_id).await?)
    }

    /// 手动新建：`status = draft`、`review_status = approved`、`source = manual`。
    pub async fn add(
        &self,
        project_id: ProjectId,
        draft: SitePatchDraft,
        now: DateTime<Utc>,
    ) -> Result<SitePatch, IpcError> {
        self.require_project(project_id).await?;
        if draft.action_id.is_some() {
            return Err(GeoError::validation("action_id", "not_allowed").into());
        }
        draft.validate()?;
        let position = self.patches().next_position(project_id).await?;
        let patch = draft.into_patch(project_id, position, now)?;
        let event = SitePatchEvent {
            id: SitePatchEventId::new(),
            patch_id: patch.id,
            kind: SitePatchEventKind::Created,
            channel_kind: None,
            note: None,
            created_at: now,
        };
        self.patches().insert_with_event(&patch, &event).await?;
        Ok(patch)
    }

    /// 就地改草案。`status` / `published_*` / `source` / `position` / `action_id` /
    /// `round_id` / `created_at` 保留库里的值。
    pub async fn save(&self, patch: SitePatch, now: DateTime<Utc>) -> Result<SitePatch, IpcError> {
        let existing = match self.patches().get(patch.id).await {
            Ok(existing) if existing.project_id == patch.project_id => existing,
            Ok(_) | Err(geo_store::StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("patch_id", "invalid_id")
                    .with_param("value", patch.id.to_string())
                    .into());
            }
            Err(error) => return Err(error.into()),
        };
        let next = SitePatch {
            id: existing.id,
            project_id: existing.project_id,
            action_id: existing.action_id,
            round_id: existing.round_id,
            kind: patch.kind,
            title: patch.title.trim().to_string(),
            target_url: patch.target_url.trim().to_string(),
            target_hint: patch
                .target_hint
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            body: patch.body,
            published_body: existing.published_body,
            published_kind: existing.published_kind,
            published_target_url: existing.published_target_url,
            published_channel_kind: existing.published_channel_kind,
            status: existing.status,
            review_status: patch.review_status,
            channel_kind: patch.channel_kind,
            source: existing.source,
            position: existing.position,
            published_at: existing.published_at,
            created_at: existing.created_at,
            updated_at: now,
        };
        next.validate()?;
        let event = SitePatchEvent {
            id: SitePatchEventId::new(),
            patch_id: next.id,
            kind: SitePatchEventKind::Saved,
            channel_kind: None,
            note: None,
            created_at: now,
        };
        self.patches().save_with_event(&next, &event).await?;
        Ok(next)
    }

    /// 发布 / 撤回 / 回滚。三个动作都是全函数，非法跃迁不存在。
    pub async fn transition(
        &self,
        patch_id: SitePatchId,
        transition: SitePatchTransition,
        now: DateTime<Utc>,
    ) -> Result<SitePatch, IpcError> {
        let mut patch = match self.patches().get(patch_id).await {
            Ok(patch) => patch,
            Err(geo_store::StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("patch_id", "invalid_id")
                    .with_param("value", patch_id.to_string())
                    .into());
            }
            Err(error) => return Err(error.into()),
        };
        let event = match transition {
            SitePatchTransition::Publish => Some(patch.publish(now)?),
            SitePatchTransition::Unpublish => patch.unpublish(now),
            SitePatchTransition::Rollback => patch.rollback(now),
        };
        self.patches().transition(&patch, event.as_ref()).await?;
        Ok(patch)
    }

    pub async fn history(&self, patch_id: SitePatchId) -> Result<Vec<SitePatchEvent>, IpcError> {
        match self.patches().get(patch_id).await {
            Ok(_) => Ok(self.patches().events(patch_id).await?),
            Err(geo_store::StoreError::NotFound { .. }) => {
                Err(GeoError::validation("patch_id", "invalid_id")
                    .with_param("value", patch_id.to_string())
                    .into())
            }
            Err(error) => Err(error.into()),
        }
    }

    /// 批量删除。已发布的补丁拒绝硬删（要求先 `unpublish`），整批原子。
    pub async fn delete(
        &self,
        project_id: ProjectId,
        ids: Vec<SitePatchId>,
    ) -> Result<Vec<SitePatch>, IpcError> {
        self.require_project(project_id).await?;
        let wanted: std::collections::HashSet<String> =
            ids.iter().map(|id| id.to_string()).collect();
        let doomed: Vec<SitePatch> = self
            .patches()
            .list_by_project(project_id)
            .await?
            .into_iter()
            .filter(|patch| wanted.contains(&patch.id.to_string()))
            .collect();
        if doomed
            .iter()
            .any(|patch| patch.status == SitePatchStatus::Published)
        {
            return Err(IpcError::with_params(
                "state/conflict",
                [("reason", "not_allowed"), ("value", "published")],
            ));
        }
        self.patches().delete_many(project_id, &ids).await?;
        Ok(self.patches().list_by_project(project_id).await?)
    }
}

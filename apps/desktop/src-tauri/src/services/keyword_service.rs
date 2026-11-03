//! M1.5 关键词素材库服务（Plan C 第一个纵向切片）。
//!
//! 四条命令：`keyword_list` / `keyword_add` / `keyword_update` / `keyword_delete`。
//! `keyword_generate` 依赖模型与第三方关键词接口，仍在 demo-only 清单里，**这里不伪造**。
//!
//! 纪律：
//! - 校验只在 `geo-domain::keyword`（仓储不重复业务判断）；
//! - 新增**全有或全无**：先把全部草稿校验完再落库；
//! - 更新按 `(id, project_id)` 定位，跨项目 id 视为 `invalid_id`，不允许整行回传改
//!   `source` / `position` / `created_at`。

use chrono::{DateTime, Utc};
use geo_domain::{GeoError, KeywordDraft, KeywordId, KeywordItem, ProjectId};
use geo_store::{KeywordRepo, ProjectRepo, StoreError};
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct KeywordService {
    pool: SqlitePool,
}

impl KeywordService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone())
    }

    fn keywords(&self) -> KeywordRepo {
        KeywordRepo::new(self.pool.clone())
    }

    fn projects(&self) -> ProjectRepo {
        ProjectRepo::new(self.pool.clone())
    }

    async fn require_project(&self, project_id: ProjectId) -> Result<(), IpcError> {
        self.projects().get(project_id).await?;
        Ok(())
    }

    pub async fn list(&self, project_id: ProjectId) -> Result<Vec<KeywordItem>, IpcError> {
        self.require_project(project_id).await?;
        Ok(self.keywords().list_by_project(project_id).await?)
    }

    /// 人工录入（可批量）。返回**新增那几条**，顺序与入参一致。
    pub async fn add(
        &self,
        project_id: ProjectId,
        drafts: Vec<KeywordDraft>,
        now: DateTime<Utc>,
    ) -> Result<Vec<KeywordItem>, IpcError> {
        self.require_project(project_id).await?;
        if drafts.is_empty() {
            return Err(GeoError::validation("drafts", "required").into());
        }
        // 先整批校验，任一条失败就整批拒绝（半批入库最难走查）。
        for draft in &drafts {
            draft.validate()?;
        }

        let start = self.keywords().next_position(project_id).await?;
        let mut added = Vec::with_capacity(drafts.len());
        for (offset, draft) in drafts.into_iter().enumerate() {
            let position = start + i32::try_from(offset).unwrap_or(0);
            added.push(draft.into_item(project_id, position, now)?);
        }
        self.keywords().insert_many(&added).await?;
        Ok(added)
    }

    /// 整行进、整行出；保留 `source` / `position` / `created_at`，只改可编辑列。
    pub async fn update(
        &self,
        item: KeywordItem,
        now: DateTime<Utc>,
    ) -> Result<KeywordItem, IpcError> {
        self.require_project(item.project_id).await?;
        let existing = match self.keywords().get(item.id, item.project_id).await {
            Ok(existing) => existing,
            Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("keyword_id", "invalid_id")
                    .with_param("value", item.id.to_string())
                    .into());
            }
            Err(error) => return Err(error.into()),
        };

        let merged = KeywordItem {
            id: existing.id,
            project_id: existing.project_id,
            text: item.text.trim().to_string(),
            kind: item.kind,
            intent: item.intent,
            monthly_volume: item.monthly_volume,
            difficulty: item.difficulty,
            priority: item.priority,
            status: item.status,
            note: item
                .note
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            source: existing.source,
            position: existing.position,
            created_at: existing.created_at,
            updated_at: now,
        };
        merged.validate()?;
        self.keywords().update(&merged).await?;
        Ok(merged)
    }

    /// 批量删除，回**剩余快照**（照 `prompt_item_delete` 的返回形状）。
    pub async fn delete(
        &self,
        project_id: ProjectId,
        ids: Vec<KeywordId>,
    ) -> Result<Vec<KeywordItem>, IpcError> {
        self.require_project(project_id).await?;
        self.keywords().delete_many(project_id, &ids).await?;
        Ok(self.keywords().list_by_project(project_id).await?)
    }
}

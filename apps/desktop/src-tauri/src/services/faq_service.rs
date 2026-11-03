//! M1.5 FAQ 素材库服务（Plan C 第二个纵向切片）。
//!
//! 四条命令：`faq_list` / `faq_add` / `faq_update` / `faq_delete`。
//! `faq_generate` 需要模型成文 + 合规扫描，仍留在 demo-only 清单，**这里不伪造**。

use chrono::{DateTime, Utc};
use geo_domain::{FaqDraft, FaqId, FaqItem, GeoError, ProjectId};
use geo_store::{FaqRepo, ProjectRepo, StoreError};
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct FaqService {
    pool: SqlitePool,
}

impl FaqService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone())
    }

    fn faqs(&self) -> FaqRepo {
        FaqRepo::new(self.pool.clone())
    }

    fn projects(&self) -> ProjectRepo {
        ProjectRepo::new(self.pool.clone())
    }

    async fn require_project(&self, project_id: ProjectId) -> Result<(), IpcError> {
        self.projects().get(project_id).await?;
        Ok(())
    }

    pub async fn list(&self, project_id: ProjectId) -> Result<Vec<FaqItem>, IpcError> {
        self.require_project(project_id).await?;
        Ok(self.faqs().list_by_project(project_id).await?)
    }

    /// 人工录入（可批量）。先整批校验，任一条失败就整批拒绝。
    pub async fn add(
        &self,
        project_id: ProjectId,
        drafts: Vec<FaqDraft>,
        now: DateTime<Utc>,
    ) -> Result<Vec<FaqItem>, IpcError> {
        self.require_project(project_id).await?;
        if drafts.is_empty() {
            return Err(GeoError::validation("drafts", "required").into());
        }
        for draft in &drafts {
            draft.validate()?;
        }

        let start = self.faqs().next_position(project_id).await?;
        let mut added = Vec::with_capacity(drafts.len());
        for (offset, draft) in drafts.into_iter().enumerate() {
            let position = start + i32::try_from(offset).unwrap_or(0);
            added.push(draft.into_item(project_id, position, now)?);
        }
        self.faqs().insert_many(&added).await?;
        Ok(added)
    }

    /// 整行进、整行出；保留 `source` / `position` / `created_at`。
    pub async fn update(&self, item: FaqItem, now: DateTime<Utc>) -> Result<FaqItem, IpcError> {
        self.require_project(item.project_id).await?;
        let existing = match self.faqs().get(item.id, item.project_id).await {
            Ok(existing) => existing,
            Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("faq_id", "invalid_id")
                    .with_param("value", item.id.to_string())
                    .into());
            }
            Err(error) => return Err(error.into()),
        };

        let merged = FaqItem {
            id: existing.id,
            project_id: existing.project_id,
            question: item.question.trim().to_string(),
            answer_markdown: item.answer_markdown.trim().to_string(),
            category: item
                .category
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            intent: item.intent,
            status: item.status,
            source: existing.source,
            position: existing.position,
            created_at: existing.created_at,
            updated_at: now,
        };
        merged.validate()?;
        self.faqs().update(&merged).await?;
        Ok(merged)
    }

    /// 批量删除，回剩余快照（幂等；允许删空）。
    pub async fn delete(
        &self,
        project_id: ProjectId,
        ids: Vec<FaqId>,
    ) -> Result<Vec<FaqItem>, IpcError> {
        self.require_project(project_id).await?;
        self.faqs().delete_many(project_id, &ids).await?;
        Ok(self.faqs().list_by_project(project_id).await?)
    }
}

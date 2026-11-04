//! M1.2b 知识库服务（Plan C 第三个纵向切片）。
//!
//! 五条命令：`kb_board` / `kb_entry_add` / `kb_entry_update` / `kb_entry_delete` /
//! `kb_entry_verify`。`kb_generate` 需要模型成文与合规扫描，仍留在 demo-only 清单。
//!
//! 纪律：校验只在 `geo-domain::kb`；`update` 逐字段 diff 写留痕；`verify` 只改
//! `status` / `verified_at` / `updated_at` 并记一条 `verified_at` 留痕；删除不删留痕。

use chrono::{DateTime, Utc};
use geo_domain::{
    GeoError, KbEntry, KbEntryDraft, KbEntryRevision, KbModule, KbScenario, KbStats, ProjectId,
};
use geo_store::{KbRepo, ProjectRepo, StoreError};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::AppState;

/// `kb_board` 的聚合返回，形状与前端 `KbBoard` 逐字一致。
#[derive(Debug, Clone, Serialize)]
pub struct KbBoard {
    pub project_id: ProjectId,
    pub entries: Vec<KbEntry>,
    pub stats: KbStats,
    pub project_updated_at: DateTime<Utc>,
    pub revisions: Vec<KbEntryRevision>,
}

#[derive(Debug, Clone)]
pub struct KbService {
    pool: SqlitePool,
}

impl KbService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone())
    }

    fn entries(&self) -> KbRepo {
        KbRepo::new(self.pool.clone())
    }

    fn projects(&self) -> ProjectRepo {
        ProjectRepo::new(self.pool.clone())
    }

    async fn require_project(
        &self,
        project_id: ProjectId,
    ) -> Result<geo_domain::Project, IpcError> {
        Ok(self.projects().get(project_id).await?)
    }

    pub async fn board(&self, project_id: ProjectId) -> Result<KbBoard, IpcError> {
        let project = self.require_project(project_id).await?;
        let entries = self.entries().list_by_project(project_id).await?;
        let stats = KbStats::from_entries(&entries);
        let revisions = self.entries().revisions_by_project(project_id).await?;
        Ok(KbBoard {
            project_id,
            entries,
            stats,
            project_updated_at: project.updated_at,
            revisions,
        })
    }

    /// 手动录入 / 导入（可批量）。先整批校验标题，再落库。
    pub async fn add(
        &self,
        project_id: ProjectId,
        drafts: Vec<KbEntryDraft>,
        now: DateTime<Utc>,
    ) -> Result<Vec<KbEntry>, IpcError> {
        self.require_project(project_id).await?;
        for draft in &drafts {
            draft.validate()?;
        }
        if drafts.is_empty() {
            return Ok(Vec::new());
        }

        let start = self.entries().next_position(project_id).await?;
        let mut added = Vec::with_capacity(drafts.len());
        for (offset, draft) in drafts.into_iter().enumerate() {
            let position = start + i32::try_from(offset).unwrap_or(0);
            added.push(draft.into_item(project_id, position, now)?);
        }
        self.entries().insert_many(&added).await?;
        Ok(added)
    }

    /// 整行进、整行出：`source` / `position` / `created_at` / `verified_at` 保留库里的值。
    pub async fn update(&self, entry: KbEntry, now: DateTime<Utc>) -> Result<KbEntry, IpcError> {
        self.require_project(entry.project_id).await?;
        let existing = match self.entries().get(entry.id, entry.project_id).await {
            Ok(existing) => existing,
            Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("kb_entry_id", "invalid_id")
                    .with_param("value", entry.id.to_string())
                    .into());
            }
            Err(error) => return Err(error.into()),
        };

        let next = KbEntry {
            id: existing.id,
            project_id: existing.project_id,
            module: entry.module,
            kind: entry.kind,
            title: entry.title.trim().to_string(),
            body_markdown: entry.body_markdown,
            url: entry
                .url
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            mime: entry
                .mime
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            tags: entry
                .tags
                .into_iter()
                .map(|tag| tag.trim().to_string())
                .filter(|tag| !tag.is_empty())
                .collect(),
            status: entry.status,
            source: existing.source,
            scenario: scenario_for(entry.module, entry.scenario),
            verified_at: existing.verified_at,
            position: existing.position,
            created_at: existing.created_at,
            updated_at: now,
        };
        next.validate()?;
        let revisions = KbEntry::diff_revisions(&existing, &next, now);
        self.entries()
            .update_with_revisions(&next, &revisions)
            .await?;
        Ok(next)
    }

    /// 批量删除，回剩余快照；`position` 由仓储重排为 `0..n-1`。
    pub async fn delete(
        &self,
        project_id: ProjectId,
        ids: Vec<geo_domain::KbEntryId>,
    ) -> Result<Vec<KbEntry>, IpcError> {
        self.require_project(project_id).await?;
        self.entries().delete_many(project_id, &ids).await?;
        Ok(self.entries().list_by_project(project_id).await?)
    }

    /// 批量核实：`status → approved` + `verified_at → now`，每条记一条留痕。
    pub async fn verify(
        &self,
        project_id: ProjectId,
        ids: Vec<geo_domain::KbEntryId>,
        now: DateTime<Utc>,
    ) -> Result<Vec<KbEntry>, IpcError> {
        self.require_project(project_id).await?;
        self.entries().verify_many(project_id, &ids, now).await?;
        Ok(self.entries().list_by_project(project_id).await?)
    }
}

/// 场景只在两个话术模块保留；其余模块强制 `None`（不报错）。
fn scenario_for(module: KbModule, scenario: Option<KbScenario>) -> Option<KbScenario> {
    if module.is_script() {
        scenario
    } else {
        None
    }
}

//! M1 项目服务：建项向导落库、列表过滤、归档、竞品/资产维护、项目全量导入导出。
//!
//! 本模块只做编排（校验 → 领域构造 → 仓储写入），不含任何 `tauri::*` 依赖，
//! 因此 `tests/project_service.rs` 可以直调（见 `AGENTS.md` 规则 1）。

use chrono::{DateTime, Utc};
use geo_domain::{
    clean_optional, fields_from_draft, normalize_url, AssetId, AssetKind, Competitor,
    CompetitorDraft, CompetitorId, EntityCard, GeoError, Project, ProjectAsset, ProjectDraft,
    ProjectId, MAX_ALIASES, MAX_BRAND_NAME_CHARS, MAX_COMPETITORS, MAX_PROJECT_NAME_CHARS,
    MAX_TAGS,
};
use geo_store::{
    AssetRepo, CompetitorRepo, EntityCardRepo, ProjectFilter, ProjectRepo, PromptSetRepo,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::IpcError;

/// 项目详情：列表页点进去要一次拿到的全部内容。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectDetail {
    pub project: Project,
    pub entity_card: Option<EntityCard>,
    pub competitors: Vec<Competitor>,
    pub assets: Vec<ProjectAsset>,
    pub prompt_set_count: usize,
}

/// 项目服务。仓储都是无状态的薄封装，因此服务本身也可以随手克隆。
#[derive(Debug, Clone)]
pub struct ProjectService {
    pub(crate) pool: SqlitePool,
}

impl ProjectService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub(crate) fn projects(&self) -> ProjectRepo {
        ProjectRepo::new(self.pool.clone())
    }

    pub(crate) fn competitors(&self) -> CompetitorRepo {
        CompetitorRepo::new(self.pool.clone())
    }

    pub(crate) fn assets(&self) -> AssetRepo {
        AssetRepo::new(self.pool.clone())
    }

    pub(crate) fn cards(&self) -> EntityCardRepo {
        EntityCardRepo::new(self.pool.clone())
    }

    pub(crate) fn prompt_sets(&self) -> PromptSetRepo {
        PromptSetRepo::new(self.pool.clone())
    }

    /// 建项：向导草稿 → 项目 + 竞品 + 自有页面资产 + 初始实体卡（单库顺序写入）。
    ///
    /// 初始实体卡来自用户已填的资料（产品线、地域、别名），因此标记为「官方口径」；
    /// 后续「自动建档」只会把**未确认**的字段改成「待确认」（见 `entity_card_service`）。
    pub async fn create_draft(
        &self,
        draft: &ProjectDraft,
        now: DateTime<Utc>,
    ) -> Result<Project, IpcError> {
        let bundle = draft.build(now)?;
        self.projects().create(&bundle.project).await?;
        for competitor in &bundle.competitors {
            self.competitors().upsert(competitor).await?;
        }
        for asset in &bundle.assets {
            self.assets().add(asset).await?;
        }

        let fields = fields_from_draft(
            &bundle.project.brand_name,
            &bundle.project.aliases,
            draft.region.as_deref(),
            draft.products.clone(),
            draft.service_scope.as_deref(),
            bundle.project.website.as_deref(),
        );
        let card = EntityCard::from_manual(bundle.project.id, fields, now);
        self.cards().upsert(&card).await?;

        tracing::info!(
            project_id = %bundle.project.id,
            competitors = bundle.competitors.len(),
            assets = bundle.assets.len(),
            "建项完成"
        );
        Ok(bundle.project)
    }

    pub async fn list(&self, filter: &ProjectFilter) -> Result<Vec<Project>, IpcError> {
        Ok(self.projects().list(filter).await?)
    }

    pub async fn detail(&self, id: ProjectId) -> Result<ProjectDetail, IpcError> {
        let project = self.projects().get(id).await?;
        let entity_card = self.cards().get(id).await?;
        let competitors = self.competitors().list_by_project(id).await?;
        let assets = self.assets().list_by_project(id).await?;
        let prompt_set_count = self.prompt_sets().list_by_project(id).await?.len();
        Ok(ProjectDetail {
            project,
            entity_card,
            competitors,
            assets,
            prompt_set_count,
        })
    }

    /// 更新项目基础信息。`created_at` / 归档状态由各自专用入口维护，
    /// 这里一律以库里的值为准，避免前端回传旧对象时把状态改乱。
    pub async fn update(&self, project: &Project, now: DateTime<Utc>) -> Result<Project, IpcError> {
        let stored = self.projects().get(project.id).await?;
        validate_project(project)?;

        let mut updated = stored;
        updated.name = project.name.trim().to_string();
        updated.brand_name = project.brand_name.trim().to_string();
        updated.aliases = project.aliases.clone();
        updated.website = project
            .website
            .as_deref()
            .map(|raw| normalize_url("website", raw))
            .transpose()?;
        updated.region = project.region.trim().to_string();
        updated.language = project.language;
        updated.industry = project.industry;
        updated.industry_label = project.industry_label.clone();
        updated.tags = project.tags.clone();
        updated.updated_at = now;

        self.projects().update(&updated).await?;
        Ok(updated)
    }

    pub async fn archive(
        &self,
        id: ProjectId,
        archived: bool,
        now: DateTime<Utc>,
    ) -> Result<Project, IpcError> {
        if archived {
            self.projects().archive(id, now).await?;
        } else {
            self.projects().unarchive(id, now).await?;
        }
        Ok(self.projects().get(id).await?)
    }

    /// 删除项目。竞品/资产/实体卡/题库由外键级联清理（见 `geo-store` 迁移）。
    pub async fn delete(&self, id: ProjectId) -> Result<(), IpcError> {
        Ok(self.projects().delete(id).await?)
    }

    // ---------------------------------------------------------------------
    // 竞品
    // ---------------------------------------------------------------------

    /// 新增或就地更新竞品。`id` 为 `None` 时新增，并受 `MAX_COMPETITORS` 上限约束。
    pub async fn upsert_competitor(
        &self,
        project_id: ProjectId,
        draft: &CompetitorDraft,
        id: Option<CompetitorId>,
        now: DateTime<Utc>,
    ) -> Result<Competitor, IpcError> {
        // 项目必须存在：竞品挂在 project_id 上，外键会拒绝孤儿行
        self.projects().get(project_id).await?;

        let name = draft.name.trim();
        if name.is_empty() {
            return Err(GeoError::validation("competitor.name", "竞品名称不能为空").into());
        }
        if name.chars().count() > MAX_BRAND_NAME_CHARS {
            return Err(GeoError::validation(
                "competitor.name",
                format!("长度不能超过 {MAX_BRAND_NAME_CHARS} 字"),
            )
            .into());
        }
        let website = draft
            .website
            .as_deref()
            .map(|raw| normalize_url("competitor.website", raw))
            .transpose()?;

        let current = self.competitors().list_by_project(project_id).await?;
        let (competitor_id, position, created_at) = match id {
            Some(competitor_id) => {
                let found = current
                    .iter()
                    .find(|item| item.id == competitor_id)
                    .ok_or_else(|| GeoError::not_found("competitor", competitor_id))?;
                (found.id, found.position, found.created_at)
            }
            None => {
                if current.len() >= MAX_COMPETITORS {
                    return Err(GeoError::validation(
                        "competitors",
                        format!("竞品不能超过 {MAX_COMPETITORS} 家，请先删除不再跟踪的对手"),
                    )
                    .into());
                }
                let position = current
                    .iter()
                    .map(|item| item.position)
                    .max()
                    .map_or(0, |max| max + 1);
                (CompetitorId::new(), position, now)
            }
        };

        let competitor = Competitor {
            id: competitor_id,
            project_id,
            name: name.to_string(),
            aliases: draft.aliases.clone(),
            website,
            note: clean_optional(draft.note.clone()),
            position,
            created_at,
        };
        self.competitors().upsert(&competitor).await?;
        Ok(competitor)
    }

    pub async fn list_competitors(
        &self,
        project_id: ProjectId,
    ) -> Result<Vec<Competitor>, IpcError> {
        Ok(self.competitors().list_by_project(project_id).await?)
    }

    pub async fn delete_competitor(&self, id: CompetitorId) -> Result<(), IpcError> {
        Ok(self.competitors().delete(id).await?)
    }

    pub async fn reorder_competitors(
        &self,
        project_id: ProjectId,
        ids: &[CompetitorId],
    ) -> Result<Vec<Competitor>, IpcError> {
        self.competitors().reorder(project_id, ids).await?;
        self.list_competitors(project_id).await
    }

    // ---------------------------------------------------------------------
    // 资产
    // ---------------------------------------------------------------------

    pub async fn add_asset(
        &self,
        project_id: ProjectId,
        kind: AssetKind,
        url: String,
        title: Option<String>,
        note: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<ProjectAsset, IpcError> {
        self.projects().get(project_id).await?;
        let asset = ProjectAsset::new(project_id, kind, url, title, note, now)?;
        self.assets().add(&asset).await?;
        Ok(asset)
    }

    pub async fn list_assets(&self, project_id: ProjectId) -> Result<Vec<ProjectAsset>, IpcError> {
        Ok(self.assets().list_by_project(project_id).await?)
    }

    pub async fn delete_asset(&self, id: AssetId) -> Result<(), IpcError> {
        Ok(self.assets().delete(id).await?)
    }
}

/// 项目自身字段校验（与 `ProjectDraft::validate` 同口径，用于「更新」与「导入」路径）。
pub(crate) fn validate_project(project: &Project) -> Result<(), IpcError> {
    let brand = project.brand_name.trim();
    if brand.is_empty() {
        return Err(GeoError::validation("brand_name", "不能为空").into());
    }
    if brand.chars().count() > MAX_BRAND_NAME_CHARS {
        return Err(GeoError::validation(
            "brand_name",
            format!("长度不能超过 {MAX_BRAND_NAME_CHARS} 字"),
        )
        .into());
    }
    if project.name.trim().is_empty() {
        return Err(GeoError::validation("name", "项目名不能为空").into());
    }
    if project.name.trim().chars().count() > MAX_PROJECT_NAME_CHARS {
        return Err(GeoError::validation(
            "name",
            format!("长度不能超过 {MAX_PROJECT_NAME_CHARS} 字"),
        )
        .into());
    }
    if project.aliases.len() > MAX_ALIASES {
        return Err(
            GeoError::validation("aliases", format!("别名不能超过 {MAX_ALIASES} 个")).into(),
        );
    }
    if project.tags.len() > MAX_TAGS {
        return Err(GeoError::validation("tags", format!("标签不能超过 {MAX_TAGS} 个")).into());
    }
    if project.region.trim().is_empty() {
        return Err(GeoError::validation("region", "服务地域不能为空").into());
    }
    Ok(())
}

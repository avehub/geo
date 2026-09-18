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
            return Err(GeoError::validation("competitor.name", "required").into());
        }
        if name.chars().count() > MAX_BRAND_NAME_CHARS {
            return Err(GeoError::validation("competitor.name", "too_long")
                .with_param("limit", MAX_BRAND_NAME_CHARS)
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
                    return Err(GeoError::validation("competitors", "out_of_range")
                        .with_param("expected", format!("<={MAX_COMPETITORS}"))
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

/// 项目自身字段校验，用于「更新」与「导入」路径。
///
/// **与 `ProjectDraft::validate`（`crates/geo-domain/src/project.rs`）不是同一套口径，
/// 而是互有强弱的两套**（裁定 R-A，实测结论）：本函数校验 `name` / `region` 非空，
/// 但**不**逐条校验 alias、也**不**校验 `competitors`；`ProjectDraft::validate` 反过来。
/// 委托给任一方都是行为变更（会同时丢校验与加校验），超出 Plan A 范围，
/// 因此这里只做「就地 key 化」，口径分裂与各自缺口记在 `task-5-report.md`，
/// 控制器已 Park 到末尾全分支评审 / Plan C。
///
/// `reason` 一律取 `crates/geo-domain/src/error.rs` 目录里的 key，配套参数按目录登记的
/// 语义规则 2 给：字符数用 `limit`、数量/数值区间用 `out_of_range` + `expected`
/// （纯 ASCII 的 `<=n` / `a~b`，**不带单位**——「60 字」这种单位属文案，只能由词典模板给）。
pub(crate) fn validate_project(project: &Project) -> Result<(), IpcError> {
    let brand = project.brand_name.trim();
    if brand.is_empty() {
        return Err(GeoError::validation("brand_name", "required").into());
    }
    if brand.chars().count() > MAX_BRAND_NAME_CHARS {
        return Err(GeoError::validation("brand_name", "too_long")
            .with_param("limit", MAX_BRAND_NAME_CHARS)
            .into());
    }
    if project.name.trim().is_empty() {
        return Err(GeoError::validation("name", "required").into());
    }
    if project.name.trim().chars().count() > MAX_PROJECT_NAME_CHARS {
        return Err(GeoError::validation("name", "too_long")
            .with_param("limit", MAX_PROJECT_NAME_CHARS)
            .into());
    }
    if project.aliases.len() > MAX_ALIASES {
        return Err(GeoError::validation("aliases", "out_of_range")
            .with_param("expected", format!("<={MAX_ALIASES}"))
            .into());
    }
    if project.tags.len() > MAX_TAGS {
        return Err(GeoError::validation("tags", "out_of_range")
            .with_param("expected", format!("<={MAX_TAGS}"))
            .into());
    }
    if project.region.trim().is_empty() {
        return Err(GeoError::validation("region", "required").into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use geo_domain::{Industry, Language, ProjectStatus};

    fn now() -> DateTime<Utc> {
        DateTime::from_timestamp(1_789_000_000, 0).expect("固定时间戳")
    }

    /// 一个各项都合法的项目：表驱动用例只改其中一项。
    fn valid_project() -> Project {
        Project {
            id: ProjectId::new(),
            name: "宏宇泵业".to_string(),
            brand_name: "宏宇".to_string(),
            aliases: vec!["HY".to_string()],
            website: Some("https://hongyu-pump.example".to_string()),
            region: "浙江杭州".to_string(),
            language: Language::ZhCn,
            industry: Industry::B2bManufacturing,
            industry_label: None,
            tags: vec!["水泵".to_string()],
            status: ProjectStatus::Active,
            archived_at: None,
            created_at: now(),
            updated_at: now(),
        }
    }

    /// `validate_project` 的 7 处站点逐处钉住 `(code, field, reason, params)`。
    ///
    /// **必须经生产函数触发**（裁定 R-H 第一档）：`validate_project` 是 `pub(crate)`，
    /// 集成测试（`tests/*.rs`）拿不到，因此表驱动用例只能落在本文件的 `#[cfg(test)]` 里；
    /// 也正因为如此，这里**不许**拿 `GeoError::validation(...)` 合成实例充数——
    /// 合成实例证明不了站点写对了（Task 3 复审 I-1 的原始盲区）。
    #[test]
    fn validate_project_reports_directory_keys_with_language_neutral_params() {
        struct Case {
            /// 用例名，失败时打印用。
            name: &'static str,
            break_field: fn(&mut Project),
            field: &'static str,
            reason: &'static str,
            /// 除 `field` / `reason` 之外必须**恰好**出现的配套参数。
            extra: &'static [(&'static str, &'static str)],
        }

        let cases = [
            Case {
                name: "brand_name 为空",
                break_field: |project| project.brand_name = "   ".to_string(),
                field: "brand_name",
                reason: "required",
                extra: &[],
            },
            Case {
                name: "brand_name 超长",
                break_field: |project| project.brand_name = "长".repeat(MAX_BRAND_NAME_CHARS + 1),
                field: "brand_name",
                reason: "too_long",
                extra: &[("limit", "50")],
            },
            Case {
                name: "name 为空",
                break_field: |project| project.name = " ".to_string(),
                field: "name",
                reason: "required",
                extra: &[],
            },
            Case {
                name: "name 超长",
                break_field: |project| project.name = "长".repeat(MAX_PROJECT_NAME_CHARS + 1),
                field: "name",
                reason: "too_long",
                extra: &[("limit", "80")],
            },
            Case {
                name: "aliases 超个数",
                break_field: |project| {
                    project.aliases = (0..MAX_ALIASES + 1)
                        .map(|index| format!("a{index}"))
                        .collect()
                },
                field: "aliases",
                reason: "out_of_range",
                extra: &[("expected", "<=20")],
            },
            Case {
                name: "tags 超个数",
                break_field: |project| {
                    project.tags = (0..MAX_TAGS + 1).map(|index| format!("t{index}")).collect()
                },
                field: "tags",
                reason: "out_of_range",
                extra: &[("expected", "<=20")],
            },
            Case {
                name: "region 为空",
                break_field: |project| project.region = "\t".to_string(),
                field: "region",
                reason: "required",
                extra: &[],
            },
        ];

        for case in cases {
            let mut project = valid_project();
            (case.break_field)(&mut project);
            let error = validate_project(&project).expect_err(case.name);
            assert_eq!(error.code, "validation/failed", "{}", case.name);
            assert_eq!(error.params["field"], case.field, "{}", case.name);
            assert_eq!(error.params["reason"], case.reason, "{}", case.name);

            let mut expected: std::collections::BTreeMap<String, String> = case
                .extra
                .iter()
                .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
                .collect();
            expected.insert("field".to_string(), case.field.to_string());
            expected.insert("reason".to_string(), case.reason.to_string());
            assert_eq!(
                error.params, expected,
                "{}：params 必须恰好是 field + reason + 目录给该 key 登记的配套参数\
                 （`limit` 只配字符数、`expected` 只配区间，见 error.rs 目录注释语义规则 2）",
                case.name
            );
        }

        validate_project(&valid_project()).expect("合法项目不该被拦");
    }

    /// 上限常量与用例里钉死的字面量必须同源：改了常量而没改词典模板，这条会红。
    #[test]
    fn the_documented_limits_match_the_constants() {
        assert_eq!(MAX_BRAND_NAME_CHARS, 50);
        assert_eq!(MAX_PROJECT_NAME_CHARS, 80);
        assert_eq!(MAX_ALIASES, 20);
        assert_eq!(MAX_TAGS, 20);
    }
}

//! 项目仓储：`projects` 表 ↔ [`Project`]。
//!
//! `projects` 是全部业务数据的根：竞品、资产、实体卡、prompt 集都以 `ON DELETE CASCADE`
//! 挂在 `projects.id` 上，因此 `delete` 会连带清理整个项目图谱（迁移行为见 `db.rs` 测试）。

use chrono::{DateTime, Utc};
use geo_domain::{Project, ProjectId, ProjectStatus};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};

use crate::codec;
use crate::error::StoreError;
use crate::repo::{not_found, require_found};

/// `projects` 全列查询前缀。与 [`ProjectRow`] 的字段一一对应，新增列时两处同改。
const SELECT_PROJECTS: &str = "SELECT id, name, brand_name, aliases, website, region, language, \
     industry, industry_label, tags, status, archived_at, created_at, updated_at FROM projects";

/// 项目列表过滤条件。[`ProjectFilter::default()`] = 只看未归档、不带关键词与标签过滤。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectFilter {
    /// 关键词：同时模糊匹配项目名与品牌名（`LIKE`，ASCII 大小写不敏感）。
    pub query: Option<String>,
    /// 是否包含已归档项目。
    pub include_archived: bool,
    /// 标签过滤：项目需**同时**含有全部给定标签（AND 语义，逐标签收窄结果）。
    pub tags: Vec<String>,
}

/// `projects` 行。JSON 列与枚举列先按 TEXT 取出，再在 [`ProjectRow::into_project`] 中解码。
#[derive(Debug, FromRow)]
struct ProjectRow {
    id: String,
    name: String,
    brand_name: String,
    aliases: String,
    website: Option<String>,
    region: String,
    language: String,
    industry: String,
    industry_label: Option<String>,
    tags: String,
    status: String,
    archived_at: Option<String>,
    created_at: String,
    updated_at: String,
}

impl ProjectRow {
    fn into_project(self) -> Result<Project, StoreError> {
        Ok(Project {
            id: codec::decode_scalar(&self.id)?,
            name: self.name,
            brand_name: self.brand_name,
            aliases: codec::decode_json(&self.aliases)?,
            website: self.website,
            region: self.region,
            language: codec::decode_scalar(&self.language)?,
            industry: codec::decode_scalar(&self.industry)?,
            industry_label: self.industry_label,
            tags: codec::decode_json(&self.tags)?,
            status: codec::decode_scalar(&self.status)?,
            archived_at: optional_time(self.archived_at.as_deref())?,
            created_at: codec::decode_time(&self.created_at)?,
            updated_at: codec::decode_time(&self.updated_at)?,
        })
    }
}

/// 项目仓储。
#[derive(Debug, Clone)]
pub struct ProjectRepo {
    pool: SqlitePool,
}

impl ProjectRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// 暴露连接池，供上层组合事务或做只读断言。
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// 新建项目。ID 冲突（唯一约束）由 `StoreError::Sqlx` 承载，稳定码 `state/conflict`。
    pub async fn create(&self, project: &Project) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO projects (id, name, brand_name, aliases, website, region, language, \
             industry, industry_label, tags, status, archived_at, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(project.id.to_string())
        .bind(&project.name)
        .bind(&project.brand_name)
        .bind(codec::encode_json(&project.aliases)?)
        .bind(project.website.as_deref())
        .bind(&project.region)
        .bind(codec::encode_scalar(&project.language)?)
        .bind(codec::encode_scalar(&project.industry)?)
        .bind(project.industry_label.as_deref())
        .bind(codec::encode_json(&project.tags)?)
        .bind(codec::encode_scalar(&project.status)?)
        .bind(optional_time_text(project.archived_at.as_ref()))
        .bind(codec::encode_time(&project.created_at))
        .bind(codec::encode_time(&project.updated_at))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 按 ID 读取；缺失时返回 `NotFound { kind: "project" }`。
    pub async fn get(&self, id: ProjectId) -> Result<Project, StoreError> {
        let mut builder = QueryBuilder::<Sqlite>::new(SELECT_PROJECTS);
        builder.push(" WHERE id = ");
        builder.push_bind(id.to_string());
        let row = builder
            .build_query_as::<ProjectRow>()
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| not_found("project", id))?;
        row.into_project()
    }

    /// 按过滤条件列出项目，`updated_at` 倒序（最近编辑在前）。
    pub async fn list(&self, filter: &ProjectFilter) -> Result<Vec<Project>, StoreError> {
        let mut builder = QueryBuilder::<Sqlite>::new(SELECT_PROJECTS);
        builder.push(" WHERE 1 = 1");
        if !filter.include_archived {
            builder.push(" AND status <> ");
            builder.push_bind(codec::encode_scalar(&ProjectStatus::Archived)?);
        }
        if let Some(query) = filter
            .query
            .as_deref()
            .map(str::trim)
            .filter(|query| !query.is_empty())
        {
            // LIKE 对 ASCII 大小写不敏感，中文按原样匹配。
            let pattern = format!("%{}%", escape_like(query));
            builder.push(" AND (name LIKE ");
            builder.push_bind(pattern.clone());
            builder.push(" ESCAPE '\\' OR brand_name LIKE ");
            builder.push_bind(pattern);
            builder.push(" ESCAPE '\\')");
        }
        for tag in &filter.tags {
            // `tags` 列是 JSON 数组文本（形如 ["SaaS","GEO"]）：匹配带引号的完整元素，
            // 避免 "Saa" 命中 "SaaS"。
            let pattern = format!("%{}%", escape_like(&codec::encode_json(tag)?));
            builder.push(" AND tags LIKE ");
            builder.push_bind(pattern);
            builder.push(" ESCAPE '\\'");
        }
        builder.push(" ORDER BY updated_at DESC, id ASC");
        let rows = builder
            .build_query_as::<ProjectRow>()
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(ProjectRow::into_project).collect()
    }

    /// 全量覆盖更新（含 `aliases` / `tags` 等 JSON 列）。
    pub async fn update(&self, project: &Project) -> Result<(), StoreError> {
        let result = sqlx::query(
            "UPDATE projects SET name = ?, brand_name = ?, aliases = ?, website = ?, region = ?, \
             language = ?, industry = ?, industry_label = ?, tags = ?, status = ?, archived_at = ?, \
             created_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&project.name)
        .bind(&project.brand_name)
        .bind(codec::encode_json(&project.aliases)?)
        .bind(project.website.as_deref())
        .bind(&project.region)
        .bind(codec::encode_scalar(&project.language)?)
        .bind(codec::encode_scalar(&project.industry)?)
        .bind(project.industry_label.as_deref())
        .bind(codec::encode_json(&project.tags)?)
        .bind(codec::encode_scalar(&project.status)?)
        .bind(optional_time_text(project.archived_at.as_ref()))
        .bind(codec::encode_time(&project.created_at))
        .bind(codec::encode_time(&project.updated_at))
        .bind(project.id.to_string())
        .execute(&self.pool)
        .await?;
        require_found(result.rows_affected(), "project", project.id)
    }

    /// 归档：写入 `status = archived` 与 `archived_at`。
    pub async fn archive(&self, id: ProjectId, now: DateTime<Utc>) -> Result<(), StoreError> {
        self.set_status(id, ProjectStatus::Archived, Some(now), now)
            .await
    }

    /// 取消归档：`status = active` 且清空 `archived_at`。
    pub async fn unarchive(&self, id: ProjectId, now: DateTime<Utc>) -> Result<(), StoreError> {
        self.set_status(id, ProjectStatus::Active, None, now).await
    }

    /// 删除项目及其全部子数据（级联）。幂等：行不存在也返回 `Ok`。
    pub async fn delete(&self, id: ProjectId) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn set_status(
        &self,
        id: ProjectId,
        status: ProjectStatus,
        archived_at: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> Result<(), StoreError> {
        let result = sqlx::query(
            "UPDATE projects SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(codec::encode_scalar(&status)?)
        .bind(optional_time_text(archived_at.as_ref()))
        .bind(codec::encode_time(&now))
        .bind(id.to_string())
        .execute(&self.pool)
        .await?;
        require_found(result.rows_affected(), "project", id)
    }
}

/// 转义 LIKE 通配符，避免关键词或标签里的 `%` / `_` / `\` 变成模糊匹配。
fn escape_like(raw: &str) -> String {
    let mut escaped = String::with_capacity(raw.len());
    for character in raw.chars() {
        if matches!(character, '%' | '_' | '\\') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn optional_time_text(value: Option<&DateTime<Utc>>) -> Option<String> {
    value.map(codec::encode_time)
}

fn optional_time(raw: Option<&str>) -> Result<Option<DateTime<Utc>>, StoreError> {
    raw.map(codec::decode_time).transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::testutil::{base_time, later, sample_project};
    use geo_domain::{Industry, Language};

    async fn setup() -> ProjectRepo {
        ProjectRepo::new(open_in_memory().await.expect("内存库可用"))
    }

    async fn raw_column(repo: &ProjectRepo, id: ProjectId, column: &str) -> String {
        let mut builder = QueryBuilder::<Sqlite>::new("SELECT ");
        builder.push(column);
        builder.push(" FROM projects WHERE id = ");
        builder.push_bind(id.to_string());
        builder
            .build_query_scalar::<String>()
            .fetch_one(repo.pool())
            .await
            .expect("读取原始列")
    }

    /// 断言用：`SELECT <column> IS NULL FROM projects WHERE id = ?`。
    async fn is_null_column(repo: &ProjectRepo, id: ProjectId, column: &str) -> i64 {
        let mut builder = QueryBuilder::<Sqlite>::new("SELECT ");
        builder.push(column);
        builder.push(" IS NULL FROM projects WHERE id = ");
        builder.push_bind(id.to_string());
        builder
            .build_query_scalar::<i64>()
            .fetch_one(repo.pool())
            .await
            .expect("读取判空结果")
    }

    #[test]
    fn default_filter_is_active_only_without_query() {
        let filter = ProjectFilter::default();
        assert_eq!(filter.query, None);
        assert!(!filter.include_archived);
        assert!(filter.tags.is_empty());
    }

    #[tokio::test]
    async fn create_then_get_roundtrips_every_field() {
        let repo = setup().await;
        let project = sample_project("稿得快 GEO 客户端");
        repo.create(&project).await.expect("写入项目");

        let loaded = repo.get(project.id).await.expect("读取项目");
        assert_eq!(loaded, project, "每个字段都必须原样往返");
    }

    #[tokio::test]
    async fn roundtrip_keeps_json_columns_and_industry_other() {
        let repo = setup().await;
        let mut project = sample_project("自定义行业项目");
        project.industry = Industry::Other;
        project.industry_label = Some("自定义".to_string());
        project.aliases = vec!["别名一".to_string(), "别名二".to_string()];
        project.tags = vec!["SaaS".to_string(), "GEO".to_string(), "制造业".to_string()];
        project.language = Language::EnUs;
        project.website = None;
        repo.create(&project).await.unwrap();

        let loaded = repo.get(project.id).await.unwrap();
        assert_eq!(loaded, project);
        assert_eq!(loaded.industry, Industry::Other);
        assert_eq!(loaded.industry_label.as_deref(), Some("自定义"));
        assert_eq!(loaded.aliases, project.aliases);
        assert_eq!(loaded.tags, project.tags);
        assert_eq!(loaded.website, None);
    }

    #[tokio::test]
    async fn enum_and_time_columns_use_documented_text_form() {
        let repo = setup().await;
        let mut project = sample_project("列格式");
        project.status = ProjectStatus::Archived;
        project.archived_at = Some(later(30));
        project.industry = Industry::CrossBorderEcommerce;
        project.created_at = base_time() + chrono::Duration::milliseconds(123);
        project.updated_at = project.created_at;
        repo.create(&project).await.unwrap();

        assert_eq!(raw_column(&repo, project.id, "status").await, "archived");
        assert_eq!(
            raw_column(&repo, project.id, "industry").await,
            "cross_border_ecommerce"
        );
        assert_eq!(
            raw_column(&repo, project.id, "aliases").await,
            r#"["GDK","gaodekuai"]"#
        );
        assert_eq!(
            raw_column(&repo, project.id, "created_at").await,
            "2026-09-16T08:00:00.123000000Z",
            "时间列必须是定宽 RFC3339 UTC"
        );
        // 亚秒精度必须无损往返，否则 updated_at 排序会与领域对象不一致。
        assert_eq!(repo.get(project.id).await.unwrap(), project);
    }

    #[tokio::test]
    async fn get_missing_project_is_not_found() {
        let repo = setup().await;
        let error = repo.get(ProjectId::new()).await.unwrap_err();
        assert!(matches!(
            error,
            StoreError::NotFound { ref kind, .. } if kind == "project"
        ));
        assert_eq!(error.code(), "project/not_found");
    }

    #[tokio::test]
    async fn list_query_matches_name_and_brand_name() {
        let repo = setup().await;
        let by_name = sample_project("工业水泵选型指南");
        let mut by_brand = sample_project("无关项目名");
        by_brand.brand_name = "沪水泵厂".to_string();
        let unrelated = sample_project("餐饮加盟");
        for project in [&by_name, &by_brand, &unrelated] {
            repo.create(project).await.unwrap();
        }

        let hits = repo
            .list(&ProjectFilter {
                query: Some("水泵".to_string()),
                ..Default::default()
            })
            .await
            .unwrap();
        let ids: Vec<ProjectId> = hits.iter().map(|project| project.id).collect();
        assert_eq!(ids.len(), 2, "项目名与品牌名都应命中：{ids:?}");
        assert!(ids.contains(&by_name.id));
        assert!(ids.contains(&by_brand.id));
    }

    #[tokio::test]
    async fn list_query_is_case_insensitive() {
        let repo = setup().await;
        let mut project = sample_project("SheepGeo 对比");
        project.brand_name = "SheepGeo".to_string();
        repo.create(&project).await.unwrap();

        let hits = repo
            .list(&ProjectFilter {
                query: Some("sheepgeo".to_string()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, project.id);
    }

    #[tokio::test]
    async fn list_excludes_archived_unless_requested() {
        let repo = setup().await;
        let active = sample_project("在营项目");
        let archived = sample_project("已归档项目");
        repo.create(&active).await.unwrap();
        repo.create(&archived).await.unwrap();
        repo.archive(archived.id, later(60)).await.unwrap();

        let visible = repo.list(&ProjectFilter::default()).await.unwrap();
        assert_eq!(visible.len(), 1, "默认不返回归档项目");
        assert_eq!(visible[0].id, active.id);

        let all = repo
            .list(&ProjectFilter {
                include_archived: true,
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(all.len(), 2);

        let loaded = repo.get(archived.id).await.unwrap();
        assert!(loaded.is_archived());
        assert_eq!(loaded.archived_at, Some(later(60)));
        assert_eq!(loaded.updated_at, later(60));
    }

    #[tokio::test]
    async fn list_orders_by_updated_at_desc() {
        let repo = setup().await;
        let older = sample_project("先建后改");
        let newer = sample_project("后建");
        repo.create(&older).await.unwrap();
        repo.create(&newer).await.unwrap();
        let mut touched = older.clone();
        touched.updated_at = later(600);
        repo.update(&touched).await.unwrap();

        let listed = repo.list(&ProjectFilter::default()).await.unwrap();
        assert_eq!(listed[0].id, older.id, "最近编辑的项目排在最前");
    }

    #[tokio::test]
    async fn list_tag_filter_requires_all_tags() {
        let repo = setup().await;
        let mut both = sample_project("双标签");
        both.tags = vec!["SaaS".to_string(), "GEO".to_string()];
        let mut single = sample_project("单标签");
        single.tags = vec!["GEO".to_string()];
        let mut none = sample_project("无标签");
        none.tags = vec![];
        for project in [&both, &single, &none] {
            repo.create(project).await.unwrap();
        }

        let hits = repo
            .list(&ProjectFilter {
                tags: vec!["SaaS".to_string(), "GEO".to_string()],
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, both.id);

        let partial = repo
            .list(&ProjectFilter {
                tags: vec!["GEO".to_string()],
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(partial.len(), 2);

        let miss = repo
            .list(&ProjectFilter {
                tags: vec!["不存在的标签".to_string()],
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(miss.is_empty());
    }

    #[tokio::test]
    async fn list_combines_query_tags_and_archive_filter() {
        let repo = setup().await;
        let mut hit = sample_project("水泵项目");
        hit.tags = vec!["制造业".to_string()];
        let mut wrong_tag = sample_project("水泵项目二");
        wrong_tag.tags = vec!["SaaS".to_string()];
        let mut archived_hit = sample_project("水泵项目三");
        archived_hit.tags = vec!["制造业".to_string()];
        for project in [&hit, &wrong_tag, &archived_hit] {
            repo.create(project).await.unwrap();
        }
        repo.archive(archived_hit.id, later(60)).await.unwrap();

        let hits = repo
            .list(&ProjectFilter {
                query: Some("水泵".to_string()),
                tags: vec!["制造业".to_string()],
                include_archived: false,
            })
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, hit.id);
    }

    #[tokio::test]
    async fn update_overwrites_every_column() {
        let repo = setup().await;
        let mut project = sample_project("原名");
        repo.create(&project).await.unwrap();

        project.name = "新名".to_string();
        project.brand_name = "新品牌".to_string();
        project.aliases = vec!["新别名".to_string()];
        project.tags = vec![];
        project.website = Some("https://new.example".to_string());
        project.region = "华南".to_string();
        project.language = Language::EnUs;
        project.industry = Industry::Franchise;
        project.industry_label = None;
        project.updated_at = later(120);
        repo.update(&project).await.unwrap();

        assert_eq!(repo.get(project.id).await.unwrap(), project);
    }

    #[tokio::test]
    async fn unarchive_restores_active_status() {
        let repo = setup().await;
        let project = sample_project("归档再恢复");
        repo.create(&project).await.unwrap();
        repo.archive(project.id, later(60)).await.unwrap();
        repo.unarchive(project.id, later(120)).await.unwrap();

        let loaded = repo.get(project.id).await.unwrap();
        assert!(!loaded.is_archived());
        assert_eq!(loaded.status, ProjectStatus::Active);
        assert_eq!(loaded.archived_at, None);
        assert_eq!(loaded.updated_at, later(120));
        assert_eq!(
            is_null_column(&repo, project.id, "archived_at").await,
            1,
            "取消归档后 archived_at 必须写回 NULL"
        );
    }

    #[tokio::test]
    async fn archive_missing_project_is_not_found() {
        let repo = setup().await;
        let error = repo
            .archive(ProjectId::new(), base_time())
            .await
            .unwrap_err();
        assert_eq!(error.code(), "project/not_found");
        let error = repo.update(&sample_project("不存在")).await.unwrap_err();
        assert_eq!(error.code(), "project/not_found");
    }

    #[tokio::test]
    async fn delete_removes_project_and_is_idempotent() {
        let repo = setup().await;
        let project = sample_project("待删项目");
        repo.create(&project).await.unwrap();

        repo.delete(project.id).await.unwrap();
        assert!(repo.get(project.id).await.is_err());
        repo.delete(project.id).await.expect("重复删除应幂等");
    }

    #[tokio::test]
    async fn create_with_duplicated_id_is_conflict() {
        let repo = setup().await;
        let project = sample_project("重复 ID");
        repo.create(&project).await.unwrap();
        assert!(
            repo.create(&project).await.is_err(),
            "主键冲突必须报错而不是静默覆盖"
        );
    }
}

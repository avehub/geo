//! 项目资产仓储：`project_assets` 表 ↔ [`ProjectAsset`]。
//!
//! 资产是"自有页面 / 第三方信源 / 社媒账号"的登记簿，抓取任务（`geo-crawler`）按此清单发现页面。

use geo_domain::{AssetId, ProjectAsset, ProjectId};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};

use crate::codec;
use crate::error::StoreError;

const SELECT_ASSETS: &str = "SELECT id, project_id, kind, url, title, note, created_at \
     FROM project_assets";

#[derive(Debug, FromRow)]
struct AssetRow {
    id: String,
    project_id: String,
    kind: String,
    url: String,
    title: Option<String>,
    note: Option<String>,
    created_at: String,
}

impl AssetRow {
    fn into_asset(self) -> Result<ProjectAsset, StoreError> {
        Ok(ProjectAsset {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            kind: codec::decode_scalar(&self.kind)?,
            url: self.url,
            title: self.title,
            note: self.note,
            created_at: codec::decode_time(&self.created_at)?,
        })
    }
}

/// 项目资产仓储。
#[derive(Debug, Clone)]
pub struct AssetRepo {
    pool: SqlitePool,
}

impl AssetRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// 登记一条资产。URL 合法性由 `geo-domain` 在构造 `ProjectAsset` 时校验。
    pub async fn add(&self, asset: &ProjectAsset) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO project_assets (id, project_id, kind, url, title, note, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(asset.id.to_string())
        .bind(asset.project_id.to_string())
        .bind(codec::encode_scalar(&asset.kind)?)
        .bind(&asset.url)
        .bind(asset.title.as_deref())
        .bind(asset.note.as_deref())
        .bind(codec::encode_time(&asset.created_at))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 列出某项目的资产，按登记时间升序（同时间按 ID，保证稳定）。
    pub async fn list_by_project(
        &self,
        project_id: ProjectId,
    ) -> Result<Vec<ProjectAsset>, StoreError> {
        let mut builder = QueryBuilder::<Sqlite>::new(SELECT_ASSETS);
        builder.push(" WHERE project_id = ");
        builder.push_bind(project_id.to_string());
        builder.push(" ORDER BY created_at ASC, id ASC");
        let rows = builder
            .build_query_as::<AssetRow>()
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(AssetRow::into_asset).collect()
    }

    /// 删除资产。幂等：行不存在也返回 `Ok`。
    pub async fn delete(&self, id: AssetId) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM project_assets WHERE id = ?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::repo::ProjectRepo;
    use crate::testutil::{base_time, sample_asset, sample_project};
    use geo_domain::AssetKind;

    async fn setup() -> (ProjectRepo, AssetRepo, ProjectId) {
        let pool = open_in_memory().await.expect("内存库可用");
        let projects = ProjectRepo::new(pool.clone());
        let project = sample_project("资产宿主项目");
        projects.create(&project).await.expect("先建项目满足外键");
        (projects, AssetRepo::new(pool), project.id)
    }

    #[tokio::test]
    async fn add_then_list_roundtrips_every_field() {
        let (_projects, repo, project_id) = setup().await;
        let asset = sample_asset(project_id, "https://www.gaodekuai.com/about");
        repo.add(&asset).await.unwrap();

        let listed = repo.list_by_project(project_id).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0], asset, "字段必须原样往返");
        assert_eq!(listed[0].kind, AssetKind::OwnedPage);
        assert_eq!(listed[0].title.as_deref(), Some("官网首页"));
    }

    #[tokio::test]
    async fn all_asset_kinds_roundtrip_as_snake_case() {
        let (_projects, repo, project_id) = setup().await;
        for (index, kind) in AssetKind::all().into_iter().enumerate() {
            let asset = ProjectAsset {
                kind,
                ..sample_asset(project_id, &format!("https://example.com/{index}"))
            };
            repo.add(&asset).await.unwrap();
        }

        let listed = repo.list_by_project(project_id).await.unwrap();
        assert_eq!(listed.len(), AssetKind::all().len());
        let kinds: Vec<AssetKind> = listed.iter().map(|asset| asset.kind).collect();
        for kind in AssetKind::all() {
            assert!(kinds.contains(&kind), "缺少资产类型 {kind:?}");
        }
    }

    #[tokio::test]
    async fn optional_columns_roundtrip_as_null() {
        let (_projects, repo, project_id) = setup().await;
        let asset = ProjectAsset {
            title: None,
            note: None,
            ..sample_asset(project_id, "https://example.com/bare")
        };
        repo.add(&asset).await.unwrap();

        let listed = repo.list_by_project(project_id).await.unwrap();
        assert_eq!(listed[0].title, None);
        assert_eq!(listed[0].note, None);
        assert_eq!(listed[0], asset);
    }

    #[tokio::test]
    async fn list_is_scoped_to_project_and_ordered_by_created_at() {
        let (projects, repo, project_id) = setup().await;
        let other = sample_project("另一个项目");
        projects.create(&other).await.unwrap();

        let first = sample_asset(project_id, "https://example.com/1");
        let second = ProjectAsset {
            created_at: base_time() + chrono::Duration::seconds(30),
            ..sample_asset(project_id, "https://example.com/2")
        };
        let foreign = sample_asset(other.id, "https://example.com/other");
        for asset in [&second, &foreign, &first] {
            repo.add(asset).await.unwrap();
        }

        let urls: Vec<String> = repo
            .list_by_project(project_id)
            .await
            .unwrap()
            .into_iter()
            .map(|asset| asset.url)
            .collect();
        assert_eq!(
            urls,
            vec![
                "https://example.com/1".to_string(),
                "https://example.com/2".to_string()
            ],
            "只返回本项目资产，且按登记时间升序"
        );
    }

    #[tokio::test]
    async fn delete_removes_asset_and_is_idempotent() {
        let (_projects, repo, project_id) = setup().await;
        let asset = sample_asset(project_id, "https://example.com/delete");
        repo.add(&asset).await.unwrap();

        repo.delete(asset.id).await.unwrap();
        assert!(repo.list_by_project(project_id).await.unwrap().is_empty());
        repo.delete(asset.id).await.expect("重复删除应幂等");
    }

    #[tokio::test]
    async fn add_without_parent_project_violates_foreign_key() {
        let (_projects, repo, _project_id) = setup().await;
        let orphan = sample_asset(ProjectId::new(), "https://example.com/orphan");
        assert!(repo.add(&orphan).await.is_err(), "外键必须拒绝孤儿行");
    }

    #[tokio::test]
    async fn deleting_project_cascades_to_assets() {
        let (projects, repo, project_id) = setup().await;
        repo.add(&sample_asset(project_id, "https://example.com/cascade"))
            .await
            .unwrap();
        projects.delete(project_id).await.unwrap();
        assert!(repo.list_by_project(project_id).await.unwrap().is_empty());
    }
}

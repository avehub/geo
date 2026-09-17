//! 竞品仓储：`competitors` 表 ↔ [`Competitor`]。
//!
//! 竞品数量上限（`MAX_COMPETITORS` = 5）由 `geo-domain` 的建项校验负责，仓储只保证
//! 持久化正确与 `position` 顺序稳定。

use geo_domain::{Competitor, CompetitorId, ProjectId};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};

use crate::codec;
use crate::error::StoreError;
use crate::repo::require_found;

const SELECT_COMPETITORS: &str = "SELECT id, project_id, name, aliases, website, note, position, \
     created_at FROM competitors";

#[derive(Debug, FromRow)]
struct CompetitorRow {
    id: String,
    project_id: String,
    name: String,
    aliases: String,
    website: Option<String>,
    note: Option<String>,
    position: i32,
    created_at: String,
}

impl CompetitorRow {
    fn into_competitor(self) -> Result<Competitor, StoreError> {
        Ok(Competitor {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            name: self.name,
            aliases: codec::decode_json(&self.aliases)?,
            website: self.website,
            note: self.note,
            position: self.position,
            created_at: codec::decode_time(&self.created_at)?,
        })
    }
}

/// 竞品仓储。
#[derive(Debug, Clone)]
pub struct CompetitorRepo {
    pool: SqlitePool,
}

impl CompetitorRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// 按 ID 插入或整体覆盖（含 `position`）。
    pub async fn upsert(&self, competitor: &Competitor) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO competitors (id, project_id, name, aliases, website, note, position, \
             created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET \
             project_id = excluded.project_id, name = excluded.name, aliases = excluded.aliases, \
             website = excluded.website, note = excluded.note, position = excluded.position, \
             created_at = excluded.created_at",
        )
        .bind(competitor.id.to_string())
        .bind(competitor.project_id.to_string())
        .bind(&competitor.name)
        .bind(codec::encode_json(&competitor.aliases)?)
        .bind(competitor.website.as_deref())
        .bind(competitor.note.as_deref())
        .bind(competitor.position)
        .bind(codec::encode_time(&competitor.created_at))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 列出某项目的竞品，按 `position` 升序（同序时按 ID，保证稳定）。
    pub async fn list_by_project(
        &self,
        project_id: ProjectId,
    ) -> Result<Vec<Competitor>, StoreError> {
        let mut builder = QueryBuilder::<Sqlite>::new(SELECT_COMPETITORS);
        builder.push(" WHERE project_id = ");
        builder.push_bind(project_id.to_string());
        builder.push(" ORDER BY position ASC, id ASC");
        let rows = builder
            .build_query_as::<CompetitorRow>()
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter()
            .map(CompetitorRow::into_competitor)
            .collect()
    }

    /// 删除竞品。幂等：行不存在也返回 `Ok`。
    pub async fn delete(&self, id: CompetitorId) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM competitors WHERE id = ?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// 按传入顺序把 `position` 重写为 `0..n`（单事务，全部成功或全部回滚）。
    ///
    /// `ids` 中出现不属于 `project_id` 的竞品时返回 `NotFound { kind: "competitor" }`，
    /// 且不写入任何位置变更。
    pub async fn reorder(
        &self,
        project_id: ProjectId,
        ids: &[CompetitorId],
    ) -> Result<(), StoreError> {
        // 单事务：任一 ID 不属于该项目就整体回滚，避免出现半套顺序。
        let mut transaction = self.pool.begin().await?;
        for (index, id) in ids.iter().enumerate() {
            // 竞品数量受 geo-domain 的 MAX_COMPETITORS 约束，序号不会溢出 i32。
            let position = index as i32;
            let result =
                sqlx::query("UPDATE competitors SET position = ? WHERE id = ? AND project_id = ?")
                    .bind(position)
                    .bind(id.to_string())
                    .bind(project_id.to_string())
                    .execute(&mut *transaction)
                    .await?;
            require_found(result.rows_affected(), "competitor", id)?;
        }
        transaction.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::repo::ProjectRepo;
    use crate::testutil::{base_time, later, sample_competitor, sample_project};

    async fn setup() -> (ProjectRepo, CompetitorRepo, ProjectId) {
        let pool = open_in_memory().await.expect("内存库可用");
        let projects = ProjectRepo::new(pool.clone());
        let project = sample_project("竞品宿主项目");
        projects.create(&project).await.expect("先建项目满足外键");
        (projects, CompetitorRepo::new(pool), project.id)
    }

    async fn names(repo: &CompetitorRepo, project_id: ProjectId) -> Vec<String> {
        repo.list_by_project(project_id)
            .await
            .unwrap()
            .into_iter()
            .map(|competitor| competitor.name)
            .collect()
    }

    #[tokio::test]
    async fn upsert_then_list_roundtrips_every_field() {
        let (_projects, repo, project_id) = setup().await;
        let mut competitor = sample_competitor(project_id, "SheepGeo", 0);
        competitor.created_at = base_time() + chrono::Duration::milliseconds(250);
        repo.upsert(&competitor).await.unwrap();

        let listed = repo.list_by_project(project_id).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0], competitor, "字段必须原样往返");
        assert_eq!(listed[0].aliases, vec!["SheepGeo别名".to_string()]);
    }

    #[tokio::test]
    async fn list_is_ordered_by_position() {
        let (_projects, repo, project_id) = setup().await;
        for (name, position) in [("丙", 2), ("甲", 0), ("乙", 1)] {
            repo.upsert(&sample_competitor(project_id, name, position))
                .await
                .unwrap();
        }
        assert_eq!(names(&repo, project_id).await, vec!["甲", "乙", "丙"]);
    }

    #[tokio::test]
    async fn upsert_twice_updates_in_place() {
        let (_projects, repo, project_id) = setup().await;
        let mut competitor = sample_competitor(project_id, "旧名", 0);
        repo.upsert(&competitor).await.unwrap();

        competitor.name = "新名".to_string();
        competitor.aliases = vec!["新别名".to_string()];
        competitor.website = None;
        competitor.note = None;
        competitor.position = 3;
        repo.upsert(&competitor).await.unwrap();

        let listed = repo.list_by_project(project_id).await.unwrap();
        assert_eq!(listed.len(), 1, "upsert 不应产生重复行");
        assert_eq!(listed[0], competitor);
    }

    #[tokio::test]
    async fn list_is_scoped_to_project() {
        let (projects, repo, project_id) = setup().await;
        let other = sample_project("另一个项目");
        projects.create(&other).await.unwrap();
        repo.upsert(&sample_competitor(project_id, "本项目竞品", 0))
            .await
            .unwrap();
        repo.upsert(&sample_competitor(other.id, "别项目竞品", 0))
            .await
            .unwrap();

        assert_eq!(names(&repo, project_id).await, vec!["本项目竞品"]);
        assert_eq!(names(&repo, other.id).await, vec!["别项目竞品"]);
    }

    #[tokio::test]
    async fn delete_removes_competitor_and_is_idempotent() {
        let (_projects, repo, project_id) = setup().await;
        let competitor = sample_competitor(project_id, "待删竞品", 0);
        repo.upsert(&competitor).await.unwrap();

        repo.delete(competitor.id).await.unwrap();
        assert!(repo.list_by_project(project_id).await.unwrap().is_empty());
        repo.delete(competitor.id).await.expect("重复删除应幂等");
    }

    #[tokio::test]
    async fn reorder_rewrites_positions_and_list_follows() {
        let (_projects, repo, project_id) = setup().await;
        let first = sample_competitor(project_id, "甲", 0);
        let second = sample_competitor(project_id, "乙", 1);
        let third = sample_competitor(project_id, "丙", 2);
        for competitor in [&first, &second, &third] {
            repo.upsert(competitor).await.unwrap();
        }

        repo.reorder(project_id, &[third.id, first.id, second.id])
            .await
            .unwrap();

        let listed = repo.list_by_project(project_id).await.unwrap();
        let ids: Vec<CompetitorId> = listed.iter().map(|item| item.id).collect();
        assert_eq!(ids, vec![third.id, first.id, second.id]);
        let positions: Vec<i32> = listed.iter().map(|item| item.position).collect();
        assert_eq!(positions, vec![0, 1, 2], "position 必须等于传入顺序");
    }

    #[tokio::test]
    async fn reorder_with_foreign_id_rolls_back() {
        let (projects, repo, project_id) = setup().await;
        let other = sample_project("另一个项目");
        projects.create(&other).await.unwrap();
        let mine = sample_competitor(project_id, "甲", 0);
        let foreign = sample_competitor(other.id, "别家竞品", 0);
        repo.upsert(&mine).await.unwrap();
        repo.upsert(&foreign).await.unwrap();

        let error = repo
            .reorder(project_id, &[foreign.id, mine.id])
            .await
            .unwrap_err();
        assert!(matches!(error, StoreError::NotFound { kind, .. } if kind == "competitor"));

        let listed = repo.list_by_project(project_id).await.unwrap();
        assert_eq!(listed[0].position, 0, "失败的重排必须整体回滚");
    }

    #[tokio::test]
    async fn upsert_without_parent_project_violates_foreign_key() {
        let (_projects, repo, _project_id) = setup().await;
        let orphan = sample_competitor(ProjectId::new(), "孤儿竞品", 0);
        assert!(repo.upsert(&orphan).await.is_err(), "外键必须拒绝孤儿行");
    }

    #[tokio::test]
    async fn deleting_project_cascades_to_competitors() {
        let (projects, repo, project_id) = setup().await;
        repo.upsert(&sample_competitor(project_id, "甲", 0))
            .await
            .unwrap();
        projects.delete(project_id).await.unwrap();
        assert!(repo.list_by_project(project_id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn created_at_keeps_subsecond_precision() {
        let (_projects, repo, project_id) = setup().await;
        let competitor = Competitor {
            created_at: later(45),
            ..sample_competitor(project_id, "时间精度", 0)
        };
        repo.upsert(&competitor).await.unwrap();
        let listed = repo.list_by_project(project_id).await.unwrap();
        assert_eq!(listed[0].created_at, later(45));
    }
}

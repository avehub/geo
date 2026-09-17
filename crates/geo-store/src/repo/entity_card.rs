//! 实体卡与字段级修订仓储：`entity_cards` / `entity_card_revisions`。
//!
//! 实体卡每个项目**至多一张**（主键就是 `project_id`），因此 `upsert` 即"整卡覆盖"；
//! 修订表是只追加的留痕（`geo-domain` 的 `EntityCard::set_field` 产出），按时间倒序读取。

use geo_domain::{EntityCard, EntityCardRevision, ProjectId};
use serde_json::Value;
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};

use crate::codec;
use crate::error::StoreError;

const SELECT_CARDS: &str = "SELECT project_id, fields, field_status, source, completeness, \
     created_at, updated_at FROM entity_cards";

const SELECT_REVISIONS: &str = "SELECT id, project_id, field_path, old_value, new_value, status, \
     note, edited_at FROM entity_card_revisions";

#[derive(Debug, FromRow)]
struct EntityCardRow {
    project_id: String,
    fields: String,
    field_status: String,
    source: String,
    completeness: f64,
    created_at: String,
    updated_at: String,
}

impl EntityCardRow {
    fn into_entity_card(self) -> Result<EntityCard, StoreError> {
        Ok(EntityCard {
            project_id: codec::decode_scalar(&self.project_id)?,
            fields: codec::decode_json(&self.fields)?,
            field_status: codec::decode_json(&self.field_status)?,
            source: codec::decode_json(&self.source)?,
            completeness: self.completeness,
            created_at: codec::decode_time(&self.created_at)?,
            updated_at: codec::decode_time(&self.updated_at)?,
        })
    }
}

#[derive(Debug, FromRow)]
struct RevisionRow {
    id: String,
    project_id: String,
    field_path: String,
    old_value: Option<String>,
    new_value: Option<String>,
    status: String,
    note: Option<String>,
    edited_at: String,
}

impl RevisionRow {
    fn into_revision(self) -> Result<EntityCardRevision, StoreError> {
        Ok(EntityCardRevision {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            field_path: self.field_path,
            old_value: decode_optional_json(self.old_value.as_deref())?,
            new_value: decode_optional_json(self.new_value.as_deref())?,
            status: codec::decode_scalar(&self.status)?,
            note: self.note,
            edited_at: codec::decode_time(&self.edited_at)?,
        })
    }
}

/// 实体卡与修订仓储。
#[derive(Debug, Clone)]
pub struct EntityCardRepo {
    pool: SqlitePool,
}

impl EntityCardRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// 写入或整卡覆盖。完整率等派生值由 `geo-domain` 计算，仓储原样落库。
    pub async fn upsert(&self, card: &EntityCard) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO entity_cards (project_id, fields, field_status, source, completeness, \
             created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) \
             DO UPDATE SET fields = excluded.fields, field_status = excluded.field_status, \
             source = excluded.source, completeness = excluded.completeness, \
             created_at = excluded.created_at, updated_at = excluded.updated_at",
        )
        .bind(card.project_id.to_string())
        .bind(codec::encode_json(&card.fields)?)
        .bind(codec::encode_json(&card.field_status)?)
        .bind(codec::encode_json(&card.source)?)
        .bind(card.completeness)
        .bind(codec::encode_time(&card.created_at))
        .bind(codec::encode_time(&card.updated_at))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 读取某项目的实体卡；尚未建档时返回 `None`（不是错误）。
    pub async fn get(&self, project_id: ProjectId) -> Result<Option<EntityCard>, StoreError> {
        let mut builder = QueryBuilder::<Sqlite>::new(SELECT_CARDS);
        builder.push(" WHERE project_id = ");
        builder.push_bind(project_id.to_string());
        let row = builder
            .build_query_as::<EntityCardRow>()
            .fetch_optional(&self.pool)
            .await?;
        row.map(EntityCardRow::into_entity_card).transpose()
    }

    /// 追加一条字段级修订留痕。
    pub async fn save_revision(&self, revision: &EntityCardRevision) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO entity_card_revisions (id, project_id, field_path, old_value, new_value, \
             status, note, edited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(revision.id.to_string())
        .bind(revision.project_id.to_string())
        .bind(&revision.field_path)
        .bind(encode_optional_json(&revision.old_value)?)
        .bind(encode_optional_json(&revision.new_value)?)
        .bind(codec::encode_scalar(&revision.status)?)
        .bind(revision.note.as_deref())
        .bind(codec::encode_time(&revision.edited_at))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 某项目的修订历史，`edited_at` 倒序（同一时刻按写入先后倒序，保证稳定）。
    pub async fn revisions(
        &self,
        project_id: ProjectId,
    ) -> Result<Vec<EntityCardRevision>, StoreError> {
        let mut builder = QueryBuilder::<Sqlite>::new(SELECT_REVISIONS);
        builder.push(" WHERE project_id = ");
        builder.push_bind(project_id.to_string());
        builder.push(" ORDER BY edited_at DESC, rowid DESC");
        let rows = builder
            .build_query_as::<RevisionRow>()
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(RevisionRow::into_revision).collect()
    }

    /// 删除某项目的实体卡与全部修订。幂等：不存在也返回 `Ok`。
    pub async fn delete_for_project(&self, project_id: ProjectId) -> Result<(), StoreError> {
        // 修订表本身有 ON DELETE CASCADE，但显式删除让"清空实体卡"不依赖项目被删。
        let mut transaction = self.pool.begin().await?;
        sqlx::query("DELETE FROM entity_card_revisions WHERE project_id = ?")
            .bind(project_id.to_string())
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM entity_cards WHERE project_id = ?")
            .bind(project_id.to_string())
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(())
    }
}

fn encode_optional_json(value: &Option<Value>) -> Result<Option<String>, StoreError> {
    value.as_ref().map(codec::encode_json).transpose()
}

fn decode_optional_json(raw: Option<&str>) -> Result<Option<Value>, StoreError> {
    raw.map(codec::decode_json).transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::repo::ProjectRepo;
    use crate::testutil::{
        base_time, later, sample_entity_card, sample_entity_card_with_source, sample_project,
        sample_revision,
    };
    use geo_domain::{FieldStatus, ProductSpec};

    async fn setup() -> (ProjectRepo, EntityCardRepo, ProjectId) {
        let pool = open_in_memory().await.expect("内存库可用");
        let projects = ProjectRepo::new(pool.clone());
        let project = sample_project("实体卡宿主项目");
        projects.create(&project).await.expect("先建项目满足外键");
        (projects, EntityCardRepo::new(pool), project.id)
    }

    #[tokio::test]
    async fn get_without_card_returns_none() {
        let (_projects, repo, project_id) = setup().await;
        assert_eq!(repo.get(project_id).await.unwrap(), None);
        assert!(repo.revisions(project_id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn upsert_then_get_roundtrips_every_field() {
        let (_projects, repo, project_id) = setup().await;
        let card = sample_entity_card(project_id);
        repo.upsert(&card).await.unwrap();

        let loaded = repo.get(project_id).await.unwrap().expect("应已建档");
        assert_eq!(loaded, card, "字段、状态表与来源都必须原样往返");
        assert_eq!(loaded.fields.products.len(), 1);
        assert_eq!(
            loaded.fields.products[0],
            ProductSpec {
                name: "GEO 客户端".to_string(),
                params: vec!["7 引擎".to_string()],
                note: Some("桌面端".to_string()),
            }
        );
        assert_eq!(
            loaded.field_status.get("standard_name"),
            Some(&FieldStatus::Official)
        );
        assert!((loaded.completeness - card.completeness).abs() < f64::EPSILON);
    }

    #[tokio::test]
    async fn upsert_keeps_ai_extraction_source_and_disputed_status() {
        let (_projects, repo, project_id) = setup().await;
        let card = sample_entity_card_with_source(project_id);
        repo.upsert(&card).await.unwrap();

        let loaded = repo.get(project_id).await.unwrap().expect("应已建档");
        assert_eq!(loaded, card);
        assert_eq!(
            loaded.source.crawled_pages,
            vec!["https://www.gaodekuai.com".to_string()]
        );
        assert_eq!(loaded.source.llm_provider.as_deref(), Some("deepseek"));
        assert!(loaded.source.is_ai_generated());
        assert_eq!(
            loaded.field_status.get("standard_name"),
            Some(&FieldStatus::Disputed)
        );
        assert_eq!(
            loaded.field_status.get("products"),
            Some(&FieldStatus::Pending)
        );
    }

    #[tokio::test]
    async fn second_upsert_overwrites_and_moves_updated_at() {
        let (_projects, repo, project_id) = setup().await;
        let first = sample_entity_card(project_id);
        repo.upsert(&first).await.unwrap();

        let mut second = first.clone();
        second.fields.standard_name = "稿得快（新口径）".to_string();
        second.fields.price_range = None;
        second.created_at = later(300);
        second.updated_at = later(600);
        second.field_status = [("standard_name".to_string(), FieldStatus::Disputed)]
            .into_iter()
            .collect();
        second.completeness = second.fields.completeness();
        repo.upsert(&second).await.unwrap();

        let loaded = repo.get(project_id).await.unwrap().expect("应已建档");
        assert_eq!(loaded, second, "二次 upsert 必须整卡覆盖");
        assert_eq!(loaded.updated_at, later(600));
        assert_ne!(loaded.updated_at, first.updated_at);
        assert_eq!(
            loaded.created_at,
            later(300),
            "upsert 是整卡覆盖，时间列一律按传入值写入"
        );
        assert_eq!(loaded.field_status.len(), 1, "状态表也是整表覆盖");
    }

    #[tokio::test]
    async fn revisions_come_back_newest_first() {
        let (_projects, repo, project_id) = setup().await;
        repo.upsert(&sample_entity_card(project_id)).await.unwrap();

        let older = sample_revision(project_id, "standard_name", base_time());
        let newer = sample_revision(project_id, "price_range", later(120));
        repo.save_revision(&older).await.unwrap();
        repo.save_revision(&newer).await.unwrap();

        let listed = repo.revisions(project_id).await.unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0], newer, "最新的修订排在最前");
        assert_eq!(listed[1], older);
        assert_eq!(listed[0].field_path, "price_range");
        assert_eq!(listed[0].status, FieldStatus::Official);
        assert_eq!(listed[0].note.as_deref(), Some("人工核对官网"));
    }

    #[tokio::test]
    async fn revisions_with_identical_timestamp_keep_insertion_order_reversed() {
        let (_projects, repo, project_id) = setup().await;
        let first = sample_revision(project_id, "cases", later(30));
        let second = sample_revision(project_id, "cases[0]", later(30));
        repo.save_revision(&first).await.unwrap();
        repo.save_revision(&second).await.unwrap();

        let listed = repo.revisions(project_id).await.unwrap();
        assert_eq!(listed[0].id, second.id, "同一时刻按写入先后倒序");
        assert_eq!(listed[1].id, first.id);
    }

    #[tokio::test]
    async fn revision_values_roundtrip_as_json_including_null_old_value() {
        let (_projects, repo, project_id) = setup().await;
        let mut revision = sample_revision(project_id, "products[0].params", later(10));
        revision.old_value = None;
        revision.new_value = Some(serde_json::json!(["7 引擎", "本地优先"]));
        revision.status = FieldStatus::Disputed;
        revision.note = None;
        repo.save_revision(&revision).await.unwrap();

        let loaded = &repo.revisions(project_id).await.unwrap()[0];
        assert_eq!(loaded, &revision);
        assert_eq!(loaded.old_value, None);
        assert_eq!(
            loaded.new_value,
            Some(serde_json::json!(["7 引擎", "本地优先"]))
        );
        assert_eq!(loaded.note, None);
    }

    #[tokio::test]
    async fn revisions_are_scoped_to_project() {
        let (projects, repo, project_id) = setup().await;
        let other = sample_project("另一个项目");
        projects.create(&other).await.unwrap();
        repo.upsert(&sample_entity_card(project_id)).await.unwrap();
        repo.upsert(&sample_entity_card(other.id)).await.unwrap();
        repo.save_revision(&sample_revision(project_id, "cases", base_time()))
            .await
            .unwrap();
        repo.save_revision(&sample_revision(other.id, "cases", base_time()))
            .await
            .unwrap();

        assert_eq!(repo.revisions(project_id).await.unwrap().len(), 1);
        assert_eq!(
            repo.get(other.id).await.unwrap().unwrap().project_id,
            other.id
        );
    }

    #[tokio::test]
    async fn delete_for_project_removes_card_and_revisions() {
        let (_projects, repo, project_id) = setup().await;
        repo.upsert(&sample_entity_card(project_id)).await.unwrap();
        repo.save_revision(&sample_revision(project_id, "cases", base_time()))
            .await
            .unwrap();

        repo.delete_for_project(project_id).await.unwrap();
        assert_eq!(repo.get(project_id).await.unwrap(), None);
        assert!(repo.revisions(project_id).await.unwrap().is_empty());
        repo.delete_for_project(project_id)
            .await
            .expect("重复删除应幂等");
    }

    #[tokio::test]
    async fn deleting_project_cascades_to_card_and_revisions() {
        let (projects, repo, project_id) = setup().await;
        repo.upsert(&sample_entity_card(project_id)).await.unwrap();
        repo.save_revision(&sample_revision(project_id, "cases", base_time()))
            .await
            .unwrap();

        projects.delete(project_id).await.unwrap();
        assert_eq!(repo.get(project_id).await.unwrap(), None);
        assert!(repo.revisions(project_id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn upsert_without_parent_project_violates_foreign_key() {
        let (_projects, repo, _project_id) = setup().await;
        let orphan = sample_entity_card(ProjectId::new());
        assert!(repo.upsert(&orphan).await.is_err(), "外键必须拒绝孤儿卡");
    }
}

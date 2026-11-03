//! FAQ 素材库仓储（M1.5，Plan C 第二个纵向切片）。
//!
//! 排序固定 `position ASC, id ASC`；`update` 只改可编辑列，
//! `source` / `position` / `created_at` 由服务层保留。

use geo_domain::{ContentStatus, FaqId, FaqItem, IntentCategory, LibrarySource, ProjectId};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};

use crate::codec;
use crate::error::StoreError;
use crate::repo::{not_found, require_found};

const SELECT_BY_PROJECT: &str =
    "SELECT id, project_id, question, answer_markdown, category, intent, status, source, \
     position, created_at, updated_at FROM faqs WHERE project_id = ? \
     ORDER BY position ASC, id ASC";

const SELECT_BY_ID: &str =
    "SELECT id, project_id, question, answer_markdown, category, intent, status, source, \
     position, created_at, updated_at FROM faqs WHERE id = ? AND project_id = ?";

#[derive(Debug, FromRow)]
struct FaqRow {
    id: String,
    project_id: String,
    question: String,
    answer_markdown: String,
    category: Option<String>,
    intent: String,
    status: String,
    source: String,
    position: i32,
    created_at: String,
    updated_at: String,
}

impl FaqRow {
    fn into_item(self) -> Result<FaqItem, StoreError> {
        Ok(FaqItem {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            question: self.question,
            answer_markdown: self.answer_markdown,
            category: self.category,
            intent: codec::decode_scalar::<IntentCategory>(&self.intent)?,
            status: codec::decode_scalar::<ContentStatus>(&self.status)?,
            source: codec::decode_scalar::<LibrarySource>(&self.source)?,
            position: self.position,
            created_at: codec::decode_time(&self.created_at)?,
            updated_at: codec::decode_time(&self.updated_at)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct FaqRepo {
    pool: SqlitePool,
}

impl FaqRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn list_by_project(&self, project_id: ProjectId) -> Result<Vec<FaqItem>, StoreError> {
        let rows = sqlx::query_as::<_, FaqRow>(SELECT_BY_PROJECT)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(FaqRow::into_item).collect()
    }

    pub async fn get(&self, id: FaqId, project_id: ProjectId) -> Result<FaqItem, StoreError> {
        let row = sqlx::query_as::<_, FaqRow>(SELECT_BY_ID)
            .bind(id.to_string())
            .bind(project_id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| not_found("faq", id))?;
        row.into_item()
    }

    pub async fn insert_many(&self, items: &[FaqItem]) -> Result<(), StoreError> {
        if items.is_empty() {
            return Ok(());
        }
        let mut transaction = self.pool.begin().await?;
        for item in items {
            sqlx::query(
                "INSERT INTO faqs (id, project_id, question, answer_markdown, category, intent, \
                 status, source, position, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(item.id.to_string())
            .bind(item.project_id.to_string())
            .bind(&item.question)
            .bind(&item.answer_markdown)
            .bind(&item.category)
            .bind(codec::encode_scalar(&item.intent)?)
            .bind(codec::encode_scalar(&item.status)?)
            .bind(codec::encode_scalar(&item.source)?)
            .bind(item.position)
            .bind(codec::encode_time(&item.created_at))
            .bind(codec::encode_time(&item.updated_at))
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn update(&self, item: &FaqItem) -> Result<(), StoreError> {
        let affected = sqlx::query(
            "UPDATE faqs SET question = ?, answer_markdown = ?, category = ?, intent = ?, \
             status = ?, updated_at = ? WHERE id = ? AND project_id = ?",
        )
        .bind(&item.question)
        .bind(&item.answer_markdown)
        .bind(&item.category)
        .bind(codec::encode_scalar(&item.intent)?)
        .bind(codec::encode_scalar(&item.status)?)
        .bind(codec::encode_time(&item.updated_at))
        .bind(item.id.to_string())
        .bind(item.project_id.to_string())
        .execute(&self.pool)
        .await?
        .rows_affected();
        require_found(affected, "faq", item.id)
    }

    pub async fn delete_many(
        &self,
        project_id: ProjectId,
        ids: &[FaqId],
    ) -> Result<(), StoreError> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut builder = QueryBuilder::<Sqlite>::new("DELETE FROM faqs WHERE project_id = ");
        builder.push_bind(project_id.to_string());
        builder.push(" AND id IN (");
        let mut separated = builder.separated(", ");
        for id in ids {
            separated.push_bind(id.to_string());
        }
        separated.push_unseparated(")");
        builder.build().execute(&self.pool).await?;
        Ok(())
    }

    pub async fn next_position(&self, project_id: ProjectId) -> Result<i32, StoreError> {
        let next = sqlx::query_scalar::<_, i32>(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM faqs WHERE project_id = ?",
        )
        .bind(project_id.to_string())
        .fetch_one(&self.pool)
        .await?;
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::repo::ProjectRepo;
    use crate::testutil::{base_time, later, sample_faq, sample_project};

    async fn setup() -> (FaqRepo, ProjectId, FaqRepo, ProjectId) {
        let pool = open_in_memory().await.expect("内存库可用");
        let projects = ProjectRepo::new(pool.clone());
        let project = sample_project("FAQ 宿主项目");
        let other = sample_project("另一个项目");
        projects.create(&project).await.expect("先建项目满足外键");
        projects.create(&other).await.expect("先建第二个项目");
        (
            FaqRepo::new(pool.clone()),
            project.id,
            FaqRepo::new(pool),
            other.id,
        )
    }

    #[tokio::test]
    async fn insert_then_list_roundtrips_in_position_order() {
        let (repo, project_id, _other, _other_id) = setup().await;
        let second = sample_faq(project_id, "第二个问题", 3);
        let first = sample_faq(project_id, "第一个问题", 1);
        repo.insert_many(&[second.clone(), first.clone()])
            .await
            .expect("写入");
        assert_eq!(
            repo.list_by_project(project_id).await.unwrap(),
            vec![first, second]
        );
    }

    #[tokio::test]
    async fn get_missing_is_not_found() {
        let (repo, _project_id, _other, _other_id) = setup().await;
        let error = repo.get(FaqId::new(), ProjectId::new()).await.unwrap_err();
        assert_eq!(error.code(), "faq/not_found");
    }

    #[tokio::test]
    async fn get_is_scoped_to_project() {
        let (repo, _project_id, other_repo, other_id) = setup().await;
        let foreign = sample_faq(other_id, "别人的问题", 0);
        repo.insert_many(std::slice::from_ref(&foreign))
            .await
            .expect("写入");
        assert_eq!(
            repo.get(foreign.id, ProjectId::new())
                .await
                .unwrap_err()
                .code(),
            "faq/not_found"
        );
        assert_eq!(other_repo.get(foreign.id, other_id).await.unwrap(), foreign);
    }

    #[tokio::test]
    async fn update_changes_editable_columns_only() {
        let (repo, project_id, _other, _other_id) = setup().await;
        let original = sample_faq(project_id, "旧问题", 4);
        repo.insert_many(std::slice::from_ref(&original))
            .await
            .expect("写入");
        let mut edited = original.clone();
        edited.question = "新问题".to_string();
        edited.answer_markdown = "新答案".to_string();
        edited.updated_at = later(60);
        edited.source = LibrarySource::Generated;
        edited.position = 99;
        edited.created_at = later(120);
        repo.update(&edited).await.expect("更新");
        let loaded = repo.get(original.id, project_id).await.unwrap();
        assert_eq!(loaded.question, "新问题");
        assert_eq!(loaded.answer_markdown, "新答案");
        assert_eq!(loaded.source, LibrarySource::Manual);
        assert_eq!(loaded.position, 4);
        assert_eq!(loaded.created_at, base_time());
        assert_eq!(loaded.updated_at, later(60));
    }

    #[tokio::test]
    async fn update_missing_is_not_found() {
        let (repo, project_id, _other, _other_id) = setup().await;
        let missing = sample_faq(project_id, "不存在", 0);
        assert_eq!(
            repo.update(&missing).await.unwrap_err().code(),
            "faq/not_found"
        );
    }

    #[tokio::test]
    async fn delete_is_idempotent_and_scoped_to_project() {
        let (repo, project_id, other_repo, other_id) = setup().await;
        let mine = sample_faq(project_id, "我的问题", 0);
        let theirs = sample_faq(other_id, "别人的问题", 0);
        repo.insert_many(std::slice::from_ref(&mine))
            .await
            .expect("写入");
        other_repo
            .insert_many(std::slice::from_ref(&theirs))
            .await
            .expect("写入");
        repo.delete_many(project_id, &[mine.id])
            .await
            .expect("删除");
        repo.delete_many(project_id, &[mine.id])
            .await
            .expect("重复删除");
        assert!(repo.list_by_project(project_id).await.unwrap().is_empty());
        assert_eq!(
            other_repo.list_by_project(other_id).await.unwrap(),
            vec![theirs]
        );
    }

    #[tokio::test]
    async fn next_position_continues_after_max() {
        let (repo, project_id, _other, _other_id) = setup().await;
        assert_eq!(repo.next_position(project_id).await.unwrap(), 0);
        repo.insert_many(&[
            sample_faq(project_id, "a", 0),
            sample_faq(project_id, "b", 1),
        ])
        .await
        .expect("写入");
        assert_eq!(repo.next_position(project_id).await.unwrap(), 2);
    }
}

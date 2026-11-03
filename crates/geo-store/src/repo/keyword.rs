//! 关键词素材库仓储（M1.5，Plan C 第一个纵向切片）。
//!
//! 只负责持久化：排序固定 `position ASC, id ASC`；`update` 只改可编辑列，
//! `source` / `position` / `created_at` 由服务层保留，避免前端整行回传时篡改归属。

use geo_domain::{ContentStatus, KeywordId, KeywordItem, LibrarySource, ProjectId};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};

use crate::codec;
use crate::error::StoreError;
use crate::repo::{not_found, require_found};

const SELECT_BY_PROJECT: &str =
    "SELECT id, project_id, text, kind, intent, monthly_volume, difficulty, priority, status, \
     note, source, position, created_at, updated_at FROM keywords WHERE project_id = ? \
     ORDER BY position ASC, id ASC";

const SELECT_BY_ID: &str =
    "SELECT id, project_id, text, kind, intent, monthly_volume, difficulty, priority, status, \
     note, source, position, created_at, updated_at FROM keywords WHERE id = ? AND project_id = ?";

#[derive(Debug, FromRow)]
struct KeywordRow {
    id: String,
    project_id: String,
    text: String,
    kind: String,
    intent: String,
    monthly_volume: Option<i64>,
    difficulty: Option<i32>,
    priority: i32,
    status: String,
    note: Option<String>,
    source: String,
    position: i32,
    created_at: String,
    updated_at: String,
}

impl KeywordRow {
    fn into_item(self) -> Result<KeywordItem, StoreError> {
        Ok(KeywordItem {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            text: self.text,
            kind: codec::decode_scalar(&self.kind)?,
            intent: codec::decode_scalar(&self.intent)?,
            monthly_volume: self.monthly_volume,
            difficulty: self.difficulty.map(codec::decode_u8).transpose()?,
            priority: codec::decode_u8(self.priority)?,
            status: codec::decode_scalar::<ContentStatus>(&self.status)?,
            note: self.note,
            source: codec::decode_scalar::<LibrarySource>(&self.source)?,
            position: self.position,
            created_at: codec::decode_time(&self.created_at)?,
            updated_at: codec::decode_time(&self.updated_at)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct KeywordRepo {
    pool: SqlitePool,
}

impl KeywordRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// 某项目的全部关键词，固定 `position ASC, id ASC`。
    pub async fn list_by_project(
        &self,
        project_id: ProjectId,
    ) -> Result<Vec<KeywordItem>, StoreError> {
        let rows = sqlx::query_as::<_, KeywordRow>(SELECT_BY_PROJECT)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(KeywordRow::into_item).collect()
    }

    /// 按 `(id, project_id)` 取一条；跨项目 id 视为不存在。
    pub async fn get(
        &self,
        id: KeywordId,
        project_id: ProjectId,
    ) -> Result<KeywordItem, StoreError> {
        let row = sqlx::query_as::<_, KeywordRow>(SELECT_BY_ID)
            .bind(id.to_string())
            .bind(project_id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| not_found("keyword", id))?;
        row.into_item()
    }

    /// 批量写入（调用方已保证 `position` 连续且校验通过）。
    pub async fn insert_many(&self, items: &[KeywordItem]) -> Result<(), StoreError> {
        if items.is_empty() {
            return Ok(());
        }
        let mut transaction = self.pool.begin().await?;
        for item in items {
            sqlx::query(
                "INSERT INTO keywords (id, project_id, text, kind, intent, monthly_volume, \
                 difficulty, priority, status, note, source, position, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(item.id.to_string())
            .bind(item.project_id.to_string())
            .bind(&item.text)
            .bind(codec::encode_scalar(&item.kind)?)
            .bind(codec::encode_scalar(&item.intent)?)
            .bind(item.monthly_volume)
            .bind(item.difficulty.map(i32::from))
            .bind(i32::from(item.priority))
            .bind(codec::encode_scalar(&item.status)?)
            .bind(&item.note)
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

    /// 整行更新**可编辑列**；`source` / `position` / `created_at` 不在 SET 里。
    pub async fn update(&self, item: &KeywordItem) -> Result<(), StoreError> {
        let affected = sqlx::query(
            "UPDATE keywords SET text = ?, kind = ?, intent = ?, monthly_volume = ?, \
             difficulty = ?, priority = ?, status = ?, note = ?, updated_at = ? \
             WHERE id = ? AND project_id = ?",
        )
        .bind(&item.text)
        .bind(codec::encode_scalar(&item.kind)?)
        .bind(codec::encode_scalar(&item.intent)?)
        .bind(item.monthly_volume)
        .bind(item.difficulty.map(i32::from))
        .bind(i32::from(item.priority))
        .bind(codec::encode_scalar(&item.status)?)
        .bind(&item.note)
        .bind(codec::encode_time(&item.updated_at))
        .bind(item.id.to_string())
        .bind(item.project_id.to_string())
        .execute(&self.pool)
        .await?
        .rows_affected();
        require_found(affected, "keyword", item.id)
    }

    /// 批量删除，幂等；只删本项目命中的行。
    pub async fn delete_many(
        &self,
        project_id: ProjectId,
        ids: &[KeywordId],
    ) -> Result<(), StoreError> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut builder = QueryBuilder::<Sqlite>::new("DELETE FROM keywords WHERE project_id = ");
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

    /// 下一个可用 `position`；空库从 0 开始。
    pub async fn next_position(&self, project_id: ProjectId) -> Result<i32, StoreError> {
        let next = sqlx::query_scalar::<_, i32>(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM keywords WHERE project_id = ?",
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
    use crate::testutil::{base_time, later, sample_keyword, sample_project};
    use geo_domain::KeywordKind;

    async fn setup() -> (KeywordRepo, ProjectId, KeywordRepo, ProjectId) {
        let pool = open_in_memory().await.expect("内存库可用");
        let projects = ProjectRepo::new(pool.clone());
        let project = sample_project("关键词宿主项目");
        let other = sample_project("另一个项目");
        projects.create(&project).await.expect("先建项目满足外键");
        projects.create(&other).await.expect("先建第二个项目");
        (
            KeywordRepo::new(pool.clone()),
            project.id,
            KeywordRepo::new(pool),
            other.id,
        )
    }

    #[tokio::test]
    async fn insert_then_list_roundtrips_in_position_order() {
        let (repo, project_id, _other_repo, _other_id) = setup().await;
        let mut second = sample_keyword(project_id, "布袋除尘器厂家", 3);
        second.kind = KeywordKind::LongTail;
        second.monthly_volume = None;
        second.difficulty = None;
        let first = sample_keyword(project_id, "工业除尘器", 1);
        repo.insert_many(&[second.clone(), first.clone()])
            .await
            .expect("批量写入");

        let loaded = repo.list_by_project(project_id).await.expect("列表");
        assert_eq!(
            loaded,
            vec![first, second],
            "必须按 position 升序且全字段无损"
        );
    }

    #[tokio::test]
    async fn get_missing_is_not_found_with_stable_code() {
        let (repo, _project_id, _other_repo, _other_id) = setup().await;
        let error = repo
            .get(KeywordId::new(), ProjectId::new())
            .await
            .unwrap_err();
        assert_eq!(error.code(), "keyword/not_found");
    }

    #[tokio::test]
    async fn get_is_scoped_to_project() {
        let (repo, _project_id, other_repo, other_id) = setup().await;
        let foreign = sample_keyword(other_id, "别的项目的词", 0);
        repo.insert_many(std::slice::from_ref(&foreign))
            .await
            .expect("写入");
        let error = repo.get(foreign.id, ProjectId::new()).await.unwrap_err();
        assert_eq!(error.code(), "keyword/not_found");
        assert_eq!(other_repo.get(foreign.id, other_id).await.unwrap(), foreign);
    }

    #[tokio::test]
    async fn update_changes_editable_columns_only() {
        let (repo, project_id, _other_repo, _other_id) = setup().await;
        let original = sample_keyword(project_id, "旧文本", 4);
        repo.insert_many(std::slice::from_ref(&original))
            .await
            .expect("写入");

        let mut edited = original.clone();
        edited.text = "新文本".to_string();
        edited.priority = 5;
        edited.updated_at = later(60);
        // 即便入参试图改这些列，SQL 也不写：模拟前端整行回传。
        edited.source = LibrarySource::Generated;
        edited.position = 99;
        edited.created_at = later(120);
        repo.update(&edited).await.expect("更新");

        let loaded = repo.get(original.id, project_id).await.expect("读回");
        assert_eq!(loaded.text, "新文本");
        assert_eq!(loaded.priority, 5);
        assert_eq!(
            loaded.source,
            LibrarySource::Manual,
            "source 不允许被整行回传改掉"
        );
        assert_eq!(loaded.position, 4, "position 不允许被整行回传改掉");
        assert_eq!(
            loaded.created_at,
            base_time(),
            "created_at 不允许被整行回传改掉"
        );
        assert_eq!(loaded.updated_at, later(60));
    }

    #[tokio::test]
    async fn update_missing_is_not_found() {
        let (repo, project_id, _other_repo, _other_id) = setup().await;
        let missing = sample_keyword(project_id, "不存在的词", 0);
        assert_eq!(
            repo.update(&missing).await.unwrap_err().code(),
            "keyword/not_found"
        );
    }

    #[tokio::test]
    async fn delete_is_idempotent_and_scoped_to_project() {
        let (repo, project_id, other_repo, other_id) = setup().await;
        let mine = sample_keyword(project_id, "我的词", 0);
        let theirs = sample_keyword(other_id, "别人的词", 0);
        repo.insert_many(std::slice::from_ref(&mine))
            .await
            .expect("写入");
        other_repo
            .insert_many(std::slice::from_ref(&theirs))
            .await
            .expect("写入");

        repo.delete_many(project_id, &[mine.id, mine.id])
            .await
            .expect("删除");
        repo.delete_many(project_id, &[mine.id])
            .await
            .expect("重复删除仍成功");
        assert!(repo.list_by_project(project_id).await.unwrap().is_empty());
        assert_eq!(
            other_repo.list_by_project(other_id).await.unwrap(),
            vec![theirs]
        );
    }

    #[tokio::test]
    async fn next_position_continues_after_max() {
        let (repo, project_id, _other_repo, _other_id) = setup().await;
        assert_eq!(repo.next_position(project_id).await.unwrap(), 0);
        repo.insert_many(&[
            sample_keyword(project_id, "a", 0),
            sample_keyword(project_id, "b", 1),
        ])
        .await
        .expect("写入");
        assert_eq!(repo.next_position(project_id).await.unwrap(), 2);
    }
}

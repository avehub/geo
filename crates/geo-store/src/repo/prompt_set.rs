//! Prompt 题库仓储：`prompt_sets` + `prompt_items`（版本化快照）。
//!
//! 一个 `PromptSet` 就是**一轮复测的题目快照**：条目、内容哈希、口径版本一起冻结，
//! 这样 P0-B 起每轮采集结果才能环比（见 spec 3.1）。因此本仓储只提供「整包写入」与
//! 「整包替换条目」，不提供逐条改文本的接口——改文本请走
//! [`replace_items`](PromptSetRepo::replace_items)，它会重算哈希与样本量分级。

use chrono::{DateTime, Utc};
use geo_domain::prompt::{content_hash, sample_size_grade};
use geo_domain::{ProjectId, PromptItem, PromptSet, PromptSetId, SampleSizeGrade};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};

use crate::codec;
use crate::error::StoreError;

const SELECT_SETS: &str = "SELECT id, project_id, version, label, item_count, content_hash, \
     engine_scope, metric_spec_version, sample_size_grade, created_at, notes FROM prompt_sets";

const SELECT_ITEMS: &str = "SELECT id, set_id, text, intent, weight, group_name, tags, source, \
     competitor_ids, repeat_count, position FROM prompt_items";

const SELECT_MAX_VERSION: &str = "SELECT MAX(version) FROM prompt_sets WHERE project_id = ?";

/// 列表页用的题库摘要：不含 `items`，避免一次拉回上百条文本。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PromptSetSummary {
    pub id: PromptSetId,
    pub project_id: ProjectId,
    pub version: i32,
    pub label: String,
    pub item_count: usize,
    pub content_hash: String,
    pub sample_size_grade: SampleSizeGrade,
    pub created_at: DateTime<Utc>,
    pub notes: Option<String>,
}

#[derive(Debug, FromRow)]
struct SetRow {
    id: String,
    project_id: String,
    version: i32,
    label: String,
    item_count: i32,
    content_hash: String,
    engine_scope: String,
    metric_spec_version: String,
    sample_size_grade: String,
    created_at: String,
    notes: Option<String>,
}

#[derive(Debug, FromRow)]
struct ItemRow {
    id: String,
    set_id: String,
    text: String,
    intent: String,
    weight: i32,
    group_name: Option<String>,
    tags: String,
    source: String,
    competitor_ids: String,
    repeat_count: i32,
    position: i32,
}

impl SetRow {
    fn into_summary(self) -> Result<PromptSetSummary, StoreError> {
        Ok(PromptSetSummary {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            version: self.version,
            label: self.label,
            item_count: usize::try_from(self.item_count).unwrap_or(0),
            content_hash: self.content_hash,
            sample_size_grade: codec::decode_scalar(&self.sample_size_grade)?,
            created_at: codec::decode_time(&self.created_at)?,
            notes: self.notes,
        })
    }
}

impl ItemRow {
    fn into_item(self) -> Result<PromptItem, StoreError> {
        Ok(PromptItem {
            id: codec::decode_scalar(&self.id)?,
            set_id: codec::decode_scalar(&self.set_id)?,
            text: self.text,
            intent: codec::decode_scalar(&self.intent)?,
            weight: codec::decode_u8(self.weight)?,
            group_name: self.group_name,
            tags: codec::decode_json(&self.tags)?,
            source: codec::decode_scalar(&self.source)?,
            competitor_ids: codec::decode_json(&self.competitor_ids)?,
            repeat_count: codec::decode_u8(self.repeat_count)?,
            position: self.position,
        })
    }
}

#[derive(Debug, Clone)]
pub struct PromptSetRepo {
    pool: SqlitePool,
}

impl PromptSetRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// 写入一个版本快照（set + items，单事务）。
    pub async fn create(&self, set: &PromptSet) -> Result<(), StoreError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO prompt_sets (id, project_id, version, label, item_count, content_hash, \
             engine_scope, metric_spec_version, sample_size_grade, created_at, notes) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(set.id.to_string())
        .bind(set.project_id.to_string())
        .bind(set.version)
        .bind(&set.label)
        .bind(item_count_column(&set.items))
        .bind(&set.content_hash)
        .bind(codec::encode_json(&set.engine_scope)?)
        .bind(&set.metric_spec_version)
        .bind(codec::encode_scalar(&set.sample_size_grade)?)
        .bind(codec::encode_time(&set.created_at))
        .bind(set.notes.as_deref())
        .execute(&mut *transaction)
        .await?;

        insert_items(&mut transaction, set.id, &set.items, &set.created_at).await?;
        transaction.commit().await?;
        Ok(())
    }

    /// 读取完整快照（含全部条目，按 `position` 升序）。
    pub async fn get(&self, id: PromptSetId) -> Result<PromptSet, StoreError> {
        let row = self
            .fetch_row(id)
            .await?
            .ok_or_else(|| super::not_found("prompt_set", id))?;
        let items = self.fetch_items(id).await?;
        into_prompt_set(row, items)
    }

    /// 某项目版本最大的快照（含条目），没有则 `None`。
    pub async fn latest_for_project(
        &self,
        project_id: ProjectId,
    ) -> Result<Option<PromptSet>, StoreError> {
        let mut builder = QueryBuilder::<Sqlite>::new(SELECT_SETS);
        builder.push(" WHERE project_id = ");
        builder.push_bind(project_id.to_string());
        builder.push(" ORDER BY version DESC, created_at DESC LIMIT 1");
        let Some(row) = builder
            .build_query_as::<SetRow>()
            .fetch_optional(&self.pool)
            .await?
        else {
            return Ok(None);
        };
        let id: PromptSetId = codec::decode_scalar(&row.id)?;
        let items = self.fetch_items(id).await?;
        into_prompt_set(row, items).map(Some)
    }

    /// 某项目的全部快照摘要，版本倒序，**不加载条目**。
    pub async fn list_by_project(
        &self,
        project_id: ProjectId,
    ) -> Result<Vec<PromptSetSummary>, StoreError> {
        let mut builder = QueryBuilder::<Sqlite>::new(SELECT_SETS);
        builder.push(" WHERE project_id = ");
        builder.push_bind(project_id.to_string());
        builder.push(" ORDER BY version DESC, created_at DESC");
        builder
            .build_query_as::<SetRow>()
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(SetRow::into_summary)
            .collect()
    }

    /// 下一个版本号：无快照时为 1。
    pub async fn next_version(&self, project_id: ProjectId) -> Result<i32, StoreError> {
        let (max_version,): (Option<i32>,) = sqlx::query_as(SELECT_MAX_VERSION)
            .bind(project_id.to_string())
            .fetch_one(&self.pool)
            .await?;
        Ok(max_version.map_or(1, |max| max + 1))
    }

    /// 只改标签：内容不变，因此 `content_hash` 也不变（环比仍然成立）。
    pub async fn rename(
        &self,
        id: PromptSetId,
        label: &str,
    ) -> Result<PromptSetSummary, StoreError> {
        let rows = sqlx::query("UPDATE prompt_sets SET label = ? WHERE id = ?")
            .bind(label)
            .bind(id.to_string())
            .execute(&self.pool)
            .await?
            .rows_affected();
        super::require_found(rows, "prompt_set", id)?;

        let row = self
            .fetch_row(id)
            .await?
            .ok_or_else(|| super::not_found("prompt_set", id))?;
        row.into_summary()
    }

    /// 整包替换条目，并重算 `item_count` / `content_hash` / `sample_size_grade`。
    /// `now` 用作新条目的写入时间。
    pub async fn replace_items(
        &self,
        set_id: PromptSetId,
        items: Vec<PromptItem>,
        now: DateTime<Utc>,
    ) -> Result<PromptSet, StoreError> {
        if self.fetch_row(set_id).await?.is_none() {
            return Err(super::not_found("prompt_set", set_id));
        }

        let hash = content_hash(&items);
        let grade = sample_size_grade(items.len());

        let mut transaction = self.pool.begin().await?;
        sqlx::query("DELETE FROM prompt_items WHERE set_id = ?")
            .bind(set_id.to_string())
            .execute(&mut *transaction)
            .await?;
        insert_items(&mut transaction, set_id, &items, &now).await?;
        sqlx::query(
            "UPDATE prompt_sets SET item_count = ?, content_hash = ?, sample_size_grade = ? \
             WHERE id = ?",
        )
        .bind(item_count_column(&items))
        .bind(&hash)
        .bind(codec::encode_scalar(&grade)?)
        .bind(set_id.to_string())
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;

        self.get(set_id).await
    }

    /// 删除快照（`prompt_items` 由外键级联删除）。幂等：不存在也返回 `Ok`。
    pub async fn delete(&self, id: PromptSetId) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM prompt_sets WHERE id = ?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn fetch_row(&self, id: PromptSetId) -> Result<Option<SetRow>, StoreError> {
        let mut builder = QueryBuilder::<Sqlite>::new(SELECT_SETS);
        builder.push(" WHERE id = ");
        builder.push_bind(id.to_string());
        Ok(builder
            .build_query_as::<SetRow>()
            .fetch_optional(&self.pool)
            .await?)
    }

    async fn fetch_items(&self, set_id: PromptSetId) -> Result<Vec<PromptItem>, StoreError> {
        let mut builder = QueryBuilder::<Sqlite>::new(SELECT_ITEMS);
        builder.push(" WHERE set_id = ");
        builder.push_bind(set_id.to_string());
        builder.push(" ORDER BY position ASC, rowid ASC");
        builder
            .build_query_as::<ItemRow>()
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(ItemRow::into_item)
            .collect()
    }
}

fn into_prompt_set(row: SetRow, items: Vec<PromptItem>) -> Result<PromptSet, StoreError> {
    Ok(PromptSet {
        id: codec::decode_scalar(&row.id)?,
        project_id: codec::decode_scalar(&row.project_id)?,
        version: row.version,
        label: row.label,
        items,
        content_hash: row.content_hash,
        engine_scope: codec::decode_json(&row.engine_scope)?,
        metric_spec_version: row.metric_spec_version,
        sample_size_grade: codec::decode_scalar(&row.sample_size_grade)?,
        created_at: codec::decode_time(&row.created_at)?,
        notes: row.notes,
    })
}

/// SQLite 没有无符号整型，`usize` 统一以 `i64` 落库。
fn item_count_column(items: &[PromptItem]) -> i64 {
    i64::try_from(items.len()).unwrap_or(i64::MAX)
}

/// set 与 items 必须在同一事务里写：条目的 `created_at` 复用快照时间。
async fn insert_items(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    set_id: PromptSetId,
    items: &[PromptItem],
    created_at: &DateTime<Utc>,
) -> Result<(), StoreError> {
    let created_at = codec::encode_time(created_at);
    let set_id = set_id.to_string();
    for item in items {
        sqlx::query(
            "INSERT INTO prompt_items (id, set_id, text, intent, weight, group_name, tags, \
             source, competitor_ids, repeat_count, position, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(item.id.to_string())
        .bind(&set_id)
        .bind(&item.text)
        .bind(codec::encode_scalar(&item.intent)?)
        .bind(codec::encode_u8(item.weight))
        .bind(item.group_name.as_deref())
        .bind(codec::encode_json(&item.tags)?)
        .bind(codec::encode_scalar(&item.source)?)
        .bind(codec::encode_json(&item.competitor_ids)?)
        .bind(codec::encode_u8(item.repeat_count))
        .bind(item.position)
        .bind(&created_at)
        .execute(&mut **transaction)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::repo::ProjectRepo;
    use crate::testutil::{base_time, later, sample_items, sample_project, sample_prompt_set};
    use geo_domain::prompt::{content_hash, sample_size_grade};
    use geo_domain::SampleSizeGrade;

    async fn setup() -> (PromptSetRepo, ProjectId) {
        let pool = open_in_memory().await.expect("内存库可用");
        let projects = ProjectRepo::new(pool.clone());
        let project = sample_project("题库宿主项目");
        projects.create(&project).await.expect("先建项目满足外键");
        (PromptSetRepo::new(pool), project.id)
    }

    #[tokio::test]
    async fn create_then_get_roundtrips_every_item_in_position_order() {
        let (repo, project_id) = setup().await;
        let set = sample_prompt_set(project_id, 1, 80);
        repo.create(&set).await.expect("写入题库");

        let loaded = repo.get(set.id).await.expect("读回题库");
        assert_eq!(loaded, set, "全字段（含 items）必须无损往返");
        assert_eq!(loaded.items.len(), 80);
        let positions: Vec<i32> = loaded.items.iter().map(|item| item.position).collect();
        let mut sorted = positions.clone();
        sorted.sort_unstable();
        assert_eq!(positions, sorted, "items 必须按 position 升序返回");
    }

    #[tokio::test]
    async fn get_missing_set_is_not_found_with_stable_code() {
        let (repo, _project_id) = setup().await;
        let error = repo.get(PromptSetId::new()).await.unwrap_err();
        assert!(matches!(&error, StoreError::NotFound { kind, .. } if kind == "prompt_set"));
        assert_eq!(error.code(), "prompt_set/not_found");
    }

    #[tokio::test]
    async fn replace_items_recomputes_hash_count_and_grade() {
        let (repo, project_id) = setup().await;
        let set = sample_prompt_set(project_id, 1, 80);
        repo.create(&set).await.unwrap();

        let fewer = sample_items(set.id, 40);
        let updated = repo
            .replace_items(set.id, fewer.clone(), later(60))
            .await
            .expect("替换条目");

        assert_eq!(updated.items.len(), 40);
        assert_ne!(updated.content_hash, set.content_hash, "内容变了哈希必须变");
        assert_eq!(updated.content_hash, content_hash(&fewer));
        assert_eq!(updated.sample_size_grade, sample_size_grade(40));
        assert_eq!(updated.sample_size_grade, SampleSizeGrade::Directional);

        let reloaded = repo.get(set.id).await.unwrap();
        assert_eq!(reloaded.content_hash, updated.content_hash);
        assert_eq!(reloaded.items.len(), 40);
    }

    #[tokio::test]
    async fn latest_for_project_returns_highest_version() {
        let (repo, project_id) = setup().await;
        for version in [2, 1, 3] {
            repo.create(&sample_prompt_set(project_id, version, 5))
                .await
                .unwrap();
        }
        let latest = repo
            .latest_for_project(project_id)
            .await
            .unwrap()
            .expect("有题库");
        assert_eq!(latest.version, 3);
        assert_eq!(latest.items.len(), 5, "latest 需要带 items 供直接复测");
    }

    #[tokio::test]
    async fn latest_for_project_without_sets_is_none() {
        let (repo, project_id) = setup().await;
        assert_eq!(repo.latest_for_project(project_id).await.unwrap(), None);
    }

    #[tokio::test]
    async fn list_by_project_returns_summaries_newest_first_without_items() {
        let (repo, project_id) = setup().await;
        repo.create(&sample_prompt_set(project_id, 1, 60))
            .await
            .unwrap();
        repo.create(&sample_prompt_set(project_id, 2, 61))
            .await
            .unwrap();

        let list = repo.list_by_project(project_id).await.unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].version, 2, "版本倒序，最新在前");
        assert_eq!(list[0].item_count, 61);
        assert_eq!(list[1].item_count, 60);
        assert_eq!(list[0].sample_size_grade, SampleSizeGrade::Sufficient);
    }

    #[tokio::test]
    async fn next_version_starts_at_one_and_increments() {
        let (repo, project_id) = setup().await;
        assert_eq!(repo.next_version(project_id).await.unwrap(), 1);
        repo.create(&sample_prompt_set(project_id, 1, 3))
            .await
            .unwrap();
        assert_eq!(repo.next_version(project_id).await.unwrap(), 2);
    }

    #[tokio::test]
    async fn rename_updates_label_and_keeps_items() {
        let (repo, project_id) = setup().await;
        let set = sample_prompt_set(project_id, 1, 10);
        repo.create(&set).await.unwrap();

        let summary = repo.rename(set.id, "2026 Q4 复测题库").await.unwrap();
        assert_eq!(summary.label, "2026 Q4 复测题库");
        assert_eq!(summary.item_count, 10);

        let reloaded = repo.get(set.id).await.unwrap();
        assert_eq!(reloaded.label, "2026 Q4 复测题库");
        assert_eq!(
            reloaded.content_hash, set.content_hash,
            "改名不改内容，哈希不变"
        );
    }

    #[tokio::test]
    async fn rename_missing_set_is_not_found() {
        let (repo, _project_id) = setup().await;
        let error = repo.rename(PromptSetId::new(), "x").await.unwrap_err();
        assert_eq!(error.code(), "prompt_set/not_found");
    }

    #[tokio::test]
    async fn delete_removes_set_and_cascades_items() {
        let (repo, project_id) = setup().await;
        let set = sample_prompt_set(project_id, 1, 20);
        repo.create(&set).await.unwrap();

        repo.delete(set.id).await.unwrap();
        assert_eq!(
            repo.get(set.id).await.unwrap_err().code(),
            "prompt_set/not_found"
        );
        assert!(repo.list_by_project(project_id).await.unwrap().is_empty());
        // 幂等：再删一次不报错
        repo.delete(set.id).await.unwrap();
    }

    #[tokio::test]
    async fn deleting_project_cascades_prompt_sets() {
        let pool = open_in_memory().await.unwrap();
        let projects = ProjectRepo::new(pool.clone());
        let repo = PromptSetRepo::new(pool);
        let project = sample_project("将被删除");
        projects.create(&project).await.unwrap();
        let set = sample_prompt_set(project.id, 1, 5);
        repo.create(&set).await.unwrap();

        projects.delete(project.id).await.unwrap();
        assert!(repo.latest_for_project(project.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn created_at_is_preserved_and_serialised_as_text() {
        let (repo, project_id) = setup().await;
        let mut set = sample_prompt_set(project_id, 1, 2);
        set.created_at = base_time();
        repo.create(&set).await.unwrap();
        let loaded = repo.get(set.id).await.unwrap();
        assert_eq!(
            loaded.created_at,
            base_time(),
            "时间必须按 RFC3339 无损往返"
        );
    }
}

//! 知识库仓储（M1.2b，Plan C 第三个纵向切片）。
//!
//! 只负责持久化：条目按 `position ASC, id ASC`；更新与修订留痕单事务；
//! 删除后重排 `position` 为 `0..n-1`；删除条目**不删**留痕（DR-119）。

use chrono::{DateTime, Utc};
use geo_domain::{
    verify_revision, ContentStatus, FieldStatus, KbEntry, KbEntryId, KbEntryKind, KbEntryRevision,
    KbModule, KbScenario, KbSource, ProjectId,
};
use serde_json::Value;
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};

use crate::codec;
use crate::error::StoreError;
use crate::repo::{not_found, require_found};

const SELECT_BY_PROJECT: &str = concat!(
    "SELECT id, project_id, module, kind, title, body_markdown, url, mime, tags, status, ",
    "source, scenario, verified_at, position, created_at, updated_at FROM kb_entries ",
    "WHERE project_id = ? ORDER BY position ASC, id ASC"
);

const SELECT_REVISIONS: &str = concat!(
    "SELECT id, entry_id, project_id, field_path, old_value, new_value, status, note, ",
    "edited_at FROM kb_entry_revisions WHERE project_id = ? ",
    "ORDER BY edited_at DESC, rowid ASC"
);

#[derive(Debug, FromRow)]
struct EntryRow {
    id: String,
    project_id: String,
    module: String,
    kind: String,
    title: String,
    body_markdown: String,
    url: Option<String>,
    mime: Option<String>,
    tags: String,
    status: String,
    source: String,
    scenario: Option<String>,
    verified_at: Option<String>,
    position: i32,
    created_at: String,
    updated_at: String,
}

impl EntryRow {
    fn into_entry(self) -> Result<KbEntry, StoreError> {
        Ok(KbEntry {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            module: codec::decode_scalar::<KbModule>(&self.module)?,
            kind: codec::decode_scalar::<KbEntryKind>(&self.kind)?,
            title: self.title,
            body_markdown: self.body_markdown,
            url: self.url,
            mime: self.mime,
            tags: codec::decode_json(&self.tags)?,
            status: codec::decode_scalar::<ContentStatus>(&self.status)?,
            source: codec::decode_scalar::<KbSource>(&self.source)?,
            scenario: match self.scenario {
                Some(raw) => Some(codec::decode_scalar::<KbScenario>(&raw)?),
                None => None,
            },
            verified_at: match self.verified_at {
                Some(raw) => Some(codec::decode_time(&raw)?),
                None => None,
            },
            position: self.position,
            created_at: codec::decode_time(&self.created_at)?,
            updated_at: codec::decode_time(&self.updated_at)?,
        })
    }
}

#[derive(Debug, FromRow)]
struct RevisionRow {
    id: String,
    entry_id: String,
    project_id: String,
    field_path: String,
    old_value: Option<String>,
    new_value: Option<String>,
    status: String,
    note: Option<String>,
    edited_at: String,
}

impl RevisionRow {
    fn into_revision(self) -> Result<KbEntryRevision, StoreError> {
        Ok(KbEntryRevision {
            id: codec::decode_scalar(&self.id)?,
            entry_id: codec::decode_scalar(&self.entry_id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            field_path: self.field_path,
            old_value: decode_optional_value(self.old_value)?,
            new_value: decode_optional_value(self.new_value)?,
            status: codec::decode_scalar::<FieldStatus>(&self.status)?,
            note: self.note,
            edited_at: codec::decode_time(&self.edited_at)?,
        })
    }
}

fn decode_optional_value(raw: Option<String>) -> Result<Option<Value>, StoreError> {
    match raw {
        Some(text) => Ok(Some(
            serde_json::from_str(&text).map_err(StoreError::Serde)?,
        )),
        None => Ok(None),
    }
}

fn encode_optional_value(value: &Option<Value>) -> Result<Option<String>, StoreError> {
    match value {
        Some(value) => Ok(Some(
            serde_json::to_string(value).map_err(StoreError::Serde)?,
        )),
        None => Ok(None),
    }
}

#[derive(Debug, Clone)]
pub struct KbRepo {
    pool: SqlitePool,
}

impl KbRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn list_by_project(&self, project_id: ProjectId) -> Result<Vec<KbEntry>, StoreError> {
        let rows = sqlx::query_as::<_, EntryRow>(SELECT_BY_PROJECT)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(EntryRow::into_entry).collect()
    }

    pub async fn get(&self, id: KbEntryId, project_id: ProjectId) -> Result<KbEntry, StoreError> {
        let rows = sqlx::query_as::<_, EntryRow>(concat!(
            "SELECT id, project_id, module, kind, title, body_markdown, url, mime, tags, status, ",
            "source, scenario, verified_at, position, created_at, updated_at FROM kb_entries ",
            "WHERE id = ? AND project_id = ?"
        ))
        .bind(id.to_string())
        .bind(project_id.to_string())
        .fetch_optional(&self.pool)
        .await?;
        match rows {
            Some(row) => row.into_entry(),
            None => Err(not_found("kb_entry", id)),
        }
    }

    pub async fn revisions_by_project(
        &self,
        project_id: ProjectId,
    ) -> Result<Vec<KbEntryRevision>, StoreError> {
        let rows = sqlx::query_as::<_, RevisionRow>(SELECT_REVISIONS)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(RevisionRow::into_revision).collect()
    }

    pub async fn insert_many(&self, entries: &[KbEntry]) -> Result<(), StoreError> {
        if entries.is_empty() {
            return Ok(());
        }
        let mut transaction = self.pool.begin().await?;
        for entry in entries {
            sqlx::query(concat!(
                "INSERT INTO kb_entries (id, project_id, module, kind, title, body_markdown, ",
                "url, mime, tags, status, source, scenario, verified_at, position, created_at, ",
                "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ))
            .bind(entry.id.to_string())
            .bind(entry.project_id.to_string())
            .bind(codec::encode_scalar(&entry.module)?)
            .bind(codec::encode_scalar(&entry.kind)?)
            .bind(&entry.title)
            .bind(&entry.body_markdown)
            .bind(&entry.url)
            .bind(&entry.mime)
            .bind(codec::encode_json(&entry.tags)?)
            .bind(codec::encode_scalar(&entry.status)?)
            .bind(codec::encode_scalar(&entry.source)?)
            .bind(
                entry
                    .scenario
                    .map(|scenario| codec::encode_scalar(&scenario))
                    .transpose()?,
            )
            .bind(entry.verified_at.map(|value| codec::encode_time(&value)))
            .bind(entry.position)
            .bind(codec::encode_time(&entry.created_at))
            .bind(codec::encode_time(&entry.updated_at))
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    /// 更新可编辑列 + 写入逐字段留痕，单事务。
    pub async fn update_with_revisions(
        &self,
        entry: &KbEntry,
        revisions: &[KbEntryRevision],
    ) -> Result<(), StoreError> {
        let mut transaction = self.pool.begin().await?;
        let affected = sqlx::query(concat!(
            "UPDATE kb_entries SET module = ?, kind = ?, title = ?, body_markdown = ?, url = ?, ",
            "mime = ?, tags = ?, status = ?, scenario = ?, updated_at = ? ",
            "WHERE id = ? AND project_id = ?"
        ))
        .bind(codec::encode_scalar(&entry.module)?)
        .bind(codec::encode_scalar(&entry.kind)?)
        .bind(&entry.title)
        .bind(&entry.body_markdown)
        .bind(&entry.url)
        .bind(&entry.mime)
        .bind(codec::encode_json(&entry.tags)?)
        .bind(codec::encode_scalar(&entry.status)?)
        .bind(
            entry
                .scenario
                .map(|scenario| codec::encode_scalar(&scenario))
                .transpose()?,
        )
        .bind(codec::encode_time(&entry.updated_at))
        .bind(entry.id.to_string())
        .bind(entry.project_id.to_string())
        .execute(&mut *transaction)
        .await?
        .rows_affected();
        require_found(affected, "kb_entry", entry.id)?;
        for revision in revisions {
            insert_revision(&mut transaction, revision).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    /// 批量删除并重排 `position`（幂等；只删本项目命中的行）。
    pub async fn delete_many(
        &self,
        project_id: ProjectId,
        ids: &[KbEntryId],
    ) -> Result<(), StoreError> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut transaction = self.pool.begin().await?;
        let mut builder = QueryBuilder::<Sqlite>::new("DELETE FROM kb_entries WHERE project_id = ");
        builder.push_bind(project_id.to_string());
        builder.push(" AND id IN (");
        let mut separated = builder.separated(", ");
        for id in ids {
            separated.push_bind(id.to_string());
        }
        separated.push_unseparated(")");
        builder.build().execute(&mut *transaction).await?;

        let remaining: Vec<(String,)> = sqlx::query_as(
            "SELECT id FROM kb_entries WHERE project_id = ? ORDER BY position ASC, id ASC",
        )
        .bind(project_id.to_string())
        .fetch_all(&mut *transaction)
        .await?;
        for (index, (id,)) in remaining.iter().enumerate() {
            sqlx::query("UPDATE kb_entries SET position = ? WHERE id = ?")
                .bind(i32::try_from(index).unwrap_or(0))
                .bind(id)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    /// 批量核实：`status → approved` + `verified_at → now` + 每条一条 `verified_at` 留痕。
    /// 认不出的 id 忽略；一条都没命中就是空操作。
    pub async fn verify_many(
        &self,
        project_id: ProjectId,
        ids: &[KbEntryId],
        now: DateTime<Utc>,
    ) -> Result<(), StoreError> {
        if ids.is_empty() {
            return Ok(());
        }
        let wanted: std::collections::HashSet<String> =
            ids.iter().map(|id| id.to_string()).collect();
        let entries = self.list_by_project(project_id).await?;
        let mut transaction = self.pool.begin().await?;
        for entry in entries
            .into_iter()
            .filter(|entry| wanted.contains(&entry.id.to_string()))
        {
            let previous = entry.verified_at;
            sqlx::query(concat!(
                "UPDATE kb_entries SET status = 'approved', verified_at = ?, updated_at = ? ",
                "WHERE id = ? AND project_id = ?"
            ))
            .bind(codec::encode_time(&now))
            .bind(codec::encode_time(&now))
            .bind(entry.id.to_string())
            .bind(project_id.to_string())
            .execute(&mut *transaction)
            .await?;
            insert_revision(&mut transaction, &verify_revision(&entry, previous, now)).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn next_position(&self, project_id: ProjectId) -> Result<i32, StoreError> {
        let next = sqlx::query_scalar::<_, i32>(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM kb_entries WHERE project_id = ?",
        )
        .bind(project_id.to_string())
        .fetch_one(&self.pool)
        .await?;
        Ok(next)
    }
}

async fn insert_revision(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    revision: &KbEntryRevision,
) -> Result<(), StoreError> {
    sqlx::query(concat!(
        "INSERT INTO kb_entry_revisions (id, entry_id, project_id, field_path, old_value, ",
        "new_value, status, note, edited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ))
    .bind(revision.id.to_string())
    .bind(revision.entry_id.to_string())
    .bind(revision.project_id.to_string())
    .bind(&revision.field_path)
    .bind(encode_optional_value(&revision.old_value)?)
    .bind(encode_optional_value(&revision.new_value)?)
    .bind(codec::encode_scalar(&revision.status)?)
    .bind(&revision.note)
    .bind(codec::encode_time(&revision.edited_at))
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::repo::ProjectRepo;
    use crate::testutil::{base_time, later, sample_kb_entry, sample_project};
    use geo_domain::{KbEntry, KbModule};

    async fn setup() -> (KbRepo, ProjectId, KbRepo, ProjectId) {
        let pool = open_in_memory().await.expect("内存库可用");
        let projects = ProjectRepo::new(pool.clone());
        let project = sample_project("KB 宿主项目");
        let other = sample_project("另一个项目");
        projects.create(&project).await.expect("先建项目");
        projects.create(&other).await.expect("再建项目");
        (
            KbRepo::new(pool.clone()),
            project.id,
            KbRepo::new(pool),
            other.id,
        )
    }

    #[tokio::test]
    async fn insert_then_list_roundtrips_in_position_order() {
        let (repo, project_id, _other, _other_id) = setup().await;
        let second = sample_kb_entry(project_id, "第二个", 3);
        let first = sample_kb_entry(project_id, "第一个", 1);
        repo.insert_many(&[second.clone(), first.clone()])
            .await
            .expect("写入");
        assert_eq!(
            repo.list_by_project(project_id).await.unwrap(),
            vec![first, second]
        );
    }

    #[tokio::test]
    async fn update_with_revisions_persists_entry_and_history() {
        let (repo, project_id, _other, _other_id) = setup().await;
        let original = sample_kb_entry(project_id, "旧标题", 0);
        repo.insert_many(std::slice::from_ref(&original))
            .await
            .expect("写入");
        let mut next = original.clone();
        next.title = "新标题".to_string();
        next.module = KbModule::Brand;
        next.updated_at = later(60);
        let revisions = KbEntry::diff_revisions(&original, &next, later(60));
        repo.update_with_revisions(&next, &revisions)
            .await
            .expect("更新");

        assert_eq!(repo.get(original.id, project_id).await.unwrap(), next);
        let history = repo.revisions_by_project(project_id).await.unwrap();
        let fields: Vec<&str> = history.iter().map(|row| row.field_path.as_str()).collect();
        assert_eq!(fields, vec!["module", "title"]);
    }

    #[tokio::test]
    async fn update_missing_is_not_found() {
        let (repo, project_id, _other, _other_id) = setup().await;
        let missing = sample_kb_entry(project_id, "不存在", 0);
        assert_eq!(
            repo.update_with_revisions(&missing, &[])
                .await
                .unwrap_err()
                .code(),
            "kb_entry/not_found"
        );
    }

    #[tokio::test]
    async fn delete_reindexes_positions_keeps_revisions_and_is_scoped() {
        let (repo, project_id, other_repo, other_id) = setup().await;
        let first = sample_kb_entry(project_id, "一", 0);
        let second = sample_kb_entry(project_id, "二", 1);
        let third = sample_kb_entry(project_id, "三", 2);
        repo.insert_many(&[first.clone(), second.clone(), third.clone()])
            .await
            .expect("写入");
        let mut edited = first.clone();
        edited.title = "一改".to_string();
        repo.update_with_revisions(&edited, &KbEntry::diff_revisions(&first, &edited, later(1)))
            .await
            .expect("留痕");
        let theirs = sample_kb_entry(other_id, "别人的", 0);
        other_repo
            .insert_many(std::slice::from_ref(&theirs))
            .await
            .expect("写入");

        repo.delete_many(project_id, &[first.id])
            .await
            .expect("删除");
        let remaining = repo.list_by_project(project_id).await.unwrap();
        assert_eq!(remaining.len(), 2);
        assert_eq!(remaining[0].position, 0);
        assert_eq!(remaining[1].position, 1);
        assert_eq!(
            repo.revisions_by_project(project_id).await.unwrap().len(),
            1
        );
        assert_eq!(
            other_repo.list_by_project(other_id).await.unwrap(),
            vec![theirs]
        );
    }

    #[tokio::test]
    async fn verify_flips_status_and_records_previous_time() {
        let (repo, project_id, _other, _other_id) = setup().await;
        let mut entry = sample_kb_entry(project_id, "待核实", 0);
        entry.status = ContentStatus::PendingReview;
        repo.insert_many(std::slice::from_ref(&entry))
            .await
            .expect("写入");

        repo.verify_many(project_id, &[entry.id, KbEntryId::new()], later(10))
            .await
            .expect("核实");
        let loaded = repo.get(entry.id, project_id).await.unwrap();
        assert_eq!(loaded.status, ContentStatus::Approved);
        assert_eq!(loaded.verified_at, Some(later(10)));
        assert_eq!(
            repo.revisions_by_project(project_id).await.unwrap().len(),
            1
        );

        repo.verify_many(project_id, &[entry.id], later(20))
            .await
            .expect("再次核实");
        let history = repo.revisions_by_project(project_id).await.unwrap();
        assert_eq!(history.len(), 2);
        let previous: DateTime<Utc> =
            serde_json::from_value(history[0].old_value.clone().unwrap()).unwrap();
        assert_eq!(previous, later(10));
    }

    #[tokio::test]
    async fn revisions_are_newest_first() {
        let (repo, project_id, _other, _other_id) = setup().await;
        let entry = sample_kb_entry(project_id, "标题", 0);
        repo.insert_many(std::slice::from_ref(&entry))
            .await
            .expect("写入");
        let mut first = entry.clone();
        first.title = "一".to_string();
        repo.update_with_revisions(
            &first,
            &KbEntry::diff_revisions(&entry, &first, base_time()),
        )
        .await
        .expect("第一次");
        let mut second = first.clone();
        second.title = "二".to_string();
        repo.update_with_revisions(&second, &KbEntry::diff_revisions(&first, &second, later(5)))
            .await
            .expect("第二次");
        let history = repo.revisions_by_project(project_id).await.unwrap();
        assert_eq!(history[0].edited_at, later(5));
        assert_eq!(history[1].edited_at, base_time());
    }

    #[tokio::test]
    async fn next_position_continues_after_max() {
        let (repo, project_id, _other, _other_id) = setup().await;
        assert_eq!(repo.next_position(project_id).await.unwrap(), 0);
        repo.insert_many(&[
            sample_kb_entry(project_id, "a", 0),
            sample_kb_entry(project_id, "b", 1),
        ])
        .await
        .expect("写入");
        assert_eq!(repo.next_position(project_id).await.unwrap(), 2);
    }
}

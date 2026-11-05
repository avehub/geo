//! 站点补丁台账仓储（M6.5，Plan C 第四切片第二段）。
//!
//! 补丁按 `position ASC, id ASC`；每次写操作与事件同事务；事件按 `created_at ASC, rowid ASC`；
//! 删除补丁时事件由外键级联删除，并在同一事务里重排 `position`。

use geo_domain::{
    ContentStatus, LibrarySource, ProjectId, SiteChannelKind, SitePatch, SitePatchEvent,
    SitePatchEventKind, SitePatchId, SitePatchKind, SitePatchStatus,
};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};

use crate::codec;
use crate::error::StoreError;
use crate::repo::{not_found, require_found};

const SELECT_BY_PROJECT: &str = concat!(
    "SELECT id, project_id, action_id, round_id, kind, title, target_url, target_hint, body, ",
    "published_body, published_kind, published_target_url, published_channel_kind, status, ",
    "review_status, channel_kind, source, position, published_at, created_at, updated_at ",
    "FROM site_patches WHERE project_id = ? ORDER BY position ASC, id ASC"
);

const SELECT_BY_ID: &str = concat!(
    "SELECT id, project_id, action_id, round_id, kind, title, target_url, target_hint, body, ",
    "published_body, published_kind, published_target_url, published_channel_kind, status, ",
    "review_status, channel_kind, source, position, published_at, created_at, updated_at ",
    "FROM site_patches WHERE id = ?"
);

const SELECT_EVENTS: &str = concat!(
    "SELECT id, patch_id, kind, channel_kind, note, created_at FROM site_patch_events ",
    "WHERE patch_id = ? ORDER BY created_at ASC, rowid ASC"
);

#[derive(Debug, FromRow)]
struct PatchRow {
    id: String,
    project_id: String,
    action_id: Option<String>,
    round_id: String,
    kind: String,
    title: String,
    target_url: String,
    target_hint: Option<String>,
    body: String,
    published_body: Option<String>,
    published_kind: Option<String>,
    published_target_url: Option<String>,
    published_channel_kind: Option<String>,
    status: String,
    review_status: String,
    channel_kind: String,
    source: String,
    position: i32,
    published_at: Option<String>,
    created_at: String,
    updated_at: String,
}

impl PatchRow {
    fn into_patch(self) -> Result<SitePatch, StoreError> {
        Ok(SitePatch {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            action_id: self.action_id,
            round_id: self.round_id,
            kind: codec::decode_scalar::<SitePatchKind>(&self.kind)?,
            title: self.title,
            target_url: self.target_url,
            target_hint: self.target_hint,
            body: self.body,
            published_body: self.published_body,
            published_kind: match self.published_kind {
                Some(raw) => Some(codec::decode_scalar::<SitePatchKind>(&raw)?),
                None => None,
            },
            published_target_url: self.published_target_url,
            published_channel_kind: match self.published_channel_kind {
                Some(raw) => Some(codec::decode_scalar::<SiteChannelKind>(&raw)?),
                None => None,
            },
            status: codec::decode_scalar::<SitePatchStatus>(&self.status)?,
            review_status: codec::decode_scalar::<ContentStatus>(&self.review_status)?,
            channel_kind: codec::decode_scalar::<SiteChannelKind>(&self.channel_kind)?,
            source: codec::decode_scalar::<LibrarySource>(&self.source)?,
            position: self.position,
            published_at: match self.published_at {
                Some(raw) => Some(codec::decode_time(&raw)?),
                None => None,
            },
            created_at: codec::decode_time(&self.created_at)?,
            updated_at: codec::decode_time(&self.updated_at)?,
        })
    }
}

#[derive(Debug, FromRow)]
struct EventRow {
    id: String,
    patch_id: String,
    kind: String,
    channel_kind: Option<String>,
    note: Option<String>,
    created_at: String,
}

impl EventRow {
    fn into_event(self) -> Result<SitePatchEvent, StoreError> {
        Ok(SitePatchEvent {
            id: codec::decode_scalar(&self.id)?,
            patch_id: codec::decode_scalar(&self.patch_id)?,
            kind: codec::decode_scalar::<SitePatchEventKind>(&self.kind)?,
            channel_kind: match self.channel_kind {
                Some(raw) => Some(codec::decode_scalar::<SiteChannelKind>(&raw)?),
                None => None,
            },
            note: self.note,
            created_at: codec::decode_time(&self.created_at)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct SitePatchRepo {
    pool: SqlitePool,
}

impl SitePatchRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn list_by_project(
        &self,
        project_id: ProjectId,
    ) -> Result<Vec<SitePatch>, StoreError> {
        let rows = sqlx::query_as::<_, PatchRow>(SELECT_BY_PROJECT)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(PatchRow::into_patch).collect()
    }

    pub async fn get(&self, id: SitePatchId) -> Result<SitePatch, StoreError> {
        let row = sqlx::query_as::<_, PatchRow>(SELECT_BY_ID)
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| not_found("site_patch", id))?;
        row.into_patch()
    }

    pub async fn insert_with_event(
        &self,
        patch: &SitePatch,
        event: &SitePatchEvent,
    ) -> Result<(), StoreError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query(concat!(
            "INSERT INTO site_patches (id, project_id, action_id, round_id, kind, title, ",
            "target_url, target_hint, body, published_body, published_kind, published_target_url, ",
            "published_channel_kind, status, review_status, channel_kind, source, position, ",
            "published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ",
            "?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(patch.id.to_string())
        .bind(patch.project_id.to_string())
        .bind(&patch.action_id)
        .bind(&patch.round_id)
        .bind(codec::encode_scalar(&patch.kind)?)
        .bind(&patch.title)
        .bind(&patch.target_url)
        .bind(&patch.target_hint)
        .bind(&patch.body)
        .bind(&patch.published_body)
        .bind(
            patch
                .published_kind
                .map(|value| codec::encode_scalar(&value))
                .transpose()?,
        )
        .bind(&patch.published_target_url)
        .bind(
            patch
                .published_channel_kind
                .map(|value| codec::encode_scalar(&value))
                .transpose()?,
        )
        .bind(codec::encode_scalar(&patch.status)?)
        .bind(codec::encode_scalar(&patch.review_status)?)
        .bind(codec::encode_scalar(&patch.channel_kind)?)
        .bind(codec::encode_scalar(&patch.source)?)
        .bind(patch.position)
        .bind(patch.published_at.map(|value| codec::encode_time(&value)))
        .bind(codec::encode_time(&patch.created_at))
        .bind(codec::encode_time(&patch.updated_at))
        .execute(&mut *transaction)
        .await?;
        insert_event(&mut transaction, event).await?;
        transaction.commit().await?;
        Ok(())
    }

    /// 就地更新可编辑列 + `saved` 事件。
    pub async fn save_with_event(
        &self,
        patch: &SitePatch,
        event: &SitePatchEvent,
    ) -> Result<(), StoreError> {
        let mut transaction = self.pool.begin().await?;
        let affected = sqlx::query(concat!(
            "UPDATE site_patches SET kind = ?, title = ?, target_url = ?, target_hint = ?, ",
            "body = ?, channel_kind = ?, review_status = ?, updated_at = ? ",
            "WHERE id = ? AND project_id = ?"
        ))
        .bind(codec::encode_scalar(&patch.kind)?)
        .bind(&patch.title)
        .bind(&patch.target_url)
        .bind(&patch.target_hint)
        .bind(&patch.body)
        .bind(codec::encode_scalar(&patch.channel_kind)?)
        .bind(codec::encode_scalar(&patch.review_status)?)
        .bind(codec::encode_time(&patch.updated_at))
        .bind(patch.id.to_string())
        .bind(patch.project_id.to_string())
        .execute(&mut *transaction)
        .await?
        .rows_affected();
        require_found(affected, "site_patch", patch.id)?;
        insert_event(&mut transaction, event).await?;
        transaction.commit().await?;
        Ok(())
    }

    /// 状态迁移：写回状态 / 快照 / 草案定义 + 可选事件。
    pub async fn transition(
        &self,
        patch: &SitePatch,
        event: Option<&SitePatchEvent>,
    ) -> Result<(), StoreError> {
        let mut transaction = self.pool.begin().await?;
        let affected = sqlx::query(concat!(
            "UPDATE site_patches SET kind = ?, target_url = ?, body = ?, channel_kind = ?, ",
            "status = ?, published_body = ?, published_kind = ?, published_target_url = ?, ",
            "published_channel_kind = ?, published_at = ?, updated_at = ? WHERE id = ?"
        ))
        .bind(codec::encode_scalar(&patch.kind)?)
        .bind(&patch.target_url)
        .bind(&patch.body)
        .bind(codec::encode_scalar(&patch.channel_kind)?)
        .bind(codec::encode_scalar(&patch.status)?)
        .bind(&patch.published_body)
        .bind(
            patch
                .published_kind
                .map(|value| codec::encode_scalar(&value))
                .transpose()?,
        )
        .bind(&patch.published_target_url)
        .bind(
            patch
                .published_channel_kind
                .map(|value| codec::encode_scalar(&value))
                .transpose()?,
        )
        .bind(patch.published_at.map(|value| codec::encode_time(&value)))
        .bind(codec::encode_time(&patch.updated_at))
        .bind(patch.id.to_string())
        .execute(&mut *transaction)
        .await?
        .rows_affected();
        require_found(affected, "site_patch", patch.id)?;
        if let Some(event) = event {
            insert_event(&mut transaction, event).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    /// 批量删除并重排 `position`；事件由外键级联。调用方必须先拒绝已发布补丁。
    pub async fn delete_many(
        &self,
        project_id: ProjectId,
        ids: &[SitePatchId],
    ) -> Result<(), StoreError> {
        if ids.is_empty() {
            return Ok(());
        }
        let mut transaction = self.pool.begin().await?;
        let mut builder =
            QueryBuilder::<Sqlite>::new("DELETE FROM site_patches WHERE project_id = ");
        builder.push_bind(project_id.to_string());
        builder.push(" AND id IN (");
        let mut separated = builder.separated(", ");
        for id in ids {
            separated.push_bind(id.to_string());
        }
        separated.push_unseparated(")");
        builder.build().execute(&mut *transaction).await?;

        let remaining: Vec<(String,)> = sqlx::query_as(
            "SELECT id FROM site_patches WHERE project_id = ? ORDER BY position ASC, id ASC",
        )
        .bind(project_id.to_string())
        .fetch_all(&mut *transaction)
        .await?;
        for (index, (id,)) in remaining.iter().enumerate() {
            sqlx::query("UPDATE site_patches SET position = ? WHERE id = ?")
                .bind(i32::try_from(index).unwrap_or(0))
                .bind(id)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn events(&self, patch_id: SitePatchId) -> Result<Vec<SitePatchEvent>, StoreError> {
        let rows = sqlx::query_as::<_, EventRow>(SELECT_EVENTS)
            .bind(patch_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(EventRow::into_event).collect()
    }

    pub async fn next_position(&self, project_id: ProjectId) -> Result<i32, StoreError> {
        let next = sqlx::query_scalar::<_, i32>(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM site_patches WHERE project_id = ?",
        )
        .bind(project_id.to_string())
        .fetch_one(&self.pool)
        .await?;
        Ok(next)
    }
}

async fn insert_event(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    event: &SitePatchEvent,
) -> Result<(), StoreError> {
    sqlx::query(concat!(
        "INSERT INTO site_patch_events (id, patch_id, kind, channel_kind, note, created_at) ",
        "VALUES (?, ?, ?, ?, ?, ?)"
    ))
    .bind(event.id.to_string())
    .bind(event.patch_id.to_string())
    .bind(codec::encode_scalar(&event.kind)?)
    .bind(
        event
            .channel_kind
            .map(|value| codec::encode_scalar(&value))
            .transpose()?,
    )
    .bind(&event.note)
    .bind(codec::encode_time(&event.created_at))
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::repo::ProjectRepo;
    use crate::testutil::{base_time, later, sample_project, sample_site_patch};
    use geo_domain::{SitePatchEventId, SitePatchEventKind};

    async fn setup() -> (SitePatchRepo, ProjectId, SitePatchRepo, ProjectId) {
        let pool = open_in_memory().await.expect("内存库可用");
        let projects = ProjectRepo::new(pool.clone());
        let project = sample_project("补丁宿主项目");
        let other = sample_project("另一个项目");
        projects.create(&project).await.expect("先建项目");
        projects.create(&other).await.expect("再建项目");
        (
            SitePatchRepo::new(pool.clone()),
            project.id,
            SitePatchRepo::new(pool),
            other.id,
        )
    }

    fn created_event(patch: &SitePatch) -> SitePatchEvent {
        SitePatchEvent {
            id: SitePatchEventId::new(),
            patch_id: patch.id,
            kind: SitePatchEventKind::Created,
            channel_kind: None,
            note: None,
            created_at: patch.created_at,
        }
    }

    #[tokio::test]
    async fn insert_then_list_roundtrips_with_created_event() {
        let (repo, project_id, _other, _other_id) = setup().await;
        let patch = sample_site_patch(project_id, "上线 llms.txt", 0);
        repo.insert_with_event(&patch, &created_event(&patch))
            .await
            .expect("写入");
        assert_eq!(
            repo.list_by_project(project_id).await.unwrap(),
            vec![patch.clone()]
        );
        let events = repo.events(patch.id).await.unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, SitePatchEventKind::Created);
    }

    #[tokio::test]
    async fn save_updates_editable_columns_and_appends_event() {
        let (repo, project_id, _other, _other_id) = setup().await;
        let mut patch = sample_site_patch(project_id, "旧标题", 0);
        repo.insert_with_event(&patch, &created_event(&patch))
            .await
            .expect("写入");
        patch.title = "新标题".to_string();
        patch.body = "Disallow: /admin".to_string();
        patch.updated_at = later(5);
        let saved = SitePatchEvent {
            id: SitePatchEventId::new(),
            patch_id: patch.id,
            kind: SitePatchEventKind::Saved,
            channel_kind: None,
            note: None,
            created_at: later(5),
        };
        repo.save_with_event(&patch, &saved).await.expect("保存");
        let loaded = repo.get(patch.id).await.unwrap();
        assert_eq!(loaded.title, "新标题");
        assert_eq!(loaded.body, "Disallow: /admin");
        assert_eq!(repo.events(patch.id).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn transition_persists_snapshot_and_event() {
        let (repo, project_id, _other, _other_id) = setup().await;
        let mut patch = sample_site_patch(project_id, "补丁", 0);
        repo.insert_with_event(&patch, &created_event(&patch))
            .await
            .expect("写入");
        let event = patch.publish(later(10)).unwrap();
        repo.transition(&patch, Some(&event)).await.expect("发布");
        let loaded = repo.get(patch.id).await.unwrap();
        assert_eq!(loaded.status, SitePatchStatus::Published);
        assert_eq!(loaded.published_body, Some("User-agent: *".to_string()));
        assert_eq!(repo.events(patch.id).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn delete_is_scoped_reindexes_and_cascades_events() {
        let (repo, project_id, other_repo, other_id) = setup().await;
        let first = sample_site_patch(project_id, "一", 0);
        let second = sample_site_patch(project_id, "二", 1);
        let theirs = sample_site_patch(other_id, "别人的", 0);
        repo.insert_with_event(&first, &created_event(&first))
            .await
            .expect("写入");
        repo.insert_with_event(&second, &created_event(&second))
            .await
            .expect("写入");
        other_repo
            .insert_with_event(&theirs, &created_event(&theirs))
            .await
            .expect("写入");
        repo.delete_many(project_id, &[first.id])
            .await
            .expect("删除");
        let remaining = repo.list_by_project(project_id).await.unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].position, 0);
        assert!(
            repo.events(first.id).await.unwrap().is_empty(),
            "事件随补丁级联删除"
        );
        assert_eq!(
            other_repo.list_by_project(other_id).await.unwrap(),
            vec![theirs]
        );
    }

    #[tokio::test]
    async fn next_position_continues_after_max() {
        let (repo, project_id, _other, _other_id) = setup().await;
        assert_eq!(repo.next_position(project_id).await.unwrap(), 0);
        let patch = sample_site_patch(project_id, "一", 0);
        repo.insert_with_event(&patch, &created_event(&patch))
            .await
            .expect("写入");
        assert_eq!(repo.next_position(project_id).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn get_missing_is_not_found() {
        let (repo, _project_id, _other, _other_id) = setup().await;
        assert_eq!(
            repo.get(SitePatchId::new()).await.unwrap_err().code(),
            "site_patch/not_found"
        );
        let _ = base_time();
    }
}

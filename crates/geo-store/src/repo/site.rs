//! 站点档案与下发通道仓储（M6.5，Plan C 第四切片）。
//!
//! 档案一项目一行（`project_id` 主键）；通道一项目一 kind 至多一行（唯一约束）。

use geo_domain::{
    ProjectId, SiteChannel, SiteChannelKind, SiteChannelStatus, SiteCredentialsState,
    SiteOwnership, SitePlatform, SiteProfile,
};
use sqlx::{FromRow, SqlitePool};

use crate::codec;
use crate::error::StoreError;

const SELECT_PROFILE: &str =
    "SELECT id, project_id, domain, platform, ownership, note, created_at, updated_at \
     FROM site_profiles WHERE project_id = ?";

const SELECT_CHANNELS: &str =
    "SELECT id, project_id, kind, status, endpoint, username, note, credentials_state, \
     secret_ref, checked_at, check_detail, updated_at FROM site_channels WHERE project_id = ? \
     ORDER BY kind ASC";

#[derive(Debug, FromRow)]
struct ProfileRow {
    id: String,
    project_id: String,
    domain: String,
    platform: String,
    ownership: String,
    note: Option<String>,
    created_at: String,
    updated_at: String,
}

impl ProfileRow {
    fn into_profile(self) -> Result<SiteProfile, StoreError> {
        Ok(SiteProfile {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            domain: self.domain,
            platform: codec::decode_scalar::<SitePlatform>(&self.platform)?,
            ownership: codec::decode_scalar::<SiteOwnership>(&self.ownership)?,
            note: self.note,
            created_at: codec::decode_time(&self.created_at)?,
            updated_at: codec::decode_time(&self.updated_at)?,
        })
    }
}

#[derive(Debug, FromRow)]
struct ChannelRow {
    id: String,
    project_id: String,
    kind: String,
    status: String,
    endpoint: Option<String>,
    username: Option<String>,
    note: Option<String>,
    credentials_state: String,
    secret_ref: Option<String>,
    checked_at: Option<String>,
    check_detail: Option<String>,
    updated_at: String,
}

impl ChannelRow {
    fn into_channel(self) -> Result<SiteChannel, StoreError> {
        Ok(SiteChannel {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            kind: codec::decode_scalar::<SiteChannelKind>(&self.kind)?,
            status: codec::decode_scalar::<SiteChannelStatus>(&self.status)?,
            endpoint: self.endpoint,
            username: self.username,
            note: self.note,
            credentials_state: codec::decode_scalar::<SiteCredentialsState>(
                &self.credentials_state,
            )?,
            secret_ref: self.secret_ref,
            checked_at: match self.checked_at {
                Some(raw) => Some(codec::decode_time(&raw)?),
                None => None,
            },
            check_detail: codec::decode_optional_json(self.check_detail)?,
            updated_at: codec::decode_time(&self.updated_at)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct SiteRepo {
    pool: SqlitePool,
}

impl SiteRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn profile(&self, project_id: ProjectId) -> Result<Option<SiteProfile>, StoreError> {
        let row = sqlx::query_as::<_, ProfileRow>(SELECT_PROFILE)
            .bind(project_id.to_string())
            .fetch_optional(&self.pool)
            .await?;
        row.map(ProfileRow::into_profile).transpose()
    }

    pub async fn save_profile(&self, profile: &SiteProfile) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO site_profiles (id, project_id, domain, platform, ownership, note, \
             created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(project_id) DO UPDATE SET domain = excluded.domain, \
             platform = excluded.platform, ownership = excluded.ownership, note = excluded.note, \
             updated_at = excluded.updated_at",
        )
        .bind(profile.id.to_string())
        .bind(profile.project_id.to_string())
        .bind(&profile.domain)
        .bind(codec::encode_scalar(&profile.platform)?)
        .bind(codec::encode_scalar(&profile.ownership)?)
        .bind(&profile.note)
        .bind(codec::encode_time(&profile.created_at))
        .bind(codec::encode_time(&profile.updated_at))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn channels(&self, project_id: ProjectId) -> Result<Vec<SiteChannel>, StoreError> {
        let rows = sqlx::query_as::<_, ChannelRow>(SELECT_CHANNELS)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(ChannelRow::into_channel).collect()
    }

    pub async fn channel(
        &self,
        project_id: ProjectId,
        kind: SiteChannelKind,
    ) -> Result<Option<SiteChannel>, StoreError> {
        Ok(self
            .channels(project_id)
            .await?
            .into_iter()
            .find(|channel| channel.kind == kind))
    }

    pub async fn save_channel(&self, channel: &SiteChannel) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO site_channels (id, project_id, kind, status, endpoint, username, note, \
             credentials_state, secret_ref, checked_at, check_detail, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(project_id, kind) DO UPDATE SET status = excluded.status, \
             endpoint = excluded.endpoint, username = excluded.username, note = excluded.note, \
             credentials_state = excluded.credentials_state, secret_ref = excluded.secret_ref, \
             checked_at = NULL, check_detail = NULL, updated_at = excluded.updated_at",
        )
        .bind(channel.id.to_string())
        .bind(channel.project_id.to_string())
        .bind(codec::encode_scalar(&channel.kind)?)
        .bind(codec::encode_scalar(&channel.status)?)
        .bind(&channel.endpoint)
        .bind(&channel.username)
        .bind(&channel.note)
        .bind(codec::encode_scalar(&channel.credentials_state)?)
        .bind(&channel.secret_ref)
        .bind(channel.checked_at.map(|value| codec::encode_time(&value)))
        .bind(codec::encode_optional_json(&channel.check_detail)?)
        .bind(codec::encode_time(&channel.updated_at))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 删除一条通道（幂等），回剩余快照。
    pub async fn remove_channel(
        &self,
        project_id: ProjectId,
        kind: SiteChannelKind,
    ) -> Result<Vec<SiteChannel>, StoreError> {
        sqlx::query("DELETE FROM site_channels WHERE project_id = ? AND kind = ?")
            .bind(project_id.to_string())
            .bind(codec::encode_scalar(&kind)?)
            .execute(&self.pool)
            .await?;
        self.channels(project_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::repo::ProjectRepo;
    use crate::testutil::{
        base_time, later, sample_project, sample_site_channel, sample_site_profile,
    };

    async fn setup() -> (SiteRepo, ProjectId, SiteRepo, ProjectId) {
        let pool = open_in_memory().await.expect("内存库可用");
        let projects = ProjectRepo::new(pool.clone());
        let project = sample_project("站点宿主项目");
        let other = sample_project("另一个项目");
        projects.create(&project).await.expect("先建项目");
        projects.create(&other).await.expect("再建项目");
        (
            SiteRepo::new(pool.clone()),
            project.id,
            SiteRepo::new(pool),
            other.id,
        )
    }

    #[tokio::test]
    async fn profile_upsert_roundtrips_and_is_scoped() {
        let (repo, project_id, other_repo, other_id) = setup().await;
        let mut profile = sample_site_profile(project_id);
        repo.save_profile(&profile).await.expect("写入");
        assert_eq!(
            repo.profile(project_id).await.unwrap(),
            Some(profile.clone())
        );
        assert_eq!(other_repo.profile(other_id).await.unwrap(), None);

        profile.platform = geo_domain::SitePlatform::Wordpress;
        profile.updated_at = later(5);
        repo.save_profile(&profile).await.expect("更新");
        assert_eq!(
            repo.profile(project_id).await.unwrap().unwrap().platform,
            geo_domain::SitePlatform::Wordpress
        );
    }

    #[tokio::test]
    async fn channels_upsert_one_row_per_kind_and_clear_check_state() {
        let (repo, project_id, _other, _other_id) = setup().await;
        let mut channel = sample_site_channel(project_id, SiteChannelKind::Cms);
        channel.checked_at = Some(base_time());
        channel.check_detail = Some(geo_domain::CheckDetail::new("legacy"));
        repo.save_channel(&channel).await.expect("写入");
        channel.endpoint = Some("https://new.example".to_string());
        channel.updated_at = later(5);
        repo.save_channel(&channel).await.expect("更新");
        let rows = repo.channels(project_id).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].endpoint.as_deref(), Some("https://new.example"));
        assert!(rows[0].checked_at.is_none(), "改配置必须清掉旧自检结论");
        assert!(rows[0].check_detail.is_none());
    }

    #[tokio::test]
    async fn remove_channel_is_idempotent_and_scoped() {
        let (repo, project_id, other_repo, other_id) = setup().await;
        let mine = sample_site_channel(project_id, SiteChannelKind::Cms);
        let theirs = sample_site_channel(other_id, SiteChannelKind::Cms);
        repo.save_channel(&mine).await.expect("写入");
        other_repo.save_channel(&theirs).await.expect("写入");
        assert!(repo
            .remove_channel(project_id, SiteChannelKind::Cms)
            .await
            .unwrap()
            .is_empty());
        assert!(repo
            .remove_channel(project_id, SiteChannelKind::Cms)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(other_repo.channels(other_id).await.unwrap(), vec![theirs]);
    }
}

//! 站长数据源与优化机会仓储（M5.5，Plan C 第五切片第一段）。
//!
//! 源一项目一 kind 至多一行；改配置清掉旧自检结论但保留 `data_through`（导入过的数据不消失）。

use chrono::{DateTime, Utc};
use geo_domain::{
    SearchActionLevel, SearchAuthMode, SearchGroup, SearchIngestMode, SearchOpportunity,
    SearchOpportunityId, SearchOpportunityStatus, SearchPrescriptionCategory, SearchRegion,
    SearchSource, SearchSourceKind, SiteChannelStatus, SiteCredentialsState,
};
use sqlx::{FromRow, SqlitePool};

use crate::codec;
use crate::error::StoreError;
use crate::repo::not_found;

const SELECT_SOURCES: &str = concat!(
    "SELECT id, project_id, kind, auth_mode, ingest_modes, status, region, \"group\", binding, ",
    "credentials_state, secret_ref, data_through, checked_at, check_detail, note, created_at, ",
    "updated_at FROM search_sources WHERE project_id = ? ORDER BY kind ASC"
);

const SELECT_OPPORTUNITIES: &str = concat!(
    "SELECT id, project_id, rule_id, title_key, basis, evidence_metric_ids, ",
    "prescription_category, impact, difficulty, confidence, status, created_at, updated_at ",
    "FROM search_opportunities WHERE project_id = ? ORDER BY created_at DESC, id ASC"
);

#[derive(Debug, FromRow)]
struct SourceRow {
    id: String,
    project_id: String,
    kind: String,
    auth_mode: String,
    ingest_modes: String,
    status: String,
    region: String,
    group: String,
    binding: String,
    credentials_state: String,
    secret_ref: Option<String>,
    data_through: Option<String>,
    checked_at: Option<String>,
    check_detail: Option<String>,
    note: Option<String>,
    created_at: String,
    updated_at: String,
}

impl SourceRow {
    fn into_source(self) -> Result<SearchSource, StoreError> {
        Ok(SearchSource {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            kind: codec::decode_scalar::<SearchSourceKind>(&self.kind)?,
            auth_mode: codec::decode_scalar::<SearchAuthMode>(&self.auth_mode)?,
            ingest_modes: codec::decode_json::<Vec<SearchIngestMode>>(&self.ingest_modes)?,
            status: codec::decode_scalar::<SiteChannelStatus>(&self.status)?,
            region: codec::decode_scalar::<SearchRegion>(&self.region)?,
            group: codec::decode_scalar::<SearchGroup>(&self.group)?,
            binding: codec::decode_json(&self.binding)?,
            credentials_state: codec::decode_scalar::<SiteCredentialsState>(
                &self.credentials_state,
            )?,
            secret_ref: self.secret_ref,
            data_through: self.data_through,
            checked_at: match self.checked_at {
                Some(raw) => Some(codec::decode_time(&raw)?),
                None => None,
            },
            check_detail: codec::decode_optional_json(self.check_detail)?,
            note: self.note,
            created_at: codec::decode_time(&self.created_at)?,
            updated_at: codec::decode_time(&self.updated_at)?,
        })
    }
}

#[derive(Debug, FromRow)]
struct OpportunityRow {
    id: String,
    project_id: String,
    rule_id: i64,
    title_key: String,
    basis: String,
    evidence_metric_ids: String,
    prescription_category: String,
    impact: String,
    difficulty: String,
    confidence: f64,
    status: String,
    created_at: String,
    updated_at: String,
}

impl OpportunityRow {
    fn into_opportunity(self) -> Result<SearchOpportunity, StoreError> {
        Ok(SearchOpportunity {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            rule_id: u8::try_from(self.rule_id).unwrap_or(0),
            title_key: self.title_key,
            basis: self.basis,
            evidence_metric_ids: codec::decode_json(&self.evidence_metric_ids)?,
            prescription_category: codec::decode_scalar::<SearchPrescriptionCategory>(
                &self.prescription_category,
            )?,
            impact: codec::decode_scalar::<SearchActionLevel>(&self.impact)?,
            difficulty: codec::decode_scalar::<SearchActionLevel>(&self.difficulty)?,
            confidence: self.confidence,
            status: codec::decode_scalar::<SearchOpportunityStatus>(&self.status)?,
            created_at: codec::decode_time(&self.created_at)?,
            updated_at: codec::decode_time(&self.updated_at)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct SearchRepo {
    pool: SqlitePool,
}

impl SearchRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn sources(
        &self,
        project_id: geo_domain::ProjectId,
    ) -> Result<Vec<SearchSource>, StoreError> {
        let rows = sqlx::query_as::<_, SourceRow>(SELECT_SOURCES)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(SourceRow::into_source).collect()
    }

    /// upsert：同 `(project_id, kind)` 覆盖；保留 `id` / `created_at` / `data_through`，
    /// 清空 `checked_at` / `check_detail`。
    pub async fn upsert_source(&self, source: &SearchSource) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO search_sources (id, project_id, kind, auth_mode, ingest_modes, status, ",
            "region, \"group\", binding, credentials_state, secret_ref, data_through, checked_at, ",
            "check_detail, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ",
            "?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, kind) DO UPDATE SET ",
            "auth_mode = excluded.auth_mode, ingest_modes = excluded.ingest_modes, ",
            "status = excluded.status, region = excluded.region, \"group\" = excluded.\"group\", ",
            "binding = excluded.binding, credentials_state = excluded.credentials_state, ",
            "secret_ref = excluded.secret_ref, checked_at = NULL, check_detail = NULL, ",
            "note = excluded.note, updated_at = excluded.updated_at"
        ))
        .bind(source.id.to_string())
        .bind(source.project_id.to_string())
        .bind(codec::encode_scalar(&source.kind)?)
        .bind(codec::encode_scalar(&source.auth_mode)?)
        .bind(codec::encode_json(&source.ingest_modes)?)
        .bind(codec::encode_scalar(&source.status)?)
        .bind(codec::encode_scalar(&source.region)?)
        .bind(codec::encode_scalar(&source.group)?)
        .bind(codec::encode_json(&source.binding)?)
        .bind(codec::encode_scalar(&source.credentials_state)?)
        .bind(&source.secret_ref)
        .bind(&source.data_through)
        .bind(source.checked_at.map(|value| codec::encode_time(&value)))
        .bind(codec::encode_optional_json(&source.check_detail)?)
        .bind(&source.note)
        .bind(codec::encode_time(&source.created_at))
        .bind(codec::encode_time(&source.updated_at))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 删除源（幂等），回剩余快照。
    pub async fn remove_source(
        &self,
        project_id: geo_domain::ProjectId,
        kind: SearchSourceKind,
    ) -> Result<Vec<SearchSource>, StoreError> {
        sqlx::query("DELETE FROM search_sources WHERE project_id = ? AND kind = ?")
            .bind(project_id.to_string())
            .bind(codec::encode_scalar(&kind)?)
            .execute(&self.pool)
            .await?;
        self.sources(project_id).await
    }

    pub async fn opportunities(
        &self,
        project_id: geo_domain::ProjectId,
    ) -> Result<Vec<SearchOpportunity>, StoreError> {
        let rows = sqlx::query_as::<_, OpportunityRow>(SELECT_OPPORTUNITIES)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter()
            .map(OpportunityRow::into_opportunity)
            .collect()
    }

    pub async fn get_opportunity(
        &self,
        id: SearchOpportunityId,
    ) -> Result<SearchOpportunity, StoreError> {
        let row = sqlx::query_as::<_, OpportunityRow>(concat!(
            "SELECT id, project_id, rule_id, title_key, basis, evidence_metric_ids, ",
            "prescription_category, impact, difficulty, confidence, status, created_at, ",
            "updated_at FROM search_opportunities WHERE id = ?"
        ))
        .bind(id.to_string())
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| not_found("search_opportunity", id))?;
        row.into_opportunity()
    }

    pub async fn insert_opportunity(
        &self,
        opportunity: &SearchOpportunity,
    ) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO search_opportunities (id, project_id, rule_id, title_key, basis, ",
            "evidence_metric_ids, prescription_category, impact, difficulty, confidence, status, ",
            "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(opportunity.id.to_string())
        .bind(opportunity.project_id.to_string())
        .bind(i64::from(opportunity.rule_id))
        .bind(&opportunity.title_key)
        .bind(&opportunity.basis)
        .bind(codec::encode_json(&opportunity.evidence_metric_ids)?)
        .bind(codec::encode_scalar(&opportunity.prescription_category)?)
        .bind(codec::encode_scalar(&opportunity.impact)?)
        .bind(codec::encode_scalar(&opportunity.difficulty)?)
        .bind(opportunity.confidence)
        .bind(codec::encode_scalar(&opportunity.status)?)
        .bind(codec::encode_time(&opportunity.created_at))
        .bind(codec::encode_time(&opportunity.updated_at))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn update_opportunity_status(
        &self,
        id: SearchOpportunityId,
        status: SearchOpportunityStatus,
        now: DateTime<Utc>,
    ) -> Result<(), StoreError> {
        let affected =
            sqlx::query("UPDATE search_opportunities SET status = ?, updated_at = ? WHERE id = ?")
                .bind(codec::encode_scalar(&status)?)
                .bind(codec::encode_time(&now))
                .bind(id.to_string())
                .execute(&self.pool)
                .await?
                .rows_affected();
        if affected == 0 {
            return Err(not_found("search_opportunity", id));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::repo::ProjectRepo;
    use crate::testutil::{
        base_time, later, sample_project, sample_search_opportunity, sample_search_source,
    };
    use geo_domain::{ProjectId, SearchOpportunityStatus, SearchSourceKind};

    async fn setup() -> (SearchRepo, ProjectId, SearchRepo, ProjectId) {
        let pool = open_in_memory().await.expect("内存库可用");
        let projects = ProjectRepo::new(pool.clone());
        let project = sample_project("站长数据宿主项目");
        let other = sample_project("另一个项目");
        projects.create(&project).await.expect("先建项目");
        projects.create(&other).await.expect("再建项目");
        (
            SearchRepo::new(pool.clone()),
            project.id,
            SearchRepo::new(pool),
            other.id,
        )
    }

    #[tokio::test]
    async fn source_upsert_roundtrips_and_preserves_data_through() {
        let (repo, project_id, other_repo, other_id) = setup().await;
        let mut source = sample_search_source(project_id, SearchSourceKind::Gsc);
        source.data_through = Some("2026-10-01".to_string());
        repo.upsert_source(&source).await.expect("写入");
        assert_eq!(
            repo.sources(project_id).await.unwrap(),
            vec![source.clone()]
        );
        assert!(other_repo.sources(other_id).await.unwrap().is_empty());

        let mut edited = source.clone();
        edited
            .binding
            .insert("siteUrl".to_string(), "https://new.example".to_string());
        edited.updated_at = later(5);
        repo.upsert_source(&edited).await.expect("更新");
        let loaded = repo.sources(project_id).await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(
            loaded[0].binding.get("siteUrl").map(String::as_str),
            Some("https://new.example")
        );
        assert_eq!(loaded[0].data_through.as_deref(), Some("2026-10-01"));
        assert_eq!(loaded[0].id, source.id);
    }

    #[tokio::test]
    async fn source_remove_is_idempotent_and_scoped() {
        let (repo, project_id, other_repo, other_id) = setup().await;
        let mine = sample_search_source(project_id, SearchSourceKind::BaiduZiyuan);
        let theirs = sample_search_source(other_id, SearchSourceKind::BaiduZiyuan);
        repo.upsert_source(&mine).await.expect("写入");
        other_repo.upsert_source(&theirs).await.expect("写入");
        assert!(repo
            .remove_source(project_id, SearchSourceKind::BaiduZiyuan)
            .await
            .unwrap()
            .is_empty());
        assert!(repo
            .remove_source(project_id, SearchSourceKind::BaiduZiyuan)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(other_repo.sources(other_id).await.unwrap(), vec![theirs]);
    }

    #[tokio::test]
    async fn opportunity_insert_list_and_update_status() {
        let (repo, project_id, _other, _other_id) = setup().await;
        let opportunity = sample_search_opportunity(project_id, SearchOpportunityStatus::New);
        repo.insert_opportunity(&opportunity).await.expect("写入");
        assert_eq!(
            repo.opportunities(project_id).await.unwrap(),
            vec![opportunity.clone()]
        );
        repo.update_opportunity_status(opportunity.id, SearchOpportunityStatus::Adopted, later(10))
            .await
            .expect("翻状态");
        let loaded = repo.get_opportunity(opportunity.id).await.unwrap();
        assert_eq!(loaded.status, SearchOpportunityStatus::Adopted);
        assert_eq!(loaded.updated_at, later(10));
        let _ = base_time();
    }
}

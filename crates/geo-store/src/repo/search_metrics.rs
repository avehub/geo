//! 站长指标 / AI 汇总 / 平台独有留档仓储（M5.5，A2a）。
//!
//! 同周期同源覆盖旧行（DR-97 ②）；插入与删除同事务。

use geo_domain::{
    SearchAiOverview, SearchCompleteness, SearchNativeExtra, SearchQueryMetric, SearchSourceKind,
    SearchSurface, WindowSource,
};
use sqlx::{FromRow, Sqlite, SqlitePool};

use crate::codec;
use crate::error::StoreError;

const SELECT_METRICS: &str = concat!(
    "SELECT id, project_id, source_kind, surface, query, page_url, impressions, clicks, ctr, ",
    "citations, ai_clicks, period_start, period_end, data_through, imported_at, completeness, ",
    "window_source, mapping_version FROM search_metrics WHERE project_id = ? ",
    "ORDER BY period_start DESC, query ASC, id ASC"
);

const SELECT_OVERVIEWS: &str = concat!(
    "SELECT id, project_id, source_kind, citations, ai_impressions, ai_clicks, ai_ctr, ",
    "cited_pages, period_start, period_end, data_through, imported_at, completeness, ",
    "window_source, mapping_version FROM search_ai_overviews WHERE project_id = ? ",
    "ORDER BY period_start DESC, id ASC"
);

const SELECT_EXTRAS: &str = concat!(
    "SELECT id, project_id, source_kind, label, value_json, metric_id, observed_at ",
    "FROM search_native_extras WHERE project_id = ? ORDER BY observed_at DESC, id ASC"
);

#[derive(Debug, FromRow)]
struct MetricRow {
    id: String,
    project_id: String,
    source_kind: String,
    surface: String,
    query: String,
    page_url: Option<String>,
    impressions: Option<i64>,
    clicks: Option<i64>,
    ctr: Option<f64>,
    citations: Option<i64>,
    ai_clicks: Option<i64>,
    period_start: String,
    period_end: String,
    data_through: String,
    imported_at: String,
    completeness: String,
    window_source: String,
    mapping_version: String,
}

impl MetricRow {
    fn into_metric(self) -> Result<SearchQueryMetric, StoreError> {
        Ok(SearchQueryMetric {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            source_kind: codec::decode_scalar::<SearchSourceKind>(&self.source_kind)?,
            surface: codec::decode_scalar::<SearchSurface>(&self.surface)?,
            query: self.query,
            page_url: self.page_url,
            impressions: self.impressions,
            clicks: self.clicks,
            ctr: self.ctr,
            citations: self.citations,
            ai_clicks: self.ai_clicks,
            period_start: self.period_start,
            period_end: self.period_end,
            data_through: self.data_through,
            imported_at: codec::decode_time(&self.imported_at)?,
            completeness: codec::decode_scalar::<SearchCompleteness>(&self.completeness)?,
            window_source: codec::decode_scalar::<WindowSource>(&self.window_source)?,
            mapping_version: self.mapping_version,
        })
    }
}

#[derive(Debug, FromRow)]
struct OverviewRow {
    id: String,
    project_id: String,
    source_kind: String,
    citations: Option<i64>,
    ai_impressions: Option<i64>,
    ai_clicks: Option<i64>,
    ai_ctr: Option<f64>,
    cited_pages: Option<i64>,
    period_start: String,
    period_end: String,
    data_through: String,
    imported_at: String,
    completeness: String,
    window_source: String,
    mapping_version: String,
}

impl OverviewRow {
    fn into_overview(self) -> Result<SearchAiOverview, StoreError> {
        Ok(SearchAiOverview {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            source_kind: codec::decode_scalar::<SearchSourceKind>(&self.source_kind)?,
            citations: self.citations,
            ai_impressions: self.ai_impressions,
            ai_clicks: self.ai_clicks,
            ai_ctr: self.ai_ctr,
            cited_pages: self.cited_pages,
            period_start: self.period_start,
            period_end: self.period_end,
            data_through: self.data_through,
            imported_at: codec::decode_time(&self.imported_at)?,
            completeness: codec::decode_scalar::<SearchCompleteness>(&self.completeness)?,
            window_source: codec::decode_scalar::<WindowSource>(&self.window_source)?,
            mapping_version: self.mapping_version,
        })
    }
}

#[derive(Debug, FromRow)]
struct ExtraRow {
    id: String,
    project_id: String,
    source_kind: String,
    label: String,
    value_json: Option<String>,
    metric_id: Option<String>,
    observed_at: String,
}

impl ExtraRow {
    fn into_extra(self) -> Result<SearchNativeExtra, StoreError> {
        Ok(SearchNativeExtra {
            id: codec::decode_scalar(&self.id)?,
            project_id: codec::decode_scalar(&self.project_id)?,
            source_kind: codec::decode_scalar::<SearchSourceKind>(&self.source_kind)?,
            label: self.label,
            value: codec::decode_optional_json(self.value_json)?,
            metric_id: self.metric_id,
            observed_at: codec::decode_time(&self.observed_at)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct SearchMetricRepo {
    pool: SqlitePool,
}

impl SearchMetricRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn metrics(
        &self,
        project_id: geo_domain::ProjectId,
    ) -> Result<Vec<SearchQueryMetric>, StoreError> {
        let rows = sqlx::query_as::<_, MetricRow>(SELECT_METRICS)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(MetricRow::into_metric).collect()
    }

    pub async fn overviews(
        &self,
        project_id: geo_domain::ProjectId,
    ) -> Result<Vec<SearchAiOverview>, StoreError> {
        let rows = sqlx::query_as::<_, OverviewRow>(SELECT_OVERVIEWS)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(OverviewRow::into_overview).collect()
    }

    pub async fn extras(
        &self,
        project_id: geo_domain::ProjectId,
    ) -> Result<Vec<SearchNativeExtra>, StoreError> {
        let rows = sqlx::query_as::<_, ExtraRow>(SELECT_EXTRAS)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(ExtraRow::into_extra).collect()
    }

    pub async fn replace_metrics_slot(
        &self,
        project_id: geo_domain::ProjectId,
        kind: SearchSourceKind,
        period_start: &str,
        period_end: &str,
        metrics: &[SearchQueryMetric],
        extras: &[SearchNativeExtra],
    ) -> Result<(), StoreError> {
        let mut transaction = self.pool.begin().await?;
        let old_ids: Vec<(String,)> = sqlx::query_as(
            "SELECT id FROM search_metrics WHERE project_id = ? AND source_kind = ? \
             AND period_start = ? AND period_end = ?",
        )
        .bind(project_id.to_string())
        .bind(codec::encode_scalar(&kind)?)
        .bind(period_start)
        .bind(period_end)
        .fetch_all(&mut *transaction)
        .await?;
        for (id,) in &old_ids {
            sqlx::query("DELETE FROM search_native_extras WHERE metric_id = ?")
                .bind(id)
                .execute(&mut *transaction)
                .await?;
        }
        sqlx::query(
            "DELETE FROM search_metrics WHERE project_id = ? AND source_kind = ? \
             AND period_start = ? AND period_end = ?",
        )
        .bind(project_id.to_string())
        .bind(codec::encode_scalar(&kind)?)
        .bind(period_start)
        .bind(period_end)
        .execute(&mut *transaction)
        .await?;
        for metric in metrics {
            insert_metric(&mut transaction, metric).await?;
        }
        for extra in extras {
            insert_extra(&mut transaction, extra).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn replace_ai_slot(
        &self,
        project_id: geo_domain::ProjectId,
        kind: SearchSourceKind,
        period_start: &str,
        period_end: &str,
        overview: &SearchAiOverview,
        extras: &[SearchNativeExtra],
    ) -> Result<(), StoreError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "DELETE FROM search_ai_overviews WHERE project_id = ? AND source_kind = ? \
             AND period_start = ? AND period_end = ?",
        )
        .bind(project_id.to_string())
        .bind(codec::encode_scalar(&kind)?)
        .bind(period_start)
        .bind(period_end)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "DELETE FROM search_native_extras WHERE project_id = ? AND source_kind = ? \
             AND metric_id IS NULL",
        )
        .bind(project_id.to_string())
        .bind(codec::encode_scalar(&kind)?)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(concat!(
            "INSERT INTO search_ai_overviews (id, project_id, source_kind, citations, ",
            "ai_impressions, ai_clicks, ai_ctr, cited_pages, period_start, period_end, ",
            "data_through, imported_at, completeness, window_source, mapping_version) ",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(overview.id.to_string())
        .bind(overview.project_id.to_string())
        .bind(codec::encode_scalar(&overview.source_kind)?)
        .bind(overview.citations)
        .bind(overview.ai_impressions)
        .bind(overview.ai_clicks)
        .bind(overview.ai_ctr)
        .bind(overview.cited_pages)
        .bind(&overview.period_start)
        .bind(&overview.period_end)
        .bind(&overview.data_through)
        .bind(codec::encode_time(&overview.imported_at))
        .bind(codec::encode_scalar(&overview.completeness)?)
        .bind(codec::encode_scalar(&overview.window_source)?)
        .bind(&overview.mapping_version)
        .execute(&mut *transaction)
        .await?;
        for extra in extras {
            insert_extra(&mut transaction, extra).await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    /// 移除源时级联删除该源的全部指标 / 汇总 / 留档。
    pub async fn delete_for_source(
        &self,
        project_id: geo_domain::ProjectId,
        kind: SearchSourceKind,
    ) -> Result<(), StoreError> {
        let mut transaction = self.pool.begin().await?;
        let encoded = codec::encode_scalar(&kind)?;
        sqlx::query("DELETE FROM search_metrics WHERE project_id = ? AND source_kind = ?")
            .bind(project_id.to_string())
            .bind(&encoded)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM search_ai_overviews WHERE project_id = ? AND source_kind = ?")
            .bind(project_id.to_string())
            .bind(&encoded)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM search_native_extras WHERE project_id = ? AND source_kind = ?")
            .bind(project_id.to_string())
            .bind(&encoded)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(())
    }
}

async fn insert_metric(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    metric: &SearchQueryMetric,
) -> Result<(), StoreError> {
    sqlx::query(concat!(
        "INSERT INTO search_metrics (id, project_id, source_kind, surface, query, page_url, ",
        "impressions, clicks, ctr, citations, ai_clicks, period_start, period_end, ",
        "data_through, imported_at, completeness, window_source, mapping_version) ",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ))
    .bind(metric.id.to_string())
    .bind(metric.project_id.to_string())
    .bind(codec::encode_scalar(&metric.source_kind)?)
    .bind(codec::encode_scalar(&metric.surface)?)
    .bind(&metric.query)
    .bind(&metric.page_url)
    .bind(metric.impressions)
    .bind(metric.clicks)
    .bind(metric.ctr)
    .bind(metric.citations)
    .bind(metric.ai_clicks)
    .bind(&metric.period_start)
    .bind(&metric.period_end)
    .bind(&metric.data_through)
    .bind(codec::encode_time(&metric.imported_at))
    .bind(codec::encode_scalar(&metric.completeness)?)
    .bind(codec::encode_scalar(&metric.window_source)?)
    .bind(&metric.mapping_version)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn insert_extra(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
    extra: &SearchNativeExtra,
) -> Result<(), StoreError> {
    sqlx::query(concat!(
        "INSERT INTO search_native_extras (id, project_id, source_kind, label, value_json, ",
        "metric_id, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ))
    .bind(extra.id.to_string())
    .bind(extra.project_id.to_string())
    .bind(codec::encode_scalar(&extra.source_kind)?)
    .bind(&extra.label)
    .bind(codec::encode_optional_json(&extra.value)?)
    .bind(&extra.metric_id)
    .bind(codec::encode_time(&extra.observed_at))
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::repo::ProjectRepo;
    use crate::testutil::{base_time, sample_project};
    use geo_domain::{
        SearchAiOverview, SearchAiOverviewId, SearchCompleteness, SearchMetricId,
        SearchNativeExtraId, SearchSurface, WindowSource,
    };

    fn metric(
        project_id: geo_domain::ProjectId,
        query: &str,
        impressions: i64,
    ) -> SearchQueryMetric {
        SearchQueryMetric {
            id: SearchMetricId::new(),
            project_id,
            source_kind: SearchSourceKind::BaiduZiyuanAi,
            surface: SearchSurface::AiAnswer,
            query: query.to_string(),
            page_url: None,
            impressions: Some(impressions),
            clicks: Some(8),
            ctr: Some(0.2),
            citations: Some(40),
            ai_clicks: None,
            period_start: "2026-09-01".to_string(),
            period_end: "2026-09-30".to_string(),
            data_through: "2026-09-30".to_string(),
            imported_at: base_time(),
            completeness: SearchCompleteness::Partial,
            window_source: WindowSource::UserStated,
            mapping_version: "2026-10-12.1".to_string(),
        }
    }

    async fn setup() -> SearchMetricRepo {
        let pool = open_in_memory().await.unwrap();
        ProjectRepo::new(pool.clone())
            .create(&sample_project("指标项目"))
            .await
            .unwrap();
        SearchMetricRepo::new(pool)
    }

    #[tokio::test]
    async fn replace_slot_overwrites_same_period_and_keeps_other_rows() {
        let repo = setup().await;
        let project = ProjectRepo::new(repo.pool.clone())
            .list(&Default::default())
            .await
            .unwrap()[0]
            .id;
        let mut other = metric(project, "其他", 10);
        other.period_start = "2026-08-01".to_string();
        other.period_end = "2026-08-31".to_string();
        repo.replace_metrics_slot(
            project,
            SearchSourceKind::BaiduZiyuanAi,
            "2026-08-01",
            "2026-08-31",
            std::slice::from_ref(&other),
            &[],
        )
        .await
        .unwrap();
        repo.replace_metrics_slot(
            project,
            SearchSourceKind::BaiduZiyuanAi,
            "2026-09-01",
            "2026-09-30",
            &[metric(project, "旧", 1)],
            &[],
        )
        .await
        .unwrap();
        repo.replace_metrics_slot(
            project,
            SearchSourceKind::BaiduZiyuanAi,
            "2026-09-01",
            "2026-09-30",
            &[metric(project, "新", 2)],
            &[],
        )
        .await
        .unwrap();
        let rows = repo.metrics(project).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|row| row.query == "新"));
        assert!(rows.iter().any(|row| row.query == "其他"));
    }

    #[tokio::test]
    async fn delete_for_source_removes_all_three_tables() {
        let repo = setup().await;
        let project = ProjectRepo::new(repo.pool.clone())
            .list(&Default::default())
            .await
            .unwrap()[0]
            .id;
        let metric = metric(project, "词", 10);
        let extra = SearchNativeExtra {
            id: SearchNativeExtraId::new(),
            project_id: project,
            source_kind: SearchSourceKind::BaiduZiyuanAi,
            label: "平均排名".to_string(),
            value: Some(serde_json::json!("3")),
            metric_id: Some(metric.id.to_string()),
            observed_at: base_time(),
        };
        repo.replace_metrics_slot(
            project,
            SearchSourceKind::BaiduZiyuanAi,
            "2026-09-01",
            "2026-09-30",
            std::slice::from_ref(&metric),
            std::slice::from_ref(&extra),
        )
        .await
        .unwrap();
        let overview = SearchAiOverview {
            id: SearchAiOverviewId::new(),
            project_id: project,
            source_kind: SearchSourceKind::BaiduZiyuanAi,
            citations: Some(40),
            ai_impressions: Some(100),
            ai_clicks: Some(8),
            ai_ctr: Some(0.2),
            cited_pages: Some(3),
            period_start: "2026-09-01".to_string(),
            period_end: "2026-09-30".to_string(),
            data_through: "2026-09-30".to_string(),
            imported_at: base_time(),
            completeness: SearchCompleteness::Partial,
            window_source: WindowSource::UserStated,
            mapping_version: "2026-10-12.1".to_string(),
        };
        repo.replace_ai_slot(
            project,
            SearchSourceKind::BaiduZiyuanAi,
            "2026-09-01",
            "2026-09-30",
            &overview,
            &[],
        )
        .await
        .unwrap();
        repo.delete_for_source(project, SearchSourceKind::BaiduZiyuanAi)
            .await
            .unwrap();
        assert!(repo.metrics(project).await.unwrap().is_empty());
        assert!(repo.overviews(project).await.unwrap().is_empty());
        assert!(repo.extras(project).await.unwrap().is_empty());
    }
}

//! M1 项目相关命令：项目 CRUD、竞品、资产。
//!
//! 命令层只做三件事：解析参数、调 service、把 `IpcError` 交给 Tauri。
//! 参数名与前端 `apps/desktop/ui/src/api/client.ts` 一一对应（`rename_all = "snake_case"`）。

use chrono::Utc;
use geo_domain::{
    AssetId, AssetKind, Competitor, CompetitorDraft, CompetitorId, Project, ProjectAsset,
    ProjectDraft, ProjectId,
};
use geo_store::ProjectFilter;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::IpcError;
use crate::services::{ImportReport, ProjectDetail, ProjectExport, ProjectService};
use crate::state::AppState;

/// 列表过滤条件的入参形态。`geo_store::ProjectFilter` 不带 serde，故在此转一道。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectFilterDto {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub include_archived: bool,
    #[serde(default)]
    pub tags: Vec<String>,
}

impl From<ProjectFilterDto> for ProjectFilter {
    fn from(dto: ProjectFilterDto) -> Self {
        Self {
            query: dto.query.filter(|query| !query.trim().is_empty()),
            include_archived: dto.include_archived,
            tags: dto.tags,
        }
    }
}

fn service(state: &AppState) -> ProjectService {
    ProjectService::new(state.pool.clone())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn project_create(
    state: State<'_, AppState>,
    draft: ProjectDraft,
) -> Result<Project, IpcError> {
    service(&state).create_draft(&draft, Utc::now()).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn project_list(
    state: State<'_, AppState>,
    filter: Option<ProjectFilterDto>,
) -> Result<Vec<Project>, IpcError> {
    service(&state)
        .list(&filter.unwrap_or_default().into())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn project_get(
    state: State<'_, AppState>,
    id: ProjectId,
) -> Result<ProjectDetail, IpcError> {
    service(&state).detail(id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn project_update(
    state: State<'_, AppState>,
    project: Project,
) -> Result<Project, IpcError> {
    service(&state).update(&project, Utc::now()).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn project_archive(
    state: State<'_, AppState>,
    id: ProjectId,
    archived: bool,
) -> Result<Project, IpcError> {
    service(&state).archive(id, archived, Utc::now()).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn project_delete(state: State<'_, AppState>, id: ProjectId) -> Result<(), IpcError> {
    service(&state).delete(id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn project_export(
    state: State<'_, AppState>,
    id: ProjectId,
) -> Result<ProjectExport, IpcError> {
    service(&state).export_json(id, Utc::now()).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn project_import(
    state: State<'_, AppState>,
    payload: String,
) -> Result<ImportReport, IpcError> {
    service(&state).import_json(&payload, Utc::now()).await
}

// ---------------------------------------------------------------------------
// 竞品
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "snake_case")]
pub async fn competitor_upsert(
    state: State<'_, AppState>,
    project_id: ProjectId,
    draft: CompetitorDraft,
    id: Option<CompetitorId>,
) -> Result<Competitor, IpcError> {
    service(&state)
        .upsert_competitor(project_id, &draft, id, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn competitor_list(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<Vec<Competitor>, IpcError> {
    service(&state).list_competitors(project_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn competitor_delete(
    state: State<'_, AppState>,
    id: CompetitorId,
) -> Result<(), IpcError> {
    service(&state).delete_competitor(id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn competitor_reorder(
    state: State<'_, AppState>,
    project_id: ProjectId,
    ids: Vec<CompetitorId>,
) -> Result<Vec<Competitor>, IpcError> {
    service(&state).reorder_competitors(project_id, &ids).await
}

// ---------------------------------------------------------------------------
// 资产
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "snake_case")]
pub async fn asset_add(
    state: State<'_, AppState>,
    project_id: ProjectId,
    kind: AssetKind,
    url: String,
    title: Option<String>,
    note: Option<String>,
) -> Result<ProjectAsset, IpcError> {
    service(&state)
        .add_asset(project_id, kind, url, title, note, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn asset_list(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<Vec<ProjectAsset>, IpcError> {
    service(&state).list_assets(project_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn asset_delete(state: State<'_, AppState>, id: AssetId) -> Result<(), IpcError> {
    service(&state).delete_asset(id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_dto_defaults_to_active_projects_without_query() {
        let filter: ProjectFilter = ProjectFilterDto::default().into();
        assert_eq!(filter.query, None);
        assert!(!filter.include_archived);
        assert!(filter.tags.is_empty());
    }

    #[test]
    fn blank_query_is_dropped_so_the_list_is_not_filtered_by_whitespace() {
        let dto = ProjectFilterDto {
            query: Some("   ".to_string()),
            include_archived: true,
            tags: vec!["水泵".to_string()],
        };
        let filter: ProjectFilter = dto.into();
        assert_eq!(filter.query, None);
        assert!(filter.include_archived);
        assert_eq!(filter.tags, vec!["水泵".to_string()]);
    }

    #[test]
    fn filter_dto_matches_the_frontend_payload_shape() {
        // 前端 projectList({}) 会发一个空对象，必须能反序列化
        let dto: ProjectFilterDto = serde_json::from_str("{}").expect("空对象可用");
        assert_eq!(dto, ProjectFilterDto::default());
        let full: ProjectFilterDto =
            serde_json::from_str(r#"{"query":"泵","include_archived":false,"tags":["a","b"]}"#)
                .expect("完整对象可用");
        assert_eq!(full.query.as_deref(), Some("泵"));
        assert_eq!(full.tags.len(), 2);
    }
}

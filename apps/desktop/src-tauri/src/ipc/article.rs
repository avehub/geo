//! 文章管理命令（Article Studio，10 条）。
//!
//! 返回形状与 demo 契约一致：`*_list` 回清单、`*_add` / `*_save` 回那一条、
//! `*_delete` 回剩余快照、`article_schedule_run` 回本次生成的数组。

use chrono::Utc;
use geo_domain::{
    Article, ArticleDirection, ArticleDirectionDraft, ArticleListQuery, ArticleReviewRequest,
    ArticleSchedule, ArticleScheduleDraft, ArticleTemplate, ArticleTemplateDraft, ProjectId,
};
use tauri::State;

use crate::error::IpcError;
use crate::services::ArticleService;
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn article_direction_list(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<Vec<ArticleDirection>, IpcError> {
    ArticleService::from_state(&state)
        .directions(project_id)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn article_direction_add(
    state: State<'_, AppState>,
    project_id: ProjectId,
    id: Option<String>,
    title: Option<String>,
    summary: Option<String>,
    status: Option<String>,
) -> Result<ArticleDirection, IpcError> {
    ArticleService::from_state(&state)
        .add_direction(
            project_id,
            ArticleDirectionDraft {
                id,
                title,
                summary,
                status,
            },
            Utc::now(),
        )
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn article_direction_generate(
    state: State<'_, AppState>,
    project_id: ProjectId,
    target_count: u16,
) -> Result<Vec<ArticleDirection>, IpcError> {
    ArticleService::from_state(&state)
        .generate_directions(project_id, target_count)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn article_template_list(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<Vec<ArticleTemplate>, IpcError> {
    ArticleService::from_state(&state)
        .templates(project_id)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn article_template_save(
    state: State<'_, AppState>,
    project_id: ProjectId,
    template: ArticleTemplateDraft,
) -> Result<ArticleTemplate, IpcError> {
    ArticleService::from_state(&state)
        .save_template(project_id, template, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn article_template_delete(
    state: State<'_, AppState>,
    project_id: ProjectId,
    ids: Vec<String>,
) -> Result<Vec<ArticleTemplate>, IpcError> {
    ArticleService::from_state(&state)
        .delete_templates(project_id, ids)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn article_schedule_list(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<Vec<ArticleSchedule>, IpcError> {
    ArticleService::from_state(&state)
        .schedules(project_id)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn article_schedule_save(
    state: State<'_, AppState>,
    project_id: ProjectId,
    schedule: ArticleScheduleDraft,
) -> Result<ArticleSchedule, IpcError> {
    ArticleService::from_state(&state)
        .save_schedule(project_id, schedule, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn article_schedule_run(
    state: State<'_, AppState>,
    project_id: ProjectId,
    schedule_id: Option<String>,
    template_id: Option<String>,
) -> Result<Vec<Article>, IpcError> {
    ArticleService::from_state(&state)
        .run_schedule(project_id, schedule_id, template_id, Utc::now())
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn article_list(
    state: State<'_, AppState>,
    project_id: ProjectId,
    status: Option<String>,
    review: Option<ArticleReviewRequest>,
) -> Result<Vec<Article>, IpcError> {
    ArticleService::from_state(&state)
        .articles(project_id, ArticleListQuery { status, review })
        .await
}

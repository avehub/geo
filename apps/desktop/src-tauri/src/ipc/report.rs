//! M7 报告命令（Plan C M3–M7 读路径）。
//!
//! 只做参数转发；文档组装在 `services::ReportService`。

use geo_domain::{ProjectId, ReportDocument, ReportRenderOptions};
use tauri::State;

use crate::error::IpcError;
use crate::services::ReportService;
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn report_render(
    state: State<'_, AppState>,
    project_id: ProjectId,
    round_id: String,
    options: ReportRenderOptions,
) -> Result<ReportDocument, IpcError> {
    ReportService::from_state(&state)
        .render(project_id, round_id, options)
        .await
}

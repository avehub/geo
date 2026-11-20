//! M3 多引擎采集命令（读路径 + 官方 API 采集执行）。
//!
//! `collection_start` 建完轮次立即返回，执行丢到后台（避免命令挂几分钟）；
//! `collection_task_retry` 只重跑一条失败任务。

use geo_domain::{
    CollectionBoard, CollectionRecord, CollectionRecordDetail, CollectionRound,
    CollectionRoundDetail, CollectionTask, EngineId, ProjectId, RecordFilter,
};
use tauri::State;

use crate::error::IpcError;
use crate::services::{CollectionService, CollectionStartOptions};
use crate::state::AppState;

#[tauri::command(rename_all = "snake_case")]
pub async fn collection_board(
    state: State<'_, AppState>,
    project_id: ProjectId,
) -> Result<CollectionBoard, IpcError> {
    CollectionService::from_state(&state)
        .board(project_id)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn collection_round_get(
    state: State<'_, AppState>,
    round_id: String,
) -> Result<CollectionRoundDetail, IpcError> {
    CollectionService::from_state(&state)
        .round_get(round_id)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn collection_record_list(
    state: State<'_, AppState>,
    round_id: String,
    filter: RecordFilter,
) -> Result<Vec<CollectionRecord>, IpcError> {
    CollectionService::from_state(&state)
        .record_list(round_id, filter)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn collection_record_get(
    state: State<'_, AppState>,
    record_id: String,
) -> Result<CollectionRecordDetail, IpcError> {
    CollectionService::from_state(&state)
        .record_get(record_id)
        .await
}

/// 打开元宝的纯登录窗口（不提交问题）。
///
/// Store（MSIX）版按 B8 裁定不含浏览器通道 ⇒ 与 `search_browser_*` 同一道门禁。
#[tauri::command(rename_all = "snake_case")]
pub async fn collection_engine_login(
    state: State<'_, AppState>,
    engine: EngineId,
) -> Result<(), IpcError> {
    crate::build_flavor::reject_in_store_build("yuanbao")?;
    CollectionService::from_state(&state)
        .open_engine_login(engine)
        .await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn collection_start(
    state: State<'_, AppState>,
    project_id: ProjectId,
    options: CollectionStartOptions,
) -> Result<CollectionRound, IpcError> {
    let service = CollectionService::from_state(&state);
    let round = service.start(project_id, options).await?;
    let round_id = round.id.clone();
    let background = service.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = background.execute_round(&round_id).await {
            tracing::warn!(
                code = error.code.as_str(),
                "collection round execution stopped with an error"
            );
        }
    });
    Ok(round)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn collection_task_retry(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<CollectionTask, IpcError> {
    CollectionService::from_state(&state)
        .retry_task(task_id)
        .await
}

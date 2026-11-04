//! M1.2b 知识库服务集成测试（Plan C 第三个纵向切片）。

mod support;

use chrono::Duration;
use geo_domain::{
    ContentStatus, KbEntryDraft, KbEntryId, KbEntryKind, KbModule, KbScenario, KbSource, ProjectId,
};
use support::{now, sample_draft, test_state, OfflineTransport};

use geo_desktop_lib::services::{KbService, ProjectService};

fn draft(title: &str) -> KbEntryDraft {
    KbEntryDraft {
        module: KbModule::SalesScript,
        kind: KbEntryKind::Statement,
        title: title.to_string(),
        body_markdown: "我们帮客户做 GEO。".to_string(),
        url: None,
        mime: None,
        tags: vec![" 开场 ".to_string(), "".to_string()],
        scenario: Some(KbScenario::SalesFirstContact),
        source: None,
        status: None,
    }
}

async fn project(state: &geo_desktop_lib::state::AppState) -> ProjectId {
    ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目")
        .id
}

#[tokio::test]
async fn board_on_empty_project_has_zero_stats_and_no_revisions() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let board = KbService::from_state(&state)
        .board(project_id)
        .await
        .expect("读 board");
    assert_eq!(board.project_id, project_id);
    assert!(board.entries.is_empty());
    assert!(board.revisions.is_empty());
    assert_eq!(board.stats.entries, 0);
    assert_eq!(board.stats.modules, 0);
    assert!(board.project_updated_at <= now());
}

#[tokio::test]
async fn add_manual_entries_persists_defaults_and_stats() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = KbService::from_state(&state);

    let mut brand = draft("品牌定义");
    brand.module = KbModule::Brand;
    brand.kind = KbEntryKind::Text;
    brand.scenario = Some(KbScenario::SalesQuote);
    let added = service
        .add(project_id, vec![draft("  开场话术  "), brand], now())
        .await
        .expect("新增");
    assert_eq!(added.len(), 2);
    assert_eq!(added[0].title, "开场话术");
    assert_eq!(added[0].source, KbSource::Manual);
    assert_eq!(added[0].status, ContentStatus::Approved);
    assert_eq!(added[0].tags, vec!["开场".to_string()]);
    assert_eq!(added[0].scenario, Some(KbScenario::SalesFirstContact));
    assert_eq!(added[1].scenario, None, "非话术模块的场景必须被摘掉");

    let board = service.board(project_id).await.expect("读 board");
    assert_eq!(board.stats.entries, 2);
    assert_eq!(board.stats.modules, 2);
    assert_eq!(board.stats.scripts, 1);
    assert_eq!(board.stats.unverified, 2);
    assert!(board.revisions.is_empty(), "新增不留痕");
}

#[tokio::test]
async fn add_imported_respects_source_and_status_only_for_imported() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = KbService::from_state(&state);

    let mut imported = draft("导入条目");
    imported.source = Some(KbSource::Imported);
    imported.status = Some(ContentStatus::PendingReview);
    let mut claimed = draft("前端自称生成");
    claimed.source = Some(KbSource::Generated);
    let added = service
        .add(project_id, vec![imported, claimed], now())
        .await
        .expect("新增");
    assert_eq!(added[0].source, KbSource::Imported);
    assert_eq!(added[0].status, ContentStatus::PendingReview);
    assert_eq!(added[1].source, KbSource::Manual, "generated 不是可覆盖值");
    assert_eq!(added[1].status, ContentStatus::Approved);
}

#[tokio::test]
async fn add_is_all_or_nothing_when_a_title_is_blank() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = KbService::from_state(&state);
    let error = service
        .add(project_id, vec![draft("有效"), draft("   ")], now())
        .await
        .expect_err("空标题必须整批拒绝");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(error.params["field"], "kb_title");
    assert!(service.board(project_id).await.unwrap().entries.is_empty());
}

#[tokio::test]
async fn update_records_one_revision_per_changed_field_and_keeps_immutable_columns() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = KbService::from_state(&state);
    let original = service
        .add(project_id, vec![draft("旧标题")], now())
        .await
        .expect("新增")
        .remove(0);
    service
        .verify(project_id, vec![original.id], now())
        .await
        .expect("先核实");

    let mut edited = service.board(project_id).await.unwrap().entries.remove(0);
    edited.title = "  新标题  ".to_string();
    edited.module = KbModule::Brand;
    edited.body_markdown = "字".repeat(150);
    edited.updated_at = now() + Duration::seconds(5);
    let updated = service
        .update(edited, now() + Duration::seconds(5))
        .await
        .expect("更新");
    assert_eq!(updated.title, "新标题");
    assert_eq!(updated.module, KbModule::Brand);
    assert_eq!(updated.source, original.source);
    assert_eq!(updated.position, original.position);
    assert_eq!(updated.created_at, original.created_at);
    assert!(updated.verified_at.is_some(), "编辑不许清掉核实时间");

    let board = service.board(project_id).await.unwrap();
    let fields: Vec<&str> = board
        .revisions
        .iter()
        .filter(|row| row.field_path != "verified_at")
        .map(|row| row.field_path.as_str())
        .collect();
    assert_eq!(fields, vec!["module", "title", "body_markdown", "scenario"]);
    let body = board
        .revisions
        .iter()
        .find(|row| row.field_path == "body_markdown")
        .unwrap();
    assert_eq!(
        body.new_value
            .as_ref()
            .unwrap()
            .as_str()
            .unwrap()
            .chars()
            .count(),
        120,
        "留痕里的正文截断到 120 字符"
    );
}

#[tokio::test]
async fn update_cross_project_id_is_invalid_id() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let first = project(&state).await;
    let mut other_draft = sample_draft();
    other_draft.brand_name = "另一个品牌".to_string();
    let second = ProjectService::new(state.pool.clone())
        .create_draft(&other_draft, now())
        .await
        .expect("项目二")
        .id;
    let service = KbService::from_state(&state);
    let mut entry = service
        .add(first, vec![draft("跨项目")], now())
        .await
        .expect("新增")
        .remove(0);
    entry.project_id = second;
    let error = service
        .update(entry, now())
        .await
        .expect_err("跨项目 id 必须拒绝");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(error.params["field"], "kb_entry_id");
}

#[tokio::test]
async fn delete_reindexes_positions_and_keeps_revisions() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = KbService::from_state(&state);
    let added = service
        .add(
            project_id,
            vec![draft("一"), draft("二"), draft("三")],
            now(),
        )
        .await
        .expect("新增");
    let mut edited = added[0].clone();
    edited.title = "一改".to_string();
    service
        .update(edited, now() + Duration::seconds(1))
        .await
        .expect("更新");

    let remaining = service
        .delete(project_id, vec![added[0].id])
        .await
        .expect("删除");
    assert_eq!(remaining.len(), 2);
    assert_eq!(remaining[0].position, 0);
    assert_eq!(remaining[1].position, 1);
    assert_eq!(
        service.board(project_id).await.unwrap().revisions.len(),
        1,
        "删除条目不删留痕"
    );
}

#[tokio::test]
async fn verify_flips_status_and_records_previous_time() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = KbService::from_state(&state);
    let mut imported = draft("待核实");
    imported.source = Some(KbSource::Imported);
    imported.status = Some(ContentStatus::PendingReview);
    let entry = service
        .add(project_id, vec![imported], now())
        .await
        .expect("新增")
        .remove(0);

    let first = service
        .verify(
            project_id,
            vec![entry.id, KbEntryId::new()],
            now() + Duration::seconds(10),
        )
        .await
        .expect("核实");
    assert_eq!(first[0].status, ContentStatus::Approved);
    assert_eq!(first[0].verified_at, Some(now() + Duration::seconds(10)));

    let second = service
        .verify(project_id, vec![entry.id], now() + Duration::seconds(20))
        .await
        .expect("再次核实");
    assert_eq!(second[0].verified_at, Some(now() + Duration::seconds(20)));
    let board = service.board(project_id).await.unwrap();
    let verify_rows: Vec<_> = board
        .revisions
        .iter()
        .filter(|row| row.field_path == "verified_at")
        .collect();
    assert_eq!(verify_rows.len(), 2);
    let previous: chrono::DateTime<chrono::Utc> =
        serde_json::from_value(verify_rows[0].old_value.clone().unwrap()).unwrap();
    assert_eq!(previous, now() + Duration::seconds(10));
}

#[tokio::test]
async fn missing_project_is_project_not_found() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = KbService::from_state(&state)
        .board(ProjectId::new())
        .await
        .expect_err("未知项目必须报 project/not_found");
    assert_eq!(error.code, "project/not_found");
}

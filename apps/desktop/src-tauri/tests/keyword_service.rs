//! M1.5 关键词库服务集成测试（Plan C 第一个纵向切片）。
//!
//! 直调 service，不启 WebView；覆盖新增 / 列表 / 更新 / 删除与四类错误：
//! 项目不存在、空 drafts、空白文本、跨项目 id。

mod support;

use geo_domain::{
    ContentStatus, IntentCategory, KeywordDraft, KeywordId, KeywordKind, LibrarySource, ProjectId,
};
use support::{now, sample_draft, test_state, OfflineTransport};

use geo_desktop_lib::services::{KeywordService, ProjectService};

fn draft(text: &str) -> KeywordDraft {
    KeywordDraft {
        text: text.to_string(),
        kind: KeywordKind::Core,
        intent: IntentCategory::CategoryAwareness,
        priority: Some(3),
        note: None,
    }
}

#[tokio::test]
async fn add_then_list_roundtrips_with_positions_and_manual_defaults() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project = ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目");
    let service = KeywordService::from_state(&state);

    let added = service
        .add(
            project.id,
            vec![draft("  工业除尘器  "), draft("布袋除尘器厂家")],
            now(),
        )
        .await
        .expect("新增成功");
    assert_eq!(added.len(), 2);
    assert_eq!(added[0].text, "工业除尘器");
    assert_eq!(added[0].position, 0);
    assert_eq!(added[1].position, 1);
    assert!(added.iter().all(|item| item.source == LibrarySource::Manual
        && item.status == ContentStatus::Approved
        && item.monthly_volume.is_none()
        && item.difficulty.is_none()));

    let listed = service.list(project.id).await.expect("列表");
    assert_eq!(listed, added, "列表必须与新增返回逐字一致（含 position）");
}

#[tokio::test]
async fn add_is_all_or_nothing_when_one_draft_is_blank() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project = ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目");
    let service = KeywordService::from_state(&state);

    let error = service
        .add(project.id, vec![draft("有效词"), draft("   ")], now())
        .await
        .expect_err("空白文本必须整批拒绝");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(error.params["field"], "text");
    assert!(
        service.list(project.id).await.unwrap().is_empty(),
        "失败不得半批入库"
    );
}

#[tokio::test]
async fn add_rejects_empty_drafts() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project = ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目");
    let error = KeywordService::from_state(&state)
        .add(project.id, Vec::new(), now())
        .await
        .expect_err("空 drafts 必须报必填");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(error.params["field"], "drafts");
}

#[tokio::test]
async fn update_preserves_source_position_and_created_at() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project = ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目");
    let service = KeywordService::from_state(&state);
    let original = service
        .add(project.id, vec![draft("旧文本")], now())
        .await
        .expect("新增")
        .remove(0);

    let mut edited = original.clone();
    edited.text = "  新文本  ".to_string();
    edited.priority = 5;
    edited.status = ContentStatus::Rejected;
    edited.source = LibrarySource::Generated;
    edited.position = 99;
    let updated = service.update(edited, now()).await.expect("更新");

    assert_eq!(updated.text, "新文本");
    assert_eq!(updated.priority, 5);
    assert_eq!(updated.status, ContentStatus::Rejected);
    assert_eq!(
        updated.source,
        LibrarySource::Manual,
        "source 不允许被整行回传改掉"
    );
    assert_eq!(updated.position, original.position);
    let listed = service.list(project.id).await.expect("列表");
    assert_eq!(listed[0], updated);
}

#[tokio::test]
async fn update_unknown_or_cross_project_id_is_invalid_id() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let projects = ProjectService::new(state.pool.clone());
    let first = projects
        .create_draft(&sample_draft(), now())
        .await
        .expect("项目一");
    let mut other_draft = sample_draft();
    other_draft.brand_name = "另一个品牌".to_string();
    let second = projects
        .create_draft(&other_draft, now())
        .await
        .expect("项目二");
    let service = KeywordService::from_state(&state);
    let item = service
        .add(first.id, vec![draft("跨项目词")], now())
        .await
        .expect("新增")
        .remove(0);

    let mut forged = item.clone();
    forged.project_id = second.id;
    let error = service
        .update(forged, now())
        .await
        .expect_err("跨项目 id 必须拒绝");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(error.params["field"], "keyword_id");
    assert_eq!(error.params["reason"], "invalid_id");

    let mut missing = item.clone();
    missing.id = KeywordId::new();
    let error = service
        .update(missing, now())
        .await
        .expect_err("未知 id 必须拒绝");
    assert_eq!(error.params["field"], "keyword_id");
}

#[tokio::test]
async fn delete_is_idempotent_and_returns_remaining_snapshot() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project = ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目");
    let service = KeywordService::from_state(&state);
    let added = service
        .add(project.id, vec![draft("保留"), draft("删除")], now())
        .await
        .expect("新增");

    let remaining = service
        .delete(project.id, vec![added[1].id, added[1].id])
        .await
        .expect("删除");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].text, "保留");
    let again = service
        .delete(project.id, vec![added[1].id])
        .await
        .expect("重复删除");
    assert_eq!(again, remaining);
}

#[tokio::test]
async fn missing_project_is_project_not_found() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let service = KeywordService::from_state(&state);
    let error = service
        .list(ProjectId::new())
        .await
        .expect_err("未知项目必须报 project/not_found");
    assert_eq!(error.code, "project/not_found");
}

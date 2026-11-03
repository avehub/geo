//! M1.5 FAQ 库服务集成测试（Plan C 第二个纵向切片）。

mod support;

use geo_domain::{ContentStatus, FaqDraft, FaqId, IntentCategory, LibrarySource, ProjectId};
use support::{now, sample_draft, test_state, OfflineTransport};

use geo_desktop_lib::services::{FaqService, ProjectService};

fn draft(question: &str) -> FaqDraft {
    FaqDraft {
        question: question.to_string(),
        answer_markdown: "\n- 视压差而定\n- 一般 3~6 个月\n".to_string(),
        category: Some("售后".to_string()),
        intent: IntentCategory::AfterSalesReputation,
    }
}

async fn project(state: &geo_desktop_lib::state::AppState) -> geo_domain::ProjectId {
    ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目")
        .id
}

#[tokio::test]
async fn add_then_list_roundtrips_with_positions_and_manual_defaults() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = FaqService::from_state(&state);

    let added = service
        .add(
            project_id,
            vec![draft("  多久换滤芯？  "), draft("防爆证怎么办？")],
            now(),
        )
        .await
        .expect("新增");
    assert_eq!(added.len(), 2);
    assert_eq!(added[0].question, "多久换滤芯？");
    assert_eq!(added[0].position, 0);
    assert_eq!(added[1].position, 1);
    assert!(
        added
            .iter()
            .all(|item| item.source == LibrarySource::Manual
                && item.status == ContentStatus::Approved)
    );

    let listed = service.list(project_id).await.expect("列表");
    assert_eq!(listed, added);
}

#[tokio::test]
async fn add_is_all_or_nothing_when_question_or_answer_is_blank() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = FaqService::from_state(&state);

    let error = service
        .add(project_id, vec![draft("有效问题"), draft("   ")], now())
        .await
        .expect_err("空问题必须整批拒绝");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(error.params["field"], "question");

    let mut no_answer = draft("有效问题");
    no_answer.answer_markdown = "\n  \n".to_string();
    let error = service
        .add(project_id, vec![no_answer], now())
        .await
        .expect_err("空答案必须拒绝");
    assert_eq!(error.params["field"], "answer_markdown");
    assert!(
        service.list(project_id).await.unwrap().is_empty(),
        "失败不得入库"
    );
}

#[tokio::test]
async fn add_rejects_empty_drafts() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let error = FaqService::from_state(&state)
        .add(project_id, Vec::new(), now())
        .await
        .expect_err("空 drafts 必须报必填");
    assert_eq!(error.params["field"], "drafts");
}

#[tokio::test]
async fn update_preserves_source_position_and_created_at() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = FaqService::from_state(&state);
    let original = service
        .add(project_id, vec![draft("旧问题")], now())
        .await
        .expect("新增")
        .remove(0);

    let mut edited = original.clone();
    edited.question = "  新问题  ".to_string();
    edited.answer_markdown = "新答案".to_string();
    edited.status = ContentStatus::Rejected;
    edited.source = LibrarySource::Generated;
    edited.position = 99;
    let updated = service.update(edited, now()).await.expect("更新");
    assert_eq!(updated.question, "新问题");
    assert_eq!(updated.answer_markdown, "新答案");
    assert_eq!(updated.status, ContentStatus::Rejected);
    assert_eq!(updated.source, LibrarySource::Manual);
    assert_eq!(updated.position, original.position);
    assert_eq!(service.list(project_id).await.unwrap(), vec![updated]);
}

#[tokio::test]
async fn update_unknown_or_cross_project_id_is_invalid_id() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let first = project(&state).await;
    let mut other_draft = sample_draft();
    other_draft.brand_name = "另一个品牌".to_string();
    let second = ProjectService::new(state.pool.clone())
        .create_draft(&other_draft, now())
        .await
        .expect("项目二")
        .id;
    let service = FaqService::from_state(&state);
    let item = service
        .add(first, vec![draft("跨项目问题")], now())
        .await
        .expect("新增")
        .remove(0);

    let mut forged = item.clone();
    forged.project_id = second;
    let error = service
        .update(forged, now())
        .await
        .expect_err("跨项目 id 必须拒绝");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(error.params["field"], "faq_id");
    assert_eq!(error.params["reason"], "invalid_id");

    let mut missing = item;
    missing.id = FaqId::new();
    let error = service
        .update(missing, now())
        .await
        .expect_err("未知 id 必须拒绝");
    assert_eq!(error.params["field"], "faq_id");
}

#[tokio::test]
async fn delete_is_idempotent_and_returns_remaining_snapshot() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = FaqService::from_state(&state);
    let added = service
        .add(project_id, vec![draft("保留"), draft("删除")], now())
        .await
        .expect("新增");

    let remaining = service
        .delete(project_id, vec![added[1].id, added[1].id])
        .await
        .expect("删除");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].question, "保留");
    assert_eq!(
        service.delete(project_id, vec![added[1].id]).await.unwrap(),
        remaining
    );
}

#[tokio::test]
async fn missing_project_is_project_not_found() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = FaqService::from_state(&state)
        .list(ProjectId::new())
        .await
        .expect_err("未知项目必须报 project/not_found");
    assert_eq!(error.code, "project/not_found");
}

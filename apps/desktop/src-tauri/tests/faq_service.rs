//! M1.5 FAQ 库服务集成测试（Plan C 第二个纵向切片）。

mod support;

use geo_domain::{ContentStatus, FaqDraft, FaqId, IntentCategory, LibrarySource, ProjectId};
use support::{
    now, openai_response, sample_draft, state_with_bodies, test_state, OfflineTransport,
    ScriptedTransport,
};

use geo_desktop_lib::services::{FaqGenerateOptions, FaqService, ProjectService};

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

fn faq_json(items: &[(&str, &str, &str, &str)]) -> String {
    let items: Vec<serde_json::Value> = items
        .iter()
        .map(|(question, answer, category, intent)| {
            serde_json::json!({
                "question": question,
                "answer_markdown": answer,
                "category": category,
                "intent": intent,
            })
        })
        .collect();
    openai_response(&serde_json::json!({ "items": items }).to_string())
}

#[tokio::test]
async fn generate_persists_model_answers_as_pending_review() {
    let (state, _server, _secrets) = state_with_bodies(vec![faq_json(&[
        (
            "除尘器滤芯多久换一次？",
            "- 视压差而定\n- 一般 3~6 个月",
            "售后",
            "after_sales_reputation",
        ),
        (
            "防爆合格证怎么办？",
            "按设备类别向具备资质的机构申请。",
            "选型",
            "purchase_recommendation",
        ),
    ])])
    .await;
    let project_id = project(&state).await;
    let service = FaqService::from_state(&state);

    let created = service
        .generate(
            project_id,
            FaqGenerateOptions {
                intents: vec![
                    IntentCategory::AfterSalesReputation,
                    IntentCategory::PurchaseRecommendation,
                ],
                target_count: 5,
            },
            now(),
        )
        .await
        .expect("生成成功");
    assert_eq!(created.len(), 2);
    assert!(created
        .iter()
        .all(|item| item.source == LibrarySource::Generated
            && item.status == ContentStatus::PendingReview));
    assert_eq!(created[0].answer_markdown, "- 视压差而定\n- 一般 3~6 个月");
    assert_eq!(service.list(project_id).await.unwrap(), created);
}

#[tokio::test]
async fn generate_skips_questions_already_in_the_library() {
    let (state, _server, _secrets) = state_with_bodies(vec![faq_json(&[
        ("已有问题？", "新答案", "售后", "after_sales_reputation"),
        ("新问题？", "另一个答案", "售后", "after_sales_reputation"),
    ])])
    .await;
    let project_id = project(&state).await;
    let service = FaqService::from_state(&state);
    let mut existing = draft("已有问题？");
    existing.answer_markdown = "旧答案".to_string();
    service
        .add(project_id, vec![existing], now())
        .await
        .expect("预置");

    let created = service
        .generate(
            project_id,
            FaqGenerateOptions {
                intents: vec![IntentCategory::AfterSalesReputation],
                target_count: 5,
            },
            now(),
        )
        .await
        .expect("生成成功");
    assert_eq!(created.len(), 1);
    assert_eq!(created[0].question, "新问题？");
    assert_eq!(service.list(project_id).await.unwrap().len(), 2);
}

#[tokio::test]
async fn generate_rejects_compliance_violation_in_answer() {
    let (state, _server, _secrets) = state_with_bodies(vec![faq_json(&[(
        "选哪家？",
        "我们保证排名第一，效果最好。",
        "选型",
        "purchase_recommendation",
    )])])
    .await;
    let project_id = project(&state).await;
    let error = FaqService::from_state(&state)
        .generate(
            project_id,
            FaqGenerateOptions {
                intents: vec![IntentCategory::PurchaseRecommendation],
                target_count: 5,
            },
            now(),
        )
        .await
        .expect_err("命中红线词必须拒绝");
    assert_eq!(error.code, "compliance/violation");
    assert!(!error.params["terms"].is_empty());
}

#[tokio::test]
async fn generate_without_secret_is_missing_secret() {
    let (state, _server, _secrets) = test_state(ScriptedTransport::new(vec![faq_json(&[(
        "问题？",
        "答案",
        "售后",
        "after_sales_reputation",
    )])]))
    .await;
    let project_id = project(&state).await;
    let error = FaqService::from_state(&state)
        .generate(
            project_id,
            FaqGenerateOptions {
                intents: vec![IntentCategory::AfterSalesReputation],
                target_count: 5,
            },
            now(),
        )
        .await
        .expect_err("没有 Key 必须报 llm/missing_secret");
    assert_eq!(error.code, "llm/missing_secret");
}

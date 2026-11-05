//! `content_generate` / `site_patch_generate` 的模型生成集成测试（全程离线）。

mod support;

use geo_domain::{
    ActionBoard, ActionCategory, ActionItem, ActionLevel, ActionStatus, ContentStatus, EngineId,
    ProjectId, SiteChannelKind, SitePatchKind, SitePatchStatus,
};
use geo_store::DiagnosisRepo;
use support::{now, openai_response, sample_draft, state_with_bodies};

use geo_desktop_lib::services::{ActionService, ProjectService, SitePatchService};

async fn seed_board(state: &geo_desktop_lib::state::AppState) -> ProjectId {
    let project_id = ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目")
        .id;
    let board = ActionBoard {
        actions: vec![ActionItem {
            id: "action-1".to_string(),
            project_id: project_id.to_string(),
            round_id: "round-1".to_string(),
            category: ActionCategory::SiteStructure,
            rank: 1,
            title: "补齐产品页定义句".to_string(),
            rationale: "18 道题未提及".to_string(),
            impact: ActionLevel::High,
            difficulty: ActionLevel::Medium,
            owner_hint: "市场负责人".to_string(),
            deliverable: "定义句与参数表".to_string(),
            affected_prompt_count: 18,
            affected_engines: vec![EngineId::Doubao],
            evidence_issue_ids: Vec::new(),
            quick_win: true,
            status: ActionStatus::Todo,
            completed_at: None,
            updated_at: now(),
        }],
        attribution: Vec::new(),
        contents: Vec::new(),
        templates: Vec::new(),
    };
    DiagnosisRepo::new(state.pool.clone())
        .save_action_board(
            &project_id.to_string(),
            &serde_json::to_string(&board).unwrap(),
            &now().to_rfc3339(),
        )
        .await
        .expect("行动看板");
    project_id
}

fn content_body(title: &str, body: &str) -> String {
    openai_response(&serde_json::json!({ "title": title, "body_markdown": body }).to_string())
}

#[tokio::test]
async fn content_generate_produces_pending_review_markdown() {
    let (state, _server, _secrets) =
        state_with_bodies(vec![content_body("问答稿", "## 问题\n\n正文")]).await;
    let project_id = seed_board(&state).await;
    let content = ActionService::from_state(&state)
        .generate_content(
            project_id,
            "tpl-qa-article".to_string(),
            Some("action-1".to_string()),
        )
        .await
        .expect("生成文稿");
    assert_eq!(content.status, ContentStatus::PendingReview);
    assert!(content.compliance_checked);
    assert_eq!(content.action_id.as_deref(), Some("action-1"));
    assert_eq!(content.title, "问答稿");
    assert!(content.body_markdown.contains("正文"));
    assert!(!content.export_formats.is_empty());

    let board = ActionService::from_state(&state)
        .board(project_id)
        .await
        .expect("看板");
    assert_eq!(board.templates.len(), 7, "内置模板目录");
    assert_eq!(board.contents.len(), 1, "生成物进看板");
}

#[tokio::test]
async fn content_generate_rejects_absolute_wording() {
    let (state, _server, _secrets) = state_with_bodies(vec![content_body(
        "保证排名第一",
        "## 结论\n\n保证排名第一",
    )])
    .await;
    let project_id = seed_board(&state).await;
    let error = ActionService::from_state(&state)
        .generate_content(project_id, "tpl-qa-article".to_string(), None)
        .await
        .expect_err("红线词");
    assert_eq!(error.code, "compliance/violation");
}

#[tokio::test]
async fn content_generate_rejects_unknown_template_and_action() {
    let (state, _server, _secrets) = state_with_bodies(Vec::new()).await;
    let project_id = seed_board(&state).await;
    let service = ActionService::from_state(&state);
    let template_error = service
        .generate_content(project_id, "tpl-missing".to_string(), None)
        .await
        .expect_err("未知模板");
    assert_eq!(template_error.code, "validation/failed");
    assert_eq!(template_error.params["field"], "template_id");
    assert_eq!(template_error.params["reason"], "invalid_id");

    let action_error = service
        .generate_content(
            project_id,
            "tpl-qa-article".to_string(),
            Some("missing".to_string()),
        )
        .await
        .expect_err("未知处方");
    assert_eq!(action_error.params["field"], "action_id");
    assert_eq!(action_error.params["reason"], "invalid_id");
}

fn patches_body() -> String {
    openai_response(
        &serde_json::json!({
            "items": [
                {
                    "kind": "llms_txt",
                    "title": "上线 llms.txt",
                    "target_url": "/llms.txt",
                    "target_hint": "站点根目录",
                    "body": "User-agent: *\nAllow: /"
                },
                {
                    "kind": "jsonld",
                    "title": "补充 Organization 结构化数据",
                    "target_url": "/",
                    "target_hint": null,
                    "body": "{\"@context\":\"https://schema.org\",\"@type\":\"Organization\"}"
                }
            ]
        })
        .to_string(),
    )
}

#[tokio::test]
async fn site_patch_generate_creates_pending_drafts_and_is_idempotent() {
    let (state, _server, _secrets) = state_with_bodies(vec![patches_body(), patches_body()]).await;
    let project_id = seed_board(&state).await;
    let service = SitePatchService::from_state(&state);
    let created = service
        .generate(
            project_id,
            "action-1".to_string(),
            vec![SitePatchKind::LlmsTxt, SitePatchKind::Jsonld],
            now(),
        )
        .await
        .expect("生成补丁");
    assert_eq!(created.len(), 2);
    for patch in &created {
        assert_eq!(patch.status, SitePatchStatus::Draft);
        assert_eq!(patch.review_status, ContentStatus::PendingReview);
        assert_eq!(patch.source, geo_domain::LibrarySource::Generated);
        assert_eq!(patch.action_id.as_deref(), Some("action-1"));
        assert_eq!(patch.round_id, "round-1");
    }
    let llms = created
        .iter()
        .find(|patch| patch.kind == SitePatchKind::LlmsTxt)
        .expect("llms_txt");
    assert_eq!(llms.channel_kind, SiteChannelKind::Bundle);
    let jsonld = created
        .iter()
        .find(|patch| patch.kind == SitePatchKind::Jsonld)
        .expect("jsonld");
    assert_eq!(jsonld.channel_kind, SiteChannelKind::Cms);

    let again = service
        .generate(
            project_id,
            "action-1".to_string(),
            vec![SitePatchKind::LlmsTxt, SitePatchKind::Jsonld],
            now(),
        )
        .await
        .expect("再生成一次");
    assert!(again.is_empty(), "同 kind + target_url 必须跳过");
}

#[tokio::test]
async fn site_patch_generate_rejects_empty_kinds_and_unknown_action() {
    let (state, _server, _secrets) = state_with_bodies(Vec::new()).await;
    let project_id = seed_board(&state).await;
    let service = SitePatchService::from_state(&state);
    let empty = service
        .generate(project_id, "action-1".to_string(), Vec::new(), now())
        .await
        .expect_err("空 kinds");
    assert_eq!(empty.code, "validation/failed");
    assert_eq!(empty.params["field"], "kinds");
    assert_eq!(empty.params["reason"], "empty");

    let missing = service
        .generate(
            project_id,
            "missing".to_string(),
            vec![SitePatchKind::LlmsTxt],
            now(),
        )
        .await
        .expect_err("未知处方");
    assert_eq!(missing.params["field"], "action_id");
    assert_eq!(missing.params["reason"], "invalid_id");
}

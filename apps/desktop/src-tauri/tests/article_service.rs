//! Article Studio 服务集成测试：方向 → 模板 → 排期 → 文章。

mod support;

use geo_domain::{
    ArticleDirectionDraft, ArticleDirectionStatus, ArticleListQuery, ArticleReviewRequest,
    ArticleScheduleDraft, ArticleSource, ArticleStatus, ArticleTemplateBindings,
    ArticleTemplateDraft, ProjectId,
};
use support::{now, openai_response, sample_draft, state_with_bodies};

use geo_desktop_lib::services::{ArticleService, ProjectService};

async fn seed_project(state: &geo_desktop_lib::state::AppState) -> ProjectId {
    ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目")
        .id
}

async fn seed_direction(state: &geo_desktop_lib::state::AppState, project_id: ProjectId) -> String {
    ArticleService::from_state(state)
        .add_direction(
            project_id,
            ArticleDirectionDraft {
                title: Some("选型指南".to_string()),
                summary: Some("写给采购负责人".to_string()),
                ..ArticleDirectionDraft::default()
            },
            now(),
        )
        .await
        .expect("建方向")
        .id
}

fn template_draft(direction_id: &str) -> ArticleTemplateDraft {
    ArticleTemplateDraft {
        id: None,
        direction_id: direction_id.to_string(),
        name: "问答模板".to_string(),
        prompt_template: "介绍一下 {{brand}} 的 {{product}}，面向 {{audience}}。".to_string(),
        slots: vec![
            "brand".to_string(),
            "product".to_string(),
            "audience".to_string(),
        ],
        bindings: ArticleTemplateBindings {
            product_names: vec!["除尘器".to_string()],
            keyword_texts: vec!["工业除尘".to_string()],
            audience: Some("采购负责人".to_string()),
        },
        kb_modules: vec!["brand".to_string(), "product".to_string()],
        style: "专业".to_string(),
        length: 1_000,
    }
}

async fn seed_template(
    state: &geo_desktop_lib::state::AppState,
    project_id: ProjectId,
    direction_id: &str,
) -> String {
    ArticleService::from_state(state)
        .save_template(project_id, template_draft(direction_id), now())
        .await
        .expect("建模板")
        .id
}

#[tokio::test]
async fn direction_add_and_archive_round_trip() {
    let (state, _server, _secrets) = state_with_bodies(Vec::new()).await;
    let project_id = seed_project(&state).await;
    let direction_id = seed_direction(&state, project_id).await;
    let service = ArticleService::from_state(&state);
    let list = service.directions(project_id).await.expect("方向清单");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].status, ArticleDirectionStatus::Active);

    let archived = service
        .add_direction(
            project_id,
            ArticleDirectionDraft {
                id: Some(direction_id.clone()),
                status: Some("archived".to_string()),
                ..ArticleDirectionDraft::default()
            },
            now(),
        )
        .await
        .expect("归档");
    assert_eq!(archived.id, direction_id);
    assert_eq!(archived.status, ArticleDirectionStatus::Archived);
    assert_eq!(archived.title, "选型指南", "就地改不丢原字段");

    let missing = service
        .add_direction(
            project_id,
            ArticleDirectionDraft {
                id: Some("missing".to_string()),
                ..ArticleDirectionDraft::default()
            },
            now(),
        )
        .await
        .expect_err("未知方向");
    assert_eq!(missing.params["field"], "direction_id");
    assert_eq!(missing.params["reason"], "invalid_id");
}

#[tokio::test]
async fn generated_directions_dedupe_by_title() {
    let (state, _server, _secrets) = state_with_bodies(vec![openai_response(
        &serde_json::json!({
            "items": [
                { "title": "选型指南", "summary": "重复" },
                { "title": "安装维护", "summary": "写给设备科" }
            ]
        })
        .to_string(),
    )])
    .await;
    let project_id = seed_project(&state).await;
    seed_direction(&state, project_id).await;
    let created = ArticleService::from_state(&state)
        .generate_directions(project_id, 5)
        .await
        .expect("生成方向");
    assert_eq!(created.len(), 1, "同名方向必须跳过");
    assert_eq!(created[0].title, "安装维护");
    assert_eq!(
        created[0].source,
        geo_domain::ArticleDirectionSource::Generated
    );
}

#[tokio::test]
async fn template_save_updates_and_delete_cascades_schedules() {
    let (state, _server, _secrets) = state_with_bodies(Vec::new()).await;
    let project_id = seed_project(&state).await;
    let direction_id = seed_direction(&state, project_id).await;
    let service = ArticleService::from_state(&state);
    let template_id = seed_template(&state, project_id, &direction_id).await;

    let mut draft = template_draft(&direction_id);
    draft.id = Some(template_id.clone());
    draft.name = "改名后的模板".to_string();
    draft.length = 99_999;
    draft.slots = vec![
        "brand".to_string(),
        "brand".to_string(),
        "unknown".to_string(),
    ];
    let updated = service
        .save_template(project_id, draft, now())
        .await
        .expect("改模板");
    assert_eq!(updated.id, template_id);
    assert_eq!(updated.name, "改名后的模板");
    assert_eq!(updated.length, geo_domain::ARTICLE_LENGTH_MAX);
    assert_eq!(updated.slots.len(), 1, "未知槽位丢弃、重复去重");

    let schedule = service
        .save_schedule(
            project_id,
            ArticleScheduleDraft {
                id: None,
                template_id: template_id.clone(),
                freq: "daily".to_string(),
                time: "09:30".to_string(),
                weekday: None,
                enabled: true,
            },
            now(),
        )
        .await
        .expect("建排期");
    assert!(schedule.next_run_at.is_some());
    assert_eq!(schedule.run_count, 0);

    let remaining = service
        .delete_templates(project_id, vec![template_id])
        .await
        .expect("删模板");
    assert!(remaining.is_empty());
    assert!(
        service
            .schedules(project_id)
            .await
            .expect("排期")
            .is_empty(),
        "删模板连带删排期"
    );
}

#[tokio::test]
async fn schedule_validation_and_next_run() {
    let (state, _server, _secrets) = state_with_bodies(Vec::new()).await;
    let project_id = seed_project(&state).await;
    let direction_id = seed_direction(&state, project_id).await;
    let service = ArticleService::from_state(&state);
    let template_id = seed_template(&state, project_id, &direction_id).await;

    let weekly = service
        .save_schedule(
            project_id,
            ArticleScheduleDraft {
                id: None,
                template_id: template_id.clone(),
                freq: "weekly".to_string(),
                time: "09:30".to_string(),
                weekday: Some(7),
                enabled: true,
            },
            now(),
        )
        .await
        .expect("周更");
    let next = weekly.next_run_at.expect("下次运行");
    assert!(next > now());

    let disabled = service
        .save_schedule(
            project_id,
            ArticleScheduleDraft {
                id: None,
                template_id: template_id.clone(),
                freq: "daily".to_string(),
                time: "09:30".to_string(),
                weekday: Some(3),
                enabled: false,
            },
            now(),
        )
        .await
        .expect("停用");
    assert_eq!(disabled.weekday, None, "日更摘掉星期");
    assert_eq!(disabled.next_run_at, None);

    let bad_time = service
        .save_schedule(
            project_id,
            ArticleScheduleDraft {
                id: None,
                template_id: template_id.clone(),
                freq: "daily".to_string(),
                time: "25:00".to_string(),
                weekday: None,
                enabled: true,
            },
            now(),
        )
        .await
        .expect_err("非法时间");
    assert_eq!(bad_time.params["field"], "schedule_time");
    assert_eq!(bad_time.params["reason"], "invalid_format");

    let bad_weekday = service
        .save_schedule(
            project_id,
            ArticleScheduleDraft {
                id: None,
                template_id,
                freq: "weekly".to_string(),
                time: "09:30".to_string(),
                weekday: Some(9),
                enabled: true,
            },
            now(),
        )
        .await
        .expect_err("非法星期");
    assert_eq!(bad_weekday.params["field"], "schedule_weekday");
    assert_eq!(bad_weekday.params["reason"], "out_of_range");
}

#[tokio::test]
async fn schedule_run_generates_pending_article_and_accounts_once() {
    let (state, _server, _secrets) = state_with_bodies(vec![openai_response(
        &serde_json::json!({
            "title": "工业除尘器选型指南",
            "body_markdown": "## 结论\n\n按工况选型。"
        })
        .to_string(),
    )])
    .await;
    let project_id = seed_project(&state).await;
    let direction_id = seed_direction(&state, project_id).await;
    let service = ArticleService::from_state(&state);
    let template_id = seed_template(&state, project_id, &direction_id).await;
    let schedule = service
        .save_schedule(
            project_id,
            ArticleScheduleDraft {
                id: None,
                template_id: template_id.clone(),
                freq: "daily".to_string(),
                time: "09:30".to_string(),
                weekday: None,
                enabled: true,
            },
            now(),
        )
        .await
        .expect("排期");

    let created = service
        .run_schedule(project_id, Some(schedule.id.clone()), None, now())
        .await
        .expect("按排期跑");
    assert_eq!(created.len(), 1);
    assert_eq!(created[0].status, ArticleStatus::PendingReview);
    assert_eq!(created[0].source, ArticleSource::Scheduled);
    assert_eq!(
        created[0].schedule_id.as_deref(),
        Some(schedule.id.as_str())
    );
    assert!(created[0].word_count > 0);

    let schedules = service.schedules(project_id).await.expect("排期");
    assert_eq!(schedules[0].run_count, 1);
    assert!(schedules[0].last_run_at.is_some());

    let again = service
        .run_schedule(project_id, Some(schedule.id), None, now())
        .await
        .expect("再跑一次");
    assert!(again.is_empty(), "同标题必须跳过且不再记账");

    let manual = service
        .run_schedule(project_id, None, Some(template_id), now())
        .await
        .expect("模板立即生成");
    assert!(manual.is_empty(), "预置标题已存在");
}

#[tokio::test]
async fn article_list_reviews_and_filters() {
    let (state, _server, _secrets) = state_with_bodies(vec![openai_response(
        &serde_json::json!({
            "title": "评审用文章",
            "body_markdown": "## 正文\n\n内容"
        })
        .to_string(),
    )])
    .await;
    let project_id = seed_project(&state).await;
    let direction_id = seed_direction(&state, project_id).await;
    let service = ArticleService::from_state(&state);
    let template_id = seed_template(&state, project_id, &direction_id).await;
    let created = service
        .run_schedule(project_id, None, Some(template_id), now())
        .await
        .expect("生成");
    let article_id = created[0].id.clone();

    let pending = service
        .articles(
            project_id,
            ArticleListQuery {
                status: Some("pending_review".to_string()),
                review: None,
            },
        )
        .await
        .expect("待审");
    assert_eq!(pending.len(), 1);

    let approved = service
        .articles(
            project_id,
            ArticleListQuery {
                status: Some("all".to_string()),
                review: Some(ArticleReviewRequest {
                    ids: vec![article_id.clone(), "missing".to_string()],
                    status: "approved".to_string(),
                }),
            },
        )
        .await
        .expect("评审");
    assert_eq!(approved.len(), 1);
    assert_eq!(approved[0].status, ArticleStatus::Approved);

    let rejected_filter = service
        .articles(
            project_id,
            ArticleListQuery {
                status: Some("rejected".to_string()),
                review: None,
            },
        )
        .await
        .expect("筛选");
    assert!(rejected_filter.is_empty());

    let bad_status = service
        .articles(
            project_id,
            ArticleListQuery {
                status: None,
                review: Some(ArticleReviewRequest {
                    ids: vec![article_id],
                    status: "published".to_string(),
                }),
            },
        )
        .await
        .expect_err("非法评审状态");
    assert_eq!(bad_status.params["field"], "review_status");
    assert_eq!(bad_status.params["reason"], "not_allowed");
}

#[tokio::test]
async fn due_schedule_generates_article_and_advances_even_on_duplicate() {
    let (state, _server, _secrets) = state_with_bodies(vec![openai_response(
        &serde_json::json!({
            "title": "排期文章",
            "body_markdown": "## 正文\n\n内容"
        })
        .to_string(),
    )])
    .await;
    let project_id = seed_project(&state).await;
    let direction_id = seed_direction(&state, project_id).await;
    let service = ArticleService::from_state(&state);
    let template_id = seed_template(&state, project_id, &direction_id).await;
    let schedule = service
        .save_schedule(
            project_id,
            ArticleScheduleDraft {
                id: None,
                template_id,
                freq: "daily".to_string(),
                time: "09:30".to_string(),
                weekday: None,
                enabled: true,
            },
            now(),
        )
        .await
        .expect("排期");
    let past = now() - chrono::Duration::days(1);
    let make_due = |id: &str| {
        let pool = state.pool.clone();
        let id = id.to_string();
        async move {
            sqlx::query("UPDATE article_schedules SET next_run_at = ? WHERE id = ?")
                .bind(past.to_rfc3339_opts(chrono::SecondsFormat::Nanos, true))
                .bind(id)
                .execute(&pool)
                .await
                .expect("置为到点");
        }
    };
    make_due(&schedule.id).await;

    assert_eq!(service.run_due(now()).await.expect("调度"), 1);
    let articles = service
        .articles(
            project_id,
            ArticleListQuery {
                status: Some("all".to_string()),
                review: None,
            },
        )
        .await
        .expect("文章");
    assert_eq!(articles.len(), 1);
    assert_eq!(articles[0].status, ArticleStatus::PendingReview);
    let schedules = service.schedules(project_id).await.expect("排期");
    assert_eq!(schedules[0].run_count, 1);
    assert!(schedules[0].next_run_at > Some(now()));

    // 同一标题再跑：不新增文章，但排期继续推进，避免每分钟重试。
    make_due(&schedule.id).await;
    assert_eq!(service.run_due(now()).await.expect("重复调度"), 0);
    let schedules = service.schedules(project_id).await.expect("排期");
    assert_eq!(schedules[0].run_count, 2);
    assert!(schedules[0].next_run_at > Some(now()));
    let articles = service
        .articles(
            project_id,
            ArticleListQuery {
                status: Some("all".to_string()),
                review: None,
            },
        )
        .await
        .expect("文章");
    assert_eq!(articles.len(), 1);
}

#[tokio::test]
async fn article_commands_reject_unknown_parents() {
    let (state, _server, _secrets) = state_with_bodies(Vec::new()).await;
    let project_id = seed_project(&state).await;
    let service = ArticleService::from_state(&state);
    let error = service
        .save_template(project_id, template_draft("missing"), now())
        .await
        .expect_err("未知方向");
    assert_eq!(error.params["field"], "direction_id");
    assert_eq!(error.params["reason"], "invalid_id");

    let error = service
        .run_schedule(project_id, None, None, now())
        .await
        .expect_err("两者都没给");
    assert_eq!(error.params["field"], "schedule_id");
    assert_eq!(error.params["reason"], "required");
}

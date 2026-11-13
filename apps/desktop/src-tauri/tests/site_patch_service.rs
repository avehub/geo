//! M6.5 站点补丁台账服务集成测试（Plan C 第四切片第二段）。

mod support;

use geo_domain::{
    ContentStatus, ProjectId, SiteChannelKind, SitePatchDraft, SitePatchEventKind, SitePatchId,
    SitePatchKind, SitePatchStatus, SitePatchTransition,
};
use support::{now, sample_draft, test_state, OfflineTransport};

use geo_desktop_lib::services::{ProjectService, SitePatchService, SiteService};

fn draft() -> SitePatchDraft {
    SitePatchDraft {
        kind: SitePatchKind::LlmsTxt,
        title: "上线 llms.txt".to_string(),
        target_url: "/llms.txt".to_string(),
        target_hint: None,
        body: "User-agent: *".to_string(),
        channel_kind: SiteChannelKind::Bundle,
        action_id: None,
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
async fn add_creates_draft_with_created_event_and_board_includes_it() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SitePatchService::from_state(&state);
    let patch = service.add(project_id, draft(), now()).await.expect("新建");
    assert_eq!(patch.status, SitePatchStatus::Draft);
    assert_eq!(patch.review_status, ContentStatus::Approved);
    assert_eq!(patch.source, geo_domain::LibrarySource::Manual);
    assert!(patch.action_id.is_none());
    assert!(patch.round_id.is_empty(), "行动族未落 Rust 时归因留空");
    assert_eq!(patch.position, 0);

    let history = service.history(patch.id).await.expect("历史");
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].kind, SitePatchEventKind::Created);
    let board = SiteService::from_state(&state)
        .board(project_id)
        .await
        .unwrap();
    assert_eq!(board.patches, vec![patch]);
}

#[tokio::test]
async fn add_rejects_non_null_action_id() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let mut value = draft();
    value.action_id = Some("action-1".to_string());
    let error = SitePatchService::from_state(&state)
        .add(project_id, value, now())
        .await
        .expect_err("行动族未落 Rust 时不允许挂处方");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(error.params["field"], "action_id");
}

#[tokio::test]
async fn save_updates_editable_columns_and_keeps_immutable_state() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SitePatchService::from_state(&state);
    let patch = service.add(project_id, draft(), now()).await.expect("新建");

    let mut edited = patch.clone();
    edited.title = "  新标题  ".to_string();
    edited.body = "Disallow: /admin".to_string();
    edited.review_status = ContentStatus::PendingReview;
    edited.status = SitePatchStatus::Published; // 不应被 save 采纳
    edited.position = 99;
    let saved = service
        .save(edited, now() + chrono::Duration::seconds(5))
        .await
        .expect("保存");
    assert_eq!(saved.title, "新标题");
    assert_eq!(saved.body, "Disallow: /admin");
    assert_eq!(saved.review_status, ContentStatus::PendingReview);
    assert_eq!(
        saved.status,
        SitePatchStatus::Draft,
        "状态只能经 transition 改"
    );
    assert_eq!(saved.position, patch.position);
    assert_eq!(saved.created_at, patch.created_at);
    assert_eq!(service.history(patch.id).await.unwrap().len(), 2);
}

#[tokio::test]
async fn publish_requires_approval_and_snapshots_definition() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SitePatchService::from_state(&state);
    let patch = service.add(project_id, draft(), now()).await.expect("新建");

    let mut pending = patch.clone();
    pending.review_status = ContentStatus::PendingReview;
    let pending = service.save(pending, now()).await.expect("改为待审");
    let error = service
        .transition(pending.id, SitePatchTransition::Publish, now())
        .await
        .expect_err("待审补丁不能发布");
    assert_eq!(error.params["field"], "review_status");

    let mut approved = pending.clone();
    approved.review_status = ContentStatus::Approved;
    service.save(approved, now()).await.expect("审核通过");
    let published = service
        .transition(
            patch.id,
            SitePatchTransition::Publish,
            now() + chrono::Duration::seconds(10),
        )
        .await
        .expect("发布");
    assert_eq!(published.status, SitePatchStatus::Published);
    assert_eq!(published.published_body.as_deref(), Some("User-agent: *"));
    assert_eq!(published.published_kind, Some(SitePatchKind::LlmsTxt));
    assert_eq!(published.published_target_url.as_deref(), Some("/llms.txt"));
    assert_eq!(
        published.published_channel_kind,
        Some(SiteChannelKind::Bundle)
    );
    let history = service.history(patch.id).await.unwrap();
    assert_eq!(history.last().unwrap().kind, SitePatchEventKind::Published);
}

#[tokio::test]
async fn unpublish_is_idempotent_and_rollback_restores_snapshot() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SitePatchService::from_state(&state);
    let patch = service.add(project_id, draft(), now()).await.expect("新建");
    service
        .transition(patch.id, SitePatchTransition::Publish, now())
        .await
        .expect("发布");

    let mut edited = service
        .history(patch.id)
        .await
        .map(|_| patch.clone())
        .unwrap();
    edited.body = "改过的草案".to_string();
    edited.kind = SitePatchKind::RobotsTxt;
    edited.target_url = "/robots.txt".to_string();
    edited.channel_kind = SiteChannelKind::Cms;
    let edited = service.save(edited, now()).await.expect("保存草案");

    let rolled_back = service
        .transition(edited.id, SitePatchTransition::Rollback, now())
        .await
        .expect("回滚");
    assert_eq!(rolled_back.body, "User-agent: *");
    assert_eq!(rolled_back.kind, SitePatchKind::LlmsTxt);
    assert_eq!(rolled_back.target_url, "/llms.txt");
    assert_eq!(rolled_back.channel_kind, SiteChannelKind::Bundle);
    assert_eq!(
        rolled_back.status,
        SitePatchStatus::Published,
        "回滚不动状态"
    );

    let unpublished = service
        .transition(edited.id, SitePatchTransition::Unpublish, now())
        .await
        .expect("撤回");
    assert_eq!(unpublished.status, SitePatchStatus::Unpublished);
    assert!(unpublished.published_at.is_none());
    assert!(unpublished.published_body.is_some(), "撤回保留快照供回滚");
    let again = service
        .transition(edited.id, SitePatchTransition::Unpublish, now())
        .await
        .expect("重复撤回");
    assert_eq!(again, unpublished);
}

#[tokio::test]
async fn delete_rejects_published_then_reindexes_and_cascades_events() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SitePatchService::from_state(&state);
    let first = service
        .add(project_id, draft(), now())
        .await
        .expect("新建一");
    let second = service
        .add(project_id, draft(), now())
        .await
        .expect("新建二");
    service
        .transition(first.id, SitePatchTransition::Publish, now())
        .await
        .expect("发布");

    let error = service
        .delete(project_id, vec![first.id, second.id])
        .await
        .expect_err("已发布补丁必须拒删");
    assert_eq!(error.code, "state/conflict");
    assert_eq!(error.params["value"], "published");

    service
        .transition(first.id, SitePatchTransition::Unpublish, now())
        .await
        .expect("撤回");
    let remaining = service
        .delete(project_id, vec![first.id])
        .await
        .expect("删除");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, second.id);
    assert_eq!(remaining[0].position, 0);
    assert!(
        service.history(first.id).await.is_err(),
        "补丁删除后历史级联"
    );
}

#[tokio::test]
async fn history_unknown_id_is_invalid_id() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = SitePatchService::from_state(&state)
        .history(SitePatchId::new())
        .await
        .expect_err("未知 patch id 必须拒绝");
    assert_eq!(error.params["field"], "patch_id");
}

#[tokio::test]
async fn add_missing_project_is_project_not_found() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = SitePatchService::from_state(&state)
        .add(ProjectId::new(), draft(), now())
        .await
        .expect_err("未知项目必须报 project/not_found");
    assert_eq!(error.code, "project/not_found");
}

/// P2-09：手工录入的补丁同样是要下发到客户官网的**对外内容**，红线闸不能只装在
/// 生成路径上——否则「让模型生成」被拦、「自己敲进去」直通发布，是一条现成的绕过路径。
#[tokio::test]
async fn add_rejects_absolute_wording_in_manual_copy() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SitePatchService::from_state(&state);

    let mut in_title = draft();
    in_title.title = "保证排名第一的 llms.txt".to_string();
    let error = service
        .add(project_id, in_title, now())
        .await
        .expect_err("标题命中红线必须拒绝");
    assert_eq!(error.code, "compliance/violation", "{error}");
    assert!(
        error.params["terms"].contains("保证排名"),
        "terms 装命中的词：{:?}",
        error.params
    );

    let mut in_body = draft();
    in_body.body = "User-agent: *\n# 效果 100% 可见".to_string();
    let error = service
        .add(project_id, in_body, now())
        .await
        .expect_err("正文命中红线必须拒绝");
    assert_eq!(error.code, "compliance/violation", "{error}");
    assert!(
        error.params["terms"].contains("100%"),
        "terms 装命中的词：{:?}",
        error.params
    );

    assert!(
        service.list(project_id).await.expect("台账").is_empty(),
        "命中红线不得留下半条台账"
    );
}

/// 反面用例：正常文案必须照常新建，且保留「人工录入 = approved」的既有裁定。
#[tokio::test]
async fn add_keeps_clean_manual_copy_approved() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SitePatchService::from_state(&state);

    let mut value = draft();
    value.kind = SitePatchKind::MetaDescription;
    value.title = "首页 meta description 补企业与产品线".to_string();
    value.target_url = "/".to_string();
    value.target_hint = Some("首页 <head> 内".to_string());
    value.body = "宏宇泵业生产立式管道离心泵，覆盖楼宇二次供水与暖通循环场景。".to_string();
    value.channel_kind = SiteChannelKind::Cms;

    let patch = service.add(project_id, value, now()).await.expect("新建");
    assert_eq!(patch.review_status, ContentStatus::Approved);
    assert_eq!(patch.status, SitePatchStatus::Draft);
    assert_eq!(patch.source, geo_domain::LibrarySource::Manual);
    assert_eq!(
        service.list(project_id).await.expect("台账"),
        vec![patch],
        "干净文案照常落库"
    );
}

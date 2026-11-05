//! M6.5 站点档案与通道服务集成测试（Plan C 第四切片）。

mod support;

use geo_domain::{
    ProjectId, SiteChannelKind, SiteChannelStatus, SiteCredentialsState, SiteOwnership,
    SitePlatform,
};
use support::{now, sample_draft, test_state, OfflineTransport};

use geo_desktop_lib::services::{ProjectService, SiteService};

async fn project(state: &geo_desktop_lib::state::AppState) -> ProjectId {
    ProjectService::new(state.pool.clone())
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目")
        .id
}

#[tokio::test]
async fn board_projects_owned_pages_from_assets_and_starts_empty() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let board = SiteService::from_state(&state)
        .board(project_id)
        .await
        .expect("读 board");
    assert!(board.profile.is_none());
    assert!(board.channels.is_empty());
    assert!(board.patches.is_empty());
    assert!(board.pool.is_empty());
    // 建项向导登记官网 + 1 条核心页 ⇒ 2 个自有页面资产
    assert_eq!(board.pages.len(), 2);
    assert!(board.pages.iter().all(
        |page| page.role != geo_domain::SitePageRole::Other || page.url.contains("hongyu-pump")
    ));
}

#[tokio::test]
async fn profile_save_upserts_and_takes_domain_from_project() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SiteService::from_state(&state);
    let first = service
        .save_profile(
            project_id,
            SitePlatform::Custom,
            SiteOwnership::Agency,
            Some("  外包代管  ".to_string()),
            now(),
        )
        .await
        .expect("建档");
    assert_eq!(first.domain, "https://www.hongyu-pump.example");
    assert_eq!(first.note.as_deref(), Some("外包代管"));

    let second = service
        .save_profile(
            project_id,
            SitePlatform::Wordpress,
            SiteOwnership::Self_,
            None,
            now(),
        )
        .await
        .expect("更新");
    assert_eq!(second.id, first.id, "重复保存必须复用同一档案 id");
    assert_eq!(second.created_at, first.created_at);
    assert_eq!(second.platform, SitePlatform::Wordpress);
    assert_eq!(
        service.board(project_id).await.unwrap().profile,
        Some(second)
    );
}

#[tokio::test]
async fn channel_upsert_follows_kind_rules_and_keeps_one_row_per_kind() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SiteService::from_state(&state);

    let bundle = service
        .upsert_channel(
            project_id,
            SiteChannelKind::Bundle,
            Some("ignored".to_string()),
            Some("ignored".to_string()),
            None,
            now(),
        )
        .await
        .expect("落地包");
    assert_eq!(bundle.status, SiteChannelStatus::Ready);
    assert_eq!(bundle.credentials_state, SiteCredentialsState::NotRequired);
    assert!(bundle.endpoint.is_none(), "bundle 不收 endpoint");
    assert!(bundle.secret_ref.is_none());

    let cms = service
        .upsert_channel(
            project_id,
            SiteChannelKind::Cms,
            Some(" https://wp.example ".to_string()),
            Some(" editor ".to_string()),
            None,
            now(),
        )
        .await
        .expect("CMS");
    assert_eq!(cms.status, SiteChannelStatus::PendingVerify);
    assert_eq!(cms.credentials_state, SiteCredentialsState::Missing);
    assert_eq!(cms.endpoint.as_deref(), Some("https://wp.example"));
    assert_eq!(cms.username.as_deref(), Some("editor"));
    assert_eq!(
        cms.secret_ref.as_deref(),
        Some(format!("keyring://site/cms/{project_id}").as_str())
    );

    let again = service
        .upsert_channel(project_id, SiteChannelKind::Cms, None, None, None, now())
        .await
        .expect("再次更新");
    assert_eq!(again.id, cms.id, "同 kind 覆盖必须复用同一通道 id");
    assert_eq!(again.status, SiteChannelStatus::NotConfigured);
    let channels = service.board(project_id).await.unwrap().channels;
    assert_eq!(channels.len(), 2, "一个项目每条通道至多一行");
}

#[tokio::test]
async fn channel_remove_is_idempotent_and_returns_remaining_snapshot() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SiteService::from_state(&state);
    service
        .upsert_channel(project_id, SiteChannelKind::Bundle, None, None, None, now())
        .await
        .expect("落地包");
    service
        .upsert_channel(
            project_id,
            SiteChannelKind::Repo,
            Some("https://git.example/x".to_string()),
            None,
            None,
            now(),
        )
        .await
        .expect("仓库");
    let remaining = service
        .remove_channel(project_id, SiteChannelKind::Bundle)
        .await
        .expect("删除");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].kind, SiteChannelKind::Repo);
    assert_eq!(
        service
            .remove_channel(project_id, SiteChannelKind::Bundle)
            .await
            .unwrap(),
        remaining
    );
}

#[tokio::test]
async fn missing_project_is_project_not_found() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = SiteService::from_state(&state)
        .board(ProjectId::new())
        .await
        .expect_err("未知项目必须报 project/not_found");
    assert_eq!(error.code, "project/not_found");
}

#[tokio::test]
async fn channel_test_bundle_is_ready_and_creates_missing_row() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SiteService::from_state(&state);
    let tested = service
        .test_channel(project_id, SiteChannelKind::Bundle, now())
        .await
        .expect("自检");
    assert_eq!(tested.status, SiteChannelStatus::Ready);
    assert_eq!(tested.check_detail.unwrap().code, "site_bundle_ready");
    assert_eq!(service.board(project_id).await.unwrap().channels.len(), 1);
}

#[tokio::test]
async fn channel_test_cms_reports_configuration_and_credentials() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SiteService::from_state(&state);
    let missing = service
        .test_channel(project_id, SiteChannelKind::Cms, now())
        .await
        .expect("自检");
    assert_eq!(missing.status, SiteChannelStatus::NotConfigured);
    assert_eq!(
        missing.check_detail.unwrap().code,
        "site_cms_not_configured"
    );

    service
        .upsert_channel(
            project_id,
            SiteChannelKind::Cms,
            Some("https://wp.example".to_string()),
            Some("editor".to_string()),
            None,
            now(),
        )
        .await
        .expect("配置");
    let pending = service
        .test_channel(project_id, SiteChannelKind::Cms, now())
        .await
        .expect("自检");
    assert_eq!(pending.status, SiteChannelStatus::PendingVerify);
    let detail = pending.check_detail.unwrap();
    assert_eq!(detail.code, "site_credentials_missing");
    assert_eq!(detail.params.get("kind").map(String::as_str), Some("cms"));
}

#[tokio::test]
async fn channel_test_edge_probes_endpoint_and_maps_failures() {
    let (state, server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SiteService::from_state(&state);
    service
        .upsert_channel(
            project_id,
            SiteChannelKind::Edge,
            Some(server.uri()),
            None,
            None,
            now(),
        )
        .await
        .expect("配置");
    let ready = service
        .test_channel(project_id, SiteChannelKind::Edge, now())
        .await
        .expect("自检");
    assert_eq!(ready.status, SiteChannelStatus::Ready);
    assert_eq!(ready.check_detail.unwrap().code, "site_reachable");

    service
        .upsert_channel(
            project_id,
            SiteChannelKind::Edge,
            Some(format!("{}/missing", server.uri())),
            None,
            None,
            now(),
        )
        .await
        .expect("配置坏地址");
    let failed = service
        .test_channel(project_id, SiteChannelKind::Edge, now())
        .await
        .expect("自检");
    assert_eq!(failed.status, SiteChannelStatus::Failed);
    assert_eq!(failed.check_detail.unwrap().code, "site_unreachable");
}

#[tokio::test]
async fn channel_test_repo_with_endpoint_is_pending_manual_check() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project_id = project(&state).await;
    let service = SiteService::from_state(&state);
    service
        .upsert_channel(
            project_id,
            SiteChannelKind::Repo,
            Some("https://git.example/x".to_string()),
            None,
            None,
            now(),
        )
        .await
        .expect("配置");
    let tested = service
        .test_channel(project_id, SiteChannelKind::Repo, now())
        .await
        .expect("自检");
    assert_eq!(tested.status, SiteChannelStatus::PendingVerify);
    assert_eq!(tested.check_detail.unwrap().code, "site_repo_manual_check");
}

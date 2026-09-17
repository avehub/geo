//! M1 项目服务集成测试：建项、过滤、归档、竞品/资产、导入导出往返。
//!
//! 全部直调 service（不启 WebView），离线运行（见 `support/mod.rs`）。

mod support;

use geo_domain::{AssetKind, CompetitorDraft, CompetitorId, Industry, Language, ProjectDraft};
use geo_store::ProjectFilter;
use support::{now, sample_draft, seeded_project, test_state, OfflineTransport};

use geo_desktop_lib::services::ProjectService;

fn service(state: &geo_desktop_lib::state::AppState) -> ProjectService {
    ProjectService::new(state.pool.clone())
}

#[tokio::test]
async fn create_draft_persists_the_whole_project_graph() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let svc = service(&state);

    let project = svc
        .create_draft(&sample_draft(), now())
        .await
        .expect("建项目成功");
    let detail = svc.detail(project.id).await.expect("项目详情可读");

    assert_eq!(detail.project.brand_name, "宏宇泵业");
    assert_eq!(detail.project.name, "宏宇泵业 GEO 项目");
    assert_eq!(detail.competitors.len(), 3);
    assert_eq!(detail.competitors[0].name, "南方泵业");
    // 官网 + 1 条核心页 → 2 个自有页面资产
    assert_eq!(detail.assets.len(), 2);
    assert!(detail
        .assets
        .iter()
        .all(|asset| asset.kind == AssetKind::OwnedPage));
    assert_eq!(detail.prompt_set_count, 0);

    // 建项即建档：向导里已填的产品与地域直接进实体卡，状态为官方口径
    let card = detail.entity_card.expect("建项后应有初始实体卡");
    assert_eq!(card.fields.standard_name, "宏宇泵业");
    assert_eq!(card.fields.products.len(), 2);
    assert!(card.fields.service_regions.contains(&"上海".to_string()));
    assert_eq!(
        card.field_status.get("standard_name").map(|s| s.label_zh()),
        Some("官方口径")
    );
}

#[tokio::test]
async fn create_draft_rejects_an_empty_brand_name() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let mut draft = sample_draft();
    draft.brand_name = "   ".to_string();

    let error = service(&state)
        .create_draft(&draft, now())
        .await
        .expect_err("空品牌名必须被拒绝");
    assert_eq!(error.code, "validation/failed");
    assert!(error.message.contains("brand_name"));
}

#[tokio::test]
async fn list_filters_by_keyword_and_archive_state() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let svc = service(&state);
    let pump = svc.create_draft(&sample_draft(), now()).await.unwrap();

    let mut saas = sample_draft();
    saas.brand_name = "云枢 SaaS".to_string();
    saas.industry = Industry::EnterpriseSaas;
    saas.language = Language::ZhCn;
    saas.competitors.truncate(3);
    let saas_project = svc.create_draft(&saas, now()).await.unwrap();

    let active = svc.list(&ProjectFilter::default()).await.unwrap();
    assert_eq!(active.len(), 2);

    let searched = svc
        .list(&ProjectFilter {
            query: Some("云枢".to_string()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(searched.len(), 1);
    assert_eq!(searched[0].id, saas_project.id);

    svc.archive(pump.id, true, now()).await.unwrap();
    assert_eq!(svc.list(&ProjectFilter::default()).await.unwrap().len(), 1);

    let with_archived = svc
        .list(&ProjectFilter {
            include_archived: true,
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(with_archived.len(), 2);
    let archived = with_archived
        .iter()
        .find(|project| project.id == pump.id)
        .expect("归档项目仍在列表里");
    assert!(archived.is_archived());
    assert_eq!(archived.archived_at, Some(now()));
}

#[tokio::test]
async fn archive_can_be_reversed_and_delete_cascades() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let svc = service(&state);
    let project = seeded_project(&state).await;

    let archived = svc.archive(project.id, true, now()).await.unwrap();
    assert!(archived.is_archived());
    let restored = svc.archive(project.id, false, now()).await.unwrap();
    assert!(!restored.is_archived());
    assert_eq!(restored.archived_at, None);

    svc.delete(project.id).await.unwrap();
    let error = svc.detail(project.id).await.expect_err("已删除");
    assert_eq!(error.code, "project/not_found");
    // 竞品随项目级联删除
    let competitors = svc.list_competitors(project.id).await.unwrap();
    assert!(competitors.is_empty());
}

#[tokio::test]
async fn update_persists_fields_and_moves_updated_at_forward() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let svc = service(&state);
    let mut project = seeded_project(&state).await;

    project.region = "长三角".to_string();
    project.tags = vec!["水泵".to_string(), "制造业".to_string()];
    let later = now() + chrono::Duration::seconds(30);
    let updated = svc.update(&project, later).await.unwrap();

    assert_eq!(updated.region, "长三角");
    assert_eq!(updated.tags.len(), 2);
    assert_eq!(updated.updated_at, later);
    assert_eq!(updated.created_at, project.created_at);
    let reloaded = svc.detail(project.id).await.unwrap();
    assert_eq!(reloaded.project.region, "长三角");
}

#[tokio::test]
async fn update_rejects_a_blank_brand_name() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let svc = service(&state);
    let mut project = seeded_project(&state).await;
    project.brand_name = " ".to_string();

    let error = svc.update(&project, now()).await.expect_err("必须校验");
    assert_eq!(error.code, "validation/failed");
}

#[tokio::test]
async fn export_then_import_round_trips_with_new_ids() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let svc = service(&state);
    let project = seeded_project(&state).await;

    let exported = svc.export_json(project.id, now()).await.unwrap();
    assert_eq!(exported.format_version, "geo-project-export-v1");
    assert_eq!(exported.competitors.len(), 3);
    assert_eq!(exported.assets.len(), 2);
    assert!(exported.entity_card.is_some());

    let payload = serde_json::to_string(&exported).unwrap();
    let report = svc.import_json(&payload, now()).await.unwrap();

    assert_ne!(report.project_id, project.id);
    assert_eq!(report.counts["competitors"], 3);
    assert_eq!(report.counts["assets"], 2);
    assert_eq!(report.counts["entity_cards"], 1);

    let imported = svc.detail(report.project_id).await.unwrap();
    assert_eq!(imported.project.brand_name, exported.project.brand_name);
    assert_eq!(imported.project.aliases, exported.project.aliases);
    assert_eq!(imported.project.industry, exported.project.industry);
    assert_ne!(imported.project.id, exported.project.id);
    assert_eq!(imported.competitors.len(), 3);
    assert_eq!(
        imported.competitors[0].name,
        exported.competitors[0].name.clone()
    );
    assert!(imported.competitors.iter().all(|competitor| !exported
        .competitors
        .iter()
        .any(|old| old.id == competitor.id)));
    let card = imported.entity_card.expect("实体卡随导出一起回来");
    assert_eq!(card.project_id, report.project_id);
    assert_eq!(
        card.fields.products.len(),
        exported.entity_card.unwrap().fields.products.len()
    );
}

#[tokio::test]
async fn import_rejects_a_payload_that_is_not_a_project_export() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = service(&state)
        .import_json("{\"brand_name\":\"x\"}", now())
        .await
        .expect_err("结构不符必须报错");
    assert_eq!(error.code, "validation/failed");
}

#[tokio::test]
async fn competitor_upsert_updates_in_place_and_caps_at_five() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let svc = service(&state);
    let project = seeded_project(&state).await;

    let existing = svc.list_competitors(project.id).await.unwrap();
    let updated = svc
        .upsert_competitor(
            project.id,
            &CompetitorDraft {
                name: "南方泵业（改名）".to_string(),
                aliases: vec!["CNP".to_string()],
                website: None,
                note: Some("已更新".to_string()),
            },
            Some(existing[0].id),
            now(),
        )
        .await
        .unwrap();
    assert_eq!(updated.id, existing[0].id);
    assert_eq!(updated.position, existing[0].position);
    assert_eq!(svc.list_competitors(project.id).await.unwrap().len(), 3);

    for name in ["第四家", "第五家"] {
        svc.upsert_competitor(
            project.id,
            &CompetitorDraft {
                name: name.to_string(),
                ..Default::default()
            },
            None,
            now(),
        )
        .await
        .unwrap();
    }
    assert_eq!(svc.list_competitors(project.id).await.unwrap().len(), 5);

    let error = svc
        .upsert_competitor(
            project.id,
            &CompetitorDraft {
                name: "第六家".to_string(),
                ..Default::default()
            },
            None,
            now(),
        )
        .await
        .expect_err("竞品上限 5 家");
    assert_eq!(error.code, "validation/failed");
    assert!(error.message.contains("competitors"));
}

#[tokio::test]
async fn competitor_reorder_rewrites_positions_in_the_given_order() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let svc = service(&state);
    let project = seeded_project(&state).await;
    let before = svc.list_competitors(project.id).await.unwrap();
    let reversed: Vec<_> = before.iter().rev().map(|item| item.id).collect();

    let after = svc
        .reorder_competitors(project.id, &reversed)
        .await
        .unwrap();
    assert_eq!(
        after.iter().map(|item| item.id).collect::<Vec<_>>(),
        reversed
    );
    assert_eq!(
        after.iter().map(|item| item.position).collect::<Vec<_>>(),
        vec![0, 1, 2]
    );

    let foreign = CompetitorId::new();
    let error = svc
        .reorder_competitors(project.id, &[foreign])
        .await
        .expect_err("不属于该项目的竞品必须报错");
    assert_eq!(error.code, "competitor/not_found");
}

#[tokio::test]
async fn asset_add_validates_the_url_and_lists_by_project() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let svc = service(&state);
    let project = seeded_project(&state).await;

    let zhihu = svc
        .add_asset(
            project.id,
            AssetKind::Zhihu,
            "https://www.zhihu.com/org/hongyu".to_string(),
            Some("知乎机构号".to_string()),
            None,
            now(),
        )
        .await
        .unwrap();
    assert_eq!(zhihu.kind, AssetKind::Zhihu);
    assert_eq!(svc.list_assets(project.id).await.unwrap().len(), 3);

    let error = svc
        .add_asset(
            project.id,
            AssetKind::Baike,
            "不是网址".to_string(),
            None,
            None,
            now(),
        )
        .await
        .expect_err("非法 URL 必须被拒绝");
    assert_eq!(error.code, "validation/failed");

    svc.delete_asset(zhihu.id).await.unwrap();
    assert_eq!(svc.list_assets(project.id).await.unwrap().len(), 2);
}

#[tokio::test]
async fn project_draft_defaults_are_applied_on_create() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let draft = ProjectDraft {
        brand_name: "  稿得快  ".to_string(),
        website: Some("gaodekuai.example".to_string()),
        ..Default::default()
    };
    let project = service(&state)
        .create_draft(&draft, now())
        .await
        .expect("最简草稿也能建项");
    assert_eq!(project.brand_name, "稿得快");
    assert_eq!(project.name, "稿得快");
    assert_eq!(project.region, "全国");
    assert_eq!(
        project.website.as_deref(),
        Some("https://gaodekuai.example"),
        "缺协议时补 https"
    );
}

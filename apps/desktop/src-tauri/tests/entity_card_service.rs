//! M1 自动建档集成测试：抓夹具站 → 结构化抽取 → 实体卡 + 修订留痕 + 降级路径。
//!
//! 离线保证：站点由 wiremock 回放 `fixtures/http/`，模型由脚本传输回放 `fixtures/llm/`。

mod support;

use geo_domain::FieldStatus;
use geo_llm::LlmProvider;
use serde_json::json;
use support::{
    entity_card_state, llm_bodies, now, seeded_project, state_with_transport, state_without_secret,
    test_state, OfflineTransport, ScriptedTransport,
};

use geo_desktop_lib::services::{EntityCardService, ProjectService};

#[tokio::test]
async fn autobuild_extracts_a_high_completeness_card_from_the_fixture_site() {
    let (state, server, _secrets) = entity_card_state().await;
    let project = seeded_project(&state).await;
    let svc = EntityCardService::from_state(&state);

    let card = svc
        .autobuild(project.id, &server.uri(), now())
        .await
        .expect("自动建档成功");

    assert!(
        card.completeness >= 0.8,
        "fixture 站点字段完整率应 ≥80%，实际 {}",
        card.completeness
    );
    assert_eq!(card.fields.standard_name, "宏宇泵业");
    assert!(card.fields.founded_year.is_some());
    assert!(!card.fields.qualifications.is_empty());
    assert!(!card.fields.products.is_empty());
    assert!(card
        .fields
        .contact
        .as_ref()
        .is_some_and(|c| c.is_meaningful()));

    // 来源留痕：哪几页 + 哪个模型
    assert_eq!(
        card.source.llm_provider.as_deref(),
        Some(LlmProvider::DeepSeek.as_str()),
        "来源要记录规范化的 provider 标识"
    );
    assert!(card
        .source
        .llm_model
        .as_ref()
        .is_some_and(|m| !m.is_empty()));
    assert_eq!(card.source.generated_at, Some(now()));
    assert!(
        !card.source.crawled_pages.is_empty(),
        "必须记录抓到的页面，供人工复核"
    );
    assert!(card
        .source
        .crawled_pages
        .iter()
        .all(|page| page.starts_with(server.uri().trim_end_matches('/'))));

    // AI 抽取的字段一律「待确认」，不得直接当官方口径
    assert!(card.pending_fields().len() >= 8);
    assert_eq!(card.status_of("standard_name"), FieldStatus::Pending);

    // 落库：再读一次是同一张卡
    let stored = svc.get(project.id).await.unwrap().expect("已落库");
    assert_eq!(stored.fields, card.fields);
    assert_eq!(stored.completeness, card.completeness);
}

#[tokio::test]
async fn autobuild_prompt_contains_site_text_and_brand() {
    let transport = ScriptedTransport::new(llm_bodies("entity_card"));
    let (state, server, _secrets) = state_with_transport(transport.clone()).await;
    let project = seeded_project(&state).await;

    EntityCardService::from_state(&state)
        .autobuild(project.id, &server.uri(), now())
        .await
        .expect("自动建档成功");

    assert_eq!(transport.request_count(), 1);
    let body: serde_json::Value =
        serde_json::from_str(&transport.requests()[0].body).expect("请求体是 JSON");
    let prompt = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|message| message["content"].as_str().unwrap_or_default().to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(prompt.contains("宏宇泵业"), "提示词要带品牌名");
    assert!(
        prompt.contains("HY-ISG") || prompt.contains("离心泵"),
        "提示词要带抓到的正文素材，实际长度 {}",
        prompt.chars().count()
    );
    assert!(
        body["response_format"]["type"] == json!("json_object"),
        "必须要求结构化输出"
    );
}

#[tokio::test]
async fn autobuild_repairs_invalid_model_output_with_exactly_one_retry() {
    let transport = ScriptedTransport::new(llm_bodies("entity_card_invalid_then_ok"));
    let (state, server, _secrets) = state_with_transport(transport.clone()).await;
    let project = seeded_project(&state).await;

    let card = EntityCardService::from_state(&state)
        .autobuild(project.id, &server.uri(), now())
        .await
        .expect("修复重试后应成功");

    assert_eq!(transport.request_count(), 2, "只允许追问一次");
    assert!(card.completeness >= 0.8);
    let retry_body: serde_json::Value =
        serde_json::from_str(&transport.requests()[1].body).expect("第二次请求体是 JSON");
    let messages = retry_body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 3, "追问会追加一条 user 消息");
    assert!(messages[2]["content"]
        .as_str()
        .unwrap()
        .contains("上一次的输出无法使用"));
}

#[tokio::test]
async fn autobuild_degrades_to_a_pending_card_when_the_model_is_unavailable() {
    let transport = OfflineTransport::new();
    let (state, server, _secrets) = state_with_transport(transport.clone()).await;
    let project = seeded_project(&state).await;
    let svc = EntityCardService::from_state(&state);

    let card = svc
        .autobuild(project.id, &server.uri(), now())
        .await
        .expect("LLM 不可用时降级而不是报错");

    assert_eq!(card.source.llm_provider, None, "降级卡不得声称是模型产出");
    assert_eq!(card.fields.standard_name, "宏宇泵业");
    assert_eq!(card.fields.products.len(), 2, "建项时填的产品线要保留");
    assert!(card.fields.service_regions.contains(&"上海".to_string()));
    assert!(!card.pending_fields().is_empty());
    assert!(!card.source.crawled_pages.is_empty(), "抓取结果仍要留痕");
    assert!(transport.call_count() >= 1);
}

#[tokio::test]
async fn autobuild_degrades_when_no_api_key_is_configured() {
    let (state, server, _secrets) = state_without_secret().await;
    let project = seeded_project(&state).await;

    let card = EntityCardService::from_state(&state)
        .autobuild(project.id, &server.uri(), now())
        .await
        .expect("没配 Key 也要能出待确认卡");

    assert_eq!(card.source.llm_provider, None);
    assert!(card.completeness < 0.8, "降级卡完整率必然偏低");
    assert!(card.completeness > 0.0, "建项资料至少撑起几项字段");
}

#[tokio::test]
async fn autobuild_reports_an_empty_site_as_a_readable_error() {
    let (state, server, _secrets) = support::empty_site_state().await;
    let project = seeded_project(&state).await;

    let error = EntityCardService::from_state(&state)
        .autobuild(project.id, &server.uri(), now())
        .await
        .expect_err("抓不到页面必须报错");
    assert_eq!(error.code, "crawler/empty");
    assert!(error.message.contains("未能抓到任何页面"));
}

#[tokio::test]
async fn autobuild_rejects_a_domain_that_is_not_a_url() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project = seeded_project(&state).await;

    let error = EntityCardService::from_state(&state)
        .autobuild(project.id, "这不是域名", now())
        .await
        .expect_err("非法域名必须被拒绝");
    assert_eq!(error.code, "validation/failed");
    assert!(error.message.contains("domain"));
}

#[tokio::test]
async fn autobuild_never_touches_a_foreign_host() {
    // 项目资产里有 hongyu-pump.example 的页面，抓取只能发生在传入的 origin 上
    let (state, server, _secrets) = entity_card_state().await;
    let project = seeded_project(&state).await;

    let card = EntityCardService::from_state(&state)
        .autobuild(project.id, &server.uri(), now())
        .await
        .unwrap();

    let origin = server.uri().trim_end_matches('/').to_string();
    assert!(card
        .source
        .crawled_pages
        .iter()
        .all(|page| page.starts_with(&origin)));
}

#[tokio::test]
async fn update_field_writes_a_revision_and_recomputes_completeness() {
    let (state, server, _secrets) = entity_card_state().await;
    let project = seeded_project(&state).await;
    let svc = EntityCardService::from_state(&state);
    let before = svc
        .autobuild(project.id, &server.uri(), now())
        .await
        .unwrap();

    let revision = svc
        .update_field(
            project.id,
            "price_range",
            json!("1,800～65,000 元/台（已核对报价单）"),
            FieldStatus::Official,
            Some("销售确认".to_string()),
            now() + chrono::Duration::seconds(60),
        )
        .await
        .expect("字段级编辑成功");

    assert_eq!(revision.field_path, "price_range");
    assert_eq!(revision.status, FieldStatus::Official);
    assert_eq!(revision.note.as_deref(), Some("销售确认"));
    assert_eq!(
        revision.old_value,
        before.fields.price_range.map(|value| json!(value))
    );
    assert_eq!(revision.project_id, project.id);

    let after = svc.get(project.id).await.unwrap().unwrap();
    assert_eq!(
        after.fields.price_range.as_deref(),
        Some("1,800～65,000 元/台（已核对报价单）")
    );
    assert_eq!(after.status_of("price_range"), FieldStatus::Official);
    assert!(after.completeness >= before.completeness);
    assert_eq!(after.updated_at, now() + chrono::Duration::seconds(60));

    let revisions = svc.revisions(project.id).await.unwrap();
    assert_eq!(revisions.len(), 1);
    assert_eq!(revisions[0].id, revision.id);
}

#[tokio::test]
async fn update_field_supports_nested_paths_and_rejects_unknown_ones() {
    let (state, server, _secrets) = entity_card_state().await;
    let project = seeded_project(&state).await;
    let svc = EntityCardService::from_state(&state);
    svc.autobuild(project.id, &server.uri(), now())
        .await
        .unwrap();

    svc.update_field(
        project.id,
        "products[0].name",
        json!("HY-ISG 立式管道离心泵（已核对）"),
        FieldStatus::Official,
        None,
        now(),
    )
    .await
    .expect("嵌套路径可编辑");
    let card = svc.get(project.id).await.unwrap().unwrap();
    assert_eq!(
        card.fields.products[0].name,
        "HY-ISG 立式管道离心泵（已核对）"
    );

    let error = svc
        .update_field(
            project.id,
            "not_a_field",
            json!("x"),
            FieldStatus::Official,
            None,
            now(),
        )
        .await
        .expect_err("未知字段必须报错");
    assert_eq!(error.code, "validation/failed");
}

#[tokio::test]
async fn update_field_on_a_project_without_a_card_reports_not_found() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let project = ProjectService::new(state.pool.clone())
        .create_draft(&support::sample_draft(), now())
        .await
        .unwrap();
    // 建项会种一张初始卡，这里显式删掉，模拟「还没建档」
    sqlx::query("DELETE FROM entity_cards WHERE project_id = ?")
        .bind(project.id.to_string())
        .execute(&state.pool)
        .await
        .unwrap();

    let error = EntityCardService::from_state(&state)
        .update_field(
            project.id,
            "standard_name",
            json!("x"),
            FieldStatus::Official,
            None,
            now(),
        )
        .await
        .expect_err("没有卡就不能编辑字段");
    assert_eq!(error.code, "entity_card/not_found");
    assert!(EntityCardService::from_state(&state)
        .get(project.id)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn rebuild_keeps_human_confirmed_fields_official() {
    let (state, server, _secrets) = entity_card_state().await;
    let project = seeded_project(&state).await;
    let svc = EntityCardService::from_state(&state);
    svc.autobuild(project.id, &server.uri(), now())
        .await
        .unwrap();
    svc.update_field(
        project.id,
        "standard_name",
        json!("宏宇泵业（工商全称：上海宏宇水泵制造有限公司）"),
        FieldStatus::Official,
        Some("已核对营业执照".to_string()),
        now(),
    )
    .await
    .unwrap();

    let rebuilt = svc
        .autobuild(
            project.id,
            &server.uri(),
            now() + chrono::Duration::minutes(5),
        )
        .await
        .expect("可以重复建档");

    assert_eq!(
        rebuilt.status_of("standard_name"),
        FieldStatus::Official,
        "人工确认过的字段不能被模型覆盖成待确认"
    );
    assert_eq!(
        rebuilt.fields.standard_name,
        "宏宇泵业（工商全称：上海宏宇水泵制造有限公司）"
    );
    assert_eq!(rebuilt.status_of("products"), FieldStatus::Pending);
    assert_eq!(rebuilt.created_at, now(), "首次建档时间保持不变");
    assert_eq!(rebuilt.updated_at, now() + chrono::Duration::minutes(5));
    assert_eq!(
        svc.revisions(project.id).await.unwrap().len(),
        1,
        "重建不产生修订，修订只来自人工编辑"
    );
}

#[tokio::test]
async fn autobuild_never_leaks_the_api_key() {
    let transport = ScriptedTransport::new(vec![support::openai_response(&format!(
        "鉴权失败：{} 无效",
        support::TEST_API_KEY
    ))]);
    let (state, server, _secrets) = state_with_transport(transport).await;
    let project = seeded_project(&state).await;

    // 模型返回的不是实体卡 JSON → 修复重试后仍失败 → 降级
    let card = EntityCardService::from_state(&state)
        .autobuild(project.id, &server.uri(), now())
        .await
        .expect("降级成功");
    assert_eq!(card.source.llm_provider, None);

    let detail = ProjectService::new(state.pool.clone())
        .detail(project.id)
        .await
        .unwrap();
    let serialized = serde_json::to_string(&detail).unwrap();
    assert!(
        !serialized.contains(support::TEST_API_KEY),
        "密钥不得出现在任何返回体里"
    );
}

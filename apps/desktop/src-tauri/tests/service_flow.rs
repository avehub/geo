//! 全链路集成测试 + 设置/密钥服务。
//!
//! 覆盖 plan Task 24 的两组断言：
//! 1. 设置与密钥：读写一致、`secret_status` 只给引用不给值、无 Key 时
//!    `provider_test` 返回 `llm/missing_secret`（前端据此引导用户填 Key）；
//! 2. 全链路：建项目 → 自动建档 → 生成题库 → 导出 CSV，
//!    对齐 spec S1 的 Go/No-Go（≥60 条、7 类意图、重复对 0、字段完整率 ≥0.8）。
//!
//! 红线：全程离线。HTTP 由 wiremock 回放 `fixtures/http/`，LLM 由脚本传输
//! 回放 `fixtures/llm/`。

mod support;

use std::sync::Arc;

use geo_domain::{dedupe, Industry, IntentCategory, SUFFICIENT_SAMPLE_SIZE};
use geo_llm::LlmProvider;
use geo_store::{
    AppSettings, ConcurrencyConfig, MemorySecretStore, ModelConfig, ProxyConfig, RateLimitConfig,
    SecretStore,
};
use wiremock::MockServer;

use support::{
    default_secret_ref, llm_bodies, now, seeded_project, state_with_transport, test_state,
    KeyEchoingTransport, OfflineTransport, ScriptedTransport, TEST_API_KEY,
};

use geo_desktop_lib::services::{
    EntityCardService, GenerateOptions, ProjectService, PromptService, SettingsService,
};
use geo_desktop_lib::state::AppState;

/// 全链路用的状态：建档 + 扩写 + 改写三段响应按调用顺序回放。
async fn full_chain_state() -> (AppState, MockServer, Arc<MemorySecretStore>) {
    let bodies = [
        llm_bodies("entity_card"),
        llm_bodies("prompt_expand"),
        llm_bodies("prompt_rewrite"),
    ]
    .concat();
    state_with_transport(ScriptedTransport::new(bodies)).await
}

/// 自定义用量的模型响应：成本按「元/百万 token」折算，用量太小会被四舍五入到 0。
fn response_with_usage(content: &str, prompt_tokens: u32, completion_tokens: u32) -> String {
    serde_json::json!({
        "id": "chatcmpl-flow",
        "model": "deepseek-chat",
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": content },
            "finish_reason": "stop",
        }],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        }
    })
    .to_string()
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

#[tokio::test]
async fn settings_round_trip_through_the_service() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let service = SettingsService::from_state(&state);

    let defaults = service.get().await.expect("默认设置可读");
    assert_eq!(defaults.concurrency, AppSettings::default().concurrency);
    assert_eq!(defaults.rate_limit, AppSettings::default().rate_limit);
    // 库里存的可能是 "deepseek" 这类写法，读出时必须归一化成 as_str()，
    // 否则设置页的单选框（取值来自 llm_providers）选不中当前厂商
    assert_eq!(
        defaults.model.provider,
        LlmProvider::DeepSeek.as_str(),
        "provider 取值必须与 llm_providers 同源"
    );

    let mut updated = defaults.clone();
    updated.concurrency.max_parallel = 5;
    updated.rate_limit.requests_per_minute = 12;
    updated.model.provider = LlmProvider::Moonshot.as_str().to_string();
    updated.model.temperature = 0.7;
    updated.proxy = Some(ProxyConfig {
        enabled: true,
        url: Some("http://127.0.0.1:7890".to_string()),
    });

    let saved = service.update(updated.clone()).await.expect("设置可写");
    assert_eq!(saved, updated);

    let reloaded = service.get().await.unwrap();
    assert_eq!(reloaded.concurrency.max_parallel, 5);
    assert_eq!(reloaded.model.provider, LlmProvider::Moonshot.as_str());
    assert_eq!(
        reloaded
            .proxy
            .as_ref()
            .and_then(|proxy| proxy.url.clone())
            .as_deref(),
        Some("http://127.0.0.1:7890")
    );
}

#[tokio::test]
async fn settings_update_rejects_values_outside_the_safe_range() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let service = SettingsService::from_state(&state);

    let cases = vec![
        AppSettings {
            model: ModelConfig {
                provider: "不存在的厂商".to_string(),
                ..Default::default()
            },
            ..Default::default()
        },
        AppSettings {
            concurrency: ConcurrencyConfig {
                max_parallel: 0,
                ..Default::default()
            },
            ..Default::default()
        },
        AppSettings {
            rate_limit: RateLimitConfig {
                requests_per_minute: 10_000,
                ..Default::default()
            },
            ..Default::default()
        },
        AppSettings {
            model: ModelConfig {
                temperature: 3.5,
                ..Default::default()
            },
            ..Default::default()
        },
        AppSettings {
            proxy: Some(ProxyConfig {
                enabled: true,
                url: Some("   ".to_string()),
            }),
            ..Default::default()
        },
    ];

    for settings in cases {
        let error = service
            .update(settings)
            .await
            .expect_err("非法设置必须被拒绝");
        assert_eq!(error.code, "validation/failed", "{error}");
    }

    // 一次都没写进去
    let untouched = service.get().await.unwrap();
    assert_eq!(untouched.concurrency, AppSettings::default().concurrency);
    assert_eq!(untouched.rate_limit, AppSettings::default().rate_limit);
    assert_eq!(untouched.proxy, AppSettings::default().proxy);
}

// ---------------------------------------------------------------------------
// 密钥
// ---------------------------------------------------------------------------

#[tokio::test]
async fn secret_status_reports_the_reference_but_never_the_value() {
    let (state, _server, secrets) = test_state(OfflineTransport::new()).await;
    let service = SettingsService::from_state(&state);

    let before = service.secret_status("deepseek").await.expect("可读状态");
    assert!(!before.configured);
    assert_eq!(before.secret_ref, default_secret_ref());
    assert_eq!(before.provider, LlmProvider::DeepSeek.as_str());

    service
        .set_secret("deepseek", TEST_API_KEY)
        .await
        .expect("可写入钥匙串");
    let after = service.secret_status("deepseek").await.unwrap();
    assert!(after.configured);

    // 别名写法要落到同一个引用串：前端传 `deepseek`，库里查 `deep_seek`
    assert_eq!(
        service
            .set_secret("DeepSeek", TEST_API_KEY)
            .await
            .map(|()| after.clone())
            .unwrap()
            .secret_ref,
        default_secret_ref()
    );
    assert_eq!(
        secrets.get(&default_secret_ref()).await.unwrap().as_deref(),
        Some(TEST_API_KEY)
    );

    let serialized = serde_json::to_string(&after).expect("状态可序列化");
    assert!(
        !serialized.contains(TEST_API_KEY),
        "密钥状态里不得出现明文 Key：{serialized}"
    );
    assert!(serialized.contains("configured"));
}

#[tokio::test]
async fn secret_delete_makes_the_status_unconfigured_again() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let service = SettingsService::from_state(&state);

    service.set_secret("moonshot", TEST_API_KEY).await.unwrap();
    assert!(service.secret_status("moonshot").await.unwrap().configured);

    service.delete_secret("moonshot").await.expect("可删除");
    assert!(!service.secret_status("moonshot").await.unwrap().configured);
    // 幂等：再删一次不报错
    service.delete_secret("moonshot").await.unwrap();
}

#[tokio::test]
async fn secret_commands_reject_an_unknown_provider() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let service = SettingsService::from_state(&state);

    for error in [
        service
            .set_secret("nope", TEST_API_KEY)
            .await
            .expect_err("应拒绝"),
        service.secret_status("nope").await.expect_err("应拒绝"),
    ] {
        assert_eq!(error.code, "llm/config", "{error}");
    }
    let error = service
        .set_secret("deepseek", "   ")
        .await
        .expect_err("空 Key 应拒绝");
    assert_eq!(error.code, "validation/failed");
}

#[tokio::test]
async fn provider_test_without_a_key_reports_missing_secret() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let error = SettingsService::from_state(&state)
        .provider_test("deepseek")
        .await
        .expect_err("没 Key 必须报错");

    assert_eq!(error.code, "llm/missing_secret");
    assert!(
        error.message.contains("未配置 API Key"),
        "{}",
        error.message
    );
    assert!(!error.message.contains(TEST_API_KEY));
}

#[tokio::test]
async fn provider_test_reports_model_latency_tokens_and_cost() {
    let transport = ScriptedTransport::new(vec![response_with_usage("连接正常", 100_000, 50_000)]);
    let (state, _server, _secrets) = state_with_transport(transport.clone()).await;

    let result = SettingsService::from_state(&state)
        .provider_test("deepseek")
        .await
        .expect("有 Key 且模型应答时应成功");

    assert!(result.ok);
    assert_eq!(result.model, LlmProvider::DeepSeek.default_model());
    assert_eq!(result.prompt_tokens, 100_000);
    assert_eq!(result.completion_tokens, 50_000);
    // DeepSeek 预设单价：输入 2 元/百万、输出 8 元/百万 → 0.2 + 0.4 = 0.6 元
    assert!(
        (result.cost_cny - 0.6).abs() < f64::EPSILON,
        "{}",
        result.cost_cny
    );
    assert!(result.message.is_none());
    assert_eq!(transport.request_count(), 1);
}

#[tokio::test]
async fn provider_test_reports_a_failed_call_without_leaking_the_key() {
    let (state, _server, _secrets) = state_with_transport(OfflineTransport::new()).await;

    let result = SettingsService::from_state(&state)
        .provider_test("deepseek")
        .await
        .expect("连通性失败是可展示的结果，不是异常");

    assert!(!result.ok);
    let message = result.message.clone().expect("失败要说明原因");
    assert!(!message.is_empty());
    assert!(!message.contains(TEST_API_KEY), "{message}");
    assert_eq!(result.prompt_tokens, 0);
}

/// 上游把 `Authorization` 回显进错误体时，Key 也不许出现在**成功返回**的
/// `LlmTestResult.message` 里——这条路径不经过 `IpcError`，是脱敏的盲区。
#[tokio::test]
async fn provider_test_redacts_a_key_echoed_by_the_gateway() {
    let (state, _server, _secrets) = state_with_transport(KeyEchoingTransport::new()).await;

    let result = SettingsService::from_state(&state)
        .provider_test("deepseek")
        .await
        .expect("连通性失败是可展示的结果");

    assert!(!result.ok);
    let message = result.message.clone().expect("失败要说明原因");
    assert!(!message.contains(TEST_API_KEY), "泄漏了 Key：{message}");
    assert!(message.contains("***"), "应留下脱敏痕迹：{message}");
}

#[tokio::test]
async fn providers_cover_the_documented_presets() {
    let (state, _server, _secrets) = test_state(OfflineTransport::new()).await;
    let providers = SettingsService::from_state(&state).providers();

    assert_eq!(providers.len(), LlmProvider::all().len());
    let deepseek = providers
        .iter()
        .find(|info| info.provider == LlmProvider::DeepSeek.as_str())
        .expect("DeepSeek 预设在列");
    assert_eq!(deepseek.base_url, "https://api.deepseek.com/v1");
    assert_eq!(deepseek.default_model, "deepseek-chat");
    assert!(!deepseek.label_zh.is_empty());
    assert!(deepseek.input_per_mtok > 0.0);

    // 前端「自定义」要能拿到空 base_url，据此放开输入框
    let custom = providers
        .iter()
        .find(|info| info.provider == LlmProvider::Custom.as_str())
        .expect("自定义在列");
    assert!(custom.base_url.is_empty());
    assert!(custom.default_model.is_empty());

    let serialized = serde_json::to_string(&providers).expect("可序列化");
    assert!(serialized.contains("base_url"));
    assert!(serialized.contains("input_per_mtok"));
}

// ---------------------------------------------------------------------------
// 全链路（spec S1 Go/No-Go）
// ---------------------------------------------------------------------------

#[tokio::test]
async fn full_chain_from_project_to_exported_csv() {
    let (state, server, _secrets) = full_chain_state().await;
    let project = seeded_project(&state).await;

    let competitors = ProjectService::new(state.pool.clone())
        .list_competitors(project.id)
        .await
        .expect("竞品可读");
    assert_eq!(competitors.len(), 3, "向导里的 3 家竞品应已落库");

    // 自动建档：只抓 wiremock 上的自有站点
    let card = EntityCardService::from_state(&state)
        .autobuild(project.id, &server.uri(), now())
        .await
        .expect("自动建档成功");
    assert!(
        card.completeness >= 0.8,
        "fixture 站点字段完整率应 ≥0.8，实际 {}",
        card.completeness
    );
    assert_eq!(card.fields.standard_name, "宏宇泵业");
    assert!(!card.source.crawled_pages.is_empty());
    assert_eq!(
        card.source.llm_provider.as_deref(),
        Some(LlmProvider::DeepSeek.as_str())
    );

    // 生成题库：行业跟随项目，目标 80 条
    let set = PromptService::from_state(&state)
        .generate(
            project.id,
            GenerateOptions {
                industry: project.industry,
                ..Default::default()
            },
            now(),
        )
        .await
        .expect("生成题库成功");

    assert_eq!(project.industry, Industry::B2bManufacturing);
    assert!(
        set.items.len() >= SUFFICIENT_SAMPLE_SIZE,
        "全链路应产出 ≥60 条，实际 {}",
        set.items.len()
    );
    assert_eq!(
        set.intent_coverage(),
        IntentCategory::all().into_iter().collect()
    );
    let report = dedupe(set.items.clone());
    assert_eq!(report.duplicate_pairs, 0);
    assert_eq!(report.removed_count(), 0, "落库前就应已去重");
    assert_eq!(set.version, 1);

    // 导出 CSV：表头 + 每条一行，且不含密钥
    let csv = PromptService::from_state(&state)
        .export_csv(set.id)
        .await
        .expect("可导出");
    assert!(csv.starts_with("text,intent,weight,group_name,tags,source,repeat_count"));
    assert_eq!(csv.trim().lines().count(), set.items.len() + 1);
    assert!(!csv.contains(TEST_API_KEY));

    // 版本快照可环比：列表按版本倒序，条数与哈希都在摘要里
    let summaries = PromptService::from_state(&state)
        .list(project.id)
        .await
        .unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].item_count, set.items.len());
    assert_eq!(summaries[0].content_hash, set.content_hash);
}

#[tokio::test]
async fn full_chain_still_delivers_sixty_prompts_without_a_model() {
    // 新用户没填 Key 也必须能走完「建项目 → 出题 → 导出」，只是走降级路径
    let (state, server, _secrets) = test_state(OfflineTransport::new()).await;
    let project = seeded_project(&state).await;

    let card = EntityCardService::from_state(&state)
        .autobuild(project.id, &server.uri(), now())
        .await
        .expect("无 Key 时建档降级而不是报错");
    assert!(card.source.llm_provider.is_none());
    assert!(
        !card.pending_fields().is_empty(),
        "降级卡的字段应处于待确认状态"
    );

    let set = PromptService::from_state(&state)
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .expect("无 Key 时出题降级而不是报错");
    assert!(set.items.len() >= SUFFICIENT_SAMPLE_SIZE);
    assert!(set.notes.unwrap_or_default().contains("降级"));
}

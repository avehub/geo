//! `llm_models_list` 服务集成测试：草稿地址、鉴权头、清单解析与错误口径。

mod support;

use std::sync::Arc;

use async_trait::async_trait;
use geo_llm::{HttpRequest, HttpResponse, Transport, TransportError};
use geo_store::SecretStore;
use support::{state_with_transport, test_state, ScriptedTransport, TEST_API_KEY};

use geo_desktop_lib::services::{LlmModelsQuery, ModelsListSource, SettingsService};

fn query(provider: &str) -> LlmModelsQuery {
    LlmModelsQuery {
        provider: provider.to_string(),
        protocol: Some("openai_compat".to_string()),
        base_url: None,
        api_key: None,
    }
}

#[tokio::test]
async fn models_list_reads_upstream_and_dedupes() {
    let transport = ScriptedTransport::new(vec![
        r#"{"data":[{"id":"deepseek-chat"},{"id":"deepseek-reasoner"},{"id":"deepseek-chat"}]}"#
            .to_string(),
    ]);
    let (state, _server, _secrets) = state_with_transport(transport.clone()).await;
    let result = SettingsService::from_state(&state)
        .list_models(query("deepseek"))
        .await
        .expect("拉模型清单");
    assert_eq!(result.source, ModelsListSource::Upstream);
    assert_eq!(result.models, vec!["deepseek-chat", "deepseek-reasoner"]);

    let requests = transport.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method.as_str(), "GET");
    assert_eq!(requests[0].url, "https://api.deepseek.com/v1/models");
    assert_eq!(
        requests[0].header("authorization"),
        Some(format!("Bearer {TEST_API_KEY}").as_str())
    );
}

#[tokio::test]
async fn models_list_uses_draft_base_url() {
    let transport = ScriptedTransport::new(vec![r#"{"models":["m1","m2"]}"#.to_string()]);
    let (state, _server, secrets) = state_with_transport(transport.clone()).await;
    secrets
        .set(&geo_store::secret_ref("llm", "custom"), TEST_API_KEY)
        .await
        .expect("自定义厂商 Key");
    let result = SettingsService::from_state(&state)
        .list_models(LlmModelsQuery {
            provider: "custom".to_string(),
            protocol: Some("anthropic".to_string()),
            base_url: Some("https://gateway.example.com/v1/".to_string()),
            api_key: None,
        })
        .await
        .expect("自定义地址");
    assert_eq!(result.models, vec!["m1", "m2"]);
    let requests = transport.requests();
    assert_eq!(requests[0].url, "https://gateway.example.com/v1/models");
    assert!(requests[0].header("x-api-key").is_some());
    assert!(requests[0].header("anthropic-version").is_some());
    assert!(requests[0].header("authorization").is_none());
}

#[tokio::test]
async fn models_list_requires_base_url_for_custom() {
    let (state, _server, _secrets) = state_with_transport(ScriptedTransport::new(Vec::new())).await;
    let error = SettingsService::from_state(&state)
        .list_models(query("custom"))
        .await
        .expect_err("custom 缺地址");
    assert_eq!(error.code, "llm/config");
    assert_eq!(error.params["reason"], "missing_base_url");
    assert_eq!(error.params["value"], "custom");
}

#[tokio::test]
async fn models_list_rejects_unknown_provider() {
    let (state, _server, _secrets) = state_with_transport(ScriptedTransport::new(Vec::new())).await;
    let error = SettingsService::from_state(&state)
        .list_models(query("not-a-provider"))
        .await
        .expect_err("未知厂商");
    assert_eq!(error.code, "llm/config");
    assert_eq!(error.params["reason"], "unknown_provider");
    assert_eq!(error.params["value"], "not-a-provider");
}

#[tokio::test]
async fn models_list_requires_keychain_secret() {
    let (state, _server, _secrets) = test_state(ScriptedTransport::new(Vec::new())).await;
    let error = SettingsService::from_state(&state)
        .list_models(query("deepseek"))
        .await
        .expect_err("没有 Key");
    assert_eq!(error.code, "llm/missing_secret");
    assert!(error.params.is_empty());
}

#[derive(Debug)]
struct StatusTransport(u16);

#[async_trait]
impl Transport for StatusTransport {
    async fn send(&self, _req: HttpRequest) -> Result<HttpResponse, TransportError> {
        Ok(HttpResponse {
            status: self.0,
            body: "{}".to_string(),
        })
    }
}

#[tokio::test]
async fn models_list_maps_upstream_status() {
    let (state, _server, secrets) = test_state(Arc::new(StatusTransport(429))).await;
    support::seed_secret(&secrets).await;
    let error = SettingsService::from_state(&state)
        .list_models(query("deepseek"))
        .await
        .expect_err("限流");
    assert_eq!(error.code, "llm/rate_limited");

    let (state, _server, secrets) = test_state(Arc::new(StatusTransport(500))).await;
    support::seed_secret(&secrets).await;
    let error = SettingsService::from_state(&state)
        .list_models(query("deepseek"))
        .await
        .expect_err("上游 500");
    assert_eq!(error.code, "llm/server");
    assert_eq!(error.params["status"], "500");
}

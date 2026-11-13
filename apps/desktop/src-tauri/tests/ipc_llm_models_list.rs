//! `llm_models_list` 的 IPC 参数形状回归（2026-11-06 用户报障）。
//!
//! 前端 `api/client.ts` 的 `llmModelsList` 按冻结契约发**扁平草稿参数**
//! （`provider` / `protocol` / `base_url` / `api_key`），但 Rust 命令曾把整份入参
//! 收成 `query: LlmModelsQuery` ⇒ Tauri 要求外层多一个 `query` 键，桌面端任意
//! 服务商点「拉取模型列表」都会报 `missing required key query`。
//!
//! 这条测试直接走 Tauri 的 mock runtime 调真实命令（不是 service 单测），
//! 才能钉住宏展开后的参数键名。

mod support;

use geo_desktop_lib::services::ModelsListResult;
use support::{state_with_transport, ScriptedTransport};

#[tokio::test]
async fn llm_models_list_accepts_flat_draft_args_from_frontend() {
    let transport = ScriptedTransport::new(vec![
        r#"{"data":[{"id":"deepseek-chat"},{"id":"deepseek-reasoner"}]}"#.to_string(),
    ]);
    let (state, _server, _secrets) = state_with_transport(transport).await;

    let app = tauri::test::mock_builder()
        .manage(state)
        // 只挂这一条命令：测试 crate 里展开的宏直接绑定 MockRuntime；
        // 与 `ipc/mod.rs` 的 `generate_handler![]` 花的是同一个命令宏。
        .invoke_handler(tauri::generate_handler![
            geo_desktop_lib::ipc::settings::llm_models_list
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("mock webview");

    // 逐字模拟 `apps/desktop/ui/src/api/client.ts` 的 llmModelsList：
    // 扁平四个键，没有 `query` 外层。`api_key` 恒为 null（规则 3）。
    let response = tauri::test::get_ipc_response(
        &webview,
        tauri::webview::InvokeRequest {
            cmd: "llm_models_list".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().expect("测试 URL"),
            body: tauri::ipc::InvokeBody::Json(serde_json::json!({
                "provider": "deepseek",
                "protocol": "openai_compat",
                "base_url": null,
                "api_key": null,
            })),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    )
    .expect("命令必须接受前端发送的扁平草稿参数");

    let result: ModelsListResult = response.deserialize().expect("返回模型清单");
    assert_eq!(result.models, vec!["deepseek-chat", "deepseek-reasoner"]);
}

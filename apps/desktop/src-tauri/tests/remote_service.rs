//! `RemoteService` 集成测试（Task 9）。
//!
//! 🔴 全程离线：HTTP 由 wiremock 回放，验签函数注入。**不碰真网络、不放私钥**。
//! 覆盖计划要求的五条：正常同步 / digest 篡改 / 验签失败 / 服务端不可用回落内置 /
//! 远程版本低于本地被拒（防回滚）。

use std::sync::Arc;

use geo_domain::remote::ItemKey;
use geo_store::open_in_memory;
use geo_store::repo::{RemoteCacheEntry, RemoteCacheRepo, RemoteSource};
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use geo_desktop_lib::services::RemoteService;

const OK_SIG: &str = "trusted-sig";

fn verifier_ok(_body: &[u8], sig: &str) -> bool {
    sig == OK_SIG
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn manifest_json(version: u64, sha: &str, sig: &str) -> String {
    json!({
        "schema_version": 1,
        "generated_at": "2026-11-18T00:00:00Z",
        "items": {
            "release": {
                "path": "release.json",
                "version": version,
                "sha256": sha,
                "signature": sig
            }
        }
    })
    .to_string()
}

/// 每个用例独立内存库：用例之间不得共享"本地已接受版本"。
async fn service(
    server: &MockServer,
    verifier: fn(&[u8], &str) -> bool,
) -> (RemoteService, sqlx::SqlitePool) {
    let pool = open_in_memory().await.expect("内存库");
    let svc = RemoteService::for_test(
        pool.clone(),
        format!("{}/client/v1", server.uri()),
        Arc::new(verifier),
    );
    (svc, pool)
}

#[tokio::test(flavor = "multi_thread")]
async fn normal_sync_writes_cache_and_ok_log() {
    let server = MockServer::start().await;
    let body =
        br#"{"version":"1.0.0","notes":"n","pub_date":"2026-11-18T00:00:00Z","platforms":{}}"#
            .to_vec();
    let sha = sha256_hex(&body);
    Mock::given(method("GET"))
        .and(path("/client/v1/manifest.json"))
        .respond_with(ResponseTemplate::new(200).set_body_string(manifest_json(2, &sha, OK_SIG)))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/client/v1/release.json"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(body.clone()))
        .mount(&server)
        .await;

    let (svc, pool) = service(&server, verifier_ok).await;
    let report = svc.sync().await.expect("同步不该抛错");

    assert_eq!(report.status, "ok");
    assert_eq!(report.changed, vec!["release".to_string()]);
    assert!(report.failed.is_empty());
    assert!(!report.degraded);

    let cached = RemoteCacheRepo::new(pool)
        .get(ItemKey::Release)
        .await
        .expect("读缓存")
        .expect("缓存里应有 release");
    assert_eq!(cached.version, 2);
    assert_eq!(cached.source, RemoteSource::Remote);
    assert_eq!(cached.body, body);
}

#[tokio::test(flavor = "multi_thread")]
async fn tampered_body_is_rejected_and_old_value_kept() {
    let server = MockServer::start().await;
    let declared = b"{\"version\":\"2.0.0\"}".to_vec();
    let served = b"{\"version\":\"2.0.0\",\"evil\":\"SECRET-BODY-MARKER\"}".to_vec();
    Mock::given(method("GET"))
        .and(path("/client/v1/manifest.json"))
        .respond_with(ResponseTemplate::new(200).set_body_string(manifest_json(
            2,
            &sha256_hex(&declared),
            OK_SIG,
        )))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/client/v1/release.json"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(served))
        .mount(&server)
        .await;

    let (svc, pool) = service(&server, verifier_ok).await;
    // 预置一个旧版本，验证"被拒时保留旧值"
    RemoteCacheRepo::new(pool.clone())
        .put(&RemoteCacheEntry {
            item_key: ItemKey::Release,
            version: 1,
            sha256: "a".repeat(64),
            signature: String::new(),
            body: b"{\"version\":\"1.0.0\"}".to_vec(),
            accepted_at: "2026-11-17T00:00:00Z".to_string(),
            source: RemoteSource::Remote,
        })
        .await
        .unwrap();

    let report = svc.sync().await.expect("同步不该抛错");
    assert_eq!(report.status, "rejected_digest");
    assert_eq!(report.failed.len(), 1);
    assert_eq!(report.failed[0].reason, "digest");
    assert!(report.degraded);

    // 🔴 错误/报告里不得出现响应体原文（可能含攻击者塞进来的内容）
    let wire = serde_json::to_string(&report).unwrap();
    assert!(!wire.contains("SECRET-BODY-MARKER"), "报告泄漏了响应体");

    let kept = RemoteCacheRepo::new(pool)
        .get(ItemKey::Release)
        .await
        .unwrap()
        .expect("旧版本必须保留");
    assert_eq!(kept.version, 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn invalid_signature_is_rejected() {
    let server = MockServer::start().await;
    let body = br#"{"version":"3.0.0"}"#.to_vec();
    Mock::given(method("GET"))
        .and(path("/client/v1/manifest.json"))
        .respond_with(ResponseTemplate::new(200).set_body_string(manifest_json(
            3,
            &sha256_hex(&body),
            "some-other-sig",
        )))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/client/v1/release.json"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(body))
        .mount(&server)
        .await;

    let (svc, pool) = service(&server, verifier_ok).await;
    let report = svc.sync().await.unwrap();
    assert_eq!(report.status, "rejected_signature");
    assert_eq!(report.failed[0].reason, "signature");
    assert!(RemoteCacheRepo::new(pool)
        .get(ItemKey::Release)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn server_error_falls_back_to_builtin_without_panicking() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/client/v1/manifest.json"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;

    let (svc, pool) = service(&server, verifier_ok).await;
    let report = svc.sync().await.expect("失败也必须是 Ok(report)");
    assert_eq!(report.status, "unavailable");
    assert_eq!(report.error_code.as_deref(), Some("status"));
    assert!(report.degraded);

    // 回落内置：应用照常能读到 release
    let item = svc.get_json(ItemKey::Release).await.unwrap();
    assert_eq!(item.source, "builtin");
    assert!(item.degraded);
    assert!(item.value.is_some(), "内置兜底必须有内容");

    // 内置版本要落库，作为防降级的本地基线
    let seeded = RemoteCacheRepo::new(pool)
        .get(ItemKey::Release)
        .await
        .unwrap()
        .expect("内置应落缓存");
    assert_eq!(seeded.source, RemoteSource::Builtin);
}

#[tokio::test(flavor = "multi_thread")]
async fn older_remote_version_is_refused_and_logged_as_rolled_back() {
    let server = MockServer::start().await;
    let body = br#"{"version":"0.9.0"}"#.to_vec();
    Mock::given(method("GET"))
        .and(path("/client/v1/manifest.json"))
        .respond_with(ResponseTemplate::new(200).set_body_string(manifest_json(
            4,
            &sha256_hex(&body),
            OK_SIG,
        )))
        .mount(&server)
        .await;

    let (svc, pool) = service(&server, verifier_ok).await;
    RemoteCacheRepo::new(pool.clone())
        .put(&RemoteCacheEntry {
            item_key: ItemKey::Release,
            version: 9,
            sha256: sha256_hex(b"local"),
            signature: String::new(),
            body: b"local".to_vec(),
            accepted_at: "2026-11-17T00:00:00Z".to_string(),
            source: RemoteSource::Remote,
        })
        .await
        .unwrap();

    let report = svc.sync().await.unwrap();
    assert_eq!(report.status, "rolled_back");
    assert!(report.changed.is_empty());
    // 绝不能发请求去拉更低版本：wiremock 没挂 release.json，拉到就会 404，
    // 报告里就会出现 failed —— 这里断言它压根没试。
    assert!(report.failed.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn unknown_rulepack_is_not_found_and_index_is_signed_but_seeded_builtin() {
    let server = MockServer::start().await;
    let (svc, _pool) = service(&server, verifier_ok).await;

    let list = svc.rulepack_list().await.unwrap();
    assert_eq!(list.source, "builtin");
    assert!(list.value.is_some());

    let err = svc.rulepack_get("no_such_engine").await.unwrap_err();
    assert_eq!(err.code, "remote/not_found");
}

#[tokio::test(flavor = "multi_thread")]
async fn status_reports_builtin_versions_and_never_claims_remote() {
    let server = MockServer::start().await;
    let (svc, _pool) = service(&server, verifier_ok).await;
    let status = svc.status().await.unwrap();
    assert!(!status.public_key_configured);
    assert!(status.last_sync.is_none());
    assert!(!status.builtin_versions.is_empty());
    assert!(status.items.is_empty());
}

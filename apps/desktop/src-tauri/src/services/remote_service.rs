//! 远程内容（数据面）同步与读取。
//!
//! # 三条不变量（设计文档 §2.4）
//!
//! - **I-1 断网可用**：任何一步失败都**静默回落**编译期内置快照（`geo_domain::remote::builtin_fallback`），
//!   不弹错误框、不阻塞启动。
//! - **I-2 数据面纯净**：只 `GET` 静态文件，不带任何 Cookie / 鉴权头 / 查询参数。
//! - **I-3 无后台轮询**：只在启动与用户手动触发时同步；本服务没有定时器。
//!
//! # 🔴 失败必须可见，但不能阻断
//!
//! 同步结果写进 `remote_sync_log`（`ok` / `partial` / `rejected_digest` /
//! `rejected_signature` / `rolled_back` / `unavailable`），设置页据此展示"当前用的是
//! 远程还是内置"。**错误信息只存稳定原因码**：不存响应体、不存签名、不存 URL 查询串。
//!
//! # 🔴 验签是硬门禁，不是可选装饰
//!
//! 内容公钥在**编译期**由 `GDK_CONTENT_PUBLIC_KEY` 注入（见 [`CONTENT_PUBLIC_KEY_B64`]）。
//! 构建时没有注入 = 公钥为空 = **所有远程内容一律拒收**，全部回落内置。
//! 这是刻意的 fail closed：一个"验不了就放行"的客户端，等于把用户的第三方平台会话
//! 交给任何能篡改服务器的人（AGENTS 不变量 4）。

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use geo_domain::remote::{
    builtin_fallback, builtin_manifest, digest_matches, is_acceptable, parse_manifest,
    select_outdated, verify_signature, ItemKey, ManifestItem,
};
use geo_store::{RemoteCacheEntry, RemoteCacheRepo, RemoteSource, SyncLogEntry, SyncStatus};
use serde::Serialize;
use serde_json::Value;
use sqlx::SqlitePool;

use crate::error::{err_codes, IpcError};

/// 数据面根地址。`/client/v1/` 之下全部是匿名只读静态文件。
pub const DEFAULT_BASE_URL: &str = "https://geo_api.gaodekuai.com/client/v1";

/// 内容签名公钥（base64）。构建时注入：
///
/// ```bash
/// GDK_CONTENT_PUBLIC_KEY="RW…" pnpm tauri build
/// ```
///
/// 🔴 没注入就是空串 → `verify_signature` 恒 false → 全部回落内置。
/// 这不是"忘记配置的漏洞"，而是"没配就明确不信任远程"的安全缺省。
/// 指纹（key id）登记在后台 `system/signing` 页面，两处必须一致。
pub const CONTENT_PUBLIC_KEY_B64: &str = match option_env!("GDK_CONTENT_PUBLIC_KEY") {
    Some(key) => key,
    None => "",
};

/// manifest 体积上限：正常 < 100 KiB，给 1 MiB 是为了防"服务器被换成大文件"拖死启动路径。
const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
/// 单个产物体积上限。规则包/模板都是小 JSON；超限说明取错了东西。
const MAX_ITEM_BYTES: usize = 4 * 1024 * 1024;

/// 网络超时：同步在启动路径上，等不起。
const SYNC_TIMEOUT: Duration = Duration::from_secs(10);

/// 验签函数。注入是为了在测试里能分别演"验签成功/失败"两条分支，
/// 而不必在仓库里放私钥。
pub type SignatureVerifier = Arc<dyn Fn(&[u8], &str) -> bool + Send + Sync>;

/// 一次同步的结果（IPC `remote_sync` 的返回值）。
#[derive(Debug, Clone, Serialize)]
pub struct SyncReport {
    pub status: String,
    pub changed: Vec<String>,
    pub failed: Vec<FailedItem>,
    pub degraded: bool,
    pub started_at: String,
    pub finished_at: String,
    pub error_code: Option<String>,
}

/// 单项失败原因。🔴 `reason` 是稳定枚举，不是上游原文。
#[derive(Debug, Clone, Serialize)]
pub struct FailedItem {
    pub item: String,
    pub reason: String,
}

/// JSON 产物视图。`value` 为 `None` 表示这一项既没有缓存也没有内置兜底
/// （目前只有 legal / notices 会这样：把可能过期的隐私政策编进客户端比取不到更危险）。
#[derive(Debug, Clone, Serialize)]
pub struct RemoteJsonItem {
    pub key: String,
    pub version: u64,
    pub sha256: String,
    /// `remote` | `builtin` | `none`
    pub source: String,
    pub accepted_at: Option<String>,
    /// 🔴 `true` = 当前用的不是远程发布版本（内置兜底或完全没有）。
    pub degraded: bool,
    pub value: Option<Value>,
}

/// 纯文本产物视图（法务文档正文）。
#[derive(Debug, Clone, Serialize)]
pub struct RemoteTextItem {
    pub key: String,
    pub version: u64,
    pub sha256: String,
    pub source: String,
    pub accepted_at: Option<String>,
    pub degraded: bool,
    pub title: Option<String>,
    pub text: Option<String>,
}

/// 单项缓存状态（`remote_status` 列表用）。
#[derive(Debug, Clone, Serialize)]
pub struct RemoteItemStatus {
    pub key: String,
    pub version: u64,
    pub sha256: String,
    pub source: String,
    pub accepted_at: String,
}

/// 最近一次同步摘要。
#[derive(Debug, Clone, Serialize)]
pub struct SyncSummary {
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub changed_items: Vec<String>,
    pub degraded: bool,
    pub error_code: Option<String>,
}

/// `remote_status`：设置页"远程内容"一节的唯一数据源。
#[derive(Debug, Clone, Serialize)]
pub struct RemoteStatus {
    pub base_url: String,
    pub public_key_configured: bool,
    pub last_sync: Option<SyncSummary>,
    pub items: Vec<RemoteItemStatus>,
    /// 内置快照的版本（用于展示"内置 vN"）。
    pub builtin_versions: Vec<RemoteItemStatus>,
    /// 只要有一项不是远程版本就是 `true`。
    pub degraded: bool,
}

/// `remote_endpoint_config`：端点与公钥状态。
#[derive(Debug, Clone, Serialize)]
pub struct RemoteEndpointConfig {
    pub base_url: String,
    pub default_base_url: String,
    pub public_key_configured: bool,
    pub timeout_secs: u64,
}

/// 取数失败原因（稳定枚举）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FetchError {
    Network,
    Status,
    TooLarge,
    InvalidPath,
}

impl FetchError {
    fn reason(&self) -> &'static str {
        match self {
            Self::Network => "network",
            Self::Status => "status",
            Self::TooLarge => "too_large",
            Self::InvalidPath => "invalid_path",
        }
    }
}

pub struct RemoteService {
    pool: SqlitePool,
    http: reqwest::Client,
    base_url: String,
    public_key: String,
    verifier: SignatureVerifier,
}

impl RemoteService {
    pub fn new(
        pool: SqlitePool,
        base_url: impl Into<String>,
        public_key: impl Into<String>,
    ) -> Self {
        let public_key = public_key.into();
        let key_for_verify = public_key.clone();
        Self {
            pool,
            http: build_http_client(None),
            base_url: base_url.into(),
            public_key,
            verifier: Arc::new(move |data, sig| verify_signature(&key_for_verify, data, sig)),
        }
    }

    /// 生产装配：默认端点 + 编译期公钥 + 可选代理（取自设置）。
    pub fn production(pool: SqlitePool, proxy: Option<String>) -> Self {
        let public_key = CONTENT_PUBLIC_KEY_B64.to_string();
        let key_for_verify = public_key.clone();
        Self {
            pool,
            http: build_http_client(proxy),
            base_url: DEFAULT_BASE_URL.to_string(),
            public_key,
            verifier: Arc::new(move |data, sig| verify_signature(&key_for_verify, data, sig)),
        }
    }

    /// 测试装配：可注入验签函数（wiremock 端点，禁联网）。
    pub fn for_test(pool: SqlitePool, base_url: String, verifier: SignatureVerifier) -> Self {
        Self {
            pool,
            http: build_http_client(None),
            base_url,
            public_key: String::new(),
            verifier,
        }
    }

    fn repo(&self) -> RemoteCacheRepo {
        RemoteCacheRepo::new(self.pool.clone())
    }

    fn url(&self, path: &str) -> Result<String, FetchError> {
        let path = path.trim();
        // 🔴 防目录穿越/绝对 URL：path 来自（已验签的）manifest，仍然再判一次 ——
        //    纵深防御，成本几乎为零。
        if path.is_empty()
            || path.starts_with('/')
            || path.contains("..")
            || path.contains("://")
            || path.contains('\\')
        {
            return Err(FetchError::InvalidPath);
        }
        Ok(format!("{}/{}", self.base_url.trim_end_matches('/'), path))
    }

    async fn fetch(&self, path: &str, max_bytes: usize) -> Result<Vec<u8>, FetchError> {
        let url = self.url(path)?;
        let resp = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|_| FetchError::Network)?;
        if !resp.status().is_success() {
            return Err(FetchError::Status);
        }
        if let Some(len) = resp.content_length() {
            if len as usize > max_bytes {
                return Err(FetchError::TooLarge);
            }
        }
        let bytes = resp.bytes().await.map_err(|_| FetchError::Network)?;
        if bytes.len() > max_bytes {
            return Err(FetchError::TooLarge);
        }
        Ok(bytes.to_vec())
    }

    /// 同步一次。**不返回网络错误**：失败会写进 `remote_sync_log` 并降级，由 UI 展示。
    pub async fn sync(&self) -> Result<SyncReport, IpcError> {
        let started_at = Utc::now().to_rfc3339();
        let mut changed: Vec<String> = Vec::new();
        let mut failed: Vec<FailedItem> = Vec::new();
        let status: SyncStatus;
        let mut error_code: Option<String> = None;

        match self.fetch("manifest.json", MAX_MANIFEST_BYTES).await {
            Err(err) => {
                status = SyncStatus::Unavailable;
                error_code = Some(err.reason().to_string());
            }
            Ok(bytes) => {
                // manifest 是 JSON 文本；非法 UTF-8 一律按解析失败处理（不透传原文）。
                let text = String::from_utf8_lossy(&bytes);
                match parse_manifest(&text) {
                    Err(_) => {
                        status = SyncStatus::Unavailable;
                        error_code = Some("manifest_invalid".to_string());
                    }
                    Ok(manifest) => {
                        let local = self.repo().local_versions().await?;
                        let rolled_back: Vec<ItemKey> = ItemKey::ALL
                            .into_iter()
                            .filter(|key| match manifest.items.get(key) {
                                Some(item) => !is_acceptable(item.version, local.get(key)),
                                None => false,
                            })
                            .collect();

                        for key in select_outdated(&local, &manifest) {
                            let Some(item) = manifest.items.get(&key) else {
                                continue;
                            };
                            match self.fetch(&item.path, MAX_ITEM_BYTES).await {
                                Err(err) => failed.push(FailedItem {
                                    item: key.as_str().to_string(),
                                    reason: err.reason().to_string(),
                                }),
                                Ok(body) => {
                                    if let Some(reason) =
                                        self.validate_and_store(&key, item, &body).await?
                                    {
                                        failed.push(FailedItem {
                                            item: key.as_str().to_string(),
                                            reason,
                                        });
                                    } else {
                                        changed.push(key.as_str().to_string());
                                    }
                                }
                            }
                        }

                        status = if failed.is_empty() {
                            if changed.is_empty() && !rolled_back.is_empty() {
                                // 远程比本地旧：正确行为是"继续用本地版本"，但要留痕。
                                SyncStatus::RolledBack
                            } else {
                                SyncStatus::Ok
                            }
                        } else if changed.is_empty() {
                            // 全失败：用第一个失败原因定性（digest 优先于 network，
                            // 因为 digest/signature 是"有人动了内容"的强信号）。
                            first_failure_status(&failed)
                        } else {
                            SyncStatus::Partial
                        };
                    }
                }
            }
        }

        // 🔴 同步结束后把合规词库（内置 ∪ 远程）灌进进程内缓存：
        // 运营新加的红线词必须立刻对生成/编辑/导入生效，不需要重启客户端。
        // 取不到远程时这里拿到的是内置快照，并集结果与之前一致（无害）。
        if let Ok(item) = self.get_json(ItemKey::Compliance).await {
            apply_compliance_terms(item.value.as_ref());
        }

        let finished_at = Utc::now().to_rfc3339();
        let degraded = status != SyncStatus::Ok;
        let changed_items = serde_json::to_string(&changed).unwrap_or_else(|_| "[]".to_string());
        self.repo()
            .log_sync(&SyncLogEntry {
                id: None,
                started_at: started_at.clone(),
                finished_at: Some(finished_at.clone()),
                status,
                changed_items,
                degraded,
                error_code: error_code.clone(),
            })
            .await?;

        Ok(SyncReport {
            status: status.as_str().to_string(),
            changed,
            failed,
            degraded,
            started_at,
            finished_at,
            error_code,
        })
    }

    /// 校验一项产物并落缓存。返回 `Some(reason)` 表示被拒（原因码）。
    async fn validate_and_store(
        &self,
        key: &ItemKey,
        item: &ManifestItem,
        body: &[u8],
    ) -> Result<Option<String>, IpcError> {
        if !digest_matches(body, &item.sha256) {
            return Ok(Some("digest".to_string()));
        }
        if !(self.verifier)(body, &item.signature) {
            return Ok(Some("signature".to_string()));
        }
        self.repo()
            .put(&RemoteCacheEntry {
                item_key: *key,
                version: item.version,
                sha256: item.sha256.clone(),
                signature: item.signature.clone(),
                body: body.to_vec(),
                accepted_at: Utc::now().to_rfc3339(),
                source: RemoteSource::Remote,
            })
            .await?;
        Ok(None)
    }

    /// 读一项 JSON 产物：缓存 → 内置 → 空。
    pub async fn get_json(&self, key: ItemKey) -> Result<RemoteJsonItem, IpcError> {
        if let Some(entry) = self.repo().get(key).await? {
            return Ok(json_view(key, &entry));
        }
        if let Some(view) = self.seed_builtin(key).await? {
            return Ok(view);
        }
        Ok(RemoteJsonItem {
            key: key.as_str().to_string(),
            version: 0,
            sha256: String::new(),
            source: "none".to_string(),
            accepted_at: None,
            degraded: true,
            value: None,
        })
    }

    /// 首次读某一项时把内置快照写进缓存。
    ///
    /// 🔴 为什么要落库：内置版本必须成为"本地已接受版本"的一部分，
    /// 否则首次联网时服务端回放一个比内置更旧的 manifest 会被当成"首次同步"放行。
    async fn seed_builtin(&self, key: ItemKey) -> Result<Option<RemoteJsonItem>, IpcError> {
        let Some(body) = builtin_fallback(key) else {
            return Ok(None);
        };
        let manifest = builtin_manifest().unwrap_or_else(|_| geo_domain::remote::BuiltinManifest {
            schema_version: 1,
            generated_at: String::new(),
            items: Default::default(),
        });
        let entry = manifest.items.get(key.as_str());
        let version = entry.map(|e| e.version).unwrap_or(1);
        let sha256 = entry
            .map(|e| e.sha256.clone())
            .unwrap_or_else(|| sha256_hex(body.as_bytes()));
        let accepted_at = Utc::now().to_rfc3339();
        let cached = RemoteCacheEntry {
            item_key: key,
            version,
            sha256: sha256.clone(),
            // 🔴 内置内容不验签：可信度等同二进制本身（详见 geo_domain::remote 注释）。
            signature: String::new(),
            body: body.as_bytes().to_vec(),
            accepted_at: accepted_at.clone(),
            source: RemoteSource::Builtin,
        };
        self.repo().put(&cached).await?;
        Ok(Some(json_view(key, &cached)))
    }

    /// 规则包列表（`rulepacks.json` 的 `packs` 数组）。
    pub async fn rulepack_list(&self) -> Result<RemoteJsonItem, IpcError> {
        self.get_json(ItemKey::Rulepacks).await
    }

    /// 取某个引擎的规则包正文。
    ///
    /// 🔴 索引已验签 → 索引里的 `sha256` 是可信的 → 正文只需比 digest（信任链闭合）。
    /// 不在索引里的引擎返回 `remote/not_found`。
    pub async fn rulepack_get(&self, engine_code: &str) -> Result<RemoteJsonItem, IpcError> {
        let index = self.get_json(ItemKey::Rulepacks).await?;
        let packs = index
            .value
            .as_ref()
            .and_then(|v| v.get("packs"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let pack = packs
            .iter()
            .find(|p| p.get("engine_code").and_then(|v| v.as_str()) == Some(engine_code))
            .ok_or_else(|| {
                IpcError::with_params(err_codes::REMOTE_NOT_FOUND, [("item", "rulepack")])
            })?;
        let path = pack.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let sha256 = pack.get("sha256").and_then(|v| v.as_str()).unwrap_or("");
        let version = pack.get("version").and_then(|v| v.as_u64()).unwrap_or(0);

        let bytes = self.fetch(path, MAX_ITEM_BYTES).await.map_err(|err| {
            IpcError::with_params(err_codes::REMOTE_UNAVAILABLE, [("reason", err.reason())])
        })?;
        if !digest_matches(&bytes, sha256) {
            return Err(IpcError::with_params(
                "remote/rejected".to_string(),
                [("item", "rulepack"), ("reason", "digest")],
            ));
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
            IpcError::with_params(err_codes::REMOTE_UNAVAILABLE, [("reason", "body_invalid")])
        })?;
        Ok(RemoteJsonItem {
            key: format!("rulepack:{engine_code}"),
            version,
            sha256: sha256.to_string(),
            source: index.source,
            accepted_at: index.accepted_at,
            degraded: index.degraded,
            value: Some(value),
        })
    }

    /// 法务文档索引。
    pub async fn legal_index(&self) -> Result<RemoteJsonItem, IpcError> {
        self.get_json(ItemKey::Legal).await
    }

    /// 取一份法务文档正文（Markdown/纯文本）。
    ///
    /// `doc_id` 只允许索引里真实存在的那几种；`locale` 只允许 `zh-CN` / `en-US`。
    pub async fn legal_get(&self, doc_id: &str, locale: &str) -> Result<RemoteTextItem, IpcError> {
        if !matches!(locale, "zh-CN" | "en-US") {
            return Err(IpcError::with_params(
                err_codes::REMOTE_NOT_FOUND,
                [("item", "legal")],
            ));
        }
        let index = self.legal_index().await?;
        let Some(docs) = index.value.as_ref().and_then(|v| v.get("docs")) else {
            return Err(IpcError::with_params(
                err_codes::REMOTE_UNAVAILABLE,
                [("reason", "no_legal_index")],
            ));
        };
        let doc = docs
            .get(doc_id)
            .and_then(|d| d.get(locale))
            .ok_or_else(|| {
                IpcError::with_params(err_codes::REMOTE_NOT_FOUND, [("item", "legal")])
            })?;
        let path = doc.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let sha256 = doc.get("sha256").and_then(|v| v.as_str()).unwrap_or("");
        let version = doc.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
        let title = doc
            .get("title")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let bytes = self.fetch(path, MAX_ITEM_BYTES).await.map_err(|err| {
            IpcError::with_params(err_codes::REMOTE_UNAVAILABLE, [("reason", err.reason())])
        })?;
        if !digest_matches(&bytes, sha256) {
            return Err(IpcError::with_params(
                "remote/rejected".to_string(),
                [("item", "legal"), ("reason", "digest")],
            ));
        }
        Ok(RemoteTextItem {
            key: format!("legal:{doc_id}:{locale}"),
            version,
            sha256: sha256.to_string(),
            source: index.source,
            accepted_at: index.accepted_at,
            degraded: index.degraded,
            title,
            text: Some(String::from_utf8_lossy(&bytes).to_string()),
        })
    }

    /// 有效 manifest：由缓存行重建（客户端真正在用的那份，不是服务器上的那份）。
    ///
    /// 🔴 刻意不返回"上次抓到的服务器 manifest 原文"：那份可能已过期，
    /// 且含签名文本。这里只给"我确实接受了什么"。
    pub async fn effective_manifest(&self) -> Result<Value, IpcError> {
        let entries = self.repo().all().await?;
        let mut items = serde_json::Map::new();
        let mut generated_at = String::new();
        for entry in &entries {
            if entry.accepted_at > generated_at {
                generated_at = entry.accepted_at.clone();
            }
            items.insert(
                entry.item_key.as_str().to_string(),
                serde_json::json!({
                    "version": entry.version,
                    "sha256": entry.sha256,
                    "source": entry.source.as_str(),
                    "accepted_at": entry.accepted_at,
                }),
            );
        }
        Ok(serde_json::json!({
            "schema_version": 1,
            "generated_at": generated_at,
            "items": items,
        }))
    }

    pub async fn status(&self) -> Result<RemoteStatus, IpcError> {
        let entries = self.repo().all().await?;
        let items: Vec<RemoteItemStatus> = entries
            .iter()
            .map(|e| RemoteItemStatus {
                key: e.item_key.as_str().to_string(),
                version: e.version,
                sha256: e.sha256.clone(),
                source: e.source.as_str().to_string(),
                accepted_at: e.accepted_at.clone(),
            })
            .collect();
        let degraded = items.iter().all(|i| i.source != "remote") && !items.is_empty();
        let logs = self.repo().recent_logs(1).await?;
        let last_sync = logs.first().map(|l| SyncSummary {
            status: l.status.as_str().to_string(),
            started_at: l.started_at.clone(),
            finished_at: l.finished_at.clone(),
            changed_items: serde_json::from_str(&l.changed_items).unwrap_or_default(),
            degraded: l.degraded,
            error_code: l.error_code.clone(),
        });
        Ok(RemoteStatus {
            base_url: self.base_url.clone(),
            public_key_configured: !self.public_key.is_empty(),
            last_sync,
            items,
            builtin_versions: builtin_status(),
            degraded,
        })
    }

    pub fn endpoint_config(&self) -> RemoteEndpointConfig {
        RemoteEndpointConfig {
            base_url: self.base_url.clone(),
            default_base_url: DEFAULT_BASE_URL.to_string(),
            public_key_configured: !self.public_key.is_empty(),
            timeout_secs: SYNC_TIMEOUT.as_secs(),
        }
    }
}

/// 从 `compliance.json` 抽出词条并灌进 `geo_domain::compliance` 的进程内附加词表。
///
/// 只取 `terms[].term`；形状不对一律当作"没有远程词"（内置词仍在）。
fn apply_compliance_terms(value: Option<&Value>) {
    let terms: Vec<String> = value
        .and_then(|v| v.get("terms"))
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("term").and_then(|t| t.as_str()))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    geo_domain::compliance::set_extra_terms(terms);
}

/// 全失败时的定性：signature > digest > 其余。
fn first_failure_status(failed: &[FailedItem]) -> SyncStatus {
    if failed.iter().any(|f| f.reason == "signature") {
        SyncStatus::RejectedSignature
    } else if failed.iter().any(|f| f.reason == "digest") {
        SyncStatus::RejectedDigest
    } else {
        SyncStatus::Unavailable
    }
}

fn json_view(key: ItemKey, entry: &RemoteCacheEntry) -> RemoteJsonItem {
    RemoteJsonItem {
        key: key.as_str().to_string(),
        version: entry.version,
        sha256: entry.sha256.clone(),
        source: entry.source.as_str().to_string(),
        accepted_at: Some(entry.accepted_at.clone()),
        degraded: entry.source != RemoteSource::Remote,
        // 解析失败 → None（不 panic）：损坏的缓存与"没有这一项"在 UI 上同等处理，
        // 都是"拿不到远程内容"，页面会展示内置兜底或明确提示。
        value: serde_json::from_slice(&entry.body).ok(),
    }
}

fn builtin_status() -> Vec<RemoteItemStatus> {
    let Ok(manifest) = builtin_manifest() else {
        return Vec::new();
    };
    manifest
        .items
        .iter()
        .map(|(key, entry)| RemoteItemStatus {
            key: key.clone(),
            version: entry.version,
            sha256: entry.sha256.clone(),
            source: "builtin".to_string(),
            accepted_at: manifest.generated_at.clone(),
        })
        .collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// 构造 HTTP 客户端：rustls ring provider、超时、默认 `no_proxy()`。
fn build_http_client(proxy: Option<String>) -> reqwest::Client {
    // workspace 里 reqwest 是 rustls-no-provider：进程内装一次 ring provider。
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = reqwest::Client::builder()
        .timeout(SYNC_TIMEOUT)
        .connect_timeout(SYNC_TIMEOUT);
    if let Some(proxy) = proxy
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        if let Ok(parsed) = reqwest::Proxy::all(&proxy) {
            builder = builder.proxy(parsed);
        }
    } else {
        // 🔴 必须显式 no_proxy：否则 reqwest 会捡系统代理，连回环都被送进代理。
        builder = builder.no_proxy();
    }
    builder.build().unwrap_or_else(|_| reqwest::Client::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compliance_terms_are_extracted_and_applied_as_a_union() {
        let value = serde_json::json!({
            "schema_version": 1,
            "version": 1,
            "terms": [{ "term": "远程新词" }, { "term": "  " }]
        });
        apply_compliance_terms(Some(&value));
        assert!(geo_domain::compliance::check("这里出现远程新词").is_err());
        // 内置词不会被远程覆盖掉
        assert!(geo_domain::compliance::check("保证排名").is_err());

        apply_compliance_terms(None);
        assert!(geo_domain::compliance::check("这里出现远程新词").is_ok());
    }
}

//! 密钥存储：系统钥匙串实现 + 测试/无头环境用的内存实现。
//!
//! 红线（见 `AGENTS.md`）：**API Key 永不入库、永不入日志、永不进错误信息**。
//! 数据库里只存 [`secret_ref`] 生成的引用串（形如 `keyring://llm/deepseek`），
//! 值只活在系统钥匙串与进程内存里。
//!
//! 所有从 keyring 冒出来的错误都会经 [`redact`] 兜一遍，确保即便上游
//! 把参数拼进消息，也不会把密钥带出来。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::error::StoreError;

/// 默认钥匙串 service 名，与应用 `identifier` 保持一致。
pub const DEFAULT_SERVICE: &str = "com.gaodekuai.geo";

/// `secret_ref` 的 scheme。
const REF_SCHEME: &str = "keyring://";

/// 密钥存取抽象。生产用 [`KeyringSecretStore`]，测试与 CI 用 [`MemorySecretStore`]。
#[async_trait::async_trait]
pub trait SecretStore: Send + Sync {
    async fn set(&self, key: &str, value: &str) -> Result<(), StoreError>;
    async fn get(&self, key: &str) -> Result<Option<String>, StoreError>;
    /// 只判断「有没有」，**不解密**。
    ///
    /// 设置页的 `secret_status` 只需要这个答案；`get` 会走系统钥匙串的解密路径，
    /// 在 macOS 上，如果条目的 ACL 里没有当前构建的代码签名（`tauri dev` 的
    /// ad-hoc 签名每次重编 cdhash 都会变），这一步会弹「允许访问钥匙串」的授权框。
    /// 因此它必须是独立方法，不允许用 `get(...).is_some()` 顶替。
    async fn exists(&self, key: &str) -> Result<bool, StoreError>;
    async fn delete(&self, key: &str) -> Result<(), StoreError>;
}

/// 拼出库里存的引用串：`keyring://{kind}/{provider}`。
pub fn secret_ref(kind: &str, provider: &str) -> String {
    format!("{REF_SCHEME}{kind}/{provider}")
}

/// 反解引用串。格式非法（缺 scheme、缺段、段为空、多段）一律返回 `None`。
pub fn parse_secret_ref(raw: &str) -> Option<(String, String)> {
    let rest = raw.strip_prefix(REF_SCHEME)?;
    let (kind, provider) = rest.split_once('/')?;
    if kind.is_empty() || provider.is_empty() || provider.contains('/') {
        return None;
    }
    Some((kind.to_string(), provider.to_string()))
}

/// 把密钥值从任意消息里抹掉，防止上游错误拼接把 Key 带进日志。
fn redact(message: &str, secret: &str) -> String {
    if secret.is_empty() {
        return message.to_string();
    }
    message.replace(secret, "***")
}

// ---------------------------------------------------------------------------
// 内存实现（测试 / CI / 无桌面会话）
// ---------------------------------------------------------------------------

/// 进程内密钥存储。`Clone` 后共享同一份数据，可当作多个组件访问同一钥匙串来测。
#[derive(Debug, Clone, Default)]
pub struct MemorySecretStore {
    inner: Arc<Mutex<HashMap<String, String>>>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// 共享同一份数据的句柄。
    pub fn handle(&self) -> Self {
        self.clone()
    }

    pub fn len(&self) -> usize {
        self.inner.lock().map(|map| map.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, String>>, StoreError> {
        self.inner
            .lock()
            // `Secret` 的原文会成为 `config/invalid` 的 `value` 直送前端，因此装的是
            // **数据**（ASCII 记号）而不是文案；中文散文只能由前端词典渲染（AGENTS 规则 7）
            .map_err(|_| StoreError::secret("lock_poisoned"))
    }
}

#[async_trait::async_trait]
impl SecretStore for MemorySecretStore {
    async fn set(&self, key: &str, value: &str) -> Result<(), StoreError> {
        self.lock()?.insert(key.to_string(), value.to_string());
        Ok(())
    }

    async fn get(&self, key: &str) -> Result<Option<String>, StoreError> {
        Ok(self.lock()?.get(key).cloned())
    }

    async fn exists(&self, key: &str) -> Result<bool, StoreError> {
        Ok(self.lock()?.contains_key(key))
    }

    async fn delete(&self, key: &str) -> Result<(), StoreError> {
        self.lock()?.remove(key);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// 系统钥匙串实现
// ---------------------------------------------------------------------------

/// 系统钥匙串（macOS Keychain / Windows Credential Manager）。
///
/// keyring 的调用是阻塞的，统一跑在带超时的独立线程上（见 [`run_keychain_job`]），
/// 避免拖住 Tauri 的 async 运行时，也避免系统授权框卡死时把 IPC 一起挂住。
#[derive(Debug, Clone)]
pub struct KeyringSecretStore {
    service: String,
    /// macOS 开发构建：进程启动时的可执行文件指纹。
    ///
    /// ad-hoc 签名（`tauri dev`）下，钥匙串条目的 ACL 与 partition 都绑定到
    /// **创建它的那次构建**的 cdhash。若二进制在进程运行期间被重编替换，钥匙串
    /// 看到的“当前应用”就会自相矛盾：ACL 记录磁盘上的新构建，partition 记录
    /// 内存里的旧构建，两边都读不出，只能弹系统授权框（macOS 26.5 上还会卡死）。
    /// 因此先把启动时的文件状态钉住：一旦变化就快速失败，让用户重启后再保存。
    #[cfg(all(target_os = "macos", debug_assertions))]
    exe: Option<ExeStamp>,
    /// 串行化钥匙串调用：上一次调用若卡在系统授权框上超时，后台线程仍在跑，
    /// 后续调用必须立刻回 `keychain_busy`，不能继续堆线程、继续弹框。
    busy: Arc<AtomicBool>,
}

impl KeyringSecretStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            #[cfg(all(target_os = "macos", debug_assertions))]
            exe: ExeStamp::capture(),
            busy: Arc::new(AtomicBool::new(false)),
        }
    }

    /// 钥匙串操作前的构建体检。
    ///
    /// 只有 macOS 开发构建需要：生产构建用稳定签名，条目的 ACL 不会随重编失效；
    /// 其它平台没有这套 ACL/partition 机制。
    #[cfg(all(target_os = "macos", debug_assertions))]
    fn ensure_build_unchanged(&self) -> Result<(), StoreError> {
        match &self.exe {
            Some(stamp) if stamp.changed() => Err(StoreError::secret("binary_replaced")),
            _ => Ok(()),
        }
    }

    #[cfg(not(all(target_os = "macos", debug_assertions)))]
    fn ensure_build_unchanged(&self) -> Result<(), StoreError> {
        Ok(())
    }

    /// 用应用默认 service 名构造。
    pub fn with_default_service() -> Self {
        Self::new(DEFAULT_SERVICE)
    }

    pub fn service(&self) -> &str {
        &self.service
    }
}

impl Default for KeyringSecretStore {
    fn default() -> Self {
        Self::with_default_service()
    }
}

fn build_entry(service: &str, key: &str, secret: &str) -> Result<keyring::Entry, StoreError> {
    keyring::Entry::new(service, key)
        .map_err(|error| StoreError::secret(redact(&error.to_string(), secret)))
}

/// 钥匙串调用的兜底时限。
///
/// 正常读写是毫秒级；超时基本只有一个原因：系统授权框没有返回。
/// macOS 26.5 上已观察到“输完密码点允许后卡在 securityd 的 decrypt”，
/// 不设时限会让整个 IPC 永远挂着。
const KEYCHAIN_TIMEOUT: Duration = Duration::from_secs(10);

/// 进入钥匙串调用的独占闸门；Drop 时松开。
///
/// 放在**后台线程**里而不是 async 调用方：调用方超时返回后，线程可能还卡在
/// securityd 上，这时闸门必须保持关闭，阻止后续调用再堆一个线程。
struct KeychainGate {
    busy: Arc<AtomicBool>,
}

impl KeychainGate {
    fn enter(busy: &Arc<AtomicBool>) -> Result<Self, StoreError> {
        busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| Self { busy: busy.clone() })
            .map_err(|_| StoreError::secret("keychain_busy"))
    }
}

impl Drop for KeychainGate {
    fn drop(&mut self) {
        self.busy.store(false, Ordering::SeqCst);
    }
}

async fn run_keychain_job<T, F>(busy: Arc<AtomicBool>, job: F) -> Result<T, StoreError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, StoreError> + Send + 'static,
{
    run_keychain_job_with(KEYCHAIN_TIMEOUT, busy, job).await
}

async fn run_keychain_job_with<T, F>(
    timeout: Duration,
    busy: Arc<AtomicBool>,
    job: F,
) -> Result<T, StoreError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, StoreError> + Send + 'static,
{
    let gate = KeychainGate::enter(&busy)?;

    // 用独立的 OS 线程而不是 `spawn_blocking`：Security.framework 的调用一旦卡在
    // 系统授权框上就无法取消，而 Tokio 的 blocking pool 在 runtime 关闭时会等它，
    // 测试/退出路径会被一起拖住。独立线程超时后直接放弃即可，进程退出不等待。
    let (tx, rx) = tokio::sync::oneshot::channel();
    let spawned = std::thread::Builder::new()
        .name("keychain-io".to_string())
        .spawn(move || {
            let _gate = gate;
            let _ = tx.send(job());
        });
    if spawned.is_err() {
        // 闭包随失败一起 drop，`_gate` 已在上面构造，松开闸门。
        return Err(StoreError::secret("keychain_thread_unavailable"));
    }

    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(StoreError::secret("keychain_thread_closed")),
        // 只保证调用方（Tauri IPC）能按时返回，不把界面一起拖死。
        // 用户关掉系统授权框后，后台线程会自行结束并松开闸门。
        Err(_) => Err(StoreError::secret("keychain_timeout")),
    }
}

/// 进程启动时的可执行文件指纹，用来识别“运行期间二进制被重编替换”。
#[cfg(all(target_os = "macos", debug_assertions))]
#[derive(Debug, Clone)]
struct ExeStamp {
    path: std::path::PathBuf,
    len: u64,
    modified: Option<std::time::SystemTime>,
    inode: u64,
}

#[cfg(all(target_os = "macos", debug_assertions))]
impl ExeStamp {
    fn capture() -> Option<Self> {
        let path = std::env::current_exe().ok()?;
        // `current_exe` 可能是符号链接；用真实路径取元数据，避免链接本身不变造成误判。
        let path = std::fs::canonicalize(&path).unwrap_or(path);
        Self::of(&path)
    }

    fn of(path: &std::path::Path) -> Option<Self> {
        use std::os::unix::fs::MetadataExt;
        let meta = std::fs::metadata(path).ok()?;
        Some(Self {
            path: path.to_path_buf(),
            len: meta.len(),
            modified: meta.modified().ok(),
            inode: meta.ino(),
        })
    }

    fn changed(&self) -> bool {
        match Self::of(&self.path) {
            Some(now) => {
                now.len != self.len || now.modified != self.modified || now.inode != self.inode
            }
            // 文件消失/不可读同样视为已变化：继续读钥匙串只会弹授权框。
            None => true,
        }
    }
}

/// 只查属性、不取 data。
///
/// macOS 的 legacy Keychain 把「解密」当作需要 ACL 授权的动作：条目存在、但当前
/// 二进制不在它的可信应用列表里时，`SecKeychainFindGenericPassword` 会弹系统授权框。
/// `SecItemCopyMatching` + `kSecReturnAttributes` 只读元数据，不触发那条路径——
/// 这也是 `security find-generic-password`（不带 `-g`）能列出属性却不问密码的原因。
#[cfg(target_os = "macos")]
fn entry_exists(service: &str, key: &str) -> Result<bool, StoreError> {
    use security_framework::item::{ItemClass, ItemSearchOptions};
    use security_framework::os::macos::keychain::{SecKeychain, SecPreferencesDomain};

    /// `errSecItemNotFound`：没找到不是错误，就是「未配置」。
    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

    // keyring 的 apple store 默认用 login keychain（`MacKeychainDomain::User`），
    // 这里显式限定同一个 keychain，避免读到同名但不同库的条目。
    let keychain = SecKeychain::default_for_domain(SecPreferencesDomain::User)
        .map_err(|error| StoreError::secret(error.to_string()))?;

    let mut search = ItemSearchOptions::new();
    search
        .keychains(&[keychain])
        .class(ItemClass::generic_password())
        .service(service)
        .account(key)
        .load_attributes(true)
        .load_data(false)
        .limit(1);

    match search.search() {
        Ok(items) => Ok(!items.is_empty()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(false),
        Err(error) => Err(StoreError::secret(error.to_string())),
    }
}

#[async_trait::async_trait]
impl SecretStore for KeyringSecretStore {
    async fn set(&self, key: &str, value: &str) -> Result<(), StoreError> {
        self.ensure_build_unchanged()?;
        let service = self.service.clone();
        let key = key.to_string();
        let value = value.to_string();
        run_keychain_job(self.busy.clone(), move || {
            // 先删后建：条目的 ACL 绑定创建它的构建（ad-hoc 签名下是 cdhash）。
            // 原地 `set_password` 只改数据、不刷新 ACL，旧构建留下的条目会在
            // 下一次读取时弹授权框。删除是幂等的，也不会解密旧值。
            let stale = build_entry(&service, &key, &value)?;
            match stale.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(error) => {
                    return Err(StoreError::secret(redact(&error.to_string(), &value)));
                }
            }
            let fresh = build_entry(&service, &key, &value)?;
            fresh
                .set_password(&value)
                .map_err(|error| StoreError::secret(redact(&error.to_string(), &value)))
        })
        .await
    }

    async fn get(&self, key: &str) -> Result<Option<String>, StoreError> {
        self.ensure_build_unchanged()?;
        let service = self.service.clone();
        let key = key.to_string();
        run_keychain_job(self.busy.clone(), move || {
            let entry = build_entry(&service, &key, "")?;
            match entry.get_password() {
                Ok(value) => Ok(Some(value)),
                // 没存过不是错误，交给上层显示「未配置」。
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(StoreError::secret(error.to_string())),
            }
        })
        .await
    }

    async fn exists(&self, key: &str) -> Result<bool, StoreError> {
        self.ensure_build_unchanged()?;
        let service = self.service.clone();
        let key = key.to_string();
        run_keychain_job(self.busy.clone(), move || {
            #[cfg(target_os = "macos")]
            {
                entry_exists(&service, &key)
            }
            // Windows 的凭据管理器没有「读取即弹授权框」这一层，沿用普通读取即可。
            #[cfg(not(target_os = "macos"))]
            {
                let entry = build_entry(&service, &key, "")?;
                match entry.get_password() {
                    Ok(_) => Ok(true),
                    Err(keyring::Error::NoEntry) => Ok(false),
                    Err(error) => Err(StoreError::secret(error.to_string())),
                }
            }
        })
        .await
    }

    async fn delete(&self, key: &str) -> Result<(), StoreError> {
        self.ensure_build_unchanged()?;
        let service = self.service.clone();
        let key = key.to_string();
        run_keychain_job(self.busy.clone(), move || {
            let entry = build_entry(&service, &key, "")?;
            match entry.delete_credential() {
                Ok(()) => Ok(()),
                // 幂等：本来就没有也算删除成功。
                Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(StoreError::secret(error.to_string())),
            }
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn memory_store_set_get_delete() {
        let store = MemorySecretStore::default();
        assert_eq!(store.get("llm/deepseek").await.unwrap(), None);

        store.set("llm/deepseek", "sk-abc").await.unwrap();
        assert_eq!(
            store.get("llm/deepseek").await.unwrap().as_deref(),
            Some("sk-abc")
        );

        store.set("llm/deepseek", "sk-def").await.unwrap();
        assert_eq!(
            store.get("llm/deepseek").await.unwrap().as_deref(),
            Some("sk-def")
        );

        store.delete("llm/deepseek").await.unwrap();
        assert_eq!(store.get("llm/deepseek").await.unwrap(), None);
    }

    #[tokio::test]
    async fn deleting_unset_key_is_ok() {
        let store = MemorySecretStore::default();
        store.delete("llm/never-set").await.unwrap();
    }

    /// 设置页只需要「配没配」，不该为了看一眼状态去解密（macOS legacy Keychain
    /// 的解密路径在开发构建上会弹 ACL 授权框，见 `SettingsService::secret_status`）。
    #[tokio::test]
    async fn memory_store_exists_tracks_presence() {
        let store = MemorySecretStore::default();
        assert!(!store.exists("llm/deepseek").await.unwrap());

        store.set("llm/deepseek", "sk-abc").await.unwrap();
        assert!(store.exists("llm/deepseek").await.unwrap());

        store.delete("llm/deepseek").await.unwrap();
        assert!(!store.exists("llm/deepseek").await.unwrap());
    }

    #[tokio::test]
    async fn memory_store_is_shared_across_clones() {
        let store = MemorySecretStore::default();
        let handle = store.handle();
        handle.set("llm/moonshot", "sk-m").await.unwrap();
        assert_eq!(
            store.get("llm/moonshot").await.unwrap().as_deref(),
            Some("sk-m")
        );
    }

    #[test]
    fn secret_ref_shape_is_stable() {
        assert_eq!(secret_ref("llm", "deepseek"), "keyring://llm/deepseek");
        assert_eq!(secret_ref("llm", "moonshot"), "keyring://llm/moonshot");
    }

    #[test]
    fn parse_secret_ref_roundtrips() {
        assert_eq!(
            parse_secret_ref("keyring://llm/deepseek"),
            Some(("llm".to_string(), "deepseek".to_string()))
        );
        assert_eq!(parse_secret_ref("keyring://llm/"), None);
        assert_eq!(parse_secret_ref("keyring://llm"), None);
        assert_eq!(parse_secret_ref("https://llm/deepseek"), None);
        assert_eq!(parse_secret_ref(""), None);
    }

    #[test]
    fn secret_errors_never_leak_the_value() {
        let secret = "sk-super-secret-value";
        // 模拟上游把密钥拼进错误消息：`redact` 必须把它抹掉再落进 StoreError
        let upstream = format!("写入钥匙串失败：{secret}");
        let error = StoreError::secret(redact(&upstream, secret));
        assert_eq!(error.code(), "config/invalid");
        assert!(!error.to_string().contains(secret));
        assert!(error.to_string().contains("***"), "应留下脱敏占位符");
    }

    #[test]
    fn redact_keeps_message_intact_when_secret_absent() {
        assert_eq!(redact("钥匙串不可用", "sk-nope"), "钥匙串不可用");
        assert_eq!(redact("任何消息", ""), "任何消息", "空密钥不得触发全量替换");
    }

    #[tokio::test]
    async fn keychain_job_timeout_is_reported_as_secret_error() {
        let started = std::time::Instant::now();
        let busy = Arc::new(AtomicBool::new(false));
        let error = run_keychain_job_with(Duration::from_millis(20), busy, || {
            std::thread::sleep(Duration::from_millis(200));
            Ok::<(), StoreError>(())
        })
        .await
        .unwrap_err();

        assert!(
            started.elapsed() < Duration::from_millis(150),
            "超时必须先于阻塞任务返回"
        );
        assert_eq!(error.params()["reason"], "secret_unavailable");
        assert_eq!(error.params()["value"], "keychain_timeout");
    }

    #[tokio::test]
    async fn keychain_job_returns_fast_result() {
        let busy = Arc::new(AtomicBool::new(false));
        let value = run_keychain_job_with(Duration::from_secs(5), busy, || Ok::<_, StoreError>(7))
            .await
            .unwrap();
        assert_eq!(value, 7);
    }

    #[tokio::test]
    async fn a_stuck_keychain_job_blocks_new_jobs_until_it_finishes() {
        let busy = Arc::new(AtomicBool::new(false));
        let first_busy = busy.clone();
        let first = tokio::spawn(async move {
            run_keychain_job_with(Duration::from_secs(5), first_busy, || {
                std::thread::sleep(Duration::from_millis(300));
                Ok::<(), StoreError>(())
            })
            .await
        });

        // 等第一单真正占住闸门，再发第二单。
        tokio::time::sleep(Duration::from_millis(50)).await;
        let error =
            run_keychain_job_with(Duration::from_secs(5), busy, || Ok::<(), StoreError>(()))
                .await
                .unwrap_err();
        assert_eq!(error.params()["reason"], "secret_unavailable");
        assert_eq!(error.params()["value"], "keychain_busy");

        first.await.unwrap().unwrap();
    }

    #[cfg(all(target_os = "macos", debug_assertions))]
    #[test]
    fn exe_stamp_detects_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("geo-desktop");
        std::fs::write(&path, b"build-a").unwrap();
        let stamp = ExeStamp::of(&path).expect("stamp");
        assert!(!stamp.changed());

        std::fs::write(&path, b"build-b-larger").unwrap();
        assert!(stamp.changed(), "二进制被替换后必须被识别");
    }

    #[cfg(all(target_os = "macos", debug_assertions))]
    #[tokio::test]
    async fn stale_binary_is_rejected_before_touching_the_keychain() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("geo-desktop");
        std::fs::write(&path, b"build-a").unwrap();
        let stamp = ExeStamp::of(&path).unwrap();
        std::fs::write(&path, b"build-b-larger").unwrap();

        let store = KeyringSecretStore {
            service: "com.gaodekuai.geo.test.stale".to_string(),
            exe: Some(stamp),
            busy: Arc::new(AtomicBool::new(false)),
        };
        let error = store.set("llm/probe", "sk-probe").await.unwrap_err();
        assert_eq!(error.params()["reason"], "secret_unavailable");
        assert_eq!(error.params()["value"], "binary_replaced");
        assert!(!error.to_string().contains("sk-probe"));
    }

    #[tokio::test]
    async fn keyring_store_reports_unavailable_as_secret_error_not_panic() {
        // CI/无桌面会话下钥匙串可能不可用：必须返回 `StoreError::Secret`，不能 panic。
        let store = KeyringSecretStore::new("com.gaodekuai.geo.test");
        let outcome = store.set("llm/probe", "sk-probe").await;
        match outcome {
            Ok(()) => {
                assert_eq!(
                    store.get("llm/probe").await.unwrap().as_deref(),
                    Some("sk-probe")
                );
                store.delete("llm/probe").await.unwrap();
            }
            Err(error) => {
                assert!(matches!(&error, StoreError::Secret(_)));
                assert!(
                    !error.to_string().contains("sk-probe"),
                    "错误信息不得回显密钥"
                );
            }
        }
    }
}

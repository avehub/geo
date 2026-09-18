//! 密钥存储：系统钥匙串实现 + 测试/无头环境用的内存实现。
//!
//! 红线（见 `AGENTS.md`）：**API Key 永不入库、永不入日志、永不进错误信息**。
//! 数据库里只存 [`secret_ref`] 生成的引用串（形如 `keyring://llm/deepseek`），
//! 值只活在系统钥匙串与进程内存里。
//!
//! 所有从 keyring 冒出来的错误都会经 [`redact`] 兜一遍，确保即便上游
//! 把参数拼进消息，也不会把密钥带出来。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

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
            .map_err(|_| StoreError::secret("内存密钥存储已损坏（锁中毒）"))
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
/// keyring 的调用是阻塞的，统一丢进 `spawn_blocking`，避免拖住 Tauri 的 async 运行时。
#[derive(Debug, Clone)]
pub struct KeyringSecretStore {
    service: String,
}

impl KeyringSecretStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
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

#[async_trait::async_trait]
impl SecretStore for KeyringSecretStore {
    async fn set(&self, key: &str, value: &str) -> Result<(), StoreError> {
        let service = self.service.clone();
        let key = key.to_string();
        let value = value.to_string();
        tokio::task::spawn_blocking(move || {
            let entry = build_entry(&service, &key, &value)?;
            entry
                .set_password(&value)
                .map_err(|error| StoreError::secret(redact(&error.to_string(), &value)))
        })
        .await
        .map_err(|error| StoreError::secret(error.to_string()))?
    }

    async fn get(&self, key: &str) -> Result<Option<String>, StoreError> {
        let service = self.service.clone();
        let key = key.to_string();
        tokio::task::spawn_blocking(move || {
            let entry = build_entry(&service, &key, "")?;
            match entry.get_password() {
                Ok(value) => Ok(Some(value)),
                // 没存过不是错误，交给上层显示「未配置」。
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(StoreError::secret(error.to_string())),
            }
        })
        .await
        .map_err(|error| StoreError::secret(error.to_string()))?
    }

    async fn delete(&self, key: &str) -> Result<(), StoreError> {
        let service = self.service.clone();
        let key = key.to_string();
        tokio::task::spawn_blocking(move || {
            let entry = build_entry(&service, &key, "")?;
            match entry.delete_credential() {
                Ok(()) => Ok(()),
                // 幂等：本来就没有也算删除成功。
                Err(keyring::Error::NoEntry) => Ok(()),
                Err(error) => Err(StoreError::secret(error.to_string())),
            }
        })
        .await
        .map_err(|error| StoreError::secret(error.to_string()))?
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

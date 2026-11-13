//! 应用设置（`settings` 表，按段落存 JSON）。
//!
//! 设计取舍：设置按**段落**（proxy / concurrency / rate_limit / model / notify / language /
//! privacy / storage）分行存 JSON，而不是拆成几十个标量列。原因是这些配置几乎总是整段读写，
//! 且 P0-B 的采集调度还会继续往 `concurrency` / `rate_limit` 里加字段——
//! 段落化让加字段不需要写迁移。
//!
//! 容错口径：**缺段落或段落 JSON 损坏都回落默认值**，不让一次设置写坏
//! 把整个应用挡在启动之外（桌面端没人能去手工修库）。

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};

use crate::codec;
use crate::error::StoreError;

const UPSERT: &str = "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) \
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at";

/// 网络代理。默认关闭：桌面端直连，需要翻墙时由用户显式打开。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub enabled: bool,
    pub url: Option<String>,
}

impl ProxyConfig {
    /// 代理地址不许内嵌 `user:pass@`（P2-08）。
    ///
    /// `proxy` 段是**整段明文**进 `settings` 表的：凭据一旦落库就会随备份、导出与
    /// 错误 params 扩散，而 `settings` 表不是钥匙串（AGENTS 规则 3）。带认证的代理
    /// 正确形态是「地址进 settings + 凭据进 `SecretStore`」——那要迁移号与前端表单，
    /// 属共享接缝，本轮不做，因此这里先把这种形态整体拒掉。
    ///
    /// 判据是**文本级**的：`scheme://` 之后、第一个 `/` `?` `#` 之前的 authority 段里
    /// 出现 `@` 即视为内嵌凭据。不用 `url::Url`（本 crate 不依赖 `url`，也不为此加依赖），
    /// 顺带把**解析不出来的**串（端口写错、scheme 拼错）一并拦住——判不了的输入不该
    /// 成为凭据的藏身处。空 userinfo（`http://@h`）同样拒：它没有合法用途，
    /// 放过只会让判据出现两个版本。与 `enabled` 无关：关着的代理照样落库。
    ///
    /// 🔴 错误里**不带** `value`：params 会原样出到前端与日志，回显即泄漏。
    pub fn validate(&self) -> Result<(), StoreError> {
        let Some(url) = self
            .url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())
        else {
            return Ok(());
        };
        if proxy_url_authority(url).contains('@') {
            return Err(StoreError::validation("proxy.url", "not_allowed"));
        }
        Ok(())
    }
}

/// 取出 `scheme://` 之后、第一个 `/` `?` `#` 之前的 authority 段（没有 `://` 时取整串）。
fn proxy_url_authority(url: &str) -> &str {
    let rest = match url.split_once("://") {
        Some((_, rest)) => rest,
        None => url,
    };
    match rest.find(['/', '?', '#']) {
        Some(index) => &rest[..index],
        None => rest,
    }
}

/// 采集并发（P0-B 的队列调度直接消费）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConcurrencyConfig {
    pub max_parallel: u8,
    pub queue_size: usize,
}

impl Default for ConcurrencyConfig {
    fn default() -> Self {
        Self {
            max_parallel: 3,
            queue_size: 200,
        }
    }
}

/// 频控与重试。默认值刻意保守：目标是"别被引擎封"，不是"跑得快"。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RateLimitConfig {
    pub requests_per_minute: u32,
    pub min_interval_ms: u64,
    pub retry_max: u8,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            requests_per_minute: 20,
            min_interval_ms: 1500,
            retry_max: 3,
        }
    }
}

/// `ModelConfig.protocol` 的默认值。老库没有这个字段时按 OpenAI 兼容处理
/// （Plan B 的 demo 契约先冻结的值）。
fn default_protocol() -> String {
    "openai_compat".to_string()
}

/// 模型预设。`model` 为 `None` 表示用 provider 的默认模型。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelConfig {
    pub provider: String,
    pub model: Option<String>,
    /// 接口地址覆盖：`custom` 必填（spec FR-L1），预设 provider 填了则覆盖
    /// （企业内网网关 / 自建代理）。`None` 或空白表示用 provider 预设地址。
    /// 后加字段，`serde(default)` 保证老库里的 settings JSON 仍能读出。
    #[serde(default)]
    pub base_url: Option<String>,
    /// 模型协议（Plan B · DR-34）。今天只有 `openai_compat` 真的能发请求；
    /// `anthropic` 允许保存，但 `LlmFactory::config_from_settings` 会在发请求前拒绝。
    /// 后加字段，`serde(default = "default_protocol")` 保证老库仍能读出。
    #[serde(default = "default_protocol")]
    pub protocol: String,
    pub temperature: f32,
    pub timeout_secs: u64,
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self {
            provider: "deepseek".to_string(),
            model: None,
            base_url: None,
            protocol: default_protocol(),
            temperature: 0.3,
            timeout_secs: 60,
        }
    }
}

/// 通知偏好。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NotifyConfig {
    pub on_finish: bool,
    pub on_risk: bool,
    pub sound: bool,
}

impl Default for NotifyConfig {
    fn default() -> Self {
        Self {
            on_finish: true,
            on_risk: true,
            sound: false,
        }
    }
}

/// 与存储相关的**可写**偏好；只读事实（数据目录、库大小）走 `app_environment`。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct StorageConfig {
    /// 上次导出用的目录；从没导出过是 `None`。
    pub last_export_dir: Option<String>,
}

/// 全量应用设置。序列化形状即前端契约（snake_case）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppSettings {
    pub proxy: Option<ProxyConfig>,
    pub concurrency: ConcurrencyConfig,
    pub rate_limit: RateLimitConfig,
    pub model: ModelConfig,
    pub language: String,
    pub notify: NotifyConfig,
    /// 后加段落：同上。
    #[serde(default)]
    pub storage: StorageConfig,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            proxy: None,
            concurrency: ConcurrencyConfig::default(),
            rate_limit: RateLimitConfig::default(),
            model: ModelConfig::default(),
            language: "zh_cn".to_string(),
            notify: NotifyConfig::default(),
            storage: StorageConfig::default(),
        }
    }
}

#[derive(Debug, FromRow)]
struct SettingRow {
    key: String,
    value: String,
}

#[derive(Debug, Clone)]
pub struct SettingsRepo {
    pool: SqlitePool,
}

impl SettingsRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// 读取全量设置；缺失或损坏的段落回落默认值。
    pub async fn get(&self) -> Result<AppSettings, StoreError> {
        let rows = sqlx::query_as::<_, SettingRow>("SELECT key, value FROM settings")
            .fetch_all(&self.pool)
            .await?;

        let defaults = AppSettings::default();
        Ok(AppSettings {
            proxy: read_section(&rows, "proxy").unwrap_or(defaults.proxy),
            concurrency: read_section(&rows, "concurrency").unwrap_or(defaults.concurrency),
            rate_limit: read_section(&rows, "rate_limit").unwrap_or(defaults.rate_limit),
            model: read_section(&rows, "model").unwrap_or(defaults.model),
            notify: read_section(&rows, "notify").unwrap_or(defaults.notify),
            language: read_section(&rows, "language").unwrap_or(defaults.language),
            storage: read_section(&rows, "storage").unwrap_or(defaults.storage),
        })
    }

    /// 全量写回（逐段 upsert）。
    ///
    /// 🔴 写库前先过 `ProxyConfig::validate`：service 层用的是**同一份判据**，
    /// 这一道是给「绕过 service 直写 `SettingsRepo`」的路径兜底（P2-08）。
    /// 拒绝即整批不写——不留半份设置。
    pub async fn update(&self, settings: &AppSettings) -> Result<(), StoreError> {
        if let Some(proxy) = &settings.proxy {
            proxy.validate()?;
        }
        let updated_at = codec::encode_time(&Utc::now());
        // 2026-11-13 摘除 privacy 段：老库里的 `privacy` 行留在表中但不再读取（前向兼容）。
        let sections: [(&str, serde_json::Value); 7] = [
            ("proxy", serde_json::to_value(&settings.proxy)?),
            ("concurrency", serde_json::to_value(&settings.concurrency)?),
            ("rate_limit", serde_json::to_value(&settings.rate_limit)?),
            ("model", serde_json::to_value(&settings.model)?),
            ("notify", serde_json::to_value(&settings.notify)?),
            ("language", serde_json::to_value(&settings.language)?),
            ("storage", serde_json::to_value(&settings.storage)?),
        ];

        let mut transaction = self.pool.begin().await?;
        for (key, value) in sections {
            sqlx::query(UPSERT)
                .bind(key)
                .bind(value.to_string())
                .bind(&updated_at)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        Ok(())
    }
}

/// 取一个段落；键不存在或 JSON 解析失败都返回 `None`（由调用方回落默认值）。
fn read_section<T: DeserializeOwned>(rows: &[SettingRow], key: &str) -> Option<T> {
    let raw = rows.iter().find(|row| row.key == key)?.value.as_str();
    match serde_json::from_str::<T>(raw) {
        Ok(value) => Some(value),
        Err(error) => {
            // 设置被写坏不应该阻塞启动，但要留痕便于排查。
            tracing::warn!(section = key, %error, "设置段落解析失败，回落默认值");
            None
        }
    }
}

use serde::de::DeserializeOwned;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[tokio::test]
    async fn empty_store_returns_defaults() {
        let repo = SettingsRepo::new(open_in_memory().await.unwrap());
        assert_eq!(repo.get().await.unwrap(), AppSettings::default());
    }

    /// `base_url` 是后加的字段：老库里存的 settings JSON 没有它，必须照样能读出来。
    #[test]
    fn model_base_url_defaults_to_none_and_survives_a_roundtrip() {
        assert_eq!(ModelConfig::default().base_url, None);

        let mut value = serde_json::to_value(AppSettings::default()).unwrap();
        value["model"].as_object_mut().unwrap().remove("base_url");
        let legacy: AppSettings = serde_json::from_value(value).unwrap();
        assert_eq!(legacy.model.base_url, None);

        let mut settings = AppSettings::default();
        settings.model.provider = "custom".to_string();
        settings.model.base_url = Some("https://api.example.com/v1".to_string());
        let json = serde_json::to_string(&settings).unwrap();
        assert_eq!(
            serde_json::from_str::<AppSettings>(&json).unwrap(),
            settings
        );
    }

    /// 老库里的 settings JSON 只有六段，且 `ModelConfig` 没有 `protocol`：
    /// 三个新字段都必须走 serde 默认值，不能因缺字段整包反序列化失败。
    #[test]
    fn legacy_settings_without_storage_or_protocol_still_load() {
        let mut value = serde_json::to_value(AppSettings::default()).unwrap();
        value.as_object_mut().unwrap().remove("storage");
        value["model"].as_object_mut().unwrap().remove("protocol");

        let legacy: AppSettings = serde_json::from_value(value).expect("老库 JSON 必须能读");
        assert_eq!(legacy.storage, StorageConfig::default());
        assert_eq!(legacy.storage.last_export_dir, None);
        assert_eq!(legacy.model.protocol, "openai_compat");
    }

    /// 2026-11-13 摘除开关组：老库 JSON 里仍带 `privacy` 段，serde 必须忽略它（前向兼容）。
    #[test]
    fn legacy_json_with_removed_privacy_section_still_loads() {
        let mut value = serde_json::to_value(AppSettings::default()).unwrap();
        value["privacy"] = serde_json::json!({
            "share_entity_card": true,
            "share_prompts": true,
            "share_crawled_text": true,
            "share_diagnostics": false
        });
        let loaded: AppSettings =
            serde_json::from_value(value).expect("含 privacy 的老库 JSON 必须能读");
        assert_eq!(loaded.storage, StorageConfig::default());
    }

    /// 三段新增内容都要能完整序列化 / 反序列化，值不被静默收敛。
    #[test]
    fn new_sections_and_protocol_roundtrip_through_json() {
        let settings = AppSettings {
            model: ModelConfig {
                protocol: "anthropic".to_string(),
                ..ModelConfig::default()
            },
            storage: StorageConfig {
                last_export_dir: Some("/Users/me/Desktop/exports".to_string()),
            },
            ..AppSettings::default()
        };

        let json = serde_json::to_string(&settings).unwrap();
        assert_eq!(
            serde_json::from_str::<AppSettings>(&json).unwrap(),
            settings
        );
    }

    #[tokio::test]
    async fn defaults_match_documented_values() {
        let settings = AppSettings::default();
        assert_eq!(settings.concurrency.max_parallel, 3);
        assert_eq!(settings.concurrency.queue_size, 200);
        assert_eq!(settings.rate_limit.requests_per_minute, 20);
        assert_eq!(settings.rate_limit.min_interval_ms, 1500);
        assert_eq!(settings.rate_limit.retry_max, 3);
        assert_eq!(settings.model.provider, "deepseek");
        assert_eq!(settings.model.model, None);
        assert_eq!(settings.model.protocol, "openai_compat");
        assert!((settings.model.temperature - 0.3).abs() < f32::EPSILON);
        assert_eq!(settings.model.timeout_secs, 60);
        assert_eq!(settings.language, "zh_cn");
        assert!(settings.notify.on_finish);
        assert!(settings.notify.on_risk);
        assert!(!settings.notify.sound);
        assert_eq!(settings.proxy, None);
        assert_eq!(settings.storage, StorageConfig::default());
    }

    #[tokio::test]
    async fn update_then_get_roundtrips() {
        let repo = SettingsRepo::new(open_in_memory().await.unwrap());
        let settings = AppSettings {
            proxy: Some(ProxyConfig {
                enabled: true,
                url: Some("http://127.0.0.1:7890".to_string()),
            }),
            concurrency: ConcurrencyConfig {
                max_parallel: 8,
                ..ConcurrencyConfig::default()
            },
            rate_limit: RateLimitConfig {
                requests_per_minute: 5,
                ..RateLimitConfig::default()
            },
            model: ModelConfig {
                provider: "moonshot".to_string(),
                model: Some("moonshot-v1-32k".to_string()),
                protocol: "anthropic".to_string(),
                ..ModelConfig::default()
            },
            notify: NotifyConfig {
                sound: true,
                ..NotifyConfig::default()
            },
            storage: StorageConfig {
                last_export_dir: Some("/Users/me/Desktop/exports".to_string()),
            },
            ..AppSettings::default()
        };

        repo.update(&settings).await.unwrap();
        assert_eq!(repo.get().await.unwrap(), settings);
    }

    /// P2-08：`proxy` 段整段明文进 settings 表，`user:pass@` 形态的凭据一旦落库就会随
    /// 备份、导出与错误 params 扩散（AGENTS 规则 3 的「密钥永不落库」）。存储层因此
    /// 自带同一道闸：绕过 service 直写 `SettingsRepo` 也拦得住，且**拒绝即不写任何段落**。
    #[tokio::test]
    async fn update_rejects_a_proxy_url_with_embedded_credentials() {
        let repo = SettingsRepo::new(open_in_memory().await.unwrap());
        for url in [
            "http://u:p@127.0.0.1:7890",
            "socks5://editor@127.0.0.1:1080",
            "http://u:p@127.0.0.1:notaport",
        ] {
            let settings = AppSettings {
                proxy: Some(ProxyConfig {
                    enabled: true,
                    url: Some(url.to_string()),
                }),
                concurrency: ConcurrencyConfig {
                    max_parallel: 8,
                    ..ConcurrencyConfig::default()
                },
                ..AppSettings::default()
            };
            let error = match repo.update(&settings).await {
                Ok(()) => panic!("{url} 必须被拒绝"),
                Err(error) => error,
            };
            assert_eq!(error.code(), "validation/failed", "{url}");
            let params = error.params();
            assert_eq!(params["field"], "proxy.url", "{url}：{params:?}");
            assert_eq!(params["reason"], "not_allowed", "{url}：{params:?}");
            assert!(
                params.values().all(|value| !value.contains('@')),
                "{url}：params 不得回显凭据：{params:?}"
            );
            assert!(!error.to_string().contains('@'), "{url}：{error}");

            let loaded = repo.get().await.unwrap();
            assert_eq!(loaded.proxy, None, "{url}：拒绝即不落库");
            assert_eq!(
                loaded.concurrency,
                ConcurrencyConfig::default(),
                "{url}：同批的其他段落也不许写进去"
            );
        }
    }

    /// 反面用例：关着的代理同样拦（凭据落库与是否启用无关），不带 userinfo 的照常写。
    #[tokio::test]
    async fn update_rejects_credentials_even_when_the_proxy_is_disabled() {
        let repo = SettingsRepo::new(open_in_memory().await.unwrap());
        let settings = AppSettings {
            proxy: Some(ProxyConfig {
                enabled: false,
                url: Some("http://u:p@127.0.0.1:7890".to_string()),
            }),
            ..AppSettings::default()
        };
        assert!(repo.update(&settings).await.is_err(), "关着也要拒绝凭据");

        let clean = AppSettings {
            proxy: Some(ProxyConfig {
                enabled: true,
                url: Some("http://127.0.0.1:7890".to_string()),
            }),
            ..AppSettings::default()
        };
        repo.update(&clean).await.expect("无凭据地址可写");
        assert_eq!(repo.get().await.unwrap().proxy, clean.proxy);

        // `@` 只出现在路径/查询里不是 userinfo，判据必须切在 authority 段。
        let at_in_path = AppSettings {
            proxy: Some(ProxyConfig {
                enabled: true,
                url: Some("http://127.0.0.1:7890/path?redirect=a@b".to_string()),
            }),
            ..AppSettings::default()
        };
        repo.update(&at_in_path).await.expect("路径里的 @ 不是凭据");
    }

    #[tokio::test]
    async fn missing_section_falls_back_to_default() {
        let pool = open_in_memory().await.unwrap();
        let repo = SettingsRepo::new(pool.clone());
        let settings = AppSettings {
            concurrency: ConcurrencyConfig {
                max_parallel: 9,
                ..ConcurrencyConfig::default()
            },
            ..AppSettings::default()
        };
        repo.update(&settings).await.unwrap();

        // 模拟旧版本库：删掉一个段落后，该段落应回落默认值而不是报错
        sqlx::query("DELETE FROM settings WHERE key = 'rate_limit'")
            .execute(&pool)
            .await
            .unwrap();

        let loaded = repo.get().await.unwrap();
        assert_eq!(loaded.concurrency.max_parallel, 9, "保留的段落不受影响");
        assert_eq!(loaded.rate_limit, RateLimitConfig::default());
    }

    #[tokio::test]
    async fn corrupted_section_falls_back_to_default_instead_of_failing() {
        let pool = open_in_memory().await.unwrap();
        sqlx::query("INSERT INTO settings (key, value, updated_at) VALUES ('model', '不是 JSON', '2026-09-16T00:00:00.000000000Z')")
            .execute(&pool)
            .await
            .unwrap();

        let loaded = SettingsRepo::new(pool).get().await.unwrap();
        assert_eq!(loaded.model, ModelConfig::default());
    }

    #[tokio::test]
    async fn corrupted_new_sections_fall_back_to_their_defaults() {
        let pool = open_in_memory().await.unwrap();
        for key in ["privacy", "storage"] {
            sqlx::query(
                "INSERT INTO settings (key, value, updated_at) VALUES (?, '不是 JSON', '2026-11-05T00:00:00.000000000Z')",
            )
            .bind(key)
            .execute(&pool)
            .await
            .unwrap();
        }

        let loaded = SettingsRepo::new(pool).get().await.unwrap();
        assert_eq!(loaded.storage, StorageConfig::default());
    }

    #[tokio::test]
    async fn update_is_idempotent() {
        let repo = SettingsRepo::new(open_in_memory().await.unwrap());
        let settings = AppSettings::default();
        repo.update(&settings).await.unwrap();
        repo.update(&settings).await.unwrap();
        assert_eq!(repo.get().await.unwrap(), settings);
    }
}

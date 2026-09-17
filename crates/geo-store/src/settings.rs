//! 应用设置（`settings` 表，按段落存 JSON）。
//!
//! 设计取舍：设置按**段落**（proxy / concurrency / rate_limit / model / notify / language）
//! 分行存 JSON，而不是拆成几十个标量列。原因是这些配置几乎总是整段读写，
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

/// 模型预设。`model` 为 `None` 表示用 provider 的默认模型。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelConfig {
    pub provider: String,
    pub model: Option<String>,
    pub temperature: f32,
    pub timeout_secs: u64,
}

impl Default for ModelConfig {
    fn default() -> Self {
        Self {
            provider: "deepseek".to_string(),
            model: None,
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

/// 全量应用设置。序列化形状即前端契约（snake_case）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppSettings {
    pub proxy: Option<ProxyConfig>,
    pub concurrency: ConcurrencyConfig,
    pub rate_limit: RateLimitConfig,
    pub model: ModelConfig,
    pub language: String,
    pub notify: NotifyConfig,
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
        })
    }

    /// 全量写回（逐段 upsert）。
    pub async fn update(&self, settings: &AppSettings) -> Result<(), StoreError> {
        let updated_at = codec::encode_time(&Utc::now());
        let sections: [(&str, serde_json::Value); 6] = [
            ("proxy", serde_json::to_value(&settings.proxy)?),
            ("concurrency", serde_json::to_value(&settings.concurrency)?),
            ("rate_limit", serde_json::to_value(&settings.rate_limit)?),
            ("model", serde_json::to_value(&settings.model)?),
            ("notify", serde_json::to_value(&settings.notify)?),
            ("language", serde_json::to_value(&settings.language)?),
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
        assert!((settings.model.temperature - 0.3).abs() < f32::EPSILON);
        assert_eq!(settings.model.timeout_secs, 60);
        assert_eq!(settings.language, "zh_cn");
        assert!(settings.notify.on_finish);
        assert!(settings.notify.on_risk);
        assert!(!settings.notify.sound);
        assert_eq!(settings.proxy, None);
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
                ..ModelConfig::default()
            },
            notify: NotifyConfig {
                sound: true,
                ..NotifyConfig::default()
            },
            ..AppSettings::default()
        };

        repo.update(&settings).await.unwrap();
        assert_eq!(repo.get().await.unwrap(), settings);
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
    async fn update_is_idempotent() {
        let repo = SettingsRepo::new(open_in_memory().await.unwrap());
        let settings = AppSettings::default();
        repo.update(&settings).await.unwrap();
        repo.update(&settings).await.unwrap();
        assert_eq!(repo.get().await.unwrap(), settings);
    }
}

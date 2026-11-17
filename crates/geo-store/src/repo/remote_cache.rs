//! 远程内容缓存与同步日志仓储。
//!
//! 🔴 只负责持久化，**不做验签与版本判定** —— 那是 `geo_domain::remote` 的职责
//! （纯函数、可穷举测试）。本层只保证"写进去的能原样读出来"。

use std::collections::BTreeMap;

use geo_domain::remote::{ItemKey, LocalEntry, LocalVersions};
use sqlx::{FromRow, SqlitePool};

use crate::error::StoreError;

/// 缓存条目（`body` 是产物原始字节）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteCacheEntry {
    pub item_key: ItemKey,
    pub version: u64,
    pub sha256: String,
    pub signature: String,
    pub body: Vec<u8>,
    pub accepted_at: String,
    pub source: RemoteSource,
}

/// 内容来源：设置页要如实展示"用的是远程还是内置"（I-1 的可观测面）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteSource {
    Remote,
    Builtin,
}

impl RemoteSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Remote => "remote",
            Self::Builtin => "builtin",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "remote" => Some(Self::Remote),
            "builtin" => Some(Self::Builtin),
            _ => None,
        }
    }
}

#[derive(Debug, FromRow)]
struct CacheRow {
    item_key: String,
    version: i64,
    sha256: String,
    signature: String,
    body: Vec<u8>,
    accepted_at: String,
    source: String,
}

#[derive(Debug, FromRow)]
struct KeyVersionRow {
    item_key: String,
    version: i64,
    sha256: String,
}

/// 一次同步的结果记录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncLogEntry {
    pub id: Option<i64>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: SyncStatus,
    /// 变更的 item_key 名（JSON 数组字符串）
    pub changed_items: String,
    pub degraded: bool,
    /// 🔴 只存稳定错误码，不存上游响应体原文
    pub error_code: Option<String>,
}

/// 同步状态，与迁移里的 CHECK 约束一一对应。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncStatus {
    Ok,
    Partial,
    RejectedDigest,
    RejectedSignature,
    RolledBack,
    Unavailable,
}

impl SyncStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Partial => "partial",
            Self::RejectedDigest => "rejected_digest",
            Self::RejectedSignature => "rejected_signature",
            Self::RolledBack => "rolled_back",
            Self::Unavailable => "unavailable",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        [
            Self::Ok,
            Self::Partial,
            Self::RejectedDigest,
            Self::RejectedSignature,
            Self::RolledBack,
            Self::Unavailable,
        ]
        .into_iter()
        .find(|v| v.as_str() == s)
    }
}

#[derive(Debug, FromRow)]
struct SyncLogRow {
    id: i64,
    started_at: String,
    finished_at: Option<String>,
    status: String,
    changed_items: String,
    degraded: i64,
    error_code: Option<String>,
}

pub struct RemoteCacheRepo {
    pool: SqlitePool,
}

impl RemoteCacheRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// 写入/覆盖一项。
    ///
    /// 🔴 `builtin` 记录可被后续 `remote` 覆盖（首次联网同步后应升级为远程版本），
    ///    反之也允许（远程不可用时回落内置）—— 用 UPSERT 而不是 INSERT，
    ///    避免"回落"路径因为主键冲突而失败。
    pub async fn put(&self, e: &RemoteCacheEntry) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO remote_cache (item_key, version, sha256, signature, body, accepted_at, source) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
             ON CONFLICT(item_key) DO UPDATE SET \
               version = excluded.version, sha256 = excluded.sha256, signature = excluded.signature, \
               body = excluded.body, accepted_at = excluded.accepted_at, source = excluded.source",
        )
        .bind(e.item_key.as_str())
        .bind(e.version as i64)
        .bind(&e.sha256)
        .bind(&e.signature)
        .bind(&e.body)
        .bind(&e.accepted_at)
        .bind(e.source.as_str())
        .execute(&self.pool)
        .await
        .map_err(StoreError::Sqlx)?;
        Ok(())
    }

    pub async fn get(&self, key: ItemKey) -> Result<Option<RemoteCacheEntry>, StoreError> {
        let row = sqlx::query_as::<_, CacheRow>(
            "SELECT item_key, version, sha256, signature, body, accepted_at, source \
             FROM remote_cache WHERE item_key = ?1",
        )
        .bind(key.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(StoreError::Sqlx)?;
        Ok(row.map(row_to_entry).transpose()?.flatten())
    }

    pub async fn all(&self) -> Result<Vec<RemoteCacheEntry>, StoreError> {
        let rows = sqlx::query_as::<_, CacheRow>(
            "SELECT item_key, version, sha256, signature, body, accepted_at, source \
             FROM remote_cache ORDER BY item_key ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(StoreError::Sqlx)?;
        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            if let Some(e) = row_to_entry(r)? {
                out.push(e);
            }
        }
        Ok(out)
    }

    /// 取"本地已接受版本"映射，直接喂给 [`geo_domain::remote::select_outdated`]。
    ///
    /// 🔴 不读 `body`：这一趟只为比对版本与摘要，把几 MB 的产物字节全捞出来
    ///    纯属浪费（同步是启动路径上的操作，要快）。
    pub async fn local_versions(&self) -> Result<LocalVersions, StoreError> {
        let rows = sqlx::query_as::<_, KeyVersionRow>(
            "SELECT item_key, version, sha256 FROM remote_cache",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(StoreError::Sqlx)?;
        let mut out: LocalVersions = BTreeMap::new();
        for r in rows {
            // 🔴 未知 item_key 直接跳过（前向兼容：新版本客户端写的缓存，
            //    老版本读到不该崩）
            if let Some(k) = ItemKey::parse(&r.item_key) {
                out.insert(
                    k,
                    LocalEntry {
                        version: r.version.max(0) as u64,
                        sha256: r.sha256,
                    },
                );
            }
        }
        Ok(out)
    }

    pub async fn log_sync(&self, e: &SyncLogEntry) -> Result<i64, StoreError> {
        let r = sqlx::query(
            "INSERT INTO remote_sync_log (started_at, finished_at, status, changed_items, degraded, error_code) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&e.started_at)
        .bind(&e.finished_at)
        .bind(e.status.as_str())
        .bind(&e.changed_items)
        .bind(i64::from(e.degraded))
        .bind(&e.error_code)
        .execute(&self.pool)
        .await
        .map_err(StoreError::Sqlx)?;
        Ok(r.last_insert_rowid())
    }

    pub async fn recent_logs(&self, limit: i64) -> Result<Vec<SyncLogEntry>, StoreError> {
        let rows = sqlx::query_as::<_, SyncLogRow>(
            "SELECT id, started_at, finished_at, status, changed_items, degraded, error_code \
             FROM remote_sync_log ORDER BY id DESC LIMIT ?1",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(StoreError::Sqlx)?;
        Ok(rows
            .into_iter()
            .map(|r| SyncLogEntry {
                id: Some(r.id),
                started_at: r.started_at,
                finished_at: r.finished_at,
                // 🔴 未知状态回落 Unavailable 而不是 panic：状态枚举将来可能扩展，
                //    读日志不该因为遇到新值就整个失败
                status: SyncStatus::parse(&r.status).unwrap_or(SyncStatus::Unavailable),
                changed_items: r.changed_items,
                degraded: r.degraded != 0,
                error_code: r.error_code,
            })
            .collect())
    }
}

/// 行 → 领域对象。item_key 无法识别时返回 `None`（前向兼容：忽略而不是报错）。
fn row_to_entry(r: CacheRow) -> Result<Option<RemoteCacheEntry>, StoreError> {
    let Some(item_key) = ItemKey::parse(&r.item_key) else {
        return Ok(None);
    };
    // 🔴 用 Validation/invalid_format（本 crate 没有 Corrupt 变体）：
    //    这是"我们自己写的形状判据不通过"，按 error.rs 的 reason key 目录归类。
    let source = RemoteSource::parse(&r.source).ok_or_else(|| {
        let mut extra = BTreeMap::new();
        // 🔴 只回显 source 这一个枚举字段的值（'remote'/'builtin'），
        //    不含 body/signature —— 那些可能很大且属产物内容。
        extra.insert("value".to_string(), r.source.clone());
        StoreError::Validation {
            field: "remote_cache.source".to_string(),
            reason: "invalid_format".to_string(),
            extra,
        }
    })?;
    Ok(Some(RemoteCacheEntry {
        item_key,
        version: r.version.max(0) as u64,
        sha256: r.sha256,
        signature: r.signature,
        body: r.body,
        accepted_at: r.accepted_at,
        source,
    }))
}

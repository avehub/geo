//! SQLite 连接建立与迁移执行（所有 SQL 连接的单一入口，P0-D 换 SQLCipher 只改此处）。

use std::path::Path;
use std::str::FromStr;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::error::StoreError;

/// 生产连接池上限：桌面单机场景 4 条足够，且避免 WAL 写者互相饿死。
pub const MAX_CONNECTIONS: u32 = 4;
/// `PRAGMA busy_timeout`：并发写等待上限。
pub const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// 打开（必要时创建）磁盘数据库：建父目录、WAL、外键、busy_timeout，并执行迁移。
pub async fn open(path: &Path) -> Result<SqlitePool, StoreError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        tokio::fs::create_dir_all(parent).await?;
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(BUSY_TIMEOUT);
    connect(options, MAX_CONNECTIONS).await
}

/// 打开进程内内存库。`max_connections=1` 保证所有查询复用同一连接，避免内存库丢失。
pub async fn open_in_memory() -> Result<SqlitePool, StoreError> {
    let options = SqliteConnectOptions::from_str("sqlite::memory:")?
        .foreign_keys(true)
        .busy_timeout(BUSY_TIMEOUT);
    connect(options, 1).await
}

/// 建立连接池并执行迁移。`min_connections == max_connections`：
/// `connect_with` 会同步把连接补满，池大小在 `open` 返回时即确定（内存库必须为 1，否则连接间数据不共享）。
async fn connect(
    options: SqliteConnectOptions,
    max_connections: u32,
) -> Result<SqlitePool, StoreError> {
    let pool = SqlitePoolOptions::new()
        .max_connections(max_connections)
        .min_connections(max_connections)
        .connect_with(options)
        .await?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(sqlx::Error::from)?;
    tracing::info!(max_connections, "SQLite 连接池就绪，迁移已校验");
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    const TS: &str = "2026-09-16T00:00:00.000000000Z";

    /// spec 3.1 节要求的全部表。
    const EXPECTED_TABLES: [&str; 8] = [
        "projects",
        "entity_cards",
        "entity_card_revisions",
        "competitors",
        "project_assets",
        "prompt_sets",
        "prompt_items",
        "settings",
    ];

    async fn table_names(pool: &SqlitePool) -> Vec<String> {
        let rows = sqlx::query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .fetch_all(pool)
            .await
            .unwrap();
        rows.iter()
            .map(|row| row.get::<String, _>("name"))
            .collect()
    }

    async fn count(pool: &SqlitePool, sql: &'static str) -> i64 {
        sqlx::query(sql)
            .fetch_one(pool)
            .await
            .unwrap()
            .get::<i64, _>(0)
    }

    async fn insert_project_graph(pool: &SqlitePool, project_id: &str) {
        sqlx::query(
            "INSERT INTO projects (id, name, brand_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(project_id)
        .bind("稿得快")
        .bind("稿得快")
        .bind(TS)
        .bind(TS)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO competitors (id, project_id, name, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind("c-1")
        .bind(project_id)
        .bind("SheepGeo")
        .bind(TS)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO project_assets (id, project_id, url, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind("a-1")
        .bind(project_id)
        .bind("https://www.gaodekuai.com")
        .bind(TS)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO entity_cards (project_id, fields, created_at, updated_at) VALUES (?, ?, ?, ?)",
        )
        .bind(project_id)
        .bind("{}")
        .bind(TS)
        .bind(TS)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO entity_card_revisions (id, project_id, field_path, edited_at) VALUES (?, ?, ?, ?)",
        )
        .bind("r-1")
        .bind(project_id)
        .bind("standard_name")
        .bind(TS)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO prompt_sets (id, project_id, version, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind("s-1")
        .bind(project_id)
        .bind(1)
        .bind(TS)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO prompt_items (id, set_id, text, intent, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind("i-1")
        .bind("s-1")
        .bind("水泵品牌推荐")
        .bind("purchase_recommendation")
        .bind(TS)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn open_creates_parent_dir_and_runs_migrations() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data").join("geo.db");

        let pool = open(&path).await.expect("首次打开应建库并迁移");

        assert!(path.exists(), "数据库文件应被创建");
        assert!(dir.path().join("data").is_dir(), "父目录应被创建");
        assert_eq!(count(&pool, "SELECT count(*) FROM projects").await, 0);
        let tables = table_names(&pool).await;
        for table in EXPECTED_TABLES {
            assert!(tables.iter().any(|name| name == table), "缺少表 {table}");
        }
        pool.close().await;
    }

    #[tokio::test]
    async fn open_enables_wal_and_foreign_keys_and_busy_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let pool = open(&dir.path().join("geo.db")).await.unwrap();

        let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await
            .unwrap();
        let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&pool)
            .await
            .unwrap();
        let busy_timeout: i64 = sqlx::query_scalar("PRAGMA busy_timeout")
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(journal_mode.to_lowercase(), "wal");
        assert_eq!(foreign_keys, 1);
        assert_eq!(busy_timeout, 5_000);
        assert_eq!(pool.size(), MAX_CONNECTIONS, "磁盘库连接池应为 4");
        pool.close().await;
    }

    #[tokio::test]
    async fn open_is_idempotent_and_keeps_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("geo.db");

        let first = open(&path).await.unwrap();
        insert_project_graph(&first, "p-1").await;
        let applied = count(&first, "SELECT count(*) FROM _sqlx_migrations").await;
        assert!(applied > 0, "首次打开应至少应用一条迁移");
        first.close().await;

        // 重复 open：迁移不重复执行、数据仍在。
        let second = open(&path).await.expect("重复打开应幂等");
        assert_eq!(count(&second, "SELECT count(*) FROM projects").await, 1);
        assert_eq!(count(&second, "SELECT count(*) FROM competitors").await, 1);
        assert_eq!(
            count(&second, "SELECT count(*) FROM _sqlx_migrations").await,
            applied,
            "迁移只应记录一次（不随迁移文件增加而写死条数）"
        );
        second.close().await;
    }

    #[tokio::test]
    async fn in_memory_pool_is_migrated_and_isolated() {
        let pool = open_in_memory().await.unwrap();
        let tables = table_names(&pool).await;
        for table in EXPECTED_TABLES {
            assert!(
                tables.iter().any(|name| name == table),
                "内存库缺少表 {table}"
            );
        }
        let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(foreign_keys, 1, "内存库同样需要外键");
        assert_eq!(pool.size(), 1, "内存库必须单连接，否则数据不共享");

        let other = open_in_memory().await.unwrap();
        insert_project_graph(&pool, "p-1").await;
        assert_eq!(
            count(&other, "SELECT count(*) FROM projects").await,
            0,
            "内存库之间应互相隔离"
        );
    }

    #[tokio::test]
    async fn deleting_project_cascades_to_all_children() {
        let pool = open_in_memory().await.unwrap();
        insert_project_graph(&pool, "p-1").await;
        sqlx::query("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
            .bind("language")
            .bind("\"zh-CN\"")
            .bind(TS)
            .execute(&pool)
            .await
            .unwrap();

        sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind("p-1")
            .execute(&pool)
            .await
            .unwrap();

        for sql in [
            "SELECT count(*) FROM projects",
            "SELECT count(*) FROM competitors",
            "SELECT count(*) FROM project_assets",
            "SELECT count(*) FROM entity_cards",
            "SELECT count(*) FROM entity_card_revisions",
            "SELECT count(*) FROM prompt_sets",
            "SELECT count(*) FROM prompt_items",
        ] {
            assert_eq!(count(&pool, sql).await, 0, "级联删除失败：{sql}");
        }
        // settings 与项目无关，不应被误删。
        assert_eq!(count(&pool, "SELECT count(*) FROM settings").await, 1);
    }

    #[tokio::test]
    async fn child_row_without_parent_is_rejected() {
        let pool = open_in_memory().await.unwrap();
        let result = sqlx::query(
            "INSERT INTO competitors (id, project_id, name, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind("c-1")
        .bind("missing-project")
        .bind("SheepGeo")
        .bind(TS)
        .execute(&pool)
        .await;
        assert!(result.is_err(), "外键应拒绝孤儿行");
    }
}

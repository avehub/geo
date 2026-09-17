//! Task 16：SQLite 连接、WAL、busy_timeout 与初始迁移。

mod common;

use common::{count_rows, scalar_i64, scalar_string, table_names};
use geo_store::{open, open_in_memory};
use sqlx::{AssertSqlSafe, SqlitePool};

/// spec 第 3.1 节要求的全部业务表。
const TABLES: [&str; 8] = [
    "projects",
    "entity_cards",
    "entity_card_revisions",
    "competitors",
    "project_assets",
    "prompt_sets",
    "prompt_items",
    "settings",
];

async fn column_names(pool: &SqlitePool, table: &str) -> Vec<String> {
    // 表名来自本文件内的常量，不含外部输入。
    sqlx::query_scalar::<sqlx::Sqlite, String>(AssertSqlSafe(format!(
        "SELECT name FROM pragma_table_info('{table}') ORDER BY cid"
    )))
    .fetch_all(pool)
    .await
    .expect("读取列清单")
}

/// 用原生 SQL 播种一棵完整的项目子图（每个子表各一行）。
async fn seed_project_graph(pool: &SqlitePool, project_id: &str, set_id: &str) {
    let now = "2026-09-16T08:00:00.000000000Z";
    sqlx::query(
        "INSERT INTO projects (id, name, brand_name, aliases, website, region, language, \
         industry, industry_label, tags, status, archived_at, created_at, updated_at) \
         VALUES ($1,'水泵项目','稿得快','[\"GDK\"]','https://www.gaodekuai.com','华东','zh_cn', \
         'enterprise_saas',NULL,'[\"SaaS\"]','active',NULL,$2,$2)",
    )
    .bind(project_id)
    .bind(now)
    .execute(pool)
    .await
    .expect("插入项目");
    sqlx::query(
        "INSERT INTO competitors (id, project_id, name, aliases, website, note, position, created_at) \
         VALUES ('c-1',$1,'竞品A','[\"A\"]','https://a.example',NULL,0,$2)",
    )
    .bind(project_id)
    .bind(now)
    .execute(pool)
    .await
    .expect("插入竞品");
    sqlx::query(
        "INSERT INTO project_assets (id, project_id, kind, url, title, note, created_at) \
         VALUES ('a-1',$1,'owned_page','https://www.gaodekuai.com',NULL,NULL,$2)",
    )
    .bind(project_id)
    .bind(now)
    .execute(pool)
    .await
    .expect("插入资产");
    sqlx::query(
        "INSERT INTO entity_cards (project_id, fields, field_status, source, completeness, created_at, updated_at) \
         VALUES ($1,'{\"standard_name\":\"稿得快\"}','{\"standard_name\":\"official\"}','{}',1.0,$2,$2)",
    )
    .bind(project_id)
    .bind(now)
    .execute(pool)
    .await
    .expect("插入实体卡");
    sqlx::query(
        "INSERT INTO entity_card_revisions (id, project_id, field_path, old_value, new_value, status, note, edited_at) \
         VALUES ('r-1',$1,'standard_name',NULL,'\"稿得快\"','official',NULL,$2)",
    )
    .bind(project_id)
    .bind(now)
    .execute(pool)
    .await
    .expect("插入修订");
    sqlx::query(
        "INSERT INTO prompt_sets (id, project_id, version, label, item_count, content_hash, \
         engine_scope, metric_spec_version, sample_size_grade, created_at, notes) \
         VALUES ($1,$2,1,'v1',1,'hash','[]','geo-metrics-v1','insufficient',$3,NULL)",
    )
    .bind(set_id)
    .bind(project_id)
    .bind(now)
    .execute(pool)
    .await
    .expect("插入 prompt 集");
    sqlx::query(
        "INSERT INTO prompt_items (id, set_id, text, intent, weight, group_name, tags, source, \
         competitor_ids, repeat_count, position, created_at) \
         VALUES ('p-1',$1,'哪家更好？','brand_comparison',3,NULL,'[]','template','[]',1,0,$2)",
    )
    .bind(set_id)
    .bind(now)
    .execute(pool)
    .await
    .expect("插入 prompt 条目");
    sqlx::query(
        "INSERT INTO settings (\"key\", value, updated_at) VALUES ('language','\"zh-CN\"',$1)",
    )
    .bind(now)
    .execute(pool)
    .await
    .expect("插入设置");
}

async fn child_counts(pool: &SqlitePool) -> Vec<i64> {
    let mut counts = Vec::new();
    for table in [
        "competitors",
        "project_assets",
        "entity_cards",
        "entity_card_revisions",
        "prompt_sets",
        "prompt_items",
    ] {
        counts.push(count_rows(pool, table).await);
    }
    counts
}

#[tokio::test]
async fn in_memory_pool_runs_migrations_and_creates_all_tables() {
    let pool = open_in_memory().await.expect("内存库应可打开");
    let names = table_names(&pool).await;
    for table in TABLES {
        assert!(names.iter().any(|name| name == table), "缺少表 {table}");
    }
    assert!(
        names.iter().any(|name| name == "_sqlx_migrations"),
        "迁移记录表应存在"
    );
    assert_eq!(count_rows(&pool, "projects").await, 0);
}

#[tokio::test]
async fn schema_columns_match_spec() {
    let pool = open_in_memory().await.unwrap();
    assert_eq!(
        column_names(&pool, "projects").await,
        [
            "id",
            "name",
            "brand_name",
            "aliases",
            "website",
            "region",
            "language",
            "industry",
            "industry_label",
            "tags",
            "status",
            "archived_at",
            "created_at",
            "updated_at"
        ]
    );
    assert_eq!(
        column_names(&pool, "entity_cards").await,
        [
            "project_id",
            "fields",
            "field_status",
            "source",
            "completeness",
            "created_at",
            "updated_at"
        ]
    );
    assert_eq!(
        column_names(&pool, "entity_card_revisions").await,
        [
            "id",
            "project_id",
            "field_path",
            "old_value",
            "new_value",
            "status",
            "note",
            "edited_at"
        ]
    );
    assert_eq!(
        column_names(&pool, "competitors").await,
        [
            "id",
            "project_id",
            "name",
            "aliases",
            "website",
            "note",
            "position",
            "created_at"
        ]
    );
    assert_eq!(
        column_names(&pool, "project_assets").await,
        [
            "id",
            "project_id",
            "kind",
            "url",
            "title",
            "note",
            "created_at"
        ]
    );
    assert_eq!(
        column_names(&pool, "prompt_sets").await,
        [
            "id",
            "project_id",
            "version",
            "label",
            "item_count",
            "content_hash",
            "engine_scope",
            "metric_spec_version",
            "sample_size_grade",
            "created_at",
            "notes"
        ]
    );
    assert_eq!(
        column_names(&pool, "prompt_items").await,
        [
            "id",
            "set_id",
            "text",
            "intent",
            "weight",
            "group_name",
            "tags",
            "source",
            "competitor_ids",
            "repeat_count",
            "position",
            "created_at"
        ]
    );
    assert_eq!(
        column_names(&pool, "settings").await,
        ["key", "value", "updated_at"]
    );
}

#[tokio::test]
async fn open_creates_missing_parent_directory_and_migrates() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested").join("app_data").join("geo.db");
    assert!(!path.exists());
    let pool = open(&path).await.expect("应自动创建父目录");
    assert!(path.exists(), "数据库文件应被创建");
    assert_eq!(count_rows(&pool, "projects").await, 0);
}

#[tokio::test]
async fn open_is_idempotent_and_keeps_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("geo.db");
    let project_id = geo_domain::ProjectId::new().to_string();
    let set_id = geo_domain::PromptSetId::new().to_string();
    {
        let pool = open(&path).await.unwrap();
        seed_project_graph(&pool, &project_id, &set_id).await;
        pool.close().await;
    }
    // 二次打开：迁移不重复执行，历史数据仍在。
    let pool = open(&path).await.expect("重复 open 应幂等");
    assert_eq!(count_rows(&pool, "projects").await, 1);
    assert_eq!(count_rows(&pool, "prompt_items").await, 1);
    let applied: i64 = scalar_i64(&pool, "SELECT count(*) FROM _sqlx_migrations").await;
    assert!(applied >= 1, "迁移记录应存在");
}

#[tokio::test]
async fn open_enables_wal_foreign_keys_and_busy_timeout() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("geo.db");
    let pool = open(&path).await.unwrap();
    assert_eq!(
        scalar_string(&pool, "PRAGMA journal_mode")
            .await
            .to_lowercase(),
        "wal"
    );
    assert_eq!(scalar_i64(&pool, "PRAGMA foreign_keys").await, 1);
    assert_eq!(scalar_i64(&pool, "PRAGMA busy_timeout").await, 5000);
    assert!(path.with_extension("db-wal").exists(), "WAL 文件应存在");
    assert!(pool.size() >= 1, "连接池应已建立连接");
}

#[tokio::test]
async fn file_pool_caps_connections_at_four() {
    let dir = tempfile::tempdir().unwrap();
    let pool = open(&dir.path().join("geo.db")).await.unwrap();
    let mut held = Vec::new();
    for _ in 0..4 {
        held.push(pool.acquire().await.expect("上限内应能取到连接"));
    }
    assert_eq!(pool.size(), 4, "已建立的连接数不应超过上限 4");
    // 第 5 条连接应被池挡住（默认 acquire_timeout 30s，这里只等 100ms）。
    let fifth = tokio::time::timeout(std::time::Duration::from_millis(100), pool.acquire()).await;
    assert!(fifth.is_err(), "持有 4 条连接时不应再分配到第 5 条");
    drop(held);
    assert!(pool.acquire().await.is_ok(), "释放后应能重新取到连接");
}

#[tokio::test]
async fn foreign_keys_are_enforced() {
    let pool = open_in_memory().await.unwrap();
    let err = sqlx::query(
        "INSERT INTO competitors (id, project_id, name, aliases, website, note, position, created_at) \
         VALUES ('c-1','missing-project','竞品A','[]',NULL,NULL,0,'2026-09-16T08:00:00Z')",
    )
    .execute(&pool)
    .await
    .expect_err("外键应拒绝孤儿竞品");
    assert!(
        err.to_string().contains("FOREIGN KEY"),
        "应是外键约束错误，实际：{err}"
    );
}

#[tokio::test]
async fn deleting_project_cascades_to_all_children() {
    let pool = open_in_memory().await.unwrap();
    let project_id = geo_domain::ProjectId::new().to_string();
    let set_id = geo_domain::PromptSetId::new().to_string();
    seed_project_graph(&pool, &project_id, &set_id).await;
    assert_eq!(
        child_counts(&pool).await,
        vec![1; 6],
        "播种后每张子表各 1 行"
    );
    // settings 不属于项目，级联删除不应影响它。
    assert_eq!(count_rows(&pool, "settings").await, 1);

    sqlx::query("DELETE FROM projects WHERE id = $1")
        .bind(&project_id)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        child_counts(&pool).await,
        vec![0; 6],
        "删项目后竞品/资产/实体卡/修订/prompt 集与条目应全部级联删除"
    );
    assert_eq!(count_rows(&pool, "settings").await, 1);
}

#[tokio::test]
async fn deleting_prompt_set_cascades_to_items() {
    let pool = open_in_memory().await.unwrap();
    let project_id = geo_domain::ProjectId::new().to_string();
    let set_id = geo_domain::PromptSetId::new().to_string();
    seed_project_graph(&pool, &project_id, &set_id).await;
    sqlx::query("DELETE FROM prompt_sets WHERE id = $1")
        .bind(&set_id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(count_rows(&pool, "prompt_items").await, 0);
    assert_eq!(count_rows(&pool, "projects").await, 1);
}

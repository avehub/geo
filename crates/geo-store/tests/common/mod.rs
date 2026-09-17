//! 测试公共工具：固定时钟与领域对象样例构造器（全部离线，不碰网络与真实钥匙串）。
#![allow(dead_code)]

use chrono::{DateTime, TimeZone, Utc};
use geo_domain::{
    AssetKind, Competitor, CompetitorId, Contact, EntityCard, EntityCardSource, EntityFields,
    FieldStatus, Industry, IntentCategory, Language, ProductSpec, Project, ProjectAsset, ProjectId,
    ProjectStatus, PromptItem, PromptSet, PromptSetId, PromptSource,
};
use sqlx::{AssertSqlSafe, SqlitePool};

/// 固定时间基准，避免测试依赖真实时钟。
pub fn base_time() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 16, 8, 0, 0).unwrap()
}

/// `base_time` 之后 `secs` 秒。
pub fn later(secs: i64) -> DateTime<Utc> {
    base_time() + chrono::Duration::seconds(secs)
}

pub async fn table_names(pool: &SqlitePool) -> Vec<String> {
    sqlx::query_scalar::<sqlx::Sqlite, String>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .expect("读取表清单")
}

/// 统计单表行数；`table` 仅接受本 crate 已知的表名（测试内部使用）。
pub async fn count_rows(pool: &SqlitePool, table: &str) -> i64 {
    // 表名来自本文件内的常量，不含外部输入。
    sqlx::query_scalar::<sqlx::Sqlite, i64>(AssertSqlSafe(format!("SELECT count(*) FROM {table}")))
        .fetch_one(pool)
        .await
        .expect("统计行数")
}

pub async fn scalar_string(pool: &SqlitePool, sql: &str) -> String {
    sqlx::query_scalar::<sqlx::Sqlite, String>(AssertSqlSafe(sql.to_string()))
        .fetch_one(pool)
        .await
        .expect("读取标量")
}

pub async fn scalar_i64(pool: &SqlitePool, sql: &str) -> i64 {
    sqlx::query_scalar::<sqlx::Sqlite, i64>(AssertSqlSafe(sql.to_string()))
        .fetch_one(pool)
        .await
        .expect("读取标量")
}

pub fn sample_project(name: &str) -> Project {
    let now = base_time();
    Project {
        id: ProjectId::new(),
        name: name.to_string(),
        brand_name: "稿得快".to_string(),
        aliases: vec!["GDK".to_string(), "gaodekuai".to_string()],
        website: Some("https://www.gaodekuai.com".to_string()),
        region: "华东".to_string(),
        language: Language::ZhCn,
        industry: Industry::EnterpriseSaas,
        industry_label: Some("企业服务".to_string()),
        tags: vec!["SaaS".to_string(), "GEO".to_string()],
        status: ProjectStatus::Active,
        archived_at: None,
        created_at: now,
        updated_at: now,
    }
}

pub fn sample_competitor(project_id: ProjectId, name: &str, position: i32) -> Competitor {
    Competitor {
        id: CompetitorId::new(),
        project_id,
        name: name.to_string(),
        aliases: vec![format!("{name}-alias")],
        website: Some("https://competitor.example".to_string()),
        note: Some("同框竞品".to_string()),
        position,
        created_at: base_time(),
    }
}

pub fn sample_asset(project_id: ProjectId, url: &str) -> ProjectAsset {
    ProjectAsset::new(
        project_id,
        AssetKind::OwnedPage,
        url,
        Some("官网首页".to_string()),
        Some("自动建档入口".to_string()),
        base_time(),
    )
    .expect("合法 URL")
}

pub fn sample_fields() -> EntityFields {
    EntityFields {
        standard_name: "稿得快".to_string(),
        aliases: vec!["GDK".to_string()],
        founded_year: Some(2024),
        qualifications: vec!["ISO9001".to_string()],
        products: vec![ProductSpec {
            name: "GEO 客户端".to_string(),
            params: vec!["7 引擎".to_string()],
            note: Some("桌面端".to_string()),
        }],
        price_range: Some("按年订阅".to_string()),
        service_regions: vec!["全国".to_string()],
        cases: vec!["某制造企业".to_string()],
        differentiators: vec!["离线优先".to_string()],
        official_tone: Some("克制、以数据说话".to_string()),
        contact: Some(Contact {
            phone: Some("021-0000".to_string()),
            email: Some("hi@example.com".to_string()),
            address: None,
        }),
    }
}

pub fn sample_entity_card(project_id: ProjectId) -> EntityCard {
    EntityCard::from_manual(project_id, sample_fields(), base_time())
}

pub fn sample_entity_card_with_source(project_id: ProjectId) -> EntityCard {
    let source = EntityCardSource {
        crawled_pages: vec!["https://www.gaodekuai.com".to_string()],
        llm_provider: Some("deepseek".to_string()),
        llm_model: Some("deepseek-chat".to_string()),
        generated_at: Some(base_time()),
    };
    let mut card = EntityCard::from_extraction(project_id, sample_fields(), source, base_time());
    card.field_status
        .insert("standard_name".to_string(), FieldStatus::Disputed);
    card
}

pub fn sample_items(set_id: PromptSetId, count: usize) -> Vec<PromptItem> {
    let intents = IntentCategory::all();
    (0..count)
        .map(|index| {
            let intent = intents[index % intents.len()];
            let mut item = PromptItem::new(
                set_id,
                format!(
                    "{} 行业里哪家 GEO 工具更适合中小企业？{}",
                    intent.label_zh(),
                    index
                ),
                intent,
            );
            item.weight = (index % 5 + 1) as u8;
            item.repeat_count = (index % 3 + 1) as u8;
            item.source = PromptSource::Generated;
            item.tags = vec![format!("t{}", index % 4)];
            item.group_name = Some(intent.label_zh().to_string());
            item.competitor_ids = vec![CompetitorId::new()];
            item.position = index as i32;
            item
        })
        .collect()
}

pub fn sample_prompt_set(project_id: ProjectId, version: i32, count: usize) -> PromptSet {
    let mut set = PromptSet::new(
        project_id,
        version,
        format!("第 {version} 轮题库"),
        Vec::new(),
        base_time(),
        Some("自动生成".to_string()),
    );
    set.items = sample_items(set.id, count);
    set.engine_scope = vec!["deepseek".to_string(), "doubao".to_string()];
    set.refresh();
    set
}

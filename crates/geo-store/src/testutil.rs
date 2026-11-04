//! 单元测试夹具：固定时钟与领域对象样例。
//!
//! 全部离线构造，不访问网络、文件系统与真实钥匙串（见 `AGENTS.md` 硬性规则 2/3）。
#![allow(dead_code)]

use chrono::{DateTime, Duration, TimeZone, Utc};
use geo_domain::{
    AssetKind, Competitor, CompetitorId, Contact, ContentStatus, EntityCard, EntityCardRevision,
    EntityCardSource, EntityFields, FaqId, FaqItem, FieldStatus, Industry, IntentCategory, KbEntry,
    KbEntryId, KbEntryKind, KbModule, KbScenario, KbSource, KeywordId, KeywordItem, KeywordKind,
    Language, LibrarySource, ProductSpec, Project, ProjectAsset, ProjectId, ProjectStatus,
    PromptItem, PromptSet, PromptSetId, PromptSource, RevisionId,
};

/// 固定基准时间，避免测试依赖真实时钟。
pub(crate) fn base_time() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 16, 8, 0, 0).unwrap()
}

/// 基准时间之后 `secs` 秒。
pub(crate) fn later(secs: i64) -> DateTime<Utc> {
    base_time() + Duration::seconds(secs)
}

/// 字段填满的项目样例：`aliases` / `tags` 走 JSON 列，`industry_label` 走可空列。
pub(crate) fn sample_project(name: &str) -> Project {
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
        created_at: base_time(),
        updated_at: base_time(),
    }
}

pub(crate) fn sample_competitor(project_id: ProjectId, name: &str, position: i32) -> Competitor {
    Competitor {
        id: CompetitorId::new(),
        project_id,
        name: name.to_string(),
        aliases: vec![format!("{name}别名")],
        website: Some("https://competitor.example".to_string()),
        note: Some("同框竞品".to_string()),
        position,
        created_at: base_time(),
    }
}

pub(crate) fn sample_asset(project_id: ProjectId, url: &str) -> ProjectAsset {
    ProjectAsset::new(
        project_id,
        AssetKind::OwnedPage,
        url,
        Some("官网首页".to_string()),
        Some("自动建档入口".to_string()),
        base_time(),
    )
    .expect("样例 URL 合法")
}

pub(crate) fn sample_fields() -> EntityFields {
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

/// 人工录入来源的实体卡：`field_status` 覆盖全部 11 个字段。
pub(crate) fn sample_entity_card(project_id: ProjectId) -> EntityCard {
    EntityCard::from_manual(project_id, sample_fields(), base_time())
}

/// AI 抽取来源的实体卡：`source` 非空，且含一个被标记为存疑的字段。
pub(crate) fn sample_entity_card_with_source(project_id: ProjectId) -> EntityCard {
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

pub(crate) fn sample_revision(
    project_id: ProjectId,
    field_path: &str,
    edited_at: DateTime<Utc>,
) -> EntityCardRevision {
    EntityCardRevision {
        id: RevisionId::new(),
        project_id,
        field_path: field_path.to_string(),
        old_value: Some(serde_json::json!("旧值")),
        new_value: Some(serde_json::json!("新值")),
        status: FieldStatus::Official,
        note: Some("人工核对官网".to_string()),
        edited_at,
    }
}

/// 覆盖 7 类意图、weight / repeat_count / tags / competitor_ids 各不相同的条目。
pub(crate) fn sample_items(set_id: PromptSetId, count: usize) -> Vec<PromptItem> {
    let intents = IntentCategory::all();
    (0..count)
        .map(|index| {
            let intent = intents[index % intents.len()];
            let mut item = PromptItem::new(
                set_id,
                format!(
                    "{}场景下哪家 GEO 工具更适合中小企业？{}",
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

pub(crate) fn sample_prompt_set(project_id: ProjectId, version: i32, count: usize) -> PromptSet {
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

pub(crate) fn sample_keyword(project_id: ProjectId, text: &str, position: i32) -> KeywordItem {
    KeywordItem {
        id: KeywordId::new(),
        project_id,
        text: text.to_string(),
        kind: KeywordKind::Core,
        intent: IntentCategory::CategoryAwareness,
        monthly_volume: Some(1200),
        difficulty: Some(30),
        priority: 3,
        status: ContentStatus::Approved,
        note: Some("样例素材".to_string()),
        source: LibrarySource::Manual,
        position,
        created_at: base_time(),
        updated_at: base_time(),
    }
}

pub(crate) fn sample_faq(project_id: ProjectId, question: &str, position: i32) -> FaqItem {
    FaqItem {
        id: FaqId::new(),
        project_id,
        question: question.to_string(),
        answer_markdown: "- 视压差而定\n- 一般 3~6 个月".to_string(),
        category: Some("售后".to_string()),
        intent: IntentCategory::AfterSalesReputation,
        status: ContentStatus::Approved,
        source: LibrarySource::Manual,
        position,
        created_at: base_time(),
        updated_at: base_time(),
    }
}

pub(crate) fn sample_kb_entry(project_id: ProjectId, title: &str, position: i32) -> KbEntry {
    KbEntry {
        id: KbEntryId::new(),
        project_id,
        module: KbModule::SalesScript,
        kind: KbEntryKind::Statement,
        title: title.to_string(),
        body_markdown: "我们帮客户做 GEO。".to_string(),
        url: None,
        mime: None,
        tags: vec!["开场".to_string()],
        status: ContentStatus::Approved,
        source: KbSource::Manual,
        scenario: Some(KbScenario::SalesFirstContact),
        verified_at: None,
        position,
        created_at: base_time(),
        updated_at: base_time(),
    }
}

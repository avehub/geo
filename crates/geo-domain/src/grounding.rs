//! 生成依据（grounding）：把品牌实体卡与已核实知识库压成一段可审计的模型上下文。
//!
//! 设计规格：`docs/superpowers/specs/2026-11-19-generation-grounding-design.md`。
//!
//! 纪律：
//! - 只做纯函数，不读库、不调模型；
//! - 实体卡字段按 `FieldStatus` 分流：`Official` 才可作为事实引用，
//!   `Pending` / `Disputed` 只能作为背景并显式标注「不得当作事实断言」；
//! - 知识库只收 `status = approved` **且** `verified_at` 非空的条目；
//! - 预算按字符计，超出时先降条数、再截正文，并返回被省略的条数。

use crate::compliance::ContentStatus;
use crate::entity_card::{EntityCard, EntityFields, FieldStatus, ProductSpec, ALL_FIELDS};
use crate::kb::{KbEntry, KbModule};
use crate::project::Project;

/// 单个知识条目正文进入上下文前的截断上限。
pub const MAX_KB_BODY_CHARS: usize = 600;

/// 生成上下文预算。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GroundingBudget {
    pub max_knowledge_items: usize,
    pub max_knowledge_chars: usize,
}

impl Default for GroundingBudget {
    fn default() -> Self {
        Self {
            max_knowledge_items: 8,
            max_knowledge_chars: 3_000,
        }
    }
}

/// 生成用途：决定默认参考哪些知识模块。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenerationPurpose {
    Keyword,
    Faq,
    Knowledge,
    Prompt,
    Article,
}

impl GenerationPurpose {
    /// 该用途默认参考的知识模块。调用方可以覆盖（如文章模板的 `kb_modules`）。
    pub fn modules(self) -> &'static [KbModule] {
        match self {
            Self::Keyword => &[
                KbModule::Product,
                KbModule::SellingPoint,
                KbModule::Case,
                KbModule::Audience,
            ],
            Self::Faq => &[
                KbModule::Product,
                KbModule::SupportScript,
                KbModule::SalesScript,
                KbModule::Case,
                KbModule::Qualification,
            ],
            Self::Knowledge => &[
                KbModule::Brand,
                KbModule::Product,
                KbModule::SellingPoint,
                KbModule::Case,
                KbModule::Qualification,
                KbModule::Audience,
                KbModule::Tone,
                KbModule::Competitor,
                KbModule::SalesScript,
                KbModule::SupportScript,
            ],
            Self::Prompt => &[
                KbModule::Audience,
                KbModule::SellingPoint,
                KbModule::Competitor,
                KbModule::Case,
                KbModule::Product,
            ],
            Self::Article => &[
                KbModule::Brand,
                KbModule::Product,
                KbModule::SellingPoint,
                KbModule::Case,
                KbModule::Qualification,
                KbModule::Audience,
                KbModule::Tone,
            ],
        }
    }
}

/// 一次 grounding 的输入。
pub struct GroundingInput<'a> {
    pub project: &'a Project,
    pub card: Option<&'a EntityCard>,
    pub entries: &'a [KbEntry],
    pub modules: &'a [KbModule],
    pub focus: &'a [String],
    pub budget: GroundingBudget,
}

/// 压好的生成依据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grounding {
    pub facts: String,
    pub knowledge: String,
    pub fact_fields: Vec<&'static str>,
    pub knowledge_titles: Vec<String>,
    pub omitted_entries: usize,
}

impl Grounding {
    pub fn build(input: GroundingInput<'_>) -> Self {
        let (facts, fact_fields) = render_facts(input.project, input.card);
        let (knowledge, knowledge_titles, omitted_entries) =
            render_knowledge(input.entries, input.modules, input.focus, input.budget);
        Self {
            facts,
            knowledge,
            fact_fields,
            knowledge_titles,
            omitted_entries,
        }
    }

    /// 拼成可直接塞进 Prompt 的一段。
    pub fn render(&self) -> String {
        format!(
            "{}\n{}\n【引用规则】只能把“官方口径（可作为事实引用）”与“已核实知识库”写成事实；\
             待确认/存疑内容只能作为背景，不得当作事实断言；\
             资料没有的信息写“未提供”，不得编造资质、案例、数据或效果承诺。",
            self.facts, self.knowledge
        )
    }

    /// 日志 / 说明用的一句话摘要（不是 UI 文案）。
    pub fn summary_zh(&self) -> String {
        let omitted = if self.omitted_entries == 0 {
            String::new()
        } else {
            format!("（预算省略 {} 条）", self.omitted_entries)
        };
        format!(
            "实体卡官方字段 {} 个、已核实知识 {} 条{}",
            self.fact_fields.len(),
            self.knowledge_titles.len(),
            omitted
        )
    }
}

/// 从项目与实体卡收集检索焦点词（品牌、别名、产品、卖点、案例、标签）。
pub fn focus_terms(project: &Project, card: Option<&EntityCard>) -> Vec<String> {
    let mut terms = vec![
        project.brand_name.clone(),
        project.region.clone(),
        project.industry.label_zh().to_string(),
    ];
    terms.extend(project.aliases.iter().cloned());
    terms.extend(project.tags.iter().cloned());
    if let Some(card) = card {
        let fields = &card.fields;
        terms.push(fields.standard_name.clone());
        terms.extend(fields.aliases.iter().cloned());
        terms.extend(fields.qualifications.iter().cloned());
        terms.extend(fields.service_regions.iter().cloned());
        terms.extend(fields.cases.iter().cloned());
        terms.extend(fields.differentiators.iter().cloned());
        for product in &fields.products {
            terms.push(product.name.clone());
            terms.extend(product.params.iter().cloned());
        }
    }
    terms.retain(|term| term.trim().chars().count() >= 2);
    terms.sort();
    terms.dedup();
    terms
}

fn render_facts(project: &Project, card: Option<&EntityCard>) -> (String, Vec<&'static str>) {
    let Some(card) = card else {
        let website = project.website.as_deref().unwrap_or("未填写");
        let tags = if project.tags.is_empty() {
            "未填写".to_string()
        } else {
            project.tags.join("、")
        };
        return (
            format!(
                "【品牌事实（实体卡）】\n（未建立品牌实体卡，只能使用项目档案）\n\
                 - 品牌：{}\n- 行业：{}\n- 地区：{}\n- 官网：{}\n- 项目标签：{}",
                project.brand_name,
                project.industry.label_zh(),
                project.region,
                website,
                tags
            ),
            Vec::new(),
        );
    };

    let fields = &card.fields;
    let mut official = Vec::new();
    let mut pending = Vec::new();
    let mut missing = Vec::new();
    let mut fact_fields = Vec::new();

    for field in ALL_FIELDS {
        let Some(value) = render_field(fields, field) else {
            missing.push(field_label(field));
            continue;
        };
        let label = field_label(field);
        match card.status_of(field) {
            FieldStatus::Official => {
                official.push(format!("- {label}：{value}"));
                fact_fields.push(field);
            }
            FieldStatus::Pending => pending.push(format!("- {label}：{value}（待确认）")),
            FieldStatus::Disputed => pending.push(format!("- {label}：{value}（存疑）")),
        }
    }

    let official_text = if official.is_empty() {
        "- （暂无已核实的官方口径字段）".to_string()
    } else {
        official.join("\n")
    };
    let pending_text = if pending.is_empty() {
        "- （无）".to_string()
    } else {
        pending.join("\n")
    };
    let missing_text = if missing.is_empty() {
        "无".to_string()
    } else {
        missing.join("、")
    };

    (
        format!(
            "【品牌事实（实体卡）】\n官方口径（可作为事实引用）：\n{official_text}\n\
             待确认/存疑（只能作为背景，不得当作事实断言）：\n{pending_text}\n\
             未填写：{missing_text}"
        ),
        fact_fields,
    )
}

fn render_knowledge(
    entries: &[KbEntry],
    modules: &[KbModule],
    focus: &[String],
    budget: GroundingBudget,
) -> (String, Vec<String>, usize) {
    let mut scored: Vec<(usize, &KbEntry)> = entries
        .iter()
        .filter(|entry| entry.status == ContentStatus::Approved && entry.verified_at.is_some())
        .filter(|entry| modules.is_empty() || modules.contains(&entry.module))
        .map(|entry| (focus_score(entry, focus), entry))
        .collect();

    scored.sort_by(|(score_a, a), (score_b, b)| {
        score_b
            .cmp(score_a)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
            .then_with(|| a.position.cmp(&b.position))
            .then_with(|| a.id.to_string().cmp(&b.id.to_string()))
    });

    let mut items: Vec<String> = Vec::new();
    let mut titles: Vec<String> = Vec::new();
    let mut used = 0usize;
    let mut omitted = 0usize;

    for (_, entry) in scored {
        if titles.len() >= budget.max_knowledge_items {
            omitted += 1;
            continue;
        }
        let remaining = budget.max_knowledge_chars.saturating_sub(used);
        let header = format!(
            "{}. [{}] {}",
            titles.len() + 1,
            entry.module.as_str(),
            entry.title.trim()
        );
        let body = truncate_chars(entry.body_markdown.trim(), MAX_KB_BODY_CHARS);
        let mut candidate = if body.is_empty() {
            header.clone()
        } else {
            format!("{header}\n{body}")
        };
        let cost = candidate.chars().count() + 1;
        if used + cost > budget.max_knowledge_chars {
            let body_room = remaining.saturating_sub(header.chars().count() + 2);
            if body_room < 20 {
                omitted += 1;
                continue;
            }
            candidate = format!("{header}\n{}", truncate_chars(&body, body_room));
        }
        used += candidate.chars().count() + 1;
        items.push(candidate);
        titles.push(entry.title.trim().to_string());
    }

    let mut text = if items.is_empty() {
        "【已核实知识库（可引用）】\n（暂无已核实知识条目）".to_string()
    } else {
        format!("【已核实知识库（可引用）】\n{}", items.join("\n\n"))
    };
    if omitted > 0 {
        text.push_str(&format!("\n（另有 {omitted} 条因预算未纳入）"));
    }
    (text, titles, omitted)
}

fn focus_score(entry: &KbEntry, focus: &[String]) -> usize {
    focus
        .iter()
        .filter(|term| {
            let term = term.trim();
            term.chars().count() >= 2
                && (entry.title.contains(term)
                    || entry.body_markdown.contains(term)
                    || entry.tags.iter().any(|tag| {
                        let tag = tag.trim();
                        !tag.is_empty() && (tag.contains(term) || term.contains(tag))
                    }))
        })
        .count()
}

fn render_field(fields: &EntityFields, field: &str) -> Option<String> {
    let value = match field {
        "standard_name" => non_empty(&fields.standard_name),
        "aliases" => join_non_empty(&fields.aliases),
        "founded_year" => fields.founded_year.map(|year| year.to_string()),
        "qualifications" => join_non_empty(&fields.qualifications),
        "products" => render_products(&fields.products),
        "price_range" => fields.price_range.as_deref().and_then(non_empty),
        "service_regions" => join_non_empty(&fields.service_regions),
        "cases" => join_non_empty(&fields.cases),
        "differentiators" => join_non_empty(&fields.differentiators),
        "official_tone" => fields.official_tone.as_deref().and_then(non_empty),
        "contact" => fields.contact.as_ref().and_then(render_contact),
        _ => None,
    };
    value
}

fn render_products(products: &[ProductSpec]) -> Option<String> {
    if products.is_empty() {
        return None;
    }
    let rendered = products
        .iter()
        .map(|product| {
            let mut text = product.name.trim().to_string();
            let params: Vec<&str> = product
                .params
                .iter()
                .map(|param| param.trim())
                .filter(|param| !param.is_empty())
                .collect();
            if !params.is_empty() {
                text.push_str(&format!("（参数：{}）", params.join("、")));
            }
            if let Some(note) = product
                .note
                .as_deref()
                .map(str::trim)
                .filter(|note| !note.is_empty())
            {
                text.push_str(&format!("；备注：{note}"));
            }
            text
        })
        .collect::<Vec<_>>()
        .join("；");
    non_empty(&rendered)
}

fn render_contact(contact: &crate::entity_card::Contact) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(phone) = contact
        .phone
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(format!("电话 {phone}"));
    }
    if let Some(email) = contact
        .email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(format!("邮箱 {email}"));
    }
    if let Some(address) = contact
        .address
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(format!("地址 {address}"));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("；"))
    }
}

fn join_non_empty(values: &[String]) -> Option<String> {
    let joined = values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join("、");
    non_empty(&joined)
}

fn non_empty(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn field_label(field: &str) -> &'static str {
    match field {
        "standard_name" => "标准名称",
        "aliases" => "别名",
        "founded_year" => "成立年份",
        "qualifications" => "资质认证",
        "products" => "产品",
        "price_range" => "价格区间",
        "service_regions" => "服务地域",
        "cases" => "客户案例",
        "differentiators" => "差异化卖点",
        "official_tone" => "官方口径",
        "contact" => "联系方式",
        _ => "其他",
    }
}

fn truncate_chars(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut truncated: String = text.chars().take(limit).collect();
    truncated.push('…');
    truncated
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity_card::{Contact, EntityFields};
    use crate::ids::{KbEntryId, ProjectId};
    use crate::kb::{KbEntryKind, KbSource};
    use crate::project::{Industry, Language, ProjectStatus};
    use chrono::{DateTime, Utc};

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-11-19T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn project() -> Project {
        Project {
            id: ProjectId::new(),
            name: "宏宇项目".to_string(),
            brand_name: "宏宇".to_string(),
            aliases: vec!["宏宇环保".to_string()],
            website: Some("https://example.com".to_string()),
            region: "浙江".to_string(),
            language: Language::ZhCn,
            industry: Industry::B2bManufacturing,
            industry_label: None,
            tags: vec!["水泵".to_string()],
            status: ProjectStatus::Active,
            archived_at: None,
            created_at: now(),
            updated_at: now(),
        }
    }

    fn fields() -> EntityFields {
        EntityFields {
            standard_name: "宏宇环保科技有限公司".to_string(),
            aliases: vec!["宏宇".to_string()],
            founded_year: Some(2008),
            qualifications: vec!["ISO 9001".to_string()],
            products: vec![
                ProductSpec {
                    name: "立式管道离心泵".to_string(),
                    params: vec!["流量 50m³/h".to_string(), "扬程 32m".to_string()],
                    note: Some("用于二次供水".to_string()),
                },
                ProductSpec {
                    name: "潜水排污泵".to_string(),
                    params: vec!["功率 7.5kW".to_string()],
                    note: None,
                },
            ],
            price_range: Some("2-8 万元".to_string()),
            service_regions: vec!["浙江".to_string(), "上海".to_string()],
            cases: vec!["杭州某水厂改造".to_string()],
            differentiators: vec!["耐腐蚀泵体".to_string()],
            official_tone: Some("专业、克制".to_string()),
            contact: Some(Contact {
                phone: Some("400-000-0000".to_string()),
                email: None,
                address: Some("杭州市".to_string()),
            }),
        }
    }

    fn card() -> EntityCard {
        EntityCard::from_manual(ProjectId::new(), fields(), now())
    }

    fn entry(
        title: &str,
        body: &str,
        module: KbModule,
        status: ContentStatus,
        verified: bool,
        position: i32,
    ) -> KbEntry {
        KbEntry {
            id: KbEntryId::new(),
            project_id: ProjectId::new(),
            module,
            kind: KbEntryKind::Text,
            title: title.to_string(),
            body_markdown: body.to_string(),
            url: None,
            mime: None,
            tags: Vec::new(),
            status,
            source: KbSource::Manual,
            scenario: None,
            verified_at: verified.then(now),
            position,
            created_at: now(),
            updated_at: now(),
        }
    }

    #[test]
    fn official_and_unconfirmed_fields_are_separated() {
        let project = project();
        let mut card = card();
        card.field_status
            .insert("price_range".to_string(), FieldStatus::Pending);
        card.field_status
            .insert("qualifications".to_string(), FieldStatus::Disputed);
        let grounding = Grounding::build(GroundingInput {
            project: &project,
            card: Some(&card),
            entries: &[],
            modules: &[],
            focus: &[],
            budget: GroundingBudget::default(),
        });

        let (official, pending) = grounding
            .facts
            .split_once("待确认/存疑")
            .expect("两段必须分开");
        assert!(official.contains("标准名称：宏宇环保科技有限公司"));
        assert!(official.contains("成立年份：2008"));
        assert!(!official.contains("价格区间"));
        assert!(pending.contains("价格区间：2-8 万元（待确认）"));
        assert!(pending.contains("资质认证：ISO 9001（存疑）"));
        assert!(grounding.fact_fields.contains(&"standard_name"));
        assert!(!grounding.fact_fields.contains(&"price_range"));
    }

    #[test]
    fn all_products_and_params_are_kept() {
        let project = project();
        let card = card();
        let grounding = Grounding::build(GroundingInput {
            project: &project,
            card: Some(&card),
            entries: &[],
            modules: &[],
            focus: &[],
            budget: GroundingBudget::default(),
        });
        assert!(grounding.facts.contains("立式管道离心泵"));
        assert!(grounding.facts.contains("流量 50m³/h"));
        assert!(grounding.facts.contains("潜水排污泵"));
        assert!(grounding.facts.contains("功率 7.5kW"));
    }

    #[test]
    fn only_approved_and_verified_knowledge_is_used() {
        let project = project();
        let entries = vec![
            entry(
                "已核实卖点",
                "泵体采用双相不锈钢",
                KbModule::SellingPoint,
                ContentStatus::Approved,
                true,
                0,
            ),
            entry(
                "通过但未核实",
                "未核实内容",
                KbModule::SellingPoint,
                ContentStatus::Approved,
                false,
                1,
            ),
            entry(
                "待审核内容",
                "待审内容",
                KbModule::SellingPoint,
                ContentStatus::PendingReview,
                true,
                2,
            ),
            entry(
                "已驳回内容",
                "驳回内容",
                KbModule::SellingPoint,
                ContentStatus::Rejected,
                true,
                3,
            ),
        ];
        let grounding = Grounding::build(GroundingInput {
            project: &project,
            card: None,
            entries: &entries,
            modules: &[KbModule::SellingPoint],
            focus: &[],
            budget: GroundingBudget::default(),
        });
        assert!(grounding.knowledge.contains("已核实卖点"));
        assert!(!grounding.knowledge.contains("通过但未核实"));
        assert!(!grounding.knowledge.contains("待审核内容"));
        assert!(!grounding.knowledge.contains("已驳回内容"));
        assert_eq!(grounding.knowledge_titles, vec!["已核实卖点".to_string()]);
    }

    #[test]
    fn modules_filter_the_knowledge_pool() {
        let project = project();
        let entries = vec![
            entry(
                "产品知识",
                "产品正文",
                KbModule::Product,
                ContentStatus::Approved,
                true,
                0,
            ),
            entry(
                "素材知识",
                "素材正文",
                KbModule::Media,
                ContentStatus::Approved,
                true,
                1,
            ),
        ];
        let grounding = Grounding::build(GroundingInput {
            project: &project,
            card: None,
            entries: &entries,
            modules: &[KbModule::Product],
            focus: &[],
            budget: GroundingBudget::default(),
        });
        assert!(grounding.knowledge.contains("产品知识"));
        assert!(!grounding.knowledge.contains("素材知识"));
    }

    #[test]
    fn focus_terms_rank_relevant_entries_first_and_budget_omits_the_rest() {
        let project = project();
        let entries = vec![
            entry(
                "通用产品介绍",
                "适用于各类工业场景",
                KbModule::Product,
                ContentStatus::Approved,
                true,
                0,
            ),
            entry(
                "立式管道离心泵选型",
                "按流量与扬程选型",
                KbModule::Product,
                ContentStatus::Approved,
                true,
                1,
            ),
        ];
        let focus = vec!["立式管道离心泵".to_string()];
        let grounding = Grounding::build(GroundingInput {
            project: &project,
            card: None,
            entries: &entries,
            modules: &[KbModule::Product],
            focus: &focus,
            budget: GroundingBudget {
                max_knowledge_items: 1,
                max_knowledge_chars: 3_000,
            },
        });
        assert!(grounding.knowledge.contains("立式管道离心泵选型"));
        assert!(!grounding.knowledge.contains("通用产品介绍"));
        assert_eq!(grounding.knowledge_titles.len(), 1);
        assert_eq!(grounding.omitted_entries, 1);
    }

    #[test]
    fn render_carries_the_citation_rule() {
        let project = project();
        let grounding = Grounding::build(GroundingInput {
            project: &project,
            card: None,
            entries: &[],
            modules: &[],
            focus: &[],
            budget: GroundingBudget::default(),
        });
        let rendered = grounding.render();
        assert!(rendered.contains("引用规则"));
        assert!(rendered.contains("不得当作事实断言"));
        assert!(rendered.contains("不得编造"));
    }

    #[test]
    fn focus_terms_collect_project_and_card_terms() {
        let project = project();
        let card = card();
        let terms = focus_terms(&project, Some(&card));
        assert!(terms.contains(&"宏宇".to_string()));
        assert!(terms.contains(&"宏宇环保科技有限公司".to_string()));
        assert!(terms.contains(&"立式管道离心泵".to_string()));
        assert!(terms.contains(&"耐腐蚀泵体".to_string()));
    }
}

//! 生成 Prompt 的纯组装函数。
//!
//! 设计规格：`docs/superpowers/specs/2026-11-19-generation-grounding-design.md`。
//!
//! 纪律：这里只拼字符串，不读库、不调模型；所有事实与知识的取舍都在
//! `geo_domain::grounding` 里完成。五个入口共享同一段 `【引用规则】`，
//! 避免各服务自己漏掉「不得编造」那条约束。

use geo_domain::{ArticleTemplate, Grounding, Project};

pub(crate) fn keyword_prompt(
    project: &Project,
    grounding: &Grounding,
    existing: &str,
    kinds: &str,
    target: usize,
) -> String {
    format!(
        "企业：{brand}；行业：{industry}；地区：{region}；官网：{website}\n\
         {grounding}\n\
         已有词（不要重复）：{existing}\n\
         请生成最多 {target} 条中文关键词，类型只能是：{kinds}。\n\
         要求：不使用“保证排名/第一/最/100%”等绝对化表述；只输出 JSON。",
        brand = project.brand_name,
        industry = industry_label(project),
        region = project.region,
        website = project.website.as_deref().unwrap_or("未填写"),
        grounding = grounding.render(),
        existing = if existing.is_empty() { "无" } else { existing },
    )
}

pub(crate) fn faq_prompt(
    project: &Project,
    grounding: &Grounding,
    existing: &str,
    intents: &str,
    target: usize,
) -> String {
    format!(
        "企业：{brand}；行业：{industry}；地区：{region}；官网：{website}\n\
         {grounding}\n\
         已有问题（不要重复）：{existing}\n\
         请生成最多 {target} 条中文 FAQ，意图覆盖：{intents}。\n\
         问题要像真实用户会问的；答案给可核验的事实与步骤，可用 Markdown 列表。\n\
         要求：不使用“保证排名/第一/最/100%”等绝对化表述；只输出 JSON。",
        brand = project.brand_name,
        industry = industry_label(project),
        region = project.region,
        website = project.website.as_deref().unwrap_or("未填写"),
        grounding = grounding.render(),
        existing = if existing.is_empty() { "无" } else { existing },
    )
}

pub(crate) fn kb_prompt(
    project: &Project,
    grounding: &Grounding,
    existing: &str,
    modules: &str,
    target: usize,
) -> String {
    format!(
        "企业：{brand}；行业：{industry}；地区：{region}；官网：{website}\n\
         {grounding}\n\
         已有标题（不要重复）：{existing}\n\
         请生成最多 {target} 条知识条目，模块只能是：{modules}。\n\
         每条给出 module、kind（statement/text/link/image/video/file）、title、body_markdown，\
         可选 url、mime、tags；scenario 只允许用在 sales_script / support_script。\n\
         要求：不使用“保证排名/第一/最/100%”等绝对化表述；只输出 JSON。",
        brand = project.brand_name,
        industry = industry_label(project),
        region = project.region,
        website = project.website.as_deref().unwrap_or("未填写"),
        grounding = grounding.render(),
        existing = if existing.is_empty() { "无" } else { existing },
    )
}

pub(crate) fn direction_prompt(
    project: &Project,
    grounding: &Grounding,
    existing: &str,
    target: usize,
) -> String {
    format!(
        "企业：{brand}；行业：{industry}；地区：{region}；官网：{website}\n\
         {grounding}\n\
         已有方向（不要重复）：{existing}\n\
         请给出最多 {target} 个中文内容方向，每个方向包含 title（一句话主题）与 summary\
         （写给谁、在什么场景下写）。只输出 JSON：{{\"items\":[{{\"title\":\"...\",\
         \"summary\":\"...\"}}]}}；不使用“保证排名/第一/最/100%”等绝对化表述。",
        brand = project.brand_name,
        industry = industry_label(project),
        region = project.region,
        website = project.website.as_deref().unwrap_or("未填写"),
        grounding = grounding.render(),
        existing = if existing.is_empty() { "无" } else { existing },
    )
}

pub(crate) fn article_prompt(
    project: &Project,
    rendered: &str,
    template: &ArticleTemplate,
    grounding: &Grounding,
) -> String {
    format!(
        "企业：{brand}；行业：{industry}。\n模板提示词：{rendered}\n\
         {grounding}\n\
         文风：{style}；目标字数：{length}。\n\
         只输出 JSON：{{\"title\":\"...\",\"body_markdown\":\"...\"}}；\
         不使用“保证排名/第一/最/100%”等绝对化表述，不编造资质与数据。",
        brand = project.brand_name,
        industry = industry_label(project),
        rendered = rendered,
        grounding = grounding.render(),
        style = if template.style.is_empty() {
            "专业、克制"
        } else {
            &template.style
        },
        length = template.length,
    )
}

fn industry_label(project: &Project) -> &str {
    if let Some(label) = project
        .industry_label
        .as_deref()
        .map(str::trim)
        .filter(|label| !label.is_empty())
    {
        return label;
    }
    project.industry.label_zh()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, Utc};
    use geo_domain::{
        ArticleTemplateBindings, ContentStatus, EntityCard, EntityFields, FieldStatus,
        GroundingBudget, GroundingInput, Industry, KbEntry, KbEntryId, KbEntryKind, KbModule,
        KbSource, Language, ProductSpec, ProjectId, ProjectStatus,
    };

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

    fn grounding(project: &Project) -> Grounding {
        let card = EntityCard::from_manual(
            project.id,
            EntityFields {
                standard_name: "宏宇环保科技有限公司".to_string(),
                qualifications: vec!["ISO 9001".to_string()],
                products: vec![ProductSpec {
                    name: "立式管道离心泵".to_string(),
                    params: vec!["流量 50m³/h".to_string()],
                    note: None,
                }],
                differentiators: vec!["耐腐蚀泵体".to_string()],
                ..Default::default()
            },
            now(),
        );
        let entry = KbEntry {
            id: KbEntryId::new(),
            project_id: project.id,
            module: KbModule::SellingPoint,
            kind: KbEntryKind::Text,
            title: "双相不锈钢泵体".to_string(),
            body_markdown: "泵体采用双相不锈钢，适合沿海高盐雾环境。".to_string(),
            url: None,
            mime: None,
            tags: vec!["耐腐蚀".to_string()],
            status: ContentStatus::Approved,
            source: KbSource::Manual,
            scenario: None,
            verified_at: Some(now()),
            position: 0,
            created_at: now(),
            updated_at: now(),
        };
        let focus = geo_domain::focus_terms(project, Some(&card));
        Grounding::build(GroundingInput {
            project,
            card: Some(&card),
            entries: &[entry],
            modules: &[KbModule::SellingPoint],
            focus: &focus,
            budget: GroundingBudget::default(),
        })
    }

    fn template(project: &Project) -> ArticleTemplate {
        ArticleTemplate {
            id: "t1".to_string(),
            project_id: project.id,
            direction_id: "d1".to_string(),
            name: "选型指南".to_string(),
            prompt_template: "写一篇关于{{product}}的文章".to_string(),
            slots: vec![],
            bindings: ArticleTemplateBindings::default(),
            kb_modules: vec![KbModule::SellingPoint],
            style: "专业、克制".to_string(),
            length: 1200,
            created_at: now(),
            updated_at: now(),
        }
    }

    fn assert_grounded(prompt: &str) {
        assert!(prompt.contains("宏宇环保科技有限公司"), "{prompt}");
        assert!(prompt.contains("双相不锈钢泵体"), "{prompt}");
        assert!(prompt.contains("引用规则"), "{prompt}");
        assert!(prompt.contains("不得编造"), "{prompt}");
    }

    #[test]
    fn keyword_prompt_carries_facts_and_knowledge() {
        let project = project();
        let prompt = keyword_prompt(&project, &grounding(&project), "旧词", "product", 6);
        assert_grounded(&prompt);
        assert!(prompt.contains("最多 6 条"));
        assert!(prompt.contains("product"));
    }

    #[test]
    fn faq_prompt_carries_facts_and_knowledge() {
        let project = project();
        let prompt = faq_prompt(&project, &grounding(&project), "", "售后与口碑", 4);
        assert_grounded(&prompt);
        assert!(prompt.contains("售后与口碑"));
    }

    #[test]
    fn kb_prompt_carries_facts_and_knowledge() {
        let project = project();
        let prompt = kb_prompt(&project, &grounding(&project), "", "selling_point", 3);
        assert_grounded(&prompt);
        assert!(prompt.contains("selling_point"));
    }

    #[test]
    fn direction_prompt_carries_facts_and_knowledge() {
        let project = project();
        let prompt = direction_prompt(&project, &grounding(&project), "", 5);
        assert_grounded(&prompt);
        assert!(prompt.contains("内容方向"));
    }

    #[test]
    fn article_prompt_carries_template_and_grounding() {
        let project = project();
        let template = template(&project);
        let prompt = article_prompt(
            &project,
            "写一篇关于立式管道离心泵的文章",
            &template,
            &grounding(&project),
        );
        assert_grounded(&prompt);
        assert!(prompt.contains("写一篇关于立式管道离心泵的文章"));
        assert!(prompt.contains("专业、克制"));
        assert!(prompt.contains("1200"));
    }

    #[test]
    fn unconfirmed_fields_are_not_promoted_to_facts() {
        let project = project();
        let mut card = EntityCard::from_manual(
            project.id,
            EntityFields {
                standard_name: "宏宇环保科技有限公司".to_string(),
                price_range: Some("2-8 万元".to_string()),
                ..Default::default()
            },
            now(),
        );
        card.field_status
            .insert("price_range".to_string(), FieldStatus::Pending);
        let focus = geo_domain::focus_terms(&project, Some(&card));
        let grounding = Grounding::build(GroundingInput {
            project: &project,
            card: Some(&card),
            entries: &[],
            modules: &[],
            focus: &focus,
            budget: GroundingBudget::default(),
        });
        assert!(grounding.facts.contains("价格区间：2-8 万元（待确认）"));
        assert!(!grounding.fact_fields.contains(&"price_range"));
    }
}

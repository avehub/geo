//! M2 题库模板层：占位符展开、口语化改写、竞品同框补足与配额选取。
//!
//! 本模块**全是纯函数**（无 IO、无当前时间），因此：
//! - 离线也能出题（spec FR-M2-1 的降级路径）；
//! - 每条规则都能被单测直接钉住，不需要起服务或数据库。
//!
//! 数据在同级 `catalog.rs`：通用模板 + 5 套行业模板 + 竞品同框模板。

mod catalog;

use std::collections::BTreeMap;

use geo_domain::{
    Competitor, CompetitorId, EntityCard, Industry, IntentCategory, Project, PromptItem,
    PromptSetId, PromptSource, MAX_PROMPT_CHARS, MAX_WEIGHT,
};

/// 允许的占位符名（与 spec FR-M2-1 一致）。模板里写别的名字会被测试拦下。
pub const KNOWN_PLACEHOLDERS: [&str; 9] = [
    "品类",
    "本品牌",
    "竞品A",
    "竞品B",
    "城市",
    "X",
    "场景",
    "关键参数",
    "产品",
];

/// 单条模板最多展开多少个变体：够铺开竞品/城市/场景，又不至于让候选集爆炸。
pub const MAX_VARIANTS_PER_TEMPLATE: usize = 6;

/// 本地口语化改写最多产出多少条变体（去重前）。
pub const MAX_COLLOQUIAL_VARIANTS: usize = 40;

/// 通用模板：任何行业都用，与行业模板叠加。
pub static GENERIC_TEMPLATES: &[PromptTemplate] = &catalog::GENERIC;

/// 竞品同框模板：配额补足专用，句式彼此差异明显，避免去重时被合并。
pub static COMPARISON_TEMPLATES: &[PromptTemplate] = &catalog::COMPARISON;

/// 一条模板：意图 + 带占位符的中文问法。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PromptTemplate {
    pub intent: IntentCategory,
    pub text: &'static str,
}

/// 行业模板。「其他行业」暂无专属模板，回落通用模板（用户自定义模板列 P1）。
pub fn industry_templates(industry: Industry) -> &'static [PromptTemplate] {
    match industry {
        Industry::B2bManufacturing => &catalog::B2B_MANUFACTURING,
        Industry::EnterpriseSaas => &catalog::ENTERPRISE_SAAS,
        Industry::LocalService => &catalog::LOCAL_SERVICE,
        Industry::CrossBorderEcommerce => &catalog::CROSS_BORDER,
        Industry::Franchise => &catalog::FRANCHISE,
        Industry::Other => &[],
    }
}

/// 某行业实际生效的模板集：行业模板 + 通用模板（按文本去重，行业优先）。
pub fn templates_for(industry: Industry, intents: &[IntentCategory]) -> Vec<PromptTemplate> {
    let mut seen = Vec::new();
    let mut templates = Vec::new();
    for template in industry_templates(industry)
        .iter()
        .chain(GENERIC_TEMPLATES.iter())
    {
        if !intents.contains(&template.intent) || seen.contains(&template.text) {
            continue;
        }
        seen.push(template.text);
        templates.push(*template);
    }
    templates
}

// ---------------------------------------------------------------------------
// 占位符上下文
// ---------------------------------------------------------------------------

/// 竞品引用：展开时既要知道名字，也要把 ID 写进 `competitor_ids`（SOV 用）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompetitorRef {
    pub id: CompetitorId,
    pub name: String,
}

/// 模板占位符的取值来源。全部由项目资料推导，缺料时用行业默认值兜底，
/// 保证离线（无实体卡、无模型）也能展开出通顺的中文问法。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptContext {
    pub category: String,
    pub brand: String,
    pub product: String,
    pub competitors: Vec<CompetitorRef>,
    pub cities: Vec<String>,
    pub budgets: Vec<String>,
    pub scenarios: Vec<String>,
    pub params: Vec<String>,
}

impl PromptContext {
    /// 只用项目与竞品推导（不依赖实体卡）。
    pub fn new(project: &Project, competitors: &[Competitor]) -> Self {
        let industry = project.industry;
        let mut context = Self {
            category: project
                .tags
                .first()
                .map(|tag| tag.trim().to_string())
                .filter(|tag| !tag.is_empty())
                .unwrap_or_else(|| industry.label_zh().to_string()),
            brand: project.brand_name.clone(),
            product: format!("{}的产品", project.brand_name),
            competitors: competitors
                .iter()
                .map(|competitor| CompetitorRef {
                    id: competitor.id,
                    name: competitor.name.clone(),
                })
                .collect(),
            cities: cities_from(&project.region, &[]),
            budgets: default_budgets(industry),
            scenarios: default_scenarios(industry),
            params: default_params(industry),
        };
        if context.brand.trim().is_empty() {
            context.brand = context.category.clone();
        }
        if context.cities.is_empty() {
            context.cities = default_cities();
        }
        context
    }

    /// 用实体卡里的产品、地域与参数把上下文补细（自动建档之后调用）。
    pub fn with_card(mut self, card: Option<&EntityCard>) -> Self {
        let Some(card) = card else { return self };
        let fields = &card.fields;

        if let Some(product) = fields.products.first() {
            let cleaned = clean_product_name(&product.name);
            if !cleaned.is_empty() {
                if self.category == self.brand || self.category.contains('/') {
                    self.category = cleaned.clone();
                }
                self.product = cleaned;
            }
            let params: Vec<String> = fields
                .products
                .iter()
                .flat_map(|product| product.params.iter())
                .filter_map(|param| param_label(param))
                .filter(|label| !self.params.contains(label))
                .collect();
            if params.len() >= 2 {
                self.params = params.into_iter().take(4).collect();
            }
            let scenarios: Vec<String> = fields
                .products
                .iter()
                .filter_map(|product| product.note.clone())
                .flat_map(|note| split_phrases(&note))
                .filter(|phrase| phrase.chars().count() >= 3)
                .take(4)
                .collect();
            if scenarios.len() >= 2 {
                self.scenarios = scenarios;
            }
        }
        self.cities = cities_from("", &fields.service_regions);
        if self.cities.is_empty() {
            self.cities = default_cities();
        }
        self
    }

    pub fn competitor_names(&self) -> Vec<&str> {
        self.competitors
            .iter()
            .map(|competitor| competitor.name.as_str())
            .collect()
    }
}

/// 一次展开的占位符取值。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Assignment {
    pub category: String,
    pub brand: String,
    pub product: String,
    pub city: String,
    pub budget: String,
    pub scenario: String,
    pub param: String,
    pub competitor_a: Option<CompetitorRef>,
    pub competitor_b: Option<CompetitorRef>,
}

impl Assignment {
    fn value_of(&self, placeholder: &str) -> Option<String> {
        let value = match placeholder {
            "品类" => &self.category,
            "本品牌" => &self.brand,
            "产品" => &self.product,
            "城市" => &self.city,
            "X" => &self.budget,
            "场景" => &self.scenario,
            "关键参数" => &self.param,
            "竞品A" => return self.competitor_a.as_ref().map(|item| item.name.clone()),
            "竞品B" => return self.competitor_b.as_ref().map(|item| item.name.clone()),
            _ => return None,
        };
        Some(value.clone())
    }
}

// ---------------------------------------------------------------------------
// 展开
// ---------------------------------------------------------------------------

/// 展开模板为候选 prompt（plan 里约定的入口签名）。
pub fn expand_templates(
    project: &Project,
    competitors: &[Competitor],
    templates: &[PromptTemplate],
) -> Vec<PromptItem> {
    let context = PromptContext::new(project, competitors);
    expand_with_context(&context, templates)
}

/// 用给定上下文展开模板：每条模板按占位符轴做受限笛卡尔积，再按步长抽样保证多样性。
pub fn expand_with_context(
    context: &PromptContext,
    templates: &[PromptTemplate],
) -> Vec<PromptItem> {
    let mut items = Vec::new();
    for template in templates {
        for assignment in assignments(template.text, context) {
            let Some(text) = fill(template.text, &assignment) else {
                continue;
            };
            items.push(item_from_assignment(
                text,
                template.intent,
                context,
                &assignment,
                PromptSource::Template,
                Vec::new(),
            ));
        }
    }
    items
}

/// 竞品同框补足：给每个竞品各出一段互不重叠的模板区间（spec FR-M2-1 第 4 步）。
pub fn comparison_prompts(context: &PromptContext, per_competitor: usize) -> Vec<PromptItem> {
    let mut items = Vec::new();
    if context.competitors.is_empty() || per_competitor == 0 {
        return items;
    }
    let patterns = COMPARISON_TEMPLATES.len();
    for (index, competitor) in context.competitors.iter().enumerate() {
        for slot in 0..per_competitor {
            // 不同竞品用不同的模板区间 + 不同的槽位取值，避免只换一个名字就被判重
            let pattern = &COMPARISON_TEMPLATES[(index * per_competitor + slot) % patterns];
            let assignment = Assignment {
                category: context.category.clone(),
                brand: context.brand.clone(),
                product: context.product.clone(),
                city: pick(&context.cities, index + slot * 3),
                budget: pick(&context.budgets, index + slot),
                scenario: pick(&context.scenarios, index * 2 + slot),
                param: pick(&context.params, index + slot * 2),
                competitor_a: Some(competitor.clone()),
                competitor_b: None,
            };
            let Some(text) = fill(pattern.text, &assignment) else {
                continue;
            };
            items.push(item_from_assignment(
                text,
                pattern.intent,
                context,
                &assignment,
                PromptSource::Template,
                vec!["竞品同框".to_string()],
            ));
        }
    }
    items
}

/// 某竞品被多少条 prompt 点到名（SOV 的分母口径必须与文本一致）。
pub fn co_mention_count(items: &[PromptItem], competitor: &CompetitorRef) -> usize {
    items
        .iter()
        .filter(|item| item.competitor_ids.contains(&competitor.id))
        .filter(|item| item.text.contains(&competitor.name))
        .count()
}

/// 去掉「文本里没点到名」的竞品 ID。
///
/// 去重合并会把被合并条目的 `competitor_ids` 并进保留条目，而保留条目的文本
/// 只点名了其中一个竞品；不清理就会让 SOV 把没被问到的竞品也算进去。
pub fn prune_unnamed_competitors(items: &mut [PromptItem], context: &PromptContext) {
    for item in items {
        item.competitor_ids.retain(|id| {
            context
                .competitors
                .iter()
                .any(|competitor| competitor.id == *id && item.text.contains(&competitor.name))
        });
        if item.competitor_ids.is_empty() {
            item.tags.retain(|tag| tag != "竞品同框");
        }
    }
}

/// 按目标条数挑选：先保竞品同框配额，再按意图轮转补齐（权重高者优先）。
pub fn select_items(candidates: Vec<PromptItem>, target: usize, quota: usize) -> Vec<PromptItem> {
    if candidates.len() <= target {
        return candidates;
    }
    let mut selected: Vec<PromptItem> = Vec::with_capacity(target);
    let mut coverage: Vec<(CompetitorId, usize)> = Vec::new();
    let mut rest: BTreeMap<IntentCategory, Vec<PromptItem>> = BTreeMap::new();

    for item in candidates {
        let needed = item
            .competitor_ids
            .iter()
            .any(|id| count_of(&coverage, id) < quota);
        if needed && selected.len() < target {
            for id in &item.competitor_ids {
                bump(&mut coverage, id);
            }
            selected.push(item);
        } else {
            rest.entry(item.intent).or_default().push(item);
        }
    }
    for bucket in rest.values_mut() {
        // 权重高的先入选；同权重保持原顺序，保证结果可复现
        bucket.sort_by_key(|item| std::cmp::Reverse(item.weight));
    }

    while selected.len() < target {
        // 每轮从「已选条数最少」的意图里取一条，保证意图分布均衡
        let counts: Vec<(IntentCategory, usize)> = IntentCategory::all()
            .into_iter()
            .map(|intent| {
                (
                    intent,
                    selected.iter().filter(|item| item.intent == intent).count(),
                )
            })
            .collect();
        let mut picked = false;
        for (intent, _) in sorted_by_count(counts) {
            let Some(bucket) = rest.get_mut(&intent) else {
                continue;
            };
            if bucket.is_empty() {
                continue;
            }
            selected.push(bucket.remove(0));
            picked = true;
            break;
        }
        if !picked {
            break;
        }
    }
    selected
}

// ---------------------------------------------------------------------------
// 口语化改写（本地规则，离线可用）
// ---------------------------------------------------------------------------

/// 书面词 → 真实用户问法（spec FR-M2-1 第 3 步）。
const COLLOQUIAL_RULES: [(&str, &str); 14] = [
    ("有哪些", "都有啥"),
    ("如何挑选", "咋挑"),
    ("如何选择", "怎么选"),
    ("怎么选择", "咋选"),
    ("是否", "是不是"),
    ("怎么样", "咋样"),
    ("怎样", "咋样"),
    ("以及", "还有"),
    ("价格", "多少钱"),
    ("费用", "花多少钱"),
    ("收费标准", "咋收费"),
    ("供应商", "厂家"),
    ("区别", "差别"),
    ("需要", "要"),
];

/// 口语化尾巴：短问句加上它更像真人在群里问话。
const COLLOQUIAL_TAILS: [&str; 5] = [
    "，哪个好",
    "，靠谱吗",
    "，大概多少钱",
    "，是不是智商税",
    "，有推荐吗",
];

/// 产生本地口语化变体：每条最多一个替换变体，短句再加一个尾巴变体。
///
/// 变体是**新增**条目而不是替换原条目：书面问法与口语问法在引擎里的召回
/// 表现往往不同，两种都留着才测得出差异。过于相似的会在去重阶段被合并。
pub fn colloquial_variants(items: &[PromptItem], context: &PromptContext) -> Vec<PromptItem> {
    let mut variants = Vec::new();
    for (index, item) in items.iter().enumerate() {
        if variants.len() >= MAX_COLLOQUIAL_VARIANTS {
            break;
        }
        if let Some(rewritten) = rewrite_colloquially(&item.text, index) {
            variants.push(derived_item(item, rewritten, context));
        }
        let chars = item.text.chars().count();
        if chars <= 20 && variants.len() < MAX_COLLOQUIAL_VARIANTS {
            let tail = COLLOQUIAL_TAILS[index % COLLOQUIAL_TAILS.len()];
            if !item.text.contains(tail.trim_start_matches('，')) {
                variants.push(derived_item(
                    item,
                    format!("{}{}", item.text, tail),
                    context,
                ));
            }
        }
    }
    variants
}

/// 应用一条替换规则（按序号轮转，避免所有条目都被同一条规则改写）。
fn rewrite_colloquially(text: &str, index: usize) -> Option<String> {
    let matching: Vec<&(&str, &str)> = COLLOQUIAL_RULES
        .iter()
        .filter(|(from, _)| text.contains(*from))
        .collect();
    if matching.is_empty() {
        return None;
    }
    let (from, to) = matching[index % matching.len()];
    Some(text.replacen(from, to, 1))
}

fn derived_item(source: &PromptItem, text: String, context: &PromptContext) -> PromptItem {
    let mut tags = source.tags.clone();
    if !tags.iter().any(|tag| tag == "口语化") {
        tags.push("口语化".to_string());
    }
    let mut item = item_from_assignment(
        text,
        source.intent,
        context,
        &Assignment::default(),
        PromptSource::Rewritten,
        tags,
    );
    // 竞品同框关系从原条目继承（文本没变过竞品名）
    item.competitor_ids = source.competitor_ids.clone();
    item.weight =
        assign_weight(source.intent, &item.text, context).max(source.weight.min(MAX_WEIGHT));
    item.repeat_count = source.repeat_count;
    item
}

/// 按意图与核心词赋权（spec FR-M2-1 第 6 步）：对比/推荐类基数更高，命中核心词 +1。
pub fn assign_weight(intent: IntentCategory, text: &str, context: &PromptContext) -> u8 {
    let base: u8 = match intent {
        IntentCategory::BrandComparison | IntentCategory::PurchaseRecommendation => 4,
        _ => 3,
    };
    let mut weight = base;
    if context
        .competitors
        .iter()
        .any(|competitor| text.contains(&competitor.name))
    {
        weight += 1;
    }
    if context.params.iter().any(|param| text.contains(param)) {
        weight += 1;
    }
    weight.min(MAX_WEIGHT)
}

/// 文本里点到名的竞品 ID。
///
/// SOV 口径要求「标记了竞品 = 文本里真的问到它」，因此模型输出的条目也按名字识别，
/// 与模板展开走同一套判定（见 [`prune_unnamed_competitors`]）。
pub fn mentioned_competitors(text: &str, context: &PromptContext) -> Vec<CompetitorId> {
    context
        .competitors
        .iter()
        .filter(|competitor| !competitor.name.trim().is_empty() && text.contains(&competitor.name))
        .map(|competitor| competitor.id)
        .collect()
}

/// 由模型输出构造条目：赋权、分组、竞品同框识别与本地条目完全同口径。
pub fn item_from_model(
    text: String,
    intent: IntentCategory,
    context: &PromptContext,
    source: PromptSource,
    tags: Vec<String>,
) -> PromptItem {
    let mut item =
        item_from_assignment(text, intent, context, &Assignment::default(), source, tags);
    item.competitor_ids = mentioned_competitors(&item.text, context);
    if !item.competitor_ids.is_empty() && !item.tags.iter().any(|tag| tag == "竞品同框") {
        item.tags.push("竞品同框".to_string());
    }
    item
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

fn item_from_assignment(
    text: String,
    intent: IntentCategory,
    context: &PromptContext,
    assignment: &Assignment,
    source: PromptSource,
    mut tags: Vec<String>,
) -> PromptItem {
    let mut item = PromptItem::new(PromptSetId::default(), text, intent);
    item.source = source;
    item.weight = assign_weight(intent, &item.text, context);
    let mut competitor_ids: Vec<CompetitorId> = Vec::new();
    for competitor in [&assignment.competitor_a, &assignment.competitor_b]
        .into_iter()
        .flatten()
    {
        if !competitor_ids.contains(&competitor.id) && item.text.contains(&competitor.name) {
            competitor_ids.push(competitor.id);
        }
    }
    item.competitor_ids = competitor_ids;
    if !item.competitor_ids.is_empty() && !tags.iter().any(|tag| tag == "竞品同框") {
        tags.push("竞品同框".to_string());
    }
    item.tags = tags;
    item
}

/// 计算一条模板的取值组合：按占位符轴做笛卡尔积，再用步长抽样控制数量。
fn assignments(template: &str, context: &PromptContext) -> Vec<Assignment> {
    let pair_axis = template.contains("{竞品A}") && template.contains("{竞品B}");
    let competitor_axis: Vec<(Option<CompetitorRef>, Option<CompetitorRef>)> = if pair_axis {
        let mut pairs = Vec::new();
        for (index, first) in context.competitors.iter().enumerate() {
            for second in context.competitors.iter().skip(index + 1) {
                pairs.push((Some(first.clone()), Some(second.clone())));
            }
        }
        pairs.into_iter().take(3).collect()
    } else if template.contains("{竞品A}") {
        context
            .competitors
            .iter()
            .cloned()
            .map(|competitor| (Some(competitor), None))
            .collect()
    } else {
        vec![(None, None)]
    };
    if (pair_axis || template.contains("{竞品A}")) && competitor_axis.is_empty() {
        // 没有竞品就没法出同框题：整条模板跳过，而不是产出带占位符的残句
        return Vec::new();
    }

    let city_axis = axis(template.contains("{城市}"), &context.cities, 3);
    let scenario_axis = axis(template.contains("{场景}"), &context.scenarios, 2);
    let param_axis = axis(template.contains("{关键参数}"), &context.params, 2);
    let budget_axis = axis(template.contains("{X}万"), &context.budgets, 2);

    // 带竞品轴的模板：每个竞品（或竞品对）只出一条，其余槽位按序号轮转取值。
    // 这样「每竞品 ≥N 条同框题」的配额才可控，也不会让候选集被同一竞品灌满。
    if template.contains("{竞品A}") {
        return competitor_axis
            .iter()
            .enumerate()
            .map(|(index, (competitor_a, competitor_b))| Assignment {
                category: context.category.clone(),
                brand: context.brand.clone(),
                product: context.product.clone(),
                city: pick(&city_axis, index),
                scenario: pick(&scenario_axis, index),
                param: pick(&param_axis, index),
                budget: pick(&budget_axis, index),
                competitor_a: competitor_a.clone(),
                competitor_b: competitor_b.clone(),
            })
            .collect();
    }

    let mut all = Vec::new();
    for city in &city_axis {
        for scenario in &scenario_axis {
            for param in &param_axis {
                for budget in &budget_axis {
                    all.push(Assignment {
                        category: context.category.clone(),
                        brand: context.brand.clone(),
                        product: context.product.clone(),
                        city: city.clone(),
                        scenario: scenario.clone(),
                        param: param.clone(),
                        budget: budget.clone(),
                        competitor_a: None,
                        competitor_b: None,
                    });
                }
            }
        }
    }
    sample_evenly(all, MAX_VARIANTS_PER_TEMPLATE)
}

fn axis(used: bool, values: &[String], cap: usize) -> Vec<String> {
    if !used {
        return vec![String::new()];
    }
    let mut taken: Vec<String> = values.iter().take(cap).cloned().collect();
    if taken.is_empty() {
        taken.push(String::new());
    }
    taken
}

/// 等步长抽样：保证抽到的组合在各轴上分散，而不是全挤在第一个取值上。
fn sample_evenly(items: Vec<Assignment>, cap: usize) -> Vec<Assignment> {
    if items.len() <= cap {
        return items;
    }
    let step = items.len().div_ceil(cap);
    items.into_iter().step_by(step).take(cap).collect()
}

/// 填充占位符。任一占位符取不到值就返回 `None`（宁可少一条，也不留残句）。
fn fill(template: &str, assignment: &Assignment) -> Option<String> {
    let mut text = template.to_string();
    for placeholder in KNOWN_PLACEHOLDERS {
        let token = format!("{{{placeholder}}}");
        if !text.contains(&token) {
            continue;
        }
        let value = assignment.value_of(placeholder)?.trim().to_string();
        if value.is_empty() {
            return None;
        }
        text = text.replace(&token, &value);
    }
    if text.contains('{') || text.contains('}') {
        return None;
    }
    if text.trim().is_empty() || text.chars().count() > MAX_PROMPT_CHARS {
        return None;
    }
    Some(text)
}

fn pick(values: &[String], index: usize) -> String {
    if values.is_empty() {
        return String::new();
    }
    values[index % values.len()].clone()
}

fn count_of(coverage: &[(CompetitorId, usize)], id: &CompetitorId) -> usize {
    coverage
        .iter()
        .find(|(key, _)| key == id)
        .map_or(0, |(_, count)| *count)
}

fn bump(coverage: &mut Vec<(CompetitorId, usize)>, id: &CompetitorId) {
    match coverage.iter_mut().find(|(key, _)| key == id) {
        Some((_, count)) => *count += 1,
        None => coverage.push((*id, 1)),
    }
}

/// 按「已选条数」升序排意图，条数相同时按意图固有顺序（`IntentCategory: Ord`）。
fn sorted_by_count(counts: Vec<(IntentCategory, usize)>) -> Vec<(IntentCategory, usize)> {
    let mut sorted = counts;
    sorted.sort_by_key(|(intent, count)| (*count, *intent));
    sorted
}

/// 从产品名里去掉型号码与括号补充语，得到「品类」级说法。
fn clean_product_name(raw: &str) -> String {
    let without_paren = raw
        .split(['（', '('])
        .next()
        .unwrap_or(raw)
        .trim()
        .to_string();
    let trimmed = without_paren
        .trim_start_matches(|ch: char| ch.is_ascii_alphanumeric() || ch == '-' || ch == ' ')
        .trim();
    if trimmed.chars().count() >= 3 {
        trimmed.to_string()
    } else {
        without_paren
    }
}

/// 从「流量 6～350 m³/h」这类参数串里取出参数名（流量）。
/// 参数标签的终止符：数字之前遇到它们，说明后面已经是取值而不是名字。
const PARAM_LABEL_STOP: [char; 8] = ['～', '~', '=', '<', '>', '≥', '≤', '：'];

fn param_label(raw: &str) -> Option<String> {
    let label: String = raw
        .chars()
        .take_while(|ch| !ch.is_ascii_digit() && !PARAM_LABEL_STOP.contains(ch))
        .collect::<String>()
        .trim()
        .to_string();
    let label = label.trim_end_matches(['：', ':', ' ']).trim().to_string();
    if label.chars().count() >= 2 && label.chars().count() <= 8 {
        Some(label)
    } else {
        None
    }
}

/// 把长句拆成短语（用于场景槽位）。
fn split_phrases(raw: &str) -> Vec<String> {
    raw.split(['、', '，', ',', '；', ';', '/', '与', '和'])
        .map(|part| part.trim().trim_start_matches("适用于").trim().to_string())
        .filter(|part| !part.is_empty())
        .collect()
}

/// 城市槽位：优先项目地域，其次实体卡服务地域里的地名。
fn cities_from(region: &str, service_regions: &[String]) -> Vec<String> {
    const GENERIC: [&str; 8] = [
        "全国",
        "全省",
        "海外",
        "出口",
        "国内",
        "本地",
        "省级行政区",
        "地区",
    ];
    let mut cities: Vec<String> = Vec::new();
    let region = region.trim();
    if !region.is_empty() && region.chars().count() <= 6 && !GENERIC.contains(&region) {
        cities.push(region.to_string());
    }
    for raw_region in service_regions {
        for token in split_phrases(raw_region) {
            for part in token.split(['（', '）', '(', ')', ' ']) {
                let part = part.trim();
                if part.chars().count() < 2 || part.chars().count() > 4 {
                    continue;
                }
                if GENERIC.iter().any(|word| part.contains(word)) {
                    continue;
                }
                if part.chars().any(|ch| ch.is_ascii_digit()) {
                    continue;
                }
                if !cities.iter().any(|city| city == part) {
                    cities.push(part.to_string());
                }
            }
        }
    }
    cities.into_iter().take(4).collect()
}

fn default_cities() -> Vec<String> {
    vec!["本地".to_string()]
}

fn default_budgets(industry: Industry) -> Vec<String> {
    match industry {
        Industry::B2bManufacturing => vec!["5".to_string(), "20".to_string(), "50".to_string()],
        Industry::EnterpriseSaas => vec!["3".to_string(), "10".to_string(), "30".to_string()],
        Industry::LocalService => vec!["1".to_string(), "5".to_string(), "20".to_string()],
        Industry::CrossBorderEcommerce => {
            vec!["10".to_string(), "30".to_string(), "80".to_string()]
        }
        Industry::Franchise => vec!["20".to_string(), "50".to_string(), "100".to_string()],
        Industry::Other => vec!["5".to_string(), "20".to_string(), "50".to_string()],
    }
}

fn default_scenarios(industry: Industry) -> Vec<String> {
    match industry {
        Industry::B2bManufacturing => vec![
            "工厂技改".to_string(),
            "新建产线".to_string(),
            "设备更新".to_string(),
        ],
        Industry::EnterpriseSaas => vec![
            "多部门协同".to_string(),
            "数据打通".to_string(),
            "老系统替换".to_string(),
        ],
        Industry::LocalService => vec![
            "门店开业".to_string(),
            "上门服务".to_string(),
            "老房改造".to_string(),
        ],
        Industry::CrossBorderEcommerce => vec![
            "出海备货".to_string(),
            "海外仓发货".to_string(),
            "小单试产".to_string(),
        ],
        Industry::Franchise => vec![
            "首店开业".to_string(),
            "区域代理".to_string(),
            "老店翻新".to_string(),
        ],
        Industry::Other => vec![
            "新项目立项".to_string(),
            "既有方案替换".to_string(),
            "长期合作".to_string(),
        ],
    }
}

fn default_params(industry: Industry) -> Vec<String> {
    match industry {
        Industry::B2bManufacturing => vec![
            "公差".to_string(),
            "材质".to_string(),
            "交付周期".to_string(),
        ],
        Industry::EnterpriseSaas => vec![
            "并发能力".to_string(),
            "集成能力".to_string(),
            "可用性".to_string(),
        ],
        Industry::LocalService => vec![
            "响应时间".to_string(),
            "师傅资质".to_string(),
            "用料等级".to_string(),
        ],
        Industry::CrossBorderEcommerce => vec![
            "认证".to_string(),
            "起订量".to_string(),
            "到港时效".to_string(),
        ],
        Industry::Franchise => vec![
            "加盟费".to_string(),
            "回本周期".to_string(),
            "供货价".to_string(),
        ],
        Industry::Other => vec![
            "规格".to_string(),
            "质保期".to_string(),
            "交付周期".to_string(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use geo_domain::{Language, ProjectStatus};

    fn project(industry: Industry) -> Project {
        Project {
            id: ProjectId::new(),
            name: "宏宇泵业".to_string(),
            brand_name: "宏宇泵业".to_string(),
            aliases: vec!["上海宏宇水泵".to_string()],
            website: Some("https://www.hongyu-pump.example".to_string()),
            region: "上海".to_string(),
            language: Language::ZhCn,
            industry,
            industry_label: None,
            tags: vec!["工业水泵".to_string()],
            status: ProjectStatus::Active,
            archived_at: None,
            created_at: chrono::DateTime::UNIX_EPOCH,
            updated_at: chrono::DateTime::UNIX_EPOCH,
        }
    }

    fn competitors() -> Vec<Competitor> {
        ["南方泵业", "凯泉泵业", "格兰富"]
            .into_iter()
            .enumerate()
            .map(|(index, name)| Competitor {
                id: CompetitorId::new(),
                project_id: ProjectId::new(),
                name: name.to_string(),
                aliases: Vec::new(),
                website: None,
                note: None,
                position: index as i32,
                created_at: chrono::DateTime::UNIX_EPOCH,
            })
            .collect()
    }

    use geo_domain::ProjectId;

    #[test]
    fn expands_placeholders_from_project_data() {
        let context = PromptContext::new(&project(Industry::B2bManufacturing), &competitors());
        assert_eq!(context.category, "工业水泵");
        assert_eq!(context.cities[0], "上海");

        let items = expand_with_context(
            &context,
            &[PromptTemplate {
                intent: IntentCategory::LocalService,
                text: "{城市}有没有靠谱的{品类}服务商，能上门吗",
            }],
        );
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].text, "上海有没有靠谱的工业水泵服务商，能上门吗");
        assert_eq!(items[0].intent, IntentCategory::LocalService);
        assert_eq!(items[0].group_name.as_deref(), Some("本地服务"));
    }

    #[test]
    fn competitor_templates_produce_one_item_per_competitor_with_ids() {
        let rivals = competitors();
        let context = PromptContext::new(&project(Industry::B2bManufacturing), &rivals);
        let items = expand_with_context(
            &context,
            &[PromptTemplate {
                intent: IntentCategory::BrandComparison,
                text: "{本品牌}和{竞品A}比，{关键参数}上的差距有多大",
            }],
        );
        assert_eq!(items.len(), 3);
        for (index, item) in items.iter().enumerate() {
            assert!(item.text.contains(&rivals[index].name));
            assert_eq!(item.competitor_ids, vec![rivals[index].id]);
            assert!(item.tags.contains(&"竞品同框".to_string()));
        }
    }

    #[test]
    fn templates_without_competitors_are_skipped_when_the_project_has_none() {
        let context = PromptContext::new(&project(Industry::B2bManufacturing), &[]);
        let items = expand_with_context(
            &context,
            &[PromptTemplate {
                intent: IntentCategory::BrandComparison,
                text: "{本品牌}和{竞品A}比，{关键参数}上的差距有多大",
            }],
        );
        assert!(items.is_empty(), "没有竞品就不该产出带占位符的残句");
    }

    #[test]
    fn variant_count_is_capped_and_spread_across_axes() {
        let context = PromptContext::new(&project(Industry::B2bManufacturing), &competitors());
        let items = expand_with_context(
            &context,
            &[PromptTemplate {
                intent: IntentCategory::PurchaseRecommendation,
                text: "预算{X}万以内，{城市}的{场景}要买{品类}，推荐哪几家",
            }],
        );
        assert!(items.len() <= MAX_VARIANTS_PER_TEMPLATE);
        assert!(items.len() >= 4, "多轴模板应展开出足够变体");
        let budgets: Vec<&str> = items
            .iter()
            .filter_map(|item| item.text.split("万").next())
            .collect();
        assert!(budgets.iter().any(|budget| budget.contains('5')));
    }

    #[test]
    fn comparison_prompts_give_each_rival_its_own_wording() {
        let rivals = competitors();
        let context = PromptContext::new(&project(Industry::B2bManufacturing), &rivals);
        let items = comparison_prompts(&context, 6);
        assert_eq!(items.len(), 18);
        for rival in &context.competitors {
            assert_eq!(co_mention_count(&items, rival), 6);
        }
        // 任意两条都不该被判为近义重复，否则同框配额会被去重吃掉
        let report = geo_domain::dedupe(items.clone());
        assert_eq!(report.removed_count(), 0, "{:?}", report.removed);
        assert_eq!(report.duplicate_pairs, 0);
    }

    #[test]
    fn colloquial_variants_rewrite_wording_and_keep_metadata() {
        let context = PromptContext::new(&project(Industry::B2bManufacturing), &competitors());
        let base = expand_with_context(
            &context,
            &[PromptTemplate {
                intent: IntentCategory::CategoryAwareness,
                text: "国内做{品类}的厂家有哪些，各自的特点是什么",
            }],
        );
        let variants = colloquial_variants(&base, &context);
        assert!(!variants.is_empty());
        assert_eq!(variants[0].source, PromptSource::Rewritten);
        assert!(variants[0].tags.contains(&"口语化".to_string()));
        assert_eq!(variants[0].intent, base[0].intent);
        assert!(variants[0].text.contains("都有啥"));
        assert_ne!(variants[0].text, base[0].text);
    }

    #[test]
    fn weights_follow_intent_and_core_words() {
        let rivals = competitors();
        let context = PromptContext::new(&project(Industry::B2bManufacturing), &rivals);
        assert_eq!(
            assign_weight(
                IntentCategory::CategoryAwareness,
                "工业水泵有哪些厂家",
                &context
            ),
            3
        );
        assert_eq!(
            assign_weight(
                IntentCategory::BrandComparison,
                "宏宇泵业和南方泵业比怎么样",
                &context
            ),
            5,
            "对比类基数 4 + 命中竞品 1"
        );
        assert_eq!(
            assign_weight(
                IntentCategory::ProfessionalLongTail,
                "工业水泵的公差标准是什么",
                &context
            ),
            4,
            "命中关键参数 +1"
        );
    }

    #[test]
    fn select_items_keeps_balance_and_competitor_coverage() {
        let rivals = competitors();
        let context = PromptContext::new(&project(Industry::B2bManufacturing), &rivals);
        let mut candidates = expand_with_context(
            &context,
            &templates_for(Industry::B2bManufacturing, &IntentCategory::all()),
        );
        candidates.extend(comparison_prompts(&context, 6));
        assert!(candidates.len() > 20, "候选应多于目标，才有得挑");

        let selected = select_items(candidates, 20, 3);
        assert_eq!(selected.len(), 20);
        for rival in &context.competitors {
            assert!(
                co_mention_count(&selected, rival) >= 3,
                "配额优先：{} 的同框条数不足",
                rival.name
            );
        }
        let covered = selected
            .iter()
            .map(|item| item.intent)
            .collect::<std::collections::HashSet<_>>();
        assert!(covered.len() >= 5, "意图分布要均衡，实际 {covered:?}");
    }

    #[test]
    fn unnamed_competitor_ids_are_pruned() {
        let rivals = competitors();
        let context = PromptContext::new(&project(Industry::B2bManufacturing), &rivals);
        let mut item = PromptItem::new(
            PromptSetId::default(),
            "宏宇泵业和南方泵业比怎么样",
            IntentCategory::BrandComparison,
        );
        // 模拟去重合并：ID 里多了一个文本没点名的竞品
        item.competitor_ids = vec![rivals[0].id, rivals[2].id];
        prune_unnamed_competitors(std::slice::from_mut(&mut item), &context);
        assert_eq!(item.competitor_ids, vec![rivals[0].id]);
    }

    #[test]
    fn product_and_param_labels_are_extracted_from_the_entity_card() {
        let card = EntityCard::from_manual(
            ProjectId::new(),
            geo_domain::EntityFields {
                standard_name: "宏宇泵业".to_string(),
                products: vec![geo_domain::ProductSpec {
                    name: "HY-ISG 立式管道离心泵（工业级）".to_string(),
                    params: vec!["流量 6～400 m³/h".to_string(), "扬程 15～125 m".to_string()],
                    note: Some("楼宇二次供水与暖通循环".to_string()),
                }],
                service_regions: vec!["华东（浙江、江苏、上海）".to_string()],
                ..Default::default()
            },
            chrono::DateTime::UNIX_EPOCH,
        );
        let context = PromptContext::new(&project(Industry::B2bManufacturing), &competitors())
            .with_card(Some(&card));
        assert_eq!(context.product, "立式管道离心泵");
        assert!(context.params.contains(&"流量".to_string()));
        assert!(context.params.contains(&"扬程".to_string()));
        assert!(context
            .scenarios
            .iter()
            .any(|item| item.contains("二次供水")));
        assert!(context.cities.contains(&"浙江".to_string()));
        assert!(context.cities.contains(&"上海".to_string()));
    }

    #[test]
    fn drafts_are_not_needed_for_a_workable_context() {
        // 只有品牌名也能出题：品类回落行业标签，槽位用行业默认值
        let bare = Project {
            tags: Vec::new(),
            region: "全国".to_string(),
            ..project(Industry::EnterpriseSaas)
        };
        let context = PromptContext::new(&bare, &[]);
        assert!(!context.category.is_empty());
        assert!(!context.params.is_empty());
        assert!(!context.scenarios.is_empty());
        assert!(!context.budgets.is_empty());
        assert_eq!(context.cities, vec!["本地".to_string()]);
    }

    #[test]
    fn templates_for_filters_by_intent_and_dedupes_overlaps() {
        let all = templates_for(Industry::B2bManufacturing, &IntentCategory::all());
        assert_eq!(all.len(), 56, "行业 28 + 通用 28");
        let only_comparison = templates_for(
            Industry::B2bManufacturing,
            &[IntentCategory::BrandComparison],
        );
        assert_eq!(only_comparison.len(), 8);
        assert!(only_comparison
            .iter()
            .all(|template| template.intent == IntentCategory::BrandComparison));
    }

    #[test]
    fn filled_text_is_compliant_for_every_industry() {
        // 模板本身合规还不够：占位符拼接可能凑出红线词（例如「{X}万能覆盖」→「万能」）。
        // 这里对每个行业都用代表性上下文真展开一遍，逐条过 `compliance::scan`。
        for industry in Industry::all() {
            let context = PromptContext::new(&project(industry), &competitors()).with_card(None);
            let templates = templates_for(industry, &IntentCategory::all());
            let mut items = expand_with_context(&context, &templates);
            items.extend(comparison_prompts(&context, 4));
            items.extend(colloquial_variants(&items, &context));
            assert!(!items.is_empty(), "{industry:?} 展开不出任何条目");
            for item in &items {
                assert!(
                    geo_domain::compliance::is_clean(&item.text),
                    "{industry:?} 展开结果命中绝对化用语：{}",
                    item.text
                );
            }
        }
    }

    #[test]
    fn filled_text_never_keeps_a_placeholder() {
        let context = PromptContext::new(&project(Industry::Other), &competitors());
        let items = expand_with_context(&context, GENERIC_TEMPLATES);
        assert!(!items.is_empty());
        for item in &items {
            assert!(!item.text.contains('{'), "{}", item.text);
            assert!(!item.text.contains('}'), "{}", item.text);
        }
    }
}

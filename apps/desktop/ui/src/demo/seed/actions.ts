/**
 * 种子：M6 GEO 行动中心（Top 10 处方 + 闭环归因 + 内容模板目录）。
 *
 * # 🔴 处方是**写死的**，不是算出来的（AGENTS 规则 9）
 * 真后端按诊断结果排序生成处方；demo 只端出这 10 条。它们的价值在于让产品负责人看清
 * 「一条处所长什么样」：影响范围、预期收益 + 依据、实施难度、负责人建议、可交付物模板、
 * 以及能不能在 1 小时内做完（`quick_win`，MVP 验收要求 ≥3 条）。
 *
 * # 与 M4 / M5 的咬合（界面上要能互相跳）
 * - `evidence_issue_ids` 指向 `seed/insights.ts` 里的核查问题（例如资质说错那条）；
 * - `rationale` 里引用的数字与 `seed/diagnosis.ts` 一致（覆盖率 42%、自有页占 31%、
 *   被引域名 47 个、决策层提及率 28%），横看竖看都不矛盾；
 * - 4 条 `done` 里有 4 条完成于复测轮（2026-09-23）之前 ⇒ 归因卡片正好把它们对上环比变化。
 *
 * 合规（AGENTS 规则 6）：处方文案只说"可见度 / 覆盖率 / 提及份额"，不承诺排名结果。
 */
import type { ActionItem, AttributionCard, ContentTemplate } from '../../api/types';
import { SEED_ALL_ENGINES, SEED_BASELINE_ROUND_ID, SEED_RETEST_ROUND_ID } from './collection-rounds';
import { SEED_ACTIVE_PROJECT_ID } from './projects';

export const SEED_ACTIONS: ActionItem[] = [
  {
    id: 'demo-act-001', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_BASELINE_ROUND_ID,
    category: 'site_structure', rank: 1,
    title: '给核心产品页补一段可被直接引用的定义句与参数表',
    rationale:
      '第 2 轮里品类认知题有 6/9 道提到澜舟，但引用的多是百科词条与行业媒体；' +
      '官网产品页缺一段结构化定义句与参数表，模型更倾向引用别处。',
    impact: 'high', difficulty: 'low', owner_hint: '市场负责人',
    deliverable: '产品页顶部 150 字定义段 + 参数表（HTML 表格，带 Schema 标记）',
    affected_prompt_count: 18, affected_engines: ['doubao', 'deepseek', 'kimi', 'qwen'],
    evidence_issue_ids: ['demo-fc-003'], quick_win: false,
    status: 'done', completed_at: '2026-09-19T08:00:00Z', updated_at: '2026-09-19T08:00:00Z',
  },
  {
    id: 'demo-act-002', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_BASELINE_ROUND_ID,
    category: 'site_structure', rank: 2,
    title: '上线 llms.txt，并放行 AI 爬虫（GPTBot / ClaudeBot / Bytespider）',
    rationale:
      '被引域名去重 47 个里自有页只占 31%，抽查发现 3 个产品页被 robots.txt 挡住了 AI 爬虫。',
    impact: 'medium', difficulty: 'low', owner_hint: '前端外包 + 运维',
    deliverable: 'llms.txt + robots.txt 放行清单 + 一次可留档的抓取验证记录',
    affected_prompt_count: 62, affected_engines: [...SEED_ALL_ENGINES],
    evidence_issue_ids: [], quick_win: true,
    status: 'done', completed_at: '2026-09-20T02:30:00Z', updated_at: '2026-09-20T02:30:00Z',
  },
  {
    id: 'demo-act-005', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_BASELINE_ROUND_ID,
    category: 'source_layout', rank: 3,
    title: '补 3 个高价值引用域名：行业媒体技术稿、百科词条、垂直社区问答',
    rationale:
      '被引域名 Top20 里权威媒体与百科词条各 0 个；2026 年 8 月之后论坛类引用被大幅削减，' +
      '权威源与官方页的占比上升，信源结构需要跟着调。',
    impact: 'high', difficulty: 'medium', owner_hint: '市场负责人 + 行业媒体对接人',
    deliverable: '1 篇行业媒体技术稿 + 百科词条修订 + 3 条垂直社区问答（附合规提示）',
    affected_prompt_count: 30, affected_engines: ['kimi', 'metaso', 'baidu_ai'],
    evidence_issue_ids: [], quick_win: false,
    status: 'in_progress', completed_at: null, updated_at: '2026-09-24T07:10:00Z',
  },
  {
    id: 'demo-act-003', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_BASELINE_ROUND_ID,
    category: 'fact_correction', rank: 4,
    title: '统一实体口径：公司全称、资质等级、服务地域在官网/百科词条/黄页三处一致',
    rationale:
      '事实核查里 9 条"说错了"有 6 条源于三处口径不一致（资质等级、公司全称、服务地域）。',
    impact: 'high', difficulty: 'low', owner_hint: '市场负责人',
    deliverable: '实体口径对照表 + 三处页面的修改记录（截图留档）',
    affected_prompt_count: 24, affected_engines: ['doubao', 'baidu_ai', 'qwen'],
    evidence_issue_ids: ['demo-fc-002', 'demo-fc-004'], quick_win: true,
    status: 'done', completed_at: '2026-09-21T06:00:00Z', updated_at: '2026-09-21T06:00:00Z',
  },
  {
    id: 'demo-act-007', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_BASELINE_ROUND_ID,
    category: 'fact_correction', rank: 5,
    title: '更正资质等级错误：官网资质页补证书编号与有效期，百科词条同步提交修订',
    rationale:
      '豆包与百度 AI 搜索各出现一次把"贰级"说成"壹级"的回答，属资质类错误，也是强监管表述风险点。',
    impact: 'high', difficulty: 'low', owner_hint: '市场负责人',
    deliverable: '资质页证书编号区块 + 百科词条修订记录 + 客服话术更新',
    affected_prompt_count: 9, affected_engines: ['doubao', 'baidu_ai'],
    evidence_issue_ids: ['demo-fc-002'], quick_win: true,
    status: 'done', completed_at: '2026-09-25T03:40:00Z', updated_at: '2026-09-25T03:40:00Z',
  },
  {
    id: 'demo-act-008', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_BASELINE_ROUND_ID,
    category: 'content_production', rank: 6,
    title: '生成术语页：《什么是脉冲布袋除尘器》（定义 + 原理 + 选型要点）',
    rationale:
      '品类认知题的被引来源里没有自有页；术语解释页是最容易被 AI 引用的内容形态之一。',
    impact: 'high', difficulty: 'medium', owner_hint: '市场负责人 + 技术工程师审稿',
    deliverable: '1 篇约 1200 字术语页（含定义句、参数表、FAQ 与更新时间署名）',
    affected_prompt_count: 9, affected_engines: ['doubao', 'deepseek', 'kimi', 'metaso'],
    evidence_issue_ids: [], quick_win: false,
    status: 'todo', completed_at: null, updated_at: '2026-09-17T02:00:00Z',
  },
  {
    id: 'demo-act-004', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_BASELINE_ROUND_ID,
    category: 'site_structure', rank: 7,
    title: '给每个产品页补 FAQ 区块（问答体，带 FAQPage 结构化标记）',
    rationale:
      '专业长尾题 8 道里有 5 道回答不完整，模型缺少可直接引用的问答对。',
    impact: 'medium', difficulty: 'medium', owner_hint: '市场负责人 + 前端外包',
    deliverable: '6 组 FAQ（每组 3~5 问）+ Schema FAQPage 标记 + 上线校验记录',
    affected_prompt_count: 8, affected_engines: ['deepseek', 'kimi', 'qwen'],
    evidence_issue_ids: ['demo-fc-009'], quick_win: false,
    status: 'in_progress', completed_at: null, updated_at: '2026-09-26T02:20:00Z',
  },
  {
    id: 'demo-act-006', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_BASELINE_ROUND_ID,
    category: 'source_layout', rank: 8,
    title: '在 B2B 平台补齐分项报价与参数页，替换 2025 年旧快照',
    rationale:
      '价格类问题 9 道里有 6 道引用了 B2B 平台页面，而平台上的报价仍是 2025 年快照（6 万~50 万元）。',
    impact: 'medium', difficulty: 'medium', owner_hint: '销售运营',
    deliverable: '平台商品页更新记录 + 分项报价说明（含安装与电控是否另计）',
    affected_prompt_count: 9, affected_engines: ['metaso', 'qwen', 'baidu_ai'],
    evidence_issue_ids: ['demo-fc-001'], quick_win: false,
    status: 'todo', completed_at: null, updated_at: '2026-09-17T02:05:00Z',
  },
  {
    id: 'demo-act-009', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_BASELINE_ROUND_ID,
    category: 'content_production', rank: 9,
    title: '生成三家横向对比表与案例卡，补决策层内容',
    rationale:
      '决策层（对比与价格 18 道题）提及率只有 28%，是最薄的一层；缺少可被引用的横向对比数据与案例。',
    impact: 'medium', difficulty: 'medium', owner_hint: '市场负责人 + 销售运营',
    deliverable: '1 张对比表（含口径说明）+ 2 张案例卡（含第三方检测报告引用）',
    affected_prompt_count: 18, affected_engines: ['kimi', 'deepseek', 'yuanbao'],
    evidence_issue_ids: ['demo-fc-005'], quick_win: false,
    status: 'todo', completed_at: null, updated_at: '2026-09-17T02:10:00Z',
  },
  {
    id: 'demo-act-010', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_BASELINE_ROUND_ID,
    category: 'site_structure', rank: 10,
    title: '在服务页写明报修响应时限与备件供应周期',
    rationale:
      '售后口碑类问题里的两条负面片段都指向响应速度与备件周期；官网当时没有任何可被引用的服务承诺。',
    impact: 'medium', difficulty: 'low', owner_hint: '售后服务负责人',
    deliverable: '服务承诺页（响应 24 小时内、备件 7 个工作日）+ 两条同区域客户运维记录',
    affected_prompt_count: 9, affected_engines: ['baidu_ai', 'doubao', 'yuanbao'],
    evidence_issue_ids: ['demo-fc-006'], quick_win: true,
    status: 'done', completed_at: '2026-09-22T09:00:00Z', updated_at: '2026-09-22T09:00:00Z',
  },
];

/**
 * 闭环归因卡片：基线轮 → 复测轮。
 *
 * 🔴 `metrics` 的四个数字与 `seed/diagnosis.ts` 的两轮 overview 逐一对齐
 * （覆盖率 0.42→0.55、Top3 0.21→0.34、事实问题 27→15 条、负面占比 0.19→0.12），
 * 判据在 `demo/seed.test.ts`——归因卡片一旦和诊断页对不上，整个"闭环"就成了空话。
 */
export const SEED_ATTRIBUTION_CARDS: AttributionCard[] = [
  {
    id: 'demo-attr-001', project_id: SEED_ACTIVE_PROJECT_ID,
    baseline_round_id: SEED_BASELINE_ROUND_ID, baseline_label: '第 2 轮 · 基线体检',
    retest_round_id: SEED_RETEST_ROUND_ID, retest_label: '第 3 轮 · 行动后复测',
    action_ids: ['demo-act-001', 'demo-act-002', 'demo-act-003', 'demo-act-010'],
    summary:
      '复测轮开始前完成 4 项（定义句与参数表、llms.txt 与爬虫放行、实体口径统一、服务承诺页）。' +
      '第 3 轮沿用同一份题库版本与引擎清单，环比变化如下；AI 回答存在随机性，区间已按重复采样给出。',
    metrics: [
      { metric: 'brand_coverage', before: 0.42, after: 0.55, unit: 'percent' },
      { metric: 'top3_rate', before: 0.21, after: 0.34, unit: 'percent' },
      { metric: 'fact_error_count', before: 27, after: 15, unit: 'count' },
      { metric: 'negative_rate', before: 0.19, after: 0.12, unit: 'percent' },
    ],
  },
];

/** 内容模板目录（M6 第 4 类处方的"一键生成"入口）。 */
export const SEED_CONTENT_TEMPLATES: ContentTemplate[] = [
  {
    id: 'demo-tpl-glossary-page', kind: 'glossary_page',
    section_keys: ['term_definition', 'working_principle', 'selection_guide', 'related_terms', 'references'],
    export_formats: ['markdown', 'html', 'docx'],
    target_categories: ['content_production', 'site_structure'],
  },
  {
    id: 'demo-tpl-qa-article', kind: 'qa_article',
    section_keys: ['question', 'short_answer', 'detail', 'faq', 'sources'],
    export_formats: ['markdown', 'html', 'docx'],
    target_categories: ['content_production', 'site_structure'],
  },
  {
    id: 'demo-tpl-comparison-table', kind: 'comparison_table',
    section_keys: ['scope', 'criteria', 'table', 'how_to_read', 'sources'],
    export_formats: ['markdown', 'html', 'csv'],
    target_categories: ['content_production', 'source_layout'],
  },
  {
    id: 'demo-tpl-spec-card', kind: 'spec_card',
    section_keys: ['model', 'parameters', 'applications', 'certification', 'delivery'],
    export_formats: ['markdown', 'html', 'csv'],
    target_categories: ['site_structure', 'content_production'],
  },
  {
    id: 'demo-tpl-case-card', kind: 'case_card',
    section_keys: ['client_context', 'challenge', 'solution', 'results', 'verification'],
    export_formats: ['markdown', 'html', 'docx'],
    target_categories: ['content_production', 'source_layout'],
  },
  {
    // 事实纠错类处方（实体口径 / 资质等级）产出的是一份「更正说明」：问题 → 一句话结论 →
    // 依据与出处。复用既有 `qa_article` 种类（ContentTemplateKind 是契约，不在本轮扩枚举），
    // 但 target_categories 单独覆盖 `fact_correction`，否则这类处方点「生成文稿」会得到空下拉。
    id: 'demo-tpl-fact-correction', kind: 'qa_article',
    section_keys: ['question', 'short_answer', 'detail', 'sources'],
    export_formats: ['markdown', 'html', 'docx'],
    target_categories: ['fact_correction'],
  },
  {
    id: 'demo-tpl-faq-page', kind: 'faq_page',
    section_keys: ['faq_price', 'faq_delivery', 'faq_service', 'schema_note'],
    export_formats: ['markdown', 'html'],
    target_categories: ['site_structure', 'content_production'],
  },
];

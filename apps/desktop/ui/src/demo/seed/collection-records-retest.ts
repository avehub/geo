/**
 * 种子：复测轮 / 进行中轮的原始证据 + **失败任务重跑**后会拿到的那几条记录。
 *
 * # 复测轮为什么必须"同题同引擎"
 * 闭环归因（M6）的说服力来自可比性：`demo-rec-retest-00X` 与 `demo-rec-baseline-00X`
 * 是**同一道题、同一家引擎**，只有回答内容变了。界面上把两条并排一放，
 * "做完这 3 项 → 提及率上升"这句话才有证据支撑（产品定义 §3.8 的验收标准）。
 *
 * # `SEED_RETRY_OUTCOMES`：重跑不是"编一条回答"，是端出预置的那一条
 * `collection_task_retry` 在 demo 里不发请求（AGENTS 规则 9），它把任务翻成 `succeeded`
 * 并把这里预置的记录与解析结果推进内存库。时间戳是**固定字面量**（不读时钟），
 * 因此"刷新即重置"的确定性不被破坏；界面会明说这是演示数据。
 */
import type { CollectionRecordDetail } from '../../api/types';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_LIVE_ROUND_ID,
  SEED_RETEST_ROUND_ID,
  SEED_TRIAL_ROUND_ID,
} from './collection-rounds';
import { SEED_BASELINE_RECORDS, SEED_TRIAL_RECORDS } from './collection-records';

/** 第 3 轮（行动后复测）：5 条样本，全部与基线轮同题同引擎。 */
export const SEED_RETEST_RECORDS: CollectionRecordDetail[] = [
  {
    id: 'demo-rec-retest-001', round_id: SEED_RETEST_ROUND_ID, prompt_id: 'demo-pi-baseline-001',
    prompt_text: '什么是脉冲布袋除尘器，它和普通布袋除尘器有什么区别？', intent: 'category_awareness',
    engine: 'doubao', model: 'doubao-seed-1.8', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: 3, sentiment: 'positive', citation_count: 3,
    collected_at: '2026-09-23T01:01:00Z', latency_ms: 2270, prompt_tokens: 32, completion_tokens: 644, repeat_index: 1,
    answer_text:
      '脉冲布袋除尘器是用压缩空气脉冲瞬间反吹清灰的袋式除尘设备，与机械振打式的主要差别在清灰方式、过滤风速取值与是否可在线清灰。\n' +
      '国内常见的供应商包括清源环保（工程总包见长）、恒宇环境（焊接烟尘方向）与澜舟（苏州澜舟环保科技有限公司，自有滤料生产线，标注 30 天内交付）。\n' +
      '选型时按处理风量、粉尘性质与允许排放浓度逐项核对，澜舟官网提供了定义页与参数表可直接引用。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/glossary/pulse-bag-filter', domain: 'www.lanzhou-hb.example.com', title: '什么是脉冲布袋除尘器（术语页）', source_type: 'owned_page' },
      { url: 'https://baike.example.com/item/pulse-bag-filter', domain: 'baike.example.com', title: '脉冲布袋除尘器（示例词条）', source_type: 'baike' },
      { url: 'https://www.example-industry-press.com/bag-filter-basics', domain: 'example-industry-press.com', title: '袋式除尘设备基础', source_type: 'news_media' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-retest-002', round_id: SEED_RETEST_ROUND_ID, prompt_id: 'demo-pi-baseline-019',
    prompt_text: '澜舟和清源环保的布袋除尘器在滤料上有什么不同？', intent: 'brand_comparison',
    engine: 'deepseek', model: 'deepseek-chat', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: 1, sentiment: 'positive', citation_count: 3,
    collected_at: '2026-09-23T01:04:00Z', latency_ms: 2960, prompt_tokens: 36, completion_tokens: 611, repeat_index: 1,
    answer_text:
      '两家的差别主要在滤料供应方式与交付周期。\n' +
      '澜舟自有滤料生产线，常用配置是 PTFE 覆膜涤纶与玻纤覆膜两种，交付周期标注 30 天内，并提供第三方检测报告与现场验收支持；' +
      '清源环保以外购滤料为主，案例集中在水泥与冶金。\n' +
      '若工期紧或需要按工况定制滤料，澜舟的自有产线更有参考价值；若需要工程总包，清源环保的项目经验更集中。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/products/filter-media', domain: 'www.lanzhou-hb.example.com', title: '滤料与滤芯（参数表）', source_type: 'owned_page' },
      { url: 'https://www.lanzhou-hb.example.com/cases', domain: 'www.lanzhou-hb.example.com', title: '澜舟工程案例', source_type: 'owned_page' },
      { url: 'https://www.qingyuan-env.example.com/cases', domain: 'www.qingyuan-env.example.com', title: '清源环保工程案例', source_type: 'other' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-retest-003', round_id: SEED_RETEST_ROUND_ID, prompt_id: 'demo-pi-baseline-028',
    prompt_text: '一台处理风量 2 万立方米每小时的布袋除尘器大概什么价位？', intent: 'pricing_plan',
    engine: 'metaso', model: 'metaso-search-pro', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: 2, sentiment: 'neutral', citation_count: 2,
    collected_at: '2026-09-23T01:07:00Z', latency_ms: 1180, prompt_tokens: 35, completion_tokens: 502, repeat_index: 1,
    answer_text:
      '2 万立方米每小时属于中小型风量。按 2026 年 8 月改版后的公开口径，澜舟给出的价格区间是单台 8 万~60 万元，按风量与工况定制。\n' +
      '整套系统（含管道与风机）通常在此基础上上浮约三成，建议要求厂家分项报价并写明滤料品牌与壳体厚度。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/price', domain: 'www.lanzhou-hb.example.com', title: '报价说明（2026-08 更新）', source_type: 'owned_page' },
      { url: 'https://www.example-b2b-mall.com/dust-collector', domain: 'example-b2b-mall.com', title: '布袋除尘器报价汇总', source_type: 'ecommerce' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-retest-004', round_id: SEED_RETEST_ROUND_ID, prompt_id: 'demo-pi-baseline-048',
    prompt_text: '澜舟的售后服务口碑怎么样，有客户反馈可以参考吗？', intent: 'after_sales_reputation',
    engine: 'baidu_ai', model: 'ernie-4.5-turbo-search', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: null, sentiment: 'neutral', citation_count: 3,
    collected_at: '2026-09-23T01:10:00Z', latency_ms: 3140, prompt_tokens: 34, completion_tokens: 489, repeat_index: 2,
    answer_text:
      '澜舟官网新增了服务承诺页，写明报修响应 24 小时内、备件供应周期 7 个工作日，并公布了两条同区域客户的运维记录。\n' +
      '早期的负面反馈（响应慢、备件周期长）集中在 2025 年之前，厂家已在服务承诺页作出回应。\n' +
      '建议在合同里把响应时限与备件周期写成可考核条款。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/service-commitment', domain: 'www.lanzhou-hb.example.com', title: '服务承诺与响应时限', source_type: 'owned_page' },
      { url: 'https://tieba.example.com/p/77120', domain: 'tieba.example.com', title: '除尘设备售后经历分享', source_type: 'forum' },
      { url: 'https://www.example-complaint.cn/case/3391', domain: 'example-complaint.cn', title: '备件供应投诉（示例）', source_type: 'other' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-retest-005', round_id: SEED_RETEST_ROUND_ID, prompt_id: 'demo-pi-baseline-011',
    prompt_text: '采购工业除尘设备时，厂家资质要看哪几项？', intent: 'purchase_recommendation',
    engine: 'doubao', model: 'doubao-seed-1.8', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: 1, sentiment: 'positive', citation_count: 2,
    collected_at: '2026-09-23T01:13:00Z', latency_ms: 2310, prompt_tokens: 31, completion_tokens: 516, repeat_index: 1,
    answer_text:
      '采购时通常要看四类：环保工程专业承包资质、质量管理体系认证、高新技术企业证书与产品检测报告。\n' +
      '以澜舟为例，公开资料显示其具备环保工程专业承包贰级资质、ISO 9001 质量管理体系认证与高新技术企业证书，' +
      '资质页同时挂出了证书编号与有效期。\n' +
      '除资质外，建议核对同工况运行案例与现场验收支持能力。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/about', domain: 'www.lanzhou-hb.example.com', title: '关于澜舟（资质与证书编号）', source_type: 'owned_page' },
      { url: 'https://baike.example.com/item/huanbao-gongcheng-zizhi', domain: 'baike.example.com', title: '环保工程专业承包资质说明', source_type: 'baike' },
    ],
    screenshot_path: null,
  },
];

/** 第 4 轮（进行中）：3 条已落库的样本。 */
export const SEED_LIVE_RECORDS: CollectionRecordDetail[] = [
  {
    id: 'demo-rec-live-001', round_id: SEED_LIVE_ROUND_ID, prompt_id: 'demo-pi-baseline-002',
    prompt_text: '工业除尘设备主要分成哪几类，各自适用什么工况？', intent: 'category_awareness',
    engine: 'doubao', model: 'doubao-seed-1.8', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: false, rank: null, sentiment: null, citation_count: 2,
    collected_at: '2026-09-28T01:01:00Z', latency_ms: 2340, prompt_tokens: 30, completion_tokens: 588, repeat_index: 1,
    answer_text:
      '工业除尘设备大致分为四类：袋式（布袋 / 滤筒）、静电、湿式与旋风。\n' +
      '袋式适合细粉尘与低排放限值，静电适合大风量高温烟气，湿式适合有黏性或含湿粉尘，旋风多做前级预处理。\n' +
      '选型先看粉尘粒径与允许排放浓度，再看运行成本。',
    citations: [
      { url: 'https://baike.example.com/item/dust-collector', domain: 'baike.example.com', title: '除尘设备分类（示例词条）', source_type: 'baike' },
      { url: 'https://zhuanlan.example-zhihu.com/p/10442', domain: 'zhuanlan.example-zhihu.com', title: '四类除尘设备的适用工况', source_type: 'zhihu' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-live-002', round_id: SEED_LIVE_ROUND_ID, prompt_id: 'demo-pi-baseline-021',
    prompt_text: '澜舟、清源环保、恒宇环境这三家的除尘设备各自强在哪？', intent: 'brand_comparison',
    engine: 'kimi', model: 'kimi-k2-thinking', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: 2, sentiment: 'positive', citation_count: 3,
    collected_at: '2026-09-28T01:08:00Z', latency_ms: 2740, prompt_tokens: 38, completion_tokens: 692, repeat_index: 1,
    answer_text:
      '三家侧重不同：清源环保偏除尘工程总包（水泥、冶金），恒宇环境偏焊接烟尘治理，澜舟偏自有滤料与定制化设备。\n' +
      '澜舟公开资料里能查到滤料生产线、30 天交付与第三方检测报告三项，官网还给了参数表与案例页。\n' +
      '改造项目且工期紧时，交付周期与滤料供应方式是关键差异点。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/about', domain: 'www.lanzhou-hb.example.com', title: '关于澜舟', source_type: 'owned_page' },
      { url: 'https://www.hengyu-env.example.com/welding-fume', domain: 'www.hengyu-env.example.com', title: '焊接烟尘治理方案', source_type: 'other' },
      { url: 'https://www.qingyuan-env.example.com/about', domain: 'www.qingyuan-env.example.com', title: '清源环保简介', source_type: 'other' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-live-003', round_id: SEED_LIVE_ROUND_ID, prompt_id: 'demo-pi-baseline-028',
    prompt_text: '一台处理风量 2 万立方米每小时的布袋除尘器大概什么价位？', intent: 'pricing_plan',
    engine: 'qwen', model: 'qwen3-max-search', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: 3, sentiment: 'neutral', citation_count: 2,
    collected_at: '2026-09-28T01:12:00Z', latency_ms: 2580, prompt_tokens: 35, completion_tokens: 447, repeat_index: 1,
    answer_text:
      '这个风量的设备报价跨度较大，公开口径下澜舟给出的是单台 8 万~60 万元，按风量与工况定制。\n' +
      '影响价格的主要因素是滤料材质、壳体厚度、是否含安装与电控。建议索取分项报价单再横向比较。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/price', domain: 'www.lanzhou-hb.example.com', title: '报价说明（2026-08 更新）', source_type: 'owned_page' },
      { url: 'https://www.example-b2b-mall.com/dust-collector', domain: 'example-b2b-mall.com', title: '布袋除尘器报价汇总', source_type: 'ecommerce' },
    ],
    screenshot_path: null,
  },
];

/**
 * 失败任务重跑后**预置**的那条证据（键 = 任务 id）。
 *
 * 回答写得短，是因为这几条的作用是让"失败 → 重跑 → 拿到证据"这条链路能走通，
 * 不是新增语料。`collected_at` 是固定字面量：demo 不读时钟（§B-4 确定性）。
 */
export const SEED_RETRY_OUTCOMES: Record<string, CollectionRecordDetail> = {
  'demo-task-trial-002': {
    id: 'demo-rec-trial-003', round_id: SEED_TRIAL_ROUND_ID, prompt_id: 'demo-pi-pilot-004',
    prompt_text: '滤筒除尘和布袋除尘在细粉尘工况下哪个更合适？', intent: 'category_awareness',
    engine: 'metaso', model: 'metaso-search-pro', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: false, rank: null, sentiment: null, citation_count: 1,
    collected_at: '2026-09-08T02:31:00Z', latency_ms: 1190, prompt_tokens: 29, completion_tokens: 274, repeat_index: 1,
    answer_text:
      '细粉尘（粒径小于 5 微米）工况下，滤筒除尘的过滤面积更大、占地更小，通常更合适；' +
      '布袋除尘在高温与高浓度工况下更稳。实际选型还要看粉尘黏性与清灰方式。',
    citations: [
      { url: 'https://www.example-industry-press.com/cartridge-vs-bag', domain: 'example-industry-press.com', title: '滤筒与布袋的工况对比', source_type: 'news_media' },
    ],
    screenshot_path: null,
  },
  'demo-task-baseline-003': {
    id: 'demo-rec-baseline-009', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-021',
    prompt_text: '澜舟、清源环保、恒宇环境这三家的除尘设备各自强在哪？', intent: 'brand_comparison',
    engine: 'yuanbao', model: 'yuanbao-web-2026-09', channel: 'browser_automation', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: 2, sentiment: 'neutral', citation_count: 1,
    collected_at: '2026-09-16T01:41:00Z', latency_ms: 9380, prompt_tokens: 0, completion_tokens: 0, repeat_index: 1,
    answer_text:
      '三家里，清源环保的工程总包经验更集中，恒宇环境偏焊接烟尘，澜舟强调自有滤料与定制交付。\n' +
      '选择时主要看你的工况与工期要求。（网页版回答，未返回结构化引用）',
    citations: [],
    screenshot_path: null,
  },
  'demo-task-baseline-004': {
    id: 'demo-rec-baseline-010', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-028',
    prompt_text: '一台处理风量 2 万立方米每小时的布袋除尘器大概什么价位？', intent: 'pricing_plan',
    engine: 'metaso', model: 'metaso-search-pro', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: false, rank: null, sentiment: null, citation_count: 1,
    collected_at: '2026-09-16T01:44:00Z', latency_ms: 1260, prompt_tokens: 35, completion_tokens: 318, repeat_index: 2,
    answer_text:
      '该风量的设备报价区间较宽，公开渠道能查到的多在 6 万~50 万元之间，具体取决于滤料与是否含安装。',
    citations: [
      { url: 'https://www.example-b2b-mall.com/dust-collector', domain: 'example-b2b-mall.com', title: '布袋除尘器报价汇总', source_type: 'ecommerce' },
    ],
    screenshot_path: null,
  },
  'demo-task-retest-003': {
    id: 'demo-rec-retest-006', round_id: SEED_RETEST_ROUND_ID, prompt_id: 'demo-pi-baseline-021',
    prompt_text: '澜舟、清源环保、恒宇环境这三家的除尘设备各自强在哪？', intent: 'brand_comparison',
    engine: 'yuanbao', model: 'yuanbao-web-2026-09', channel: 'browser_automation', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: 2, sentiment: 'positive', citation_count: 2,
    collected_at: '2026-09-23T01:36:00Z', latency_ms: 8940, prompt_tokens: 0, completion_tokens: 0, repeat_index: 2,
    answer_text:
      '按公开资料，澜舟的自有滤料生产线与 30 天交付在改造项目里更有优势，清源环保适合工程总包，恒宇环境适合焊接烟尘工况。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/about', domain: 'www.lanzhou-hb.example.com', title: '关于澜舟', source_type: 'owned_page' },
      { url: 'https://www.qingyuan-env.example.com/about', domain: 'www.qingyuan-env.example.com', title: '清源环保简介', source_type: 'other' },
    ],
    screenshot_path: null,
  },
  'demo-task-live-004': {
    id: 'demo-rec-live-004', round_id: SEED_LIVE_ROUND_ID, prompt_id: 'demo-pi-baseline-023',
    prompt_text: '做水泥厂除尘改造，选澜舟还是清源环保更合适？', intent: 'brand_comparison',
    engine: 'yuanbao', model: 'yuanbao-web-2026-09', channel: 'browser_automation', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: 2, sentiment: 'neutral', citation_count: 1,
    collected_at: '2026-09-28T01:41:00Z', latency_ms: 9120, prompt_tokens: 0, completion_tokens: 0, repeat_index: 1,
    answer_text:
      '水泥厂窑线改造两家都能做：清源环保在水泥行业的案例更多，澜舟的优势在滤料自产与交付周期。建议按窑线数量与停机窗口分别索取方案。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/cases', domain: 'www.lanzhou-hb.example.com', title: '澜舟工程案例', source_type: 'owned_page' },
    ],
    screenshot_path: null,
  },
  'demo-task-live-005': {
    id: 'demo-rec-live-005', round_id: SEED_LIVE_ROUND_ID, prompt_id: 'demo-pi-baseline-030',
    prompt_text: '除尘设备的价格受哪些因素影响比较大？', intent: 'pricing_plan',
    engine: 'metaso', model: 'metaso-search-pro', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: false, rank: null, sentiment: null, citation_count: 1,
    collected_at: '2026-09-28T01:44:00Z', latency_ms: 1220, prompt_tokens: 28, completion_tokens: 302, repeat_index: 1,
    answer_text:
      '影响价格的主要因素有五个：处理风量、滤料材质、壳体与防腐要求、是否含安装电控、以及售后与备件条款。',
    citations: [
      { url: 'https://www.example-b2b-mall.com/dust-collector-price', domain: 'example-b2b-mall.com', title: '除尘设备价格影响因素', source_type: 'ecommerce' },
    ],
    screenshot_path: null,
  },
};

/** 全部预置证据（不含重跑产物）：`DemoDb.collectionRecords` 的种子。 */
export const SEED_COLLECTION_RECORDS: CollectionRecordDetail[] = [
  ...SEED_TRIAL_RECORDS,
  ...SEED_BASELINE_RECORDS,
  ...SEED_RETEST_RECORDS,
  ...SEED_LIVE_RECORDS,
];

/** 重跑产物所属的轮次（测试用来断言"重跑之后记录真的进了对应轮次"）。 */
export const SEED_RETRY_ROUND_IDS: readonly string[] = [
  SEED_TRIAL_ROUND_ID,
  SEED_BASELINE_ROUND_ID,
  SEED_RETEST_ROUND_ID,
  SEED_LIVE_ROUND_ID,
];

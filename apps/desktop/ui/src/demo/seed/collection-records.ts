/**
 * 种子：M3 的**原始证据**（回答全文 + 引用链接 + 时间与耗时）。
 *
 * # 这份数据是 demo 的核心说服力
 * 产品定义把"证据留存"写成护城河：任何分数都要能下钻到 prompt 原文 + 引擎与模型版本 +
 * 完整回答 + 引用链接 + 时间戳。所以这里的回答是**照真实 AI 回答的样子写的中文段落**
 * （有结论、有对比表、有引用、偶尔反问、偶尔把事实说错），不是占位文本。
 *
 * # 🔴 刻意安排的"病症"（与 M4/M5/M6 的种子互相咬合）
 * - 品类认知题里**没有**澜舟（`demo-rec-baseline-001`）⇒ 意图漏斗"认知层有、推荐层无"的反面；
 * - 价格题里报了**旧价**（`demo-rec-baseline-004`）⇒ 事实核查"说旧了"，对应实体卡那条
 *   `products[0].price` 修订（报价本轮并进产品字段，spec 2026-10-01 · DR-60）；
 * - 资质题里把贰级说成**一级**（`demo-rec-baseline-007`）⇒ "说错了"，广告法/资质类风险；
 * - 售后题里有**负面片段**（`demo-rec-baseline-006`）⇒ 情感维度扣分 + 一条 warning 告警；
 * - 复测轮里同题目的回答**变好了**（`demo-rec-retest-*`）⇒ M6 归因卡片的证据。
 *
 * # 截图一律 `null`
 * demo 不抓网页也不截图，编一个路径就是假证据；界面显示"演示数据未包含截图"的空状态。
 *
 * # `sample_only`
 * 每轮只收录若干条样本记录（真后端会全量留存）。列表接口因此带 `sample_only: true`，
 * 界面上明说这是样本，**不假装**是全量。
 */
import type { CollectionRecordDetail } from '../../api/types';
import { SEED_BASELINE_ROUND_ID, SEED_TRIAL_ROUND_ID } from './collection-rounds';

/** 第 1 轮（通道验证）：2 条样本。 */
export const SEED_TRIAL_RECORDS: CollectionRecordDetail[] = [
  {
    id: 'demo-rec-trial-001', round_id: SEED_TRIAL_ROUND_ID, prompt_id: 'demo-pi-pilot-001',
    prompt_text: '滤筒除尘器的滤芯一般多久换一次？', intent: 'professional_long_tail',
    engine: 'doubao', model: 'doubao-seed-1.8', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: false, rank: null, sentiment: null, citation_count: 2,
    collected_at: '2026-09-08T02:11:00Z', latency_ms: 2410, prompt_tokens: 34, completion_tokens: 452, repeat_index: 1,
    answer_text:
      '滤筒除尘器的滤芯更换周期主要取决于粉尘性质与运行压差，通常在 6 个月到 24 个月之间。\n' +
      '判断依据有三个：一是压差长期高于设计值 15% 以上；二是排放浓度接近限值；三是滤芯出现破损或覆膜脱落。\n' +
      '如果是焊接烟尘这类细颗粒工况，建议缩短到 6~12 个月，并配合在线清灰参数调整。',
    citations: [
      { url: 'https://www.example-industry-press.com/dust-filter-maintenance', domain: 'example-industry-press.com', title: '滤筒除尘器运维手册（2026 版）', source_type: 'news_media' },
      { url: 'https://zhidao.example.com/question/88213', domain: 'zhidao.example.com', title: '滤芯更换周期讨论', source_type: 'forum' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-trial-002', round_id: SEED_TRIAL_ROUND_ID, prompt_id: 'demo-pi-pilot-006',
    prompt_text: '滤筒除尘器的防爆设计需要注意什么？', intent: 'professional_long_tail',
    engine: 'deepseek', model: 'deepseek-chat', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: false, rank: null, sentiment: null, citation_count: 1,
    collected_at: '2026-09-08T02:14:00Z', latency_ms: 3080, prompt_tokens: 31, completion_tokens: 398, repeat_index: 1,
    answer_text:
      '防爆型滤筒除尘需要同时考虑泄爆、隔爆与静电导除三方面：泄爆片面积按容器容积与粉尘爆炸指数计算，' +
      '隔爆阀安装在进风管道上，滤芯与壳体之间要做等电位联结。\n' +
      '如果你的工况是铝粉或木粉，建议先做粉尘爆炸特性测试，再确定泄爆面积。',
    citations: [
      { url: 'https://www.example-std.org.cn/gb15577', domain: 'example-std.org.cn', title: '粉尘防爆安全规程（示例条目）', source_type: 'official_doc' },
    ],
    screenshot_path: null,
  },
];

/** 第 2 轮（基线体检）：8 条样本，覆盖 7 类意图里的 5 类与 5 家引擎。 */
export const SEED_BASELINE_RECORDS: CollectionRecordDetail[] = [
  {
    id: 'demo-rec-baseline-001', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-001',
    prompt_text: '什么是脉冲布袋除尘器，它和普通布袋除尘器有什么区别？', intent: 'category_awareness',
    engine: 'doubao', model: 'doubao-seed-1.8', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: false, rank: null, sentiment: null, citation_count: 3,
    collected_at: '2026-09-16T01:01:00Z', latency_ms: 2380, prompt_tokens: 32, completion_tokens: 612, repeat_index: 1,
    answer_text:
      '脉冲布袋除尘器是用压缩空气脉冲瞬间反吹清灰的袋式除尘设备，普通布袋除尘器多采用机械振打或反吹风清灰。\n' +
      '两者的差别集中在三点：清灰方式（脉冲阀 vs 振打机构）、过滤风速取值（脉冲式可到 1.0~1.2 m/min，振打式通常 0.8~1.0 m/min）、' +
      '以及停机清灰的必要性（脉冲式大多可在线清灰，不必停机）。\n' +
      '选型时主要看粉尘性质、处理风量与是否允许停机。国内做这类设备的厂家较多，建议按工况参数逐家比对方案。',
    citations: [
      { url: 'https://baike.example.com/item/pulse-bag-filter', domain: 'baike.example.com', title: '脉冲布袋除尘器（示例词条）', source_type: 'baike' },
      { url: 'https://www.example-industry-press.com/bag-filter-basics', domain: 'example-industry-press.com', title: '袋式除尘设备基础', source_type: 'news_media' },
      { url: 'https://zhuanlan.example-zhihu.com/p/10293', domain: 'zhuanlan.example-zhihu.com', title: '脉冲清灰与反吹清灰的对比', source_type: 'zhihu' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-baseline-002', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-019',
    prompt_text: '澜舟和清源环保的布袋除尘器在滤料上有什么不同？', intent: 'brand_comparison',
    engine: 'deepseek', model: 'deepseek-chat', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: 2, sentiment: 'neutral', citation_count: 2,
    collected_at: '2026-09-16T01:03:00Z', latency_ms: 3040, prompt_tokens: 36, completion_tokens: 548, repeat_index: 1,
    answer_text:
      '两家都能做布袋除尘器，公开资料的侧重点不同。\n' +
      '清源环保的案例集中在水泥与冶金行业，滤料以外购为主，常见配置是玻纤覆膜滤袋；' +
      '澜舟（苏州澜舟环保科技有限公司）对外强调自有滤料生产线，交付周期标注为 30 天内，并提供第三方检测报告。\n' +
      '如果工况温度长期高于 200℃，两家的滤料选择都要重新核算，建议索取同工况的运行数据。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/products/bag-filter', domain: 'www.lanzhou-hb.example.com', title: '脉冲布袋除尘器 - 澜舟', source_type: 'owned_page' },
      { url: 'https://www.qingyuan-env.example.com/cases', domain: 'www.qingyuan-env.example.com', title: '清源环保工程案例', source_type: 'other' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-baseline-003', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-021',
    prompt_text: '澜舟、清源环保、恒宇环境这三家的除尘设备各自强在哪？', intent: 'brand_comparison',
    engine: 'kimi', model: 'kimi-k2-thinking', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: 3, sentiment: 'positive', citation_count: 3,
    collected_at: '2026-09-16T01:06:00Z', latency_ms: 2790, prompt_tokens: 38, completion_tokens: 704, repeat_index: 1,
    answer_text:
      '按公开资料整理，三家的侧重如下表：\n' +
      '| 品牌 | 侧重方向 | 常见工况 |\n| --- | --- | --- |\n' +
      '| 清源环保 | 除尘工程总包 | 水泥、冶金 |\n| 恒宇环境 | 焊接烟尘治理 | 汽车零部件、机械加工 |\n' +
      '| 澜舟 | 自有滤料 + 定制化设备 | 粉尘治理与改造 |\n\n' +
      '如果是新建生产线，工程总包能力更重要；如果是改造项目且工期紧，澜舟标注的 30 天交付与自有滤料生产线更有参考价值。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/about', domain: 'www.lanzhou-hb.example.com', title: '关于澜舟', source_type: 'owned_page' },
      { url: 'https://www.hengyu-env.example.com/welding-fume', domain: 'www.hengyu-env.example.com', title: '焊接烟尘治理方案', source_type: 'other' },
      { url: 'https://www.qingyuan-env.example.com/about', domain: 'www.qingyuan-env.example.com', title: '清源环保简介', source_type: 'other' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-baseline-004', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-028',
    prompt_text: '一台处理风量 2 万立方米每小时的布袋除尘器大概什么价位？', intent: 'pricing_plan',
    engine: 'metaso', model: 'metaso-search-pro', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: null, sentiment: 'neutral', citation_count: 2,
    collected_at: '2026-09-16T01:09:00Z', latency_ms: 1240, prompt_tokens: 35, completion_tokens: 486, repeat_index: 1,
    answer_text:
      '2 万立方米每小时属于中小型风量，市场上的报价区间大致是单台 6 万~50 万元，取决于滤料材质、壳体厚度与是否含安装。\n' +
      '以澜舟为例，其公开资料给出的价格区间是单台 6 万~50 万元，按风量与工况定制。\n' +
      '如果需要含管道与风机的整套系统，报价通常再上浮 30% 左右，建议让厂家分项报价。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/price', domain: 'www.lanzhou-hb.example.com', title: '报价说明（2025 年快照）', source_type: 'owned_page' },
      { url: 'https://www.example-b2b-mall.com/dust-collector', domain: 'example-b2b-mall.com', title: '布袋除尘器报价汇总', source_type: 'ecommerce' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-baseline-005', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-037',
    prompt_text: '苏州本地有哪些工业除尘设备厂家可以上门勘测？', intent: 'local_service',
    engine: 'qwen', model: 'qwen3-max-search', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: 1, sentiment: 'positive', citation_count: 2,
    collected_at: '2026-09-16T01:12:00Z', latency_ms: 2620, prompt_tokens: 33, completion_tokens: 431, repeat_index: 1,
    answer_text:
      '苏州本地可提供上门勘测的除尘设备厂家包括：\n' +
      '1. 澜舟（苏州澜舟环保科技有限公司），位于工业园区，服务范围覆盖江苏、浙江、安徽、山东，提供现场勘测与验收支持；\n' +
      '2. 清源环保，偏工程总包，勘测通常与方案设计合并进行。\n' +
      '上门勘测一般需要采集风量、粉尘性质、现有管道布置与排放限值四类数据。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/service', domain: 'www.lanzhou-hb.example.com', title: '服务网络与勘测流程', source_type: 'owned_page' },
      { url: 'https://www.example-suzhou-gov.cn/industry-directory', domain: 'example-suzhou-gov.cn', title: '本地环保装备企业目录（示例）', source_type: 'official_doc' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-baseline-006', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-048',
    prompt_text: '澜舟的售后服务口碑怎么样，有客户反馈可以参考吗？', intent: 'after_sales_reputation',
    engine: 'baidu_ai', model: 'ernie-4.5-turbo-search', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: null, sentiment: 'negative', citation_count: 2,
    collected_at: '2026-09-16T01:15:00Z', latency_ms: 3310, prompt_tokens: 34, completion_tokens: 522, repeat_index: 1,
    answer_text:
      '公开可查的正面反馈集中在设备交付与安装调试环节。\n' +
      '负面方面，有论坛帖子反映"报修后第三天才有响应"，另有用户提到滤袋备件供货周期偏长，' +
      '这两条都发生在 2025 年之前，厂家未公开回应。\n' +
      '建议在合同里约定响应时限与备件供应周期，并要求提供同区域客户的运维记录。',
    citations: [
      { url: 'https://tieba.example.com/p/77120', domain: 'tieba.example.com', title: '除尘设备售后经历分享', source_type: 'forum' },
      { url: 'https://www.example-complaint.cn/case/3391', domain: 'example-complaint.cn', title: '备件供应投诉（示例）', source_type: 'other' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-baseline-007', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-011',
    prompt_text: '采购工业除尘设备时，厂家资质要看哪几项？', intent: 'purchase_recommendation',
    engine: 'doubao', model: 'doubao-seed-1.8', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: true, rank: 2, sentiment: 'neutral', citation_count: 2,
    collected_at: '2026-09-16T01:18:00Z', latency_ms: 2450, prompt_tokens: 31, completion_tokens: 498, repeat_index: 1,
    answer_text:
      '采购除尘设备时通常要看四类资质：环保工程专业承包资质、质量管理体系认证、高新技术企业证书，以及产品检测报告。\n' +
      '以澜舟为例，公开资料显示其具备环保工程专业承包壹级资质、ISO 9001 认证与高新技术企业证书。\n' +
      '资质之外，还建议核对同工况的运行案例与现场验收能力。',
    citations: [
      { url: 'https://www.lanzhou-hb.example.com/about', domain: 'www.lanzhou-hb.example.com', title: '关于澜舟（资质页）', source_type: 'owned_page' },
      { url: 'https://baike.example.com/item/huanbao-gongcheng-zizhi', domain: 'baike.example.com', title: '环保工程专业承包资质说明', source_type: 'baike' },
    ],
    screenshot_path: null,
  },
  {
    id: 'demo-rec-baseline-008', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-056',
    prompt_text: '高温烟气工况下，PTFE 覆膜滤袋和玻纤滤袋怎么选？', intent: 'professional_long_tail',
    engine: 'deepseek', model: 'deepseek-chat', channel: 'official_api', status: 'succeeded',
    failure_reason: null, mentioned: false, rank: null, sentiment: null, citation_count: 1,
    collected_at: '2026-09-16T01:21:00Z', latency_ms: 3120, prompt_tokens: 37, completion_tokens: 573, repeat_index: 1,
    answer_text:
      'PTFE 覆膜滤袋适合粒径细、湿度波动大的工况，表面过滤、清灰容易，但单价更高；' +
      '玻纤滤袋耐温可达 260℃，适合窑炉烟气，缺点是耐折性差、对脉冲清灰压力更敏感。\n' +
      '选择时先看烟气温度与含湿量，再看粉尘粒径分布与允许排放浓度。需要的话我可以按你的工况参数帮你算过滤面积。',
    citations: [
      { url: 'https://zhuanlan.example-zhihu.com/p/55231', domain: 'zhuanlan.example-zhihu.com', title: '高温滤料选型笔记', source_type: 'zhihu' },
    ],
    screenshot_path: null,
  },
];

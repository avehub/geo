/**
 * 种子：M5 可见度诊断与竞品对标（体检总分 / 五维 / 竞品矩阵 / 意图漏斗 / 引擎差异 / 趋势 / 告警）。
 *
 * # 🔴 分数是静态值，但**手工满足附录 C 的公式**（AGENTS 规则 9 的自洽纪律）
 * 总分 = 0.35×可见度 + 0.25×推荐力 + 0.15×口碑情感 + 0.15×事实准确 + 0.10×信源健康。
 * demo 不做这个加权（那是 Rust 纯函数），但种子里的数字是按公式手算后写死的：
 * 第 2 轮 = 0.35×42 + 0.25×23 + 0.15×37 + 0.15×84 + 0.10×50 = 43.6 ⇒ 写 44。
 * 判据在 `demo/seed.test.ts`（|总分 − 加权和| ≤ 0.6，容下四舍五入）。
 * 同理，竞品矩阵里澜舟那一行的 `top1_rate` / `top3_rate` / `mention_only_rate` 与
 * 位次分布（Top1 4 题 / Top3 9 题 / 仅提及 13 题，分母 62）也是手算对齐的。
 *
 * # 样本不足那一轮**照样给分**，但界面必须置灰
 * 第 1 轮只有 5 道题（`insufficient`），产品口径是"不显示精确分数、只给方向性参考"。
 * 所以种子里带着数字、`sample_size_grade` 标成 `insufficient`，由界面负责置灰与提示——
 * 这正是 demo 要走查的降级形态。
 *
 * # 波动是特性
 * 每个覆盖率都带 `*_margin`（重复采样区间），趋势点上也有；界面文案必须把区间显示出来。
 */
import type {
  AlertItem,
  CompetitorMatrix,
  DiagnosisOverview,
  EngineScore,
  IntentFunnel,
  TrendPoint,
} from '../../api/types';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_LIVE_ROUND_ID,
  SEED_RETEST_ROUND_ID,
  SEED_TRIAL_ROUND_ID,
} from './collection-rounds';
import { SEED_ACTIVE_PROJECT_ID } from './projects';

/** 三轮趋势（进行中那轮不出现在趋势里：它还没有可比口径）。 */
export const SEED_TREND: TrendPoint[] = [
  {
    round_id: SEED_TRIAL_ROUND_ID, round_label: '第 1 轮 · 通道验证（小样本）',
    collected_at: '2026-09-08T02:38:00Z', status: 'partial',
    brand_coverage: 0.2, coverage_margin: 0.18, total_score: 33, fact_accuracy: 0.91, sample_size: 5,
  },
  {
    round_id: SEED_BASELINE_ROUND_ID, round_label: '第 2 轮 · 基线体检',
    collected_at: '2026-09-16T02:18:00Z', status: 'succeeded',
    brand_coverage: 0.42, coverage_margin: 0.06, total_score: 44, fact_accuracy: 0.84, sample_size: 62,
  },
  {
    round_id: SEED_RETEST_ROUND_ID, round_label: '第 3 轮 · 行动后复测',
    collected_at: '2026-09-23T02:12:00Z', status: 'succeeded',
    brand_coverage: 0.55, coverage_margin: 0.05, total_score: 55, fact_accuracy: 0.91, sample_size: 62,
  },
];

/**
 * 告警（4 条，覆盖 4 种类型与 3 种严重度；2 条已读、2 条未读 ⇒ 红点与"标记已读"都能走查）。
 *
 * 🔴 `delta` 的单位是**百分点 / 条数**，不是 0~1 的比率（裁定 3 / 差异台账 E-40）：
 * `-14` 就是「降 14 个百分点」，与 `SEED_REPORTS` 那侧的 `ReportMetricBlock.delta` 同口径，
 * 界面上共用 `metricDeltaText`。比率类告警的 `delta` 还要与 `detail` 里点名的数字对得上
 * （判据在 `demo/seed.test.ts`：界面说 -14、文案说「14 个百分点」就是同一件事的两个数）。
 */
export const SEED_ALERTS: AlertItem[] = [
  {
    id: 'demo-alert-001', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_BASELINE_ROUND_ID,
    kind: 'fact_error', severity: 'critical', engine: 'doubao', metric: 'fact_error_count', delta: 9,
    detail: '豆包在第 2 轮里把"环保工程专业承包贰级"说成壹级，属资质类错误；建议优先更正官网资质页与百科词条。',
    acknowledged: true, raised_at: '2026-09-16T03:10:00Z',
  },
  {
    id: 'demo-alert-002', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_BASELINE_ROUND_ID,
    kind: 'negative_sentiment', severity: 'warning', engine: 'baidu_ai', metric: 'negative_rate', delta: 19,
    detail: '售后口碑类问题里出现"响应慢""备件周期长"两条负面片段；建议上线服务承诺页，写明响应时限与备件周期。',
    acknowledged: true, raised_at: '2026-09-16T03:12:00Z',
  },
  {
    id: 'demo-alert-003', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_RETEST_ROUND_ID,
    kind: 'competitor_overtake', severity: 'warning', engine: 'yuanbao', metric: 'brand_coverage', delta: -14,
    detail: '元宝渠道里恒宇环境的覆盖率反超澜舟 14 个百分点；该渠道走浏览器自动化、本轮成功率偏低，建议先修复登录态再复测。',
    acknowledged: false, raised_at: '2026-09-23T03:05:00Z',
  },
  {
    id: 'demo-alert-004', project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_RETEST_ROUND_ID,
    kind: 'coverage_drop', severity: 'info', engine: 'metaso', metric: 'brand_coverage', delta: -3,
    detail: '秘塔的覆盖率环比回落 3 个百分点，落在该引擎 ±5 的正常波动区间内，已标为观察项、不计入本轮结论。',
    acknowledged: false, raised_at: '2026-09-23T03:06:00Z',
  },
];

export const SEED_DIAGNOSIS_OVERVIEWS: Record<string, DiagnosisOverview> = {
  [SEED_TRIAL_ROUND_ID]: {
    project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_TRIAL_ROUND_ID,
    round_label: '第 1 轮 · 通道验证（小样本）', collected_at: '2026-09-08T02:38:00Z',
    total_score: 33, score_margin: 18, sample_size: 5, sample_size_grade: 'insufficient',
    dimensions: [
      { dimension: 'visibility', score: 20, weight: 0.35, sample_size: 5, detail: '5 道题里 1 道提到澜舟' },
      { dimension: 'recommendation', score: 12, weight: 0.25, sample_size: 5, detail: '没有进入任何推荐清单' },
      { dimension: 'sentiment', score: 40, weight: 0.15, sample_size: 1, detail: '样本太小，情感占比不具参考性' },
      { dimension: 'fact_accuracy', score: 91, weight: 0.15, sample_size: 11, detail: '11 条回答里 1 条把滤芯更换周期说旧了' },
      { dimension: 'source_health', score: 33, weight: 0.1, sample_size: 3, detail: '自有页与权威源占 20%，被引域名去重 5 个' },
    ],
    brand_coverage: 0.2, brand_coverage_margin: 0.18, share_of_voice: 0.15, fact_accuracy: 0.91,
    distinct_cited_domains: 5, trend: SEED_TREND, alerts: SEED_ALERTS, metric_spec_version: 'geo-metrics-v1',
  },
  [SEED_BASELINE_ROUND_ID]: {
    project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_BASELINE_ROUND_ID,
    round_label: '第 2 轮 · 基线体检', collected_at: '2026-09-16T02:18:00Z',
    total_score: 44, score_margin: 5, sample_size: 62, sample_size_grade: 'sufficient',
    dimensions: [
      { dimension: 'visibility', score: 42, weight: 0.35, sample_size: 62, detail: '62 道题里 26 道提到澜舟（Brand Coverage 42%±6%）' },
      { dimension: 'recommendation', score: 23, weight: 0.25, sample_size: 62, detail: 'Top1 4 题、Top3 9 题、仅提及 13 题' },
      { dimension: 'sentiment', score: 37, weight: 0.15, sample_size: 26, detail: '正面 12 / 中性 9 / 负面 5（按被提及的 26 道题计）' },
      { dimension: 'fact_accuracy', score: 84, weight: 0.15, sample_size: 168, detail: '涉及本品牌的 168 条回答里有 27 条存在事实问题' },
      { dimension: 'source_health', score: 50, weight: 0.1, sample_size: 421, detail: '自有页与权威源占 31%，被引域名去重 47 个' },
    ],
    brand_coverage: 0.42, brand_coverage_margin: 0.06, share_of_voice: 0.32, fact_accuracy: 0.84,
    distinct_cited_domains: 47, trend: SEED_TREND, alerts: SEED_ALERTS, metric_spec_version: 'geo-metrics-v1',
  },
  [SEED_RETEST_ROUND_ID]: {
    project_id: SEED_ACTIVE_PROJECT_ID, round_id: SEED_RETEST_ROUND_ID,
    round_label: '第 3 轮 · 行动后复测', collected_at: '2026-09-23T02:12:00Z',
    total_score: 55, score_margin: 4, sample_size: 62, sample_size_grade: 'sufficient',
    dimensions: [
      { dimension: 'visibility', score: 55, weight: 0.35, sample_size: 62, detail: '62 道题里 34 道提到澜舟（Brand Coverage 55%±5%）' },
      { dimension: 'recommendation', score: 34, weight: 0.25, sample_size: 62, detail: 'Top1 8 题、Top3 13 题、仅提及 13 题' },
      { dimension: 'sentiment', score: 50, weight: 0.15, sample_size: 34, detail: '正面 19 / 中性 11 / 负面 4（按被提及的 34 道题计）' },
      { dimension: 'fact_accuracy', score: 91, weight: 0.15, sample_size: 171, detail: '涉及本品牌的 171 条回答里有 15 条存在事实问题' },
      { dimension: 'source_health', score: 61, weight: 0.1, sample_size: 428, detail: '自有页与权威源占 44%，被引域名去重 52 个' },
    ],
    brand_coverage: 0.55, brand_coverage_margin: 0.05, share_of_voice: 0.38, fact_accuracy: 0.91,
    distinct_cited_domains: 52, trend: SEED_TREND, alerts: SEED_ALERTS, metric_spec_version: 'geo-metrics-v1',
  },
};

/** 竞品对标矩阵（同框题 9 道 ⇒ Share of Voice 的分母是这 9 道题里的品牌提及次数）。 */
export const SEED_COMPETITOR_MATRICES: Record<string, CompetitorMatrix> = {
  [SEED_BASELINE_ROUND_ID]: {
    round_id: SEED_BASELINE_ROUND_ID, sample_size: 62, head_to_head_prompt_count: 9,
    rows: [
      { brand: '澜舟', is_self: true, coverage: 0.42, share_of_voice: 0.32, top1_rate: 0.06, top3_rate: 0.21, mention_only_rate: 0.21, positive_rate: 0.46, negative_rate: 0.19, fact_error_count: 27, cited_domain_count: 12 },
      { brand: '清源环保', is_self: false, coverage: 0.58, share_of_voice: 0.27, top1_rate: 0.15, top3_rate: 0.34, mention_only_rate: 0.24, positive_rate: 0.52, negative_rate: 0.08, fact_error_count: 9, cited_domain_count: 18 },
      { brand: '蓝净科技', is_self: false, coverage: 0.31, share_of_voice: 0.18, top1_rate: 0.05, top3_rate: 0.14, mention_only_rate: 0.17, positive_rate: 0.44, negative_rate: 0.11, fact_error_count: 6, cited_domain_count: 9 },
      { brand: '恒宇环境', is_self: false, coverage: 0.37, share_of_voice: 0.23, top1_rate: 0.08, top3_rate: 0.19, mention_only_rate: 0.18, positive_rate: 0.49, negative_rate: 0.06, fact_error_count: 5, cited_domain_count: 11 },
    ],
  },
  [SEED_RETEST_ROUND_ID]: {
    round_id: SEED_RETEST_ROUND_ID, sample_size: 62, head_to_head_prompt_count: 9,
    rows: [
      { brand: '澜舟', is_self: true, coverage: 0.55, share_of_voice: 0.38, top1_rate: 0.13, top3_rate: 0.34, mention_only_rate: 0.21, positive_rate: 0.56, negative_rate: 0.12, fact_error_count: 15, cited_domain_count: 19 },
      { brand: '清源环保', is_self: false, coverage: 0.56, share_of_voice: 0.26, top1_rate: 0.14, top3_rate: 0.31, mention_only_rate: 0.25, positive_rate: 0.51, negative_rate: 0.07, fact_error_count: 8, cited_domain_count: 18 },
      { brand: '蓝净科技', is_self: false, coverage: 0.3, share_of_voice: 0.16, top1_rate: 0.05, top3_rate: 0.13, mention_only_rate: 0.17, positive_rate: 0.43, negative_rate: 0.1, fact_error_count: 5, cited_domain_count: 9 },
      { brand: '恒宇环境', is_self: false, coverage: 0.35, share_of_voice: 0.2, top1_rate: 0.07, top3_rate: 0.18, mention_only_rate: 0.17, positive_rate: 0.48, negative_rate: 0.06, fact_error_count: 4, cited_domain_count: 11 },
    ],
  },
};

/**
 * 意图漏斗。三层只覆盖 36 道题（品类认知 9 + 选购推荐 9 + 品牌对比与价格 18），
 * 其余 26 道（本地服务 / 售后口碑 / 专业长尾）不进漏斗——`prompt_count` 把这件事摆在明面上。
 */
export const SEED_INTENT_FUNNELS: Record<string, IntentFunnel> = {
  [SEED_BASELINE_ROUND_ID]: {
    round_id: SEED_BASELINE_ROUND_ID,
    rows: [
      { stage: 'awareness', prompt_count: 9, mention_rate: 0.67, top3_rate: 0.33 },
      { stage: 'recommendation', prompt_count: 9, mention_rate: 0.33, top3_rate: 0.11 },
      { stage: 'decision', prompt_count: 18, mention_rate: 0.28, top3_rate: 0.11 },
    ],
    diagnosis_note:
      '认知层有、推荐层无：品类问题里能被提到，一到"推荐哪几家"就掉出清单。' +
      '主要缺口是可直接引用的对比数据、参数表与定义句。',
  },
  [SEED_RETEST_ROUND_ID]: {
    round_id: SEED_RETEST_ROUND_ID,
    rows: [
      { stage: 'awareness', prompt_count: 9, mention_rate: 0.78, top3_rate: 0.44 },
      { stage: 'recommendation', prompt_count: 9, mention_rate: 0.67, top3_rate: 0.33 },
      { stage: 'decision', prompt_count: 18, mention_rate: 0.5, top3_rate: 0.28 },
    ],
    diagnosis_note:
      '推荐层与决策层都补齐了：新增的术语页与滤料参数表被引用后，"推荐哪几家"这类问题开始进清单；' +
      '决策层（对比与价格）仍是最薄的一层，下一轮优先补对比表与分项报价说明。',
  },
};

/** 引擎差异视图（按事实错误率倒序看"哪个引擎最容易说错你"）。 */
export const SEED_ENGINE_SCORES: Record<string, EngineScore[]> = {
  [SEED_TRIAL_ROUND_ID]: [
    { engine: 'doubao', sample_size: 5, coverage: 0.2, top3_rate: 0, positive_rate: 0.5, fact_error_rate: 0.1, success_rate: 0.8, avg_latency_ms: 2450 },
    { engine: 'deepseek', sample_size: 5, coverage: 0.2, top3_rate: 0, positive_rate: 0.5, fact_error_rate: 0.08, success_rate: 0.8, avg_latency_ms: 3120 },
    { engine: 'metaso', sample_size: 5, coverage: 0.2, top3_rate: 0.2, positive_rate: 0.4, fact_error_rate: 0.14, success_rate: 0.6, avg_latency_ms: 1180 },
  ],
  [SEED_BASELINE_ROUND_ID]: [
    { engine: 'doubao', sample_size: 62, coverage: 0.35, top3_rate: 0.13, positive_rate: 0.41, fact_error_rate: 0.24, success_rate: 0.98, avg_latency_ms: 2380 },
    { engine: 'deepseek', sample_size: 62, coverage: 0.48, top3_rate: 0.21, positive_rate: 0.5, fact_error_rate: 0.14, success_rate: 1, avg_latency_ms: 3050 },
    { engine: 'kimi', sample_size: 62, coverage: 0.52, top3_rate: 0.26, positive_rate: 0.55, fact_error_rate: 0.11, success_rate: 0.98, avg_latency_ms: 2810 },
    { engine: 'qwen', sample_size: 62, coverage: 0.45, top3_rate: 0.19, positive_rate: 0.47, fact_error_rate: 0.16, success_rate: 1, avg_latency_ms: 2640 },
    { engine: 'yuanbao', sample_size: 62, coverage: 0.31, top3_rate: 0.1, positive_rate: 0.38, fact_error_rate: 0.29, success_rate: 0.94, avg_latency_ms: 9240 },
    { engine: 'baidu_ai', sample_size: 62, coverage: 0.39, top3_rate: 0.15, positive_rate: 0.43, fact_error_rate: 0.26, success_rate: 0.98, avg_latency_ms: 3320 },
    { engine: 'metaso', sample_size: 62, coverage: 0.42, top3_rate: 0.18, positive_rate: 0.45, fact_error_rate: 0.19, success_rate: 0.9, avg_latency_ms: 1210 },
  ],
  [SEED_RETEST_ROUND_ID]: [
    { engine: 'doubao', sample_size: 62, coverage: 0.5, top3_rate: 0.21, positive_rate: 0.52, fact_error_rate: 0.13, success_rate: 1, avg_latency_ms: 2290 },
    { engine: 'deepseek', sample_size: 62, coverage: 0.61, top3_rate: 0.32, positive_rate: 0.6, fact_error_rate: 0.08, success_rate: 1, avg_latency_ms: 2980 },
    { engine: 'kimi', sample_size: 62, coverage: 0.63, top3_rate: 0.35, positive_rate: 0.62, fact_error_rate: 0.07, success_rate: 0.98, avg_latency_ms: 2760 },
    { engine: 'qwen', sample_size: 62, coverage: 0.58, top3_rate: 0.29, positive_rate: 0.57, fact_error_rate: 0.09, success_rate: 1, avg_latency_ms: 2580 },
    { engine: 'yuanbao', sample_size: 62, coverage: 0.44, top3_rate: 0.18, positive_rate: 0.47, fact_error_rate: 0.18, success_rate: 0.95, avg_latency_ms: 8870 },
    { engine: 'baidu_ai', sample_size: 62, coverage: 0.52, top3_rate: 0.24, positive_rate: 0.53, fact_error_rate: 0.15, success_rate: 1, avg_latency_ms: 3180 },
    { engine: 'metaso', sample_size: 62, coverage: 0.55, top3_rate: 0.26, positive_rate: 0.55, fact_error_rate: 0.1, success_rate: 0.97, avg_latency_ms: 1190 },
  ],
  // 进行中那轮：已完成部分的即时口径，界面上要标注"采集未完成，数字会变"。
  [SEED_LIVE_ROUND_ID]: [
    { engine: 'doubao', sample_size: 31, coverage: 0.52, top3_rate: 0.22, positive_rate: 0.54, fact_error_rate: 0.12, success_rate: 0.97, avg_latency_ms: 2360 },
    { engine: 'deepseek', sample_size: 30, coverage: 0.6, top3_rate: 0.3, positive_rate: 0.6, fact_error_rate: 0.08, success_rate: 0.97, avg_latency_ms: 3010 },
    { engine: 'kimi', sample_size: 30, coverage: 0.63, top3_rate: 0.33, positive_rate: 0.61, fact_error_rate: 0.07, success_rate: 0.97, avg_latency_ms: 2790 },
    { engine: 'qwen', sample_size: 32, coverage: 0.56, top3_rate: 0.28, positive_rate: 0.56, fact_error_rate: 0.09, success_rate: 1, avg_latency_ms: 2610 },
    { engine: 'yuanbao', sample_size: 22, coverage: 0.41, top3_rate: 0.16, positive_rate: 0.45, fact_error_rate: 0.19, success_rate: 0.92, avg_latency_ms: 9410 },
    { engine: 'baidu_ai', sample_size: 24, coverage: 0.5, top3_rate: 0.23, positive_rate: 0.52, fact_error_rate: 0.15, success_rate: 1, avg_latency_ms: 3260 },
    { engine: 'metaso', sample_size: 18, coverage: 0.5, top3_rate: 0.24, positive_rate: 0.5, fact_error_rate: 0.11, success_rate: 1, avg_latency_ms: 1200 },
  ],
};

/**
 * 种子：M4 结构化抽取结果 + 事实核查问题。
 *
 * # 为什么是「紧凑行表 + 纯映射」
 * 一条 `AnswerInsight` 有 15 个字段，其中 5 个（`round_id` / `prompt_id` / `prompt_text` /
 * `engine` / `source_types`）在证据记录里已经有了。逐条铺开就是 24 × 15 行的抄写，
 * 抄错一处界面上就自相矛盾。所以行表只写**解析层新增的东西**（提及、位次、情感、形态、
 * 置信度、风险），其余由下面的纯函数从 `SEED_COLLECTION_RECORDS` 查出来搬运。
 * 🔴 这个映射**只搬运与投影**：不做情感分析、不算置信度、不做双模型交叉校验（AGENTS 规则 9）。
 * `source_types` 是把已预置的 `citation.source_type` **按类型点数**——归类结果本来就在种子里，
 * 点数只是投影，避免"引用 3 条、类型分布只有 2 条"这种界面矛盾。
 *
 * # 与 M3 / M5 / M6 的咬合
 * - 记录的 `mentioned` / `rank` / `sentiment` 必须与本文件的 `self.*` 一致（判据在 `demo/seed.test.ts`）；
 * - 事实核查的 `field_path` 是**当时对照的那个实体卡字段**。🔴 本轮实体卡瘦身
 *   （spec 2026-10-01 · DR-59）之后，`cases` / `differentiators` 两条历史记录指向的字段已经
 *   迁进知识库 ⇒ 那两条**刻意不改**：它们是过去的采集轮次留下的账，词典标签也刻意保留
 *   （DR-62），界面上照样显示「客户案例」「差异化卖点」，只是点进实体卡已经找不到那张卡了；
 * - `products` 那条"说旧了"（原 `price_range`，DR-60 之后报价住在产品里）对应实体卡里那条
 *   `disputed` 修订（官网 2026-08 改版）；
 * - `qualifications` 那条已标记 `corrected`，对应 M6 里已完成的事实纠错处方。
 */
import type {
  AnswerInsight,
  BrandMention,
  FactCheckIssue,
  FactCheckSummary,
  RiskFlag,
  Sentiment,
  SourceType,
} from '../../api/types';
import { SEED_COLLECTION_RECORDS, SEED_RETRY_OUTCOMES } from './collection-records-retest';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_LIVE_ROUND_ID,
  SEED_RETEST_ROUND_ID,
  SEED_TRIAL_ROUND_ID,
} from './collection-rounds';

/** 行表里的品牌提及（`role` 省略时按 `self` / `others` 的位置推导）。 */
interface MentionRow {
  brand: string;
  role: 'competitor' | 'other';
  count: number;
  sentiment: Sentiment;
  rank: number | null;
  table: boolean;
  excerpt: string;
}

/** 一条解析结果的紧凑行。 */
interface InsightRow {
  /** 指向 `SEED_COLLECTION_RECORDS` 或 `SEED_RETRY_OUTCOMES` 里的记录 id。 */
  record: string;
  self: {
    mentioned: boolean;
    rank: number | null;
    sentiment: Sentiment | null;
    count: number;
    table: boolean;
    excerpt: string;
  };
  others: readonly MentionRow[];
  /** [有结论, 有表格, 反问, 拒答]（产品定义 §3.6「回答形态」）。 */
  shape: readonly [boolean, boolean, boolean, boolean];
  confidence: number;
  /** 静态值；与 `REVIEW_CONFIDENCE_FLOOR` 的一致性由 `demo/seed.test.ts` 钉住。 */
  needsReview: boolean;
  risks: readonly RiskFlag[];
  corrected: readonly string[];
  reviewedAt: string | null;
}

/**
 * 🔴 人工复核队列的置信度门槛已搬到 `src/api/constants.ts`（`REVIEW_CONFIDENCE_FLOOR`）：
 * 页面也要用它解释"为什么这几条进了复核队列"，而页面 import 种子模块会长出
 * 「界面文案依赖演示数据」这条反向依赖。本文件的 `needsReview` 静态值按那个常量编排，
 * 一致性判据在 `demo/seed.test.ts`。
 */

const ROWS: readonly InsightRow[] = [
  // ---- 第 1 轮（通道验证）----
  {
    record: 'demo-rec-trial-001',
    self: { mentioned: false, rank: null, sentiment: null, count: 0, table: false, excerpt: '' },
    others: [],
    shape: [true, false, false, false],
    confidence: 0.88,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-trial-002',
    self: { mentioned: false, rank: null, sentiment: null, count: 0, table: false, excerpt: '' },
    others: [],
    shape: [true, false, false, false],
    confidence: 0.71,
    needsReview: true,
    risks: ['suspected_hallucination'],
    corrected: [],
    reviewedAt: null,
  },
  // ---- 第 2 轮（基线体检）----
  {
    record: 'demo-rec-baseline-001',
    self: { mentioned: false, rank: null, sentiment: null, count: 0, table: false, excerpt: '' },
    others: [
      { brand: '清源环保', role: 'competitor', count: 1, sentiment: 'neutral', rank: null, table: false, excerpt: '国内做这类设备的厂家较多，建议按工况参数逐家比对方案。' },
    ],
    shape: [true, false, false, false],
    confidence: 0.93,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-baseline-002',
    self: {
      mentioned: true, rank: 2, sentiment: 'neutral', count: 2, table: false,
      excerpt: '澜舟（苏州澜舟环保科技有限公司）对外强调自有滤料生产线，交付周期标注为 30 天内。',
    },
    others: [
      { brand: '清源环保', role: 'competitor', count: 2, sentiment: 'neutral', rank: 1, table: false, excerpt: '清源环保的案例集中在水泥与冶金行业，滤料以外购为主。' },
    ],
    shape: [true, false, false, false],
    confidence: 0.9,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-baseline-003',
    self: {
      mentioned: true, rank: 3, sentiment: 'positive', count: 2, table: true,
      excerpt: '澜舟 | 自有滤料 + 定制化设备 | 粉尘治理与改造',
    },
    others: [
      { brand: '清源环保', role: 'competitor', count: 2, sentiment: 'neutral', rank: 1, table: true, excerpt: '清源环保 | 除尘工程总包 | 水泥、冶金' },
      { brand: '恒宇环境', role: 'competitor', count: 2, sentiment: 'neutral', rank: 2, table: true, excerpt: '恒宇环境 | 焊接烟尘治理 | 汽车零部件、机械加工' },
    ],
    shape: [true, true, false, false],
    confidence: 0.95,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-baseline-004',
    self: {
      mentioned: true, rank: null, sentiment: 'neutral', count: 1, table: false,
      excerpt: '以澜舟为例，其公开资料给出的价格区间是单台 6 万~50 万元，按风量与工况定制。',
    },
    others: [],
    shape: [true, false, false, false],
    confidence: 0.86,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-baseline-005',
    self: {
      mentioned: true, rank: 1, sentiment: 'positive', count: 1, table: false,
      excerpt: '澜舟（苏州澜舟环保科技有限公司），位于工业园区，服务范围覆盖江苏、浙江、安徽、山东。',
    },
    others: [
      { brand: '清源环保', role: 'competitor', count: 1, sentiment: 'neutral', rank: 2, table: false, excerpt: '清源环保，偏工程总包，勘测通常与方案设计合并进行。' },
    ],
    shape: [true, false, false, false],
    confidence: 0.92,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-baseline-006',
    self: {
      mentioned: true, rank: null, sentiment: 'negative', count: 2, table: false,
      excerpt: '有论坛帖子反映"报修后第三天才有响应"，另有用户提到滤袋备件供货周期偏长。',
    },
    others: [],
    shape: [true, false, false, false],
    confidence: 0.81,
    needsReview: false,
    risks: ['negative_buzz'],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-baseline-007',
    self: {
      mentioned: true, rank: 2, sentiment: 'neutral', count: 1, table: false,
      excerpt: '公开资料显示其具备环保工程专业承包壹级资质、ISO 9001 认证与高新技术企业证书。',
    },
    others: [],
    shape: [true, false, false, false],
    confidence: 0.68,
    needsReview: true,
    risks: ['regulated_claim'],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-baseline-008',
    self: { mentioned: false, rank: null, sentiment: null, count: 0, table: false, excerpt: '' },
    others: [],
    shape: [true, false, true, false],
    confidence: 0.79,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  // ---- 第 3 轮（复测）：同题对照，位次与情感都变了 ----
  {
    record: 'demo-rec-retest-001',
    self: {
      mentioned: true, rank: 3, sentiment: 'positive', count: 1, table: false,
      excerpt: '澜舟（苏州澜舟环保科技有限公司，自有滤料生产线，标注 30 天内交付）。',
    },
    others: [
      { brand: '清源环保', role: 'competitor', count: 1, sentiment: 'neutral', rank: 1, table: false, excerpt: '清源环保（工程总包见长）' },
      { brand: '恒宇环境', role: 'competitor', count: 1, sentiment: 'neutral', rank: 2, table: false, excerpt: '恒宇环境（焊接烟尘方向）' },
    ],
    shape: [true, false, false, false],
    confidence: 0.94,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-retest-002',
    self: {
      mentioned: true, rank: 1, sentiment: 'positive', count: 3, table: false,
      excerpt: '澜舟自有滤料生产线，常用配置是 PTFE 覆膜涤纶与玻纤覆膜两种，交付周期标注 30 天内。',
    },
    others: [
      { brand: '清源环保', role: 'competitor', count: 2, sentiment: 'neutral', rank: 2, table: false, excerpt: '清源环保以外购滤料为主，案例集中在水泥与冶金。' },
    ],
    shape: [true, false, false, false],
    confidence: 0.96,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-retest-003',
    self: {
      mentioned: true, rank: 2, sentiment: 'neutral', count: 1, table: false,
      excerpt: '按 2026 年 8 月改版后的公开口径，澜舟给出的价格区间是单台 8 万~60 万元。',
    },
    others: [],
    shape: [true, false, false, false],
    confidence: 0.9,
    needsReview: false,
    risks: [],
    corrected: ['self_rank'],
    reviewedAt: '2026-09-24T02:40:00Z',
  },
  {
    record: 'demo-rec-retest-004',
    self: {
      mentioned: true, rank: null, sentiment: 'neutral', count: 2, table: false,
      excerpt: '澜舟官网新增了服务承诺页，写明报修响应 24 小时内、备件供应周期 7 个工作日。',
    },
    others: [],
    shape: [true, false, false, false],
    confidence: 0.84,
    needsReview: false,
    risks: ['negative_buzz'],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-retest-005',
    self: {
      mentioned: true, rank: 1, sentiment: 'positive', count: 1, table: false,
      excerpt: '以澜舟为例，公开资料显示其具备环保工程专业承包贰级资质、ISO 9001 质量管理体系认证与高新技术企业证书。',
    },
    others: [],
    shape: [true, false, false, false],
    confidence: 0.62,
    needsReview: true,
    risks: [],
    corrected: ['self_mentioned', 'self_rank'],
    reviewedAt: '2026-09-24T03:10:00Z',
  },
  // ---- 第 4 轮（进行中）----
  {
    record: 'demo-rec-live-001',
    self: { mentioned: false, rank: null, sentiment: null, count: 0, table: false, excerpt: '' },
    others: [],
    shape: [true, false, false, false],
    confidence: 0.9,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-live-002',
    self: {
      mentioned: true, rank: 2, sentiment: 'positive', count: 2, table: false,
      excerpt: '澜舟强调自有滤料与定制交付，官网还给了参数表与案例页。',
    },
    others: [
      { brand: '清源环保', role: 'competitor', count: 1, sentiment: 'neutral', rank: 1, table: false, excerpt: '清源环保偏除尘工程总包（水泥、冶金）' },
      { brand: '恒宇环境', role: 'competitor', count: 1, sentiment: 'neutral', rank: 3, table: false, excerpt: '恒宇环境偏焊接烟尘' },
    ],
    shape: [true, false, false, false],
    confidence: 0.91,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-live-003',
    self: {
      mentioned: true, rank: 3, sentiment: 'neutral', count: 1, table: false,
      excerpt: '公开口径下澜舟给出的是单台 8 万~60 万元，按风量与工况定制。',
    },
    others: [],
    shape: [true, false, false, false],
    confidence: 0.73,
    needsReview: true,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  // ---- 失败任务重跑后拿到的解析结果 ----
  {
    record: 'demo-rec-trial-003',
    self: { mentioned: false, rank: null, sentiment: null, count: 0, table: false, excerpt: '' },
    others: [],
    shape: [true, false, false, false],
    confidence: 0.87,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-baseline-009',
    self: {
      mentioned: true, rank: 2, sentiment: 'neutral', count: 1, table: false,
      excerpt: '澜舟强调自有滤料与定制交付。（网页版回答，无结构化引用）',
    },
    others: [
      { brand: '清源环保', role: 'competitor', count: 1, sentiment: 'neutral', rank: 1, table: false, excerpt: '清源环保的工程总包经验更集中' },
    ],
    shape: [true, false, false, false],
    confidence: 0.64,
    needsReview: true,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-baseline-010',
    self: { mentioned: false, rank: null, sentiment: null, count: 0, table: false, excerpt: '' },
    others: [],
    shape: [true, false, false, false],
    confidence: 0.8,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-retest-006',
    self: {
      mentioned: true, rank: 2, sentiment: 'positive', count: 1, table: false,
      excerpt: '澜舟的自有滤料生产线与 30 天交付在改造项目里更有优势。',
    },
    others: [
      { brand: '清源环保', role: 'competitor', count: 1, sentiment: 'neutral', rank: 1, table: false, excerpt: '清源环保适合工程总包' },
      { brand: '恒宇环境', role: 'competitor', count: 1, sentiment: 'neutral', rank: 3, table: false, excerpt: '恒宇环境适合焊接烟尘工况' },
    ],
    shape: [true, false, false, false],
    confidence: 0.69,
    needsReview: true,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-live-004',
    self: {
      mentioned: true, rank: 2, sentiment: 'neutral', count: 1, table: false,
      excerpt: '澜舟的优势在滤料自产与交付周期。',
    },
    others: [
      { brand: '清源环保', role: 'competitor', count: 1, sentiment: 'neutral', rank: 1, table: false, excerpt: '清源环保在水泥行业的案例更多' },
    ],
    shape: [true, false, false, false],
    confidence: 0.77,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
  {
    record: 'demo-rec-live-005',
    self: { mentioned: false, rank: null, sentiment: null, count: 0, table: false, excerpt: '' },
    others: [],
    shape: [true, false, false, false],
    confidence: 0.85,
    needsReview: false,
    risks: [],
    corrected: [],
    reviewedAt: null,
  },
];

/** 全部证据记录（含重跑产物）按 id 索引，供行表查取。 */
const RECORD_INDEX: ReadonlyMap<string, (typeof SEED_COLLECTION_RECORDS)[number]> = new Map([
  ...SEED_COLLECTION_RECORDS.map((record) => [record.id, record] as const),
  ...Object.values(SEED_RETRY_OUTCOMES).map((record) => [record.id, record] as const),
]);

/** 重跑产物的记录 id 集合（它们不在初始内存库里）。 */
const RECOVERY_RECORD_IDS: ReadonlySet<string> = new Set(
  Object.values(SEED_RETRY_OUTCOMES).map((record) => record.id),
);

/** 引用列表 → 类型分布（投影，不是算法）。 */
function countSourceTypes(types: readonly SourceType[]): Partial<Record<SourceType, number>> {
  const out: Partial<Record<SourceType, number>> = {};
  for (const type of types) out[type] = (out[type] ?? 0) + 1;
  return out;
}

/** 记录 id `demo-rec-<key>` → 解析结果 id `demo-ins-<key>`（纯字符串搬运，ASCII）。 */
function insightIdOf(recordId: string): string {
  return recordId.replace('demo-rec-', 'demo-ins-');
}

function toInsight(row: InsightRow): AnswerInsight {
  const record = RECORD_INDEX.get(row.record);
  if (record === undefined) throw new Error(`unknown seed record: ${row.record}`);
  const selfMention: BrandMention | null = row.self.mentioned
    ? {
        brand: '澜舟',
        role: 'self',
        count: row.self.count,
        sentiment: row.self.sentiment ?? 'neutral',
        rank: row.self.rank,
        in_comparison_table: row.self.table,
        excerpt: row.self.excerpt,
      }
    : null;
  return {
    id: insightIdOf(record.id),
    round_id: record.round_id,
    record_id: record.id,
    prompt_id: record.prompt_id,
    prompt_text: record.prompt_text,
    engine: record.engine,
    mentions: [
      ...(selfMention === null ? [] : [selfMention]),
      ...row.others.map((mention) => ({
        brand: mention.brand,
        role: mention.role,
        count: mention.count,
        sentiment: mention.sentiment,
        rank: mention.rank,
        in_comparison_table: mention.table,
        excerpt: mention.excerpt,
      })),
    ],
    self_mentioned: row.self.mentioned,
    self_rank: row.self.rank,
    self_sentiment: row.self.sentiment,
    answer_shape: {
      has_conclusion: row.shape[0],
      has_table: row.shape[1],
      asks_back: row.shape[2],
      refused: row.shape[3],
    },
    source_types: countSourceTypes(record.citations.map((citation) => citation.source_type)),
    confidence: row.confidence,
    needs_review: row.needsReview,
    risks: [...row.risks],
    corrected_fields: [...row.corrected],
    reviewed_at: row.reviewedAt,
  };
}

const ALL_INSIGHTS = ROWS.map(toInsight);

/** `DemoDb.insights` 的种子（不含重跑产物）。 */
export const SEED_ANSWER_INSIGHTS: AnswerInsight[] = ALL_INSIGHTS.filter(
  (insight) => !RECOVERY_RECORD_IDS.has(insight.record_id),
);

/** 重跑之后才进库的解析结果，键 = 任务 id（与 `SEED_RETRY_OUTCOMES` 同键）。 */
export const SEED_RETRY_INSIGHTS: Record<string, AnswerInsight> = Object.fromEntries(
  Object.entries(SEED_RETRY_OUTCOMES).map(([taskId, record]) => [
    taskId,
    ALL_INSIGHTS.find((insight) => insight.record_id === record.id) as AnswerInsight,
  ]),
);

// ---------------------------------------------------------------------------
// 事实核查（说错了 / 说旧了 / 漏说了）
// ---------------------------------------------------------------------------

/**
 * 核查问题清单（9 条样本）。
 *
 * `field_path` 一律是实体卡的**顶层字段名**（与 `EntityCard.field_status` 的键同口径）；
 * `answer_excerpt` 与 `entity_value` 构成"回答原文 vs 实体卡字段"的对照，
 * 这是 M4 验收标准里点名要能定位的那一组证据。
 */
export const SEED_FACT_CHECK_ISSUES: FactCheckIssue[] = [
  {
    id: 'demo-fc-001', round_id: SEED_BASELINE_ROUND_ID, record_id: 'demo-rec-baseline-004',
    prompt_id: 'demo-pi-baseline-028', prompt_text: '一台处理风量 2 万立方米每小时的布袋除尘器大概什么价位？',
    // 🔴 `field_path` 本轮由 `price_range` 改成 `products`：报价已经并进产品字段
    // （spec 2026-10-01 · DR-60，实体卡不再有独立的价格卡），对照的是**脉冲布袋除尘器**那一行。
    engine: 'metaso', kind: 'outdated', field_path: 'products',
    answer_excerpt: '其公开资料给出的价格区间是单台 6 万~50 万元，按风量与工况定制',
    entity_value: '单台 12 万~60 万元，按风量与工况定制',
    confidence: 0.91, status: 'open', correction_channel: 'official_site',
    note: '官网报价页仍是 2025 年快照，2026-08 改版后的口径没有同步到第三方页面',
    resolved_at: null,
  },
  {
    id: 'demo-fc-002', round_id: SEED_BASELINE_ROUND_ID, record_id: 'demo-rec-baseline-007',
    prompt_id: 'demo-pi-baseline-011', prompt_text: '采购工业除尘设备时，厂家资质要看哪几项？',
    engine: 'doubao', kind: 'wrong', field_path: 'qualifications',
    answer_excerpt: '具备环保工程专业承包壹级资质',
    entity_value: '环保工程专业承包贰级',
    confidence: 0.95, status: 'corrected', correction_channel: 'baike_entry',
    note: '官网资质页已补证书编号与等级，百科词条同步提交修订',
    resolved_at: '2026-09-19T08:20:00Z',
  },
  {
    id: 'demo-fc-003', round_id: SEED_BASELINE_ROUND_ID, record_id: 'demo-rec-baseline-008',
    prompt_id: 'demo-pi-baseline-056', prompt_text: '高温烟气工况下，PTFE 覆膜滤袋和玻纤滤袋怎么选？',
    engine: 'deepseek', kind: 'missing', field_path: 'differentiators',
    answer_excerpt: '回答只讲了滤料选型方法，没有提到任何一家供应商的滤料自产能力',
    entity_value: '自有滤料生产线，交付周期 30 天内',
    confidence: 0.78, status: 'open', correction_channel: 'official_site',
    note: null, resolved_at: null,
  },
  {
    id: 'demo-fc-004', round_id: SEED_BASELINE_ROUND_ID, record_id: 'demo-rec-baseline-005',
    prompt_id: 'demo-pi-baseline-037', prompt_text: '苏州本地有哪些工业除尘设备厂家可以上门勘测？',
    engine: 'qwen', kind: 'wrong', field_path: 'service_regions',
    answer_excerpt: '第三方目录页把服务范围写成"仅限江苏省内"',
    entity_value: '江苏、浙江、安徽、山东',
    confidence: 0.88, status: 'open', correction_channel: 'third_party_page',
    note: null, resolved_at: null,
  },
  {
    id: 'demo-fc-005', round_id: SEED_BASELINE_ROUND_ID, record_id: 'demo-rec-baseline-003',
    prompt_id: 'demo-pi-baseline-021', prompt_text: '澜舟、清源环保、恒宇环境这三家的除尘设备各自强在哪？',
    engine: 'kimi', kind: 'outdated', field_path: 'cases',
    answer_excerpt: '澜舟的案例主要是 2023 年的两条水泥窑线',
    entity_value: '某水泥集团 3 条窑线除尘改造；某汽车零部件厂焊接烟尘治理',
    confidence: 0.72, status: 'open', correction_channel: 'official_site',
    note: null, resolved_at: null,
  },
  {
    id: 'demo-fc-006', round_id: SEED_BASELINE_ROUND_ID, record_id: 'demo-rec-baseline-006',
    prompt_id: 'demo-pi-baseline-048', prompt_text: '澜舟的售后服务口碑怎么样，有客户反馈可以参考吗？',
    engine: 'baidu_ai', kind: 'missing', field_path: 'contact',
    answer_excerpt: '回答只引用了论坛帖子，没有给出任何官方联系或报修入口',
    entity_value: '0512-8888-0000 / hello@lanzhou-hb.example.com',
    confidence: 0.66, status: 'open', correction_channel: 'business_directory',
    note: null, resolved_at: null,
  },
  {
    id: 'demo-fc-007', round_id: SEED_RETEST_ROUND_ID, record_id: 'demo-rec-retest-002',
    prompt_id: 'demo-pi-baseline-019', prompt_text: '澜舟和清源环保的布袋除尘器在滤料上有什么不同？',
    engine: 'deepseek', kind: 'outdated', field_path: 'cases',
    answer_excerpt: '案例页仍只列出两条 2024 年的项目',
    entity_value: '某水泥集团 3 条窑线除尘改造；某汽车零部件厂焊接烟尘治理',
    confidence: 0.74, status: 'open', correction_channel: 'official_site',
    note: null, resolved_at: null,
  },
  {
    id: 'demo-fc-008', round_id: SEED_RETEST_ROUND_ID, record_id: 'demo-rec-retest-005',
    prompt_id: 'demo-pi-baseline-011', prompt_text: '采购工业除尘设备时，厂家资质要看哪几项？',
    engine: 'doubao', kind: 'wrong', field_path: 'founded_year',
    answer_excerpt: '回答里提到"成立十余年"',
    entity_value: '（实体卡该字段仍是待确认状态）',
    confidence: 0.41, status: 'false_positive', correction_channel: 'official_site',
    note: '模型据资质页推断年份，实体卡该字段尚未确认，人工判为误报',
    resolved_at: '2026-09-24T03:10:00Z',
  },
  {
    id: 'demo-fc-009', round_id: SEED_LIVE_ROUND_ID, record_id: 'demo-rec-live-001',
    prompt_id: 'demo-pi-baseline-002', prompt_text: '工业除尘设备主要分成哪几类，各自适用什么工况？',
    engine: 'doubao', kind: 'missing', field_path: 'products',
    answer_excerpt: '分类回答里没有把滤筒除尘器的风量区间与滤芯数量写清楚',
    entity_value: '滤筒除尘器：处理风量 2000~20000 m³/h，滤芯数量 4~32 支',
    confidence: 0.63, status: 'open', correction_channel: 'official_site',
    note: null, resolved_at: null,
  },
];

/**
 * 每轮一份核查汇总（**4 轮都有**：连小样本的通道验证轮也出一份）。
 *
 * 通道验证轮那份刻意保留，是为了走查「样本不足时准确率照样显示、但界面必须挂分级提示」这个
 * 降级形态；它的 `checked_answers: 11` 与 `by_kind` 里那 1 条"说旧了"，正是诊断种子里
 * 第 1 轮 `fact_accuracy: 0.91` 与「11 条回答里 1 条把滤芯更换周期说旧了」那句的来源
 * ⇒ 删掉它，诊断页与核查页就会互相打脸（判据在 `demo/seed.test.ts`）。
 *
 * `fact_accuracy` 是**静态值**，但按附录 C 的口径与 `by_kind` / `checked_answers` 手工对齐：
 * 1 − 问题条数 / 已核查回答数（demo 不重算，规则 9）。
 */
export const SEED_FACT_CHECK_SUMMARIES: Record<string, FactCheckSummary> = {
  [SEED_TRIAL_ROUND_ID]: {
    round_id: SEED_TRIAL_ROUND_ID,
    by_kind: { wrong: 0, outdated: 1, missing: 0 },
    checked_answers: 11,
    // 1 − 1 / 11 = 0.909 ⇒ 0.91。
    fact_accuracy: 0.91,
    false_positive_count: 0,
  },
  [SEED_BASELINE_ROUND_ID]: {
    round_id: SEED_BASELINE_ROUND_ID,
    by_kind: { wrong: 9, outdated: 7, missing: 11 },
    checked_answers: 168,
    // 1 − (9+7+11) / 168 = 0.839 ⇒ 0.84（附录 C 的事实准确口径）。
    fact_accuracy: 0.84,
    false_positive_count: 2,
  },
  [SEED_RETEST_ROUND_ID]: {
    round_id: SEED_RETEST_ROUND_ID,
    by_kind: { wrong: 4, outdated: 5, missing: 6 },
    checked_answers: 171,
    // 1 − (4+5+6) / 171 = 0.912 ⇒ 静态值写 0.91，与 `by_kind` 手工自洽（规则 9：demo 不重算）。
    fact_accuracy: 0.91,
    false_positive_count: 3,
  },
  [SEED_LIVE_ROUND_ID]: {
    round_id: SEED_LIVE_ROUND_ID,
    by_kind: { wrong: 1, outdated: 0, missing: 4 },
    checked_answers: 62,
    // 1 − (1+0+4) / 62 = 0.919 ⇒ 0.92。
    fact_accuracy: 0.92,
    false_positive_count: 0,
  },
};

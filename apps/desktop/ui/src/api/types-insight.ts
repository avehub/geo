/**
 * M4 回答解析与事实核查的 IPC 契约类型（demo 优先落地，AGENTS 规则 8）。
 *
 * # 口径来自哪里
 * 产品定义 §3.6：结构化抽取（品牌提及 / 推荐位次 / 情感倾向 / 引用来源归类 / 回答形态）、
 * 事实核查（**说错了 / 说旧了 / 漏说了** 三类，逐字段对照 M1 实体卡）、风险标记、
 * 抽取质量保障（置信度 + 低置信度人工复核队列 + 一键纠正）。
 *
 * # 🔴 demo 里这些都是**预置静态结果**（AGENTS 规则 9）
 * 抽取与核查在真后端是「LLM + 规则双通道」的产物；demo 不跑模型，只把种子里写好的结果端出来。
 * `insight_correct` / `fact_check_resolve` 是**真的**改内存库（人工纠正这条交互必须能走查），
 * 但纠正之后**不会**触发任何重算（准确率、置信度都是静态值）。
 */
import type { AssertComplete, ValuesAreComplete } from './completeness';
import type { EngineId, Sentiment, SourceType } from './types-collection';

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/** 提及的品牌角色：本品牌 / 竞品 / 其他品牌。 */
export type BrandRole = 'self' | 'competitor' | 'other';

export const BRAND_ROLE_VALUES = ['self', 'competitor', 'other'] as const satisfies readonly BrandRole[];

/** 事实核查的三类问题（产品定义 §3.6 的原文口径）。 */
export type FactIssueKind = 'wrong' | 'outdated' | 'missing';

export const FACT_ISSUE_KIND_VALUES = [
  'wrong',
  'outdated',
  'missing',
] as const satisfies readonly FactIssueKind[];

/** 一条核查问题的处置状态：待处理 / 误报 / 已更正。 */
export type FactIssueStatus = 'open' | 'false_positive' | 'corrected';

export const FACT_ISSUE_STATUS_VALUES = [
  'open',
  'false_positive',
  'corrected',
] as const satisfies readonly FactIssueStatus[];

/**
 * 风险标记（产品定义 §3.6「风险标记」）。
 * `absolute_wording` = 广告法风险的绝对化用语；界面上**只说"含需改写的表述"**，
 * 绝不回显命中的词（与 `errors.ts` 对 `compliance/violation` 的处理同一条红线）。
 */
export type RiskFlag =
  | 'regulated_claim'
  | 'absolute_wording'
  | 'suspected_hallucination'
  | 'negative_buzz';

export const RISK_FLAG_VALUES = [
  'regulated_claim',
  'absolute_wording',
  'suspected_hallucination',
  'negative_buzz',
] as const satisfies readonly RiskFlag[];

/** 事实纠错的更正路径（M6 处方库第 3 类要给"去哪儿改"）。 */
export type CorrectionChannel =
  | 'official_site'
  | 'baike_entry'
  | 'third_party_page'
  | 'service_script'
  | 'business_directory';

export const CORRECTION_CHANNEL_VALUES = [
  'official_site',
  'baike_entry',
  'third_party_page',
  'service_script',
  'business_directory',
] as const satisfies readonly CorrectionChannel[];

// ---------------------------------------------------------------------------
// 结构化抽取
// ---------------------------------------------------------------------------

/** 回答形态（是否给结论 / 是否有表格 / 是否反问 / 是否拒答）。 */
export interface AnswerShape {
  has_conclusion: boolean;
  has_table: boolean;
  asks_back: boolean;
  refused: boolean;
}

/** 一条品牌提及。`excerpt` 是回答里的上下文片段（数据级中文，用于举证）。 */
export interface BrandMention {
  brand: string;
  role: BrandRole;
  count: number;
  sentiment: Sentiment;
  /** 推荐位次；未进推荐清单为 null。 */
  rank: number | null;
  in_comparison_table: boolean;
  excerpt: string;
}

/** 一条回答的解析结果（与 `CollectionRecord` 一对一，靠 `record_id` 关联）。 */
export interface AnswerInsight {
  id: string;
  round_id: string;
  record_id: string;
  prompt_id: string;
  prompt_text: string;
  engine: EngineId;
  mentions: BrandMention[];
  self_mentioned: boolean;
  self_rank: number | null;
  self_sentiment: Sentiment | null;
  answer_shape: AnswerShape;
  /** 引用来源归类结果的分布（键是 `SourceType`，值是条数）。 */
  source_types: Partial<Record<SourceType, number>>;
  /** 0~1；低于 `REVIEW_CONFIDENCE_FLOOR` 进人工复核队列。 */
  confidence: number;
  needs_review: boolean;
  risks: RiskFlag[];
  /** 人工纠正过的字段名（稳定 id，界面查词典 `insight.correctedFields.<name>`）。 */
  corrected_fields: string[];
  reviewed_at: string | null;
}

/** 人工纠正的入参：只允许改这三项（其余是模型/规则的产物，不接受手填）。 */
export interface InsightCorrection {
  self_mentioned?: boolean;
  self_rank?: number | null;
  self_sentiment?: Sentiment | null;
}

/**
 * 解析结果列表的筛选条件（全部可选，后端按 AND 组合）。
 *
 * 与 `RecordFilter` 刻意**不合并**：那边筛的是证据行（按采集状态 / 是否提及），
 * 这边筛的是解析产物（按复核队列 / 风险标记）——两组条件分别服务两个页面的两个表格。
 */
export interface InsightFilter {
  engine?: EngineId | null;
  /** 只看低置信度、需要人工复核的那一批（M4 验收点名的复核队列）。 */
  needs_review?: boolean | null;
  self_mentioned?: boolean | null;
  risk?: RiskFlag | null;
}

// ---------------------------------------------------------------------------
// 事实核查
// ---------------------------------------------------------------------------

/**
 * 一条核查问题：回答原文片段 ↔ 实体卡字段值的对照。
 *
 * `field_path` 用**实体卡顶层字段名**（与 `EntityCard.field_status` 的键同口径），
 * 界面据此查 `entity.fields.<path>` 得到字段标签。`missing` 那类没有"回答原文"可引，
 * `answer_excerpt` 装的是"该问题下回答覆盖了什么"的说明性片段（数据）。
 */
export interface FactCheckIssue {
  id: string;
  round_id: string;
  record_id: string;
  prompt_id: string;
  prompt_text: string;
  engine: EngineId;
  kind: FactIssueKind;
  field_path: string;
  answer_excerpt: string;
  /** 实体卡上的真值（数据级中文）；`missing` 那类是"该说而没说的卖点"。 */
  entity_value: string;
  confidence: number;
  status: FactIssueStatus;
  correction_channel: CorrectionChannel;
  note: string | null;
  resolved_at: string | null;
}

/** 核查页的分组汇总（三类的条数 + 误报率，全部静态值）。 */
export interface FactCheckSummary {
  round_id: string;
  by_kind: Record<FactIssueKind, number>;
  checked_answers: number;
  /** 0~1 的静态值：事实准确率 = 1 − 错误条数 / 涉及本品牌的回答条数（附录 C）。 */
  fact_accuracy: number;
  false_positive_count: number;
}

/**
 * 事实核查页首屏：问题清单 + 分组汇总（一次往返，两块 UI 共用）。
 *
 * `summary` 为 `null` 表示该轮**没有可发布的汇总**（第 1 轮只跑了 3 家引擎、样本不足，
 * 种子里就没给它汇总）⇒ 界面显示空状态而不是把 0 当成"准确率为零"。
 */
export interface FactCheckBoard {
  issues: FactCheckIssue[];
  summary: FactCheckSummary | null;
}

// ---------------------------------------------------------------------------
// 编译期完整性网
// ---------------------------------------------------------------------------

export type BrandRoleValuesComplete = AssertComplete<
  ValuesAreComplete<BrandRole, typeof BRAND_ROLE_VALUES>
>;
export type FactIssueKindValuesComplete = AssertComplete<
  ValuesAreComplete<FactIssueKind, typeof FACT_ISSUE_KIND_VALUES>
>;
export type FactIssueStatusValuesComplete = AssertComplete<
  ValuesAreComplete<FactIssueStatus, typeof FACT_ISSUE_STATUS_VALUES>
>;
export type RiskFlagValuesComplete = AssertComplete<
  ValuesAreComplete<RiskFlag, typeof RISK_FLAG_VALUES>
>;
export type CorrectionChannelValuesComplete = AssertComplete<
  ValuesAreComplete<CorrectionChannel, typeof CORRECTION_CHANNEL_VALUES>
>;

/**
 * M3 多引擎采集的 IPC 契约类型（demo 优先落地，AGENTS 规则 8）。
 *
 * # 口径来自哪里
 * 产品定义 §3.5（M3）：引擎矩阵（7 家 P0）、三种采集通道、任务队列与失败重跑、
 * **原始证据留存**（prompt 原文 / 引擎与模型版本 / 完整回答 / 引用链接 / 截图 / 时间戳 /
 * 通道 / 耗时 / token）、重复采样、用量看板（查询次数 + token，金额估算为可选项）。
 *
 * # 🔴 demo 里这些都是**静态数据**（AGENTS 规则 9）
 * 成功率、平均耗时、token 用量在真后端是采集过程的记账结果；demo 一律取种子里预置的值，
 * **不在前端重算**。`collection_start` 也不会真的发请求——它只往内存库里排一个轮次。
 * 差异登记在 `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`。
 *
 * # 金额刻意不进契约
 * spec DR-8：成本看板降级为**用量看板**，`cost_cny` 不作 P0 验收、UI 不展示。
 * 所以这里连字段都不留，免得 demo 里长出一个"看起来能算钱"的界面。
 */
import type { AssertComplete, ValuesAreComplete } from './completeness';
import type { IntentCategory, SampleSizeGrade } from './types';

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/**
 * MVP 引擎矩阵里的 7 家 P0 引擎（产品定义 §3.5 的表）。
 *
 * 值是**稳定 id**（snake_case，与其余枚举同口径），展示文案一律查词典
 * `collection.engines.<id>`（`src/i18n/enum-label.ts` 的 `enumLabel`），查不到回退 id 本身。
 * ⚠ `baidu_ai` 带下划线 ⇒ 它**不能**用作 `*_id` 字段的值（种子的 ASCII id 判据只允许小写与连字符）。
 */
export type EngineId =
  | 'doubao'
  | 'deepseek'
  | 'kimi'
  | 'qwen'
  | 'yuanbao'
  | 'baidu_ai'
  | 'metaso';

export const ENGINE_VALUES = [
  'doubao',
  'deepseek',
  'kimi',
  'qwen',
  'yuanbao',
  'baidu_ai',
  'metaso',
] as const satisfies readonly EngineId[];

/** 三种采集通道（产品定义 §3.5「三种采集通道（适配器架构）」）。 */
export type EngineChannel = 'official_api' | 'browser_automation' | 'gateway';

export const ENGINE_CHANNEL_VALUES = [
  'official_api',
  'browser_automation',
  'gateway',
] as const satisfies readonly EngineChannel[];

/** 单条采集任务 / 单条记录的状态。`skipped` = 该引擎本轮不在范围内或被频控跳过。 */
export type CollectionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export const COLLECTION_STATUS_VALUES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'skipped',
] as const satisfies readonly CollectionStatus[];

/** 一轮采集的整体状态。`partial` = 成功率未达阈值但已有可用数据（MVP 验收：≥90%）。 */
export type RoundStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';

export const ROUND_STATUS_VALUES = [
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
] as const satisfies readonly RoundStatus[];

/**
 * 失败原因的**稳定记号**（语言中立）。
 *
 * 与 `contracts/error-codes.json` 的错误码**刻意不合并**：错误码是「这次调用为什么失败」，
 * 这里是「那条采集任务为什么没拿到回答」，它要进表格与筛选器、要能统计，是数据而不是异常。
 * 文案在 `collection.failureReasons.<id>`。
 */
export type FailureReason =
  | 'rate_limited'
  | 'timeout'
  | 'blocked'
  | 'login_required'
  | 'empty_answer'
  | 'transport';

export const FAILURE_REASON_VALUES = [
  'rate_limited',
  'timeout',
  'blocked',
  'login_required',
  'empty_answer',
  'transport',
] as const satisfies readonly FailureReason[];

/**
 * 引用来源类型（M4 的自动归类口径，产品定义 §3.6）。
 * 放在采集侧是因为**引用链接本身是原始证据**（跟着回答一起留存），归类只是给它贴标签。
 * 与 `AssetKind`（M1 的资产登记）同族但**不合并**：那边是"我有哪些资产"，这边是"AI 引了什么"。
 */
export type SourceType =
  | 'owned_page'
  | 'baike'
  | 'news_media'
  | 'zhihu'
  | 'xiaohongshu'
  | 'ecommerce'
  | 'official_doc'
  | 'forum'
  | 'other';

export const SOURCE_TYPE_VALUES = [
  'owned_page',
  'baike',
  'news_media',
  'zhihu',
  'xiaohongshu',
  'ecommerce',
  'official_doc',
  'forum',
  'other',
] as const satisfies readonly SourceType[];

/** 情感倾向（M4 抽取产物，采集记录列表也要显示，因此定义在这一层被 M4 复用）。 */
export type Sentiment = 'positive' | 'neutral' | 'negative';

export const SENTIMENT_VALUES = [
  'positive',
  'neutral',
  'negative',
] as const satisfies readonly Sentiment[];

// ---------------------------------------------------------------------------
// 轮次 / 引擎 / 任务
// ---------------------------------------------------------------------------

/** 一轮采集（= 一次复测的口径快照）。`metric_spec_version` 与题库同源，保证环比可比。 */
export interface CollectionRound {
  id: string;
  project_id: string;
  prompt_set_id: string;
  /** 题库名（数据级中文，与 `PromptSet.label` 同源）。 */
  prompt_set_label: string;
  prompt_set_version: number;
  /** 轮次名（数据级中文，例如「第 1 轮 · 基线体检」）。 */
  label: string;
  round_index: number;
  status: RoundStatus;
  engine_scope: EngineId[];
  /** 关键 prompt 的重复采样次数（1/2/3，产品定义 §3.5）。 */
  repeat_count: number;
  planned_queries: number;
  completed_queries: number;
  failed_queries: number;
  /** 0~1 的静态值（规则 9：demo 不用 completed/planned 重算）。 */
  success_rate: number;
  started_at: string | null;
  finished_at: string | null;
  metric_spec_version: string;
  sample_size_grade: SampleSizeGrade;
  notes: string | null;
}

/** 一轮里某个引擎的执行汇总。 */
export interface EngineRun {
  engine: EngineId;
  channel: EngineChannel;
  /** 模型版本（证据留存要求"引擎与模型版本"可回溯）。 */
  model: string;
  planned: number;
  succeeded: number;
  failed: number;
  avg_latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
}

/** 队列里的一条任务（prompt × 引擎 × 第几次重复）。 */
export interface CollectionTask {
  id: string;
  round_id: string;
  prompt_id: string;
  /** 题目原文（数据）。 */
  prompt_text: string;
  intent: IntentCategory;
  engine: EngineId;
  channel: EngineChannel;
  status: CollectionStatus;
  /** 第几次尝试（重试会 +1）。 */
  attempt: number;
  failure_reason: FailureReason | null;
  /** 成功后指向的证据记录；失败为 null。 */
  record_id: string | null;
  queued_at: string;
  finished_at: string | null;
  latency_ms: number | null;
}

// ---------------------------------------------------------------------------
// 原始证据（产品护城河：任何分数都能下钻到这里）
// ---------------------------------------------------------------------------

/** 一条引用链接。`source_type` 是 M4 的自动归类结果，随证据一起留存。 */
export interface Citation {
  url: string;
  domain: string;
  title: string | null;
  source_type: SourceType;
}

/** 证据列表行（不含回答全文，避免一次拉回上百段文本）。 */
export interface CollectionRecord {
  id: string;
  round_id: string;
  prompt_id: string;
  prompt_text: string;
  intent: IntentCategory;
  engine: EngineId;
  model: string;
  channel: EngineChannel;
  status: CollectionStatus;
  failure_reason: FailureReason | null;
  /** 本品牌是否被提及（M4 抽取结果的回填，列表里用于快速筛"有没有我"）。 */
  mentioned: boolean;
  /** 推荐位次；仅提及未进推荐清单时为 null。 */
  rank: number | null;
  sentiment: Sentiment | null;
  citation_count: number;
  collected_at: string;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  /** 重复采样的第几次（1 起）。 */
  repeat_index: number;
}

/** 单条证据的完整快照：回答全文 + 引用列表 + 截图。 */
export interface CollectionRecordDetail extends CollectionRecord {
  /** 回答全文（数据级中文，原样留存，不做摘要）。 */
  answer_text: string;
  citations: Citation[];
  /**
   * 截图路径。demo 里恒为 `null`：假后端不抓网页也不截图，编一个路径就是假证据。
   * 界面因此显示"演示数据未包含截图"的空状态（词典 `collection.evidence.noScreenshot`）。
   */
  screenshot_path: string | null;
}

/** 记录列表的筛选条件（全部可选；后端按 AND 组合）。 */
export interface RecordFilter {
  engine?: EngineId | null;
  intent?: IntentCategory | null;
  mentioned?: boolean | null;
  status?: CollectionStatus | null;
}

// ---------------------------------------------------------------------------
// 用量看板（M3 / M8：查询次数 + token，带硬配额）
// ---------------------------------------------------------------------------

/** 每轮的用量行。 */
export interface UsageRow {
  round_id: string;
  round_label: string;
  queries: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * 项目级用量看板。
 *
 * `quota_*` 是用户在设置里定的**硬配额**（超额自动暂停并提示）；`quota_exceeded` 由后端判定，
 * demo 取种子里的静态值（规则 9）。
 */
export interface UsageBoard {
  project_id: string;
  rows: UsageRow[];
  total_queries: number;
  total_tokens: number;
  quota_queries: number | null;
  quota_tokens: number | null;
  quota_exceeded: boolean;
}

/** 采集页首屏：轮次列表 + 用量看板（一次往返拿全，避免两个 loading 打架）。 */
export interface CollectionBoard {
  rounds: CollectionRound[];
  usage: UsageBoard;
}

/** 一轮的详情：轮次本身 + 各引擎执行汇总 + 队列任务。 */
export interface CollectionRoundDetail {
  round: CollectionRound;
  engines: EngineRun[];
  tasks: CollectionTask[];
}

/** `collection_start` 的入参。 */
export interface CollectionStartOptions {
  prompt_set_id: string;
  engine_scope: EngineId[];
  repeat_count: number;
  label?: string | null;
}

// ---------------------------------------------------------------------------
// 编译期完整性网（漏一个联合成员 `tsc -b` 就红）
// ---------------------------------------------------------------------------

export type EngineValuesComplete = AssertComplete<
  ValuesAreComplete<EngineId, typeof ENGINE_VALUES>
>;
export type EngineChannelValuesComplete = AssertComplete<
  ValuesAreComplete<EngineChannel, typeof ENGINE_CHANNEL_VALUES>
>;
export type CollectionStatusValuesComplete = AssertComplete<
  ValuesAreComplete<CollectionStatus, typeof COLLECTION_STATUS_VALUES>
>;
export type RoundStatusValuesComplete = AssertComplete<
  ValuesAreComplete<RoundStatus, typeof ROUND_STATUS_VALUES>
>;
export type FailureReasonValuesComplete = AssertComplete<
  ValuesAreComplete<FailureReason, typeof FAILURE_REASON_VALUES>
>;
export type SourceTypeValuesComplete = AssertComplete<
  ValuesAreComplete<SourceType, typeof SOURCE_TYPE_VALUES>
>;
export type SentimentValuesComplete = AssertComplete<
  ValuesAreComplete<Sentiment, typeof SENTIMENT_VALUES>
>;

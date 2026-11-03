/**
 * M5 可见度诊断与竞品对标的 IPC 契约类型（demo 优先落地，AGENTS 规则 8）。
 *
 * # 口径来自哪里
 * 产品定义 §3.7 与附录 C：头号 KPI 是 **Brand Coverage**；体检总分按五维加权
 * （可见度 0.35 / 推荐力 0.25 / 口碑情感 0.15 / 事实准确 0.15 / 信源健康 0.10）；
 * **总分旁必须显示样本量与置信区间**；视图含竞品对标矩阵、意图漏斗、引擎差异、趋势与告警。
 *
 * # 🔴 demo 里所有分数都是**静态值**（AGENTS 规则 9）
 * 五维加权、覆盖率、Share of Voice、来源留存率都是 Rust 纯函数的活儿。demo 只端出预置结果，
 * 但种子里的数字**手工满足**附录 C 的公式（与实体卡 `completeness` 同一套自洽纪律，
 * 判据在 `src/demo/seed/diagnosis.test.ts` 之外的 `demo/seed.test.ts`）——
 * 免得产品负责人拿计算器一按就发现界面自相矛盾。
 *
 * # 波动是**特性**不是缺陷
 * `*_margin` 字段（±）与 `sample_size_grade` 一起上屏：样本不足时总分置灰、只给方向性结论
 * （产品定义 §4「统计纪律」）。界面文案不得把区间藏起来。
 */
import type { AssertComplete, ValuesAreComplete } from './completeness';
import type { EngineId, RoundStatus } from './types-collection';
import type { SampleSizeGrade } from './types';

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/** 体检总分的五个维度（附录 C 的加权项，顺序即界面展示顺序）。 */
export type DiagnosisDimension =
  | 'visibility'
  | 'recommendation'
  | 'sentiment'
  | 'fact_accuracy'
  | 'source_health';

export const DIAGNOSIS_DIMENSION_VALUES = [
  'visibility',
  'recommendation',
  'sentiment',
  'fact_accuracy',
  'source_health',
] as const satisfies readonly DiagnosisDimension[];

/** 意图漏斗的三层（认知 → 推荐 → 决策）。 */
export type FunnelStage = 'awareness' | 'recommendation' | 'decision';

export const FUNNEL_STAGE_VALUES = [
  'awareness',
  'recommendation',
  'decision',
] as const satisfies readonly FunnelStage[];

/** 告警类型（产品定义 §3.7 视图 6）。 */
export type AlertKind =
  | 'coverage_drop'
  | 'negative_sentiment'
  | 'fact_error'
  | 'competitor_overtake';

export const ALERT_KIND_VALUES = [
  'coverage_drop',
  'negative_sentiment',
  'fact_error',
  'competitor_overtake',
] as const satisfies readonly AlertKind[];

export type AlertSeverity = 'info' | 'warning' | 'critical';

export const ALERT_SEVERITY_VALUES = [
  'info',
  'warning',
  'critical',
] as const satisfies readonly AlertSeverity[];

// ---------------------------------------------------------------------------
// 总分与维度
// ---------------------------------------------------------------------------

/** 一个维度的得分。`weight` 是附录 C 的权重（静态值，界面用来解释"这维占多少"）。 */
export interface DimensionScore {
  dimension: DiagnosisDimension;
  /** 0~100。 */
  score: number;
  weight: number;
  /** 支撑这一维的样本条数（下钻入口的判据：0 就没有可下钻的东西）。 */
  sample_size: number;
  /** 该维的说明（数据级中文，例如"被提及 26 / 62 条"）。 */
  detail: string;
}

/** 一轮的趋势点（环比折线的一个数据点）。 */
export interface TrendPoint {
  round_id: string;
  round_label: string;
  collected_at: string;
  status: RoundStatus;
  /** 0~1。 */
  brand_coverage: number;
  /** ± 波动区间（重复采样得到，产品定义 §4）。 */
  coverage_margin: number;
  /** 0~100。 */
  total_score: number;
  /** 0~1。 */
  fact_accuracy: number;
  sample_size: number;
}

/** 一条告警。`detail` 是数据级中文（归因说明），`metric` 是稳定记号（查词典）。 */
export interface AlertItem {
  id: string;
  project_id: string;
  round_id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  engine: EngineId | null;
  /** 稳定记号：`brand_coverage` / `fact_error_count` / `negative_rate` / `share_of_voice`。 */
  metric: string;
  /**
   * 变化量；无环比基准时为 null。比率类装**百分点**（`-14` = 降 14 个百分点，
   * **不是** `-0.14`），条数类（`fact_error_count`）装条数。
   *
   * 🔴 与 `ReportMetricBlock.delta` **同一个口径**（Plan B Task 8 · 裁定 3 / 差异台账 E-40）：
   * 单位由 `components/format.ts` 的 `alertMetricUnit(metric)` 给出，格式化共用
   * `metricDeltaText`。统一之前这里装的是 0~1 的比率、由一个专门的 `alertDeltaText` 乘 100，
   * 那个函数已删除——再加消费方时不要按旧口径填种子。
   */
  delta: number | null;
  detail: string;
  acknowledged: boolean;
  raised_at: string;
}

/** 诊断首屏：总分 + 五维 + 头号 KPI + 趋势 + 告警。 */
export interface DiagnosisOverview {
  project_id: string;
  round_id: string;
  round_label: string;
  collected_at: string;
  /** 0~100 的静态值；样本不足时界面置灰并提示"数据不足"。 */
  total_score: number;
  /** ± 区间（与 `brand_coverage_margin` 同源的那套重复采样口径）。 */
  score_margin: number;
  sample_size: number;
  sample_size_grade: SampleSizeGrade;
  dimensions: DimensionScore[];
  /** 头号 KPI：0~1。 */
  brand_coverage: number;
  brand_coverage_margin: number;
  /** 同框 prompt 里的提及份额：0~1。 */
  share_of_voice: number;
  /** 0~1。 */
  fact_accuracy: number;
  /** 被引域名去重数（信源健康的组成项，界面只做展示不做归一化计算）。 */
  distinct_cited_domains: number;
  trend: TrendPoint[];
  alerts: AlertItem[];
  metric_spec_version: string;
}

// ---------------------------------------------------------------------------
// 竞品对标矩阵 / 意图漏斗 / 引擎差异
// ---------------------------------------------------------------------------

/** 矩阵的一行（一个品牌）。`is_self` 决定界面高亮。 */
export interface CompetitorMatrixRow {
  /** 品牌名（数据）。 */
  brand: string;
  is_self: boolean;
  coverage: number;
  share_of_voice: number;
  top1_rate: number;
  top3_rate: number;
  mention_only_rate: number;
  positive_rate: number;
  negative_rate: number;
  fact_error_count: number;
  cited_domain_count: number;
}

export interface CompetitorMatrix {
  round_id: string;
  sample_size: number;
  /** 同框 prompt 条数（Share of Voice 的分母，界面上要显式说明口径）。 */
  head_to_head_prompt_count: number;
  rows: CompetitorMatrixRow[];
}

/** 漏斗的一层。`prompt_count` 让"这层有多少题"可见，避免小分母误导。 */
export interface FunnelRow {
  stage: FunnelStage;
  prompt_count: number;
  mention_rate: number;
  top3_rate: number;
}

export interface IntentFunnel {
  round_id: string;
  rows: FunnelRow[];
  /** 病症结论（数据级中文，例如"认知层有、推荐层无"）。 */
  diagnosis_note: string;
}

/** 引擎差异视图的一行：哪个引擎最认可你、哪个最容易说错你。 */
export interface EngineScore {
  engine: EngineId;
  sample_size: number;
  coverage: number;
  top3_rate: number;
  positive_rate: number;
  /** 0~1；界面按它倒序排（附录 C 的事实准确口径的补集）。 */
  fact_error_rate: number;
  success_rate: number;
  avg_latency_ms: number;
}

// ---------------------------------------------------------------------------
// 编译期完整性网
// ---------------------------------------------------------------------------

export type DiagnosisDimensionValuesComplete = AssertComplete<
  ValuesAreComplete<DiagnosisDimension, typeof DIAGNOSIS_DIMENSION_VALUES>
>;
export type FunnelStageValuesComplete = AssertComplete<
  ValuesAreComplete<FunnelStage, typeof FUNNEL_STAGE_VALUES>
>;
export type AlertKindValuesComplete = AssertComplete<
  ValuesAreComplete<AlertKind, typeof ALERT_KIND_VALUES>
>;
export type AlertSeverityValuesComplete = AssertComplete<
  ValuesAreComplete<AlertSeverity, typeof ALERT_SEVERITY_VALUES>
>;

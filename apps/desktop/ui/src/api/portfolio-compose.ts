/**
 * M9 多项目组合汇总的**数据层**（纯函数；本轮只有项目页渲染，组合页在 M9 落地）。
 *
 * # 为什么单独一个文件
 * `overview-compose.ts` 管**单项目**的选择 / 环比 / 风险 / 行动（约 300 行）；
 * 这里管**跨项目**的快照与汇总。两者分开，M9 落地时只改这一个文件，不会碰首页的取数逻辑。
 *
 * # 🔴 组合口径（与 `docs/superpowers/specs/2026-10-29-project-overview-home-design.md` §6 一致）
 * 1. 比率**不平均、不求和**：不同项目的分母（题量 / 引擎覆盖 / 同框题数）不同，
 *    "组合覆盖率"没有解释；组合层只给 **min / median / max 分布**与逐项目行。
 * 2. `total_sample_size` 可以求和（它是计数，不是比率）。
 * 3. 没有结论的项目计入项目数，但不进指标分布；样本不是 `sufficient` 的计入
 *    `projects_insufficient`。
 * 4. 默认排除归档项目；`includeArchived` 显式打开。
 * 5. 不做跨项目环比：不同项目的轮次时间不同，相减没有意义。
 *
 * # 依赖方向
 * 只 import 契约 DTO 与 `overview-compose` 的纯函数；不 import demo、不查词典、不产自然语言。
 */
import type {
  ActionItem,
  CollectionRound,
  DiagnosisOverview,
  Project,
  SampleSizeGrade,
} from './types';
import {
  buildActionProgress,
  buildHeadlineMetrics,
  type ActionProgress,
  type OverviewMetric,
  type OverviewMetricKey,
  type OverviewRisk,
  type OverviewRiskSource,
} from './overview-compose';

export interface OverviewRoundRef {
  id: string;
  label: string;
  round_index: number;
  collected_at: string;
  sample_size: number;
  sample_size_grade: SampleSizeGrade;
  metric_spec_version: string;
}

export interface OverviewProjectRef {
  id: string;
  name: string;
  brand_name: string;
  status: Project['status'];
  website: string | null;
}

/**
 * 一个项目的概览快照。
 *
 * 🔴 项目页与 M9 组合表**共用这个形状**：项目页渲染一份，组合表渲染多份。
 * 这样"单项目首页"与"多项目汇总"不会各造一套字段，M9 落地时不需要再改一遍数据口径。
 */
export interface ProjectOverviewSnapshot {
  project: OverviewProjectRef;
  round: OverviewRoundRef | null;
  metrics: OverviewMetric[];
  risks: OverviewRisk[];
  actions: ActionProgress;
}

export interface ProjectSnapshotInput {
  project: Project;
  round: CollectionRound | null;
  overview: DiagnosisOverview | null;
  previous: DiagnosisOverview | null;
  risks: readonly OverviewRisk[];
  actions: readonly ActionItem[];
}

/** 从页面已取到的 DTO 组装一份快照；没有结论时 `round` / `metrics` 都为空。 */
export function buildProjectSnapshot(input: ProjectSnapshotInput): ProjectOverviewSnapshot {
  const { project, round, overview } = input;
  const hasConclusion = round !== null && overview !== null;

  return {
    project: {
      id: project.id,
      name: project.name,
      brand_name: project.brand_name,
      status: project.status,
      website: project.website,
    },
    round:
      hasConclusion
        ? {
            id: round.id,
            label: round.label,
            round_index: round.round_index,
            collected_at: overview.collected_at,
            sample_size: overview.sample_size,
            sample_size_grade: overview.sample_size_grade,
            metric_spec_version: overview.metric_spec_version,
          }
        : null,
    metrics: hasConclusion ? buildHeadlineMetrics(overview, input.previous) : [],
    risks: [...input.risks],
    actions: buildActionProgress(input.actions),
  };
}

// ---------------------------------------------------------------------------
// 组合汇总
// ---------------------------------------------------------------------------

export interface MetricDistribution {
  count: number;
  min: number | null;
  median: number | null;
  max: number | null;
}

export interface PortfolioRollup {
  project_count: number;
  projects_with_round: number;
  /** 样本不是 `sufficient` 的项目数（`directional` + `insufficient`）。 */
  projects_insufficient: number;
  total_sample_size: number;
  projects_with_risks: number;
  risks_total: number;
  risks_by_source: Record<OverviewRiskSource, number>;
  /** 每个指标的**分布**，不是平均值（见文件头）。 */
  distribution: Record<OverviewMetricKey, MetricDistribution>;
  latest_collected_at: string | null;
  oldest_collected_at: string | null;
  /** 逐项目行，按「风险多 → 覆盖低 → 名称」排：先看最需要处理的项目。 */
  rows: ProjectOverviewSnapshot[];
}

function roundTo4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function distributionOf(values: readonly number[]): MetricDistribution {
  if (values.length === 0) return { count: 0, min: null, median: null, max: null };
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    count: sorted.length,
    min: roundTo4(sorted[0]),
    median: roundTo4(median),
    max: roundTo4(sorted[sorted.length - 1]),
  };
}

function coverageOf(snapshot: ProjectOverviewSnapshot): number | null {
  return snapshot.metrics.find((metric) => metric.key === 'brand_coverage')?.value ?? null;
}

/**
 * 多项目组合汇总（M9 的数据层；本轮不渲染组合页）。
 *
 * - 默认排除归档项目（与左侧栏、项目列表的默认口径一致）；
 * - 没有结论的项目仍计入 `project_count`，但不进任何指标分布；
 * - 比率**只给分布**，不求和、不平均、不给"组合覆盖率"这种伪指标；
 * - `total_sample_size` 可以求和，因为它是计数（不是比率）。
 */
export function summarizePortfolio(
  snapshots: readonly ProjectOverviewSnapshot[],
  options: { includeArchived?: boolean } = {},
): PortfolioRollup {
  const includeArchived = options.includeArchived ?? false;
  const included = snapshots.filter(
    (snapshot) => includeArchived || snapshot.project.status !== 'archived',
  );

  const metrics: OverviewMetricKey[] = [
    'brand_coverage',
    'total_score',
    'share_of_voice',
    'fact_accuracy',
  ];
  const distribution = {} as Record<OverviewMetricKey, MetricDistribution>;
  for (const key of metrics) {
    distribution[key] = distributionOf(
      included
        .map((snapshot) => snapshot.metrics.find((metric) => metric.key === key)?.value)
        .filter((value): value is number => value !== undefined),
    );
  }

  const rounds = included
    .map((snapshot) => snapshot.round)
    .filter((round): round is OverviewRoundRef => round !== null);
  const collected = rounds.map((round) => round.collected_at).sort();

  const risks_by_source: Record<OverviewRiskSource, number> = {
    alert: 0,
    fact_check: 0,
    review: 0,
  };
  let risksTotal = 0;
  for (const snapshot of included) {
    for (const risk of snapshot.risks) {
      risks_by_source[risk.source] += risk.count;
      risksTotal += risk.count;
    }
  }

  const rows = [...included].sort((left, right) => {
    const leftRisks = left.risks.reduce((sum, risk) => sum + risk.count, 0);
    const rightRisks = right.risks.reduce((sum, risk) => sum + risk.count, 0);
    if (leftRisks !== rightRisks) return rightRisks - leftRisks;

    const leftCoverage = coverageOf(left);
    const rightCoverage = coverageOf(right);
    if (leftCoverage !== rightCoverage) {
      if (leftCoverage === null) return 1;
      if (rightCoverage === null) return -1;
      return leftCoverage - rightCoverage;
    }
    return left.project.name < right.project.name ? -1 : 1;
  });

  return {
    project_count: included.length,
    projects_with_round: rounds.length,
    projects_insufficient: rounds.filter((round) => round.sample_size_grade !== 'sufficient').length,
    total_sample_size: rounds.reduce((sum, round) => sum + round.sample_size, 0),
    projects_with_risks: included.filter((snapshot) => snapshot.risks.length > 0).length,
    risks_total: risksTotal,
    risks_by_source,
    distribution,
    latest_collected_at: collected.length === 0 ? null : collected[collected.length - 1],
    oldest_collected_at: collected.length === 0 ? null : collected[0],
    rows,
  };
}

// ---------------------------------------------------------------------------
// 组合页的筛选 / 排序
// ---------------------------------------------------------------------------

export type PortfolioFilter = 'all' | 'concluded' | 'onboarding' | 'risks';
export type PortfolioSort = 'risk' | 'coverage' | 'recent';

export interface PortfolioQuery {
  filter?: PortfolioFilter;
  /** 项目名 / 品牌名子串；空白串不筛。 */
  query?: string | null;
  sort?: PortfolioSort;
}

function riskTotalOf(snapshot: ProjectOverviewSnapshot): number {
  return snapshot.risks.reduce((sum, risk) => sum + risk.count, 0);
}

function collectedAtOf(snapshot: ProjectOverviewSnapshot): string | null {
  return snapshot.round?.collected_at ?? null;
}

/** 覆盖低在前；没有结论的排最后（"待采集"不该被当成 0 分排在最前）。 */
function compareCoverage(left: ProjectOverviewSnapshot, right: ProjectOverviewSnapshot): number {
  const leftCoverage = coverageOf(left);
  const rightCoverage = coverageOf(right);
  if (leftCoverage === rightCoverage) return 0;
  if (leftCoverage === null) return 1;
  if (rightCoverage === null) return -1;
  return leftCoverage - rightCoverage;
}

function compareRisk(left: ProjectOverviewSnapshot, right: ProjectOverviewSnapshot): number {
  const diff = riskTotalOf(right) - riskTotalOf(left);
  if (diff !== 0) return diff;
  const coverage = compareCoverage(left, right);
  if (coverage !== 0) return coverage;
  return left.project.name < right.project.name ? -1 : 1;
}

function compareRecent(left: ProjectOverviewSnapshot, right: ProjectOverviewSnapshot): number {
  const leftAt = collectedAtOf(left);
  const rightAt = collectedAtOf(right);
  if (leftAt !== rightAt) {
    if (leftAt === null) return 1;
    if (rightAt === null) return -1;
    return leftAt < rightAt ? 1 : -1;
  }
  return compareRisk(left, right);
}

/**
 * 组合页的筛选 + 搜索 + 排序（纯函数；页面只渲染结果）。
 *
 * 🔴 `risk` 是默认排序：先看最需要处理的项目，而不是"最近创建"。
 * 🔴 `coverage` / `recent` 都把没有结论的项目放最后：待采集不是 0 分，也不该冒充最新。
 */
export function filterPortfolioRows(
  rows: readonly ProjectOverviewSnapshot[],
  options: PortfolioQuery = {},
): ProjectOverviewSnapshot[] {
  const filter = options.filter ?? 'all';
  const query = (options.query ?? '').trim().toLowerCase();
  const sort = options.sort ?? 'risk';

  const filtered = rows.filter((row) => {
    if (filter === 'concluded' && row.round === null) return false;
    if (filter === 'onboarding' && row.round !== null) return false;
    if (filter === 'risks' && riskTotalOf(row) === 0) return false;
    if (query !== '') {
      const haystack = `${row.project.name}\u0000${row.project.brand_name}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  return filtered.slice().sort((left, right) => {
    if (sort === 'coverage') {
      const coverage = compareCoverage(left, right);
      return coverage !== 0 ? coverage : compareRisk(left, right);
    }
    if (sort === 'recent') return compareRecent(left, right);
    return compareRisk(left, right);
  });
}

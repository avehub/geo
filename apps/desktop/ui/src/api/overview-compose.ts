/**
 * 项目概览的**组装层**（纯函数；命令面不加，照 `search-compose.ts` 的同一条裁定）。
 *
 * # 它解决的三件事
 * 1. **选结论**：`CollectionRound.status` 里只有 `succeeded` / `partial` 算结论；
 *    进行中（`running`）与排队/失败的轮次不能上首页——把半跑完的数字当结论是这一页最坏的失败形态。
 * 2. **取环比**：`DiagnosisOverview` 只给当前轮的单点值，没有上一轮对照；这里按
 *    `round_index` 找上一轮，并在 `metric_spec_version` 变化时**拒绝给环比**（口径变了，
 *    相减没有解释）。
 * 3. **排风险**：告警 / 事实核查 / 人工复核队列散在三个 DTO 里；这里统一成一条队列，
 *    按「严重度 → 来源 → 新轮次优先」排，供首页只展示前几条。
 *
 * # 🔴 规则 9：这里不做领域算法
 * 覆盖率、准确率、总分、样本分级一律是后端/种子的静态值。本文件只做**选择、相减、计数、
 * 排序、分位数**；不重算五维、不判定优化机会、不重算样本分级。
 *
 * # 🔴 M9 组合视角的口径（本文件从第一天就为它留好形状）
 * `summarizePortfolio` **不把各项目的比率取平均**：不同项目的分母（题量 / 引擎覆盖）不同，
 * 平均出来的「组合覆盖率」没有解释。组合层只给：
 * - **计数**（项目数 / 有结论的项目数 / 样本不足的项目数 / 总样本量 / 有风险的项目数）；
 * - **分布**（每个指标的 min / median / max）——这是「这 20 个客户里最差的是谁」，
 *   而不是一个假的总分；
 * - **逐项目行**（`rows`），供 M9 的组合表直接渲染。
 * 真后端若将来加 `portfolio_overview` 命令，必须复用这套口径；否则同一个组合会出现两个数。
 *
 * # 依赖方向
 * 只 `import type` 契约 DTO，不 import demo、不查词典、不产生自然语言——换语言不改任何一个数字。
 */
import type {
  ActionItem,
  AlertItem,
  AlertSeverity,
  AnswerInsight,
  CollectionRound,
  DiagnosisOverview,
  FactCheckBoard,
  FactIssueKind,
} from './types';

// ---------------------------------------------------------------------------
// 轮次选择
// ---------------------------------------------------------------------------

/** 能产出结论的轮次状态（与报告页的 `UNRENDERABLE_STATUSES` 互为补集）。 */
const CONCLUSIVE_STATUSES = ['succeeded', 'partial'] as const;

/** 有结论的轮次，按 `round_index` 升序（种子/后端的顺序不保证）。 */
export function conclusiveRounds(rounds: readonly CollectionRound[]): CollectionRound[] {
  return rounds
    .filter((round) => (CONCLUSIVE_STATUSES as readonly string[]).includes(round.status))
    .slice()
    .sort((left, right) => left.round_index - right.round_index);
}

/** 最近一轮有结论的；没有就回 `null`（首页显示空态，不是报错）。 */
export function latestConclusiveRound(rounds: readonly CollectionRound[]): CollectionRound | null {
  const conclusive = conclusiveRounds(rounds);
  return conclusive.length === 0 ? null : conclusive[conclusive.length - 1];
}

/**
 * 某一轮的上一轮有结论轮次；没有就回 `null`。
 * 只按**有结论的轮次**排序找前一个——中间夹一个失败轮次不该把环比断掉。
 */
export function previousConclusiveRound(
  rounds: readonly CollectionRound[],
  roundId: string,
): CollectionRound | null {
  const conclusive = conclusiveRounds(rounds);
  const index = conclusive.findIndex((round) => round.id === roundId);
  return index <= 0 ? null : conclusive[index - 1];
}

// ---------------------------------------------------------------------------
// 头号 KPI
// ---------------------------------------------------------------------------

export type OverviewMetricKey =
  | 'brand_coverage'
  | 'total_score'
  | 'share_of_voice'
  | 'fact_accuracy';

export type OverviewMetricUnit = 'percent' | 'score';

/**
 * 首页的一个头号指标。
 *
 * - `value`：原值（比率 0~1；总分 0~100），由界面按 `unit` 格式化；
 * - `delta`：**展示单位**的环比（比率类装百分点，总分装分），与 `ReportMetricBlock.delta`
 *   同一个口径（裁定 3 / E-40）；
 * - `margin`：比率类的 ± 区间也换算成百分点；没有区间的指标为 `null`。
 */
export interface OverviewMetric {
  key: OverviewMetricKey;
  unit: OverviewMetricUnit;
  value: number;
  delta: number | null;
  margin: number | null;
}

/** 一位小数：种子的比率是两位小数，相减后保留到 0.1 个百分点已经足够。 */
function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function ratioDelta(current: number, previous: number | null): number | null {
  return previous === null ? null : roundToTenth((current - previous) * 100);
}

/** 总分环比：单位本来就是分，不乘 100（与 `ratioDelta` 的区别只有这一处）。 */
function scoreDelta(current: number, previous: number | null): number | null {
  return previous === null ? null : roundToTenth(current - previous);
}

/**
 * 四个头号 KPI（顺序即首页展示顺序）。
 *
 * 🔴 上一轮缺失、或 `metric_spec_version` 与当前轮不同 ⇒ 四个环比一律 `null`：
 * 口径变了还相减，会把「换了尺子」显示成「业绩变化」。
 */
export function buildHeadlineMetrics(
  current: DiagnosisOverview,
  previous: DiagnosisOverview | null,
): OverviewMetric[] {
  const comparable =
    previous !== null && previous.metric_spec_version === current.metric_spec_version;
  const previousValue = (pick: (overview: DiagnosisOverview) => number): number | null =>
    comparable ? pick(previous) : null;

  return [
    {
      key: 'brand_coverage',
      unit: 'percent',
      value: current.brand_coverage,
      delta: ratioDelta(current.brand_coverage, previousValue((overview) => overview.brand_coverage)),
      margin: roundToTenth(current.brand_coverage_margin * 100),
    },
    {
      key: 'total_score',
      unit: 'score',
      value: current.total_score,
      delta: scoreDelta(
        current.total_score,
        previousValue((overview) => overview.total_score),
      ),
      margin: roundToTenth(current.score_margin),
    },
    {
      key: 'share_of_voice',
      unit: 'percent',
      value: current.share_of_voice,
      delta: ratioDelta(current.share_of_voice, previousValue((overview) => overview.share_of_voice)),
      margin: null,
    },
    {
      key: 'fact_accuracy',
      unit: 'percent',
      value: current.fact_accuracy,
      delta: ratioDelta(current.fact_accuracy, previousValue((overview) => overview.fact_accuracy)),
      margin: null,
    },
  ];
}

// ---------------------------------------------------------------------------
// 风险队列
// ---------------------------------------------------------------------------

export type OverviewRiskSource = 'alert' | 'fact_check' | 'review';

export interface OverviewRisk {
  /** 稳定 id：`alert:<id>` / `fact:<round>:<kind>` / `review:<round>`。 */
  id: string;
  source: OverviewRiskSource;
  severity: AlertSeverity;
  /** 这一条代表多少件：告警恒为 1；事实问题与复核队列是条数。 */
  count: number;
  /** 告警类型 / 事实问题类型；复核队列没有类型（`null`）。 */
  kind: string | null;
  round_id: string | null;
  round_label: string | null;
  /** 数据级说明（告警的 `detail`）；其余来源为 `null`。 */
  detail: string | null;
}

export interface RiskQueueInput {
  alerts: readonly AlertItem[];
  /** 全部轮次，只用于查轮次名与排新轮优先；结论范围由调用方在下面两个入参里收敛。 */
  rounds: readonly CollectionRound[];
  /** 只传**有结论**轮次的核查看板。 */
  factBoards: readonly { roundId: string; board: FactCheckBoard }[];
  /** 只传**有结论**轮次的待复核队列（调用方按 `needs_review` 过滤）。 */
  reviewQueues: readonly { roundId: string; insights: readonly AnswerInsight[] }[];
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
const SOURCE_RANK: Record<OverviewRiskSource, number> = { alert: 0, fact_check: 1, review: 2 };

/** 事实问题的严重度：说错了会误导客户 → 严重；说旧了 → 警告；漏说了 → 提示。 */
const FACT_SEVERITY: Record<FactIssueKind, AlertSeverity> = {
  wrong: 'critical',
  outdated: 'warning',
  missing: 'info',
};

const FACT_ORDER: readonly FactIssueKind[] = ['wrong', 'outdated', 'missing'];

/**
 * 把三类待办合成一条队列。
 *
 * 🔴 告警只收**未读**的：已读告警是"看过了"的账，不是今天要处理的活。
 * 🔴 事实问题只数 `status === 'open'`：已更正 / 误报都不该继续占队列。
 * 🔴 同一轮的同一种事实问题合成**一行**（`count` 是条数），但**不同轮次不合并**：
 * 首页要能点回是哪一轮说的，合并后证据就丢了。
 */
export function buildRiskQueue(input: RiskQueueInput): OverviewRisk[] {
  const labelOf = new Map(input.rounds.map((round) => [round.id, round.label]));
  const indexOf = new Map(input.rounds.map((round) => [round.id, round.round_index]));
  const risks: OverviewRisk[] = [];

  for (const alert of input.alerts) {
    if (alert.acknowledged) continue;
    risks.push({
      id: `alert:${alert.id}`,
      source: 'alert',
      severity: alert.severity,
      count: 1,
      kind: alert.kind,
      round_id: alert.round_id,
      round_label: labelOf.get(alert.round_id) ?? null,
      detail: alert.detail,
    });
  }

  for (const { roundId, board } of input.factBoards) {
    const open = board.issues.filter((issue) => issue.status === 'open');
    for (const kind of FACT_ORDER) {
      const count = open.filter((issue) => issue.kind === kind).length;
      if (count === 0) continue;
      risks.push({
        id: `fact:${roundId}:${kind}`,
        source: 'fact_check',
        severity: FACT_SEVERITY[kind],
        count,
        kind,
        round_id: roundId,
        round_label: labelOf.get(roundId) ?? null,
        detail: null,
      });
    }
  }

  for (const { roundId, insights } of input.reviewQueues) {
    if (insights.length === 0) continue;
    risks.push({
      id: `review:${roundId}`,
      source: 'review',
      // 低置信度不等于「已经说错」，但它是唯一能提前发现说错的入口 ⇒ 警告级。
      severity: 'warning',
      count: insights.length,
      kind: null,
      round_id: roundId,
      round_label: labelOf.get(roundId) ?? null,
      detail: null,
    });
  }

  return risks.sort((left, right) => {
    const bySeverity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
    if (bySeverity !== 0) return bySeverity;
    const bySource = SOURCE_RANK[left.source] - SOURCE_RANK[right.source];
    if (bySource !== 0) return bySource;
    const leftIndex = left.round_id === null ? -1 : indexOf.get(left.round_id) ?? -1;
    const rightIndex = right.round_id === null ? -1 : indexOf.get(right.round_id) ?? -1;
    if (leftIndex !== rightIndex) return rightIndex - leftIndex;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// 行动进度
// ---------------------------------------------------------------------------

export interface ActionProgress {
  total: number;
  done: number;
  in_progress: number;
  todo: number;
  /** 未完成且标记为快赢的条数（产品定义 §3.8 的验收点）。 */
  quick_wins_open: number;
  /** 未完成处方，按后端 `rank` 升序，最多 5 条。 */
  top_open: ActionItem[];
}

/** 只计数与取前 N；**不重排后端的 rank**（名次是种子/后端的产物）。 */
export function buildActionProgress(actions: readonly ActionItem[]): ActionProgress {
  const open = actions
    .filter((item) => item.status !== 'done')
    .slice()
    .sort((left, right) => left.rank - right.rank);

  return {
    total: actions.length,
    done: actions.filter((item) => item.status === 'done').length,
    in_progress: actions.filter((item) => item.status === 'in_progress').length,
    todo: actions.filter((item) => item.status === 'todo').length,
    quick_wins_open: actions.filter((item) => item.quick_win && item.status !== 'done').length,
    top_open: open.slice(0, 5),
  };
}


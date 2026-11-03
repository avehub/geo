/**
 * 站长数据的**前端组装层**（M5.5，spec `2026-10-12-webmaster-data-integration-design.md`
 * DR-95 / DR-97 ④ / DR-101 / DR-109 … DR-116）。
 *
 * # 🔴 为什么这一层在前端（DR-97 ④ / DR-99 放宽）
 * 命令面**刻意不加** `search_aggregate`：映射查表、A 类求和、B 类重算、筛选、交集区间与对账
 * 全是纯函数，demo 与桌面端共用同一份，两端各算一份区间才会出现"同一个项目两个合计数"。
 * 与 `kb-compose.ts` / `site-compose.ts` / `library-compose.ts` 同族，但那一族组装的是**导出文本**，
 * 本文件组装的是**数字**——所以这里 🔴 **一次都不查词典**：语言相关的只有 `*_key`（i18n key）
 * 与 `params` 里的语言中立值（日期、天数、百分比、枚举 id），换语言不改变任何一个数字
 * （判据在 `search-compose.test.ts` 的最后一段）。
 *
 * # 🔴 三条最容易被写错、也最致命的口径（§7 变异 ②③⑤）
 * ① **B 类只能重算**：汇总点击率 = Σclicks ÷ Σimpressions（AI 面 = Σai_clicks ÷ Σcitations）。
 *   三家的分母各不相同（百度 AI 是引用量、搜狗是查询量、GSC 是 impressions），
 *   对比率取算术平均**没有任何解释**（DR-95）；
 * ② **`analytics` 组永不进 A 类合计**：百度统计的量纲是会话、不是曝光，混进去"总曝光"当场变假数
 *   （DR-110 护栏 2）。🔴 分组**只能查目录表**（`catalogEntryOf(kind).group`）：指标行上没有
 *   `group` 字段，按行上的字段判就等于让导入数据自己决定要不要被算进合计；
 * ③ **汇总区间是各源 `data_through` 的交集**，不是用户选的那个区间（DR-109）。
 *   静默按用户区间相加，会因为某个源少三天而莫名掉一截，被追问一次就全线崩塌。
 *
 * # 🔴 A 类能求和的前提是"不相交事件集合"（DR-95）
 * 同一次曝光不会被百度和 Google 同时记 ⇒ 跨平台求和有意义；但**跨面**（传统搜索 / AI 回答）
 * 的计数规则不同（AI 面算的是"用户看到引用链接的次数"）⇒ 默认只看一个面，
 * 显式选"两个面"才跨面合计，且**必须**挂 `crossSurface` 标注。
 *
 * # 🔴 给数字，同时给得出这个数字的账（DR-109 / DR-110 / DR-112）
 * `SearchAggregate` 因此常驻三样东西：`window`（收敛后的区间 + 点名受限源）、
 * `participants`（参与源清单，各自的截至日 / 完整性 / 区间来源）、`flags`（陈旧、采样、
 * 平台自陈不全、跨面、站内分析被排除）。一个能被追问到底的合计，才是有说服力的合计。
 *
 * # 🔴 对账不是主喂料（DR-116）
 * L1 自有抽样（`geo-crawler`）与 L2 官方接口才是主喂料，L3 控制台导出 / 粘贴 / 填报是**校准层**：
 * 差异率超 `RECONCILE_DIVERGENCE` ⇒ 出一条对账差异事件；冲突时**展示以 L3 为准**（第一方数字
 * 对客户最有说服力）但 L1 原值保留可查；L3 缺失**不阻断**任何展示，只标"未经平台对账"。
 *
 * # 合规（规则 6 / 规则 11）
 * 本文件不产出任何自然语言，也不承诺任何排名效果；外部 CTR 曲线在 `api/search-benchmark.ts`
 * 且 `enabled_by_default: false`（DR-115），**默认不参与这里的任何判定**。
 */
import { RECONCILE_DIVERGENCE, STALE_AFTER_DAYS } from './constants';
import { catalogEntryOf } from './search-catalog';
import type {
  SearchCompleteness,
  SearchNativeExtra,
  SearchQueryMetric,
  SearchSourceKind,
  SearchSurface,
  SearchTrafficEngine,
  SearchTrafficShare,
  SelfIndexEngine,
  SelfIndexSnapshot,
  WindowSource,
} from './types-search';
import { SEARCH_SOURCE_VALUES, SEARCH_TRAFFIC_ENGINE_VALUES } from './types-search';

// 🔴 这两个形状**住在契约里**（`api/types-search.ts`），因为它们是 `SearchBoardResult.traffic_split`
// 的行形状；这里只回导出，让既有引用点（种子、页面、测试）不必改 import 路径。
export { SEARCH_TRAFFIC_ENGINE_VALUES };
export type { SearchTrafficEngine, SearchTrafficShare };

// ---------------------------------------------------------------------------
// i18n key（🔴 只出 key，不出文案；键名与 `i18n/locales/*/webmaster-data.ts` 逐字对齐）
// ---------------------------------------------------------------------------

/** 各源截至日一致时的普通区间句（插值 `{{start}}` / `{{end}}`）。 */
export const AGGREGATE_WINDOW_KEY = 'webmasterData.aggregateWindow';
/** 区间被某个源的截至日压窄时的说明句（插值 `{{start}}` / `{{end}}` / `{{source}}`）。 */
export const AGGREGATE_WINDOW_LIMITED_KEY = 'webmasterData.aggregate.windowLimited';
export const EXCLUDED_ANALYTICS_FLAG_KEY = 'webmasterData.aggregate.excludedAnalytics';
export const CROSS_SURFACE_FLAG_KEY = 'webmasterData.aggregate.crossSurface';
/** 陈旧旗标（插值 `{{through}}` / `{{days}}`，DR-105）。 */
export const STALE_FLAG_KEY = 'webmasterData.staleWarning';
/** 采样旗标（插值 `{{source}}`，DR-110）。 */
export const SAMPLED_FLAG_KEY = 'webmasterData.sampledWarning';
/**
 * "平台自陈不全"旗标。⚠ 词典里**没有** `partialWarning` 这一条（`sampled` 有专门一句，
 * 因为它点名了 GSC 的 5 万行上限），所以这里复用枚举说明键 `completenessNotes.partial`
 * ——它给的正是 DR-110 要求的"为什么"。补一条专门的旗标句属于词典侧的活，不在本文件写范围内。
 */
export const PARTIAL_FLAG_KEY = 'webmasterData.completenessNotes.partial';
/** 对账差异事件（插值 `{{metric}}` / `{{source}}` / `{{rate}}`，DR-116 ①）。 */
export const RECONCILE_DIVERGENCE_EVENT_KEY = 'webmasterData.reconcile.divergenceEvent';
/** "未经平台对账"徽标（DR-116 ③）。 */
export const RECONCILE_UNRECONCILED_KEY = 'webmasterData.reconcile.notReconciled';
/** 关键词行上那条汇总标注（插值 `{{total}}` / `{{start}}` / `{{end}}` / `{{completeness}}`，DR-101）。 */
export const KEYWORD_OVERLAY_LABEL_KEY = 'webmasterData.keywordOverlay.withCompleteness';
export const SUGGEST_NOW_KEY = 'webmasterData.onboarding.suggestion';
export const SUGGEST_LATER_KEY = 'webmasterData.onboarding.later';

// ---------------------------------------------------------------------------
// 1. 词面规范化（DR-101）
// ---------------------------------------------------------------------------

/**
 * 词面的**展示形**：NFKC 把全角折成半角（顺带把 U+3000 全角空格变成普通空格）、
 * 转小写、内部空白折叠成一个空格、去首尾空白。中文原样保留。🔴 幂等（拼行时两边都过一遍）。
 */
export function normalizeQuery(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 词面的**同一性键**：在 `normalizeQuery` 之上去掉所有空白。
 *
 * 🔴 为什么还要再走一步：中文词面里的空格没有语义——平台导出的「GEO 优化」与关键词库里的
 * 「geo优化」是同一个词，而 DR-101 要求把汇总指标**拼到关键词行上**，差一个空格就拼不上，
 * 界面上就成了"这个词没有站长数据"（一个静默的假阴性）。
 * 🔴 代价：英文词面也会失去空格 ⇒ **匹配用 `key`、上屏用展示形**（见 `SearchPivotRow.display`）。
 */
export function queryKeyOf(text: string): string {
  return normalizeQuery(text).replace(/\s+/g, '');
}

// ---------------------------------------------------------------------------
// 2. 筛选（DR-112：四个维度全在前端做）
// ---------------------------------------------------------------------------

/** 面筛选比 `SearchSurface` 多一档"两个面"（跨面合计要显式选，DR-95）。 */
export type SearchSurfaceFilter = SearchSurface | 'both';

export const SEARCH_SURFACE_FILTER_VALUES = [
  'web_search',
  'ai_answer',
  'both',
] as const satisfies readonly SearchSurfaceFilter[];

/** 维度透视三选一（DR-112 ④）。 */
export type SearchPivotDimension = 'query' | 'page' | 'engine';

export const SEARCH_PIVOT_DIMENSION_VALUES = [
  'query',
  'page',
  'engine',
] as const satisfies readonly SearchPivotDimension[];

/** 时间区间（`YYYY-MM-DD`，`null` = 不设界）。单独成类型：算区间只需要这两个字段。 */
export interface SearchWindowRange {
  from: string | null;
  to: string | null;
}

/**
 * 汇总视图的筛选态。🔴 只存 `useState`、**不落 localStorage**（DR-112，与 DR-76 的视图切换同口径）：
 * 筛选态刷新即重置，免得用户第二天打开看到一份"不知道谁筛过的"合计。
 */
export interface SearchFilter extends SearchWindowRange {
  /** 空数组 = 全部源（默认全选已 `ready` 的源由页面决定，compose 不猜）。 */
  source_kinds: readonly SearchSourceKind[];
  surface: SearchSurfaceFilter;
  pivot: SearchPivotDimension;
}

/** 默认：只看传统搜索面、按关键词透视、不限时间、不限源。 */
export function defaultSearchFilter(): SearchFilter {
  return { from: null, to: null, source_kinds: [], surface: 'web_search', pivot: 'query' };
}

/**
 * 按时间 / 源 / 面筛行。
 *
 * 🔴 时间是**相交即计入**：行是按区间导入的（一行 = 一个周期的一个 query），不按天拆，
 * 所以判的是 `[period_start, period_end]` 与 `[from, to]` 有没有交集，而不是"落在区间内"。
 * 🔴 这里**不**剔除 `analytics` 组：本函数只回答"哪些行在筛选范围内"（明细表要照实列出），
 * "哪些行能进 A 类合计"是另一件事（`summarizeMetrics` / `pivotMetrics` 里剔）。
 */
export function filterMetrics(
  rows: readonly SearchQueryMetric[],
  filter: SearchFilter,
): SearchQueryMetric[] {
  return rows.filter((row) => {
    if (filter.surface !== 'both' && row.surface !== filter.surface) return false;
    if (filter.source_kinds.length > 0 && !filter.source_kinds.includes(row.source_kind)) return false;
    if (filter.from !== null && row.period_end < filter.from) return false;
    if (filter.to !== null && row.period_start > filter.to) return false;
    return true;
  });
}

/**
 * 这个源是不是**站内分析**组（DR-110 护栏 2）。
 * 🔴 只查目录表：分组是产品的建模决定，不是导入数据自带的属性。
 */
export function isAnalyticsSource(kind: SearchSourceKind): boolean {
  return catalogEntryOf(kind).group === 'analytics';
}

/** 能进 A 类合计的行（筛选范围内 - 站内分析组）。 */
function participatingRows(
  rows: readonly SearchQueryMetric[],
  filter: SearchFilter,
): { included: SearchQueryMetric[]; excluded: SearchQueryMetric[] } {
  const inScope = filterMetrics(rows, filter);
  return {
    included: inScope.filter((row) => !isAnalyticsSource(row.source_kind)),
    excluded: inScope.filter((row) => isAnalyticsSource(row.source_kind)),
  };
}

// ---------------------------------------------------------------------------
// 3. 陈旧与完整性（DR-105 / DR-110）
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** 两个 `YYYY-MM-DD` 之间差几天（按 UTC 日历，不碰时区）。 */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * 数据是不是已经陈旧（DR-105）。🔴 边界是"**超过** `STALE_AFTER_DAYS` 才算"：
 * 正好 35 天不算陈旧、第 36 天算（判据钉在 `search-compose.test.ts`）。
 */
export function isStaleData(dataThrough: string, asOf: string): boolean {
  return daysBetween(dataThrough, asOf) > STALE_AFTER_DAYS;
}

/**
 * 完整性的"更坏"排序：`sampled` 比 `partial` 更坏。
 * 采样是**静默**少给行（平台不报错，合计偏低却看不出来），自陈不全至少说了自己不全。
 */
const COMPLETENESS_RANK: Readonly<Record<SearchCompleteness, number>> = {
  full: 0,
  partial: 1,
  sampled: 2,
};

function worstCompleteness(rows: readonly SearchQueryMetric[]): SearchCompleteness {
  let worst: SearchCompleteness = 'full';
  for (const row of rows) {
    if (COMPLETENESS_RANK[row.completeness] > COMPLETENESS_RANK[worst]) worst = row.completeness;
  }
  return worst;
}

/** 区间来源取"更保守"的那一个：只要有一行是导入时确认的，就不能声称"平台声明"。 */
function cautiousWindowSource(rows: readonly SearchQueryMetric[]): WindowSource {
  return rows.some((row) => row.window_source === 'user_stated') ? 'user_stated' : 'platform';
}

function earliestThrough(rows: readonly SearchQueryMetric[]): string | null {
  let earliest: string | null = null;
  for (const row of rows) {
    if (earliest === null || row.data_through < earliest) earliest = row.data_through;
  }
  return earliest;
}

/** 去重后的源清单（保持首次出现顺序，语言无关也稳定）。 */
function distinctKinds(rows: readonly SearchQueryMetric[]): SearchSourceKind[] {
  const seen: SearchSourceKind[] = [];
  for (const row of rows) {
    if (!seen.includes(row.source_kind)) seen.push(row.source_kind);
  }
  return seen;
}

// ---------------------------------------------------------------------------
// 4. 汇总区间：收敛到各源交集（DR-109）
// ---------------------------------------------------------------------------

/** 收敛后的汇总区间（`null` = 没有参与源 ⇒ 界面显示空态，不显示 1970）。 */
export interface SearchAggregateWindow {
  start: string | null;
  end: string | null;
  /** 把区间末日压窄的那些源（各源截至日一致时为空）。 */
  limited_by: SearchSourceKind[];
  note_key: string;
}

/**
 * 算汇总区间（DR-109）。
 *
 * 起点 = 参与行里**最晚**的 `period_start`，终点 = 参与行里**最早**的 `data_through`
 * （各源交集；一个源只要有一行数据旧，合计就不能声称更新到那天）。
 * 两者不相交时返回空区间——不能把不同月份的数据标成一个错位区间。最后再被用户选的区间夹一次。
 *
 * 🔴 **不是**"用户选的区间"（§7 变异 ⑤）：用户选到 9/30 而 GSC 只到 9/27，合计区间就只到 9/27，
 * 并且 `limited_by` 点名 GSC。用户显式选的区间比交集还窄时（`to` 先生效），
 * 受限方是用户自己而不是某个源 ⇒ `limited_by` 为空、文案换成普通的区间句。
 * 🔴 用户选的区间与各源可用区间**根本不相交**时返回空区间（`start` / `end` 都是 `null`）：
 * 界面显示空态，而不是显示一个起点晚于终点的倒挂区间。
 */
export function resolveAggregateWindow(
  rows: readonly SearchQueryMetric[],
  range: SearchWindowRange | SearchFilter,
): SearchAggregateWindow {
  const empty = (): SearchAggregateWindow => ({
    start: null,
    end: null,
    limited_by: [],
    note_key: AGGREGATE_WINDOW_KEY,
  });
  if (rows.length === 0) return empty();

  // 每个源"数据到哪天为止"= 它那些行里最早的 `data_through`。
  const throughBySource = new Map<SearchSourceKind, string>();
  let start: string | null = null;
  let end: string | null = null;
  for (const row of rows) {
    if (start === null || row.period_start > start) start = row.period_start;
    if (end === null || row.data_through < end) end = row.data_through;
    const current = throughBySource.get(row.source_kind);
    if (current === undefined || row.data_through < current) {
      throughBySource.set(row.source_kind, row.data_through);
    }
  }
  if (start === null || end === null) return empty();

  const sourceBoundEnd = end;
  if (range.from !== null && range.from > start) start = range.from;
  if (range.to !== null && range.to < end) end = range.to;
  if (start > end) return empty();

  // 只有"某个源的截至日把区间压窄了"才点名它：各源截至日一致（没什么可收敛的）
  // 或用户自己选的区间更窄（受限方是用户）时，都换成普通的区间句。
  const userRangeBinds = range.to !== null && range.to <= sourceBoundEnd;
  const limited_by =
    userRangeBinds || new Set(throughBySource.values()).size <= 1
      ? []
      : [...throughBySource.entries()]
          .filter(([, through]) => through === sourceBoundEnd)
          .map(([kind]) => kind);

  return {
    start,
    end,
    limited_by,
    note_key: limited_by.length > 0 ? AGGREGATE_WINDOW_LIMITED_KEY : AGGREGATE_WINDOW_KEY,
  };
}

/**
 * C 类平台独有维度与汇总条共用同一套平台 / 时间筛选。
 *
 * 有 `metric_id` 的留档回查那行指标的区间（它与明细行同周期）；表级留档没有指标行，
 * 退回 `observed_at` 的日期。这样「8 月区间」不会继续显示 9 月的会话数 / 平均排名。
 */
export function filterNativeExtras(
  extras: readonly SearchNativeExtra[],
  metrics: readonly SearchQueryMetric[],
  filter: SearchFilter,
): SearchNativeExtra[] {
  const metricsById = new Map(metrics.map((row) => [row.id, row]));
  return extras.filter((row) => {
    if (filter.source_kinds.length > 0 && !filter.source_kinds.includes(row.source_kind)) {
      return false;
    }
    const metric = row.metric_id === null ? undefined : metricsById.get(row.metric_id);
    const start = metric?.period_start ?? row.observed_at.slice(0, 10);
    const end = metric?.period_end ?? row.observed_at.slice(0, 10);
    if (filter.from !== null && end < filter.from) return false;
    if (filter.to !== null && start > filter.to) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// 5. A 类求和 + B 类重算（DR-95 / DR-110）
// ---------------------------------------------------------------------------

/** A 类四项的合计（`null` 当"没有这一列"跳过，🔴 不当 0）。 */
interface MetricTotals {
  impressions: number;
  clicks: number;
  citations: number;
  ai_clicks: number;
}

function totalsOf(rows: readonly SearchQueryMetric[]): MetricTotals {
  const totals: MetricTotals = { impressions: 0, clicks: 0, citations: 0, ai_clicks: 0 };
  for (const row of rows) {
    if (row.impressions !== null) totals.impressions += row.impressions;
    if (row.clicks !== null) totals.clicks += row.clicks;
    if (row.citations !== null) totals.citations += row.citations;
    if (row.ai_clicks !== null) totals.ai_clicks += row.ai_clicks;
  }
  return totals;
}

/**
 * 只在**至少一行真的给了这一列**时求和；一行都没有就给 `null`。
 * 用于关键词行区分「这个词在 web 面零曝光」与「这个词根本没有 web 面数据」。
 */
function sumOrNull(
  rows: readonly SearchQueryMetric[],
  key: 'impressions' | 'clicks',
): number | null {
  let sum = 0;
  let seen = false;
  for (const row of rows) {
    const value = row[key];
    if (value === null) continue;
    sum += value;
    seen = true;
  }
  return seen ? sum : null;
}

/**
 * B 类重算。🔴 分母为 0 时回 `null` 而**不是** 0：
 * "点击率 0"与"这一列算不出来"是两个结论（同 DR-94 对指标可空的那条裁定）。
 */
function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** 合计行上的一个旗标（DR-110）。 */
export type SearchAggregateFlagKind =
  | 'excluded_analytics'
  | 'cross_surface'
  | 'stale'
  | 'sampled'
  | 'partial';

export interface SearchAggregateFlag {
  flag: SearchAggregateFlagKind;
  /** 文案的 i18n key；🔴 `params` 只放语言中立值，需要译名的插值由页面补（见下）。 */
  flag_key: string;
  source_kinds: SearchSourceKind[];
  /**
   * 直接喂给 `t(flag_key, params)` 的插值。
   * ⚠ `sampled` 那条词典写的是 `{{source}}`（要平台名），这里只给得出枚举 id ⇒
   * 页面应当用 `enumLabel` 把 `source` 覆盖成 `webmasterData.sources.<kind>` 的译名
   * （⚠ 别在这里写成调用式：`i18n/enum-label-prefixes.test.ts` 按原文正则捞**调用点**，
   * 注释里的调用式会被当成一个新命名空间，把那份逐字钉死的清单顶红）；
   * 给一个 id 兜底是为了"页面忘了覆盖"时不至于把 `{{source}}` 原样喷到界面上。
   */
  params: Record<string, string>;
}

/** 参与合计的一个源（DR-112：合计行**永远**显示参与源清单）。 */
export interface SearchAggregateParticipant {
  source_kind: SearchSourceKind;
  /** `webmasterData.sources.<kind>`（页面用 `enumLabel` 取译名）。 */
  label_key: string;
  data_through: string;
  completeness: SearchCompleteness;
  window_source: WindowSource;
  row_count: number;
}

/** 跨平台汇总的结果：数字 + 区间 + 参与源 + 旗标（四样一起给，缺一样都不算"给得出账"）。 */
export interface SearchAggregate {
  surface: SearchSurfaceFilter;
  impressions: number;
  clicks: number;
  citations: number;
  ai_clicks: number;
  /** Σclicks ÷ Σimpressions（🔴 重算，绝不取各源平均）。 */
  ctr: number | null;
  /** Σai_clicks ÷ Σcitations（🔴 分母是**引用量**，不是曝光量）。 */
  ai_ctr: number | null;
  row_count: number;
  window: SearchAggregateWindow;
  participants: SearchAggregateParticipant[];
  flags: SearchAggregateFlag[];
}

/**
 * 跨平台汇总（DR-95 的 A 类求和 + B 类重算，DR-109 的交集区间，DR-110 的旗标）。
 *
 * @param asOf "今天"（`YYYY-MM-DD`）：判陈旧要用。由调用方传入而不在这里取系统时间，
 *   是为了让判据可复算、也让 demo 能把演示日期钉死在 2026-09/10（规则 2 的同族纪律）。
 */
export function summarizeMetrics(
  rows: readonly SearchQueryMetric[],
  filter: SearchFilter,
  asOf: string,
): SearchAggregate {
  const { included, excluded } = participatingRows(rows, filter);
  const totals = totalsOf(included);
  const window = resolveAggregateWindow(included, filter);

  const participants: SearchAggregateParticipant[] = distinctKinds(included).map((kind) => {
    const own = included.filter((row) => row.source_kind === kind);
    return {
      source_kind: kind,
      label_key: catalogEntryOf(kind).label_key,
      data_through: earliestThrough(own) ?? '',
      completeness: worstCompleteness(own),
      window_source: cautiousWindowSource(own),
      row_count: own.length,
    };
  });

  const flags: SearchAggregateFlag[] = [];

  // 护栏 2：站内分析组被剔掉了就要说出来（否则用户会以为百度统计的数字丢了）。
  if (excluded.length > 0) {
    flags.push({
      flag: 'excluded_analytics',
      flag_key: EXCLUDED_ANALYTICS_FLAG_KEY,
      source_kinds: distinctKinds(excluded),
      params: {},
    });
  }

  // 跨面合计要显式选**且真的混到了两个面**才标注（只选了一个面的数据时不无谓地挂旗）。
  const surfaces = new Set(included.map((row) => row.surface));
  if (surfaces.size > 1) {
    flags.push({
      flag: 'cross_surface',
      flag_key: CROSS_SURFACE_FLAG_KEY,
      source_kinds: distinctKinds(included),
      params: {},
    });
  }

  // 陈旧（DR-105）：一条旗标收全部陈旧源，`params` 报最旧的那一个（影响最大的那个）。
  const stale = participants.filter((row) => isStaleData(row.data_through, asOf));
  if (stale.length > 0) {
    const oldest = stale.reduce((worst, row) => (row.data_through < worst.data_through ? row : worst));
    flags.push({
      flag: 'stale',
      flag_key: STALE_FLAG_KEY,
      source_kinds: stale.map((row) => row.source_kind),
      params: {
        through: oldest.data_through,
        days: `${daysBetween(oldest.data_through, asOf)}`,
      },
    });
  }

  // 完整性（DR-110）：非 `full` 的源**照样参与合计**，但必须挂旗标说明为什么、影响哪个方向。
  for (const completeness of ['sampled', 'partial'] as const) {
    const flagged = participants.filter((row) => row.completeness === completeness);
    if (flagged.length === 0) continue;
    const kinds = flagged.map((row) => row.source_kind);
    flags.push({
      flag: completeness,
      flag_key: completeness === 'sampled' ? SAMPLED_FLAG_KEY : PARTIAL_FLAG_KEY,
      source_kinds: kinds,
      params: completeness === 'sampled' ? { source: kinds.join(' / ') } : {},
    });
  }

  return {
    surface: filter.surface,
    impressions: totals.impressions,
    clicks: totals.clicks,
    citations: totals.citations,
    ai_clicks: totals.ai_clicks,
    ctr: ratio(totals.clicks, totals.impressions),
    ai_ctr: ratio(totals.ai_clicks, totals.citations),
    row_count: included.length,
    window,
    participants,
    flags,
  };
}

// ---------------------------------------------------------------------------
// 6. 维度透视（DR-112 ④）
// ---------------------------------------------------------------------------

/** 透视表的一行（三种维度共用一个形状，页面据此渲染同一张密集表）。 */
export interface SearchPivotRow {
  /**
   * 同一性键：按关键词是 `queryKeyOf`（无空白）、按页面是 `page_url`、按平台是 `source_kind`。
   * 🔴 用它做 React key 与回查（例如点了某行去关键词库定位），**不要**用它上屏。
   */
  key: string;
  /**
   * 上屏用的展示形：关键词维度是首个命中的 `normalizeQuery`（保留英文词面的空格），
   * 另两个维度与 `key` 相同（平台的译名由页面用 `enumLabel` 取，compose 不查词典）。
   */
  display: string;
  dimension: SearchPivotDimension;
  source_kinds: SearchSourceKind[];
  impressions: number;
  clicks: number;
  ctr: number | null;
  citations: number;
  ai_clicks: number;
  ai_ctr: number | null;
  row_count: number;
  completeness: SearchCompleteness;
  data_through: string;
  window_source: WindowSource;
}

/** 一行的透视键；`null` = 这一行没有该维度（按关键词时的页面级行、按页面时的关键词级行）。 */
function pivotKeyOf(
  row: SearchQueryMetric,
  dimension: SearchPivotDimension,
): { key: string; display: string } | null {
  if (dimension === 'query') {
    const key = queryKeyOf(row.query);
    return key === '' ? null : { key, display: normalizeQuery(row.query) };
  }
  if (dimension === 'page') {
    const url = row.page_url ?? '';
    return url === '' ? null : { key: url, display: url };
  }
  return { key: row.source_kind, display: row.source_kind };
}

/**
 * 按维度透视（DR-112 ④）。
 *
 * 🔴 同样剔除 `analytics` 组：透视的曝光 / 点击列是**跨源相加**的 A 类合计
 * （按关键词透视时百度统计的行会和百度站长平台的行并到同一个词上），量纲不同不能加。
 * 站内分析在页面上是独立的一段次级分组，不进这张表。
 * 🔴 每行的 `ctr` 一律**重算**（Σclicks ÷ Σimpressions），不是把各行的 `ctr` 平均。
 */
export function pivotMetrics(
  rows: readonly SearchQueryMetric[],
  filter: SearchFilter,
): SearchPivotRow[] {
  const included = filterMetrics(rows, filter).filter((row) => !isAnalyticsSource(row.source_kind));
  const buckets = new Map<string, { display: string; rows: SearchQueryMetric[] }>();
  for (const row of included) {
    const identity = pivotKeyOf(row, filter.pivot);
    if (identity === null) continue;
    const bucket = buckets.get(identity.key);
    if (bucket === undefined) {
      buckets.set(identity.key, { display: identity.display, rows: [row] });
    } else {
      bucket.rows.push(row);
    }
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const totals = totalsOf(bucket.rows);
      return {
        key,
        display: bucket.display,
        dimension: filter.pivot,
        source_kinds: distinctKinds(bucket.rows),
        impressions: totals.impressions,
        clicks: totals.clicks,
        ctr: ratio(totals.clicks, totals.impressions),
        citations: totals.citations,
        ai_clicks: totals.ai_clicks,
        ai_ctr: ratio(totals.ai_clicks, totals.citations),
        row_count: bucket.rows.length,
        completeness: worstCompleteness(bucket.rows),
        data_through: earliestThrough(bucket.rows) ?? '',
        window_source: cautiousWindowSource(bucket.rows),
      } satisfies SearchPivotRow;
    })
    // 曝光降序（这张表就是拿来找"曝光大但点击差"的词），同数按 key 升序保证确定性。
    .sort((left, right) => right.impressions - left.impressions || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

// ---------------------------------------------------------------------------
// 7. 对账（DR-116 三条）
// ---------------------------------------------------------------------------

/**
 * L1 的引擎（M3 `EngineId`）→ L3 的数据源。
 *
 * 🔴 今天只有一条：只有百度《AI 流量分析》给出了"AI 引用量 / AI 曝光量"这种能与我们的抽样
 * 对照的官方口径；豆包 / Kimi / 元宝 / 秘塔都没有站长后台可读（DR-117 的观察清单里也没有）。
 * 没有对照源的引擎 ⇒ 那一行标"未经平台对账"，**不**编一个对照值出来（DR-116 ③）。
 * 键是 `EngineId` 的成员，值必须是 `SearchSourceKind`；两侧枚举都由完整性网守着。
 */
export const L1_ENGINE_TO_SOURCE: Readonly<Partial<Record<SelfIndexEngine, SearchSourceKind>>> = {
  baidu_ai: 'baidu_ziyuan_ai',
};

/** 快照的 `engine` 也可能直接就是一个源（传统 SERP 面的位次带快照用 `SearchSourceKind`）。 */
function sourceKindOfEngine(engine: SelfIndexEngine): SearchSourceKind | null {
  const mapped = L1_ENGINE_TO_SOURCE[engine];
  if (mapped !== undefined) return mapped;
  return (SEARCH_SOURCE_VALUES as readonly string[]).includes(engine)
    ? (engine as SearchSourceKind)
    : null;
}

/** 展示取哪一侧（DR-116 ②：冲突以 L3 为准，L1 原值保留可查）。 */
export type ReconcileSide = 'l1' | 'l3';

export interface SearchReconcileRow {
  /** 规范化后的词面（`queryKeyOf`），只用作同一性键。 */
  query: string;
  /** 上屏用的原始词面（保留标点与大小写；报告/对账表不能用规范化键当标题）。 */
  display: string;
  engine: SelfIndexEngine;
  /** 对照的 L3 源；`null` = 这个引擎没有可读的站长后台。 */
  source_kind: SearchSourceKind | null;
  l1_cited: number;
  l1_samples: number;
  /** 自有抽样的被引率 = 被引轮次 ÷ 观测轮次。 */
  l1_rate: number;
  l3_citations: number | null;
  l3_impressions: number | null;
  /** 平台口径的引用率 = AI 引用量 ÷ AI 曝光量。 */
  l3_rate: number | null;
  /** `|l1 - l3| ÷ max(l1, l3)`；没有对照侧时为 `null`。 */
  divergence: number | null;
  reconciled: boolean;
  /** 界面上展示的那个数（冲突时取 L3）。 */
  displayed_rate: number;
  displayed_from: ReconcileSide;
}

/** 一条对账差异事件（进机会清单那一侧的容器，🔴 不新增命令，DR-116）。 */
export interface SearchReconcileDivergence {
  query: string;
  source_kind: SearchSourceKind;
  l1_rate: number;
  l3_rate: number;
  divergence: number;
  /** 触发这条事件的阈值（`RECONCILE_DIVERGENCE`，先拍后调 ⇒ 把它一起给出去才可复核）。 */
  threshold: number;
  event_key: string;
  /**
   * `{{rate}}` 由这里给（百分比串，语言中立）；`{{metric}}` 与 `{{source}}` 要译名，
   * 由页面用 `enumLabel` 补进 `t()` 的插值。
   */
  params: Record<string, string>;
}

export interface SearchReconcileResult {
  rows: SearchReconcileRow[];
  divergences: SearchReconcileDivergence[];
  /** "未经平台对账"那句的 key（`reconciled === false` 的行挂它，DR-116 ③）。 */
  unreconciled_key: string;
}

/**
 * 把 L1 自有抽样与 L3 平台口径对账（DR-116）。
 *
 * 🔴 只有 `ai_citation` 快照参与：`page_indexability` 与 `serp_rank_band` 在平台侧没有
 * 同口径的对照物（robots 放行与否、位次带都不是"引用率"），拿它们对账就是造一个假对照。
 * 🔴 两侧的率**分母不同**（L1 是观测轮次、L3 是 AI 曝光量），所以这是一个"量级对不对得上"
 * 的启发式，不是统计检验——这正是 `RECONCILE_DIVERGENCE` 被标为"先拍后调"的原因。
 * 🔴 L3 缺失**不阻断**：没有对照就照实展示 L1 并标"未经平台对账"，绝不拿 L1 冒充对账后的值。
 *
 * @returns `rows` 只按 **L1 的 (词面 × 引擎)** 出行：这一张表的语义是"我们问出来的 vs 平台记的"，
 *   平台独有的词（我们没抽样过）不在对账范围内，它们出现在关键词明细表里。
 */
export function reconcile(
  selfSnapshots: readonly SelfIndexSnapshot[],
  consoleMetrics: readonly SearchQueryMetric[],
): SearchReconcileResult {
  interface L1Group {
    query: string;
    display: string;
    engine: SelfIndexEngine;
    source_kind: SearchSourceKind | null;
    cited: number;
    samples: number;
  }
  const l1Groups = new Map<string, L1Group>();
  for (const snapshot of selfSnapshots) {
    if (snapshot.kind !== 'ai_citation' || snapshot.cited === null) continue;
    const query = queryKeyOf(snapshot.key);
    const groupKey = `${snapshot.engine}\u0000${query}`;
    const group = l1Groups.get(groupKey);
    if (group === undefined) {
      l1Groups.set(groupKey, {
        query,
        display: snapshot.key,
        engine: snapshot.engine,
        source_kind: sourceKindOfEngine(snapshot.engine),
        cited: snapshot.cited ? 1 : 0,
        samples: 1,
      });
    } else {
      group.cited += snapshot.cited ? 1 : 0;
      group.samples += 1;
    }
  }

  interface L3Group {
    citations: number;
    impressions: number;
  }
  const l3Groups = new Map<string, L3Group>();
  for (const metric of consoleMetrics) {
    if (metric.surface !== 'ai_answer' || isAnalyticsSource(metric.source_kind)) continue;
    const groupKey = `${metric.source_kind}\u0000${queryKeyOf(metric.query)}`;
    const group = l3Groups.get(groupKey);
    if (group === undefined) {
      l3Groups.set(groupKey, {
        citations: metric.citations ?? 0,
        impressions: metric.impressions ?? 0,
      });
    } else {
      group.citations += metric.citations ?? 0;
      group.impressions += metric.impressions ?? 0;
    }
  }

  const rows: SearchReconcileRow[] = [];
  const divergences: SearchReconcileDivergence[] = [];
  for (const group of [...l1Groups.values()].sort((left, right) =>
    left.query < right.query ? -1 : left.query > right.query ? 1 : 0,
  )) {
    const l1Rate = ratio(group.cited, group.samples) ?? 0;
    const l3 = group.source_kind === null ? undefined : l3Groups.get(`${group.source_kind}\u0000${group.query}`);
    const l3Rate = l3 === undefined ? null : ratio(l3.citations, l3.impressions);

    if (l3 === undefined || l3Rate === null) {
      // ③ L3 缺失：不阻断，标"未经平台对账"，展示 L1 原值。
      rows.push({
        query: group.query,
        display: group.display,
        engine: group.engine,
        source_kind: group.source_kind,
        l1_cited: group.cited,
        l1_samples: group.samples,
        l1_rate: l1Rate,
        l3_citations: null,
        l3_impressions: null,
        l3_rate: null,
        divergence: null,
        reconciled: false,
        displayed_rate: l1Rate,
        displayed_from: 'l1',
      });
      continue;
    }

    const peak = Math.max(l1Rate, l3Rate);
    const divergence = peak > 0 ? Math.abs(l1Rate - l3Rate) / peak : 0;
    rows.push({
      query: group.query,
      display: group.display,
      engine: group.engine,
      source_kind: group.source_kind,
      l1_cited: group.cited,
      l1_samples: group.samples,
      l1_rate: l1Rate,
      l3_citations: l3.citations,
      l3_impressions: l3.impressions,
      l3_rate: l3Rate,
      divergence,
      reconciled: true,
      // ② 冲突时展示以 L3 为准（第一方数字对客户最有说服力），L1 原值留在 `l1_rate` 里可查。
      displayed_rate: l3Rate,
      displayed_from: 'l3',
    });

    // ① 差异率超阈值 ⇒ 出一条对账差异事件（阈值内的不报，免得"先拍后调"的阈值天天报警）。
    if (divergence > RECONCILE_DIVERGENCE && group.source_kind !== null) {
      divergences.push({
        query: group.query,
        source_kind: group.source_kind,
        l1_rate: l1Rate,
        l3_rate: l3Rate,
        divergence,
        threshold: RECONCILE_DIVERGENCE,
        event_key: RECONCILE_DIVERGENCE_EVENT_KEY,
        params: { rate: `${Math.round(divergence * 100)}%` },
      });
    }
  }

  return { rows, divergences, unreconciled_key: RECONCILE_UNRECONCILED_KEY };
}

// ---------------------------------------------------------------------------
// 8. 拼到关键词行上（DR-101）
// ---------------------------------------------------------------------------

/** 关键词行上那个区间（🔴 形状就是这两项：`toEqual` 判据钉死，不许多字段）。 */
export interface KeywordWindow {
  start: string;
  end: string;
}

/** 一个关键词行能拼上的站长数据汇总。 */
export interface KeywordSearchAggregate {
  /**
   * 传统搜索面的曝光 / 点击（🔴 不把 AI 面的曝光混进来，两个面计数规则不同）。
   * `null` = 这个词没有任何 web 面数据；与真的 0 曝光是两件事（DR-94）。
   */
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  /** AI 面的引用 / 点击。 */
  citations: number;
  ai_clicks: number;
  ai_ctr: number | null;
  /** 这组数字来自几个平台（词典插值 `{{total}}`）。 */
  source_count: number;
  source_kinds: SearchSourceKind[];
  window: KeywordWindow;
  completeness: SearchCompleteness;
  /** 参与拼接的行里最早的数据截至日（界面用它判"这组数字新鲜吗"）。 */
  data_through: string;
  /** 数据是不是已陈旧（`STALE_AFTER_DAYS`，DR-105）。 */
  stale: boolean;
  /**
   * 标注句的 key。🔴 `{{completeness}}` 要译名，由页面用
   * `enumLabel` 查 `webmasterData.completeness.<值>` 补进来；compose 不查词典。
   */
  label_key: string;
}

/**
 * 按**规范化词面**把站长数据拼到一个关键词行上（DR-101 / 走查清单第 16 条）。
 *
 * 🔴 拼不上返回 `null`：界面据此**不显示空占位**——没有数据就是没有数据，
 * 用 0 冒充会让"这个词零曝光"和"我们没接这个词的数据"变成同一句话，而这在 GEO 语境里
 * 是两个完全相反的结论（同 DR-94 对指标可空的那条裁定）。
 */
export function aggregateForKeywordRow(
  text: string,
  rows: readonly SearchQueryMetric[],
  asOf: string,
): KeywordSearchAggregate | null {
  const key = queryKeyOf(text);
  if (key === '') return null;
  const matched = rows.filter(
    (row) => !isAnalyticsSource(row.source_kind) && queryKeyOf(row.query) === key,
  );
  if (matched.length === 0) return null;

  const webRows = matched.filter((row) => row.surface === 'web_search');
  const ai = totalsOf(matched.filter((row) => row.surface === 'ai_answer'));
  const impressions = sumOrNull(webRows, 'impressions');
  const clicks = sumOrNull(webRows, 'clicks');
  const dataThrough = earliestThrough(matched) ?? '';
  // 关键词行是**多周期累计**：区间取覆盖范围（最早 period_start ~ 最晚 data_through），
  // 不能套用汇总行的“各源交集”，否则两个不重叠月份会得到起点晚于终点。
  let start = '';
  let windowEnd = '';
  for (const row of matched) {
    if (start === '' || row.period_start < start) start = row.period_start;
    if (windowEnd === '' || row.data_through > windowEnd) windowEnd = row.data_through;
  }

  return {
    impressions,
    clicks,
    ctr: impressions === null || clicks === null ? null : ratio(clicks, impressions),
    citations: ai.citations,
    ai_clicks: ai.ai_clicks,
    ai_ctr: ratio(ai.ai_clicks, ai.citations),
    source_count: distinctKinds(matched).length,
    source_kinds: distinctKinds(matched),
    window: { start, end: windowEnd },
    completeness: worstCompleteness(matched),
    data_through: dataThrough,
    stale: dataThrough !== '' && isStaleData(dataThrough, asOf),
    label_key: KEYWORD_OVERLAY_LABEL_KEY,
  };
}

// ---------------------------------------------------------------------------
// 9. 接入建议（DR-111）
// ---------------------------------------------------------------------------

/** 占比低于这个值就归到"可以等"（DR-111 那个例子里搜狗 + 360 合计 <3% 的口径）。 */
export const SUGGEST_DEFER_SHARE = 0.03;

/** 流量来源 → 该接哪个站长平台（`null` = 不对应任何源）。 */
export const SOURCE_BY_TRAFFIC_ENGINE: Readonly<Record<SearchTrafficEngine, SearchSourceKind | null>> =
  {
    baidu: 'baidu_ziyuan',
    google: 'gsc',
    bing: 'bing_wmt',
    toutiao: 'toutiao',
    sogou: 'sogou',
    so_360: 'so_360',
    other: null,
  };

export interface SearchSourceSuggestion {
  engine: SearchTrafficEngine;
  source_kind: SearchSourceKind;
  share: number;
  /** `webmasterData.onboarding.suggestion`（现在就接）/ `.later`（可以等）。 */
  reason_key: string;
}

/**
 * 按**客户自己的**流量分布给接入建议（DR-111）。
 *
 * 🔴 **不含任何内置默认推荐**：市场份额数据各来源差异极大（同一时期百度份额有 38.1% 与 53.32%
 * 两种口径），任何写死的假设都会在某个客户身上错得离谱。所以这里**只**依据传入的分布，
 * 分布为空或全是 0 时返回**空数组**——界面显示 `webmasterData.onboarding.empty`，
 * 而不是一份通用推荐。
 * 🔴 二期源（目录表 `phase: 2`）一律归到"可以等"，与占比无关：现在给它一个接入入口，
 * 用户点进去只会发现点不动（DR-92 / DR-108）。
 * 🔴 这不是 DR-100 的第 7 条规则：它不产出优化机会、不进 `SearchOpportunity`
 * （避免把产品引导混进客户的优化清单）。
 */
export function suggestSources(
  trafficSplit: readonly SearchTrafficShare[],
): SearchSourceSuggestion[] {
  const suggestions: SearchSourceSuggestion[] = [];
  // 占比降序；同占比按引擎 id 升序（🔴 用码位比较而不是 `localeCompare`：
  // 后者随运行环境的地域设置变化，会让"换语言不改变输出"这条判据变得不可靠）。
  const ordered = trafficSplit
    .filter((item) => item.share > 0)
    .sort(
      (left, right) =>
        right.share - left.share ||
        (left.engine < right.engine ? -1 : left.engine > right.engine ? 1 : 0),
    );

  for (const item of ordered) {
    const kind = SOURCE_BY_TRAFFIC_ENGINE[item.engine];
    if (kind === null) continue;
    const defer = catalogEntryOf(kind).phase === 2 || item.share < SUGGEST_DEFER_SHARE;
    suggestions.push({
      engine: item.engine,
      source_kind: kind,
      share: item.share,
      reason_key: defer ? SUGGEST_LATER_KEY : SUGGEST_NOW_KEY,
    });
  }
  return suggestions;
}

/** 建议里"现在就接"的那几个（词典插值 `{{total}}` 用它数数）。 */
export function primarySuggestions(
  suggestions: readonly SearchSourceSuggestion[],
): SearchSourceSuggestion[] {
  return suggestions.filter((item) => item.reason_key === SUGGEST_NOW_KEY);
}

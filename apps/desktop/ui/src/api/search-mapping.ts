/**
 * 声明式指标映射表（DR-107）：**平台原文列名 → 规范列**，版本化 + 可审计。
 * 设计规格 `docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md`。
 *
 * # 🔴 为什么必须版本化
 * 百度《AI 流量分析》**至今没有公开字段文档**（维度全来自站长实测与官方站内通知），灰度期随时可能改；
 * 搜狗 / 头条的列名也没有稳定的公开契约。⇒ `MAPPING_VERSION` 是这一版口径的记号，
 * 每条 `SearchQueryMetric` 记下自己进来时的版本，任何数字都能回答"当时是按哪个口径映射进来的"。
 * 🔴 平台改表头就是要 +1 的信号（DR-117 观察清单最后一行），并重录一份 fixture 进 `fixtures/search/`。
 *
 * # 🔴 一张表、两个视角（DR-107 ↔ DR-108 不许各写一份）
 * 目录表的 `alias_columns`（`api/search-catalog.ts`）是**本表的投影**（`aliasColumnsOf`），
 * 不是第二份手抄：粘贴解析与文件导入认列都走 `canonicalColumnOf`，改一处两处跟着对。
 *
 * # 🔴 未映射的列一律回 `null`，由调用方进 `native_extras` 原样留档
 * 静默丢弃是最坏的失败形态（DR-107）：平台加了一个新指标，我们悄悄扔了，
 * 客户在自己后台看得到、在我们这儿看不到，信任当场崩。
 * 例：百度传统面的「平均排名」、GSC 的 `Position`、Bing 的 `Grounding Queries` **刻意不映射**
 * ——`SearchQueryMetric` 没有位次字段（位次在自建索引里只记**带**，DR-118），
 * 于是它们留在 C 类面板里标注平台，而不是被塞进某个数字列伪装成同量纲。
 *
 * # 出处纪律（DR-108：每补一条别名都要写明出处）
 * 见下面 `NATIVE_COLUMNS` 每个源的注释：一级出处（录制进 `fixtures/search/` 的官方导出）与
 * 二级出处（后台表头 / 官方文档转录，待录样本核实）分开标注。
 *
 * # 语言约束
 * 平台原文列名是**数据**（中文照实存，同 `api/error-text.ts` 的诊断串），不是界面文案；
 * 本文件不产出任何面向用户的自然语言，口径说明的 i18n key 在目录表的 `metric_notes_key`。
 */
import type { AssertComplete, ValuesAreComplete } from './completeness';
import type { SearchSourceKind } from './types-search';
import { SEARCH_SOURCE_VALUES } from './types-search';

// ---------------------------------------------------------------------------
// 规范列词表
// ---------------------------------------------------------------------------

/**
 * 规范列（DR-107 的 `canonical_metric`）。🔴 三条命名纪律：
 * - **没有 `ctr` 这个落库位**，只有 `ctr_check` / `ai_ctr_check`：平台给的比率**只能**作交叉校验，
 *   入库与展示一律重算（DR-95 B 类 / DR-98）⇒ "比率不是真值"这件事写在类型里，不写在注释里；
 * - **没有 `position`**：位次只以**带**的形态存在于自建索引（DR-118），平台的平均排名进 C 类留档；
 * - **没有 `sessions`**：百度统计的会话数是站内量纲（DR-95 C 类），映射进来就等于暗示它能与曝光并列。
 */
export type SearchCanonicalColumn =
  | 'query'
  | 'page_url'
  | 'impressions'
  | 'clicks'
  | 'citations'
  | 'ai_clicks'
  | 'cited_pages'
  | 'ctr_check'
  | 'ai_ctr_check';

export const SEARCH_CANONICAL_COLUMN_VALUES = [
  'query',
  'page_url',
  'impressions',
  'clicks',
  'citations',
  'ai_clicks',
  'cited_pages',
  'ctr_check',
  'ai_ctr_check',
] as const satisfies readonly SearchCanonicalColumn[];

/**
 * DR-95 的三层：`a` 可加（不相交事件集合，跨平台求和合法）/ `b` 只能重算（分母各不相同，
 * 🔴 绝不对各平台的比率取平均）/ `c` 平台独有（单独展示 + 平台徽章）。
 * `dimension` 是本轮补的第四档：`query` / `page_url` 这类**维度列**既不可加也不是比率，
 * 加它才能让 `alias_columns` 由同一张表投影出来（否则维度列要在目录表里再写一遍 = 两个真值源）。
 */
export type SearchMetricTier = 'a' | 'b' | 'c' | 'dimension';

export const SEARCH_METRIC_TIER_VALUES = [
  'a',
  'b',
  'c',
  'dimension',
] as const satisfies readonly SearchMetricTier[];

/** 列的量纲：`count` / `ratio` 是数字列（粘贴解析要归一千分位、百分号与中文"万"），另两个是文本。 */
export type SearchColumnUnit = 'count' | 'ratio' | 'text' | 'url';

export const SEARCH_COLUMN_UNIT_VALUES = [
  'count',
  'ratio',
  'text',
  'url',
] as const satisfies readonly SearchColumnUnit[];

/** 每个规范列的层与量纲**只写一份**（映射行由它派生，30 行里不必各抄一遍）。 */
const COLUMN_SHAPE: Readonly<
  Record<SearchCanonicalColumn, { tier: SearchMetricTier; unit: SearchColumnUnit }>
> = {
  query: { tier: 'dimension', unit: 'text' },
  page_url: { tier: 'dimension', unit: 'url' },
  impressions: { tier: 'a', unit: 'count' },
  clicks: { tier: 'a', unit: 'count' },
  citations: { tier: 'a', unit: 'count' },
  ai_clicks: { tier: 'a', unit: 'count' },
  cited_pages: { tier: 'c', unit: 'count' },
  ctr_check: { tier: 'b', unit: 'ratio' },
  ai_ctr_check: { tier: 'b', unit: 'ratio' },
};

// ---------------------------------------------------------------------------
// 映射表
// ---------------------------------------------------------------------------

/**
 * 这一版映射表的记号（DR-107）。格式 `<日期>.<当日修订序>`：
 * 平台改表头 / 我们补别名都算一次修订，**只增不改**（历史行的 `since_version` 不许回填）。
 */
export const MAPPING_VERSION = '2026-10-12.1';

/**
 * 平台原文列名 → 规范列。空对象 = 这个源今天**没有**已核实的别名，
 * 认列只剩"与我们自己模板同名"这一条兜底（`canonicalColumnOf` 的 identity 支）。
 */
const NATIVE_COLUMNS: Readonly<
  Record<SearchSourceKind, Readonly<Record<string, SearchCanonicalColumn>>>
> = {
  /**
   * 🔴 **一级出处**：2026-10-12 产品负责人本机 Chrome 登录导出的官方 xlsx 表头原文，
   * 两份空表已录 `fixtures/search/baidu_aiflow_hot_{keywords,pages}_empty_2026-10-12.xlsx`
   * （关键词表 `关键词|AI引用量|AI曝光量|AI点击量|AI点击率`、页面表首列是 `页面`）。
   * ⚠ `AI点击率` 的分母是**引用量**（不是曝光量）⇒ 只作交叉校验（DR-98），落 `ctr_check`。
   */
  baidu_ziyuan_ai: {
    关键词: 'query',
    页面: 'page_url',
    AI引用量: 'citations',
    AI曝光量: 'impressions',
    AI点击量: 'clicks',
    AI点击率: 'ctr_check',
  },
  /**
   * 二级出处：后台「数据统计 → 流量与关键词」表头（`展现量 / 点击量 / 平均排名`，
   * 口径见词典 `webmasterData.metricNotes.baidu_ziyuan`）。🔴 待录一份样本核实（DR-108）。
   * 「平均排名」与「索引量」**刻意不映射** ⇒ 进 `native_extras`（见文件头）。
   */
  baidu_ziyuan: {
    关键词: 'query',
    展现量: 'impressions',
    点击量: 'clicks',
  },
  /** 二级出处：后台「数据统计 → 关键词」表头（`展现量 / 点击量`，DR-92 表）。🔴 待录样本核实。 */
  toutiao: {
    关键词: 'query',
    展现量: 'impressions',
    点击量: 'clicks',
  },
  /**
   * 出处：Search Console 导出 CSV / Search Analytics API 的固定列名
   * （`Query,Page,Clicks,Impressions,CTR,Position`，developers.google.com/webmaster-tools）。
   * `Position` **刻意不映射**（同文件头那条）；生成式 AI 维度今天**不存在**（DR-117 观察清单）。
   */
  gsc: {
    Query: 'query',
    Page: 'page_url',
    Clicks: 'clicks',
    Impressions: 'impressions',
    CTR: 'ctr_check',
  },
  /**
   * 🔴 **刻意留空**：Bing 报表的列名我们**没有录制样本**，而 DR-108 要求"每补一条都要写明出处"
   * ——凭印象补别名比不补更糟（错一列就静默把数据映射歪）。今天 Bing 走 `api`（REST，DR-93）
   * 或我们自己的模板（列名与规范列同名，靠 identity 认）。`Grounding Queries` 是 C 类平台独有维度。
   */
  bing_wmt: {},
  /** 二期源（`phase: 2`）：枚举、词典与目录行齐全，别名等开放时按录制样本补（§3.4b）。 */
  sogou: {},
  so_360: {},
  /**
   * 🔴 刻意留空：百度统计的量纲是**会话**（DR-95 C 类 + DR-110 护栏 2），
   * 规范列里**没有** `sessions` 这个落库位 ⇒ 它的列一律进 `native_extras` 并标注平台，
   * 而不是被映射成"看起来能加"的曝光。它的用途是 DR-111 的流量来源分布（`suggestSources` 的输入）。
   */
  baidu_tongji: {},
  /** 人工填报走表单，不走认列；真要粘贴就按我们三张模板的列名（identity 支）。 */
  manual: {},
};

/** 一行映射（DR-107 的行形状；`tier` / `unit` 由 `COLUMN_SHAPE` 派生，不在每行各写一遍）。 */
export interface SearchMetricMappingRow {
  source_kind: SearchSourceKind;
  /** 平台导出 / 后台里的**原文列名**（中文照实存：它是数据，不是文案）。 */
  native_field: string;
  canonical_column: SearchCanonicalColumn;
  tier: SearchMetricTier;
  unit: SearchColumnUnit;
  /** 这一行是哪一版加进来的（🔴 只增不改，历史行不回填）。 */
  since_version: string;
}

/**
 * 映射表本体。🔴 **数据不是算法** ⇒ demo 可以持有真表并真查（DR-99 ②）；
 * 真后端落地时同一份表要搬进 `geo-domain`（Plan C 义务，E-67 ③），两端不得各写一份。
 */
export const SEARCH_METRIC_MAPPING: readonly SearchMetricMappingRow[] = SEARCH_SOURCE_VALUES.flatMap(
  (kind) =>
    Object.entries(NATIVE_COLUMNS[kind]).map(([native_field, canonical_column]) => ({
      source_kind: kind,
      native_field,
      canonical_column,
      tier: COLUMN_SHAPE[canonical_column].tier,
      unit: COLUMN_SHAPE[canonical_column].unit,
      since_version: MAPPING_VERSION,
    })),
);

// ---------------------------------------------------------------------------
// 查表
// ---------------------------------------------------------------------------

/** 每个源的小写索引（ASCII 列名大小写不敏感：GSC 导出是 `CTR`，我们模板是 `ctr_check`）。 */
const LOWERED_INDEX: Readonly<Record<SearchSourceKind, Readonly<Map<string, SearchCanonicalColumn>>>> =
  Object.fromEntries(
    SEARCH_SOURCE_VALUES.map((kind) => [
      kind,
      new Map(
        Object.entries(NATIVE_COLUMNS[kind]).map(([header, column]) => [
          header.trim().toLowerCase(),
          column,
        ]),
      ),
    ]),
  ) as Readonly<Record<SearchSourceKind, Readonly<Map<string, SearchCanonicalColumn>>>>;

/** 规范列名的小写集合（identity 兜底：我们自己的三张模板列名 == 规范列名）。 */
const CANONICAL_LOWERED: Readonly<Map<string, SearchCanonicalColumn>> = new Map(
  SEARCH_CANONICAL_COLUMN_VALUES.map((column) => [column.toLowerCase(), column]),
);

/** 一个源的映射行（可能为空数组：空数组是合法结论，不是错误）。 */
export function mappingRowsFor(kind: SearchSourceKind): readonly SearchMetricMappingRow[] {
  return SEARCH_METRIC_MAPPING.filter((row) => row.source_kind === kind);
}

/**
 * 目录表 `alias_columns` 的**投影**（DR-108）：原文列名 → 规范列。
 * 🔴 由映射表派生 ⇒ "各平台导出长什么样 → 对应我们哪一列"这张对照说明与解析器不可能各说一套。
 */
export function aliasColumnsOf(
  kind: SearchSourceKind,
): Readonly<Record<string, SearchCanonicalColumn>> {
  return { ...NATIVE_COLUMNS[kind] };
}

/**
 * 认列：先查该源的别名表，再退到"表头本身就是规范列名"（identity，我们三张模板走这一支）。
 * @returns 认不出一律 `null`（调用方进 `native_extras`，**不猜**）。
 */
export function canonicalColumnOf(
  kind: SearchSourceKind,
  header: string,
): SearchCanonicalColumn | null {
  const normalized = header.trim().toLowerCase();
  if (normalized === '') return null;
  return LOWERED_INDEX[kind].get(normalized) ?? CANONICAL_LOWERED.get(normalized) ?? null;
}

/** 这个规范列属于 DR-95 的哪一层。 */
export function tierOf(column: SearchCanonicalColumn): SearchMetricTier {
  return COLUMN_SHAPE[column].tier;
}

/** 这个规范列的量纲。 */
export function unitOf(column: SearchCanonicalColumn): SearchColumnUnit {
  return COLUMN_SHAPE[column].unit;
}

/** 是不是数字列（粘贴解析据此决定要不要归一千分位 / 百分号 / 中文"万"）。 */
export function isNumericColumn(column: SearchCanonicalColumn): boolean {
  const unit = COLUMN_SHAPE[column].unit;
  return unit === 'count' || unit === 'ratio';
}

/**
 * 一个源的**必备指标列**（导入 / 粘贴时缺一个就报错，不猜：E-72 ③）。
 *
 * 🔴 由映射表派生而不是另写一张表：`baidu_ziyuan_ai` 因此得到官方导出那四个指标列
 * （`citations` / `impressions` / `clicks` / `ctr_check`），关键词表与页面表**共用**这一套
 * （两张表只差维度列是 `关键词` 还是 `页面`，维度列由 `parseTableGrid` 单独要求"至少一列"）。
 * 没有已核实别名的源回**空数组** ⇒ 只剩"至少一个维度列 + 至少一个 A 类指标列"这条通用判据。
 */
export function requiredMetricColumnsOf(kind: SearchSourceKind): readonly SearchCanonicalColumn[] {
  const required = new Set<SearchCanonicalColumn>();
  for (const row of mappingRowsFor(kind)) {
    if (row.tier === 'a' || row.tier === 'b') required.add(row.canonical_column);
  }
  return SEARCH_CANONICAL_COLUMN_VALUES.filter((column) => required.has(column));
}

// ---------------------------------------------------------------------------
// 编译期完整性网
// ---------------------------------------------------------------------------

export type SearchCanonicalColumnValuesComplete = AssertComplete<
  ValuesAreComplete<SearchCanonicalColumn, typeof SEARCH_CANONICAL_COLUMN_VALUES>
>;
export type SearchMetricTierValuesComplete = AssertComplete<
  ValuesAreComplete<SearchMetricTier, typeof SEARCH_METRIC_TIER_VALUES>
>;
export type SearchColumnUnitValuesComplete = AssertComplete<
  ValuesAreComplete<SearchColumnUnit, typeof SEARCH_COLUMN_UNIT_VALUES>
>;
// 🔴 这里**刻意没有**"9 个源都在 `NATIVE_COLUMNS` 里"的断言：那个 `Readonly<Record<SearchSourceKind, …>>`
// 标注本身就是穷尽性网（漏一个键 `tsc -b` 就红），再套一层 `ValuesAreComplete` 只会得到一条永真判据。

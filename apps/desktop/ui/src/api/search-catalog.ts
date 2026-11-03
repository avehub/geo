/**
 * 源目录表（DR-108）：**加一个源只加数据、不改页面**。
 * 设计规格 `docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md`。
 *
 * # 🔴 这张表是产品负责人"后期还要接搜狗 / 360"那条指示的直接架构后果
 * 源会持续增加，就不能每加一个源改一次页面：加一个源 = 目录表加一行 + 映射表加几行 +
 * 词典加几个键，**页面代码零改动**；编译期完整性网（`SearchCatalogComplete`）负责在漏配目录行时
 * **编译不过**，`SEARCH_SOURCE_VALUES` 与词典那两节负责在漏配标签时编译不过 / 测试红。
 *
 * # 🔴 三个渲染纪律（都由本文件的数据决定，页面不许自己判）
 * - `phase: 2` 的源**不进渲染集**（`renderableCatalog`）：渲染一个永远点不动的入口，
 *   只会让用户以为是自己配错了（DR-92）；它们单独走"二期数据源"那段说明（`upcomingCatalog`）；
 * - `auth_mode: 'none'` 的源**不渲染**接口授权选项（不是置灰，是根本不渲染：
 *   "这个源还没有 OAuth"是产品排期，不需要向用户暴露，DR-93）；
 * - `group: 'analytics'` 的源渲染成**次级分组**，且永不进 A 类合计（DR-110 护栏 2，
 *   判据在 `api/search-compose.ts`）。
 *
 * # 🔴 `alias_columns` 是 `api/search-mapping.ts` 的**投影**，不是第二份手抄
 * 认列只有一处真值源（DR-107 ↔ DR-108）：改映射表，这里的对照与界面上"各平台导出长什么样"
 * 那张说明一起跟着变。
 *
 * # 语言约束
 * 本文件不产出任何面向用户的自然语言：`label_key` / `metric_notes_key` 是 i18n key，
 * `docs_url` 是可点的出处，`data_through_rule` 是纯数据（口径散文写在注释里，附出处）。
 */
import type { AssertComplete, ValuesAreComplete } from './completeness';
import { aliasColumnsOf } from './search-mapping';
import type { SearchCanonicalColumn } from './search-mapping';
import type {
  SearchAuthMode,
  SearchBindingField,
  SearchGroup,
  SearchIngestMode,
  SearchRegion,
  SearchSourceKind,
} from './types-search';
import { SEARCH_GROUP_VALUES } from './types-search';

// ---------------------------------------------------------------------------
// 目录行的形状
// ---------------------------------------------------------------------------

/** 一期 / 二期（DR-92）。🔴 二期源本轮就进目录表与词典，只是界面不渲染接入入口。 */
export type SearchPhase = 1 | 2;

/**
 * 平台的更新节奏（DR-108 要求 `data_through_rule` 收各源节奏，DR-109 用它算交集区间）。
 * 散文口径写在下面每个源的注释里；界面只渲染**数据截至日**这一个结果，不渲染节奏本身。
 */
export type SearchCadence = 'near_realtime' | 'daily' | 'weekly' | 'monthly' | 'unknown';

export const SEARCH_CADENCE_VALUES = [
  'near_realtime',
  'daily',
  'weekly',
  'monthly',
  'unknown',
] as const satisfies readonly SearchCadence[];

/**
 * 数据截至日怎么推（DR-109）。
 * `lag_days` 是平台自陈的数据延迟：`resolveDataThrough` 用它算"平台今天最多能给到哪天"，
 * 再与导入内容的 `period_end` **取更早的那个**。
 */
export interface SearchDataThroughRule {
  lag_days: number;
  cadence: SearchCadence;
}

/** 一个源在目录表里的那一行（字段集由 DR-108 定，🔴 页面只读这张表，不自己判）。 */
export interface SearchSourceCatalogEntry {
  kind: SearchSourceKind;
  /** 源标签的 i18n key（`webmasterData.sources.<kind>`，与 `enumLabel` 的前缀 + id 同口径）。 */
  label_key: string;
  group: SearchGroup;
  region: SearchRegion;
  phase: SearchPhase;
  /** 凭据形态（与 `ingest_modes` 正交，DR-113）。 */
  auth_mode: SearchAuthMode;
  /** 这个源支持哪几种取数形态；顺序即界面上的按钮顺序（🔴 粘贴是主按钮，DR-113）。 */
  ingest_modes: readonly SearchIngestMode[];
  /** 站点绑定字段（**非敏感**，DR-96）；人工填报没有绑定 ⇒ 空数组。 */
  binding_fields: readonly SearchBindingField[];
  /** 平台原文列名 → 规范列（`api/search-mapping.ts` 的投影）。 */
  alias_columns: Readonly<Record<string, SearchCanonicalColumn>>;
  data_through_rule: SearchDataThroughRule;
  /** 官方文档或后台入口（界面上作为可点出处）；`manual` 不对应平台 ⇒ `null`。 */
  docs_url: string | null;
  /** 口径说明的 i18n key（`webmasterData.metricNotes.<kind>`，DR-95 要求常驻可展开）。 */
  metric_notes_key: string;
}

// ---------------------------------------------------------------------------
// 目录表本体
// ---------------------------------------------------------------------------

/**
 * 9 行（含二期两行）。🔴 `label_key` / `metric_notes_key` 由 `keys()` 拼出来而不是逐行手写：
 * 词典那两节的键名 == `kind`（`webmasterData.sources.<kind>`），手写 18 个字符串就是 18 个拼错的机会。
 */
function keys(kind: SearchSourceKind): { label_key: string; metric_notes_key: string } {
  return {
    label_key: `webmasterData.sources.${kind}`,
    metric_notes_key: `webmasterData.metricNotes.${kind}`,
  };
}

export const SEARCH_SOURCE_CATALOG: readonly SearchSourceCatalogEntry[] = [
  {
    kind: 'baidu_ziyuan_ai',
    ...keys('baidu_ziyuan_ai'),
    group: 'webmaster_cn',
    region: 'cn',
    phase: 1,
    auth_mode: 'none',
    // 🔴 粘贴是**主**路径（DR-113）：官方只有「AI 引用热门关键词」一张表带下载按钮（xlsx），
    // 概览与趋势两段没有导出入口 ⇒ 那两段只能复制粘贴。
    ingest_modes: ['paste_parse', 'file_import', 'manual_entry'],
    binding_fields: ['siteUrl'],
    alias_columns: aliasColumnsOf('baidu_ziyuan_ai'),
    // 灰度期节奏不确定（DR-108："灰度期可能空白"），且导出**没有日期列**
    // ⇒ 区间靠导入时确认（`window_source: 'user_stated'`），延迟天数不假设。
    data_through_rule: { lag_days: 0, cadence: 'unknown' },
    // 实测路由（2026-10-12 产品负责人本机 Chrome 登录，见 fixtures/search/README.md）。
    docs_url: 'https://ziyuan.baidu.com/aiflow/index',
  },
  {
    kind: 'baidu_ziyuan',
    ...keys('baidu_ziyuan'),
    group: 'webmaster_cn',
    region: 'cn',
    phase: 1,
    // 平台只开放收录推送接口，读数没有 API（DR-93 / §3.4c 路径 A）。
    auth_mode: 'none',
    ingest_modes: ['paste_parse', 'file_import', 'manual_entry'],
    binding_fields: ['siteUrl'],
    alias_columns: aliasColumnsOf('baidu_ziyuan'),
    // 每日更新、无官方延迟数字 ⇒ 取"至少差一天"这个最小假设（拿到出处再改）。
    data_through_rule: { lag_days: 1, cadence: 'daily' },
    docs_url: 'https://ziyuan.baidu.com/wiki/7',
  },
  {
    kind: 'toutiao',
    ...keys('toutiao'),
    group: 'webmaster_cn',
    region: 'cn',
    phase: 1,
    auth_mode: 'none',
    ingest_modes: ['paste_parse', 'file_import', 'manual_entry'],
    binding_fields: ['siteUrl'],
    alias_columns: aliasColumnsOf('toutiao'),
    // 每日更新，且"新注册站点数据提取存在延时"⇒ 那是 `completeness: 'partial'`，不是延迟天数。
    data_through_rule: { lag_days: 1, cadence: 'daily' },
    docs_url: 'https://zhanzhang.toutiao.com/',
  },
  {
    kind: 'gsc',
    ...keys('gsc'),
    group: 'webmaster_global',
    region: 'global',
    phase: 1,
    // ✅ OAuth 排期第 2 位（DR-93）；🔴 sensitive scope 的应用验证材料**现在就递**（周级流程）。
    auth_mode: 'oauth',
    ingest_modes: ['api', 'file_import', 'paste_parse'],
    binding_fields: ['siteUrl'],
    alias_columns: aliasColumnsOf('gsc'),
    // 官方"数据延迟约 2~3 天"⇒ 取上界 3（宁可区间收敛得早一点，也不要静默少算）。
    data_through_rule: { lag_days: 3, cadence: 'daily' },
    docs_url: 'https://developers.google.com/webmaster-tools',
  },
  {
    kind: 'bing_wmt',
    ...keys('bing_wmt'),
    group: 'webmaster_global',
    region: 'global',
    phase: 1,
    // ✅ OAuth 排期第 3 位；🔴 必须走 **REST**（SOAP / POX 已于 2026-08-31 退役，DR-93）。
    auth_mode: 'oauth',
    ingest_modes: ['api', 'file_import', 'paste_parse'],
    binding_fields: ['siteUrl'],
    alias_columns: aliasColumnsOf('bing_wmt'),
    data_through_rule: { lag_days: 1, cadence: 'daily' },
    docs_url: 'https://www.bing.com/webmasters/help',
  },
  {
    kind: 'sogou',
    ...keys('sogou'),
    group: 'webmaster_cn',
    region: 'cn',
    // 🔴 二期（DR-92 / §3.4b）：官方只有收录推送接口；开放后把这里改成 1，页面零改动。
    phase: 2,
    auth_mode: 'none',
    ingest_modes: ['paste_parse', 'file_import', 'manual_entry'],
    binding_fields: ['siteUrl'],
    alias_columns: aliasColumnsOf('sogou'),
    // 官方口径"每日 15:00 后可查前一日"⇒ 差一天。
    data_through_rule: { lag_days: 1, cadence: 'daily' },
    docs_url: 'https://zhanzhang.sogou.com/',
  },
  {
    kind: 'so_360',
    ...keys('so_360'),
    group: 'webmaster_cn',
    region: 'cn',
    phase: 2,
    auth_mode: 'none',
    ingest_modes: ['paste_parse', 'file_import', 'manual_entry'],
    binding_fields: ['siteUrl'],
    alias_columns: aliasColumnsOf('so_360'),
    data_through_rule: { lag_days: 1, cadence: 'daily' },
    docs_url: 'https://zhanzhang.so.com/',
  },
  {
    kind: 'baidu_tongji',
    ...keys('baidu_tongji'),
    // 🔴 单独成"站内分析"补充组（DR-92 / 产品负责人裁定 4）：量纲是会话，永不进曝光合计。
    group: 'analytics',
    region: 'cn',
    phase: 1,
    // ✅ OAuth 排期第 1 位（国内命中率最高、审批最轻；注意百度账号与百度智能云是两套体系）。
    auth_mode: 'oauth',
    ingest_modes: ['api', 'paste_parse', 'file_import', 'manual_entry'],
    // 百度统计的站点标识是 siteId（不是网址）。
    binding_fields: ['siteId'],
    alias_columns: aliasColumnsOf('baidu_tongji'),
    data_through_rule: { lag_days: 0, cadence: 'near_realtime' },
    docs_url: 'https://tongji.baidu.com/open/api/',
  },
  {
    kind: 'manual',
    ...keys('manual'),
    // 兜底入口放在国内段（产品定义的目标客户是国内中小企业；`region: 'both'` 表示它不对应
    // 某个平台的可达性）。
    group: 'webmaster_cn',
    region: 'both',
    phase: 1,
    auth_mode: 'none',
    ingest_modes: ['manual_entry'],
    binding_fields: [],
    alias_columns: aliasColumnsOf('manual'),
    // 人工填报：填的是哪个区间就是哪个区间（`window_source: 'user_stated'`），不推延迟。
    data_through_rule: { lag_days: 0, cadence: 'unknown' },
    docs_url: null,
  },
];

// ---------------------------------------------------------------------------
// 查表
// ---------------------------------------------------------------------------

const BY_KIND: Readonly<Record<SearchSourceKind, SearchSourceCatalogEntry>> = Object.fromEntries(
  SEARCH_SOURCE_CATALOG.map((entry) => [entry.kind, entry]),
) as Readonly<Record<SearchSourceKind, SearchSourceCatalogEntry>>;

/** 一个源的目录行。🔴 漏配目录行在**编译期**就红（见文件末尾的完整性网），运行期不必判空。 */
export function catalogEntryOf(kind: SearchSourceKind): SearchSourceCatalogEntry {
  return BY_KIND[kind];
}

/** 一期源（界面渲染集）；二期源走 `upcomingCatalog`，两者不混在一段里渲染。 */
export function renderableCatalog(): readonly SearchSourceCatalogEntry[] {
  return SEARCH_SOURCE_CATALOG.filter((entry) => entry.phase === 1);
}

/** 二期源（界面上只出现在"二期数据源"那段说明里，不给接入入口，DR-92）。 */
export function upcomingCatalog(): readonly SearchSourceCatalogEntry[] {
  return SEARCH_SOURCE_CATALOG.filter((entry) => entry.phase === 2);
}

/** 一段渲染分组：`group` + 该组的一期源（组序即视觉权重，DR-104）。 */
export interface SearchCatalogSection {
  group: SearchGroup;
  entries: readonly SearchSourceCatalogEntry[];
}

/** 按三段给出渲染集（`analytics` 段视觉上次级；空段也保留，页面据此渲染空态而不是跳过）。 */
export function catalogByGroup(): readonly SearchCatalogSection[] {
  return SEARCH_GROUP_VALUES.map((group) => ({
    group,
    entries: renderableCatalog().filter((entry) => entry.group === group),
  }));
}

/**
 * 凭据引用串（DR-96）：`keyring://search/<kind>`。
 * 🔴 **刻意两段、刻意账号级**：`crates/geo-store/src/secret.rs` 的 `parse_secret_ref` 只吃两段，
 * 而 OAuth 令牌天然是账号级的（一个 Google 账号可访问多个资源）⇒ 按项目隔离凭据是错的建模；
 * 项目级的东西是**站点绑定**（`binding`，非敏感）。这与差异台账 E-56 那个三段串方向相反。
 */
export function searchSecretRef(kind: SearchSourceKind): string {
  return `keyring://search/${kind}`;
}

/** `resolveDataThrough` 的入参：导入内容的区间末日 + 导入时刻。 */
export interface DataThroughInput {
  /** 导入 / 粘贴内容覆盖的区间末日（`YYYY-MM-DD`）。 */
  period_end: string;
  /** 导入时刻（RFC3339）。 */
  imported_at: string;
}

/** 只取 `YYYY-MM-DD` 那一段（`data_through` 是**日期**，不是时间戳）。 */
function utcDateOf(timestamp: string): string {
  const moment = new Date(timestamp);
  const month = `${moment.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${moment.getUTCDate()}`.padStart(2, '0');
  return `${moment.getUTCFullYear()}-${month}-${day}`;
}

/** 日期串减 N 天（按 UTC 日历，不碰时区）。 */
function minusDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  const shifted = new Date(Date.UTC(year, month - 1, day - days));
  return utcDateOf(shifted.toISOString());
}

/**
 * 这个源的数据截至日（DR-109）：`data_through_rule` 推出的**平台可用日**与导入内容的
 * `period_end` **取更早的那个**——导出的周期到 9/30、但平台只更新到 9/28，就以 9/28 为准。
 *
 * 🔴 这条为什么要紧：汇总"近 30 天"时若某个源只到 9/27，直接相加会**静默少算**它最后三天，
 * 而一个会因为平台延迟莫名掉 40% 的合计数字，被追问一次就全线崩塌（§1 拆解第 4 问）。
 */
export function resolveDataThrough(kind: SearchSourceKind, input: DataThroughInput): string {
  const { lag_days: lagDays } = catalogEntryOf(kind).data_through_rule;
  const platformAvailable = minusDays(utcDateOf(input.imported_at), lagDays);
  return platformAvailable < input.period_end ? platformAvailable : input.period_end;
}

// ---------------------------------------------------------------------------
// 编译期完整性网
// ---------------------------------------------------------------------------

export type SearchCadenceValuesComplete = AssertComplete<
  ValuesAreComplete<SearchCadence, typeof SEARCH_CADENCE_VALUES>
>;
/**
 * 🔴 目录表覆盖 `SearchSourceKind` 的全部成员：漏配一个源 ⇒ 这里编译不过
 * （`ValuesAreComplete` 的 `Values[number]` 取的是**字面量** kind，
 * 所以目录表必须 `as const` 才能把 kind 留在类型里）。
 */
type CatalogKinds = (typeof SEARCH_SOURCE_CATALOG)[number]['kind'];
export type SearchCatalogComplete = AssertComplete<
  ValuesAreComplete<SearchSourceKind, readonly CatalogKinds[]>
>;

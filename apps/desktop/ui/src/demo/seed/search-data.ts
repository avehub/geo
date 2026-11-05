/**
 * 种子：站长数据（M5.5 站外真相层）。
 * 设计规格 `docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md`（§5.2 / DR-90 … DR-118）。
 *
 * # 🔴 这一份种子的全部价值在「手工算对」
 * §5.2 那 16 条自洽判据（落 `demo/seed.test.ts`）要求：**每个比率都是手写的字面量**，
 * 不许由 `clicks / impressions` 现场算出来——算出来的种子会让判据变成永真式，
 * 而这一轮 demo 唯一"真做"的事恰恰是重算（DR-99：映射、A 类求和、B 类重算、区间收敛都在
 * `api/search-compose.ts` 真跑）。姿态照 `seed/diagnosis.ts` 的"手工满足公式"。
 *
 * # 🔴 三张表的写路径密度不同（裁定写在 `demo/types.ts` 的 `DemoDb` 注释里）
 * - `SEED_SEARCH_SOURCES` / `_QUERY_METRICS` / `_AI_OVERVIEWS` / `_NATIVE_EXTRAS` /
 *   `_OPPORTUNITIES` **进库**（各有写路径）；
 * - `SEED_SELF_INDEX_SNAPSHOTS` 进库但**本轮只读**（DR-118：命令面不加，寄生
 *   `collection_*` 的写路径 + `search_board` 的读出口）；
 * - `SEED_SEARCH_SOURCE_PROBES`（自检结论）**不进库**：它是"探测结果"的替身、
 *   `search_source_test` 不联网（规则 2）；
 * - `SEED_SEARCH_TRAFFIC_SPLIT`（客户自己的流量分布）**进库但只读**：`search_board` 要按项目
 *   端出这个站点的分布、归档项目自然回空数组（DR-111），所以它需要 `project_id`；
 *   本轮没有写命令，真后端由 `analytics` 组的来源分析算出。
 *
 * # 🔴 三个刻意安排的"不完美"，都是为了让走查看得见（§5.2 第 5 / 11 / 13 条）
 * ① `gsc` 的 `data_through` 比其他源**早 3 天**且 `completeness: 'sampled'`
 *   （GSC 每种搜索类型每天最多 5 万行、超出**静默采样**，DR-110）⇒ 汇总区间收敛与旗标可走查；
 * ② `toutiao` 整批数据停在 **2026-08-20**（`STALE_AFTER_DAYS = 35` 之外）⇒ `stale_sources` 非空；
 * ③ `baidu_tongji` 三行**没有任何 A 类指标**（`impressions` / `clicks` 全 `null`，会话数只在
 *   C 类留档里）⇒ "站内分析的会话数永不进曝光合计"这条护栏（DR-110 护栏 2）可走查。
 *
 * # 合规（规则 6）与出处（规则 11 / DR-115）
 * 机会的 `basis` 只摊开数字，不出现"保证排名 / 霸屏 / 第一 / 最"一类绝对化表述；
 * 外部 CTR 曲线不在本文件（在 `api/search-benchmark.ts`，每条带机构名 + 年份 + 链接，默认不参与判定）。
 */
import type {
  CheckDetail,
  SearchAiOverview,
  SearchCompleteness,
  SearchNativeExtra,
  SearchOpportunity,
  SearchQueryMetric,
  SearchSource,
  SearchSourceKind,
  SearchSurface,
  SelfIndexSnapshot,
  SiteChannelStatus,
  WindowSource,
} from '../../api/types';
import type { SearchTrafficShareRow } from '../types';
import { MAPPING_VERSION } from '../../api/search-mapping';
import { SEED_BASELINE_ROUND_ID, SEED_LIVE_ROUND_ID, SEED_RETEST_ROUND_ID } from './collection-rounds';
import { SEED_ACTIVE_PROJECT_ID } from './projects';
import { SEED_SITE_DOMAIN } from './site';

// ---------------------------------------------------------------------------
// 演示周期（§5.2 第 11 条：钉死在 2026-09，与 `FIXED_SEED_WINDOW` 同月）
// ---------------------------------------------------------------------------

/**
 * 演示模式的"今天"（`YYYY-MM-DD`）。
 * 🔴 由种子给出而**不取系统时间**：陈旧判定（`isStaleData`）要可复现，
 * 取 `new Date()` 会让同一份种子在不同日期跑出不同结论（§B-4 的确定性纪律）。
 */
export const SEED_SEARCH_AS_OF = '2026-09-30';

/** 主演示区间：9 月 1 日到 9 月 27 日（各源导出的周期末日一致，便于横向对照）。 */
export const SEED_SEARCH_PERIOD_START = '2026-09-01';
export const SEED_SEARCH_PERIOD_END = '2026-09-27';

/** 多数源的数据截至日；🔴 `gsc` 比它**早 3 天**（§5.2 第 5 条，区间收敛的走查点）。 */
export const SEED_SEARCH_DATA_THROUGH = '2026-09-27';
export const SEED_SEARCH_GSC_DATA_THROUGH = '2026-09-24';
/** 头条那一批停在 8 月 20 日 ⇒ 距 `SEED_SEARCH_AS_OF` 41 天，越过 `STALE_AFTER_DAYS = 35`。 */
export const SEED_SEARCH_TOUTIAO_DATA_THROUGH = '2026-08-20';

/** 一个源这一批数据的区间 / 截至日 / 完整性（🔴 只有 `toutiao` 是过期的那个例外）。 */
interface MetricWindow {
  period_start: string;
  period_end: string;
  data_through: string;
  imported_at: string;
  completeness: SearchCompleteness;
  window_source: WindowSource;
}

const SEPTEMBER = {
  period_start: SEED_SEARCH_PERIOD_START,
  period_end: SEED_SEARCH_PERIOD_END,
};

/**
 * 每个源的窗口。🔴 `Partial`：只有**真的种子了数据**的源在这里出现，
 * 二期两个源（`sogou` / `so_360`）连窗口都没有——它们本轮不渲染入口、也不给数据（DR-92 / DR-108）。
 *
 * `window_source` 的口径（DR-98）：百度《AI 流量分析》的导出**没有日期列**、人工填报更是用户说了算
 * ⇒ 这两个源记 `user_stated`（界面写"区间由导入时确认"）；其余源的平台导出自带区间 ⇒ `platform`。
 */
const WINDOW_BY_SOURCE: Readonly<Partial<Record<SearchSourceKind, MetricWindow>>> = {
  // 灰度期：平台自陈"部分站点无数据" ⇒ `partial`（DR-110）。
  baidu_ziyuan_ai: {
    ...SEPTEMBER, data_through: SEED_SEARCH_DATA_THROUGH, imported_at: '2026-09-28T01:20:00Z',
    completeness: 'partial', window_source: 'user_stated',
  },
  baidu_ziyuan: {
    ...SEPTEMBER, data_through: SEED_SEARCH_DATA_THROUGH, imported_at: '2026-09-28T01:24:00Z',
    completeness: 'full', window_source: 'platform',
  },
  // 🔴 故意过期：8 月那一批之后再没导过（头条新站延时是 DR-110 点名的 `partial` 成因之一）。
  toutiao: {
    period_start: '2026-08-01', period_end: '2026-08-20',
    data_through: SEED_SEARCH_TOUTIAO_DATA_THROUGH, imported_at: '2026-09-02T03:10:00Z',
    completeness: 'partial', window_source: 'platform',
  },
  // 🔴 早 3 天 + `sampled`：GSC 每种搜索类型每天最多 5 万行，超出部分**静默**采样（DR-110）。
  // 🔴 那 3 天不是魔数：`imported_at` 定在 9/27 时，目录表的 `gsc.lag_days = 3` 正好把
  //   `resolveDataThrough` 算到 9/24（判据铉在 `demo/seed.test.ts`，目录表改了这里就红）。
  gsc: {
    ...SEPTEMBER, data_through: SEED_SEARCH_GSC_DATA_THROUGH, imported_at: '2026-09-27T01:30:00Z',
    completeness: 'sampled', window_source: 'platform',
  },
  bing_wmt: {
    ...SEPTEMBER, data_through: SEED_SEARCH_DATA_THROUGH, imported_at: '2026-09-28T01:34:00Z',
    completeness: 'full', window_source: 'platform',
  },
  baidu_tongji: {
    ...SEPTEMBER, data_through: SEED_SEARCH_DATA_THROUGH, imported_at: '2026-09-28T01:40:00Z',
    completeness: 'full', window_source: 'platform',
  },
  manual: {
    ...SEPTEMBER, data_through: SEED_SEARCH_DATA_THROUGH, imported_at: '2026-09-28T01:44:00Z',
    completeness: 'full', window_source: 'user_stated',
  },
};

// ---------------------------------------------------------------------------
// 一期 7 个源（DR-92）
// ---------------------------------------------------------------------------

/**
 * 🔴 `group` / `region` / `auth_mode` / `ingest_modes` / `binding` 的键集这五样**逐字抄自目录表**
 * （`api/search-catalog.ts` 的 `catalogEntryOf`），而**判据钉在 `demo/seed.test.ts`**：
 * 种子里写死一份、测试拿目录表逐字段比对 ⇒ 目录表改了而种子没跟上就红。
 * 这比在种子里 `catalogEntryOf(kind).group` 现场取更强：现场取会让"抄错"这件事**不可能被发现**。
 *
 * `credentials_state` / `secret_ref` 同一条纪律：`auth_mode: 'none'` ⇒ `not_required` + `null`；
 * `auth_mode: 'oauth'` ⇒ `missing` + `keyring://search/<kind>`（账号级两段，DR-96）。
 * 🔴 规则 3：库里只有**引用串**，一个形如 token 的值都没有；demo 里 `stored` 永不出现（DR-99）。
 */
export const SEED_SEARCH_SOURCES: SearchSource[] = [
  {
    id: 'demo-ssrc-baidu-ai', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'baidu_ziyuan_ai',
    auth_mode: 'none', ingest_modes: ['paste_parse', 'file_import', 'manual_entry'],
    status: 'ready', region: 'cn', group: 'webmaster_cn',
    binding: { siteUrl: SEED_SITE_DOMAIN }, credentials_state: 'not_required', secret_ref: null,
    data_through: SEED_SEARCH_DATA_THROUGH, checked_at: '2026-09-28T01:20:00Z',
    check_detail: { code: 'search_ai_flow_verified', params: {} },
    note: '客户自己每周一下午从后台复制热门关键词表粘贴进来；导出没有日期列，区间要在导入时确认。',
    created_at: '2026-09-12T02:10:00Z', updated_at: '2026-09-28T01:20:00Z',
  },
  {
    id: 'demo-ssrc-baidu-ziyuan', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'baidu_ziyuan',
    auth_mode: 'none', ingest_modes: ['paste_parse', 'file_import', 'manual_entry'],
    status: 'ready', region: 'cn', group: 'webmaster_cn',
    binding: { siteUrl: SEED_SITE_DOMAIN }, credentials_state: 'not_required', secret_ref: null,
    data_through: SEED_SEARCH_DATA_THROUGH, checked_at: '2026-09-28T01:24:00Z',
    check_detail: { code: 'search_traffic_keywords_verified', params: {} },
    note: null,
    created_at: '2026-09-12T02:12:00Z', updated_at: '2026-09-28T01:24:00Z',
  },
  {
    id: 'demo-ssrc-toutiao', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'toutiao',
    auth_mode: 'none', ingest_modes: ['paste_parse', 'file_import', 'manual_entry'],
    status: 'ready', region: 'cn', group: 'webmaster_cn',
    binding: { siteUrl: SEED_SITE_DOMAIN }, credentials_state: 'not_required', secret_ref: null,
    data_through: SEED_SEARCH_TOUTIAO_DATA_THROUGH, checked_at: '2026-09-02T03:10:00Z',
    check_detail: { code: 'search_toutiao_delayed', params: { through: '2026-08-20', days: '41' } },
    note: '等头条把 9 月的数据放出来再导一次；这一批不参与"近 30 天"的合计。',
    created_at: '2026-09-02T03:00:00Z', updated_at: '2026-09-02T03:10:00Z',
  },
  {
    id: 'demo-ssrc-gsc', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'gsc',
    auth_mode: 'oauth', ingest_modes: ['api', 'file_import', 'paste_parse'],
    status: 'ready', region: 'global', group: 'webmaster_global',
    binding: { siteUrl: `${SEED_SITE_DOMAIN}/` }, credentials_state: 'missing',
    secret_ref: 'keyring://search/gsc',
    data_through: SEED_SEARCH_GSC_DATA_THROUGH, checked_at: '2026-09-28T01:30:00Z',
    check_detail: { code: 'search_gsc_export_verified', params: { lag_days: '3', row_cap: '50000' } },
    note: '海外流量占两成，主要是 bag filter / dust collector 这两个英文词族。',
    created_at: '2026-09-12T02:14:00Z', updated_at: '2026-09-28T01:30:00Z',
  },
  {
    id: 'demo-ssrc-bing', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'bing_wmt',
    auth_mode: 'oauth', ingest_modes: ['api', 'file_import', 'paste_parse'],
    status: 'ready', region: 'global', group: 'webmaster_global',
    binding: { siteUrl: `${SEED_SITE_DOMAIN}/` }, credentials_state: 'missing',
    secret_ref: 'keyring://search/bing_wmt',
    data_through: SEED_SEARCH_DATA_THROUGH, checked_at: '2026-09-28T01:34:00Z',
    check_detail: { code: 'search_bing_verified_no_api', params: {} },
    note: null,
    created_at: '2026-09-12T02:16:00Z', updated_at: '2026-09-28T01:34:00Z',
  },
  {
    id: 'demo-ssrc-baidu-tongji', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'baidu_tongji',
    auth_mode: 'oauth', ingest_modes: ['api', 'paste_parse', 'file_import', 'manual_entry'],
    status: 'ready', region: 'cn', group: 'analytics',
    binding: { siteId: 'lanz-hb-2024' }, credentials_state: 'missing',
    secret_ref: 'keyring://search/baidu_tongji',
    data_through: SEED_SEARCH_DATA_THROUGH, checked_at: '2026-09-28T01:40:00Z',
    check_detail: { code: 'search_tongji_verified', params: {} },
    note: '接进来只为回答"客户到底该先接哪个站长平台"，不当曝光数据用。',
    created_at: '2026-09-12T02:18:00Z', updated_at: '2026-09-28T01:40:00Z',
  },
  {
    id: 'demo-ssrc-manual', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'manual',
    auth_mode: 'none', ingest_modes: ['manual_entry'],
    status: 'ready', region: 'both', group: 'webmaster_cn',
    binding: {}, credentials_state: 'not_required', secret_ref: null,
    data_through: SEED_SEARCH_DATA_THROUGH, checked_at: null, check_detail: null,
    note: '兜底：客户手里那份没有后台的渠道（行业目录站、协会网站）由市场同事按月手工填报。',
    created_at: '2026-09-12T02:20:00Z', updated_at: '2026-09-28T01:44:00Z',
  },
];

/**
 * `search_source_test` 的**预置结论**（🔴 不联网，规则 2 / DR-99）。
 * 9 个键全覆盖（`Record<SearchSourceKind, …>` 标注本身就是穷尽性网）：二期两个源也要有结论，
 * 因为开放二期只改目录表一个数字，命令面跟着自动放开（DR-108）。
 */
export const SEED_SEARCH_SOURCE_PROBES: Record<
  SearchSourceKind,
  { status: SiteChannelStatus; check_detail: CheckDetail }
> = {
  baidu_ziyuan_ai: {
    status: 'ready',
    check_detail: { code: 'search_ai_flow_verified', params: {} },
  },
  baidu_ziyuan: {
    status: 'ready',
    check_detail: { code: 'search_traffic_keywords_verified', params: {} },
  },
  toutiao: {
    status: 'failed',
    check_detail: { code: 'search_toutiao_delayed', params: { through: '2026-08-20', days: '41' } },
  },
  gsc: {
    status: 'pending_verify',
    check_detail: { code: 'search_credentials_missing', params: { kind: 'gsc' } },
  },
  bing_wmt: {
    status: 'pending_verify',
    check_detail: { code: 'search_credentials_missing', params: { kind: 'bing_wmt' } },
  },
  sogou: {
    status: 'not_configured',
    check_detail: { code: 'search_phase_two', params: {} },
  },
  so_360: {
    status: 'not_configured',
    check_detail: { code: 'search_phase_two', params: {} },
  },
  baidu_tongji: {
    status: 'ready',
    check_detail: { code: 'search_tongji_verified', params: {} },
  },
  manual: {
    status: 'ready',
    check_detail: { code: 'search_manual_no_probe', params: {} },
  },
};

/**
 * 自检遇到「预置结论是 ready、但站点必填绑定没填全」时的结论文字。
 *
 * 🔴 这是**数据**而不是文案：`demo/handlers/search.ts` 是骨架，非注释 CJK 必须为 0
 * （`i18n/no-hardcoded-strings.test.ts`）；而这句话描述的是演示里的预置探测结论，
 * 与 `SEED_SEARCH_SOURCE_PROBES` 同族，所以放这边。
 */
export const SEED_SEARCH_BINDING_BLOCKED_DETAIL: CheckDetail = {
  code: 'search_binding_blocked',
  params: {},
};

// ---------------------------------------------------------------------------
// 关键词 / 页面级指标明细（约 30 行，两面都有）
// ---------------------------------------------------------------------------

/**
 * 指标明细的**紧凑行**（口径照 `PromptSeedRow` / `KeywordSeedRow`）：
 * 只写"这一行的事实"（源、面、维度、四个数字），`id` / `project_id` / 区间 / 截至日 /
 * `imported_at` / `completeness` / `window_source` / `mapping_version` 由下面的纯函数从
 * `WINDOW_BY_SOURCE` 推导——**同一个源的一批数据共享一个窗口**，逐行抄七遍只会抄错。
 *
 * 🔴 `impressions` / `clicks` / `ctr` / `citations` **必须手写字面量**：
 * §5.2 第 1 条要判"`ctr == clicks / impressions`"，由代码算出来就是永真断言。
 * 🔴 `null` 与 `0` 不许互换（DR-94）："平台没给这一列"与"这一列是 0"是两个结论。
 */
interface MetricSeedRow {
  source_kind: SearchSourceKind;
  surface: SearchSurface;
  query: string;
  page_url: string | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  citations: number | null;
  ai_clicks: number | null;
}

const METRIC_ROWS: readonly MetricSeedRow[] = [
  // ---- 百度《AI 流量分析》· AI 引用热门关键词（7 行，`surface: ai_answer`）----
  // 🔴 这四个数字的口径：`impressions` = AI曝光量、`clicks` = AI点击量、`citations` = AI引用量，
  // 而平台那个「AI点击率」= 点击量 ÷ **引用量**（不是曝光量）⇒ 它只作 `ctr_check` 交叉校验，
  // 行上的 `ctr` 仍按 `clicks ÷ impressions` 重算（§5.2 第 1 条），两者的差就是导入时那条 warning。
  { source_kind: 'baidu_ziyuan_ai', surface: 'ai_answer', query: '工业除尘器', page_url: `${SEED_SITE_DOMAIN}/`, impressions: 1420, clicks: 88, ctr: 0.062, citations: 320, ai_clicks: null },
  { source_kind: 'baidu_ziyuan_ai', surface: 'ai_answer', query: '布袋除尘器厂家', page_url: `${SEED_SITE_DOMAIN}/products/bag-filter`, impressions: 1180, clicks: 71, ctr: 0.0602, citations: 265, ai_clicks: null },
  { source_kind: 'baidu_ziyuan_ai', surface: 'ai_answer', query: '脉冲布袋除尘器参数', page_url: `${SEED_SITE_DOMAIN}/products/bag-filter`, impressions: 690, clicks: 39, ctr: 0.0565, citations: 148, ai_clicks: null },
  // 🔴 规则 3（`ai_citation_gap`）的 AI 面那一半：传统面这个词有 41 次点击，AI 面**引用量 0**。
  { source_kind: 'baidu_ziyuan_ai', surface: 'ai_answer', query: '锅炉烟气除尘改造', page_url: `${SEED_SITE_DOMAIN}/news/dust-retrofit-case`, impressions: 96, clicks: 3, ctr: 0.0313, citations: 0, ai_clicks: null },
  // 🔴 规则 5（`crawl_blocked_with_demand`）点名的那一页（`demo-site-page-004`，`crawlable: false`）。
  { source_kind: 'baidu_ziyuan_ai', surface: 'ai_answer', query: '除尘器滤筒更换周期', page_url: `${SEED_SITE_DOMAIN}/service`, impressions: 410, clicks: 21, ctr: 0.0512, citations: 62, ai_clicks: null },
  // 🔴 规则 2（`demand_without_content`）：这个词**不在** `seed/keywords.ts` 的词面里，站内也没有主题页。
  { source_kind: 'baidu_ziyuan_ai', surface: 'ai_answer', query: '除尘器防爆合格证怎么办', page_url: null, impressions: 205, clicks: 6, ctr: 0.0293, citations: 15, ai_clicks: null },
  // 🔴 规则 6（`trend_divergence`）的品牌词那一半。
  { source_kind: 'baidu_ziyuan_ai', surface: 'ai_answer', query: '澜舟除尘设备怎么样', page_url: `${SEED_SITE_DOMAIN}/`, impressions: 505, clicks: 34, ctr: 0.0673, citations: 88, ai_clicks: null },

  // ---- 百度站长平台 · 传统搜索（6 行，`surface: web_search`）----
  { source_kind: 'baidu_ziyuan', surface: 'web_search', query: '工业除尘器', page_url: `${SEED_SITE_DOMAIN}/`, impressions: 4820, clicks: 173, ctr: 0.0359, citations: null, ai_clicks: null },
  { source_kind: 'baidu_ziyuan', surface: 'web_search', query: '布袋除尘器厂家', page_url: `${SEED_SITE_DOMAIN}/products/bag-filter`, impressions: 3160, clicks: 122, ctr: 0.0386, citations: null, ai_clicks: null },
  // 🔴 规则 3 的传统面那一半：有点击（41 > 0），而 AI 面引用量为 0。
  { source_kind: 'baidu_ziyuan', surface: 'web_search', query: '锅炉烟气除尘改造', page_url: `${SEED_SITE_DOMAIN}/news/dust-retrofit-case`, impressions: 890, clicks: 41, ctr: 0.0461, citations: null, ai_clicks: null },
  { source_kind: 'baidu_ziyuan', surface: 'web_search', query: '除尘器防爆合格证怎么办', page_url: `${SEED_SITE_DOMAIN}/qualification`, impressions: 640, clicks: 9, ctr: 0.0141, citations: null, ai_clicks: null },
  { source_kind: 'baidu_ziyuan', surface: 'web_search', query: '车间粉尘治理方案', page_url: `${SEED_SITE_DOMAIN}/service`, impressions: 1240, clicks: 18, ctr: 0.0145, citations: null, ai_clicks: null },
  // 🔴 规则 4（`landing_role_mismatch`）：改造意图的词落在 `role: news` 的案例页上。
  { source_kind: 'baidu_ziyuan', surface: 'web_search', query: '水泥厂除尘改造方案', page_url: `${SEED_SITE_DOMAIN}/news/dust-retrofit-case`, impressions: 1060, clicks: 33, ctr: 0.0311, citations: null, ai_clicks: null },

  // ---- 头条搜索（3 行，🔴 8 月那一批，已过期）----
  { source_kind: 'toutiao', surface: 'web_search', query: '工业除尘器', page_url: `${SEED_SITE_DOMAIN}/`, impressions: 960, clicks: 27, ctr: 0.0281, citations: null, ai_clicks: null },
  { source_kind: 'toutiao', surface: 'web_search', query: '布袋除尘器厂家', page_url: `${SEED_SITE_DOMAIN}/products/bag-filter`, impressions: 540, clicks: 16, ctr: 0.0296, citations: null, ai_clicks: null },
  { source_kind: 'toutiao', surface: 'web_search', query: '车间粉尘治理方案', page_url: `${SEED_SITE_DOMAIN}/service`, impressions: 305, clicks: 7, ctr: 0.023, citations: null, ai_clicks: null },

  // ---- Google Search Console（5 行，🔴 `sampled` 且截至日早 3 天）----
  { source_kind: 'gsc', surface: 'web_search', query: 'bag filter dust collector', page_url: `${SEED_SITE_DOMAIN}/products/bag-filter`, impressions: 2140, clicks: 61, ctr: 0.0285, citations: null, ai_clicks: null },
  { source_kind: 'gsc', surface: 'web_search', query: 'industrial dust collection system', page_url: `${SEED_SITE_DOMAIN}/`, impressions: 1580, clicks: 44, ctr: 0.0278, citations: null, ai_clicks: null },
  { source_kind: 'gsc', surface: 'web_search', query: 'dust collector filter replacement', page_url: `${SEED_SITE_DOMAIN}/service`, impressions: 620, clicks: 19, ctr: 0.0306, citations: null, ai_clicks: null },
  { source_kind: 'gsc', surface: 'web_search', query: 'cement plant dust control retrofit', page_url: `${SEED_SITE_DOMAIN}/news/dust-retrofit-case`, impressions: 410, clicks: 15, ctr: 0.0366, citations: null, ai_clicks: null },
  { source_kind: 'gsc', surface: 'web_search', query: 'pulse jet bag filter specifications', page_url: `${SEED_SITE_DOMAIN}/products/bag-filter`, impressions: 355, clicks: 12, ctr: 0.0338, citations: null, ai_clicks: null },

  // ---- Bing Webmaster Tools（3 行）----
  { source_kind: 'bing_wmt', surface: 'web_search', query: 'bag filter dust collector', page_url: `${SEED_SITE_DOMAIN}/products/bag-filter`, impressions: 480, clicks: 17, ctr: 0.0354, citations: null, ai_clicks: null },
  { source_kind: 'bing_wmt', surface: 'web_search', query: 'industrial dust extractor', page_url: `${SEED_SITE_DOMAIN}/`, impressions: 265, clicks: 8, ctr: 0.0302, citations: null, ai_clicks: null },
  { source_kind: 'bing_wmt', surface: 'web_search', query: 'dust collector maintenance service', page_url: `${SEED_SITE_DOMAIN}/service`, impressions: 140, clicks: 5, ctr: 0.0357, citations: null, ai_clicks: null },

  // ---- 百度统计（3 行，🔴 站内分析：A 类指标全 `null`，会话数只在 C 类留档里）----
  // DR-95 C 类 + DR-110 护栏 2：量纲是会话，规范列里**没有** `sessions` 这个落库位 ⇒
  // 用 0 顶替就等于把它混进曝光合计（DR-94："没有这一列"与"这一列是 0"是两个结论）。
  { source_kind: 'baidu_tongji', surface: 'web_search', query: '工业除尘器', page_url: `${SEED_SITE_DOMAIN}/`, impressions: null, clicks: null, ctr: null, citations: null, ai_clicks: null },
  { source_kind: 'baidu_tongji', surface: 'web_search', query: '布袋除尘器厂家', page_url: `${SEED_SITE_DOMAIN}/products/bag-filter`, impressions: null, clicks: null, ctr: null, citations: null, ai_clicks: null },
  { source_kind: 'baidu_tongji', surface: 'web_search', query: '车间粉尘治理方案', page_url: `${SEED_SITE_DOMAIN}/service`, impressions: null, clicks: null, ctr: null, citations: null, ai_clicks: null },

  // ---- 人工填报（3 行，兜底渠道）----
  { source_kind: 'manual', surface: 'web_search', query: '澜舟除尘设备怎么样', page_url: `${SEED_SITE_DOMAIN}/`, impressions: 210, clicks: 12, ctr: 0.0571, citations: null, ai_clicks: null },
  { source_kind: 'manual', surface: 'web_search', query: '除尘器环保验收标准', page_url: `${SEED_SITE_DOMAIN}/qualification`, impressions: 180, clicks: 7, ctr: 0.0389, citations: null, ai_clicks: null },
  { source_kind: 'manual', surface: 'web_search', query: '苏州除尘设备生产厂家', page_url: `${SEED_SITE_DOMAIN}/about`, impressions: 95, clicks: 4, ctr: 0.0421, citations: null, ai_clicks: null },
];

/** 紧凑行 → `SearchQueryMetric`（`id` 由下标推导，稳定字面量 `demo-sqm-001` …）。 */
function metricOf(row: MetricSeedRow, index: number): SearchQueryMetric {
  const window = WINDOW_BY_SOURCE[row.source_kind];
  if (window === undefined) {
    // 🔴 编译期兜不到的那一格（`Partial`）：种子写错就在**模块加载时**炸，不要端出半份数据。
    throw new Error(`missing metric window: ${row.source_kind}`);
  }
  return {
    id: `demo-sqm-${String(index + 1).padStart(3, '0')}`,
    project_id: SEED_ACTIVE_PROJECT_ID,
    source_kind: row.source_kind,
    surface: row.surface,
    query: row.query,
    page_url: row.page_url,
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.ctr,
    citations: row.citations,
    ai_clicks: row.ai_clicks,
    period_start: window.period_start,
    period_end: window.period_end,
    data_through: window.data_through,
    imported_at: window.imported_at,
    completeness: window.completeness,
    window_source: window.window_source,
    mapping_version: MAPPING_VERSION,
  };
}

export const SEED_SEARCH_QUERY_METRICS: SearchQueryMetric[] = METRIC_ROWS.map(metricOf);

// ---------------------------------------------------------------------------
// AI 引用表现的项目级汇总（百度《AI 流量分析》那五项）
// ---------------------------------------------------------------------------

/**
 * 🔴 `ai_ctr` 的分母是**引用量**、不是曝光量（百度官方口径，§3.7 结论 4）：
 * `348 ÷ 1264 = 0.2753`。写成 `348 ÷ 6106`（曝光量）得 0.057，界面上就是**差五倍**的一个数——
 * 这是全份种子里最容易写错的一处，所以 §5.2 第 2 条单独钉它。
 * 🔴 `citations` 1264 > 热门关键词表那 7 行的 898：概览段是**全站**口径，
 * 热门关键词表只是它的一个切片（两者不该相等，相等反而说明抄错了）。
 */
export const SEED_SEARCH_AI_OVERVIEWS: SearchAiOverview[] = [
  {
    id: 'demo-sao-001', project_id: SEED_ACTIVE_PROJECT_ID, source_kind: 'baidu_ziyuan_ai',
    citations: 1264, ai_impressions: 6106, ai_clicks: 348, ai_ctr: 0.2753, cited_pages: 37,
    period_start: SEED_SEARCH_PERIOD_START, period_end: SEED_SEARCH_PERIOD_END,
    data_through: SEED_SEARCH_DATA_THROUGH, imported_at: '2026-09-28T01:20:00Z',
    completeness: 'partial', window_source: 'user_stated', mapping_version: MAPPING_VERSION,
  },
];

// ---------------------------------------------------------------------------
// C 类：映射不上的平台原生字段，原样留档（DR-107）
// ---------------------------------------------------------------------------

/**
 * 🔴 `label` 是**平台原文列名**（数据，不是文案），`value` 是归一后的取值。
 * 三类都在（§5.2 的要求）：Bing 的 `Grounding Queries`、百度《AI 流量分析》的「引用页面量」、
 * 百度统计的「会话数」；另外两条是映射表文件头点名的"刻意不映射"（百度传统面的「平均排名」、
 * GSC 的 `Position`）——位次只以**带**的形态存在于自建索引（DR-118），不塞进指标表伪装成同量纲。
 * `metric_id: null` = 表级留档（不属于某个 query / page）。
 */
export const SEED_SEARCH_NATIVE_EXTRAS: SearchNativeExtra[] = [
  { id: 'demo-sne-001', project_id: SEED_ACTIVE_PROJECT_ID, source_kind: 'bing_wmt', label: 'Grounding Queries', value: 128, metric_id: null, observed_at: '2026-09-28T01:34:00Z' },
  { id: 'demo-sne-002', project_id: SEED_ACTIVE_PROJECT_ID, source_kind: 'bing_wmt', label: 'Grounding Queries', value: 46, metric_id: 'demo-sqm-022', observed_at: '2026-09-28T01:34:00Z' },
  { id: 'demo-sne-003', project_id: SEED_ACTIVE_PROJECT_ID, source_kind: 'baidu_ziyuan_ai', label: '引用页面量', value: 37, metric_id: null, observed_at: '2026-09-28T01:20:00Z' },
  { id: 'demo-sne-004', project_id: SEED_ACTIVE_PROJECT_ID, source_kind: 'baidu_ziyuan', label: '平均排名', value: 8.4, metric_id: 'demo-sqm-008', observed_at: '2026-09-28T01:24:00Z' },
  { id: 'demo-sne-005', project_id: SEED_ACTIVE_PROJECT_ID, source_kind: 'gsc', label: 'Position', value: 12.6, metric_id: 'demo-sqm-017', observed_at: '2026-09-27T01:30:00Z' },
  { id: 'demo-sne-006', project_id: SEED_ACTIVE_PROJECT_ID, source_kind: 'baidu_tongji', label: '会话数', value: 412, metric_id: 'demo-sqm-025', observed_at: '2026-09-28T01:40:00Z' },
  { id: 'demo-sne-007', project_id: SEED_ACTIVE_PROJECT_ID, source_kind: 'baidu_tongji', label: '会话数', value: 188, metric_id: 'demo-sqm-026', observed_at: '2026-09-28T01:40:00Z' },
  { id: 'demo-sne-008', project_id: SEED_ACTIVE_PROJECT_ID, source_kind: 'baidu_tongji', label: '会话数', value: 96, metric_id: 'demo-sqm-027', observed_at: '2026-09-28T01:40:00Z' },
];

// ---------------------------------------------------------------------------
// 6 条优化机会（DR-100，🔴 demo 里手工写死、每条规则恰好一条）
// ---------------------------------------------------------------------------

/**
 * 🔴 **不是算出来的**（DR-99 / E-68）：6 条规则的判定是 `geo-domain` 纯函数，demo 只端静态清单，
 * 翻状态不重算、导入也不会长出新机会；界面必须常驻 `webmasterData.staticNote` 说清这件事。
 * `basis` 里的每个数字都**手工对得上** `evidence_metric_ids` 指向的那几行（§5.2 第 6 … 9 条钉住）。
 * `confidence` 刻意跨过 `REVIEW_CONFIDENCE_FLOOR = 0.75` 两侧（DR-100：不新造第二套置信度口径），
 * 好让"进不进复核队列"这道门槛在界面上走得查。
 */
export const SEED_SEARCH_OPPORTUNITIES: SearchOpportunity[] = [
  {
    id: 'demo-sop-001', project_id: SEED_ACTIVE_PROJECT_ID, rule_id: 1,
    title_key: 'webmasterData.rules.high_impression_low_ctr.name',
    basis: '「工业除尘器」在百度传统面与头条两个平台合计 5780 次曝光、200 次点击，重算点击率 3.46%；同一批词在自建索引里的位次带是 top3 ~ top10，本站同位次经验区间的下界比它高。',
    evidence_metric_ids: ['demo-sqm-008', 'demo-sqm-014'],
    prescription_category: 'site_structure', impact: 'high', difficulty: 'low',
    confidence: 0.82, status: 'new',
    created_at: '2026-09-28T02:20:00Z', updated_at: '2026-09-28T02:20:00Z',
  },
  {
    id: 'demo-sop-002', project_id: SEED_ACTIVE_PROJECT_ID, rule_id: 2,
    title_key: 'webmasterData.rules.demand_without_content.name',
    basis: '「除尘器防爆合格证怎么办」9 月在百度传统面有 640 次曝光、9 次点击，AI 面也有 15 次引用；但关键词库里没有这个词，站内也没有承接它的主题页（现有资质页只列证书、不答"怎么办"）。',
    evidence_metric_ids: ['demo-sqm-011', 'demo-sqm-006'],
    prescription_category: 'content_production', impact: 'medium', difficulty: 'medium',
    confidence: 0.71, status: 'new',
    created_at: '2026-09-28T02:22:00Z', updated_at: '2026-09-28T02:22:00Z',
  },
  {
    id: 'demo-sop-003', project_id: SEED_ACTIVE_PROJECT_ID, rule_id: 3,
    title_key: 'webmasterData.rules.ai_citation_gap.name',
    basis: '「锅炉烟气除尘改造」在传统面有 890 次曝光、41 次点击（落地页是那篇水泥厂改造案例），而在百度《AI 流量分析》里引用量为 0：真实需求已经存在，AI 答案里却没有我们。',
    evidence_metric_ids: ['demo-sqm-010', 'demo-sqm-004'],
    prescription_category: 'source_layout', impact: 'high', difficulty: 'medium',
    confidence: 0.88, status: 'new',
    created_at: '2026-09-28T02:24:00Z', updated_at: '2026-09-28T02:24:00Z',
  },
  {
    id: 'demo-sop-004', project_id: SEED_ACTIVE_PROJECT_ID, rule_id: 4,
    title_key: 'webmasterData.rules.landing_role_mismatch.name',
    basis: '「水泥厂除尘改造方案」与 cement plant dust control retrofit 合计 1470 次曝光全部落在 /news/dust-retrofit-case（页面角色 news）；同族的 product 角色页 /products/bag-filter 在这两个词上没有曝光，改造意图的量没有落到能承接转化的页面上。',
    evidence_metric_ids: ['demo-sqm-013', 'demo-sqm-020'],
    prescription_category: 'site_structure', impact: 'medium', difficulty: 'high',
    confidence: 0.79, status: 'adopted',
    created_at: '2026-09-28T02:26:00Z', updated_at: '2026-09-29T01:10:00Z',
  },
  {
    id: 'demo-sop-005', project_id: SEED_ACTIVE_PROJECT_ID, rule_id: 5,
    title_key: 'webmasterData.rules.crawl_blocked_with_demand.name',
    basis: '售后服务页 /service 在 9 月合计 2410 次曝光（百度传统面 1240、GSC 620、百度 AI 面 410、Bing 140），而站点接入的页面清单里这一页 crawlable = false；自建索引三轮快照的 robots_ok 也都是 false。',
    evidence_metric_ids: ['demo-sqm-012', 'demo-sqm-019', 'demo-sqm-005', 'demo-sqm-024'],
    prescription_category: 'site_structure', impact: 'high', difficulty: 'low',
    confidence: 0.91, status: 'new',
    created_at: '2026-09-28T02:28:00Z', updated_at: '2026-09-28T02:28:00Z',
  },
  {
    id: 'demo-sop-006', project_id: SEED_ACTIVE_PROJECT_ID, rule_id: 6,
    title_key: 'webmasterData.rules.trend_divergence.name',
    basis: '品牌词「澜舟除尘设备怎么样」9 月合计曝光 715 次（人工填报 210 + 百度 AI 面 505），而 M3 第 2 → 3 轮的品牌覆盖率从 42% 升到 55%：自有覆盖率涨了，站外品牌需求没有跟着涨，两条曲线方向不一致。',
    evidence_metric_ids: ['demo-sqm-028', 'demo-sqm-007'],
    prescription_category: 'source_layout', impact: 'medium', difficulty: 'medium',
    confidence: 0.68, status: 'ignored',
    created_at: '2026-09-28T02:30:00Z', updated_at: '2026-09-29T01:12:00Z',
  },
];

// ---------------------------------------------------------------------------
// 站点自建索引的关键性采样（DR-118，🔴 本轮只读）
// ---------------------------------------------------------------------------

/**
 * 三块采样面各几行、跨 M3 的三轮（基线 / 复测 / 上线）。
 * 🔴 边界：**不建全网索引、不估曝光、不做点击流**——只存对本站点观测到的快照；
 * 自有索引**没有点击**、算不出 CTR，界面上不许把它与 CTR 混成一条曲线（DR-118 ↔ DR-115）。
 * 🔴 SERP 只记**位次带**（`top3|top10|top30|absent`），不记精确名次：一次采样支撑不了精确值。
 * 🔴 `snippet_hash` / `title_hash` 是定长（16 位十六进制）不可逆指纹，**不存原文**；
 * `snippet_hash` 只在 `cited === true` 时非空（没被引用就没有"被引的那一段"）。
 */
export const SEED_SELF_INDEX_SNAPSHOTS: SelfIndexSnapshot[] = [
  // ---- 第 2 轮 · 基线体检（2026-09-16）----
  { id: 'demo-sis-001', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'ai_citation', key: '什么是脉冲布袋除尘器，它和普通布袋除尘器有什么区别？', engine: 'doubao', surface: 'ai_answer', cited: true, cite_position_band: 'top3', rank_band: null, snippet_hash: 'a3f1c07d92b4e516', title_hash: '1c8e40b7d5a29f63', robots_ok: null, canonical_ok: null, schema_types: null, observed_at: '2026-09-16T02:20:00Z', round_id: SEED_BASELINE_ROUND_ID },
  { id: 'demo-sis-002', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'ai_citation', key: '澜舟和清源环保的布袋除尘器在滤料上有什么不同？', engine: 'deepseek', surface: 'ai_answer', cited: false, cite_position_band: null, rank_band: null, snippet_hash: null, title_hash: '7d2b90f4c1e68a35', robots_ok: null, canonical_ok: null, schema_types: null, observed_at: '2026-09-16T02:22:00Z', round_id: SEED_BASELINE_ROUND_ID },
  { id: 'demo-sis-003', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'page_indexability', key: `${SEED_SITE_DOMAIN}/service`, engine: 'baidu_ziyuan', surface: null, cited: null, cite_position_band: null, rank_band: null, snippet_hash: null, title_hash: 'b60f21a8d4c73e95', robots_ok: false, canonical_ok: true, schema_types: [], observed_at: '2026-09-16T02:24:00Z', round_id: SEED_BASELINE_ROUND_ID },
  { id: 'demo-sis-004', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'serp_rank_band', key: '工业除尘器', engine: 'baidu_ziyuan', surface: 'web_search', cited: null, cite_position_band: null, rank_band: 'top10', snippet_hash: null, title_hash: 'e94a17c3f80b52d6', robots_ok: null, canonical_ok: null, schema_types: null, observed_at: '2026-09-16T02:26:00Z', round_id: SEED_BASELINE_ROUND_ID },
  { id: 'demo-sis-005', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'serp_rank_band', key: 'bag filter dust collector', engine: 'gsc', surface: 'web_search', cited: null, cite_position_band: null, rank_band: 'top30', snippet_hash: null, title_hash: '5f38d0b2a7c14e96', robots_ok: null, canonical_ok: null, schema_types: null, observed_at: '2026-09-16T02:28:00Z', round_id: SEED_BASELINE_ROUND_ID },

  // ---- 第 3 轮 · 行动后复测（2026-09-23）----
  { id: 'demo-sis-006', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'ai_citation', key: '什么是脉冲布袋除尘器，它和普通布袋除尘器有什么区别？', engine: 'doubao', surface: 'ai_answer', cited: true, cite_position_band: 'top3', rank_band: null, snippet_hash: 'c70e53b9a1d42f86', title_hash: '1c8e40b7d5a29f63', robots_ok: null, canonical_ok: null, schema_types: null, observed_at: '2026-09-23T02:14:00Z', round_id: SEED_RETEST_ROUND_ID },
  { id: 'demo-sis-007', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'ai_citation', key: '澜舟和清源环保的布袋除尘器在滤料上有什么不同？', engine: 'deepseek', surface: 'ai_answer', cited: true, cite_position_band: 'top10', rank_band: null, snippet_hash: '92b7f41c6e08a3d5', title_hash: '7d2b90f4c1e68a35', robots_ok: null, canonical_ok: null, schema_types: null, observed_at: '2026-09-23T02:16:00Z', round_id: SEED_RETEST_ROUND_ID },
  { id: 'demo-sis-008', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'page_indexability', key: `${SEED_SITE_DOMAIN}/service`, engine: 'baidu_ziyuan', surface: null, cited: null, cite_position_band: null, rank_band: null, snippet_hash: null, title_hash: 'b60f21a8d4c73e95', robots_ok: false, canonical_ok: true, schema_types: [], observed_at: '2026-09-23T02:18:00Z', round_id: SEED_RETEST_ROUND_ID },
  { id: 'demo-sis-009', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'serp_rank_band', key: '工业除尘器', engine: 'baidu_ziyuan', surface: 'web_search', cited: null, cite_position_band: null, rank_band: 'top3', snippet_hash: null, title_hash: 'e94a17c3f80b52d6', robots_ok: null, canonical_ok: null, schema_types: null, observed_at: '2026-09-23T02:20:00Z', round_id: SEED_RETEST_ROUND_ID },

  // ---- 第 4 轮 · 上线（2026-09-28）----
  { id: 'demo-sis-010', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'ai_citation', key: '工业除尘设备主要分成哪几类，各自适用什么工况？', engine: 'doubao', surface: 'ai_answer', cited: true, cite_position_band: 'top10', rank_band: null, snippet_hash: '4e8a20d7c3b51f96', title_hash: 'a05c93e8b17d24f6', robots_ok: null, canonical_ok: null, schema_types: null, observed_at: '2026-09-28T02:04:00Z', round_id: SEED_LIVE_ROUND_ID },
  { id: 'demo-sis-011', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'ai_citation', key: '采购工业除尘设备时，厂家资质要看哪几项？', engine: 'qwen', surface: 'ai_answer', cited: false, cite_position_band: null, rank_band: null, snippet_hash: null, title_hash: 'd31f67b0a9c42e85', robots_ok: null, canonical_ok: null, schema_types: null, observed_at: '2026-09-28T02:06:00Z', round_id: SEED_LIVE_ROUND_ID },
  { id: 'demo-sis-012', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'page_indexability', key: `${SEED_SITE_DOMAIN}/qualification`, engine: 'gsc', surface: null, cited: null, cite_position_band: null, rank_band: null, snippet_hash: null, title_hash: 'f82b04c6e19a7d53', robots_ok: true, canonical_ok: true, schema_types: ['Organization'], observed_at: '2026-09-28T02:08:00Z', round_id: SEED_LIVE_ROUND_ID },
  { id: 'demo-sis-013', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'serp_rank_band', key: 'bag filter dust collector', engine: 'gsc', surface: 'web_search', cited: null, cite_position_band: null, rank_band: 'top10', snippet_hash: null, title_hash: '5f38d0b2a7c14e96', robots_ok: null, canonical_ok: null, schema_types: null, observed_at: '2026-09-28T02:10:00Z', round_id: SEED_LIVE_ROUND_ID },
  { id: 'demo-sis-014', project_id: SEED_ACTIVE_PROJECT_ID, kind: 'serp_rank_band', key: '车间粉尘治理方案', engine: 'baidu_ziyuan', surface: 'web_search', cited: null, cite_position_band: null, rank_band: 'absent', snippet_hash: null, title_hash: '6b19e4d0f7a23c85', robots_ok: null, canonical_ok: null, schema_types: null, observed_at: '2026-09-28T02:12:00Z', round_id: SEED_LIVE_ROUND_ID },
];

// ---------------------------------------------------------------------------
// 客户自己的流量来源分布（DR-111 `suggestSources` 的输入）
// ---------------------------------------------------------------------------

/**
 * 🔴 **这是这个客户的分布，不是市场份额表**（DR-111 明令禁止内置默认推荐：
 * 同一时期百度份额有 38.1% 与 53.32% 两种口径，任何写死的假设都会在某个客户身上错得离谱）。
 * 数据来自百度统计「来源分析」那一份的归类，三项之和为 1（§5.2 第 14 条）。
 * 🔴 刻意**不含** `sogou` / `so_360` / `other`：这个客户的量确实不在这几家，
 * 而"覆盖全部 7 个引擎"恰恰是市场份额表才有的形状（判据据此把两种东西区分开）。
 */
export const SEED_SEARCH_TRAFFIC_SPLIT: SearchTrafficShareRow[] = [
  { project_id: SEED_ACTIVE_PROJECT_ID, engine: 'baidu', share: 0.62 },
  { project_id: SEED_ACTIVE_PROJECT_ID, engine: 'google', share: 0.21 },
  { project_id: SEED_ACTIVE_PROJECT_ID, engine: 'toutiao', share: 0.17 },
];

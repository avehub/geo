/**
 * 站长数据（M5.5 站外真相层）的 IPC 契约类型。
 * 设计规格 `docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md`（DR-90 … DR-118）。
 *
 * # 口径来自哪里
 * 客户自己后台里的曝光、点击与 AI 引用（百度《AI 流量分析》/ 头条 / GSC / Bing / 百度统计）是
 * **平台第一方事实**，与 M3 我们自己去问 AI 引擎得到的**抽样估计**是两种证据。本轮把前者接进来、
 * 跨平台归一汇总（DR-95 的 A / B / C 三层），再与后者对账（DR-116）。
 *
 * # 🔴 三层数据流（DR-90 二次重定位）
 * L1 自有抽样（`geo-crawler`，全自动）+ L2 官方接口（三家 OAuth，全自动）是**主喂料**；
 * L3 控制台导出 / 粘贴 / 填报是**对账层**。`SelfIndexSnapshot` 是 L1 的时间序列化（DR-118），
 * `SearchQueryMetric` / `SearchAiOverview` 是 L2 + L3 的落点。
 *
 * # 🔴 demo 的边界（规则 9 / 规则 2 / 规则 11，DR-99 / DR-114）
 * 映射查表、A 类求和、B 类重算、筛选、交集区间、陈旧与采样判定在前端 compose 层**真做**；
 * DR-100 那 6 条规则的**判定**是 `geo-domain` 纯函数，demo 只端静态机会清单；
 * `search_source_test` **不联网**、OAuth 一条都没实现（`credentials_state` 恒不为 `stored`）；
 * **不做模拟登录**：没有官方接口的源，自动化程度就到 `paste_parse` 为止。
 *
 * # 不新造第二套枚举（DR-94）
 * `status` 复用 `SiteChannelStatus`、`credentials_state` 复用 `SiteCredentialsState`、
 * `prescription_category` 复用 `ActionCategory`、`impact` / `difficulty` 复用 `ActionLevel`
 * （机会与处方同一套分类词，界面上能直接对齐）、`engine` 复用 M3 的 `EngineId`。
 *
 * # 合规（规则 6）
 * 机会与基准的文案禁用绝对化用语；外部 CTR 曲线只作冷启动参考带且必须标出处
 * （DR-115，数据在 `api/search-benchmark.ts`，默认不参与判定）。
 */
import type { AssertComplete, ValuesAreComplete } from './completeness';
import type { SearchTableError, SearchTableWarning } from './search-paste';
import type { ActionCategory, ActionLevel } from './types-action';
import type { EngineId } from './types-collection';
import type { CheckDetail, SiteChannelStatus, SiteCredentialsState } from './types-site';

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/**
 * 9 个数据源（DR-92）。🔴 三个刻意的决定：
 * `baidu_ziyuan_ai` 与 `baidu_ziyuan` 拆成**两个源**（AI 面与传统面的指标集、更新节奏、导出形态
 * 都不同，合成一个会让导入模板变成"可选列大杂烩"）；`sogou` / `so_360` 是**二期**
 * （目录表 `phase: 2`，枚举与词典本轮建齐但界面不渲染入口，DR-108）；`manual` 是兜底。
 */
export type SearchSourceKind =
  | 'baidu_ziyuan_ai'
  | 'baidu_ziyuan'
  | 'toutiao'
  | 'gsc'
  | 'bing_wmt'
  | 'sogou'
  | 'so_360'
  | 'baidu_tongji'
  | 'manual';

export const SEARCH_SOURCE_VALUES = [
  'baidu_ziyuan_ai',
  'baidu_ziyuan',
  'toutiao',
  'gsc',
  'bing_wmt',
  'sogou',
  'so_360',
  'baidu_tongji',
  'manual',
] as const satisfies readonly SearchSourceKind[];

/**
 * 三分组（DR-92 / DR-104）。站长平台按 `region` 拆成国内 / 海外两段（组序即视觉权重），
 * 🔴 百度统计单独成 `analytics` 补充组：它是站内分析产品、量纲是会话，**永不进曝光合计**
 * （DR-110 护栏 2）。
 */
export type SearchGroup = 'webmaster_cn' | 'webmaster_global' | 'analytics';

export const SEARCH_GROUP_VALUES = [
  'webmaster_cn',
  'webmaster_global',
  'analytics',
] as const satisfies readonly SearchGroup[];

/**
 * 可达性区域（DR-104 的海外组要挂一句可达性常驻提示）。`both` 只有 `manual` 用。
 * ⚠ 词典 `webmasterData.regions` 只有 `cn` / `global` 两键 ⇒ `both` 由界面把两个标签并列渲染，
 * 不去查 `regions.both`（查了就是裸键上屏）。
 */
export type SearchRegion = 'cn' | 'global' | 'both';

export const SEARCH_REGION_VALUES = ['cn', 'global', 'both'] as const satisfies readonly SearchRegion[];

/**
 * 面（DR-94）：同一张指标表装传统搜索与 AI 搜索两种数据而不混淆。
 * 🔴 两个面的曝光**计数规则不同**（AI 面算"用户看到引用链接的次数"）⇒ A 类求和只在**同面内**做，
 * 跨面合计要显式选且带标注（DR-95）。
 */
export type SearchSurface = 'web_search' | 'ai_answer';

export const SEARCH_SURFACE_VALUES = [
  'web_search',
  'ai_answer',
] as const satisfies readonly SearchSurface[];

/**
 * 凭据形态（DR-113 的建模修正：与"数据怎么进来"是**两个正交维度**）。
 * 🔴 **没有** `simulated_login` 这一档（DR-114 / 规则 11）：我们不碰凭据、不代登录。
 */
export type SearchAuthMode = 'none' | 'oauth';

export const SEARCH_AUTH_MODE_VALUES = ['none', 'oauth'] as const satisfies readonly SearchAuthMode[];

/** 数据怎么进来（可多选；每个源支持哪几种由目录表决定，不是用户随便选，DR-93 / DR-113）。 */
export type SearchIngestMode = 'api' | 'file_import' | 'paste_parse' | 'manual_entry';

export const SEARCH_INGEST_MODE_VALUES = [
  'api',
  'file_import',
  'paste_parse',
  'manual_entry',
] as const satisfies readonly SearchIngestMode[];

/**
 * 完整性三值（DR-110）。🔴 非 `full` 的源**照样参与合计**，但合计行必须挂旗标：
 * 剔除会让合计忽大忽小（接了第三个源总数反而变小），比挂旗标更难解释。
 * `sampled` = GSC 每种搜索类型每天最多 5 万行、超出部分**静默采样**；
 * `partial` = 平台自陈不全（百度灰度期空白、头条新站延时、搜狗不支持目录级查询）。
 */
export type SearchCompleteness = 'full' | 'partial' | 'sampled';

export const SEARCH_COMPLETENESS_VALUES = [
  'full',
  'partial',
  'sampled',
] as const satisfies readonly SearchCompleteness[];

/**
 * 汇总区间是谁声明的（DR-98 / DR-109）。百度《AI 流量分析》的导出**没有日期列**
 * ⇒ 区间靠导入时确认（`user_stated`），文案写"区间由导入时确认"而不是"平台声明"。
 */
export type WindowSource = 'platform' | 'user_stated';

export const WINDOW_SOURCE_VALUES = ['platform', 'user_stated'] as const satisfies readonly WindowSource[];

/**
 * DR-100 那 6 条规则的序号。🔴 判定是 `geo-domain` 纯函数，demo 只端静态机会清单
 * （DR-99 / 规则 9）：导入数据**不会**长出新机会。
 */
export type SearchRuleId = 1 | 2 | 3 | 4 | 5 | 6;

export const SEARCH_RULE_ID_VALUES = [1, 2, 3, 4, 5, 6] as const satisfies readonly SearchRuleId[];

/**
 * 6 条规则的稳定名（== 词典 `webmasterData.rules.<key>` 的键名）。
 * 🔴 序号与名字两套都要：契约里 `rule_id` 是 1~6（规则表的 `#` 列），而词典与真后端用稳定名
 * ⇒ `SEARCH_RULE_KEY_BY_ID` 把两者钉在一起（`Record<SearchRuleId, …>` 本身就是穷尽性网），
 * 界面上不必自己数下标。
 */
export type SearchRuleKey =
  | 'high_impression_low_ctr'
  | 'demand_without_content'
  | 'ai_citation_gap'
  | 'landing_role_mismatch'
  | 'crawl_blocked_with_demand'
  | 'trend_divergence';

export const SEARCH_RULE_KEY_VALUES = [
  'high_impression_low_ctr',
  'demand_without_content',
  'ai_citation_gap',
  'landing_role_mismatch',
  'crawl_blocked_with_demand',
  'trend_divergence',
] as const satisfies readonly SearchRuleKey[];

export const SEARCH_RULE_KEY_BY_ID: Readonly<Record<SearchRuleId, SearchRuleKey>> = {
  1: 'high_impression_low_ctr',
  2: 'demand_without_content',
  3: 'ai_citation_gap',
  4: 'landing_role_mismatch',
  5: 'crawl_blocked_with_demand',
  6: 'trend_divergence',
};

/**
 * 机会生命周期三态。⚠ 与已落地词典 `webmasterData.opportunity.statuses` 的
 * `pending` / `adopted` / `dismissed` **对不上**（那份按 DR-94 旧命名写）：本契约是
 * `new` / `adopted` / `ignored` ⇒ 界面补两个键或加一张两行桥接表，**不要**在这里改名
 * （下游按本契约写）。
 */
export type SearchOpportunityStatus = 'new' | 'adopted' | 'ignored';

export const SEARCH_OPPORTUNITY_STATUS_VALUES = [
  'new',
  'adopted',
  'ignored',
] as const satisfies readonly SearchOpportunityStatus[];

/**
 * SERP **位次带**（DR-118）。🔴 只记带、不记精确名次：一次采样支撑不了精确名次，
 * 写成精确值就是假精确（规则 6 精神）。
 */
export type RankBand = 'top3' | 'top10' | 'top30' | 'absent';

export const RANK_BAND_VALUES = ['top3', 'top10', 'top30', 'absent'] as const satisfies readonly RankBand[];

/** 自建索引的三块采样面（DR-118）。 */
export type SelfIndexSnapshotKind = 'ai_citation' | 'page_indexability' | 'serp_rank_band';

export const SELF_INDEX_SNAPSHOT_KIND_VALUES = [
  'ai_citation',
  'page_indexability',
  'serp_rank_band',
] as const satisfies readonly SelfIndexSnapshotKind[];

/**
 * 快照观测的是哪个引擎：AI 面复用 M3 的 `EngineId`（`baidu_ai` / `doubao` / …），
 * 传统 SERP 面用 `SearchSourceKind`（`gsc` / `baidu_ziyuan` / …）。
 * 🔴 **不新造第三套引擎词表**；`import type` 只在类型层，运行期无依赖环。
 */
export type SelfIndexEngine = EngineId | SearchSourceKind;

/**
 * 站点绑定字段名（**非敏感**，DR-96）。🔴 凭据是**账号级**的、引用串刻意两段
 * `keyring://search/<kind>`；项目级只存这里的绑定值。键名 == 词典
 * `webmasterData.sourceCards.siteUrl` / `.siteId`。
 */
export type SearchBindingField = 'siteUrl' | 'siteId' | 'client_id';

export const SEARCH_BINDING_FIELD_VALUES = [
  'siteUrl',
  'siteId',
  'client_id',
] as const satisfies readonly SearchBindingField[];

/**
 * 站内分析给出的搜索引擎来源（百度统计「来源分析」那一份的归类，DR-111）。
 *
 * 🔴 `other` **不映射到任何源**：把"其它"猜成某个平台，正是 DR-111 禁止的内置默认推荐
 * （市场份额各来源差近一倍，猜必错）。
 * 🔴 这个枚举放在**契约**里而不是 compose 里，因为它是 `SearchBoardResult.traffic_split`
 * 的行形状 ⇒ 属于数据；把它算成建议的 `suggestSources`（函数）留在 `api/search-compose.ts`。
 */
export type SearchTrafficEngine =
  | 'baidu'
  | 'google'
  | 'bing'
  | 'toutiao'
  | 'sogou'
  | 'so_360'
  | 'other';

export const SEARCH_TRAFFIC_ENGINE_VALUES = [
  'baidu',
  'google',
  'bing',
  'toutiao',
  'sogou',
  'so_360',
  'other',
] as const satisfies readonly SearchTrafficEngine[];

// ---------------------------------------------------------------------------
// 对象
// ---------------------------------------------------------------------------

/** 一个已接入（或待接入）的数据源。形状照 `SiteChannel`（`api/types-site.ts`）。 */
export interface SearchSource {
  id: string;
  project_id: string;
  kind: SearchSourceKind;
  /** 凭据形态（与 `ingest_modes` 正交，DR-113）。 */
  auth_mode: SearchAuthMode;
  /** 这个源支持哪几种取数形态；由目录表决定（DR-93）。 */
  ingest_modes: SearchIngestMode[];
  /** 复用站点通道的四态（DR-94：不新造枚举）。 */
  status: SiteChannelStatus;
  region: SearchRegion;
  group: SearchGroup;
  /** 站点绑定（非敏感）。 */
  binding: Partial<Record<SearchBindingField, string>>;
  credentials_state: SiteCredentialsState;
  /**
   * 钥匙串引用串（`keyring://search/<kind>`，账号级两段，DR-96）。
   * 🔴 规则 3：库里只许有这个引用串，绝不含任何形密码 / token 的值。
   */
  secret_ref: string | null;
  /** 数据截至日（`YYYY-MM-DD`）；`null` = 还没有数据（导入意味着数据不新鲜，DR-90）。 */
  data_through: string | null;
  /** 最近一次自检时间；`null` = 没自检过。demo 不联网（规则 2）。 */
  checked_at: string | null;
  /** 自检结论（稳定 code + params；文案由前端 `checkDetails.<code>` 渲染）。 */
  check_detail: CheckDetail | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * `search_oauth_begin` 的返回值：前端把 `auth_url` 交给系统浏览器，
 * `redirect_uri` 是后端已绑定的 127.0.0.1 回环地址（仅用于排障 / 测试）。
 */
export interface SearchOAuthStart {
  auth_url: string;
  state: string;
  redirect_uri: string;
}

/**
 * `search_browser_open` 的返回体：系统 Chrome/Edge 的 CDP 会话。
 *
 * 🔴 只支持百度站长的两个面（传统 / AI 流量）。登录态留在 `profile_dir`
 * 这个**本机独立 profile** 里，不进数据库、不经 IPC 回传（AGENTS 规则 3 / 规则 11）。
 * `ws_url` 由前端保存后原样交给 `search_browser_capture`；Chrome 不随命令关闭。
 */
export interface SearchBrowserSession {
  /** CDP 浏览器级 WebSocket 地址（`/json/version` 的 `webSocketDebuggerUrl`）。 */
  ws_url: string;
  /** 本机独立 profile 目录（仅用于诊断显示，不是可上传的凭据）。 */
  profile_dir: string;
  /** 启动时打开的页面。 */
  target_url: string;
}

/**
 * 一行关键词 / 页面级指标（L2 接口或 L3 导入的落点）。
 *
 * 🔴 指标一律 `number | null`：百度 AI 那份给引用量不给位次，GSC 给位次不给引用量，
 * 头条给展现与点击不给 query。**用 0 顶替"平台没给这一列"在 GEO 语境里是致命的**
 * （"AI 引用量 0"与"没有这一列"是两个结论，DR-94）。`impressions` / `clicks` / `ctr` 三个键
 * **必在**（值可空）⇒ "这一行是哪种形状"由 `surface` 与 `source_kind` 决定，不由键的有无决定。
 */
export interface SearchQueryMetric {
  id: string;
  project_id: string;
  source_kind: SearchSourceKind;
  surface: SearchSurface;
  /** 关键词原文（数据）。按页面汇总的行可以是空串——那种行的维度在 `page_url`。 */
  query: string;
  page_url: string | null;
  impressions: number | null;
  clicks: number | null;
  /**
   * 平台自己给的点击率（B 类）。🔴 **只作交叉校验**：入库与展示一律按 `clicks ÷ impressions`
   * （AI 面按 `ai_clicks ÷ citations`）**重算**——三家的分母各不相同，对比率取平均没有任何解释
   * （DR-95 / DR-98）。
   */
  ctr: number | null;
  citations: number | null;
  ai_clicks: number | null;
  period_start: string;
  period_end: string;
  /** 数据截至日（`YYYY-MM-DD`）：汇总区间收敛到各源这个值的交集（DR-109）。 */
  data_through: string;
  imported_at: string;
  completeness: SearchCompleteness;
  window_source: WindowSource;
  /** 这一行是按哪一版映射表进来的（DR-107 的可审计性）。 */
  mapping_version: string;
}

/**
 * AI 引用表现的**项目级**快照（百度《AI 流量分析》那五项）。
 * 🔴 独立成对象而不并进 `SearchQueryMetric`：它是汇总值、没有 query 维度，塞进去就得让 query
 * 可空，而 query 可空的行会在关键词表里变成一个"空词"幽灵行（DR-94）。
 * 🔴 `ai_ctr` 的分母是**引用量**不是曝光量（百度官方口径）：全份数据里最容易写错的一个数。
 */
export interface SearchAiOverview {
  id: string;
  project_id: string;
  source_kind: SearchSourceKind;
  citations: number | null;
  /** 全站 AI 曝光量（百度《AI 流量分析》的「AI 曝光量」；不是热门词切片之和）。 */
  ai_impressions: number | null;
  ai_clicks: number | null;
  /** 重算值 = `ai_clicks ÷ citations`（B 类，绝不取各源平均）。 */
  ai_ctr: number | null;
  /** 引用页面量（C 类平台独有维度，单独展示并标注平台，DR-95）。 */
  cited_pages: number | null;
  period_start: string;
  period_end: string;
  data_through: string;
  imported_at: string;
  completeness: SearchCompleteness;
  window_source: WindowSource;
  mapping_version: string;
}

/**
 * 映射不上的**平台原生字段**原样留档（DR-107：静默丢弃是最坏的失败形态）。
 * 界面上作为 C 类"平台独有维度"渲染并标注平台（`webmasterData.nativePanel`）。
 * `label` 是平台原文列名（数据，不是文案）；`value` 是归一后的取值。
 */
export interface SearchNativeExtra {
  id: string;
  project_id: string;
  source_kind: SearchSourceKind;
  /** 平台原文列名（例：Bing 的 `Grounding Queries`、百度传统面的 `平均排名`）。 */
  label: string;
  value: string | number | null;
  /** 归属哪一行指标；`null` = 表级（不属于某个 query / page）。 */
  metric_id: string | null;
  observed_at: string;
}

/**
 * 一条自动开出的优化机会（DR-100 的 6 条规则之一）。
 * 🔴 demo 里是**手工写死的 6 条**（每规则一条），翻状态不重算、导入也不会长出新机会
 * （DR-99 / E-68）；界面常驻说明 `webmasterData.staticNote` 必须把这句话写进去。
 */
export interface SearchOpportunity {
  id: string;
  project_id: string;
  rule_id: SearchRuleId;
  /** 标题的 i18n key（`webmasterData.rules.<key>.name`）；🔴 种子与 compose 都不返回自然语言。 */
  title_key: string;
  /** 依据（数据级中文：把判据用到的数字摊开，照 `SitePatch.title` 的口径）。 */
  basis: string;
  /** 依据数字指向哪些指标行（种子自洽判据：每个 id 都必须存在，§5.2 第 6 条）。 */
  evidence_metric_ids: string[];
  /** 建议处方类别：复用 `ActionItem.category`（DR-94）。 */
  prescription_category: ActionCategory;
  impact: ActionLevel;
  difficulty: ActionLevel;
  /** 沿用 M4 的 `REVIEW_CONFIDENCE_FLOOR` 同一道门槛（DR-100：不新造第二套置信度口径）。 */
  confidence: number;
  status: SearchOpportunityStatus;
  created_at: string;
  updated_at: string;
}

/**
 * 站点自建索引的一条快照（DR-118 的**关键性采样**）。
 * 🔴 边界：不建全网索引、不估曝光、不做点击流；只存**对本站点观测到的**快照。
 * 🔴 自有索引**没有点击**、算不出 CTR ⇒ 界面上不许把它与 CTR 混成一条曲线（DR-118 ↔ DR-115）。
 */
export interface SelfIndexSnapshot {
  id: string;
  project_id: string;
  kind: SelfIndexSnapshotKind;
  /** 观测对象的键：`ai_citation` / `serp_rank_band` 是 query，`page_indexability` 是 page_url。 */
  key: string;
  engine: SelfIndexEngine;
  /** 只有 AI 面快照有值（传统 SERP 面没有"AI 回答"这一层）。 */
  surface: SearchSurface | null;
  /** `ai_citation`：这一轮有没有被引用。 */
  cited: boolean | null;
  /** `ai_citation`：引用位次**带**（同样是带，不是精确名次）。 */
  cite_position_band: RankBand | null;
  /** `serp_rank_band`：传统 SERP 的位次带。 */
  rank_band: RankBand | null;
  /** 摘要指纹（定长、不可逆）：判断"引用的还是不是同一段话"，不存原文。 */
  snippet_hash: string | null;
  title_hash: string | null;
  /** `page_indexability`：robots 是否放行。 */
  robots_ok: boolean | null;
  /** `page_indexability`：canonical 是否自指。 */
  canonical_ok: boolean | null;
  /** `page_indexability`：页面上检出的结构化数据类型（例：`FAQPage`）。 */
  schema_types: string[] | null;
  observed_at: string;
  /** 产出这条快照的那一轮采集（回指 M3 的 `CollectionRound.id`）。 */
  round_id: string;
}

/** 自建索引的覆盖情况（`search_board` 的读出口，DR-118：命令面不加）。 */
export interface SelfIndexSummary {
  /** 覆盖了多少个引擎（去重后的 `engine` 数）。 */
  engines_covered: number;
  /** 覆盖了多少个关键题（去重后的 `key` 数）。 */
  queries_covered: number;
  /** 最近一次观测时间；`null` = 还没跑过采集。 */
  last_run_at: string | null;
  /** 覆盖了多少轮（去重后的 `round_id` 数）。 */
  rounds_covered: number;
}

/**
 * 客户自己的**流量来源分布**的一行（DR-111 接入建议的唯一输入）。
 *
 * 🔴 这是"这个站点的访客从哪来"，**不是**市场份额表：真后端由 `analytics` 组
 * （百度统计 / 未来的 GA4）的来源分析算出，demo 侧由种子端出（没有真的百度统计连接）。
 * 🔴 三项之和为 1（§5.2 第 14 条的判据）；**空数组是合法且有意义的输入**——
 * 它意味着"没有 analytics 数据"，此时界面显示空态而**不是**一份通用推荐。
 */
export interface SearchTrafficShare {
  engine: SearchTrafficEngine;
  /** 占比（0~1）。 */
  share: number;
}

/**
 * 站长数据页首屏：源 + 明细 + AI 汇总 + C 类留档 + 机会 + 自建索引覆盖（一次往返，
 * 照 `site_board` / `action_board` 的取舍）。
 *
 * 🔴 **汇总不在这里**（DR-97 ④：刻意不加 `search_aggregate` 命令）——归一、求和、重算、筛选与
 * 区间收敛全在前端 `api/search-compose.ts` 做，demo 与桌面端共用同一份纯函数。
 * 🔴 `self_index_summary` 可空：还没跑过采集轮的项目回 `null`，界面显示空态而不是抛错。
 */
export interface SearchBoardResult {
  /**
   * “今天”的锚点（`YYYY-MM-DD`）。demo 固定为种子日期，真后端由命令端给出；
   * 页面用陈旧判定与预设区间都拿它做基准，不能各取一次系统时间（否则同一份数据
   * 在不同日期会得出不同的陈旧结论）。
   */
  as_of: string;
  sources: SearchSource[];
  metrics: SearchQueryMetric[];
  ai_overviews: SearchAiOverview[];
  native_extras: SearchNativeExtra[];
  opportunities: SearchOpportunity[];
  self_index_summary: SelfIndexSummary | null;
  /** L1 自有抽样的原始快照：`reconcile()` 的输入，命令面不另开读口（DR-118）。 */
  self_index_snapshots: SelfIndexSnapshot[];
  /**
   * 这个项目的流量来源分布（DR-111）。🔴 空数组 = 没有站内分析数据 ⇒ 界面**不显示建议**，
   * 而不是退化成内置的市场份额推荐。建议本身（`suggestSources`）在前端算，后端只给分布。
   */
  traffic_split: SearchTrafficShare[];
}

/**
 * 一次导入的结论（`search_metric_import_csv` 的返回体，DR-98）。
 *
 * 形状照 `CsvImportResult`（`api/types.ts`）的取舍：**入库的行 + 行级错误 + 行级警告**一起回，
 * 界面才能把"进了 28 行、其中 2 行带警告、第 5 行缺列没进"一句话说清。
 * 🔴 **行级容错**，不是整批回滚（照 `demo/handlers/prompt-csv.ts` 的真实口径）：坏行进 `errors`、
 * 好行照样入库；**一行都没进**才由 handler 抛稳定错误码（那边是 `prompt_set/empty_import`）。
 * 🔴 `warnings` 不阻断（DR-98）：平台自己给的 `AI点击率` 只作交叉校验，我们一律按重算值入库，
 * 灰度期平台口径本身可能在变，所以偏差只提示、不拦。
 * ⚠ 元素类型借自 `api/search-paste.ts`，且**只借类型**（两侧都是 `import type`，编译后这条边不存在，
 * 运行期依赖图仍然单向 ⇒ 没有循环依赖）。
 */
export interface SearchMetricImportResult {
  /** 这一次入库的行（同周期同源的旧行已被覆盖，所以刻意没有 `search_metric_delete`，DR-97 ②）。 */
  metrics: SearchQueryMetric[];
  /** 这一次入库的项目级 AI 汇总（AI 面模板没有维度列，单独走 `SearchAiOverview`）。 */
  ai_overviews: SearchAiOverview[];
  /** 映射不上的平台原生列，原样留档（DR-107：静默丢弃是最坏的失败形态）。 */
  native_extras: SearchNativeExtra[];
  errors: SearchTableError[];
  warnings: SearchTableWarning[];
  /** 导入后该源的数据截至日（`search-catalog.ts` 的 `resolveDataThrough` 算出来的，DR-109）。 */
  data_through: string | null;
}

// ---------------------------------------------------------------------------
// 编译期完整性网
// ---------------------------------------------------------------------------

export type SearchSourceValuesComplete = AssertComplete<
  ValuesAreComplete<SearchSourceKind, typeof SEARCH_SOURCE_VALUES>
>;
export type SearchGroupValuesComplete = AssertComplete<
  ValuesAreComplete<SearchGroup, typeof SEARCH_GROUP_VALUES>
>;
export type SearchRegionValuesComplete = AssertComplete<
  ValuesAreComplete<SearchRegion, typeof SEARCH_REGION_VALUES>
>;
export type SearchSurfaceValuesComplete = AssertComplete<
  ValuesAreComplete<SearchSurface, typeof SEARCH_SURFACE_VALUES>
>;
export type SearchAuthModeValuesComplete = AssertComplete<
  ValuesAreComplete<SearchAuthMode, typeof SEARCH_AUTH_MODE_VALUES>
>;
export type SearchIngestModeValuesComplete = AssertComplete<
  ValuesAreComplete<SearchIngestMode, typeof SEARCH_INGEST_MODE_VALUES>
>;
export type SearchCompletenessValuesComplete = AssertComplete<
  ValuesAreComplete<SearchCompleteness, typeof SEARCH_COMPLETENESS_VALUES>
>;
export type WindowSourceValuesComplete = AssertComplete<
  ValuesAreComplete<WindowSource, typeof WINDOW_SOURCE_VALUES>
>;
/** 数字联合 ⇒ 用模板字面量转成串再比（`ValuesAreComplete` 只吃 `string` 联合）。 */
export type SearchRuleIdValuesComplete = AssertComplete<
  Exclude<`${SearchRuleId}`, `${(typeof SEARCH_RULE_ID_VALUES)[number]}`> extends never ? true : false
>;
export type SearchRuleKeyValuesComplete = AssertComplete<
  ValuesAreComplete<SearchRuleKey, typeof SEARCH_RULE_KEY_VALUES>
>;
export type SearchOpportunityStatusValuesComplete = AssertComplete<
  ValuesAreComplete<SearchOpportunityStatus, typeof SEARCH_OPPORTUNITY_STATUS_VALUES>
>;
export type RankBandValuesComplete = AssertComplete<
  ValuesAreComplete<RankBand, typeof RANK_BAND_VALUES>
>;
export type SelfIndexSnapshotKindValuesComplete = AssertComplete<
  ValuesAreComplete<SelfIndexSnapshotKind, typeof SELF_INDEX_SNAPSHOT_KIND_VALUES>
>;
export type SearchBindingFieldValuesComplete = AssertComplete<
  ValuesAreComplete<SearchBindingField, typeof SEARCH_BINDING_FIELD_VALUES>
>;

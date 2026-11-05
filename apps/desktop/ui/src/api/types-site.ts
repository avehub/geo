/**
 * 站点接入与补丁工作台（M6.5 落地层）的 IPC 契约类型。
 * 设计规格 `docs/superpowers/specs/2026-09-30-site-connect-patch-bench-design.md`（DR-45 … DR-56）。
 *
 * # 口径来自哪里
 * 产品定义 §3.8 的四类处方里有两类的落点是**客户自己的官网**（`llms.txt`、`robots.txt` 放行
 * AI 爬虫、FAQ 区块与 `FAQPage` 标记、可被引用的定义句与参数表、实体口径统一）。本轮把
 * 「处方 → 官网上真的改了」这一段接起来：引入 `SitePatch`（可下发、可撤回、可回滚、带历史的
 * 一处站点改动）与 `SiteChannel`（这个项目的站点**能被怎样改**）。
 *
 * 形态照全球已上市的成熟方案（spec §2）：**Ahrefs Patches** 的三态 + 全量历史 + 两种下发通道，
 * **Scrunch AXP** 的"逻辑在客户侧、数据在我们侧"与版本回退。
 *
 * # 🔴 demo 的边界（AGENTS 规则 9 / 规则 3 / 规则 6，spec DR-56）
 * - `publish` **不真下发**：只翻状态 + 记事件，线上站点一个字节都不会变；
 * - `site_channel_test` **不联网**：回种子里预置的自检结论；
 * - `SitePage[]` **不是爬出来的**：静态预置，真后端由爬虫发现；
 * - `site_patch_generate` **不调模型**：从「按处方预置」的池子里逐字端出；
 * - **凭据永不进库**（规则 3）：`SiteChannel` 只有非敏感配置 + 一个 `secret_ref` 引用串，
 *   `credentials_state` 在 demo 里恒不为 `stored`。
 *
 * # 合规（AGENTS 规则 6）
 * `review_status` 复用 `ContentStatus`：AI 生成的补丁草案在人工采用前恒为 `pending_review`；
 * 导出物（`llms.txt` / `robots.txt` / `patches.json`）只收 `approved`（spec DR-53）。
 */
import type { AssertComplete, ValuesAreComplete } from './completeness';
import type { ContentStatus } from './types';
import type { LibrarySource } from './types-library';

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/**
 * 建站形态。它决定哪几条通道可行（spec DR-46）：
 * `saas_builder`（凡科 / 上线了 / 云·企业官网一类）基本没有公开写 API ⇒ 只剩 `bundle`。
 */
export type SitePlatform =
  | 'wordpress'
  | 'static'
  | 'custom'
  | 'saas_builder'
  | 'ecommerce'
  | 'unknown';

export const SITE_PLATFORM_VALUES = [
  'wordpress',
  'static',
  'custom',
  'saas_builder',
  'ecommerce',
  'unknown',
] as const satisfies readonly SitePlatform[];

/**
 * 谁在管这个站。🔴 `no_access` 是国内中小企业的**常态**（外包代管、客户只有 CMS 后台账号），
 * 所以它必须是一档合法取值而不是一种异常：此时唯一可行的通道是 `bundle`（交接单）。
 */
export type SiteOwnership = 'self' | 'agency' | 'no_access' | 'unknown';

export const SITE_OWNERSHIP_VALUES = [
  'self',
  'agency',
  'no_access',
  'unknown',
] as const satisfies readonly SiteOwnership[];

/**
 * 四条下发通道（spec DR-46）。
 * 🔴 **没有** `extension`（浏览器插件）与 `third_party`（站外平台自动发布）两档：
 * 产品定义 §3.12 把两者都划在 MVP 之外。
 */
export type SiteChannelKind = 'bundle' | 'cms' | 'edge' | 'repo';

export const SITE_CHANNEL_KIND_VALUES = [
  'bundle',
  'cms',
  'edge',
  'repo',
] as const satisfies readonly SiteChannelKind[];

/** 通道状态。`pending_verify` = 配置填了、还没自检过或自检没通过复核。 */
export type SiteChannelStatus = 'not_configured' | 'pending_verify' | 'ready' | 'failed';

export const SITE_CHANNEL_STATUS_VALUES = [
  'not_configured',
  'pending_verify',
  'ready',
  'failed',
] as const satisfies readonly SiteChannelStatus[];

/**
 * 凭据面（spec DR-48）。🔴 demo 里**永远不会是 `stored`**：演示模式不收任何密码与 token
 * （比真后端更强，照 `demo/handlers/secret.ts` 的口径——连内存都不存）。
 */
export type SiteCredentialsState = 'not_required' | 'missing' | 'stored';

export const SITE_CREDENTIALS_STATE_VALUES = [
  'not_required',
  'missing',
  'stored',
] as const satisfies readonly SiteCredentialsState[];

/**
 * 补丁类型。前三类直接对应处方点名的三件事（`llms.txt`、`robots.txt` 放行 AI 爬虫、
 * `FAQPage` 结构化标记）；`entity_consistency` 对应"公司全称 / 资质 / 服务地域三处口径一致"。
 *
 * 🔴 与 Ahrefs Patches 首版只支持 title / meta description 相比，这张表**更宽**：
 * 因为我们下发的是**文件与代码片段**（落地包 / 边缘函数），不是"替 CMS 改一个字段"。
 */
export type SitePatchKind =
  | 'llms_txt'
  | 'robots_txt'
  | 'jsonld'
  | 'html_fragment'
  | 'meta_title'
  | 'meta_description'
  | 'canonical'
  | 'alt_text'
  | 'internal_link'
  | 'entity_consistency';

export const SITE_PATCH_KIND_VALUES = [
  'llms_txt',
  'robots_txt',
  'jsonld',
  'html_fragment',
  'meta_title',
  'meta_description',
  'canonical',
  'alt_text',
  'internal_link',
  'entity_consistency',
] as const satisfies readonly SitePatchKind[];

/** 补丁三态（spec DR-47，照 Ahrefs Patches 的 draft / published / unpublished）。 */
export type SitePatchStatus = 'draft' | 'published' | 'unpublished';

export const SITE_PATCH_STATUS_VALUES = [
  'draft',
  'published',
  'unpublished',
] as const satisfies readonly SitePatchStatus[];

/** `site_patch_transition` 的入参：三个动作共用一条命令（DR-47）。 */
export type SitePatchTransition = 'publish' | 'unpublish' | 'rollback';

export const SITE_PATCH_TRANSITION_VALUES = [
  'publish',
  'unpublish',
  'rollback',
] as const satisfies readonly SitePatchTransition[];

/** 历史事件的种类（照 Ahrefs 的 "Show history" 与 Scrunch 的 Recent System Activity）。 */
export type SitePatchEventKind =
  | 'created'
  | 'saved'
  | 'published'
  | 'unpublished'
  | 'rolled_back'
  | 'exported';

export const SITE_PATCH_EVENT_KIND_VALUES = [
  'created',
  'saved',
  'published',
  'unpublished',
  'rolled_back',
  'exported',
] as const satisfies readonly SitePatchEventKind[];

/** 页面角色（站点档案里那张页面清单）：它是**数据级**分类，用于挑补丁的落点。 */
export type SitePageRole =
  | 'home'
  | 'product'
  | 'about'
  | 'qualification'
  | 'service'
  | 'news'
  | 'faq'
  | 'other';

export const SITE_PAGE_ROLE_VALUES = [
  'home',
  'product',
  'about',
  'qualification',
  'service',
  'news',
  'faq',
  'other',
] as const satisfies readonly SitePageRole[];

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/** 一条自检结论的稳定形状：`code` + 语言中立 `params`，文案由前端词典渲染（规则 7）。 */
export interface CheckDetail {
  code: string;
  params: Record<string, string>;
}

/** 站点档案：把"这个站点长什么样、谁能改它"引进来（spec DR-49）。 */
export interface SiteProfile {
  id: string;
  project_id: string;
  /** 站点根域名（来自 `Project.website`，只读 ⇒ 界面不提供改它的入口）。 */
  domain: string;
  platform: SitePlatform;
  ownership: SiteOwnership;
  /** 谁在管、有什么权限（数据级中文，例如"服务器由外包代管，客户只有 CMS 后台账号"）。 */
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** 一个受管页面。🔴 demo 里是静态预置，真后端由爬虫发现（DR-56③）。 */
export interface SitePage {
  id: string;
  project_id: string;
  url: string;
  role: SitePageRole;
  /** 页面标题（数据级中文）。 */
  title: string | null;
  /** 最近一次自检时间；`null` = 没查过。 */
  last_checked_at: string | null;
  /** AI 爬虫能不能抓到（`robots.txt` 挡没挡）。静态值，不是真探测结果。 */
  crawlable: boolean;
}

/** 一条下发通道（spec DR-46 / DR-48）。 */
export interface SiteChannel {
  id: string;
  project_id: string;
  kind: SiteChannelKind;
  status: SiteChannelStatus;
  /** `cms` = WP 站点 URL；`edge` = Worker 路由；`repo` = 仓库地址；`bundle` 恒 `null`。 */
  endpoint: string | null;
  /** `cms` 的用户名（**不是**凭据）。 */
  username: string | null;
  note: string | null;
  credentials_state: SiteCredentialsState;
  /**
   * 钥匙串引用串（`keyring://site/<kind>/<project_id>`）。
   * 🔴 规则 3：库里只许有这个**引用串**，绝不含任何形如密码 / token 的值。
   */
  secret_ref: string | null;
  /** 最近一次自检时间；`null` = 没自检过。 */
  checked_at: string | null;
  /** 自检结论（稳定 code + params；文案由前端 `checkDetails.<code>` 渲染）。 */
  check_detail: CheckDetail | null;
  updated_at: string;
}

/** 一处站点改动（补丁）。 */
export interface SitePatch {
  id: string;
  project_id: string;
  /** 回指处方（`ActionItem.id`）；手动新建的补丁可以是 `null`。 */
  action_id: string | null;
  /** 产出这条补丁所依据的那一轮（与处方的 `round_id` 同口径，归因时对齐复测轮）。 */
  round_id: string;
  kind: SitePatchKind;
  /** 补丁标题（数据级中文）。 */
  title: string;
  /** 落点页面。`llms_txt` / `robots_txt` 这类**站点级**补丁填根路径（`/llms.txt`）。 */
  target_url: string;
  /** 贴在页面哪一块（数据级中文，例如"产品页首屏定义段之后"）。 */
  target_hint: string | null;
  /** 草案正文（代码或文案，可编辑）。 */
  body: string;
  /**
   * 上一次**发布**时的正文快照。`null` = 从没发布过。
   * 🔴 编辑草案**不动**它（DR-47）：界面据 `body !== published_body` 派生"有未发布的修改"。
   */
  published_body: string | null;
  /** 上一次发布时的 kind 快照；旧数据可为 null，读取时回落到当前 kind。 */
  published_kind?: SitePatchKind | null;
  /** 上一次发布时的落点快照；旧数据可为 null。 */
  published_target_url?: string | null;
  /** 上一次发布时的通道快照；旧数据可为 null。 */
  published_channel_kind?: SiteChannelKind | null;
  status: SitePatchStatus;
  /** 人工审核态：AI 生成默认 `pending_review`（规则 6）。 */
  review_status: ContentStatus;
  /** 打算走哪条通道下发。 */
  channel_kind: SiteChannelKind;
  source: LibrarySource;
  /** 0 基，照 `keyword_item` / `prompt_item` 的 `position` 口径。 */
  position: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 一条历史事件。🔴 handler 生成的事件 `note` 恒为 `null`（门禁 7：非注释不含 CJK）；
 *  中文备注只出现在**种子**里（那是"后端数据"的替身）。 */
export interface SitePatchEvent {
  id: string;
  patch_id: string;
  kind: SitePatchEventKind;
  /** 这次事件走的是哪条通道；`created` / `saved` 一类与通道无关的是 `null`。 */
  channel_kind: SiteChannelKind | null;
  note: string | null;
  created_at: string;
}

/** 手动新建一条补丁的入参。`source` 由后端固定成 `manual`。 */
export interface SitePatchDraft {
  kind: SitePatchKind;
  title: string;
  target_url: string;
  target_hint?: string | null;
  body: string;
  channel_kind: SiteChannelKind;
  action_id?: string | null;
}

/**
 * 「这条处方可以生成哪些补丁」的一个候选项（生成池的**目录**，不含正文）。
 *
 * 🔴 为什么要把目录端给前端：生成弹窗要让用户**勾选**要生成哪几类补丁，
 * 而"有哪些可选"是后端（真后端是模板目录，demo 是种子池）的知识。
 * 只给 `kind` 不够——同一个 kind 在不同处方下是不同的东西，所以带上 `title`。
 * `source_layout` 类处方**一条都没有**（DR-46：落点在站外平台），界面据此置灰按钮。
 */
export interface SitePatchPoolEntry {
  action_id: string;
  kind: SitePatchKind;
  /** 候选项标题（数据级中文，与生成出来的补丁标题逐字相同）。 */
  title: string;
}

/**
 * 站点接入页首屏：档案 + 页面清单 + 通道 + 补丁 + 生成池目录（一次往返，照 `action_board`）。
 *
 * 🔴 `profile` 可空：还没建档的项目（种子里那个归档项目就是）回 `null`，
 * 界面显示空态与建档表单，而不是抛 `not_found`——站点页是左侧导航直达的落点，
 * "这个项目还没建档"是一个**正常状态**，不是错误。
 */
export interface SiteBoard {
  profile: SiteProfile | null;
  pages: SitePage[];
  channels: SiteChannel[];
  patches: SitePatch[];
  pool: SitePatchPoolEntry[];
}

// ---------------------------------------------------------------------------
// 编译期完整性网
// ---------------------------------------------------------------------------

export type SitePlatformValuesComplete = AssertComplete<
  ValuesAreComplete<SitePlatform, typeof SITE_PLATFORM_VALUES>
>;
export type SiteOwnershipValuesComplete = AssertComplete<
  ValuesAreComplete<SiteOwnership, typeof SITE_OWNERSHIP_VALUES>
>;
export type SiteChannelKindValuesComplete = AssertComplete<
  ValuesAreComplete<SiteChannelKind, typeof SITE_CHANNEL_KIND_VALUES>
>;
export type SiteChannelStatusValuesComplete = AssertComplete<
  ValuesAreComplete<SiteChannelStatus, typeof SITE_CHANNEL_STATUS_VALUES>
>;
export type SiteCredentialsStateValuesComplete = AssertComplete<
  ValuesAreComplete<SiteCredentialsState, typeof SITE_CREDENTIALS_STATE_VALUES>
>;
export type SitePatchKindValuesComplete = AssertComplete<
  ValuesAreComplete<SitePatchKind, typeof SITE_PATCH_KIND_VALUES>
>;
export type SitePatchStatusValuesComplete = AssertComplete<
  ValuesAreComplete<SitePatchStatus, typeof SITE_PATCH_STATUS_VALUES>
>;
export type SitePatchTransitionValuesComplete = AssertComplete<
  ValuesAreComplete<SitePatchTransition, typeof SITE_PATCH_TRANSITION_VALUES>
>;
export type SitePatchEventKindValuesComplete = AssertComplete<
  ValuesAreComplete<SitePatchEventKind, typeof SITE_PATCH_EVENT_KIND_VALUES>
>;
export type SitePageRoleValuesComplete = AssertComplete<
  ValuesAreComplete<SitePageRole, typeof SITE_PAGE_ROLE_VALUES>
>;

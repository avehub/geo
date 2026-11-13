/**
 * 唯一 IPC 出口：组件只能经本文件调用后端，禁止直接 `invoke`。
 *
 * 每个 Tauri 命令对应一个导出函数；后端 `IpcError{code,message,detail,params}` 统一转成
 * `IpcRequestError`（带稳定错误码）。⚠ 组件**不要**把 `message` 直接端给用户：它是语言中立的
 * 紧凑诊断串（`{code} {k}={v}…`），展示一律走 `src/api/errors.ts` 的 `describeIpcError(error, t)`。
 */

import { invoke } from '@tauri-apps/api/core';

import { demoInvoke } from '../demo/backend';
import { runtime } from './runtime';
import type {
  AppEnvironment,
  AppSettings,
  Competitor,
  CompetitorDraft,
  CsvImportResult,
  DedupeReport,
  EntityCard,
  EntityCardRevision,
  FieldStatus,
  GenerateOptions,
  ImportReport,
  IpcErrorPayload,
  LlmModelsQuery,
  LlmTestResult,
  ModelsListResult,
  Project,
  ProjectAsset,
  ProjectDetail,
  ProjectDraft,
  ProjectExport,
  ProjectFilter,
  PromptDraft,
  PromptItem,
  PromptSet,
  PromptSetSummary,
  ProviderInfo,
  SearchBindingField,
  SearchBoardResult,
  SearchMetricImportResult,
  SearchBrowserSession,
  SearchOAuthStart,
  SearchOpportunity,
  SearchOpportunityStatus,
  SearchSource,
  SearchSourceKind,
  SecretStatus,
} from './types';
import { isIpcErrorPayload } from './types';

/**
 * 全部 IPC 命令名（**108** 条）。前后端漂移时这里先炸，便于排查。
 *
 * 🔴 2026-11-06 核对为 **108 = 108 条 Rust + 0 条 demo-only**。M5.5 站长数据现在 9 条：
 * 原有 6 条 + `search_oauth_begin`（GSC OAuth 起点）+ 系统 Chrome 取数两条
 * （`search_browser_open` / `search_browser_capture`，只支持百度站长两个面）。demo 后端对
 * OAuth 与浏览器三条命令明确回 `validation/failed`——演示模式不联网、不伪造授权与浏览器会话
 * （规则 2 / 规则 8 / 规则 11 / DR-99）。
 */
export const IPC_COMMANDS = [
  'project_create',
  'project_list',
  'project_get',
  'project_update',
  'project_archive',
  'project_delete',
  'project_export',
  'project_import',
  'project_export_competitors_csv',
  'project_export_assets_csv',
  'entity_card_autobuild',
  'entity_card_get',
  'entity_card_update_field',
  'entity_card_revisions',
  'competitor_upsert',
  'competitor_list',
  'competitor_delete',
  'competitor_reorder',
  'asset_add',
  'asset_list',
  'asset_delete',
  'prompt_set_generate',
  'prompt_set_list',
  'prompt_set_get',
  'prompt_set_rename',
  'prompt_set_delete',
  'prompt_item_update',
  'prompt_item_add',
  'prompt_item_delete',
  'prompt_set_dedupe',
  'prompt_set_export_csv',
  'prompt_set_import_csv',
  'settings_get',
  'settings_update',
  'secret_set',
  'secret_status',
  'secret_delete',
  'llm_provider_test',
  'llm_providers',
  'export_write_file',
  // ---- M3 多引擎采集 ----
  'collection_board',
  'collection_round_get',
  'collection_start',
  'collection_task_retry',
  'collection_record_list',
  'collection_record_get',
  // ---- M4 回答解析与事实核查 ----
  'insight_list',
  'insight_correct',
  'fact_check_list',
  'fact_check_resolve',
  // ---- M5 诊断与归因 ----
  'diagnosis_overview',
  'diagnosis_competitors',
  'diagnosis_funnel',
  'diagnosis_engines',
  'diagnosis_alert_acknowledge',
  // ---- M6 GEO 行动中心 ----
  'action_board',
  'action_update_status',
  'content_generate',
  'content_update_status',
  // ---- M7 报告与分享 ----
  'report_render',
  // ---- Plan B（🔴 demo 独有，Rust 侧本轮零改动，差异 E-46 起）----
  // 本机环境：设置页的权限与数据目录（Task 3 / DR-35）
  'app_environment',
  // 按界面上的草稿配置拉模型名清单（Task 4 / DR-34）
  'llm_models_list',
  // ---- M1.5 素材层：关键词库 / FAQ 常见问题库 ----
  // 🔴 demo 独有（Rust 侧本轮零改动，差异 E-52 起）：spec 2026-09-30-keyword-faq-library-design.md
  'keyword_list',
  'keyword_add',
  'keyword_update',
  'keyword_delete',
  'keyword_generate',
  'faq_list',
  'faq_add',
  'faq_update',
  'faq_delete',
  'faq_generate',
  // ---- M6.5 站点接入与补丁工作台 ----
  // 🔴 demo 独有（Rust 侧本轮零改动，差异 E-55 起）：
  // spec 2026-09-30-site-connect-patch-bench-design.md（DR-45 … DR-56）
  'site_board',
  'site_profile_save',
  'site_channel_upsert',
  'site_channel_remove',
  'site_channel_test',
  'site_patch_add',
  'site_patch_generate',
  'site_patch_save',
  'site_patch_transition',
  'site_patch_history',
  'site_patch_delete',
  // ---- M1.2 知识库（品牌实体卡下面那一项）----
  // 🔴 demo 独有（Rust 侧本轮零改动，差异 E-58 起）：
  // spec 2026-10-01-entity-card-slim-and-knowledge-base-design.md（DR-59 … DR-72）
  'kb_board',
  'kb_entry_add',
  'kb_entry_update',
  'kb_entry_delete',
  'kb_entry_verify',
  'kb_generate',
  // ---- M6 文章管理 Article Studio（行动中心之后、站点接入之前那一项）----
  // 🔴 demo 独有（Rust 侧本轮零改动，差异 E-64 起）：
  // spec 2026-10-10-kb-redesign-and-article-studio-design.md（DR-83 … DR-89）
  'article_direction_list',
  'article_direction_add',
  'article_direction_generate',
  'article_template_list',
  'article_template_save',
  'article_template_delete',
  'article_schedule_list',
  'article_schedule_save',
  'article_schedule_run',
  'article_list',
  // ---- M5.5 站长数据（解析与核查之后、诊断与归因之前那一项）----
  // 🔴 demo 独有（Rust 侧本轮零改动，差异 E-67 起）：
  // spec 2026-10-12-webmaster-data-integration-design.md（DR-90 … DR-118，命令面见 DR-97）
  'search_board',
  'search_oauth_begin',
  'search_source_upsert',
  'search_source_remove',
  'search_source_test',
  'search_metric_import_csv',
  'search_opportunity_update',
  'search_browser_open',
  'search_browser_capture',
] as const;

export type IpcCommand = (typeof IPC_COMMANDS)[number];

/** IPC 调用失败。`code` 为后端稳定错误码，可直接用于分支处理。 */
export class IpcRequestError extends Error {
  readonly code: string;
  readonly detail: unknown;
  /**
   * 语言中立参数（键名由 `contracts/error-codes.json` 冻结）。
   * 词典靠它插值，见 `src/api/errors.ts` 的 `describeIpcError`；
   * 后端没带这个字段时是 `{}` 而不是 `undefined`，调用方不必处处判空。
   */
  readonly params: Readonly<Record<string, string>>;

  constructor(payload: IpcErrorPayload) {
    // 兜底记号必须**语言中立**（裁定 B-3.1）：`message` 的定位是紧凑诊断串，而
    // `describeIpcError` 的词典 miss 那一级会**回落 `error.message`**——填一句中文既让
    // 「后端发了合法 payload 但 message 是空串」这种契约破损在界面上伪装成正常文案，
    // 也把排障线索换成了一句废话。回落顺序 `message → code → 'ipc/unknown'`：
    // code 与下面 `this.code` 的兜底同源，所以两者永远一致，不新增第三种记号。
    super(payload.message || payload.code || 'ipc/unknown');
    this.name = 'IpcRequestError';
    this.code = payload.code || 'ipc/unknown';
    this.detail = payload.detail ?? null;
    this.params = payload.params ?? {};
  }
}

/** 把任意 invoke 拒绝原因归一化成 `IpcRequestError`。 */
export function unwrapIpcError(cmd: string, cause: unknown): IpcRequestError {
  if (cause instanceof IpcRequestError) return cause;
  if (isIpcErrorPayload(cause)) return new IpcRequestError(cause);

  // Tauri 在参数反序列化失败时会直接 reject 一个字符串。
  const message =
    typeof cause === 'string'
      ? cause
      : cause instanceof Error
        ? cause.message
        : JSON.stringify(cause) ?? String(cause);

  // 用 `ipc/invoke_failed` 而不是 `ipc/internal`（裁定 B-2 / 复审 I-1）：
  // `ipc/internal` 的契约 params 被冻结成 `[]`，模板里一个占位符都没有，走它等于把
  // 命令名与真实原因整个丢给词典吞掉，用户只看到「内部错误，请重试」——
  // 对确定性的参数形状不匹配而言还是个错建议（重试每次都失败）。
  // `ipc/invoke_failed` 的契约 params 正是 `['cmd','reason']`，模板 zh
  // `调用 {{cmd}} 失败：{{reason}}` / en `The call to {{cmd}} failed: {{reason}}`
  // 与从前那句硬编码中文逐字同构 ⇒ 信息量不减，还顺带双语、并把散文搬进了词典。
  //
  // `message` 用语言中立的紧凑串，与后端 `IpcError::with_params` 同构
  // （`apps/desktop/src-tauri/src/error.rs:68`-`:90`，键按 BTreeMap 排序）。
  return new IpcRequestError({
    code: 'ipc/invoke_failed',
    params: { cmd, reason: message },
    message: `ipc/invoke_failed cmd=${cmd} reason=${message}`,
    detail: null,
  });
}

/**
 * IPC 调用器的形状：`@tauri-apps/api/core` 的 `invoke` 与 demo 分支的占位 invoker 共用它。
 * 抽成类型是为了让 `callVia` 的注入点对测试可见（裁定 B-2 第 1 条）。
 */
export type IpcInvoker = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * **唯一分派点**：把「调用哪个 invoker」变成参数（裁定 B-2 第 1 条）。
 *
 * 错误归一化留在这里、不留给 invoker：不论走 Tauri 的 `invoke` 还是 demo 的假后端，
 * 调用方看到的都是带稳定 code 的 `IpcRequestError`——Task 9 的成果，不因分派点搬家而回退。
 *
 * @internal 仅供 `call()` 与测试注入使用；组件一律走 `client.*` 的具名导出，不要直接 callVia/invoke。
 */
export async function callVia<T>(
  cmd: IpcCommand,
  args: Record<string, unknown> | undefined,
  invoker: IpcInvoker,
): Promise<T> {
  try {
    return await invoker<T>(cmd, args);
  } catch (cause) {
    throw unwrapIpcError(cmd, cause);
  }
}

/**
 * 具名 wrapper 的唯一实现。
 *
 * 🔴 导出是为了让 `src/api/` 下的**同族 wrapper 模块**（`collection.ts` / `insight.ts` /
 * `diagnosis.ts` / `action.ts` / `report.ts`）复用同一条分派与错误归一化路径——`client.ts`
 * 已经接近「单文件约 400 行就拆分」的上限，M3–M7 的 20 条命令再塞进来就超了。
 * 组件**仍然只能**调具名 wrapper（`client.projectList()` / `collection.collectionBoard()`），
 * 不许直接 `call`，更不许直接 `invoke`（AGENTS 代码风格：IPC 调用集中在 `src/api/`）。
 *
 * ⚠ 这些 wrapper 模块**只 import 本文件**、本文件不 import 它们 ⇒ 依赖图仍是单向的，
 * 没有运行期循环依赖（`demo/backend.ts` 的头注释把这条纪律写成了硬要求）。
 */
export async function call<T>(cmd: IpcCommand, args?: Record<string, unknown>): Promise<T> {
  // `runtime` 是模块级常量（`api/runtime.ts`）：首次 import 时按 `window.__TAURI_INTERNALS__`
  // 在不在读定一次，判据与 `@tauri-apps/api` 自己的取用方式同源（见那个文件的头注释）。
  return callVia<T>(cmd, args, runtime === 'tauri' ? invoke : demoInvoke);
}

// ---------------------------------------------------------------------------
// M1 项目
// ---------------------------------------------------------------------------

export const projectCreate = (draft: ProjectDraft) =>
  call<Project>('project_create', { draft });

export const projectList = (filter: ProjectFilter = {}) =>
  call<Project[]>('project_list', { filter });

export const projectGet = (id: string) => call<ProjectDetail>('project_get', { id });

export const projectUpdate = (project: Project) =>
  call<Project>('project_update', { project });

export const projectArchive = (id: string, archived: boolean) =>
  call<Project>('project_archive', { id, archived });

export const projectDelete = (id: string) => call<void>('project_delete', { id });

export const projectExport = (id: string) =>
  call<ProjectExport>('project_export', { id });

export const projectImport = (payload: string) =>
  call<ImportReport>('project_import', { payload });

/** 竞品 CSV（不带 BOM，下载时由前端补）。spec FR-M1-6。 */
export const projectExportCompetitorsCsv = (id: string) =>
  call<string>('project_export_competitors_csv', { id });

/** 资产 CSV（不带 BOM，下载时由前端补）。spec FR-M1-6。 */
export const projectExportAssetsCsv = (id: string) =>
  call<string>('project_export_assets_csv', { id });

// ---------------------------------------------------------------------------
// M1 实体卡
// ---------------------------------------------------------------------------

export const entityCardAutobuild = (projectId: string, domain: string) =>
  call<EntityCard>('entity_card_autobuild', { project_id: projectId, domain });

export const entityCardGet = (projectId: string) =>
  call<EntityCard | null>('entity_card_get', { project_id: projectId });

export const entityCardUpdateField = (
  projectId: string,
  path: string,
  value: unknown,
  status: FieldStatus,
  note: string | null,
) =>
  call<EntityCardRevision>('entity_card_update_field', {
    project_id: projectId,
    path,
    value,
    status,
    note,
  });

export const entityCardRevisions = (projectId: string) =>
  call<EntityCardRevision[]>('entity_card_revisions', { project_id: projectId });

// ---------------------------------------------------------------------------
// M1 竞品与资产
// ---------------------------------------------------------------------------

export const competitorUpsert = (
  projectId: string,
  draft: CompetitorDraft,
  id: string | null = null,
) => call<Competitor>('competitor_upsert', { project_id: projectId, draft, id });

export const competitorList = (projectId: string) =>
  call<Competitor[]>('competitor_list', { project_id: projectId });

export const competitorDelete = (id: string) => call<void>('competitor_delete', { id });

export const competitorReorder = (projectId: string, ids: string[]) =>
  call<Competitor[]>('competitor_reorder', { project_id: projectId, ids });

export const assetAdd = (
  projectId: string,
  kind: ProjectAsset['kind'],
  url: string,
  title: string | null = null,
  note: string | null = null,
) => call<ProjectAsset>('asset_add', { project_id: projectId, kind, url, title, note });

export const assetList = (projectId: string) =>
  call<ProjectAsset[]>('asset_list', { project_id: projectId });

export const assetDelete = (id: string) => call<void>('asset_delete', { id });

// ---------------------------------------------------------------------------
// M2 Prompt 题库
// ---------------------------------------------------------------------------

export const promptSetGenerate = (projectId: string, options: GenerateOptions) =>
  call<PromptSet>('prompt_set_generate', { project_id: projectId, options });

export const promptSetList = (projectId: string) =>
  call<PromptSetSummary[]>('prompt_set_list', { project_id: projectId });

export const promptSetGet = (id: string) => call<PromptSet>('prompt_set_get', { id });

export const promptSetRename = (id: string, label: string) =>
  call<PromptSetSummary>('prompt_set_rename', { id, label });

export const promptSetDelete = (id: string) => call<void>('prompt_set_delete', { id });

export const promptItemUpdate = (item: PromptItem) =>
  call<PromptItem>('prompt_item_update', { item });

/** 人工新增条目，返回整份快照（position 与内容哈希都会重算）。 */
export const promptItemAdd = (setId: string, items: PromptDraft[]) =>
  call<PromptSet>('prompt_item_add', { set_id: setId, items });

/** 批量删除条目，返回整份快照。 */
export const promptItemDelete = (setId: string, ids: string[]) =>
  call<PromptSet>('prompt_item_delete', { set_id: setId, ids });

export const promptSetDedupe = (id: string) => call<DedupeReport>('prompt_set_dedupe', { id });

export const promptSetExportCsv = (id: string) =>
  call<string>('prompt_set_export_csv', { id });

export const promptSetImportCsv = (id: string, payload: string) =>
  call<CsvImportResult>('prompt_set_import_csv', { id, payload });

// ---------------------------------------------------------------------------
// 设置与密钥
// ---------------------------------------------------------------------------

export const settingsGet = () => call<AppSettings>('settings_get');

export const settingsUpdate = (settings: AppSettings) =>
  call<AppSettings>('settings_update', { settings });

export const secretSet = (provider: string, value: string) =>
  call<void>('secret_set', { provider, value });

export const secretStatus = (provider: string) =>
  call<SecretStatus>('secret_status', { provider });

export const secretDelete = (provider: string) => call<void>('secret_delete', { provider });

export const llmProviderTest = (provider: string) =>
  call<LlmTestResult>('llm_provider_test', { provider });

export const llmProviders = () => call<ProviderInfo[]>('llm_providers');

/**
 * 按**界面上的草稿配置**取回可用模型名（Plan B Task 4 · DR-34）。
 *
 * 🔴 入参是草稿而不是已落库那份——与 `llmProviderTest` 刻意不同（那条读库，是已知 bug #5）。
 * `api_key` 恒传 `null`：AGENTS 规则 3 要求 Key 只进系统钥匙串，真后端在 Plan C 自己读。
 * demo 不发请求，回预置清单并把 `source` 标成 `'preset'`（`api/types-llm.ts`）。
 */
export const llmModelsList = (query: LlmModelsQuery) =>
  call<ModelsListResult>('llm_models_list', {
    provider: query.provider,
    protocol: query.protocol,
    base_url: query.base_url,
    api_key: query.api_key ?? null,
  });

/**
 * 本机环境事实：版本、构建号、系统权限状态、数据目录与占用（Plan B · spec DR-35）。
 *
 * 只读。「打开目录」「更改目录」「去系统设置」三个动作本轮**不给命令**：
 * demo 里做不到（浏览器打不开访达），界面把按钮置灰并说明由桌面端提供。
 */
export const appEnvironment = () => call<AppEnvironment>('app_environment');

// ---------------------------------------------------------------------------
// 桌面壳：文件导出
// ---------------------------------------------------------------------------

/**
 * 弹「另存为」对话框并写入文件，返回最终路径；用户取消返回 `null`。
 *
 * 导出**不能**用 `<a download href="blob:">`：macOS 的 WKWebView 不实现
 * blob 下载，点击后静默失败（spec FR-B2 因此要求走 dialog 插件）。
 * CSV 传 `withBom = true`，Excel 打开中文才不乱码。
 */
export const exportWriteFile = (
  defaultName: string,
  content: string,
  withBom: boolean,
  // P2-10：原生「另存为」对话框标题。Rust 侧不再硬编码中文，缺省时回落 ASCII 的 Export。
  title?: string,
) =>
  call<string | null>('export_write_file', {
    default_name: defaultName,
    content,
    with_bom: withBom,
    title,
  });

// ---------------------------------------------------------------------------
// M5.5 站长数据（6 条，🔴 只有 demo 侧实现）
// ---------------------------------------------------------------------------
// ⚠ 同族 wrapper 的既有姿态是**单独一个文件**（`api/site.ts` / `api/kb.ts` / `api/article.ts`：
// `client.ts` 早就过了「单文件约 400 行就拆分」那条软线，拆分理由逐字写在 `api/site.ts` 的头注释里）。
// 这 6 条本轮先落在这里，将来拆出 `api/search.ts` 时整段搬走即可——签名与命令名都不变。

/**
 * 站长数据页首屏：源 + 指标明细 + AI 汇总 + C 类留档 + 机会 + 自建索引覆盖（一次往返，
 * 照 `siteBoard` / `actionBoard` 的取舍）。
 *
 * 🔴 **不含汇总数字**（DR-97 ④ 刻意不加 `search_aggregate`）：归一、A 类求和、B 类重算、筛选与
 * 区间收敛全在 `api/search-compose.ts`（纯函数，demo 与桌面端共用同一份；两端各算一份区间
 * 就会出现"同一个项目两个合计数"）。
 * ⚠ 不分页：明细上万行时前端要扛（代价登记在差异台账 E-67）。
 */
export const searchBoard = (projectId: string) =>
  call<SearchBoardResult>('search_board', { project_id: projectId });

/**
 * 启动 GSC 的 OAuth 授权（PKCE + 127.0.0.1 回环）。
 *
 * 🔴 只支持 `gsc`：Bing 仍是 API key / 手工通道，百度站长没有读 API；后端对其余 kind
 * 回 `validation/failed { field: "kind", reason: "not_allowed" }`，不伪造授权。
 * 返回的 `auth_url` 由调用方交给系统浏览器；token 永不经此前端命令流转。
 */
export const searchOauthBegin = (projectId: string, kind: SearchSourceKind) =>
  call<SearchOAuthStart>('search_oauth_begin', { project_id: projectId, kind });

/**
 * 增改一个数据源（同 `kind` 覆盖，照 `siteChannelUpsert`：一个项目就是一个站点 ⇒ 每 kind 至多一条）。
 *
 * 🔴 **不收凭据**（DR-96 / AGENTS 规则 3）：`binding` 只装站点绑定（`siteUrl` / `siteId`）这类非敏感值；
 * 凭据是**账号级**的，引用串 `keyring://search/<kind>`（`api/search-catalog.ts` 的 `searchSecretRef`），
 * 走既有 `secretSet` / `secretStatus` / `secretDelete`（DR-97 ③：不新增出口）。
 * 🔴 `auth_mode` / `ingest_modes` / `region` / `group` **一律由目录表决定**（DR-108），不收用户输入：
 * 一个源支持哪几种取数形态是产品的建模决定，不是每次接入时现场填的表单。
 * 🔴 demo 不联网、OAuth 一条都没实现（DR-99）⇒ `credentials_state` 恒不为 `stored`。
 */
export const searchSourceUpsert = (
  projectId: string,
  kind: SearchSourceKind,
  binding: Partial<Record<SearchBindingField, string>>,
  note: string | null,
) =>
  call<SearchSource>('search_source_upsert', {
    project_id: projectId,
    kind,
    binding,
    note,
  });

/**
 * 移除一个数据源，回**剩余快照**（幂等，照 `siteChannelRemove`）。
 * 🔴 连带删掉它导入的指标行与原生字段留档：留着就是"合计里有一批查不到出处的数字"。
 */
export const searchSourceRemove = (projectId: string, kind: SearchSourceKind) =>
  call<SearchSource[]>('search_source_remove', { project_id: projectId, kind });

/**
 * 跑一次自检，回**那个源**（翻 `checked_at` + `check_detail`，照 `siteChannelTest`）。
 * 🔴 demo **不联网**（AGENTS 规则 2 / DR-99）：结论逐字来自预置表，页面上有常驻说明
 * `webmasterData.demoBody`；海外那两个源在 demo 里是纸面设计（差异台账 E-71）。
 */
export const searchSourceTest = (projectId: string, kind: SearchSourceKind) =>
  call<SearchSource>('search_source_test', { project_id: projectId, kind });

/**
 * 导入一批指标（DR-98 / DR-113）。
 *
 * 🔴 **一条命令同时吃文件与粘贴文本**：`payload` 就是字符串（`promptSetImportCsv` 同款）——
 * 粘贴解析不是 CSV 导入的替代而是它的前置，两者共用 `api/search-paste.ts` 的列识别与校验，
 * 所以命令面仍是 6 条。`.xlsx` 先在 `api/search-xlsx.ts` 里解成网格，再走同一条管线。
 * 🔴 区间必须由调用方**显式确认**：百度《AI 流量分析》的导出**没有日期列**（DR-98 实测），
 * 这类源入库时 `window_source` 记 `user_stated`，文案写"区间由导入时确认"而不是"平台声明"。
 * 🔴 同周期同源的旧行被这一次导入**覆盖**——删除是导入的一个分支，所以刻意没有
 * `search_metric_delete`（DR-97 ②）。
 * 🔴 行级容错：坏行进 `errors`、好行照样入库（照 `demo/handlers/prompt-csv.ts` 的口径）；
 * `warnings` 只提示不阻断（平台给的点击率只作交叉校验，入库一律用重算值）。
 */
export const searchMetricImportCsv = (
  projectId: string,
  kind: SearchSourceKind,
  payload: string,
  periodStart: string,
  periodEnd: string,
) =>
  call<SearchMetricImportResult>('search_metric_import_csv', {
    project_id: projectId,
    kind,
    payload,
    period_start: periodStart,
    period_end: periodEnd,
  });

/**
 * 翻一条优化机会的处置状态（照 `actionUpdateStatus`：只翻 `status` + `updated_at`）。
 * 🔴 不重算：DR-100 那 6 条规则的判定是 `geo-domain` 纯函数，demo 只端预置的静态清单
 * （DR-99 / 差异台账 E-68）⇒ 翻状态不会长出新条目，页面必须常驻 `webmasterData.staticNote` 说清这件事。
 */
export const searchOpportunityUpdate = (opportunityId: string, status: SearchOpportunityStatus) =>
  call<SearchOpportunity>('search_opportunity_update', {
    opportunity_id: opportunityId,
    status,
  });

/**
 * 打开系统 Chrome / Edge（独立 profile，路径 C），返回 CDP 地址。
 *
 * 🔴 只支持 `baidu_ziyuan` / `baidu_ziyuan_ai`：其它 kind 由后端回
 * `validation/failed { field: "kind", reason: "not_allowed" }`，不伪造授权。
 * 🔴 不代登录：命令只启动浏览器并打开后台首页，扫码 / 登录由用户自己在窗口里完成；
 * Chrome 不随命令关闭，用户要继续操作。
 */
export const searchBrowserOpen = (projectId: string, kind: SearchSourceKind) =>
  call<SearchBrowserSession>('search_browser_open', { project_id: projectId, kind });

/**
 * 连接已打开的系统 Chrome，读取**当前可见页面**的表格并交给既有导入管线。
 *
 * 🔴 列映射不在这里重写：抽出 TSV 后由后端复用 `search_metric_import_csv` 的解析器。
 * 不读 cookie / localStorage，不调用私有 XHR，不绕验证码（AGENTS 规则 11）。
 * 第一张能识别的表导入成功就返回；全部失败回
 * `validation/failed { field: "payload", reason: "parse_failed" }`，`detail` 带每张表的行级摘要。
 */
export const searchBrowserCapture = (
  projectId: string,
  kind: SearchSourceKind,
  wsUrl: string,
  periodStart: string,
  periodEnd: string,
) =>
  call<SearchMetricImportResult>('search_browser_capture', {
    project_id: projectId,
    kind,
    ws_url: wsUrl,
    period_start: periodStart,
    period_end: periodEnd,
  });

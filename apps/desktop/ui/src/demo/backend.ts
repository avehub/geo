/**
 * demo 假后端：`IPC_COMMANDS` 那 108 条命令在浏览器里的替身（AGENTS 规则 8）。
 *
 * # 全覆盖网（编译期）+ 键集相等（运行期）
 * `demoBackend` 标注成 `Record<IpcCommand, DemoHandler>`：`IpcCommand` 是 108 个字面量的联合，
 * 所以**漏一条命令 `tsc -b` 就红**——这正是 AGENTS 规则 8「命令增减两侧同时改」的编译期保证。
 * 运行期还有一道：下面的未知命令守卫是拿**这张表的键**收窄的，所以 `backend.test.ts` 里有一条
 * 「键集合与 `IPC_COMMANDS` 完全相等」的断言，防止将来有人把这张表放宽成 `Partial<…>`
 * 之后守卫跟着静默失效。
 *
 * # 🔴 `demoInvoke` 收 `cmd: string`，不收 `cmd: IpcCommand`（简报 §A-13）
 * `api/client.ts` 的注入点类型是 `IpcInvoker = <T>(cmd: string, args?) => Promise<T>`，
 * 而 `strict` 含 `strictFunctionTypes`、`IpcInvoker` 是**属性式**函数类型（没有方法的双变）
 * ⇒ 参数位逆变 ⇒「收 `IpcCommand` 的函数」**不可赋给**「收 `string` 的函数」。
 * 更关键的是机制层面：若签名收 `IpcCommand`，那条未知命令守卫在类型系统眼里就成了**不可达代码**
 * （调用方不可能传进契约外的命令），守卫测试只能靠 cast 造输入 = 自欺。收 `string`
 * 才让"运行时真的可能收到脏命令"在类型上诚实。收窄靠下面的类型谓词，**不用 `as`**。
 *
 * # 为什么只 `import type`，不 import `IPC_COMMANDS` 这个值
 * `api/client.ts` 要 import 本文件的 `demoInvoke`（分派点），本文件若再 import 它的
 * `IPC_COMMANDS` 常量，就是一个**运行期循环依赖**：`client.ts` 求值时会先拉起本模块，
 * 而本模块的模块体一旦读 `IPC_COMMANDS` 就撞上 TDZ。用「`demoBackend` 的自有键」做守卫，
 * 配合上面那张全覆盖网，键集合与 `IPC_COMMANDS` 由构造保证相等（并有一条断言钉住），
 * 于是本文件只需 `import type`（编译后擦除）⇒ 依赖图保持单向：`api/client` → `demo/backend`。
 *
 * # 108 条全部接线（占位与探针已一起退休）
 * 命令面已经全部落地 ⇒ 这里不再有「未实现」占位。曾经那套 `notImplemented(cmd)` 抛的是
 * **普通 `Error` + 英文开发者信息**（`not implemented: <cmd>`），不是 `IpcErrorPayload`：
 * 它给开发者看、不进词典、**不占错误码**（`contracts/error-codes.json` 冻结在 44 条），
 * 经 `callVia` 的 catch 归一化成 `ipc/invoke_failed`，与任何 invoker 失败同一条路径。
 * 它退休的对价是断言面**只增不减**（简报 §C）：`backend.test.ts` 的反向断言从 32 条扩到 40 条，
 * 而「分派真的到了 `demoBackend`」改由**已实现半边**（resolve 出内存库里的种子数据）证明——
 * 严格更强（不仅证明"到了"，还证明"读到了库"）。
 * ⚠ handler 仍然**可以**抛普通 `Error`（例如 `handlers/export.ts` 里「运行环境不支持 blob 下载」
 * 那一支）：同样归一化成 `ipc/invoke_failed`，同样不新增错误码。
 */
import type { IpcCommand } from '../api/client';
import { appEnvironment } from './handlers/app-environment';
import {
  actionBoard, actionUpdateStatus, contentGenerate, contentUpdateStatus, } from './handlers/action';
import {
  collectionBoard, collectionRecordGet, collectionRecordList, collectionRoundGet, collectionStart, collectionTaskRetry, } from './handlers/collection';
import {
  diagnosisAlertAcknowledge, diagnosisCompetitors, diagnosisEngines, diagnosisFunnel, diagnosisOverview, } from './handlers/diagnosis';
import {
  entityCardAutobuild, entityCardGet, entityCardRevisions, entityCardUpdateField, } from './handlers/entity-card';
import { faqAdd, faqDelete, faqGenerate, faqList, faqUpdate } from './handlers/faq';
import {
  keywordAdd, keywordDelete, keywordGenerate, keywordList, keywordUpdate, } from './handlers/keyword';
import { exportWriteFile } from './handlers/export';
import {
  factCheckList, factCheckResolve, insightCorrect, insightList, } from './handlers/insight';
import {
  projectArchive, projectCreate, projectDelete, projectGet, projectList, projectUpdate, } from './handlers/project';
import {
  projectExport, projectExportAssetsCsv, projectExportCompetitorsCsv, projectImport, } from './handlers/project-transfer';
import {
  promptItemAdd, promptItemDelete, promptItemUpdate, promptSetDedupe, promptSetDelete, promptSetGenerate, promptSetGet, promptSetList, promptSetRename, } from './handlers/prompt';
import { promptSetExportCsv, promptSetImportCsv } from './handlers/prompt-csv';
import {
  kbBoard, kbEntryAdd, kbEntryDelete, kbEntryUpdate, kbEntryVerify, kbGenerate } from './handlers/kb';
import {
  articleDirectionAdd,
  articleDirectionGenerate,
  articleDirectionList,
  articleTemplateDelete,
  articleTemplateList,
  articleTemplateSave,
} from './handlers/article';
import {
  articleList,
  articleScheduleList,
  articleScheduleRun,
  articleScheduleSave,
} from './handlers/article-schedule';
import {
  assetAdd,
  assetDelete,
  assetList,
  competitorDelete,
  competitorList,
  competitorReorder,
  competitorUpsert,
} from './handlers/relations';
import { reportRender } from './handlers/report';
import {
  searchBoard,
  searchBrowserCapture,
  searchBrowserOpen,
  searchOauthBegin,
  searchOpportunityUpdate,
  searchSourceRemove,
  searchSourceTest,
  searchSourceUpsert,
} from './handlers/search';
import { searchMetricImportCsv } from './handlers/search-import';
import { secretDelete, secretSet, secretStatus } from './handlers/secret';
import {
  siteBoard,
  siteChannelRemove,
  siteChannelTest,
  siteChannelUpsert,
  siteProfileSave,
} from './handlers/site';
import {
  sitePatchAdd,
  sitePatchDelete,
  sitePatchGenerate,
  sitePatchHistory,
  sitePatchSave,
  sitePatchTransition,
} from './handlers/site-patch';
import { llmModelsList } from './handlers/llm-models';
import {
  llmProviders,
  llmProviderTest,
  settingsGet,
  settingsUpdate,
} from './handlers/settings';
import { withLatency } from './latency';
import type { DemoHandler } from './types';
import { demoError } from './types';

/**
 * 99 条命令的假实现表——**全部是真 handler**，一个占位都不剩。
 * **逐条列出**（不许用循环批量生成：那就绕过了全覆盖网，也让"哪条命令归哪个 task"看不出来）。
 */
export const demoBackend: Record<IpcCommand, DemoHandler> = {
  // ---- M1 项目 / 实体卡 / 竞品 / 资产（21 条）----
  project_create: projectCreate,
  project_list: projectList,
  project_get: projectGet,
  project_update: projectUpdate,
  project_archive: projectArchive,
  project_delete: projectDelete,
  project_export: projectExport,
  project_import: projectImport,
  project_export_competitors_csv: projectExportCompetitorsCsv,
  project_export_assets_csv: projectExportAssetsCsv,
  entity_card_autobuild: entityCardAutobuild,
  entity_card_get: entityCardGet,
  entity_card_update_field: entityCardUpdateField,
  entity_card_revisions: entityCardRevisions,
  competitor_upsert: competitorUpsert,
  competitor_list: competitorList,
  competitor_delete: competitorDelete,
  competitor_reorder: competitorReorder,
  asset_add: assetAdd,
  asset_list: assetList,
  asset_delete: assetDelete,

  // ---- M2 Prompt 题库（11 条）----
  prompt_set_generate: promptSetGenerate,
  prompt_set_list: promptSetList,
  prompt_set_get: promptSetGet,
  prompt_set_rename: promptSetRename,
  prompt_set_delete: promptSetDelete,
  prompt_item_update: promptItemUpdate,
  prompt_item_add: promptItemAdd,
  prompt_item_delete: promptItemDelete,
  prompt_set_dedupe: promptSetDedupe,
  prompt_set_export_csv: promptSetExportCsv,
  prompt_set_import_csv: promptSetImportCsv,

  // ---- 设置 / 密钥 / 导出（8 条）----
  settings_get: settingsGet,
  settings_update: settingsUpdate,
  secret_set: secretSet,
  secret_status: secretStatus,
  secret_delete: secretDelete,
  llm_provider_test: llmProviderTest,
  llm_providers: llmProviders,
  export_write_file: exportWriteFile,

  // ---- M3 多引擎采集（6 条）----
  collection_board: collectionBoard,
  collection_round_get: collectionRoundGet,
  collection_start: collectionStart,
  collection_task_retry: collectionTaskRetry,
  collection_record_list: collectionRecordList,
  collection_record_get: collectionRecordGet,

  // ---- M4 回答解析与事实核查（4 条）----
  insight_list: insightList,
  insight_correct: insightCorrect,
  fact_check_list: factCheckList,
  fact_check_resolve: factCheckResolve,

  // ---- M5 诊断与归因（5 条）----
  diagnosis_overview: diagnosisOverview,
  diagnosis_competitors: diagnosisCompetitors,
  diagnosis_funnel: diagnosisFunnel,
  diagnosis_engines: diagnosisEngines,
  diagnosis_alert_acknowledge: diagnosisAlertAcknowledge,

  // ---- M6 GEO 行动中心（4 条）----
  action_board: actionBoard,
  action_update_status: actionUpdateStatus,
  content_generate: contentGenerate,
  content_update_status: contentUpdateStatus,

  // ---- M7 报告与分享（1 条）----
  report_render: reportRender,

  // ---- Plan B（2 条，🔴 demo 独有，桌面端点进来会报 unknown_command；差异 E-46 起）----
  app_environment: appEnvironment,
  llm_models_list: llmModelsList,

  // ---- M1.5 素材层（10 条，🔴 同样 demo 独有；差异 E-52 起）----
  keyword_list: keywordList,
  keyword_add: keywordAdd,
  keyword_update: keywordUpdate,
  keyword_delete: keywordDelete,
  keyword_generate: keywordGenerate,
  faq_list: faqList,
  faq_add: faqAdd,
  faq_update: faqUpdate,
  faq_delete: faqDelete,
  faq_generate: faqGenerate,

  // ---- M6.5 站点接入与补丁工作台（11 条，🔴 同样 demo 独有；差异 E-55 起）----
  site_board: siteBoard,
  site_profile_save: siteProfileSave,
  site_channel_upsert: siteChannelUpsert,
  site_channel_remove: siteChannelRemove,
  site_channel_test: siteChannelTest,
  site_patch_add: sitePatchAdd,
  site_patch_generate: sitePatchGenerate,
  site_patch_save: sitePatchSave,
  site_patch_transition: sitePatchTransition,
  site_patch_history: sitePatchHistory,
  site_patch_delete: sitePatchDelete,

  // ---- M1.2b 知识库（6 条，🔴 同样 demo 独有；差异 E-58 起、E-63）----
  kb_board: kbBoard,
  kb_entry_add: kbEntryAdd,
  kb_entry_update: kbEntryUpdate,
  kb_entry_delete: kbEntryDelete,
  kb_entry_verify: kbEntryVerify,
  kb_generate: kbGenerate,

  // ---- M6 文章管理（10 条，🔴 同样 demo 独有；差异 E-64 起）----
  article_direction_list: articleDirectionList,
  article_direction_add: articleDirectionAdd,
  article_direction_generate: articleDirectionGenerate,
  article_template_list: articleTemplateList,
  article_template_save: articleTemplateSave,
  article_template_delete: articleTemplateDelete,
  article_schedule_list: articleScheduleList,
  article_schedule_save: articleScheduleSave,
  article_schedule_run: articleScheduleRun,
  article_list: articleList,

  // ---- M5.5 站长数据（9 条；`search_oauth_begin` 与浏览器两条 Rust 已注册，demo 明确拒绝）----
  search_board: searchBoard,
  search_oauth_begin: searchOauthBegin,
  search_source_upsert: searchSourceUpsert,
  search_source_remove: searchSourceRemove,
  search_source_test: searchSourceTest,
  search_metric_import_csv: searchMetricImportCsv,
  search_opportunity_update: searchOpportunityUpdate,
  search_browser_open: searchBrowserOpen,
  search_browser_capture: searchBrowserCapture,
};

/**
 * 运行时收窄：`cmd` 是不是这张表自己的键。
 *
 * 用 `Object.hasOwn` 而不是 `in`：`in` 会命中 `Object.prototype` 上的 `toString` /
 * `constructor`，于是 `demoInvoke('toString')` 会去**调用原型方法**，抛出来的是一句
 * 与契约无关的 `TypeError`，而不是 `ipc/unknown_command`。
 */
function isDemoCommand(cmd: string): cmd is IpcCommand {
  return Object.hasOwn(demoBackend, cmd);
}

/**
 * demo 运行时的 invoker：与 `@tauri-apps/api/core` 的 `invoke` 同形，
 * 由 `api/client.ts` 的分派点在 `runtime === 'demo'` 时注入。
 *
 * - 契约外的命令 ⇒ reject `ipc/unknown_command`（契约 params 只有一个键 `cmd`），
 *   这是 `contracts/error-codes.json` 里那条 note 点名的**唯一发射点**；
 * - 契约内的命令 ⇒ 先等一段假延迟（让 loading 态在浏览器里看得见），再交给对应 handler。
 *
 * @returns handler 的返回值。末尾那一次 `as T` 是 IPC 边界上**不可避免**的断言
 *   （`IpcInvoker` 的 `T` 由调用方指定，`invoke<T>` 同理）：handler 的返回类型是 `unknown`，
 *   契约由 `demoBackend` 的键集全覆盖 + Task 12–14 各 handler 的返回类型保证。
 */
export async function demoInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDemoCommand(cmd)) {
    throw demoError('ipc/unknown_command', { cmd });
  }
  await withLatency();
  return (await demoBackend[cmd](args ?? {})) as T;
}

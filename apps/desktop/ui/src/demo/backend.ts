/**
 * demo 假后端：`IPC_COMMANDS` 那 40 条命令在浏览器里的替身（AGENTS 规则 8）。
 *
 * # 全覆盖网（编译期）+ 键集相等（运行期）
 * `demoBackend` 标注成 `Record<IpcCommand, DemoHandler>`：`IpcCommand` 是 40 个字面量的联合，
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
 * # 本轮 40 条 handler **全部未实现**（骨架）
 * 抛的是**普通 `Error` + 英文开发者信息**（`not implemented: <cmd>`），不是 `IpcErrorPayload`：
 * 它给开发者看、不进词典、**不占错误码**（`contracts/error-codes.json` 冻结在 43 条）。
 * 经 `callVia` 的 catch 会归一化成 `ipc/invoke_failed`，与任何 invoker 失败同一条路径。
 * Task 12 填 M1 的 21 条、Task 13 填 M2 的 11 条、Task 14 填设置/密钥/导出的 8 条。
 */
import type { IpcCommand } from '../api/client';
import { withLatency } from './latency';
import type { DemoHandler } from './types';
import { demoError } from './types';

const NOT_IMPLEMENTED = 'not implemented: ';

/** 造一条「未实现」的开发者诊断串（英文、含命令名，便于在控制台一眼定位是哪条命令没接）。 */
function notImplemented(cmd: IpcCommand): DemoHandler {
  return () => {
    throw new Error(`${NOT_IMPLEMENTED}${cmd}`);
  };
}

/**
 * 40 条命令的假实现表。**逐条列出**（不许用循环批量生成：那就绕过了全覆盖网，
 * 也让"哪条命令归哪个 task"看不出来）。
 */
export const demoBackend: Record<IpcCommand, DemoHandler> = {
  // ---- M1 项目 / 实体卡 / 竞品 / 资产（21 条 ⇒ Task 12）----
  project_create: notImplemented('project_create'),
  project_list: notImplemented('project_list'),
  project_get: notImplemented('project_get'),
  project_update: notImplemented('project_update'),
  project_archive: notImplemented('project_archive'),
  project_delete: notImplemented('project_delete'),
  project_export: notImplemented('project_export'),
  project_import: notImplemented('project_import'),
  project_export_competitors_csv: notImplemented('project_export_competitors_csv'),
  project_export_assets_csv: notImplemented('project_export_assets_csv'),
  entity_card_autobuild: notImplemented('entity_card_autobuild'),
  entity_card_get: notImplemented('entity_card_get'),
  entity_card_update_field: notImplemented('entity_card_update_field'),
  entity_card_revisions: notImplemented('entity_card_revisions'),
  competitor_upsert: notImplemented('competitor_upsert'),
  competitor_list: notImplemented('competitor_list'),
  competitor_delete: notImplemented('competitor_delete'),
  competitor_reorder: notImplemented('competitor_reorder'),
  asset_add: notImplemented('asset_add'),
  asset_list: notImplemented('asset_list'),
  asset_delete: notImplemented('asset_delete'),

  // ---- M2 Prompt 题库（11 条 ⇒ Task 13）----
  prompt_set_generate: notImplemented('prompt_set_generate'),
  prompt_set_list: notImplemented('prompt_set_list'),
  prompt_set_get: notImplemented('prompt_set_get'),
  prompt_set_rename: notImplemented('prompt_set_rename'),
  prompt_set_delete: notImplemented('prompt_set_delete'),
  prompt_item_update: notImplemented('prompt_item_update'),
  prompt_item_add: notImplemented('prompt_item_add'),
  prompt_item_delete: notImplemented('prompt_item_delete'),
  prompt_set_dedupe: notImplemented('prompt_set_dedupe'),
  prompt_set_export_csv: notImplemented('prompt_set_export_csv'),
  prompt_set_import_csv: notImplemented('prompt_set_import_csv'),

  // ---- 设置 / 密钥 / 导出（8 条 ⇒ Task 14）----
  settings_get: notImplemented('settings_get'),
  settings_update: notImplemented('settings_update'),
  secret_set: notImplemented('secret_set'),
  secret_status: notImplemented('secret_status'),
  secret_delete: notImplemented('secret_delete'),
  llm_provider_test: notImplemented('llm_provider_test'),
  llm_providers: notImplemented('llm_providers'),
  export_write_file: notImplemented('export_write_file'),
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

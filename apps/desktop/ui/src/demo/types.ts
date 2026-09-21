/**
 * demo 假后端自己的类型与错误构造 helper。
 *
 * ⚠ **DTO 一律从 `src/api/types.ts` 取**（那是与 Rust serde 同形的唯一真值源，AGENTS 规则 8）：
 * 本文件**不许**另造一套平行 DTO，否则 demo 与真实后端的形状会各自漂移，而 demo 的全部价值
 * 恰恰是「让产品负责人看到真实数据长什么样」。这里只放 demo 独有的东西：
 * `DemoHandler` / `DemoDb` / 内部辅助类型 / `demoError`。
 *
 * # 为什么 `demoError` 放在本文件而不是 `backend.ts`
 * Task 12–14 的 `src/demo/handlers/**` 要用它构造错误，而 `backend.ts` 那时会反过来 import
 * 那些 handler ⇒ 放 `backend.ts` 就是一个运行期循环依赖。本文件是**叶子**（只 `import type`
 * 别的模块），谁都能安全 import。
 *
 * # 语言约束
 * 本文件的**非注释部分不含任何 CJK**：demo 代码生成的字符串（错误 message、派生 id / label）
 * 一律 ASCII / 语言中立（简报 §B-11）。中文只出现在 `src/demo/seed/**` 的**数据**里——
 * 那是「后端数据」的替身，不是界面文案，也不归词典管。
 */
import type {
  AppSettings,
  Competitor,
  EntityCard,
  EntityCardRevision,
  IntentCategory,
  IpcErrorPayload,
  Project,
  ProjectAsset,
  PromptItem,
  PromptSet,
  PromptSource,
  ProviderInfo,
  SecretStatus,
} from '../api/types';

/**
 * 一条命令的假实现。`args` 的形状与 Tauri 命令的 `rename_all = "snake_case"` 入参一致。
 *
 * 刻意**不**泛型化返回值（`DemoHandler<T>` 那种写法会让 `Record<IpcCommand, DemoHandler>`
 * 的全覆盖网失效）：返回 `unknown`，由 `demoInvoke<T>` 在 IPC 边界上一次性收窄，
 * 与 `@tauri-apps/api/core` 的 `invoke<T>` 同族。
 */
export type DemoHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/**
 * `DemoDb.settings` 的形状：设置项 + 内置服务商预设。
 *
 * 两者放一起是因为后端也是这么给的：`settings_get` 回 `AppSettings`，`llm_providers` 回
 * `LlmProvider::all()` 映射成的 `ProviderInfo[]`（`settings_service.rs` 的
 * `impl From<LlmProvider> for ProviderInfo`）。demo 侧共用同一份种子，Task 14 直接消费，
 * **不要另造一张 provider 表**。
 */
export interface DemoSettings {
  app: AppSettings;
  providers: ProviderInfo[];
}

/**
 * demo 的内存库：每次页面刷新 / 每个测试都从静态种子重建（「刷新即重置」）。
 *
 * ⚠ 题库有**两份视图**：`promptItems` 是归一化真值（靠 `set_id` 归属），
 * `promptSets[].items` 是 DTO 要求的内嵌副本。`structuredClone` 会切断两者的引用共享，
 * 所以 handler 改条目时必须同时更新两处（或以 `promptItems` 为准重组）。
 * 种子侧的一致性由 `src/demo/seed.test.ts` 钉住。
 */
export interface DemoDb {
  projects: Project[];
  competitors: Competitor[];
  assets: ProjectAsset[];
  entityCards: EntityCard[];
  revisions: EntityCardRevision[];
  promptSets: PromptSet[];
  promptItems: PromptItem[];
  settings: DemoSettings;
  /**
   * provider 档案（profiles）**刻意留空**：档案制是 Plan B/C 的契约，现在造一份形状必然漂移
   * （简报 §B-10）。`unknown[]` 而不是自造 DTO，就是为了让「往里塞东西」这件事在类型上显眼。
   */
  profiles: unknown[];
  /** 钥匙串状态。规则 3：只有 `secret_ref` 引用串，绝不含任何形如 API Key 的值。 */
  secrets: SecretStatus[];
}

/**
 * 种子题库的**紧凑行**（简报 §B-3）。
 *
 * 只写「文案本身 + 语义字段」：`id` / `set_id` / `position` / `repeat_count` / `competitor_ids`
 * 由 `seed/prompt-sets.ts` 里的纯函数从下标推导。
 * 🔴 `text` **必须是字面量中文串**，绝不许程序化拼出来（`` `${brand}${intent}哪个好` `` 那种）：
 * 那等于在 demo 里实现「模板展开」，直接违反 AGENTS 规则 9，也会把「演示数据」变成
 * 「看起来像真算过的数据」。
 */
export interface PromptSeedRow {
  /** 字面量中文问法（照产品文档附录 B 的口语化风格）。 */
  text: string;
  intent: IntentCategory;
  /** 1~5。 */
  weight: number;
  group_name: string | null;
  tags: readonly string[];
  source: PromptSource;
  /**
   * 指向 `seed/projects.ts` 里**同项目竞品**的下标（`SEED_ACTIVE_COMPETITOR_IDS`）。
   * 空数组 = 这条不做品牌对比。下标越界由 `seed.test.ts` 抓。
   */
  competitors: readonly number[];
}

/**
 * 造一个 `IpcErrorPayload` 形状的错误（简报 §B-7）。
 *
 * - **只造形状、不新增码**：`contracts/error-codes.json` 冻结在 43 条，`code` 必须是里面已有的；
 * - **`params` 的键集必须与该 code 登记的完全一致**（多一个少一个都算违约：词典插值会出空洞）。
 *   本 helper **不校验键集**——校验需要把契约表复制一份进前端，那必然漂移；
 *   改由 `src/i18n/error-codes.test.ts`（词典侧）与调用点的测试（demo 侧）两头钉；
 * - `message` 是**语言中立紧凑串** `{code} {k}={v}…`，键按字典序，与后端
 *   `IpcError::with_params`（`apps/desktop/src-tauri/src/error.rs`，BTreeMap 排序）逐字同构。
 *   展示一律走 `describeIpcError(error, t)`，**绝不**把 message 端给用户（AGENTS 规则 7）；
 * - ⚠ **规则 3**：`params` 的值里绝不能出现密钥材料。后端那一侧还有 `redact()` 兜底，
 *   demo 这边没有 ⇒ 写 handler 时就不要把用户输入的 Key 放进 params。
 *
 * @param code `contracts/error-codes.json` 里已登记的稳定错误码。
 * @param params 该 code 登记的 params，键集必须逐字一致。
 * @param detail 结构化上下文，默认 `null`（与 DTO 的 `detail?: unknown | null` 对齐）。
 */
export function demoError(
  code: string,
  params: Record<string, string> = {},
  detail: unknown | null = null,
): IpcErrorPayload {
  const message = Object.keys(params)
    .sort()
    .reduce((acc, key) => `${acc} ${key}=${params[key]}`, code);
  return { code, params: { ...params }, message, detail };
}

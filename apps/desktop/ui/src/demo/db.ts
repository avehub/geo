/**
 * demo 的内存库：从静态种子深拷一份，**刷新即重置**（简报 §B-2 / §B-4）。
 *
 * - `createDemoDb()`：纯函数式的重建，每次返回一份**互不共享引用**的新数据；
 * - `getDemoDb()`：进程内单例（懒建），handler 一律经它拿库；
 * - `resetDemoDb()`：把单例换成新建的一份 ⇒ 「刷新即重置」的语义落点，
 *   测试的 `afterEach` 也要调它，否则用例之间会串味。
 *
 * 深拷用 `structuredClone`（jsdom / node 下都可用，`src/test/invoke-mock.ts` 已在用）：
 * 直接把种子对象交出去的话，handler 的第一次写操作就会**永久改掉种子模块**，
 * 于是"刷新即重置"变成"第一次改完就再也回不去了"。
 *
 * ⚠ 题库在库里有**两份视图**（`promptItems` 归一化 + `promptSets[].items` 内嵌副本），
 * `structuredClone` 会切断它们的引用共享 ⇒ Task 12 的 handler 改条目时必须同时更新两处，
 * 或以 `promptItems` 为真值重组。详见 `types.ts` 的 `DemoDb` 注释。
 */
import type { DemoDb } from './types';
import type {
  Competitor,
  EntityCard,
  EntityCardRevision,
  Project,
  ProjectAsset,
  PromptItem,
  PromptSet,
} from '../api/types';
import { SEED_ENTITY_CARD_REVISIONS, SEED_ENTITY_CARDS } from './seed/entity-cards';
import { SEED_ASSETS, SEED_COMPETITORS, SEED_PROJECTS } from './seed/projects';
import { SEED_PROMPT_ITEMS, SEED_PROMPT_SETS } from './seed/prompt-sets';
import { SEED_SETTINGS } from './seed/settings';

/**
 * 钥匙串引用串：`keyring://llm/<provider 稳定 id>`。
 *
 * 与后端同形（`apps/desktop/src-tauri/src/services/settings_service.rs` 的 `SECRET_KIND = "llm"`
 * + `secret_ref(...)`），且**无论 `configured` 真假都返回这个 ref**（`configured` 只表示
 * 钥匙串里有没有值）。纯函数、ASCII、同输入同输出（§B-4 / §B-11）。
 *
 * ⚠ AGENTS 规则 3：库里只许有这个**引用串**，绝不含任何形如 API Key 的值。
 */
export function demoSecretRef(provider: string): string {
  return `keyring://llm/${provider}`;
}

/** 从种子重建一份全新的库。 */
export function createDemoDb(): DemoDb {
  return structuredClone({
    projects: SEED_PROJECTS,
    competitors: SEED_COMPETITORS,
    assets: SEED_ASSETS,
    entityCards: SEED_ENTITY_CARDS,
    revisions: SEED_ENTITY_CARD_REVISIONS,
    promptSets: SEED_PROMPT_SETS,
    promptItems: SEED_PROMPT_ITEMS,
    settings: SEED_SETTINGS,
    // 档案制（provider profiles）是 Plan B/C 的契约，本轮刻意不造形状（简报 §B-10）⇒ 留空。
    profiles: [],
    // 7 个内置服务商各一条「未配置」状态：形状与 secret_ref 都照后端真值源，
    // Task 14 的 secret_set / secret_status / secret_delete 只需在这份数组上翻 configured。
    secrets: SEED_SETTINGS.providers.map((info) => ({
      provider: info.provider,
      configured: false,
      secret_ref: demoSecretRef(info.provider),
    })),
  });
}

let db: DemoDb | null = null;

/** 进程内单例；第一次调用时从种子建。 */
export function getDemoDb(): DemoDb {
  db ??= createDemoDb();
  return db;
}

/** 丢弃当前库、按种子重建（页面刷新 / 测试复位）。 */
export function resetDemoDb(): void {
  db = createDemoDb();
}

// ---------------------------------------------------------------------------
// 只读派生 helper（Task 12 · 简报 §B-12）
// ---------------------------------------------------------------------------
//
// 🔴 **这里是「题库两份视图谁是真值」的唯一裁定点。**
// `DemoDb` 里题库有两份视图：`promptItems`（归一化，靠 `set_id` 归属）与
// `promptSets[].items`（DTO 要求的内嵌副本），`createDemoDb()` 的 `structuredClone`
// 已经**切断**两者的引用共享。裁定：
// - **set 级**（有几份题库、挂在哪个项目下）真值 = `db.promptSets`；
// - **item 级**（一份题库里有哪些条目）真值 = `db.promptItems`；内嵌副本只服务 DTO 形状。
// 于是「读一份完整题库」= `promptSetWithItems()`：set 级取自 `promptSets`、items 取自
// `promptItems`。M1 的 handler 一律经这几个 helper 读，**不许**各写各的过滤——
// 那正是复审警告的「每个改动点都要手动同步两处」。
// ⚠ 真正把两份视图合并成单一真值归 Task 13（它拥有 prompt 的写路径）；本轮只读不合并，
// 但 helper 的形状就是给 Task 13 直接复用的。
//
// 排序一律照仓储层的 `ORDER BY`（真值源见每个 helper 的注释），因为界面看到的顺序
// 就是后端给的顺序；`filter` 已经复制过数组，所以 `sort` 就地排不会动到库里的顺序。

/** `repo/project.rs`：按 id 取一行。 */
export function projectById(db: DemoDb, id: string): Project | undefined {
  return db.projects.find((project) => project.id === id);
}

/** `repo/competitor.rs`：`ORDER BY position ASC, id ASC`。 */
export function competitorsOf(db: DemoDb, projectId: string): Competitor[] {
  return db.competitors
    .filter((row) => row.project_id === projectId)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

/** `repo/asset.rs`：`ORDER BY created_at ASC, id ASC`。 */
export function assetsOf(db: DemoDb, projectId: string): ProjectAsset[] {
  return db.assets
    .filter((row) => row.project_id === projectId)
    .sort(
      (left, right) =>
        ascending(left.created_at, right.created_at) || left.id.localeCompare(right.id),
    );
}

/** `repo/entity_card.rs` 的 `get()`：没有卡就是没有卡（`Option`，不是 not_found）。 */
export function entityCardOf(db: DemoDb, projectId: string): EntityCard | undefined {
  return db.entityCards.find((card) => card.project_id === projectId);
}

/** `repo/entity_card.rs` 的 `revisions()`：`ORDER BY edited_at DESC, rowid DESC`（新的在前）。 */
export function revisionsOf(db: DemoDb, projectId: string): EntityCardRevision[] {
  return db.revisions
    .map((revision, index) => ({ revision, index }))
    .filter((entry) => entry.revision.project_id === projectId)
    .sort(
      (left, right) =>
        descending(left.revision.edited_at, right.revision.edited_at) || right.index - left.index,
    )
    .map((entry) => entry.revision);
}

/** **set 级真值**：`repo/prompt_set.rs` 的 `list_by_project`（`ORDER BY version DESC, created_at DESC`）。 */
export function promptSetsOf(db: DemoDb, projectId: string): PromptSet[] {
  return db.promptSets
    .filter((set) => set.project_id === projectId)
    .sort(
      (left, right) =>
        right.version - left.version || descending(left.created_at, right.created_at),
    );
}

/** **item 级真值**：`repo/prompt_set.rs` 的条目查询（`ORDER BY position ASC, rowid ASC`）。 */
export function promptItemsOf(db: DemoDb, setId: string): PromptItem[] {
  return db.promptItems
    .filter((item) => item.set_id === setId)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

/**
 * 把「set 级真值 + item 级真值」拼成 DTO 要求的形状（`PromptSet.items` 内嵌）。
 * `project_export` 走它，所以导出的题库**永远**与归一化视图一致，不会带上过期的内嵌副本。
 */
export function promptSetWithItems(db: DemoDb, set: PromptSet): PromptSet {
  return { ...set, items: promptItemsOf(db, set.id) };
}

/** `ProjectDetail.prompt_set_count`：只数 set 级真值。 */
export function promptSetCountOf(db: DemoDb, projectId: string): number {
  return promptSetsOf(db, projectId).length;
}

/** RFC3339 时间戳升序比较（用 `Date.parse` 而不是字符串比：秒/毫秒精度混排时字符串比会说谎）。 */
function ascending(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

/** RFC3339 时间戳降序比较。 */
function descending(left: string, right: string): number {
  return Date.parse(right) - Date.parse(left);
}

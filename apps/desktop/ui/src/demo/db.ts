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

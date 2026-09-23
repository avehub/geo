/**
 * 测试专用：读仓库根下的任意文件（**只读**，跨语言真值源核对用）。
 *
 * # 为什么要这个 helper
 * 前端有两类断言必须把**Rust 真值源**当输入，而不是手抄一份常量：
 * ① `crates/geo-domain/src/csv_io.rs` 的 `TAG_SEPARATOR`（demo 侧镜像成 `CSV_TAG_SEPARATOR`）；
 * ② `crates/geo-domain/src/asset.rs` 的 `AssetKind` 变体与 `label_zh()`。
 * 手抄的镜像漂了不会红——那正是 `Baike` / `百科词条` 当初漏过去的形状。
 *
 * # 为什么不用另外两条更短的路（`i18n/dictionary.test.ts` 里已实测过，证据在 task-7-report.md）
 * - `new URL('…', import.meta.url)` + `fileURLToPath`：测试跑在 jsdom 环境里，`import.meta.url`
 *   不是 `file://` URL，`fileURLToPath` 直接抛 `TypeError: The URL must be of scheme file`。
 * - Vite 的 `?raw` 导入：`crates/**` 在 Vite root（`apps/desktop/ui`）之外，转换阶段报
 *   `Denied ID …/crates/geo-domain/src/error.rs?raw`。
 *
 * 向上查找而不是写死 `../../..`：门禁命令 `pnpm --dir apps/desktop/ui run test` 的 cwd 是
 * `apps/desktop/ui`，但在仓库根直接跑 vitest 时 cwd 是仓库根，两种都要能过。
 *
 * ⚠ 抛错文案一律 ASCII：本文件在 `i18n/no-hardcoded-strings.test.ts` 的残留扫描面里
 * （`src/test/**` 也算生产源码），注释之外的中文会撞例外表的精确计数。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** 从 `process.cwd()` 往上最多找 8 层仓库根，读到 `segments` 拼出的那个文件。 */
export function readRepoFile(...segments: string[]): string {
  const relative = join(...segments);
  let dir = resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`repo file not found: ${relative} (walked up 8 levels from ${process.cwd()})`);
}

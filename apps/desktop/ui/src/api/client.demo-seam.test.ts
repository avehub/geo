/**
 * demo 接缝的**端到端**证明：真 `runtime` 模块 + 真分派点（Task 10 复审 Minor 3 ⇒ 简报 §B-12②）。
 *
 * 与 `client.demo-runtime.test.ts` 分工不重叠：
 * - 那一份 `vi.mock('./runtime')` 把「检测结论」**直接喂**给分派点 ⇒ 证「mock 成 demo 时分派正确」；
 * - 本文件**不 mock**，用「摘掉 `window.__TAURI_INTERNALS__` + 先求值 `./runtime`」拿到**真的**
 *   `'demo'` ⇒ 证「真检测出 demo 时确实绕开了 Tauri invoke」。中间那一环（检测结论真的传到了
 *   分派点）只有本文件覆盖，它也是用户原始报错 `Cannot read properties of undefined (reading 'invoke')`
 *   在浏览器里不会再出现的**唯一测试级证明**——那条报错是 `TypeError`，本文件断言 rejection 不是它。
 *
 * 🔴 为什么「先 `await import('./runtime')`」是必需的、不是保险起见（求值顺序）：
 * `client.ts` 先 import `@tauri-apps/api/core`（测试里别名到 `src/test/invoke-mock.ts`），
 * 后 import `./runtime`；而 invoke-mock 在**模块作用域**里 `Object.assign(window, { __TAURI_INTERNALS__ })`。
 * 所以「删全局 → `resetModules` → 直接 `import('./client')`」这个看起来最自然的写法，会在 shim
 * 重新求值时把全局**装回去**，然后 `runtime.ts` 才求值 ⇒ 拿到 `'tauri'`，用例静默变成 tauri 分支（空洞）。
 * 先单独求值 `./runtime` 让它在「无全局」的窗口里冻住常量，再 `import('./client')` 命中注册表里的
 * 同一份 ⇒ 顺序无关、确定。下面 `loadDemoSeam()` 的三行顺序就是这个配方，**不许调换**。
 *
 * 🔴 为什么 `mockInvoke` 必须在 `resetModules()` **之后**动态 import：
 * `vi.resetModules()` 会让 `invoke-mock.ts` 重新求值 ⇒ 出现**第二个**计数器实例。文件顶部静态
 * import 拿到的是 setup 期那一个，而新求值的 `client.ts` 绑的是新的那一个 ⇒「零调用」会在两边
 * 根本不是同一个计数器的情况下**恒绿**（空洞）。动态 import 与 `client.ts` 命中同一个注册表条目，
 * 计数器才是同一个实例；最后那条「正向对照」用例把这件事本身也钉住了。
 *
 * ⚠ 主用例钉**两个半边**：已接真 handler 的命令（本轮 `project_list`）**resolve 出真种子数据**；
 * 仍是骨架的命令（取 `demo/backend.ts` 里仍由 `notImplemented()` 占位的那条；
 * 探针随落地逐轮后移，40 条全落地后退休）
 * **reject 出英文 not-implemented**。两个半边都**不碰 Tauri shim**。
 * 「`mockInvoke` 零调用」与「不是 `TypeError`」是**不变量**，它们才是本用例的主断言，与探针位无关。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID, SEED_PROJECTS } from '../demo/seed/projects';

const INTERNALS = '__TAURI_INTERNALS__';
/** 与 `demo/backend.ts` 的 `NOT_IMPLEMENTED` 措辞对齐（独立写死，不 import 生产常量免得自我印证）。 */
const NOT_IMPLEMENTED = 'not implemented: ';
const INVOKE_FAILED = 'ipc/invoke_failed';
const CJK = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;

type WindowBag = Record<string, unknown>;

/** invoke-mock 在模块作用域装上去的那个 shim 的形状（只用到 `invoke`）。 */
interface InternalsShim {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function internalsOf(target: Window): InternalsShim | undefined {
  return (target as unknown as WindowBag)[INTERNALS] as InternalsShim | undefined;
}

/** 进本文件时（setup 期）装着的那个 shim，afterEach 原样还回去。 */
const savedInternals = internalsOf(window);

/**
 * 按配方装载「真检测 + 真分派」这一套（顺序见文件头注释，不许调换）。
 * 三个模块都走**动态** import，类型由 TS 自己推断 ⇒ 不需要 `typeof import(…)` 那种写法
 * （`@typescript-eslint/consistent-type-imports` 也禁止它）。
 */
async function loadDemoSeam() {
  const { runtime } = await import('./runtime');
  const client = await import('./client');
  const { mockInvoke } = await import('../test/invoke-mock');
  return { runtime, client, mockInvoke };
}

beforeEach(() => {
  delete (window as unknown as WindowBag)[INTERNALS];
  vi.resetModules();
});

afterEach(() => {
  (window as unknown as WindowBag)[INTERNALS] = savedInternals;
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('api/client · demo 接缝（真检测 + 真分派，不 mock runtime）', () => {
  it('前置事实：这条路真的检测成 demo（否则整份文件都是空洞的）', async () => {
    const { runtime } = await loadDemoSeam();

    expect(runtime).toBe('demo');
  });

  it('demo 分派一次都没碰 Tauri invoke shim，rejection 也不是 TypeError', async () => {
    const { client, mockInvoke } = await loadDemoSeam();

    // 已实现半边：resolve 出**真种子数据**（按种子 id / brand_name 断言，不重打字面量）。
    const rows = await client.projectList({});
    expect(rows.map((row) => row.id)).toContain(SEED_ACTIVE_PROJECT_ID);
    expect(rows.map((row) => row.brand_name)).toContain(SEED_PROJECTS[0].brand_name);
    expect(rows.map((row) => row.id)).not.toContain(SEED_ARCHIVED_PROJECT_ID);

    // 主断言①：真检测结论 + 真分派点，Tauri invoke 一次都没被调用。
    // ⚠ 上面那条命令现在是**成功**的：成功而不碰 shim，才是「浏览器里那句 invoke 报错不会再出现」的判据。
    expect(mockInvoke.callsOf('project_list')).toHaveLength(0);

    // 未实现探针半边：仍是骨架的命令 reject 英文 not-implemented，归一化成 ipc/invoke_failed。
    const error: unknown = await client.settingsGet().catch((cause: unknown) => cause);
    expect(mockInvoke.callsOf('settings_get')).toHaveLength(0);
    // 主断言②：用户原始报错 `Cannot read properties of undefined (reading 'invoke')` 是 TypeError，
    // 所以「不是 TypeError」才是「浏览器里那句密码式报错不会再出现」的判据。
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error).toBeInstanceOf(client.IpcRequestError);
    if (!(error instanceof client.IpcRequestError)) throw new Error('expected IpcRequestError');
    expect(error.code).toBe(INVOKE_FAILED);
    // 探针位随 handler 落地逐轮后移；与 client.demo-runtime.test.ts 用同一个契约常量。
    expect(error.message).toContain(`${NOT_IMPLEMENTED}settings_get`);
    expect(error.message).not.toMatch(CJK);
  });

  it('正向对照：同一个计数器数得到直接调用 shim 的那一次（证明「零调用」不是读错了实例）', async () => {
    const { client, mockInvoke } = await loadDemoSeam();
    const shim = internalsOf(window);
    expect(typeof shim?.invoke).toBe('function');

    await shim?.invoke('project_list', {}).catch(() => undefined);
    expect(mockInvoke.callsOf('project_list')).toHaveLength(1);

    // 同一个实例、同一个用例里：demo 分派那条路仍然一次都没走 invoke。
    await client.settingsGet().catch(() => undefined);
    expect(mockInvoke.callsOf('settings_get')).toHaveLength(0);
  });
});

/**
 * demo 接缝的**端到端**证明：真 `runtime` 模块 + 真分派点（本文件**不** mock 任何东西）。
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
 * ⚠ 主用例钉**三个半边**，三个都**不碰 Tauri shim**：
 * ① 已接真 handler 的命令 **resolve 出内存库里的真种子数据**（两个模块各证一次 ⇒ 不是对某一条凑巧成立）；
 * ② demo handler 发出的**契约错误 payload** 穿过同一条接缝后 code / params 都不被吞掉；
 * ③ 上面两条路上 `mockInvoke` 都是**零调用**。
 * 「`mockInvoke` 零调用」与「不是 `TypeError`」是**不变量**，它们才是本用例的主断言。
 *
 * 🔴 这里曾经还挂着半个**移动探针**（挑一条仍是骨架的命令，断言它 reject 出英文 not-implemented、
 * 归一化成 `ipc/invoke_failed`）；命令面全部接线之后它无处可移 ⇒ 退休。退休不算强度下降：
 * 「分派真的到了假后端」由 ① 接管（严格更强：不仅证明"到了"，还证明"读到了内存库"），
 * 「错误穿过接缝不降级」这一维由 ② 接管（它钉的是**契约码原样透传**，比 `ipc/invoke_failed` 更细）。
 *
 * 🔴 但「普通 `Error` → `ipc/invoke_failed`」这一维**不能没人钉**：
 * 那条归一化路径是**活的**——`demo/handlers/export.ts:77-80` 在运行环境不支持 blob 下载时抛的
 * 就是普通 `Error`（`demo/backend.ts:34-35` 明写了 handler 仍然可以这么抛）。所以本文件留了一条
 * **永久探针**：它不随命令面变化而失效，钉的是「非契约类失败也不许裸奔到调用方」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID, SEED_PROJECTS } from '../demo/seed/projects';
import { SEED_SETTINGS } from '../demo/seed/settings';

const INTERNALS = '__TAURI_INTERNALS__';
const INVOKE_FAILED = 'ipc/invoke_failed';
/** demo handler 在命令入参认不出时发的那条码（`settings_service.rs:270-277` 的 `parse_provider`）。 */
const LLM_CONFIG = 'llm/config';
const UNKNOWN_PROVIDER = 'no_such_provider';
const CJK = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;
/** 导出文件名与内容（纯数据，demo 不发请求也不落盘）。 */
const EXPORT_NAME = 'demo-export.csv';
const EXPORT_BODY = 'brand,intent\nDemo Brand,pricing_plan\n';

/**
 * 只含可选成员的 `URL` 视图：永久探针要把 `createObjectURL` **摘掉**来造「运行环境不支持
 * blob 下载」这个前提（手法与 `demo/handlers/export.test.ts` 里那条守卫用例一致）。
 */
interface BlobUrlApi {
  createObjectURL?: (blob: unknown) => string;
}

const urlApi = URL as unknown as BlobUrlApi;

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

    // 已实现半边（第二条）：设置命令也 resolve 出内存库里的种子数据 ⇒ 分派对每条命令都成立。
    const settings = await client.settingsGet();
    expect(settings).toEqual(SEED_SETTINGS.app);
    expect(mockInvoke.callsOf('settings_get')).toHaveLength(0);

    // 错误半边（探针退休后接管「错误穿过接缝不降级」这一维）：demo handler 发的契约 payload
    // 经 `callVia` 归一化后 code / params 原样透传，**不落进** `ipc/invoke_failed` 那一桶。
    const error: unknown = await client
      .secretStatus(UNKNOWN_PROVIDER)
      .catch((cause: unknown) => cause);
    expect(mockInvoke.callsOf('secret_status')).toHaveLength(0);
    // 主断言②：用户原始报错 `Cannot read properties of undefined (reading 'invoke')` 是 TypeError，
    // 所以「不是 TypeError」才是「浏览器里那句密码式报错不会再出现」的判据。
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error).toBeInstanceOf(client.IpcRequestError);
    if (!(error instanceof client.IpcRequestError)) throw new Error('expected IpcRequestError');
    expect(error.code).toBe(LLM_CONFIG);
    expect(error.code).not.toBe(INVOKE_FAILED);
    expect(error.params).toEqual({ reason: 'unknown_provider', value: UNKNOWN_PROVIDER });
    expect(error.message).not.toMatch(CJK);
  });

  // 🔴 永久探针（Task 14 复审 Minor 1）：`ipc/invoke_failed` 这一维必须**一直有人钉**。
  // 它钉的是「handler 抛的**普通 Error**（不是契约 payload）穿过同一条接缝后被归一化」，
  // 活的走这条路的代码是 `demo/handlers/export.ts:77-80`（运行环境不支持 blob 下载）。
  it('永久探针：handler 抛的普通 Error 归一化成 ipc/invoke_failed，零调用不变量照样成立', async () => {
    const { client, mockInvoke } = await loadDemoSeam();

    // 🔴 **白盒造前提**（窄桩；复审 Minor 1 要求「先实测再定」，实测结论写在下面）：
    // 不装桩时这条命令在本环境里是**成功**的——`URL.createObjectURL` 与 jsdom 的 `Blob` 配套可用，
    // `client.exportWriteFile(...)` 直接 resolve 出文件名（红输出 `/tmp/t14r1/red.txt:23` 留了证据：
    // `expected 'demo-export.csv' to be an instance of IpcRequestError`）⇒ `export.ts:78` 那道守卫
    // 自然走不到。所以这里只摘掉**这一个**静态方法（不桩 `Blob`、不桩 `document`、不碰分派链），
    // 让「运行环境不支持 blob 下载」这一支如实触发；它在真浏览器里是活的（老 WebView 没有 blob 下载，
    // `backend.ts:34-35` 明写了 handler 仍然可以抛普通 `Error`）。`finally` 原样还回去，不泄漏。
    const savedCreateObjectURL = urlApi.createObjectURL;
    urlApi.createObjectURL = undefined;
    try {
      const error: unknown = await client
        .exportWriteFile(EXPORT_NAME, EXPORT_BODY, true)
        .catch((cause: unknown) => cause);

      // 不变量在这条路上也必须成立：一次都没碰 Tauri shim，而且**不是** TypeError
      // （用户 bug #1/#2 的判据；守卫抛的是普通 `Error`，本来就不该是 TypeError）。
      expect(mockInvoke.callsOf('export_write_file')).toHaveLength(0);
      expect(error).not.toBeInstanceOf(TypeError);
      expect(error).toBeInstanceOf(client.IpcRequestError);
      if (!(error instanceof client.IpcRequestError)) throw new Error('expected IpcRequestError');
      expect(error.code).toBe(INVOKE_FAILED);
      expect(error.params).toMatchObject({ cmd: 'export_write_file' });
      // 判据锁定「是 `export.ts:77-80` 那一支抛的」，而不是别处的意外（不逐字复制生产串，免得自我印证）。
      expect(String(error.params?.reason ?? '')).toContain('createObjectURL');
      expect(error.message).not.toMatch(CJK);
    } finally {
      urlApi.createObjectURL = savedCreateObjectURL;
    }
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

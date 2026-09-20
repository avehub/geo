/**
 * 运行时检测：区分「Tauri 桌面壳」与「纯浏览器（demo）」。
 *
 * 判据与 `@tauri-apps/api@2.11.1` **自己的取用方式同源**：它的 `core.js` 里 `invoke` 逐字是
 * `return window.__TAURI_INTERNALS__.invoke(cmd, args, options);`，所以在浏览器里这句话会抛
 * `Cannot read properties of undefined (reading 'invoke')`。检测同一个全局，就能在发起调用之前
 * 把「非 Tauri 运行时」判出来，而不是让用户看到一句密码式报错。
 * （⚠ Tauri **v1** 用的是 `window.__TAURI__`，不是这里的判据。）
 */

/** 应用跑在哪种壳里。`demo` = 纯浏览器（`mise run web`），没有 Tauri IPC 桥。 */
export type Runtime = 'tauri' | 'demo';

/** `@tauri-apps/api` v2 在 WebView 里注入的全局名。 */
const TAURI_INTERNALS = '__TAURI_INTERNALS__';

/**
 * 纯函数：只看传进来的那一个入参，不传参就是「没有任何全局可看」⇒ `'demo'`。
 *
 * 刻意**不带默认参数**（`= window` 那种写法）：JS 的默认参数对**显式传入的 `undefined`** 也生效，
 * 于是「传 `undefined`」与「去看全局」两种意思会合并成同一种，返回值取决于跑在哪个环境里，
 * 测不出确定语义（本轮实测踩过：默认参数版本下 `detectRuntime(undefined)` 在 jsdom 里返回
 * `'tauri'`，因为 `src/test/invoke-mock.ts` 把全局装成了 Tauri 形状）。读全局这件事只发生在
 * 下面 `runtime` 的求值处一次。
 *
 * ⚠ 对象性检查是必需的，不是防御性冗余：`in` 运算符对非对象**抛 `TypeError`**
 * （`'x' in undefined` / `'x' in 'str'` 都抛），少了它检测函数自己就成了新的崩溃点。
 * `typeof null === 'object'`，所以 `null` 要单独挡一行。
 */
export function detectRuntime(win?: unknown): Runtime {
  if (win === null) return 'demo';
  if (typeof win !== 'object' && typeof win !== 'function') return 'demo';
  return TAURI_INTERNALS in win ? 'tauri' : 'demo';
}

/**
 * 本次加载的运行时：**模块首次被 import 时求值一次**，之后不再变。
 *
 * 入参写成 `typeof window === 'undefined' ? undefined : window` 而不是裸 `window`：
 * 裸引用在没有 DOM 全局的环境（SSR / node）里直接是 `ReferenceError`，而检测的职责恰恰是
 * 「在任何环境下都能给出一个答案」。
 *
 * 求值一次是有意的——一个已经跑起来的页面不会中途从浏览器变成 Tauri WebView，做成函数只会让
 * 每个调用点重复判断。代价是**测试要控制它只能 `vi.mock('./runtime')`**：改 `window` 之后再
 * import 拿到的还是模块缓存里那一个常量（要让它重新求值必须配 `vi.resetModules()`，而组件的
 * import 在那之前就已经绑定）。mock 之后记得复位，照 `Root.test.tsx` 的既有做法。
 */
export const runtime: Runtime = detectRuntime(
  typeof window === 'undefined' ? undefined : window,
);

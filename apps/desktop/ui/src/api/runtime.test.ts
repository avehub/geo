/**
 * `src/api/runtime.ts` 的判据测试（Task 10 · 简报 §B-1 / §B-6）。
 *
 * 四类入参：① 空对象（浏览器 `window` 的形状）② 带 `__TAURI_INTERNALS__` 的对象（Tauri WebView）
 * ③ 非对象（`in` 运算符对它们抛 `TypeError`，检测函数自己不许成为新的崩溃点）④ 全局 `window` 缺失。
 * ③④ 是计划正文没写、简报 §B-1 点名要补的两条，都按 TDD 先红后绿。
 *
 * ⚠ ③ 里的 `undefined` 之所以判得成 `'demo'`，是因为 `detectRuntime` **刻意不带默认参数**：
 * 带默认值（`= window`）时 JS 会把「显式传 `undefined`」也当「没传」⇒ 在 jsdom 里它会去读那个被
 * `src/test/invoke-mock.ts` 装成 Tauri 形状的全局、返回 `'tauri'`，③ 就测不出确定语义。
 * 这不是推测：默认参数版本下本用例实测报 `入参 undefined: expected 'tauri' to be 'demo'`。
 *
 * 最后一条用例是**模块级常量**那半边的非永真保障：`runtime` 在模块体求值时读定一次，
 * 所以要观察它在不同全局下的取值，必须 `vi.stubGlobal` + `vi.resetModules()` 再动态 import。
 * 少了它，「常量真的读了 `window`」这件事一条断言都覆盖不到（把它写死成 `'demo'` 也全绿）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detectRuntime, type Runtime } from './runtime';

/** 重新加载 `./runtime`，让模块级常量按当前的全局重新求值一次。 */
async function freshRuntime(): Promise<Runtime> {
  vi.resetModules();
  const loaded = await import('./runtime');
  return loaded.runtime;
}

describe('api/runtime · detectRuntime（纯函数，入参可注入）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('空对象判为 demo（浏览器 window 的形状：没有 Tauri 注入的全局）', () => {
    expect(detectRuntime({})).toBe('demo');
  });

  it('带 __TAURI_INTERNALS__ 的对象判为 tauri（判据是键在不在，不是值是什么）', () => {
    expect(detectRuntime({ __TAURI_INTERNALS__: {} })).toBe('tauri');
    expect(detectRuntime({ __TAURI_INTERNALS__: undefined })).toBe('tauri');
  });

  it('非对象入参一律判为 demo，而不是抛 TypeError', () => {
    // 对照组：`in` 运算符本身对非对象确实抛错——这一行就是守卫存在的理由。
    // 把 `detectRuntime` 的对象性守卫去掉，下面那批断言报的就是 TypeError 而不是 'demo'
    // （§D-9 变异①的落点）。
    expect(() => '__TAURI_INTERNALS__' in (undefined as unknown as object)).toThrow(TypeError);

    for (const value of [undefined, null, 'x', 42, true, 10n, Symbol('s')]) {
      expect(detectRuntime(value), `入参 ${String(value)}`).toBe('demo');
    }
  });

  it('全局 window 缺失时模块照样能加载，runtime 兜到 demo（不抛 ReferenceError）', async () => {
    vi.stubGlobal('window', undefined);

    expect(await freshRuntime()).toBe('demo');
    // 不传参 = 「没有任何全局可看」，与上面那条是同一个兜底的两半
    expect(detectRuntime()).toBe('demo');
  });

  it('模块级常量按当时的 window 求值：两种全局都读得到（非永真）', async () => {
    vi.stubGlobal('window', {});
    expect(await freshRuntime()).toBe('demo');

    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke: () => undefined } });
    expect(await freshRuntime()).toBe('tauri');
  });
});

/**
 * `src/Root.tsx` 的端到端语言切换测试（Plan A Task 6b-A / Task 6 复审 I-1）。
 *
 * 它守的是控制器裁定 **R-C**：在设置页切语言必须**立刻全站生效**。
 * 「切语言要重启应用」是**用户明确反对**的回归——`Root.tsx` 之所以从 `main.tsx` 抽出来，
 * 就是为了把 provider 树里的 `ConfigProvider locale` 从"启动时定死"改成"**订阅** `usePreferences()`"。
 *
 * 因此这里断言的是**穿过整棵 provider 树**的结果，不是各部件自己的映射：
 *   ① antd 的 `ConfigProvider` 真的收到了新 locale（用探针组件读 `ConfigProvider.ConfigContext`）；
 *   ② `dayjs` 的**全局** locale 跟着一起变（R-B：antd 的日期组件直接拿 dayjs 格式化，
 *      只换 ①不换 ②，英文界面里的月份/星期仍然是中文），而且必须在**渲染期**就已生效——
 *      等到 effect 里再设，首帧的月份/星期仍然是旧语言，这正是 `Root.tsx:29-35` 护栏禁止的。
 * 各部件的单元测试已经有了（`store/preferences.test.ts` 的 setLocale→i18n.language、
 * `i18n/index.test.ts` 的 antdLocale 映射与 applyDayjsLocale），本文件只补它们之间那段**接线**。
 *
 * 语言起点不需要自己 `initI18n`：`src/test/setup.ts` 的 `beforeEach` 会把 i18n 拨回 zh-CN。
 */
import { act, render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Root from './Root';
import { resetPreferencesStore, usePreferences } from './store/preferences';

// 真实的路由树会渲染 5 个页面并发 IPC，与本测试无关。换成一个读 antd ConfigContext 的探针：
// 它拿到的 `locale` 就是 `Root.tsx` 传给 `ConfigProvider` 的那一个（`locale.locale` 是 antd 自己的
// 语言码：zh_CN → 'zh-cn'、en_US → 'en'，见 `i18n/index.test.ts` 里 R-B 那条）。
// 用 async 工厂 + 动态 import：`vi.mock` 会被提升到 import 之前执行，直接引用文件顶层的
// `ConfigProvider` / `useContext` 绑定有踩 TDZ 的风险。
//
// 探针输出是 `<antd locale>|<dayjs 全局 locale>` 两段（Task 6b fix1 / 复审 I-2）。第二段**必须在
// 渲染期读**：`act()` 与 RTL 的 `render` 都会 flush effect，所以只断言"用例末尾 dayjs 全局对不对"
// 的话，把 `applyDayjsLocale` 挪进 `useEffect`——即护栏明文禁止、会让英文界面首帧闪中文月份的改法
// ——照样全绿。控制器实测过这个缺口：挪进 effect 后本文件 1 passed；补上这段渲染期读数后红在
// **挂载那一行**（`expected 'zh-cn|en' to be 'zh-cn|zh-cn'`），还原生产代码后又绿。
// 子组件的渲染发生在父组件 effect 之前，所以第二段就是"用户首帧实际看到的日期语言"。
vi.mock('./App', async () => {
  const { ConfigProvider } = await import('antd');
  const { createElement, useContext } = await import('react');
  const { default: dayjs } = await import('dayjs');

  return {
    default: function AppProbe() {
      const { locale } = useContext(ConfigProvider.ConfigContext);
      return createElement(
        'span',
        { 'data-testid': 'antd-locale' },
        `${locale?.locale ?? '(none)'}|${dayjs.locale()}`,
      );
    },
  };
});

describe('Root：切语言立刻全站生效（裁定 R-C）', () => {
  beforeEach(() => {
    // `usePreferences` 是模块级单例，且启动时会从 localStorage 水合：先清干净，
    // 保证每个用例都从 zh-CN 起步（与真实应用的首次启动一致）。
    localStorage.clear();
    resetPreferencesStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // `Root` 的渲染体会写 dayjs 全局，这里复位到**其它测试文件在各自进程里看到的默认值**
    // （dayjs 的语言包副作用导入只注册、不设置全局，默认就是 'en'），不把状态留给同文件后续用例。
    dayjs.locale('en');
  });

  it('setLocale 之后 antd ConfigProvider locale 与 dayjs 全局同步跟随，切回来也成立', () => {
    render(<Root />);

    // 挂载首帧两段都必须是 zh-cn：第一段是 `ConfigProvider` 收到的 locale，第二段是**探针渲染
    // 当时**的 dayjs 全局，也就是用户首帧实际看到的日期语言。
    expect(screen.getByTestId('antd-locale').textContent).toBe('zh-cn|zh-cn');
    // 这一条读的是 effect 全部 flush 之后的终态；与上一条一起才既管时序又管结果。
    expect(dayjs.locale()).toBe('zh-cn');

    act(() => {
      usePreferences.getState().setLocale('en-US');
    });
    expect(screen.getByTestId('antd-locale').textContent).toBe('en|en');
    expect(dayjs.locale()).toBe('en');

    // 切回来：证明这不是一次性的挂载副作用，而是**订阅**在持续生效。
    act(() => {
      usePreferences.getState().setLocale('zh-CN');
    });
    expect(screen.getByTestId('antd-locale').textContent).toBe('zh-cn|zh-cn');
    expect(dayjs.locale()).toBe('zh-cn');
  });
});

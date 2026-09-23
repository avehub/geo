/**
 * `src/components/AppLayout.tsx`：全局框架里**确实挂着** demo 横幅（#27）。
 *
 * # 为什么要这一份
 * `DemoBanner.test.tsx` 钉的是横幅**组件自己**的渲染条件；但计划正文要的是
 * 「demo 模式下**整个应用**顶上有一条横幅」——组件级绿了，框架忘了挂它，界面照样没有横幅。
 * 这一份就是那根「框架真的挂了它」的钉子：`AppLayout` 里那行 `<DemoBanner />` 被删掉，本文件立刻红。
 *
 * ⚠ 控制 `runtime` 只能 `vi.mock`：它是 `api/runtime.ts` 的**模块级常量**（改 `window` 再渲染拿到的
 * 还是模块首次求值那一个）。两种取值放同一个文件里 ⇒ 照 `DemoBanner.test.tsx:19-28` 的先例，
 * 用 `vi.hoisted` 的可变盒子 + 命名空间 getter 切换。
 *
 * ⚠ 路由桩：`AppLayout` 用 `useNavigate` / `useLocation` / `useParams` / `<Outlet />` ⇒ 必须在
 * Router 上下文里渲染，走 `renderAtRoute`（`test/render.tsx:51`）。`Outlet` 没有子路由时渲染空，
 * 这里只验框架自身，不挂页面。
 */
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AppLayout from './AppLayout';
import zhCN from '../i18n/locales/zh-CN';
import { renderAtRoute } from '../test/render';
import type { Runtime } from '../api/runtime';

const runtimeBox = vi.hoisted(() => ({ current: 'demo' as Runtime }));

vi.mock('../api/runtime', () => ({
  get runtime(): Runtime {
    return runtimeBox.current;
  },
  detectRuntime: (): Runtime => runtimeBox.current,
}));

/** 项目级入口（未选项目时置灰）在 antd Menu 里的 `<li>`。 */
function menuItemOf(label: string): HTMLElement {
  const node = screen.getByText(label).closest('li');
  if (node === null) throw new Error(`menu item not found for ${label}`);
  return node;
}

describe('AppLayout：框架里挂着 demo 横幅（#27）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runtimeBox.current = 'demo';
  });

  it('demo 运行时：横幅渲染出来了，且是词典里那句（不是裸 key）', () => {
    runtimeBox.current = 'demo';

    renderAtRoute(<AppLayout />, '/', '/');

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // 断言词典值本身：改词典两侧一起改，这里不用跟着改。
    expect(screen.getByText(zhCN.demo.banner)).toBeInTheDocument();
    // 防空跑：横幅与框架同时在场（只断言横幅的话，框架整个没渲染也会绿）。
    expect(screen.getByText(zhCN.common.appName)).toBeInTheDocument();
  });

  it('tauri 运行时：横幅不出现，但框架其余部分照常渲染', () => {
    runtimeBox.current = 'tauri';

    renderAtRoute(<AppLayout />, '/', '/');

    // 🔴 对照组：这条同时证明上一条不是「框架根本没渲染」造成的假绿。
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(zhCN.demo.banner)).not.toBeInTheDocument();
    expect(screen.getByText(zhCN.common.appName)).toBeInTheDocument();
    expect(screen.getByText(zhCN.nav.projects)).toBeInTheDocument();
  });

  it('导航文案一律来自词典，且未选项目时项目级入口置灰、选中后放开', () => {
    runtimeBox.current = 'demo';

    const { unmount } = renderAtRoute(<AppLayout />, '/', '/');
    for (const label of [zhCN.nav.projects, zhCN.nav.entityCard, zhCN.nav.prompts, zhCN.nav.settings]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(menuItemOf(zhCN.nav.entityCard).className).toContain('ant-menu-item-disabled');
    expect(menuItemOf(zhCN.nav.prompts).className).toContain('ant-menu-item-disabled');
    expect(menuItemOf(zhCN.nav.projects).className).not.toContain('ant-menu-item-disabled');
    unmount();

    renderAtRoute(<AppLayout />, '/projects/:id/prompts', '/projects/p-1/prompts');
    expect(menuItemOf(zhCN.nav.entityCard).className).not.toContain('ant-menu-item-disabled');
    expect(menuItemOf(zhCN.nav.prompts).className).not.toContain('ant-menu-item-disabled');
    // 选中项由路由推导：/prompts ⇒ 高亮「题库」而不是「项目」。
    expect(menuItemOf(zhCN.nav.prompts).className).toContain('ant-menu-item-selected');
  });
});

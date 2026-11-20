/**
 * `src/components/AppLayout.tsx`：全局框架（标题栏 + 左侧导航 + 内容区）。
 *
 * 2026-11-19 产品裁定：demo 提示已全部移除，框架不再挂全局演示细条。
 * 本文件钉住：
 * ① 标题栏 48px、导航文案与项目二级项的路由联动；
 * ② 框架颜色走 antd token，不出现色值字面量。
 *
 * ⚠ 路由桩：`AppLayout` 用 `useNavigate` / `useLocation` / `useParams` / `<Outlet />` ⇒ 必须在
 * Router 上下文里渲染，走 `renderAtRoute`（`test/render.tsx:51`）。`Outlet` 没有子路由时渲染空，
 * 这里只验框架自身，不挂页面。
 */
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppLayout from './AppLayout';
import zhCN from '../i18n/locales/zh-CN';
import { mockInvoke } from '../test/invoke-mock';
import { renderAtRoute } from '../test/render';
import { readRepoFile } from '../test/repo-file';
import { SEED_ACTIVE_PROJECT_ID, SEED_PROJECTS } from '../demo/seed/projects';

/** 框架源码（Task 1 的 token 化断言用）：走 `readRepoFile`，与跨语言真值源核对同一套手法。 */
const APP_LAYOUT_TSX = readRepoFile('apps', 'desktop', 'ui', 'src', 'components', 'AppLayout.tsx');

/** 菜单项在 antd Menu 里的 `<li>`（判选中态与置灰态用）。 */
function menuItemOf(label: string): HTMLElement {
  const node = screen.getByText(label).closest('li');
  if (node === null) throw new Error(`menu item not found for ${label}`);
  return node;
}

describe('AppLayout：全局框架', () => {
  // 🔴 `SideNav` 会拉 `project_list`；不打桩的话它异步 reject 出一条错误 `Alert`。
  // 打桩让用例在同一份确定的导航数据上跑。
  beforeEach(() => {
    mockInvoke.stubAlways('project_list', () => structuredClone(SEED_PROJECTS));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('标题栏 48px、品牌名与导航都在；不再渲染演示细条', () => {
    renderAtRoute(<AppLayout />, '/', '/');

    expect(screen.getByRole('banner')).toHaveStyle({ height: '48px' });
    expect(screen.getByText(zhCN.common.appName)).toBeInTheDocument();
    expect(screen.getByText(zhCN.nav.projects)).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('导航文案一律来自词典；未选项目时业务二级项不出现，选中项目后才展开（spec §5）', async () => {
    const { unmount } = renderAtRoute(<AppLayout />, '/projects', '/projects');
    // 一级两项的文案来自词典（不是裸 key、也不是硬编码）
    expect(screen.getByText(zhCN.nav.projects)).toBeInTheDocument();
    expect(screen.getByText(zhCN.nav.settings)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: zhCN.nav.newProject })).toBeInTheDocument();
    // 🔴 Plan B 起未选项目时 7 个业务二级项**不出现**（原来是置灰；置灰项会撑出一屏点不动的菜单）。
    // 等清单真的上屏再断言，否则"整棵树都没渲染"会让这条假绿。
    await screen.findByText('澜舟工业除尘设备');
    for (const label of [zhCN.nav.entityCard, zhCN.nav.prompts, zhCN.nav.report]) {
      expect(screen.queryByText(label), `${label} 不该出现`).not.toBeInTheDocument();
    }
    unmount();

    renderAtRoute(
      <AppLayout />,
      '/projects/:id/prompts',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/prompts`,
    );
    await waitFor(() => expect(screen.getByText(zhCN.nav.entityCard)).toBeInTheDocument());
    expect(menuItemOf(zhCN.nav.prompts).className).not.toContain('ant-menu-item-disabled');
    // 选中项由路由推导：/prompts ⇒ 高亮「题库」而不是「项目」。
    expect(menuItemOf(zhCN.nav.prompts).className).toContain('ant-menu-item-selected');
  });
});

/**
 * Plan B Task 1（spec DR-31）：框架里那 4 处硬编码颜色改走 antd token。
 *
 * # 为什么用源码断言而不是渲染断言
 * jsdom 不做真实布局与 CSS-in-JS 求值，`getComputedStyle` 拿不到 antd 注入的样式；
 * 而"暗色下标题栏是刺眼的白"这件事的真因就是那 4 个字面量。所以判据落在源码上：
 * 字面量回来 ⇒ 红。渲染侧的暗色由 `Root.test.tsx` 的 colorScheme 断言与人工走查兜
 * （spec Task 9 的手动验收清单）。
 */
describe('AppLayout：颜色走 antd token，不再硬编码（DR-31）', () => {
  it('源码里没有 #fff / #f0f0f0 / #1677ff 三个色值字面量', () => {
    for (const literal of ['#fff', '#f0f0f0', '#1677ff']) {
      expect(APP_LAYOUT_TSX.includes(`'${literal}'`), `${literal} 又回来了`).toBe(false);
      expect(APP_LAYOUT_TSX.includes(`"${literal}"`), `${literal} 又回来了`).toBe(false);
    }
  });

  it('🔴 三个 token 真的被引用（防空跑：上一条对空文件同样成立）', () => {
    expect(APP_LAYOUT_TSX).toContain('token.colorBgContainer');
    expect(APP_LAYOUT_TSX).toContain('token.colorBorderSecondary');
    expect(APP_LAYOUT_TSX).toContain('token.colorPrimary');
    // 自证（对照组）：判据看得见写错一个字母的 token 名。
    expect(APP_LAYOUT_TSX.includes('token.colorBgContainerr')).toBe(false);
  });
});

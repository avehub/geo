/**
 * `SideNav` 的四阶段导航（2026-10-30 视觉重做 · 方案 A）。
 *
 * 判据（与方案 §1 一一对应）：
 * ① 项目外：全部项目 / 组合总览 / 项目清单，14 个业务项**不出现**；
 * ② 项目内：`← 全部项目` + 项目切换器 + 概览 + 四个阶段组；
 * ③ 只有**当前阶段**默认展开，其余收起；组标题是 `aria-expanded` 按钮不是菜单项；
 * ④ 选中态由路由推导；点组内项导航到对应路径；
 * ⑤ 归档项目置灰且不可点；
 * ⑥ 「＋」是动作：导航到 `/projects/new`，不展开/收起清单；
 * ⑦ 折叠成图标栏后仍能回到「全部项目」，且不再显示项目切换器。
 *
 * ⚠ 只测导航本身：用 `pathname` 探针，不靠页面渲染了什么。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';

import SideNav from './SideNav';
import zhCN from '../i18n/locales/zh-CN';
import { mockInvoke } from '../test/invoke-mock';
import { renderWithProviders } from '../test/render';
import {
  SEED_ACTIVE_PROJECT_ID,
  SEED_CHENGCHUAN_PROJECT_ID,
  SEED_PROJECTS,
} from '../demo/seed/projects';
import type { Project } from '../api/types';

const ACTIVE_NAME = '澜舟工业除尘设备';
const ARCHIVED_NAME = '云栖协作平台';
const CHENGCHUAN_NAME = '澄川水处理设备';

function PathProbe() {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function pathname(): string {
  return screen.getByTestId('pathname').textContent ?? '';
}

function renderNav(route = '/projects', projects: Project[] = SEED_PROJECTS) {
  mockInvoke.stubAlways('project_list', () => structuredClone(projects));
  return renderWithProviders(
    <>
      <SideNav />
      <Routes>
        <Route path="*" element={<PathProbe />} />
      </Routes>
    </>,
    { route },
  );
}

function menuItemOf(label: string): HTMLElement {
  const node = screen.getByText(label).closest('li');
  if (node === null) throw new Error(`menu item not found for ${label}`);
  return node;
}

function groupButton(label: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${label}`) });
}

describe('SideNav · 项目外', () => {
  beforeEach(() => {
    // `project_list` 由 `renderNav` 打桩；这里只清掉其它可能的查询缓存。
  });

  it('只有全部项目 / 组合总览 / 项目清单；14 个业务项不出现', async () => {
    renderNav('/projects');

    expect(screen.getByText(zhCN.nav.allProjects)).toBeInTheDocument();
    expect(screen.getByText(zhCN.nav.portfolio)).toBeInTheDocument();
    expect(screen.getByText(zhCN.nav.projects)).toBeInTheDocument();
    await screen.findByText(ACTIVE_NAME);

    for (const label of [zhCN.nav.overview, zhCN.nav.entityCard, zhCN.nav.prompts, zhCN.nav.report]) {
      expect(screen.queryByText(label), `${label} 不该出现`).not.toBeInTheDocument();
    }
  });

  it('归档项目置灰且不可点', async () => {
    renderNav('/projects');
    await screen.findByText(ARCHIVED_NAME);
    expect(menuItemOf(ARCHIVED_NAME).className).toContain('ant-menu-item-disabled');
  });

  it('点项目进入它的概览', async () => {
    renderNav('/projects');
    await userEvent.click(await screen.findByText(ACTIVE_NAME));
    expect(pathname()).toBe(`/projects/${SEED_ACTIVE_PROJECT_ID}/overview`);
  });

  it('「＋」导航到 /projects/new，且清单仍然展开', async () => {
    renderNav('/projects');
    await screen.findByText(ACTIVE_NAME);

    await userEvent.click(screen.getByRole('button', { name: zhCN.nav.newProject }));

    expect(pathname()).toBe('/projects/new');
    expect(screen.getByText(ACTIVE_NAME)).toBeInTheDocument();
  });
});

describe('SideNav · 项目内', () => {
  it('四个阶段组都在；只有当前阶段默认展开，选中项由路由推导', async () => {
    renderNav(`/projects/${SEED_ACTIVE_PROJECT_ID}/prompts`);
    await screen.findByText(ACTIVE_NAME);

    for (const label of [
      zhCN.nav.groups.prepare,
      zhCN.nav.groups.monitor,
      zhCN.nav.groups.diagnose,
      zhCN.nav.groups.deliver,
    ]) {
      expect(groupButton(label)).toBeInTheDocument();
    }

    // 当前阶段 = 准备 → 它展开，题库可见且选中。
    expect(screen.getByText(zhCN.nav.entityCard)).toBeInTheDocument();
    expect(menuItemOf(zhCN.nav.prompts).className).toContain('ant-menu-item-selected');
    // 其它组收起：采集不可见（不是置灰）。
    expect(screen.getByText(zhCN.nav.collection)).not.toBeVisible();
  });

  it('组标题是 aria-expanded 按钮；点击展开后组内项出现并可导航', async () => {
    renderNav(`/projects/${SEED_ACTIVE_PROJECT_ID}/prompts`);
    await screen.findByText(ACTIVE_NAME);

    const monitor = groupButton(zhCN.nav.groups.monitor);
    expect(monitor.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(monitor);
    expect(monitor.getAttribute('aria-expanded')).toBe('true');

    await userEvent.click(await screen.findByText(zhCN.nav.collection));
    expect(screen.getByText(zhCN.nav.collection)).toBeVisible();
    expect(pathname()).toBe(`/projects/${SEED_ACTIVE_PROJECT_ID}/collection`);
  });

  it('切换器第一项「全部项目」回到清单', async () => {
    renderNav(`/projects/${SEED_ACTIVE_PROJECT_ID}/overview`);
    await screen.findByText(ACTIVE_NAME);

    await userEvent.click(screen.getByRole('button', { name: zhCN.nav.switchProject }));
    await userEvent.click(await screen.findByText(zhCN.nav.allProjects));
    expect(pathname()).toBe('/projects');
  });

  it('切换器可以跳到另一个项目', async () => {
    renderNav(`/projects/${SEED_ACTIVE_PROJECT_ID}/overview`);
    await screen.findByText(ACTIVE_NAME);

    await userEvent.click(screen.getByRole('button', { name: zhCN.nav.switchProject }));
    await userEvent.click(await screen.findByText(CHENGCHUAN_NAME));
    expect(pathname()).toBe(`/projects/${SEED_CHENGCHUAN_PROJECT_ID}/overview`);
  });

  it('折叠成图标栏：仍能回到全部项目，切换器让位给图标', async () => {
    renderNav(`/projects/${SEED_ACTIVE_PROJECT_ID}/overview`);
    await screen.findByText(ACTIVE_NAME);

    await userEvent.click(screen.getByRole('button', { name: new RegExp(zhCN.nav.collapseNav) }));

    expect(screen.getByRole('button', { name: new RegExp(zhCN.nav.expandNav) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: zhCN.nav.switchProject })).not.toBeInTheDocument();
    // 图标栏里保留「全部项目」这一项（标题属性供悬停查看）。
    expect(screen.getAllByText(zhCN.nav.allProjects).length).toBeGreaterThan(0);
  });
});

describe('SideNav · 设置', () => {
  it('设置固定在底部导航里，并在 /settings 下选中', async () => {
    renderNav('/settings');
    await waitFor(() => expect(screen.getByText(zhCN.nav.settings)).toBeInTheDocument());
    expect(
      screen.getByRole('navigation', { name: zhCN.nav.settingsAria }),
    ).toBeInTheDocument();
    expect(menuItemOf(zhCN.nav.settings).className).toContain('ant-menu-item-selected');
  });
});

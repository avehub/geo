/**
 * 设置页骨架（Plan B Task 2 · spec DR-27 / §6）：左侧二级菜单 + 分段路由。
 *
 * # 判据形状
 * 「菜单恰好 5 项」「没有扩展」「不认识的 slug 回落 general」这三条都是**以缺席/数量为判据**，
 * 所以每条都带自证：菜单项数是从 DOM 现数的（`role="menuitem"`），词典键集是从 `SETTINGS_SECTIONS`
 * 现比的，路由表是读 `App.tsx` 源码断言的（`readRepoFile`，与跨语言真值源核对同一套手法）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsPage from '../SettingsPage';
import zhCN from '../../i18n/locales/zh-CN';
import enUS from '../../i18n/locales/en-US';
import { mockInvoke } from '../../test/invoke-mock';
import { renderAtRoute } from '../../test/render';
import { readRepoFile } from '../../test/repo-file';
import { PROVIDERS, makeAppSettings } from '../../test/fixtures';
import type { AppSettings } from '../../api/types';
import { SETTINGS_SECTIONS } from './sections';

const APP_TSX = readRepoFile('apps', 'desktop', 'ui', 'src', 'App.tsx');

const SETTINGS: AppSettings = makeAppSettings();

function stub() {
  mockInvoke.stubAlways('llm_providers', () => PROVIDERS);
  mockInvoke.stubAlways('settings_get', () => SETTINGS);
  mockInvoke.stubAlways('settings_update', (args) => args.settings);
  mockInvoke.stubAlways('secret_status', (args) => ({
    provider: args.provider,
    configured: false,
    secret_ref: `keyring://llm/${args.provider}`,
  }));
}

function renderSettings(section: string, locale?: 'zh-CN' | 'en-US') {
  return renderAtRoute(<SettingsPage />, '/settings/:section', `/settings/${section}`, locale);
}

/**
 * 左侧二级菜单的菜单项。
 *
 * ⚠ 不按 `<nav aria-label>` 找：那个 label 是词典值，zh 是「设置」、en 是 "Settings"，
 * 用它做判据会让**同一条断言在两种语言下各写一份**。这里按 `role="menu"` 找，
 * 并先钉「页面上只有一棵树」——本文件渲染的是 `SettingsPage` 单个页面（不含全局框架），
 * 所以那棵树必然是设置页自己的二级菜单。
 */
function menuItems(): HTMLElement[] {
  expect(screen.getAllByRole('menu')).toHaveLength(1);
  return within(screen.getByRole('menu')).getAllByRole('menuitem');
}

describe('设置页骨架 · 分段菜单与路由（DR-27）', () => {
  beforeEach(() => mockInvoke.reset());

  it('路由表：/settings 重定向到 general，/settings/:section 挂在 SettingsPage 上', () => {
    expect(APP_TSX).toContain('path="/settings/:section"');
    expect(APP_TSX).toContain('<Navigate to="/settings/general" replace />');
    // 自证（对照组）：判据看得见写错一个字母的路径。
    expect(APP_TSX.includes('path="/settings/:segment"')).toBe(false);
  });

  it('左侧二级菜单恰好 5 项，顺序 == SETTINGS_SECTIONS，文案来自词典', async () => {
    stub();
    renderSettings('general');
    await screen.findByRole('heading', { name: '通用' });

    expect(SETTINGS_SECTIONS).toHaveLength(5);
    expect(menuItems().map((item) => item.textContent)).toEqual(
      SETTINGS_SECTIONS.map((slug) => zhCN.settings.sections[slug]),
    );
    // 选中态由路由推导，不是组件自己的 state。
    expect(menuItems()[0].className).toContain('ant-menu-item-selected');
  });

  it('🔴 没有「扩展」这一段（产品负责人 2026-09-29 裁定 4：二期，连置灰占位都不留）', async () => {
    stub();
    renderSettings('general');
    await screen.findByRole('heading', { name: '通用' });

    for (const label of ['扩展', 'Extensions', 'skill', 'Skill']) {
      expect(screen.queryByText(label), `设置页里不该出现「${label}」`).not.toBeInTheDocument();
    }
    // slug 清单与词典键集两侧同批：多一个少一个都红。
    expect(Object.keys(zhCN.settings.sections)).toEqual([...SETTINGS_SECTIONS]);
    expect(Object.keys(enUS.settings.sections)).toEqual([...SETTINGS_SECTIONS]);
    expect(APP_TSX.includes('/settings/extensions')).toBe(false);
  });

  it('不认识的 section 回落到 general，而不是白屏', async () => {
    stub();
    renderSettings('nope');

    expect(await screen.findByRole('heading', { name: '通用' })).toBeInTheDocument();
    expect(menuItems()).toHaveLength(5);
  });

  it('点菜单切段：渲染对应分段的内容（模型段能看到厂商预设的接口地址）', async () => {
    stub();
    const user = userEvent.setup();
    renderSettings('general');
    await screen.findByRole('heading', { name: '通用' });

    await user.click(menuItems()[1]);

    await screen.findByRole('heading', { name: '模型服务商' });
    expect(await screen.findByText('https://api.deepseek.com/v1')).toBeInTheDocument();
    await waitFor(() => expect(menuItems()[1].className).toContain('ant-menu-item-selected'));
  });

  it('en-US 下五段菜单名全来自词典（无裸 slug、无中文）', async () => {
    stub();
    renderSettings('general', 'en-US');
    await screen.findByRole('heading', { name: 'General' });

    expect(menuItems().map((item) => item.textContent)).toEqual([
      'General',
      'Model providers',
      'Collection and rate limits',
      'Data and storage',
      'About',
    ]);
  });
});

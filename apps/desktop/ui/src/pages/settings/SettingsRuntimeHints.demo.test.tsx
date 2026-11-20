/**
 * 设置页的演示边界已按 2026-11-19 产品裁定移除：
 * 模型清单、关于段与权限卡不再重复「演示模式」文案，
 * 但运行时中立的说明（取回模型名 / 系统权限由桌面端管理）仍然保留。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import SettingsPage from '../SettingsPage';
import { resetDemoDb } from '../../demo/db';
import { renderAtRoute } from '../../test/render';
import zhCN from '../../i18n/locales/zh-CN';

vi.mock('../../api/runtime', () => ({ runtime: 'demo' }));

function renderSection(section: 'general' | 'models' | 'about') {
  return renderAtRoute(<SettingsPage />, '/settings/:section', `/settings/${section}`);
}

beforeEach(() => {
  resetDemoDb();
});

describe('设置 · demo 运行时', () => {
  it('模型列表使用运行时中立的取回说明', async () => {
    renderSection('models');
    expect(await screen.findByText(zhCN.settings.modelList.hintLive)).toBeInTheDocument();
    expect(screen.queryByText(/演示模式/)).toBeNull();
  });

  it('关于段不再标注演示版本', async () => {
    renderSection('about');
    await screen.findByText('web-demo');
    expect(screen.queryByText(/本轮为演示版本/)).toBeNull();
  });

  it('权限卡说明系统权限由桌面端管理，不重复演示提示', async () => {
    renderSection('general');
    expect(await screen.findByText(zhCN.settings.permissionsCard.liveHint)).toBeInTheDocument();
    expect(screen.queryByText(/演示模式/)).toBeNull();
  });
});

/**
 * 设置页的演示说明只在 demo 运行时出现；桌面端显示真实口径。
 *
 * 覆盖三处曾无条件上屏的文案：
 * ① 模型列表的“演示模式不发请求”；
 * ② 关于段的“本轮为演示版本”；
 * ③ 权限卡的“演示模式下不可用”。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import SettingsPage from '../SettingsPage';
import { mockInvoke } from '../../test/invoke-mock';
import { renderAtRoute } from '../../test/render';
import { PROVIDERS, makeAppSettings } from '../../test/fixtures';
import zhCN from '../../i18n/locales/zh-CN';
import type { AppEnvironment } from '../../api/types';

const ENVIRONMENT: AppEnvironment = {
  app_version: '1.2.3',
  build_number: 'stub-build-42',
  permissions: {
    notification: 'granted',
    files_and_folders: 'granted',
    screen_recording: 'denied',
  },
  storage: {
    data_dir: '/tmp/gdk-live/data',
    db_path: '/tmp/gdk-live/data/geo.sqlite3',
    db_size_bytes: 2048,
    screenshots_dir: '/tmp/gdk-live/data/screenshots',
    log_dir: '/tmp/gdk-live/data/logs',
    export_dir: null,
    migrations_applied: 1,
  },
};

function renderSection(section: 'general' | 'models' | 'about') {
  return renderAtRoute(<SettingsPage />, '/settings/:section', `/settings/${section}`);
}

beforeEach(() => {
  mockInvoke.reset();
  mockInvoke.stubAlways('llm_providers', () => PROVIDERS);
  mockInvoke.stubAlways('settings_get', () => makeAppSettings());
  mockInvoke.stubAlways('settings_update', (args) => args.settings);
  mockInvoke.stubAlways('secret_status', (args) => ({
    provider: args.provider,
    configured: false,
    secret_ref: `keyring://llm/${args.provider}`,
  }));
  mockInvoke.stubAlways('app_environment', () => ENVIRONMENT);
});

describe('设置 · 桌面端运行时', () => {
  it('模型列表说明真实取材，不出现“演示模式不发请求”', async () => {
    renderSection('models');

    expect(await screen.findByText(zhCN.settings.modelList.hintLive)).toBeInTheDocument();
    expect(screen.queryByText(/演示模式不发请求/)).toBeNull();
  });

  it('关于段不出现“本轮为演示版本”', async () => {
    renderSection('about');

    expect(await screen.findByText('1.2.3')).toBeInTheDocument();
    expect(screen.queryByText(/本轮为演示版本/)).toBeNull();
  });

  it('权限卡显示桌面端口径，不出现“演示模式下不可用”', async () => {
    renderSection('general');

    expect(await screen.findByText(zhCN.settings.permissionsCard.liveHint)).toBeInTheDocument();
    expect(screen.queryByText(/演示模式下不可用/)).toBeNull();
  });
});

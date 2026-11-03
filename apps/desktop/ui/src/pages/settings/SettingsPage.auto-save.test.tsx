/**
 * 设置页自动保存的**跨段归属**（DR-28）：models 是显式保存段，general/collection/storage 才自动保存。
 *
 * 这两条判据都直接针对已确认的线上行为：
 * ① 在模型段改一个字后切到「通用」，模型配置不能被顺带写库；
 * ② 在自动保存段改完后 500ms 内离开设置页，改动必须在卸载前落库，不能静默丢失。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router-dom';

import SettingsPage from '../SettingsPage';
import { mockInvoke } from '../../test/invoke-mock';
import { renderAtRoute, renderWithProviders } from '../../test/render';
import { PROVIDERS, makeAppSettings } from '../../test/fixtures';

const SETTINGS = makeAppSettings();

function stub() {
  mockInvoke.stubAlways('llm_providers', () => PROVIDERS);
  mockInvoke.stubAlways('settings_get', () => SETTINGS);
  mockInvoke.stubAlways('settings_update', (args) => args.settings);
  mockInvoke.stubAlways('app_environment', () => ({
    app_version: '0.1.0',
    build_number: 'web-demo',
    permissions: {
      notification: 'unsupported',
      files_and_folders: 'unsupported',
      screen_recording: 'unsupported',
    },
    storage: {
      data_dir: '/tmp/geo',
      db_path: '/tmp/geo/geo.sqlite3',
      db_size_bytes: 0,
      screenshots_dir: '/tmp/geo/screenshots',
      log_dir: '/tmp/geo/logs',
      export_dir: null,
      migrations_applied: 1,
    },
  }));
  mockInvoke.stubAlways('secret_status', (args) => ({
    provider: args.provider,
    configured: false,
    secret_ref: `keyring://llm/${args.provider}`,
  }));
}

function menuItem(label: string): HTMLElement {
  return within(screen.getByRole('menu')).getByRole('menuitem', { name: label });
}

describe('设置页自动保存 · 跨段归属（DR-28）', () => {
  beforeEach(() => {
    mockInvoke.reset();
    localStorage.clear();
  });

  it('🔴 models 段修改后切到 general，不得自动写库', async () => {
    stub();
    const user = userEvent.setup();
    renderAtRoute(<SettingsPage />, '/settings/:section', '/settings/models');
    await screen.findByRole('heading', { name: '模型服务商' });

    const temperature = screen.getByLabelText('温度');
    await user.clear(temperature);
    await user.type(temperature, '0.8');

    await user.click(menuItem('通用'));
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(mockInvoke.callsOf('settings_update')).toHaveLength(0);
  });

  it('🔴 先改 models、再改 general：general 的自动保存不得把未显式保存的模型配置带走', async () => {
    stub();
    const user = userEvent.setup();
    renderAtRoute(<SettingsPage />, '/settings/:section', '/settings/models');
    await screen.findByRole('heading', { name: '模型服务商' });

    const temperature = screen.getByLabelText('温度');
    await user.clear(temperature);
    await user.type(temperature, '0.8');

    await user.click(menuItem('通用'));
    await screen.findByRole('heading', { name: '通用' });
    await user.click(screen.getByLabelText('上报 Prompt 题库'));
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(mockInvoke.callsOf('settings_update')).toHaveLength(0);
  });

  it('🔴 自动保存段改完后 500ms 内离开设置页，卸载前必须落库', async () => {
    stub();
    const user = userEvent.setup();

    function Harness() {
      return (
        <Routes>
          <Route
            path="/settings/:section"
            element={
              <>
                <Link to="/elsewhere">leave settings</Link>
                <SettingsPage />
              </>
            }
          />
          <Route path="/elsewhere" element={<div>elsewhere</div>} />
        </Routes>
      );
    }

    renderWithProviders(<Harness />, { route: '/settings/general' });
    await screen.findByRole('heading', { name: '通用' });

    await user.click(screen.getByLabelText('上报 Prompt 题库'));
    await user.click(screen.getByRole('link', { name: 'leave settings' }));

    await waitFor(() => expect(mockInvoke.callsOf('settings_update')).toHaveLength(1));
    const saved = mockInvoke.lastArgsOf('settings_update')!.settings as {
      privacy: { share_prompts: boolean };
    };
    expect(saved.privacy.share_prompts).toBe(false);
  });
});

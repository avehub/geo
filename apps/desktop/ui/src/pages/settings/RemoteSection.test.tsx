/**
 * 设置 · 远程内容与更新段（Task 11）。
 *
 * 三条靶心：
 * ① 版本表来自 `remote_status`（桩里填独特版本号，写死就红）；
 * ② `degraded=true` 必须**显式**提示"当前使用内置版本"，而不是安静地展示内置数据；
 * ③ 「立即同步」真的调 `remote_sync`，并且同步后重新拉一次状态（`remote_status` 计数 +1）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsPage from '../SettingsPage';
import { mockInvoke } from '../../test/invoke-mock';
import { renderAtRoute } from '../../test/render';
import { makeAppSettings, PROVIDERS } from '../../test/fixtures';
import type { RemoteStatus } from '../../api/types-remote';

const DEGRADED: RemoteStatus = {
  base_url: 'https://geo_api.gaodekuai.com/client/v1',
  public_key_configured: false,
  last_sync: {
    status: 'unavailable',
    started_at: '2026-11-18T00:00:00Z',
    finished_at: '2026-11-18T00:00:01Z',
    changed_items: [],
    degraded: true,
    error_code: 'status',
  },
  items: [
    {
      key: 'rulepacks',
      version: 424242,
      sha256: '',
      source: 'builtin',
      accepted_at: '2026-11-17T07:15:41Z',
    },
    {
      key: 'release',
      version: 999999,
      sha256: '',
      source: 'remote',
      accepted_at: '2026-11-18T00:00:00Z',
    },
  ],
  builtin_versions: [],
  degraded: true,
};

function stub(status: RemoteStatus = DEGRADED) {
  mockInvoke.stubAlways('llm_providers', () => PROVIDERS);
  mockInvoke.stubAlways('settings_get', () => makeAppSettings());
  mockInvoke.stubAlways('settings_update', (args) => args.settings);
  mockInvoke.stubAlways('remote_status', () => status);
  mockInvoke.stubAlways('remote_sync', () => ({
    status: 'ok',
    changed: ['release'],
    failed: [],
    degraded: false,
    started_at: '2026-11-18T00:00:00Z',
    finished_at: '2026-11-18T00:00:02Z',
    error_code: null,
  }));
}

function renderRemote(section = 'remote', locale?: 'zh-CN' | 'en-US') {
  return renderAtRoute(<SettingsPage />, '/settings/:section', `/settings/${section}`, locale);
}

describe('设置 · 远程内容与更新段', () => {
  beforeEach(() => mockInvoke.reset());

  it('版本表来自 remote_status：内置与远程两行的来源标签不同', async () => {
    stub();
    renderRemote();

    expect(await screen.findByText('424242')).toBeInTheDocument();
    expect(screen.getByText('999999')).toBeInTheDocument();
    expect(screen.getByText('内置')).toBeInTheDocument();
    expect(screen.getByText('远程')).toBeInTheDocument();
  });

  it('degraded=true 时显式说明当前使用内置版本', async () => {
    stub();
    renderRemote();

    expect(
      await screen.findByText(/当前使用内置版本，远程内容不可用/),
    ).toBeInTheDocument();
  });

  it('公钥未配置时如实说明"远程内容一律不采用"', async () => {
    stub();
    renderRemote();

    expect(await screen.findByText(/未配置/)).toBeInTheDocument();
  });

  it('点「立即同步」会调用 remote_sync 并展示结果', async () => {
    stub();
    renderRemote();

    const button = await screen.findByRole('button', { name: '立即同步' });
    await userEvent.click(button);

    await waitFor(() => {
      expect(mockInvoke.callsOf('remote_sync')).toHaveLength(1);
    });
    expect(await screen.findByText(/同步结束：ok/)).toBeInTheDocument();
    // 同步后要重新拉状态（否则版本表停在旧值）
    await waitFor(() => expect(mockInvoke.callsOf('remote_status').length).toBeGreaterThan(1));
  });

  it('en-US 下不出现硬编码中文', async () => {
    stub();
    renderRemote('remote', 'en-US');

    expect(await screen.findByText('Sync now')).toBeInTheDocument();
    expect(screen.queryByText('立即同步')).not.toBeInTheDocument();
  });
});

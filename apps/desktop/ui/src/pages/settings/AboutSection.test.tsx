/**
 * 设置 · 关于段（Plan B Task 5 · spec §6 / DR-35 / 裁定 4）。
 *
 * 两条靶心：
 * ① 版本与构建号来自 `app_environment`（桩里填独特值，写死就红）；
 * ② 🔴 「扩展」「skill」「客服机器人」**一个都不出现**——产品负责人 2026-09-29 裁定 4
 *    把它们整体推到二期，连置灰占位都不留（spec §2：留一个点不动的入口，比不出现
 *    更容易被走查的人当成缺陷）。中英两侧各扫一遍。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import SettingsPage from '../SettingsPage';
import { mockInvoke, type StubValue } from '../../test/invoke-mock';
import { renderAtRoute } from '../../test/render';
import { makeAppSettings, PROVIDERS } from '../../test/fixtures';
import type { AppEnvironment } from '../../api/types';

const ENVIRONMENT: AppEnvironment = {
  app_version: '9.9.9',
  build_number: 'stub-build-42',
  permissions: {
    notification: 'unsupported',
    files_and_folders: 'unsupported',
    screen_recording: 'unsupported',
  },
  storage: {
    data_dir: '/tmp/gdk-stub/data',
    db_path: '/tmp/gdk-stub/data/geo.sqlite3',
    db_size_bytes: 1024,
    screenshots_dir: '/tmp/gdk-stub/data/screenshots',
    log_dir: '/tmp/gdk-stub/data/logs',
    export_dir: null,
    migrations_applied: 1,
  },
};

function stub(environmentError?: StubValue) {
  mockInvoke.stubAlways('llm_providers', () => PROVIDERS);
  mockInvoke.stubAlways('settings_get', () => makeAppSettings());
  mockInvoke.stubAlways('settings_update', (args) => args.settings);
  mockInvoke.stubAlways(
    'app_environment',
    environmentError ?? (ENVIRONMENT as unknown as StubValue),
    environmentError === undefined ? 'resolve' : 'reject',
  );
}

function renderAbout(locale?: 'zh-CN' | 'en-US') {
  return renderAtRoute(<SettingsPage />, '/settings/:section', '/settings/about', locale);
}

describe('设置 · 关于段', () => {
  beforeEach(() => mockInvoke.reset());

  it('🔴 app_environment 失败时显示错误码，而不是永远 skeleton', async () => {
    stub({ code: 'ipc/unknown_command', params: { cmd: 'app_environment' }, message: '' });
    renderAbout();

    expect(await screen.findByText('读取本机环境失败')).toBeInTheDocument();
    expect(screen.queryByText('9.9.9')).not.toBeInTheDocument();
  });

  it('版本与构建号来自 app_environment，不是写死的', async () => {
    stub();
    renderAbout();

    expect(await screen.findByText('9.9.9')).toBeInTheDocument();
    expect(screen.getByText('stub-build-42')).toBeInTheDocument();
    expect(screen.getByText('版本')).toBeInTheDocument();
    expect(screen.getByText('构建号')).toBeInTheDocument();
    expect(mockInvoke.callsOf('app_environment').length).toBeGreaterThan(0);
  });

  it('开源许可一栏在（两侧同值的专有名词清单）', async () => {
    stub();
    renderAbout();

    expect(await screen.findByText('开源许可')).toBeInTheDocument();
    expect(screen.getByText(/Ant Design/)).toBeInTheDocument();
    expect(screen.getByText(/Tauri/)).toBeInTheDocument();
  });

  it('🔴 裁定 4：「扩展」「skill」「客服机器人」一个都不出现（连置灰占位都不留）', async () => {
    stub();
    renderAbout();
    await screen.findByText('9.9.9');

    const body = document.body.textContent ?? '';
    for (const banned of ['扩展', 'skill', 'Skill', '客服机器人', '客服']) {
      expect(body, `${banned} 不该出现在关于段`).not.toContain(banned);
    }
    expect(screen.queryByText('扩展')).not.toBeInTheDocument();
    expect(screen.queryByText(/客服机器人/)).not.toBeInTheDocument();
  });

  it('🔴 同一批禁词在 en-US 下也一个都不出现', async () => {
    stub();
    renderAbout('en-US');
    await screen.findByText('9.9.9');

    const body = document.body.textContent ?? '';
    for (const banned of ['Extension', 'extension', 'skill', 'Skill', 'support bot', 'Support bot']) {
      expect(body, `${banned} should not appear in About`).not.toContain(banned);
    }
  });

  it('en-US 下骨架文案都是英文', async () => {
    stub();
    renderAbout('en-US');

    expect(await screen.findByRole('heading', { name: 'About' })).toBeInTheDocument();
    // 先等数据到位：`app_environment` 回来之前这一段渲染的是 Card 的 loading 骨架。
    await screen.findByText('9.9.9');
    expect(screen.getByText('Version')).toBeInTheDocument();
    expect(screen.getByText('Build')).toBeInTheDocument();
    expect(screen.getByText('Open-source licenses')).toBeInTheDocument();
  });
});

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
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

function stubRemote() {
  mockInvoke.stubAlways('remote_status', () => ({
    base_url: 'https://geo_api.gaodekuai.com/client/v1',
    public_key_configured: true,
    last_sync: null,
    items: [
      {
        key: 'rulepacks',
        version: 424242,
        sha256: '',
        source: 'remote',
        accepted_at: '2026-11-18T00:00:00Z',
      },
    ],
    builtin_versions: [],
    degraded: false,
  }));
  mockInvoke.stubAlways('remote_legal_index', () => ({
    key: 'legal',
    version: 7,
    sha256: '',
    source: 'remote',
    accepted_at: '2026-11-18T00:00:00Z',
    degraded: false,
    value: {
      schema_version: 1,
      version: 7,
      docs: { privacy_policy: { 'zh-CN': { version: 3, title: '隐私政策', path: 'legal/x.md', sha256: '' } } },
    },
  }));
  // `remote_legal_get` 由各用例自己 stub：默认注册一条会让"点按钮"的用例拿到错误的一条。
}

function stub(environmentError?: StubValue) {
  stubRemote();
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
    expect(
      screen.queryByText('本轮为演示版本；桌面端专属能力与后续功能会在正式版本中提供。'),
    ).toBeNull();
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

  it('显示规则包与法务文档版本（来自 remote_status / remote_legal_index）', async () => {
    stub();
    renderAbout();
    await screen.findByText('9.9.9');

    expect(screen.getByText('规则包版本')).toBeInTheDocument();
    expect(await screen.findByText('424242')).toBeInTheDocument();
    expect(screen.getByText('法务文档版本')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('🔴 隐私政策取不到正文时如实说取不到，绝不显示旧文本', async () => {
    stub();
    mockInvoke.stubAlways('remote_legal_get', () => ({
      key: 'legal:privacy_policy:zh-CN',
      version: 0,
      sha256: '',
      source: 'none',
      accepted_at: null,
      degraded: true,
      title: null,
      text: null,
    }));
    renderAbout();
    await screen.findByText('9.9.9');

    await userEvent.click(screen.getByRole('button', { name: '打开隐私政策' }));
    await waitFor(() => expect(screen.getByText(/暂时无法获取最新政策/)).toBeInTheDocument());
  });

  it('打开隐私政策会展示远程正文（与安装包内文本同源）', async () => {
    stub();
    mockInvoke.stubAlways('remote_legal_get', () => ({
      key: 'legal:privacy_policy:zh-CN',
      version: 3,
      sha256: '',
      source: 'remote',
      accepted_at: '2026-11-18T00:00:00Z',
      degraded: false,
      title: '隐私政策',
      text: '这是远程发布的正文。',
    }));
    renderAbout();
    await screen.findByText('9.9.9');

    await userEvent.click(screen.getByRole('button', { name: '打开隐私政策' }));
    expect(await screen.findByText('这是远程发布的正文。')).toBeInTheDocument();
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

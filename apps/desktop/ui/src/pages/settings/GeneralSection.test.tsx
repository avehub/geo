/**
 * 设置 · 通用段（Plan B Task 3 · spec §6 / DR-28 / DR-29 / DR-32 / DR-35）。
 *
 * # 这一段最容易写反的三条判据
 * ① **外观与界面语言走 `preferences`**（localStorage），不发 `settings_update`；
 * ② **生成内容语言走 `settings.language`**，且**不动** `i18n.language`（DR-32：两者刻意不联动）；
 * ③ **权限三项在 demo 里恒为「不支持」**，「去系统设置」置灰——不演一个点了没反应的按钮。
 * 三条都各有正反两面（对照组），免得"控件根本没渲染"也能绿。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsPage from '../SettingsPage';
import { i18n } from '../../i18n';
import { mockInvoke, type StubValue } from '../../test/invoke-mock';
import { renderAtRoute } from '../../test/render';
import { PROVIDERS, makeAppSettings } from '../../test/fixtures';
import { resetPreferencesStore, usePreferences } from '../../store/preferences';
import type { AppEnvironment, AppSettings } from '../../api/types';
import zhCN from '../../i18n/locales/zh-CN';
import enUS from '../../i18n/locales/en-US';

const SETTINGS = makeAppSettings();

const ENVIRONMENT: AppEnvironment = {
  app_version: '0.1.0',
  build_number: 'web-demo',
  permissions: {
    notification: 'unsupported',
    files_and_folders: 'unsupported',
    screen_recording: 'unsupported',
  },
  storage: {
    data_dir: '/Users/demo/Library/Application Support/com.gdk.geo',
    db_path: '/Users/demo/Library/Application Support/com.gdk.geo/geo.sqlite3',
    db_size_bytes: 3_481_600,
    screenshots_dir: '/Users/demo/Library/Application Support/com.gdk.geo/screenshots',
    log_dir: '/Users/demo/Library/Application Support/com.gdk.geo/logs',
    export_dir: null,
    migrations_applied: 1,
  },
};

function stub(appEnvironmentError?: StubValue) {
  mockInvoke.stubAlways('llm_providers', () => PROVIDERS);
  mockInvoke.stubAlways('settings_get', () => SETTINGS);
  mockInvoke.stubAlways('settings_update', (args) => args.settings);
  mockInvoke.stubAlways(
    'app_environment',
    appEnvironmentError ?? (ENVIRONMENT as unknown as StubValue),
    appEnvironmentError === undefined ? 'resolve' : 'reject',
  );
  mockInvoke.stubAlways('secret_status', (args) => ({
    provider: args.provider,
    configured: false,
    secret_ref: `keyring://llm/${args.provider}`,
  }));
}

function renderGeneral(locale?: 'zh-CN' | 'en-US') {
  return renderAtRoute(<SettingsPage />, '/settings/:section', '/settings/general', locale);
}

/** 自动保存段：改动后等防抖窗口，取最后一次写库的整包。 */
async function lastSaved(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(mockInvoke.callsOf('settings_update').length).toBeGreaterThan(0));
  return mockInvoke.lastArgsOf('settings_update')!.settings as Record<string, unknown>;
}

describe('设置 · 通用段', () => {
  beforeEach(() => {
    mockInvoke.reset();
    // 偏好是模块级单例且会水合 localStorage：不清干净，上一个用例切的暗色/英文会漏进来。
    localStorage.clear();
    resetPreferencesStore();
  });

  it('五张卡都在：外观 / 语言 / 权限与隐私 / 网络代理 / 通知', async () => {
    stub();
    renderGeneral();

    expect(await screen.findByRole('heading', { name: '通用' })).toBeInTheDocument();
    // 按**卡片标题**数，不用 `getByText`：「通知」既是卡片名又是权限项名，
    // 按文本找会撞成 multiple elements；而卡片标题集恰好钉住"五张、这个顺序"。
    const cardTitles = [...document.querySelectorAll('.ant-card-head-title')].map(
      (node) => node.textContent,
    );
    expect(cardTitles).toEqual(['外观', '语言', '权限与隐私', '网络代理', '通知']);
    // 自动保存段不给保存按钮（DR-28）：留着它，用户会以为"刚才那下没生效"。
    expect(screen.queryByRole('button', { name: /保存设置/ })).not.toBeInTheDocument();
  });

  it('🔴 外观走 preferences：切暗色即时生效、落 localStorage，且一次 settings_update 都不发', async () => {
    stub();
    const user = userEvent.setup();
    renderGeneral();
    await screen.findByRole('heading', { name: '通用' });

    await user.click(screen.getByLabelText('主题'));
    await user.click(await screen.findByTitle('深色'));

    expect(usePreferences.getState().theme).toBe('dark');
    expect(localStorage.getItem('geo.preferences')).toContain('"theme":"dark"');
    // 等过防抖窗口：外观不是 `AppSettings` 的字段，不该触发写库。
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mockInvoke.callsOf('settings_update')).toHaveLength(0);
  });

  it('字号三档都能选，选完写进 preferences', async () => {
    stub();
    const user = userEvent.setup();
    renderGeneral();
    await screen.findByRole('heading', { name: '通用' });

    await user.click(screen.getByLabelText('字体大小'));
    await user.click(await screen.findByTitle('大'));
    expect(usePreferences.getState().fontScale).toBe('lg');

    await user.click(screen.getByLabelText('字体大小'));
    await user.click(await screen.findByTitle('小'));
    expect(usePreferences.getState().fontScale).toBe('sm');
  });

  it('🔴 界面语言走 preferences.locale：切 English 后 i18n 立即变、页面上出现英文标签', async () => {
    stub();
    const user = userEvent.setup();
    renderGeneral();
    await screen.findByRole('heading', { name: '通用' });

    await user.click(screen.getByLabelText('界面语言'));
    await user.click(await screen.findByTitle('英文'));

    expect(i18n.language).toBe('en-US');
    expect(usePreferences.getState().locale).toBe('en-US');
    expect(await screen.findByRole('heading', { name: 'General' })).toBeInTheDocument();
    // 界面语言不落库（它不是 `AppSettings` 的字段）。
    expect(mockInvoke.callsOf('settings_update')).toHaveLength(0);
  });

  it('🔴 生成内容语言是**另一个**控件：只动 settings.language，不动 i18n.language（DR-32）', async () => {
    stub();
    const user = userEvent.setup();
    renderGeneral();
    await screen.findByRole('heading', { name: '通用' });

    await user.click(screen.getByLabelText('生成内容语言'));
    await user.click(await screen.findByTitle('英文'));

    const saved = await lastSaved();
    expect(saved.language).toBe('en_us');
    // 反向判据：界面语言**没有**跟着变（联动就是这条要拦的缺陷）。
    expect(i18n.language).toBe('zh-CN');
    expect(usePreferences.getState().locale).toBe('zh-CN');
    expect(screen.getByRole('heading', { name: '通用' })).toBeInTheDocument();
  });

  it('数据外发预留开关组已按 2026-11-13 裁定摘除（无执行点，避免误导）', async () => {
    stub();
    const user = userEvent.setup();
    renderGeneral();
    await screen.findByRole('heading', { name: '通用' });

    for (const item of [
      'share_entity_card',
      'share_prompts',
      'share_crawled_text',
      'share_diagnostics',
    ]) {
      expect(document.getElementById(`settings-privacy-${item}`)).toBeNull();
    }

    // 写库 payload 里也不应再出现 privacy 段
    await user.click(screen.getByLabelText(zhCN.settings.proxy.enable));
    const saved = await lastSaved();
    expect(saved).not.toHaveProperty('privacy');
  });

  it('🔴 旧版 settings_get 缺 storage 时按默认值归一化，不白屏', async () => {
    stub();
    const { storage: _storage, ...legacy } = SETTINGS;
    mockInvoke.stubAlways('settings_get', () => legacy as unknown as AppSettings);
    renderGeneral();
    await screen.findByRole('heading', { name: '通用' });
  });

  it('🔴 更旧库里的 settings JSON 仍带 privacy 段时也能正常渲染（前向兼容）', async () => {
    stub();
    mockInvoke.stubAlways('settings_get', () =>
      ({
        ...SETTINGS,
        privacy: {
          share_entity_card: true,
          share_prompts: true,
          share_crawled_text: true,
          share_diagnostics: false,
        },
      }) as unknown as AppSettings,
    );
    renderGeneral();
    await screen.findByRole('heading', { name: '通用' });
    expect(document.getElementById('settings-privacy-share_prompts')).toBeNull();
  });

  it('🔴 app_environment 失败时权限卡显示错误，而不是永远停在加载中', async () => {
    stub({ code: 'ipc/unknown_command', params: { cmd: 'app_environment' }, message: '' });
    renderGeneral();
    await screen.findByRole('heading', { name: '通用' });

    expect(await screen.findByText('读取本机环境失败')).toBeInTheDocument();
    expect(screen.queryByText('当前环境不支持')).not.toBeInTheDocument();
  });

  it('🔴 权限三项显示「当前环境不支持」，「去系统设置」置灰并说明由操作系统管理', async () => {
    stub();
    renderGeneral();
    // 权限三项来自 `app_environment`（另一个 query）：不等它落地就会扫到"加载中"那一支。
    await screen.findAllByText('当前环境不支持');

    const card = screen.getByText('权限与隐私').closest('.ant-card') as HTMLElement;
    for (const item of ['通知', '文件与文件夹', '屏幕录制']) {
      expect(within(card).getByText(item), `缺权限项「${item}」`).toBeInTheDocument();
    }
    // 三项的状态标签都渲染成词典里的「当前环境不支持」，不是裸 `unsupported`。
    expect(within(card).getAllByText('当前环境不支持')).toHaveLength(3);
    expect(within(card).queryByText('unsupported')).not.toBeInTheDocument();

    const button = within(card).getByRole('button', {
      name: '去系统设置',
    });
    expect(button).toBeDisabled();
    expect(
      within(card).getByText('系统权限由操作系统管理；一键跳转将在后续版本提供。'),
    ).toBeInTheDocument();
  });

  it('通知三个开关照旧可改（自 SettingsPage 平移，行为不变）', async () => {
    stub();
    const user = userEvent.setup();
    renderGeneral();
    await screen.findByRole('heading', { name: '通用' });

    await user.click(screen.getByLabelText('任务完成时通知'));
    const saved = await lastSaved();
    expect(saved.notify).toEqual({ on_finish: false, on_risk: true, sound: false });
  });

  it('B-2 · 分段骨架文案在 en-US 下渲染成英文', async () => {
    stub();
    renderGeneral('en-US');

    expect(await screen.findByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Permissions and privacy')).toBeInTheDocument();
    expect(screen.getByText('Network proxy')).toBeInTheDocument();
    expect(screen.getByLabelText('Interface language')).toBeInTheDocument();
    expect(screen.getByLabelText('Generated content language')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open System Settings' })).toBeDisabled();
  });

  it('B-2 对照 · 同一批断言在 zh-CN 下渲染成中文', async () => {
    stub();
    renderGeneral();

    expect(await screen.findByRole('heading', { name: '通用' })).toBeInTheDocument();
    expect(screen.getByText('外观')).toBeInTheDocument();
    expect(screen.getByText('权限与隐私')).toBeInTheDocument();
    expect(screen.getByText('网络代理')).toBeInTheDocument();
    expect(screen.getByLabelText('界面语言')).toBeInTheDocument();
    expect(screen.getByLabelText('生成内容语言')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '去系统设置' })).toBeDisabled();
  });

  /**
   * 🔴 防回归（2026-11-11）：这组开关**没有任何执行点**。
   *
   * `PrivacyConfig` 的四个 `share_*` 字段只在 `geo-store/src/settings.rs`（定义/读写）、
   * `api/types.ts`、`test/fixtures.ts` 与本组件的渲染里出现，**没有任何业务代码读取它们**；
   * 而全仓不存在遥测 / 埋点 / 崩溃上报（连 `tauri-plugin-log` 都有测试钉住不许重新引入）。
   * 原文案「控制哪些数据在**上报诊断**时允许离开本机」因此描述了一条不存在的通道，
裁定（2026-11-13 产品决定）：选 ① 摘除——开关组与词典键两侧全删，
   * 老库 JSON 仍带 privacy 段时按 serde 忽略（前向兼容测试守护）。
   * 详见 docs/superpowers/specs/2026-11-10-release-signing-distribution-design.md §9 第 13 项。
   */
  it('🔴 数据外发开关组按 2026-11-13 裁定①摘除：zh-CN / en-US 词典键同步删除', () => {
    const zhCard = zhCN.settings.permissionsCard as Record<string, unknown>;
    const enCard = enUS.settings.permissionsCard as Record<string, unknown>;
    for (const key of [
      'privacyTitle',
      'privacyReservedTag',
      'privacyHint',
      'share_entity_card',
      'share_prompts',
      'share_crawled_text',
      'share_diagnostics',
    ]) {
      expect(zhCard[key], `zh-CN 不应再含 ${key}`).toBeUndefined();
      expect(enCard[key], `en-US 不应再含 ${key}`).toBeUndefined();
    }
  });
});

/**
 * 设置 · 数据与存储段（Plan B Task 5 · spec §6 / DR-35）。
 *
 * 三条靶心：
 * ① 六行事实（数据目录 / 库文件 / 库大小 / 截图目录 / 日志目录 / 导出目录 + 迁移数）
 *    **全部来自 `app_environment`**，不是硬编码——桩里刻意填一批独特路径，
 *    只要组件自己写死了一行，这里就红；
 * ② 「打开目录」「更改目录」两个按钮**置灰**并说明由桌面端提供（沿用 M7 对
 *    docx/pdf/png 的既有口径：照旧渲染，不演一个点了没反应的按钮）；
 * ③ `db_size_bytes` 走人类可读格式，不是裸字节数。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import SettingsPage from '../SettingsPage';
import { mockInvoke, type StubValue } from '../../test/invoke-mock';
import { renderAtRoute } from '../../test/render';
import { makeAppSettings, PROVIDERS } from '../../test/fixtures';
import { bytesText } from '../../components/format';
import type { AppEnvironment } from '../../api/types';

/** 桩：路径与数字都独特，为的是证明"渲染出来的确实来自命令"。 */
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
    db_size_bytes: 3_481_600,
    screenshots_dir: '/tmp/gdk-stub/data/screenshots',
    log_dir: '/tmp/gdk-stub/data/logs',
    export_dir: '/tmp/gdk-stub/exports',
    migrations_applied: 7,
  },
};

function stub(
  overrides: Partial<AppEnvironment['storage']> = {},
  environmentError?: StubValue,
) {
  mockInvoke.stubAlways('llm_providers', () => PROVIDERS);
  mockInvoke.stubAlways('settings_get', () => makeAppSettings());
  mockInvoke.stubAlways('settings_update', (args) => args.settings);
  mockInvoke.stubAlways(
    'app_environment',
    environmentError ??
      ({ ...ENVIRONMENT, storage: { ...ENVIRONMENT.storage, ...overrides } } as unknown as StubValue),
    environmentError === undefined ? 'resolve' : 'reject',
  );
}

function renderStorage(locale?: 'zh-CN' | 'en-US') {
  return renderAtRoute(<SettingsPage />, '/settings/:section', '/settings/storage', locale);
}

describe('设置 · 数据与存储段', () => {
  beforeEach(() => mockInvoke.reset());

  it('🔴 app_environment 失败时显示错误码，而不是永远 skeleton', async () => {
    stub({}, { code: 'ipc/unknown_command', params: { cmd: 'app_environment' }, message: '' });
    renderStorage();

    expect(await screen.findByText('读取本机环境失败')).toBeInTheDocument();
    expect(screen.queryByText('/tmp/gdk-stub/data')).not.toBeInTheDocument();
  });

  it('六行事实都来自 app_environment（桩里的独特路径逐条上屏）', async () => {
    stub();
    renderStorage();

    expect(await screen.findByText('/tmp/gdk-stub/data')).toBeInTheDocument();
    expect(screen.getByText('/tmp/gdk-stub/data/geo.sqlite3')).toBeInTheDocument();
    expect(screen.getByText('/tmp/gdk-stub/data/screenshots')).toBeInTheDocument();
    expect(screen.getByText('/tmp/gdk-stub/data/logs')).toBeInTheDocument();
    expect(screen.getByText('/tmp/gdk-stub/exports')).toBeInTheDocument();
    // 迁移数也要上屏（它是"库结构到了哪一版"的唯一线索）。
    expect(screen.getByText('7')).toBeInTheDocument();
    // 防空跑：确实发过这条命令，而不是碰巧渲染出了同样的串。
    expect(mockInvoke.callsOf('app_environment').length).toBeGreaterThan(0);
  });

  it('🔴 库大小走人类可读格式，不是裸字节数', async () => {
    stub();
    renderStorage();

    expect(await screen.findByText(bytesText(3_481_600))).toBeInTheDocument();
    expect(screen.getByText('3.3 MB')).toBeInTheDocument();
    expect(screen.queryByText('3481600')).not.toBeInTheDocument();
    expect(screen.queryByText('3,481,600')).not.toBeInTheDocument();
  });

  it('导出目录为空时给一句说明，而不是一个空白单元格', async () => {
    stub({ export_dir: null });
    renderStorage();

    expect(await screen.findByText('还没有导出过')).toBeInTheDocument();
    expect(screen.queryByText('/tmp/gdk-stub/exports')).not.toBeInTheDocument();
  });

  it('「打开目录」「更改目录」置灰，并说明由桌面端提供', async () => {
    stub();
    renderStorage();
    await screen.findByText('/tmp/gdk-stub/data');

    // ⚠ 用正则而不是全字符串：antd 的图标 span 自带 `aria-label`（`folder-open` / `swap`），
    // 它会算进按钮的可访问名，`{ name: '打开目录' }` 因此匹配不上（与「保存设置」那条同口径）。
    expect(screen.getByRole('button', { name: /打开目录/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /更改目录/ })).toBeDisabled();
    expect(screen.getByText('目录操作由桌面端提供，演示模式下不可用。')).toBeInTheDocument();
  });

  it('常驻一句"演示模式不读写磁盘"：这些路径在浏览器里并不存在', async () => {
    stub();
    renderStorage();

    expect(
      await screen.findByText('演示模式不读写磁盘，下面是桌面端将使用的位置与一份示例占用。'),
    ).toBeInTheDocument();
  });

  it('本段是自动保存段（DR-28）：没有「保存设置」按钮', async () => {
    stub();
    renderStorage();
    await screen.findByText('/tmp/gdk-stub/data');

    expect(screen.queryByRole('button', { name: /保存设置/ })).not.toBeInTheDocument();
  });

  it('en-US 下骨架文案都是英文', async () => {
    stub();
    renderStorage('en-US');

    expect(await screen.findByRole('heading', { name: 'Data and storage' })).toBeInTheDocument();
    // 先等数据到位：`app_environment` 回来之前这一段渲染的是 Card 的 loading 骨架。
    await screen.findByText('/tmp/gdk-stub/data');
    expect(screen.getByText('Data directory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open folder/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Change folder/ })).toBeDisabled();
    // 路径本身语言无关，照旧上屏
    expect(screen.getByText('/tmp/gdk-stub/data')).toBeInTheDocument();
  });
});

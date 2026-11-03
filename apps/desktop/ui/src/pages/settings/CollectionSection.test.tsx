/**
 * 设置 · 采集与频控段（Plan B Task 2）。
 *
 * 原先这一条在 `pages/SettingsPage.test.tsx` 里叫「修改并发数后**保存**调用 settings_update」；
 * 拆段之后本段是**自动保存**段（spec DR-28），所以断言的触发方式从"点保存"变成"改完等防抖"。
 * 判据强度不减：仍然钉「写出去的整包里 `concurrency.max_parallel === 5`」。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsPage from '../SettingsPage';
import { mockInvoke } from '../../test/invoke-mock';
import { renderAtRoute } from '../../test/render';
import { PROVIDERS, makeAppSettings } from '../../test/fixtures';
import type { AppSettings } from '../../api/types';

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

function renderCollection(locale?: 'zh-CN' | 'en-US') {
  return renderAtRoute(<SettingsPage />, '/settings/:section', '/settings/collection', locale);
}

describe('设置 · 采集与频控段', () => {
  beforeEach(() => mockInvoke.reset());

  it('修改并发数后自动写库（settings_update 收到整包）', async () => {
    stub();
    const user = userEvent.setup();
    renderCollection();
    await screen.findByRole('heading', { name: '采集与频控' });

    const parallel = screen.getByLabelText('最大并发');
    await user.clear(parallel);
    await user.type(parallel, '5');

    // 输入会触发多次防抖写库：并行全量跑时先落地的是中间值（3），必须等到**最后一次**是 5。
    await waitFor(() => {
      const sent = mockInvoke.lastArgsOf('settings_update')?.settings as AppSettings | undefined;
      expect(sent?.concurrency.max_parallel).toBe(5);
    });
  });

  it('B-2 · 分段骨架文案在 en-US 下渲染成英文', async () => {
    stub();
    renderCollection('en-US');

    expect(await screen.findByRole('heading', { name: 'Collection and rate limits' })).toBeInTheDocument();
    expect(screen.getByLabelText('Max parallelism')).toBeInTheDocument();
    expect(screen.getByLabelText('Minimum interval (ms)')).toBeInTheDocument();
  });

  it('B-2 对照 · 同一批断言在 zh-CN 下渲染成中文', async () => {
    stub();
    renderCollection();

    expect(await screen.findByRole('heading', { name: '采集与频控' })).toBeInTheDocument();
    expect(screen.getByLabelText('最大并发')).toBeInTheDocument();
    expect(screen.getByLabelText('最小间隔（毫秒）')).toBeInTheDocument();
  });
});

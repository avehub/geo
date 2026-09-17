import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsPage from './SettingsPage';
import { mockInvoke } from '../test/invoke-mock';
import { renderWithProviders } from '../test/render';
import { PROVIDERS } from '../test/fixtures';
import type { AppSettings } from '../api/types';

const SETTINGS: AppSettings = {
  proxy: null,
  concurrency: { max_parallel: 3, queue_size: 200 },
  rate_limit: { requests_per_minute: 20, min_interval_ms: 1500, retry_max: 3 },
  model: { provider: 'deepseek', model: null, temperature: 0.3, timeout_secs: 60 },
  language: 'zh_cn',
  notify: { on_finish: true, on_risk: true, sound: false },
};

function stub({ configured = false }: { configured?: boolean } = {}) {
  mockInvoke.stubAlways('llm_providers', () => PROVIDERS);
  mockInvoke.stubAlways('settings_get', () => SETTINGS);
  mockInvoke.stubAlways('settings_update', (args) => args.settings);
  mockInvoke.stubAlways('secret_status', (args) => ({
    provider: args.provider,
    configured,
    secret_ref: `keyring://llm/${args.provider}`,
  }));
  mockInvoke.stubAlways('secret_set', () => null);
  mockInvoke.stubAlways('secret_delete', () => null);
}

describe('SettingsPage', () => {
  beforeEach(() => mockInvoke.reset());

  it('展示 Provider 的 base_url 与默认模型（只读）', async () => {
    stub();
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText('https://api.deepseek.com/v1')).toBeInTheDocument();
    const model = screen.getByLabelText('默认模型');
    expect(model).toHaveValue('deepseek-chat');
    expect(model).toBeDisabled();
  });

  it('切换 Provider 后展示对应的 base_url 与默认模型', async () => {
    stub();
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText('https://api.deepseek.com/v1');

    await user.click(screen.getByRole('radio', { name: 'Moonshot' }));

    expect(await screen.findByText('https://api.moonshot.cn/v1')).toBeInTheDocument();
    expect(screen.getByLabelText('默认模型')).toHaveValue('moonshot-v1-8k');
  });

  it('未配置 Key 时显示「未配置」并提供保存入口', async () => {
    stub({ configured: false });
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText('未配置')).toBeInTheDocument();
    expect(screen.getByText('keyring://llm/deepseek')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保存到钥匙串/ })).toBeEnabled();
  });

  it('保存 Key 调用 secret_set 且输入框随后清空', async () => {
    stub({ configured: false });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText('未配置');

    const input = screen.getByPlaceholderText('请输入 API Key');
    await user.type(input, 'sk-test-123456');
    await user.click(screen.getByRole('button', { name: /保存到钥匙串/ }));

    await waitFor(() => expect(mockInvoke.callsOf('secret_set')).toHaveLength(1));
    expect(mockInvoke.lastArgsOf('secret_set')).toEqual({
      provider: 'deepseek',
      value: 'sk-test-123456',
    });
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('测试连接在无 Key 时展示中文错误「未配置 API Key」', async () => {
    stub({ configured: false });
    mockInvoke.stubAlways(
      'llm_provider_test',
      { code: 'llm/missing_secret', message: '未配置 API Key' },
      'reject',
    );
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText('未配置');

    await user.click(screen.getByRole('button', { name: /测试连接/ }));

    expect(await screen.findByText(/未配置 API Key/)).toBeInTheDocument();
  });

  it('测试连接成功时展示模型与成本', async () => {
    stub({ configured: true });
    mockInvoke.stubAlways('llm_provider_test', () => ({
      ok: true,
      model: 'deepseek-chat',
      latency_ms: 812,
      prompt_tokens: 120,
      completion_tokens: 30,
      cost_cny: 0.01,
      message: null,
    }));
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText('已配置');

    await user.click(screen.getByRole('button', { name: /测试连接/ }));

    expect(await screen.findByText(/deepseek-chat/)).toBeInTheDocument();
    expect(screen.getByText(/812 ms/)).toBeInTheDocument();
    expect(screen.getByText(/¥0.01/)).toBeInTheDocument();
  });

  it('修改并发数后保存调用 settings_update', async () => {
    stub({ configured: true });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText('已配置');

    const parallel = screen.getByLabelText('最大并发');
    await user.clear(parallel);
    await user.type(parallel, '5');
    await user.click(screen.getByRole('button', { name: /保存设置/ }));

    await waitFor(() => expect(mockInvoke.callsOf('settings_update')).toHaveLength(1));
    const sent = mockInvoke.lastArgsOf('settings_update')!.settings as AppSettings;
    expect(sent.concurrency.max_parallel).toBe(5);
  });
});

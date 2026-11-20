/**
 * `SecretStatus.tsx` 的运行时行为。
 *
 * 2026-11-19 产品裁定：演示边界已由 2026-11-19 产品裁定全部移除，
 * 密钥区不再重复「演示模式不会写入系统钥匙串」的提示。
 * 本文件钉住两件事：
 * ① demo 与 tauri 下密钥区都能正常渲染状态，且不出现演示模式文案；
 * ② 读取钥匙串失败时有错误与重试出口。
 *
 * ⚠ 控制 `runtime` 只能 `vi.mock`：它是 `api/runtime.ts` 的模块级常量，改 `window` 再渲染
 * 拿到的还是模块首次求值那一个。可变盒子 + 命名空间 getter 的写法沿用项目里既有的 runtime 测试模式。
 */
import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import SecretStatusPanel from './SecretStatus';
import zhCN from '../i18n/locales/zh-CN';
import { mockInvoke } from '../test/invoke-mock';
import { renderWithProviders } from '../test/render';
import type { Runtime } from '../api/runtime';

const runtimeBox = vi.hoisted(() => ({ current: 'tauri' as Runtime }));

vi.mock('../api/runtime', () => ({
  get runtime(): Runtime {
    return runtimeBox.current;
  },
  detectRuntime: (): Runtime => runtimeBox.current,
}));

/** 后端 `LlmProvider::as_str()` 的稳定 id 之一（demo 种子里 7 把 Key 都是未配置态）。 */
const PROVIDER = 'deep_seek';

function stubSecretStatus() {
  mockInvoke.stubAlways('secret_status', (args) => ({
    provider: args.provider,
    configured: false,
    secret_ref: `keyring://llm/${args.provider}`,
  }));
}

describe('SecretStatus · 密钥区', () => {
  beforeEach(() => {
    runtimeBox.current = 'tauri';
    stubSecretStatus();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockInvoke.reset();
    runtimeBox.current = 'tauri';
  });

  it('demo 运行时：密钥区不重复演示提示，状态照常渲染', async () => {
    runtimeBox.current = 'demo';

    renderWithProviders(<SecretStatusPanel provider={PROVIDER} />);

    expect(await screen.findByText(zhCN.settings.secret.notConfigured)).toBeInTheDocument();
    expect(screen.queryByText(/演示模式/)).toBeNull();
  });

  /**
   * 回归：设置页一打开就查 `secret_status`。旧实现对失败没有任何出口——
   * 标签永远停在「读取中」，用户看到的就是「输入密码后没有任何响应」。
   */
  it('读取钥匙串状态失败时显示错误与重试，而不是永远停在「读取中」', async () => {
    // `beforeEach` 已经挂了一条 resolve 桩；先清掉，否则这条命令会先命中它。
    mockInvoke.reset();
    mockInvoke.stubAlways(
      'secret_status',
      {
        code: 'config/invalid',
        params: { reason: 'secret_unavailable' },
        message: 'config/invalid reason=secret_unavailable',
      },
      'reject',
    );

    renderWithProviders(<SecretStatusPanel provider={PROVIDER} />);

    expect(await screen.findByText(zhCN.settings.secret.readFailed)).toBeInTheDocument();
    // 错误说明来自稳定错误码词典，不是组件里的硬编码散文
    expect(
      screen.getByText(zhCN.errors['config/invalid'].replace('{{reason}}', zhCN.errors.reasons.secret_unavailable)),
    ).toBeInTheDocument();
    expect(screen.queryByText(zhCN.settings.secret.reading)).not.toBeInTheDocument();
    // 失败不自动重试：旧实现每重读一次都可能再弹一次系统授权框
    expect(mockInvoke.callsOf('secret_status')).toHaveLength(1);
    // antd 会在两个汉字的按钮里自动插空格（「刷 新」），所以按字符放宽匹配。
    const retryName = new RegExp([...zhCN.common.refresh].join('\\s*'));
    expect(screen.getByRole('button', { name: retryName })).toBeInTheDocument();
  });

  it('切换服务商后清空上一家的 Key 输入与测试结果', async () => {
    mockInvoke.stubAlways('llm_provider_test', () => ({
      ok: true,
      model: 'deepseek-chat',
      latency_ms: 120,
      prompt_tokens: 10,
      completion_tokens: 5,
      cost_cny: 0,
      message: null,
    }));
    function Harness() {
      const [provider, setProvider] = useState('deep_seek');
      return (
        <>
          <button type="button" onClick={() => setProvider('kimi')}>
            switch-provider
          </button>
          <SecretStatusPanel provider={provider} />
        </>
      );
    }

    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    const input = await screen.findByPlaceholderText(zhCN.settings.secret.placeholder);
    await user.type(input, 'sk-old-provider');
    await user.click(screen.getByRole('button', { name: new RegExp(zhCN.settings.secret.test) }));
    expect(await screen.findByText('deepseek-chat')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'switch-provider' }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText(zhCN.settings.secret.placeholder)).toHaveValue(''),
    );
    expect(screen.queryByText('deepseek-chat')).not.toBeInTheDocument();
  });

  it('tauri 运行时：密钥区同样不出现演示提示', async () => {
    renderWithProviders(<SecretStatusPanel provider={PROVIDER} />);

    // 正向对照：同一个密钥区的常驻提示照常渲染 ⇒ 不是「整块没渲染」造成的缺席
    expect(await screen.findByText(zhCN.settings.secret.hint)).toBeInTheDocument();
    expect(screen.queryByText(/演示模式/)).toBeNull();
  });
});

/**
 * `SecretStatus.tsx` 的**演示模式密钥提示**（#23，台账 #32）。
 *
 * # 为什么这句文案必须存在
 * 计划正文 Task 14 的 Produces 逐字要求：demo 的 `secret_*` 只写内存，
 * **UI 侧必须提示「演示模式不会写入系统钥匙串」**。它不是免责声明，而是如实描述：
 * demo 的 `secret_set` 连内存都不存 Key（只把 `configured` 翻成 `true`、值当场丢弃，
 * `demo/handlers/secret.ts:53-62`）。少了这句，用户在浏览器里粘一把真 Key 点保存，
 * 会以为它进了钥匙串。
 *
 * # 为什么必须按运行时**条件渲染**
 * 真桌面端（Tauri）**确实**写系统钥匙串 ⇒ 那句话在那儿是假话。所以判据是两条对称的：
 * demo 下出现、tauri 下不出现（`DemoModeStrip` 同一个形状，同一个 `runtime` 常量）。
 *
 * ⚠ 控制 `runtime` 只能 `vi.mock`：它是 `api/runtime.ts` 的模块级常量，改 `window` 再渲染
 * 拿到的还是模块首次求值那一个。可变盒子 + 命名空间 getter 的写法照 `DemoModeStrip.test.tsx`。
 * ⚠ 盒子翻成 `'demo'` 时，`api/client.ts` 的分派也跟着走 demo 假后端（同一个常量既是
 * 文案开关也是路由开关）⇒ 那条用例跑的是**真的 demo 路径**，不是 stub。
 */
import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import SecretStatusPanel from './SecretStatus';
import enUS from '../i18n/locales/en-US';
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
const CJK = /[\u3000-\u303f\u4e00-\u9fa5\uff00-\uffef]/;

function stubSecretStatus() {
  mockInvoke.stubAlways('secret_status', (args) => ({
    provider: args.provider,
    configured: false,
    secret_ref: `keyring://llm/${args.provider}`,
  }));
}

describe('SecretStatus · 演示模式不写系统钥匙串（#23）', () => {
  beforeEach(() => {
    runtimeBox.current = 'tauri';
    stubSecretStatus();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockInvoke.reset();
    runtimeBox.current = 'tauri';
  });

  it('demo 运行时：密钥区渲染出计划正文逐字要求的那句话', async () => {
    runtimeBox.current = 'demo';

    renderWithProviders(<SecretStatusPanel provider={PROVIDER} />);

    // 断言的是**词典值本身**（改文案时两侧一起改，这里不用跟着改）
    expect(await screen.findByText(zhCN.demo.secretNoKeychain)).toBeInTheDocument();
    // 防空跑 + 逐字对齐计划正文：词典值真的承载了这个语义，且没被谁改写成别的意思
    expect(zhCN.demo.secretNoKeychain).toBe('演示模式不会写入系统钥匙串');
    // 密钥区确实渲染出来了（否则上面那条可能是「组件根本没渲染」的假绿）。
    // ⚠ 必须 await：那句提示不依赖查询状态（一挂载就在），而状态标签要等 `secret_status` 回来，
    // 同步 getByText 会撞上「读取中」那一帧。
    expect(await screen.findByText(zhCN.settings.secret.notConfigured)).toBeInTheDocument();
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

  it('tauri 运行时：那句话不出现（真桌面端确实写钥匙串，渲染它就是假话）', async () => {
    renderWithProviders(<SecretStatusPanel provider={PROVIDER} />);

    // 正向对照：同一个密钥区的常驻提示照常渲染 ⇒ 不是「整块没渲染」造成的缺席
    expect(await screen.findByText(zhCN.settings.secret.hint)).toBeInTheDocument();
    expect(screen.queryByText(zhCN.demo.secretNoKeychain)).not.toBeInTheDocument();
  });

  it('en-US + demo：渲染英文那句，且不含任何 CJK（AGENTS 规则 7）', async () => {
    runtimeBox.current = 'demo';

    renderWithProviders(<SecretStatusPanel provider={PROVIDER} />, { locale: 'en-US' });

    const rendered = await screen.findByText(enUS.demo.secretNoKeychain);
    expect(rendered).toBeInTheDocument();
    expect(enUS.demo.secretNoKeychain).not.toMatch(CJK);
    expect(enUS.demo.secretNoKeychain).not.toBe(zhCN.demo.secretNoKeychain);
    // 两侧都得说清「不会写钥匙串」这件事，不能一侧翻译成别的意思
    expect(enUS.demo.secretNoKeychain.toLowerCase()).toContain('keychain');
  });
});

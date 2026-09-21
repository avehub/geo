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
  model: {
    provider: 'deepseek',
    model: null,
    base_url: null,
    temperature: 0.3,
    timeout_secs: 60,
  },
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

    // Task 8：单选钮的名字改由 `settings.providers.<id>` 渲染，不再读 fixture 的
    // `label_zh`（那是后端产出自然语言的泄漏面）。zh 值逐字取自 `LlmProvider::label_zh()`。
    await user.click(screen.getByRole('radio', { name: 'Kimi（月之暗面）' }));

    expect(await screen.findByText('https://api.moonshot.cn/v1')).toBeInTheDocument();
    expect(screen.getByLabelText('默认模型')).toHaveValue('moonshot-v1-8k');
  });

  it('选「自定义」后填接口地址与模型名，保存时随设置一起提交', async () => {
    stub();
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText('https://api.deepseek.com/v1');

    await user.click(screen.getByRole('radio', { name: /自定义/ }));
    await user.type(await screen.findByLabelText('接口地址'), 'https://api.internal/v1');
    await user.type(screen.getByLabelText('模型名'), 'my-model');
    await user.click(screen.getByRole('button', { name: /保存设置/ }));

    await waitFor(() => expect(mockInvoke.callsOf('settings_update')).toHaveLength(1));
    const saved = mockInvoke.lastArgsOf('settings_update')!.settings as AppSettings;
    expect(saved.model.provider).toBe('custom');
    expect(saved.model.base_url).toBe('https://api.internal/v1');
    expect(saved.model.model).toBe('my-model');
  });

  it('从自定义切回预设会清掉接口地址覆盖，避免悄悄改走别的地址', async () => {
    stub();
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText('https://api.deepseek.com/v1');

    await user.click(screen.getByRole('radio', { name: /自定义/ }));
    await user.type(await screen.findByLabelText('接口地址'), 'https://api.internal/v1');
    // Task 8：单选钮的名字改由 `settings.providers.<id>` 渲染，不再读 fixture 的
    // `label_zh`（那是后端产出自然语言的泄漏面）。zh 值逐字取自 `LlmProvider::label_zh()`。
    await user.click(screen.getByRole('radio', { name: 'Kimi（月之暗面）' }));

    expect(await screen.findByText('https://api.moonshot.cn/v1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /保存设置/ }));

    await waitFor(() => expect(mockInvoke.callsOf('settings_update')).toHaveLength(1));
    const saved = mockInvoke.lastArgsOf('settings_update')!.settings as AppSettings;
    expect(saved.model.provider).toBe('moonshot');
    expect(saved.model.base_url).toBeNull();
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

  it('测试连接在无 Key 时按词典渲染 llm/missing_secret（不回显后端 message）', async () => {
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

    // Task 8：`SecretStatus` 的本地 describeError 换成 `describeIpcError`，渲染依据从
    // 后端的 `message`（`'未配置 API Key'`）变成稳定 `code` 的词典模板。
    // 断言由正则收紧成**全字符串**——强度只增不减。
    expect(
      await screen.findByText('还没有配置 API Key，请先在「设置」里填写并保存'),
    ).toBeInTheDocument();
  });

  /**
   * Task 15a 第 2 条（计划正文 Task 15 · 用户裁定 Q4）：**不展示价目与记账，但保留数据面**。
   *
   * 桩里刻意**保留** `cost_cny: 0.01`——要证明的正是"后端照旧返回、界面不再上屏"。
   * 把字段从桩里删掉的话，这条断言会退化成"没有数据当然不渲染"，判不出渲染层的改动
   * （变异自证见 task-15a-report.md：把成本行加回去 ⇒ 本条红）。
   *
   * ⚠ 断言强度对比旧版：旧版是「模型 + 耗时 + `¥0.01` 三项各一条 `getByText`」，
   * 新版把结果面板的**标签集**整个钉成 `['模型','耗时','用量']`（多一项少一项都红），
   * 再加「全文不含币符、不含 `0.01`」两条反向断言 ⇒ 只增不减。
   */
  it('测试连接成功时只展示模型 / 耗时 / 用量三项，不再展示成本', async () => {
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
    const labels = [...document.querySelectorAll('.ant-descriptions-item-label')].map(
      (node) => node.textContent,
    );
    expect(labels, '结果面板应恰好是「模型 / 耗时 / 用量」三项').toEqual(['模型', '耗时', '用量']);
    expect(screen.getByText('812 ms')).toBeInTheDocument();
    expect(screen.getByText('120 / 30 tokens')).toBeInTheDocument();

    // 不含「成本」标签；全文不含任何币符（半角 `¥` U+00A5 与全角 `￥` U+FFE5 都算）；
    // 也不含那个金额数字——`cost_cny` 在数据面仍在，只是**任何形式都不上屏**。
    expect(screen.queryByText('成本')).not.toBeInTheDocument();
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/[¥￥]/);
    expect(body).not.toContain('0.01');
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

  /**
   * 裁定 B-2：页面级冒烟（静态 chrome）。这一页的 label 用 `<label htmlFor>` 关联控件，
   * 所以 `getByLabelText` 同时钉住了「文案进了词典」与「关联没被抽取弄断」两件事。
   * ⚠ 不写「整页无 CJK」：单选钮的服务商名走 `settings.providers.*`（Task 8 已抽），
   * 但 `ProxyForm` / `SecretStatus` 里的示例数据仍是中文。
   */
  it('B-2 · 页面骨架文案在 en-US 下渲染成英文', async () => {
    stub();
    renderWithProviders(<SettingsPage />, { locale: 'en-US' });

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Model provider')).toBeInTheDocument();
    expect(screen.getByLabelText('Model name')).toBeInTheDocument();
    expect(screen.getByLabelText('Max parallelism')).toBeInTheDocument();
    expect(screen.getByLabelText('Minimum interval (ms)')).toBeInTheDocument();
    expect(screen.getByText('Language and notifications')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save settings/ })).toBeInTheDocument();
  });

  it('B-2 对照 · 同一批断言在 zh-CN 下渲染成中文', async () => {
    stub();
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByText('模型服务商')).toBeInTheDocument();
    expect(screen.getByLabelText('模型名')).toBeInTheDocument();
    expect(screen.getByLabelText('最大并发')).toBeInTheDocument();
    expect(screen.getByLabelText('最小间隔（毫秒）')).toBeInTheDocument();
    expect(screen.getByText('语言与通知')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保存设置/ })).toBeInTheDocument();
  });
});

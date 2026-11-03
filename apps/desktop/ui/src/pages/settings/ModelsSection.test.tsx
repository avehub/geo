/**
 * 设置 · 模型服务商段（Plan B Task 2）。
 *
 * # 这批用例是**平移**过来的，不是新写的
 * 原先它们全在 `pages/SettingsPage.test.tsx` 里（Task 2 把那张单页拆成五个分段）。
 * 断言逐条平移、一条不丢：spec §11 要求"按 section 拆分，断言逐条平移不许丢"。
 * 唯一的形态差别是渲染入口——从 `<SettingsPage />` 变成"在 `/settings/models` 上渲染
 * `<SettingsPage />`"，这样连**分段分派**（`SettingsLayout` 选对了组件）一起测到。
 *
 * 🔴 本段是**显式保存**段（spec DR-28）：所以下面每条"保存时提交"的用例都仍然要点
 * 「保存设置」按钮。`general` / `collection` 两段的自动保存判据在各自的测试文件里。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsPage from '../SettingsPage';
import { mockInvoke } from '../../test/invoke-mock';
import { renderAtRoute } from '../../test/render';
import { PROVIDERS, makeAppSettings } from '../../test/fixtures';
import { SEED_SETTINGS } from '../../demo/seed/settings';
import zhCN from '../../i18n/locales/zh-CN';
import type { AppSettings } from '../../api/types';

const SETTINGS: AppSettings = makeAppSettings();

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

function renderModels(locale?: 'zh-CN' | 'en-US') {
  return renderAtRoute(<SettingsPage />, '/settings/:section', '/settings/models', locale);
}

describe('设置 · 模型服务商段', () => {
  beforeEach(() => mockInvoke.reset());

  it('展示 Provider 的 base_url 与默认模型（只读）', async () => {
    stub();
    renderModels();

    expect(await screen.findByText('https://api.deepseek.com/v1')).toBeInTheDocument();
    const model = screen.getByLabelText('默认模型');
    expect(model).toHaveValue('deepseek-chat');
    expect(model).toBeDisabled();
  });

  it('切换 Provider 后展示对应的 base_url 与默认模型', async () => {
    stub();
    const user = userEvent.setup();
    renderModels();
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
    renderModels();
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

  it('🔴 显式保存（DR-28）：改了但没点保存 ⇒ 一次 settings_update 都不发', async () => {
    stub();
    const user = userEvent.setup();
    renderModels();
    await screen.findByText('https://api.deepseek.com/v1');

    await user.click(screen.getByRole('radio', { name: 'Kimi（月之暗面）' }));
    await screen.findByText('https://api.moonshot.cn/v1');
    expect(screen.getByText('有未保存的修改')).toBeInTheDocument();

    // 等过防抖窗口（500ms）：自动保存段这时候已经写库了，本段必须一次都没写。
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mockInvoke.callsOf('settings_update')).toHaveLength(0);
  });

  it('从自定义切回预设会清掉接口地址覆盖，避免悄悄改走别的地址', async () => {
    stub();
    const user = userEvent.setup();
    renderModels();
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
    renderModels();

    expect(await screen.findByText('未配置')).toBeInTheDocument();
    expect(screen.getByText('keyring://llm/deepseek')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保存到钥匙串/ })).toBeEnabled();
  });

  it('保存 Key 调用 secret_set 且输入框随后清空', async () => {
    stub({ configured: false });
    const user = userEvent.setup();
    renderModels();
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
    renderModels();
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
    renderModels();
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

  /**
   * 裁定 B-2：分段级冒烟（静态 chrome）。这一段的 label 用 `<label htmlFor>` 关联控件，
   * 所以 `getByLabelText` 同时钉住了「文案进了词典」与「关联没被抽取弄断」两件事。
   * ⚠ 不写「整页无 CJK」：单选钮的服务商名走 `settings.providers.*`（Task 8 已抽），
   * 但 `ProxyForm` / `SecretStatus` 里的示例数据仍是中文；整页判据在
   * `pages/en-us-page-residual.test.tsx` 里按分段各扫一次。
   */
  it('B-2 · 分段骨架文案在 en-US 下渲染成英文', async () => {
    stub();
    renderModels('en-US');

    expect(await screen.findByRole('heading', { name: 'Model providers' })).toBeInTheDocument();
    expect(screen.getByText('Model provider')).toBeInTheDocument();
    expect(screen.getByLabelText('Model name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save settings/ })).toBeInTheDocument();
  });

  it('B-2 对照 · 同一批断言在 zh-CN 下渲染成中文', async () => {
    stub();
    renderModels();

    expect(await screen.findByRole('heading', { name: '模型服务商' })).toBeInTheDocument();
    // ⚠ `getByText` 换成 `getAllByText`：拆段之后「模型服务商」这一个串同时是**菜单项**、
    // **分段标题**与**卡片标题**（`settings.sections.models` 与 `settings.page.modelCard`
    // 的 zh 值逐字相同，刻意不改文案）。断言强度不减：仍然要求它上屏，且至少两处
    // （标题 + 卡片）——菜单项那一处由 `SettingsLayout.test.tsx` 的"恰好 5 项"钉住。
    expect(screen.getAllByText('模型服务商').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('模型名')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保存设置/ })).toBeInTheDocument();
  });
});

/**
 * Plan B Task 4 新增（spec DR-33 / DR-34 / §6）：中转站预设、模型协议、按配置拉取模型列表。
 *
 * 🔴 与上面那批**平移**用例的区别：这批的桩数据换成 demo 的真种子（`SEED_SETTINGS`），
 * 因为要验的正是"厂商清单长成 12 项、顺序对"这件产品事实；`fixtures.PROVIDERS` 只有 3 项、
 * 且刻意用了与种子不同的 id（`'deepseek'` 无下划线），拿它验不出顺序。
 *
 * 顺序断言**只钉 id**（契约冻结的那一层），标签从 zh-CN 词典现算——手抄一遍标签
 * 就等于把"词典改了、界面没改"这个漂移面重新造出来（手法同 `en-us-page-residual.test.tsx`）。
 */
describe('设置 · 模型服务商段（Task 4：中转站 / 协议 / 拉取模型列表）', () => {
  beforeEach(() => mockInvoke.reset());

  /** 厂商清单的顺序：6 家国内厂商 → 5 家中转站 → `custom` 末位（DR-33，词典与种子同序）。 */
  const EXPECTED_PROVIDER_ORDER = [
    'deep_seek',
    'moonshot',
    'volcengine_ark',
    'ali_bailian',
    'baidu_qianfan',
    'tencent_hunyuan',
    'openrouter',
    'siliconflow',
    '302ai',
    'yunwu',
    'deepbricks',
    'custom',
  ];

  const GATEWAY_BASE_URL = 'https://gateway.example.com/v1';

  function stubSeed() {
    mockInvoke.stubAlways('llm_providers', () => structuredClone(SEED_SETTINGS.providers));
    mockInvoke.stubAlways('settings_get', () => structuredClone(SEED_SETTINGS.app));
    mockInvoke.stubAlways('settings_update', (args) => args.settings);
    mockInvoke.stubAlways('secret_status', (args) => ({
      provider: args.provider,
      configured: false,
      secret_ref: `keyring://llm/${args.provider}`,
    }));
    mockInvoke.stubAlways('secret_set', () => null);
    mockInvoke.stubAlways('secret_delete', () => null);
  }

  /** 单选钮的可读名（antd 把文案放在包着 input 的 label 里）。 */
  function radioNames(): string[] {
    return screen
      .getAllByRole('radio')
      .map((radio) => radio.closest('label')?.textContent ?? '');
  }

  async function renderAndWait() {
    renderModels();
    await screen.findByText('https://api.deepseek.com/v1');
  }

  it('厂商一共 12 项，顺序对上；标签取自词典而不是手抄', async () => {
    stubSeed();
    await renderAndWait();

    expect(SEED_SETTINGS.providers.map((info) => info.provider)).toEqual(EXPECTED_PROVIDER_ORDER);
    expect(radioNames()).toEqual(
      EXPECTED_PROVIDER_ORDER.map(
        (id) => zhCN.settings.providers[id as keyof typeof zhCN.settings.providers],
      ),
    );
    expect(screen.getAllByRole('radio')).toHaveLength(12);
  });

  it('「模型协议」只在选自定义时出现（spec §6：预设厂商的协议由后端固定）', async () => {
    stubSeed();
    const user = userEvent.setup();
    await renderAndWait();

    expect(screen.queryByText('模型协议')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /自定义服务商/ }));
    expect(await screen.findByLabelText('模型协议')).toBeInTheDocument();

    // 切回预设厂商 ⇒ 控件消失（不是置灰）
    await user.click(screen.getByRole('radio', { name: 'DeepSeek（深度求索）' }));
    await waitFor(() => expect(screen.queryByText('模型协议')).not.toBeInTheDocument());
  });

  it('协议两档都能选，选 Anthropic 原生后随设置一起提交', async () => {
    stubSeed();
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole('radio', { name: /自定义服务商/ }));
    // ⚠ 两档标签都从**下拉里**读（`.ant-select-item-option` 的 title），不用 `findByTitle`：
    // 当前选中项自己也在 DOM 里带一个同名 title，`findByTitle('OpenAI 兼容')` 会一次命中两处。
    // 也不用 `findAllByRole('option')`：antd 那两个 role=option 节点是给读屏软件的隐藏副本，
    // `textContent` 是裸枚举值，拿它断言标签等于把判据建在辅助节点上。
    await user.click(await screen.findByLabelText('模型协议'));
    await screen.findByTitle('Anthropic 原生');
    // 🔴 到这里下拉已经展开了；再点一次那个 label 会把它**收起来**（收起动画期间节点还在、
    // 只是 `pointer-events: none`），后面那条点击就会报"无法进行指针交互"。
    expect(
      [...document.querySelectorAll('.ant-select-item-option')].map((node) =>
        node.getAttribute('title'),
      ),
    ).toEqual(['OpenAI 兼容', 'Anthropic 原生']);
    await user.click(screen.getByTitle('Anthropic 原生'));

    await user.type(await screen.findByLabelText('接口地址'), GATEWAY_BASE_URL);
    await user.click(screen.getByRole('button', { name: /保存设置/ }));

    await waitFor(() => expect(mockInvoke.callsOf('settings_update')).toHaveLength(1));
    const saved = mockInvoke.lastArgsOf('settings_update')!.settings as AppSettings;
    expect(saved.model.protocol).toBe('anthropic');
    expect(saved.model.provider).toBe('custom');
  });

  it('点「拉取模型列表」：加载态可观测 → 入参是界面上的草稿配置 → 模型名下拉变成拉回来的清单', async () => {
    stubSeed();
    // 用一个对象兜住 resolve：写成 `let release: … | null = null` 的话，TS 看不到闭包里的赋值
    // ⇒ 把它收窄成 `null`，下面那句 `release(...)` 直接编译不过。
    const deferred: { release: (value: unknown) => void } = { release: () => undefined };
    mockInvoke.stubAlways(
      'llm_models_list',
      () => new Promise((resolve) => { deferred.release = resolve; }),
    );
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole('button', { name: /拉取模型列表/ }));

    expect(await screen.findByText('正在拉取…')).toBeInTheDocument();
    // 🔴 入参 = 界面上的草稿配置（DR-34），不是**已落库**那份；`api_key` 恒为 null
    // （demo 的 Key 只在 `SecretStatusPanel` 内部，从不经这条命令出去）。
    expect(mockInvoke.lastArgsOf('llm_models_list')).toEqual({
      provider: 'deep_seek',
      protocol: 'openai_compat',
      base_url: 'https://api.deepseek.com/v1',
      api_key: null,
    });

    deferred.release({ models: ['deepseek-chat', 'deepseek-reasoner'], source: 'preset' });

    expect(await screen.findByText('已取回 2 个预置模型名')).toBeInTheDocument();
    await user.click(screen.getByLabelText('模型名'));
    expect(await screen.findByTitle('deepseek-reasoner')).toBeInTheDocument();
    expect(screen.getByTitle('deepseek-chat')).toBeInTheDocument();
  });

  it('source=upstream 时用另一句文案（真后端会走这一支，demo 恒为 preset）', async () => {
    stubSeed();
    mockInvoke.stubAlways('llm_models_list', () => ({ models: ['gpt-4o'], source: 'upstream' }));
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole('button', { name: /拉取模型列表/ }));

    expect(await screen.findByText('已从接口取回 1 个模型名')).toBeInTheDocument();
  });

  it('拉取失败：按词典渲染错误、不回显后端 message、且不清空已填的模型名', async () => {
    stubSeed();
    mockInvoke.stubAlways(
      'llm_models_list',
      { code: 'llm/missing_secret', message: 'raw backend message' },
      'reject',
    );
    const user = userEvent.setup();
    await renderAndWait();

    await user.type(screen.getByLabelText('模型名'), 'my-model');
    await user.click(screen.getByRole('button', { name: /拉取模型列表/ }));

    expect(
      await screen.findByText('还没有配置 API Key，请先在「设置」里填写并保存'),
    ).toBeInTheDocument();
    expect(screen.getByText('拉取失败不会清掉你已经填的模型名。')).toBeInTheDocument();
    expect(screen.getByLabelText('模型名')).toHaveValue('my-model');
    expect(document.body.textContent).not.toContain('raw backend message');
  });

  it('自定义服务商拉回空清单时给出解释，而不是一个静默的空下拉', async () => {
    stubSeed();
    mockInvoke.stubAlways('llm_models_list', () => ({ models: [], source: 'preset' }));
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole('radio', { name: /自定义服务商/ }));
    await user.type(await screen.findByLabelText('接口地址'), GATEWAY_BASE_URL);
    await user.click(screen.getByRole('button', { name: /拉取模型列表/ }));

    expect(
      await screen.findByText(
        '没有取回模型名。演示模式不访问外部接口，自定义服务商请直接手输模型名。',
      ),
    ).toBeInTheDocument();
  });

  it('改了厂商之后旧清单不再上屏（拉回来的模型属于那一套配置）', async () => {
    stubSeed();
    mockInvoke.stubAlways('llm_models_list', () => ({
      models: ['deepseek-chat'],
      source: 'preset',
    }));
    const user = userEvent.setup();
    await renderAndWait();

    await user.click(screen.getByRole('button', { name: /拉取模型列表/ }));
    expect(await screen.findByText('已取回 1 个预置模型名')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Kimi（月之暗面）' }));

    await waitFor(() =>
      expect(screen.queryByText('已取回 1 个预置模型名')).not.toBeInTheDocument(),
    );
    await user.click(screen.getByLabelText('模型名'));
    expect(screen.queryByTitle('deepseek-chat')).not.toBeInTheDocument();
  });

  it('en-US 下协议与拉取按钮都是英文（AGENTS 规则 7）', async () => {
    stubSeed();
    const user = userEvent.setup();
    renderModels('en-US');
    await screen.findByText('https://api.deepseek.com/v1');

    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    expect(await screen.findByLabelText('Model protocol')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fetch model list/ })).toBeInTheDocument();
  });
});

/**
 * `ProviderSelect` 的 i18n 泄漏守卫（Plan A Task 8 · 计划正文那条"控制器裁定"）。
 *
 * 这条泄漏的特殊之处：它**不是**组件里的 CJK 字面量，而是直接渲染后端给的
 * `ProviderInfo.label_zh`（← `LlmProvider::label_zh()`），英文 locale 下仍是中文，
 * 而"扫源码找中文"的守卫抓不到它。所以判据换成**哨兵**：fixture 的 `label_zh`
 * 一律设成独特串 `ZH-SENTINEL`，只要它出现在渲染结果里就是泄漏。
 *
 * 回退口径也是裁定的一部分：词典查不到时回退 **provider id 本身**，**绝不回退 `label_zh`**
 * ——回退它就等于把泄漏面原地留着，而且会让"词典漏了一个 id"从显眼的机器记号
 * 变成静默的中文串。
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ModelProtocol, ProviderInfo } from '../api/types';
import { MODEL_PROTOCOL_VALUES } from '../api/types';
import { i18n } from '../i18n';
import enUS from '../i18n/locales/en-US';
import zhCN from '../i18n/locales/zh-CN';
import { renderWithProviders } from '../test/render';
import ProviderSelect from './ProviderSelect';

/** 前端生产源码全集（测试文件排除）：用来数「查表机制」的拷贝份数。 */
const UI_SOURCES = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.*'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** 哨兵：`label_zh` 一旦泄漏到界面上就会被断言抓到。 */
const ZH_SENTINEL = 'ZH-SENTINEL';

/**
 * 厂商的稳定 id（Plan B Task 4 起 **12** 个 = Rust 的 7 个 + demo 独有的 5 家中转站）。
 *
 * - 前 6 个 + `custom` 逐字取自 `crates/geo-llm/src/provider.rs` 的 `LlmProvider::as_str()`；
 * - 后 5 个（`openrouter` / `siliconflow` / `302ai` / `yunwu` / `deepbricks`）是 **DR-33 的裁定**：
 *   中转站作为新 provider id 进预设表，**Rust 侧本轮零改动** ⇒ 桌面端今天会少这 5 项，
 *   差异登记在 `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`
 *   （E-47 那一族，与 M3–M7 那 20 条 demo 独有命令同性质）。
 *
 * 这里手写而不是运行时解析 Rust 源码：id 集由契约冻结，加一个 provider 是计划级决定，
 * 且**新增 id 时 UI 的失败形态是安全的**（回退成 id 本身，不会泄漏中文）。
 * 下面第一条用例钉住"集合就是这 12 个、两侧都非空"，防空跑也防漏建词条。
 * 🔴 **顺序**也钉住（`seed.test.ts` 的漂移守卫钉的是同一件事）：6 家国内厂商 → 5 家中转站 → `custom` 末位。
 */
const STABLE_PROVIDER_IDS = [
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
] as const;

/** 5 家中转站：demo 独有、Rust 侧还没有对应枚举成员（DR-33）。 */
const RELAY_PROVIDER_IDS = ['openrouter', 'siliconflow', '302ai', 'yunwu', 'deepbricks'] as const;

function makeProvider(provider: string): ProviderInfo {
  return {
    provider,
    label_zh: ZH_SENTINEL,
    base_url: `https://api.${provider}.example/v1`,
    default_model: `${provider}-chat`,
    input_per_mtok: 1,
    output_per_mtok: 2,
  };
}

const noop = () => undefined;
const noopProtocol = (_protocol: ModelProtocol) => undefined;

function renderSelect(
  providers: ProviderInfo[],
  value: string,
  locale?: 'zh-CN' | 'en-US',
  protocol: ModelProtocol = 'openai_compat',
) {
  return renderWithProviders(
    <ProviderSelect
      providers={providers}
      value={value}
      onChange={noop}
      baseUrl=""
      onBaseUrlChange={noop}
      protocol={protocol}
      onProtocolChange={noopProtocol}
    />,
    { locale },
  );
}

describe('ProviderSelect · 12 个稳定 id 的词条', () => {
  it('防空跑：id 集就是这 12 个（含顺序），且 settings.providers 下没有多余或缺失的键', () => {
    expect(STABLE_PROVIDER_IDS).toHaveLength(12);
    // 顺序：6 家国内厂商 → 5 家中转站 → custom 末位（`custom` 永远是最后一项）。
    expect(STABLE_PROVIDER_IDS[STABLE_PROVIDER_IDS.length - 1]).toBe('custom');
    expect([...STABLE_PROVIDER_IDS.slice(6, 11)]).toEqual([...RELAY_PROVIDER_IDS]);
    expect(Object.keys(zhCN.settings.providers).sort()).toEqual([...STABLE_PROVIDER_IDS].sort());
    expect(Object.keys(enUS.settings.providers).sort()).toEqual([...STABLE_PROVIDER_IDS].sort());
  });

  it('每个 id 两侧都有非空词条，且 zh 值逐字等于后端 label_zh()（UI 不漂移）', () => {
    // zh 值的真值源是 `crates/geo-llm/src/provider.rs` 的 `LlmProvider::label_zh()`。
    const labelZh: Record<string, string> = {
      deep_seek: 'DeepSeek（深度求索）',
      moonshot: 'Kimi（月之暗面）',
      volcengine_ark: '火山方舟（豆包）',
      ali_bailian: '阿里云百炼（通义千问）',
      baidu_qianfan: '百度千帆（文心一言）',
      tencent_hunyuan: '腾讯混元',
      // Plan B Task 4（DR-33）：5 家中转站。zh 值带一句括号说明，让"这是中转站而不是厂商"
      // 在界面上一眼可辨；🔴 每条都 **> 4 字**——`en-us-page-residual.test.tsx` 把种子里
      // ≤4 字的中文串逐字钉死（M-1 闸门），一个短名就会把放行面撑开。
      openrouter: 'OpenRouter（海外模型聚合）',
      siliconflow: '硅基流动（SiliconFlow）',
      '302ai': '302.AI（AI 应用超市）',
      yunwu: '云雾 API（中转站）',
      deepbricks: 'DeepBricks（API 中转）',
      // 🔴 从「自定义（OpenAI 兼容）」改成「自定义服务商」（spec §9-A 授权的文案改动）：
      // 协议现在**可选**（`openai_compat` / `anthropic`），把「OpenAI 兼容」写死在厂商名里
      // 就与新行为自相矛盾。en 侧同批从 'Custom (OpenAI-compatible)' 改成 'Custom'。
      custom: '自定义服务商',
    };

    for (const id of STABLE_PROVIDER_IDS) {
      expect(zhCN.settings.providers[id], `zh-CN settings.providers.${id}`).toBe(labelZh[id]);
      expect(i18n.getFixedT('en-US')(`settings.providers.${id}`), `en-US ${id}`).not.toBe('');
      expect(i18n.getFixedT('en-US')(`settings.providers.${id}`), `en-US ${id} 不许与 id 同形`).not.toBe(id);
    }
  });
});

describe('ProviderSelect · 不再渲染后端的 label_zh', () => {
  it('zh-CN 下渲染词典里的中文名，哨兵串一次都不出现', () => {
    const { container } = renderSelect(STABLE_PROVIDER_IDS.map(makeProvider), 'moonshot');

    expect(screen.getByRole('radio', { name: 'Kimi（月之暗面）' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'DeepSeek（深度求索）' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '自定义服务商' })).toBeInTheDocument();
    expect(container.textContent).not.toContain(ZH_SENTINEL);
  });

  it('en-US 下渲染英文名，哨兵串同样不出现（这才是原泄漏面）', () => {
    const { container } = renderSelect(STABLE_PROVIDER_IDS.map(makeProvider), 'moonshot', 'en-US');

    expect(screen.getByRole('radio', { name: 'Kimi (Moonshot)' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Custom' })).toBeInTheDocument();
    expect(container.textContent).not.toContain(ZH_SENTINEL);
    // 英文界面里不许残留任何中文品牌名
    expect(container.textContent).not.toContain('月之暗面');
  });

  it('词典查不到的 provider id 回退成 id 本身，绝不回退 label_zh', () => {
    const { container } = renderSelect([makeProvider('mystery_llm')], 'mystery_llm');

    expect(screen.getByRole('radio', { name: 'mystery_llm' })).toBeInTheDocument();
    expect(container.textContent).not.toContain(ZH_SENTINEL);
  });

  it('自证（对照组）：哨兵判据不是永真的——把 label_zh 当 children 渲染就会被抓到', () => {
    // 对照组：故意渲染一个直接读 label_zh 的元素，证明 `not.toContain(ZH_SENTINEL)`
    // 这条断言真的能红。少了这一条，上面三条就都是"以缺席为判据"的永真断言（§E）。
    const provider = makeProvider('moonshot');
    renderWithProviders(<span data-testid="leaky">{provider.label_zh}</span>);

    expect(screen.getByTestId('leaky').textContent).toContain(ZH_SENTINEL);
  });
});

/**
 * #25（台账 #08）：同一套「动态键查词典、查不到回退 id」的机制，全仓只许有一份实现。
 *
 * 原先三份拷贝：`i18n/enum-label.ts` 的 `enumLabel`（正主）、本组件的 `providerLabel`、
 * `pages/PromptSetPage.tsx` 里 notes 分派那一处。裁定是：本组件收进 `enumLabel`（约两行），
 * **本文件的五段式哨兵原样保留**（它是这套机制的判据，不许跟着改松）；
 * PromptSetPage 那一处**刻意不动**（控制器裁定：语义是整键拼接的 notes 分派，保留并在源码注释里点名区别）。
 *
 * 所以判据形状是「命中清单**恰好**是正主 + 那一条已认领的例外」：
 * 本组件再长回一份本地实现 ⇒ 清单多一项 ⇒ 红。
 */
describe('#25 · 查表机制只有一份实现 + 接口地址占位提示走词典', () => {
  /** 机制指纹：`rendered !== '' && rendered !== <key>` 这个 miss 判据（三份拷贝逐字同形）。 */
  const LOOKUP_MECHANISM = /rendered !== '' && rendered !==/;

  function lookupCopies(entries: ReadonlyArray<readonly [string, string]>): string[] {
    return entries
      .filter(([, source]) => LOOKUP_MECHANISM.test(source))
      .map(([path]) => path)
      .sort();
  }

  it('本组件改用 enumLabel，不再自带 providerLabel（PromptSetPage 那处是已认领的例外）', () => {
    const source = UI_SOURCES['./ProviderSelect.tsx'];

    // 防空跑：确实扫到了本组件的源码
    expect(source, 'glob 没扫到 ProviderSelect.tsx').toBeTruthy();
    expect(lookupCopies(Object.entries(UI_SOURCES))).toEqual([
      '../i18n/enum-label.ts',
      '../pages/PromptSetPage.tsx',
    ]);

    expect(source).toContain("import { enumLabel } from '../i18n/enum-label'");
    expect(source).toContain("enumLabel(t, 'settings.providers'");
    expect(source).not.toMatch(/function providerLabel/);
    // 动态键的**拼接**只该活在 enum-label.ts 里（注释里提到键名不算，所以判据认 `${` 这个形状）
    expect(source).not.toContain('settings.providers.${');
  });

  it('自证（对照组）：把本地实现塞回组件源码，上面那条清单断言就会红', () => {
    const planted: Array<[string, string]> = [
      ['../i18n/enum-label.ts', "return typeof rendered === 'string' && rendered !== '' && rendered !== key ? rendered : id;"],
      ['./ProviderSelect.tsx', "function providerLabel(t, provider) { const rendered = t(provider); return rendered !== '' && rendered !== provider ? rendered : provider; }"],
    ];

    expect(lookupCopies(planted)).toEqual(['../i18n/enum-label.ts', './ProviderSelect.tsx']);
  });

  it('custom 的接口地址占位提示走词典，值逐字不动（#47 点名的兄弟位置）', () => {
    expect(zhCN.settings.providerForm.baseUrlPlaceholder).toBe('https://api.example.com/v1');
    expect(enUS.settings.providerForm.baseUrlPlaceholder).toBe('https://api.example.com/v1');

    renderSelect(STABLE_PROVIDER_IDS.map(makeProvider), 'custom');

    expect(
      screen.getByPlaceholderText(zhCN.settings.providerForm.baseUrlPlaceholder),
    ).toBeInTheDocument();
    // 值只许活在词典里：组件源码不再出现那个字面量
    expect(UI_SOURCES['./ProviderSelect.tsx']).not.toContain('placeholder="https://api.example.com/v1"');
  });

  it('en-US 下同一个占位提示也在（两侧同批加键，AGENTS 规则 7）', () => {
    renderSelect(STABLE_PROVIDER_IDS.map(makeProvider), 'custom', 'en-US');

    expect(
      screen.getByPlaceholderText(enUS.settings.providerForm.baseUrlPlaceholder),
    ).toBeInTheDocument();
  });
});

/**
 * Plan B Task 4：**模型协议**控件（spec §6 / DR-34）。
 *
 * 判据是"只在自定义下出现"这一条**结构事实**，不是样式：预设厂商与中转站的协议由后端固定，
 * 给用户一个能改的下拉就等于允许他改出一个连不上的配置。
 * 五段式哨兵（上面那三个 describe）刻意**一条没动**——协议控件与 `label_zh` 泄漏面无关。
 */
describe('ProviderSelect · 模型协议（Task 4）', () => {
  it('防空跑：协议就是契约里那两档，两侧词典都非空且不与 id 同形', () => {
    expect([...MODEL_PROTOCOL_VALUES]).toEqual(['openai_compat', 'anthropic']);
    expect(Object.keys(zhCN.settings.protocols)).toEqual([...MODEL_PROTOCOL_VALUES]);
    expect(Object.keys(enUS.settings.protocols)).toEqual([...MODEL_PROTOCOL_VALUES]);

    for (const protocol of MODEL_PROTOCOL_VALUES) {
      expect(zhCN.settings.protocols[protocol], `zh ${protocol}`).not.toBe('');
      const rendered = i18n.getFixedT('en-US')(`settings.protocols.${protocol}`);
      expect(rendered, `en ${protocol}`).not.toBe('');
      // en 值不许与 id 同形：同形说明词典漏了、`enumLabel` 回退了裸 id。
      expect(rendered, `en ${protocol} 不许与 id 同形`).not.toBe(protocol);
      // en 值一律 ASCII（`en-us-page-residual.test.tsx` 把 en 词典的 CJK 值钉成恰好 2 条）。
      expect(rendered).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it('选自定义才渲染协议下拉，当前档位上屏（受控）', () => {
    renderSelect(STABLE_PROVIDER_IDS.map(makeProvider), 'custom');

    expect(screen.getByLabelText('模型协议')).toBeInTheDocument();
    // 默认档 `openai_compat` 的标签就在选择器上 ⇒ 值真的接进去了，不是空壳。
    expect(screen.getByText(zhCN.settings.protocols.openai_compat)).toBeInTheDocument();
  });

  it('预设厂商与中转站都不渲染协议下拉（不是置灰，是不出现）', () => {
    for (const provider of STABLE_PROVIDER_IDS.filter((id) => id !== 'custom')) {
      const { unmount } = renderSelect(STABLE_PROVIDER_IDS.map(makeProvider), provider);
      expect(screen.queryByText('模型协议'), provider).not.toBeInTheDocument();
      unmount();
    }
  });

  it('en-US 下协议标签也是英文', () => {
    renderSelect(STABLE_PROVIDER_IDS.map(makeProvider), 'custom', 'en-US');

    expect(screen.getByLabelText('Model protocol')).toBeInTheDocument();
    expect(screen.getByText('OpenAI-compatible')).toBeInTheDocument();
  });

  it('切档经 onProtocolChange 出去，且传入的 protocol 值被选中（受控）', async () => {
    const seen: ModelProtocol[] = [];
    const user = userEvent.setup();
    renderWithProviders(
      <ProviderSelect
        providers={STABLE_PROVIDER_IDS.map(makeProvider)}
        value="custom"
        onChange={noop}
        baseUrl=""
        onBaseUrlChange={noop}
        protocol="anthropic"
        onProtocolChange={(protocol) => seen.push(protocol)}
      />,
    );

    expect(screen.getByText('Anthropic 原生')).toBeInTheDocument();

    await user.click(screen.getByLabelText('模型协议'));
    await user.click(await screen.findByTitle('OpenAI 兼容'));

    expect(seen).toEqual(['openai_compat']);
  });
});

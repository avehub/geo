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

import type { ProviderInfo } from '../api/types';
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
 * 后端 `LlmProvider::as_str()` 的 7 个稳定 id（`crates/geo-llm/src/provider.rs`）。
 *
 * 这里手写而不是运行时解析 Rust 源码：id 集由契约冻结，加一个 provider 是计划级决定，
 * 且**新增 id 时 UI 的失败形态是安全的**（回退成 id 本身，不会泄漏中文）。
 * 下面第一条用例钉住"集合就是这 7 个、两侧都非空"，防空跑也防漏建词条。
 */
const STABLE_PROVIDER_IDS = [
  'deep_seek',
  'moonshot',
  'volcengine_ark',
  'ali_bailian',
  'baidu_qianfan',
  'tencent_hunyuan',
  'custom',
] as const;

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

function renderSelect(providers: ProviderInfo[], value: string, locale?: 'zh-CN' | 'en-US') {
  return renderWithProviders(
    <ProviderSelect
      providers={providers}
      value={value}
      onChange={noop}
      baseUrl=""
      onBaseUrlChange={noop}
    />,
    { locale },
  );
}

describe('ProviderSelect · 7 个稳定 id 的词条', () => {
  it('防空跑：id 集就是这 7 个，且 settings.providers 下没有多余或缺失的键', () => {
    expect(STABLE_PROVIDER_IDS).toHaveLength(7);
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
      custom: '自定义（OpenAI 兼容）',
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
    expect(screen.getByRole('radio', { name: '自定义（OpenAI 兼容）' })).toBeInTheDocument();
    expect(container.textContent).not.toContain(ZH_SENTINEL);
  });

  it('en-US 下渲染英文名，哨兵串同样不出现（这才是原泄漏面）', () => {
    const { container } = renderSelect(STABLE_PROVIDER_IDS.map(makeProvider), 'moonshot', 'en-US');

    expect(screen.getByRole('radio', { name: 'Kimi (Moonshot)' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Custom (OpenAI-compatible)' })).toBeInTheDocument();
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

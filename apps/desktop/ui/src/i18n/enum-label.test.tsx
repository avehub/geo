/**
 * 枚举标签查词典的哨兵测试（Task 9b · 简报 §B-4 / §B-5 / §B-6）。
 *
 * # 为什么必须有这一层
 *
 * `api/types.ts` 里那 5 张 zh 标签映射迁进词典之后，组件查的是**从数据拼出来的动态键**
 * （`enumLabel(t, 'prompt.intents', item.intent)`）。`i18n/no-hardcoded-strings.test.ts`
 * 只匹配**字面量单参** `t('…')`，模板串结构上不可能命中（简报 §A-12，且明令不许改它的
 * 匹配机制）⇒「词典漏了某个枚举 id」只有本文件的哨兵抓得到。
 *
 * # 五段式（照 `components/ProviderSelect.test.tsx` 的形状）
 *
 * ① 防空跑：值清单长度钉死，且两侧 `Object.keys` **恰好等于**值清单；
 * ② 两侧非空、zh **逐字**等于真值表、en 不与 id 同形且不含 CJK；
 * ③ zh / en 两种 locale 下**真实消费组件**渲染出词典标签，且中文哨兵串不出现；
 * ④ 词典查不到 ⇒ 回退 **id 本身**，绝不回退中文；
 * ⑤ **正向对照**：故意渲染泄漏版本，证明 ③ 的 `not.toContain` 判据抓得到、不是永真。
 *
 * # `prompt.sampleSize.warnings` 是 `Partial`
 *
 * `sufficient` **没有**告警键（`SampleSizeAlert` 对它渲染 `null`）。哨兵钉住这个语义，
 * 而不是为了「键集相等」给它编一条空告警（简报 §B-5）。
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import type { FieldStatus, Industry, PromptItem } from '../api/types';
import {
  FIELD_STATUS_VALUES,
  INDUSTRY_VALUES,
  INTENT_VALUES,
  PROMPT_SOURCE_VALUES,
  SAMPLE_SIZE_GRADE_VALUES,
} from '../api/types';
import { MINIMUM_SAMPLE_SIZE, SUFFICIENT_SAMPLE_SIZE } from '../api/constants';
import FieldStatusTag from '../components/FieldStatusTag';
import GeneratePanel from '../components/GeneratePanel';
import ProjectTable from '../components/ProjectTable';
import PromptTable from '../components/PromptTable';
import SampleSizeAlert from '../components/SampleSizeAlert';
import { makeProject, makePromptItem } from '../test/fixtures';
import { renderWithProviders } from '../test/render';
import { enumLabel } from './enum-label';
import { i18n } from './index';
import enUS from './locales/en-US';
import zhCN from './locales/zh-CN';

const noop = () => undefined;

/** CJK 汉字 + CJK 标点 + 全角形式（`no-hardcoded-strings` 的字符类看不见后两类）。 */
const CJK = /[\u3000-\u303f\u4e00-\u9fa5\uff00-\uffef]/;

const enT = () => i18n.getFixedT('en-US');
const zhT = () => i18n.getFixedT('zh-CN');

/**
 * zh 真值表：**逐字**抄自被删掉的 `api/types.ts` 标签映射（§B-1「一个字的措辞都不许改」）。
 * 它同时也是⑤正向对照里的泄漏内容。
 */
const INTENT_ZH: Record<string, string> = {
  category_awareness: '品类认知',
  purchase_recommendation: '选购推荐',
  brand_comparison: '品牌对比',
  pricing_plan: '价格方案',
  local_service: '本地服务',
  after_sales_reputation: '售后口碑',
  professional_long_tail: '专业长尾',
};

const SOURCE_ZH: Record<string, string> = {
  template: '模板',
  generated: 'AI 生成',
  rewritten: '口语化改写',
  manual: '人工',
  imported: 'CSV 导入',
};

const INDUSTRY_ZH: Record<string, string> = {
  b2b_manufacturing: 'B2B 制造与工业品',
  enterprise_saas: '企业服务/SaaS',
  local_service: '本地生活与专业服务',
  cross_border_ecommerce: '跨境电商',
  franchise: '招商加盟',
  other: '其他行业',
};

const FIELD_STATUS_ZH: Record<string, string> = {
  official: '官方口径',
  pending: '待确认',
  disputed: '存疑',
};

/** 告警文案的两条 zh 模板：数字已改成常量插值（§B-6），故这里登记的是**模板**而不是成品。 */
const WARNING_ZH: Record<string, string> = {
  directional: '样本不足，仅供方向性参考：当前 prompt 数低于 {{sufficient}} 条，波动区间较大。',
  insufficient: '样本不足（<{{minimum}} 条），不提供精确分数，仅供方向性参考。',
};

/** 表格数据刻意用 ASCII：这样③里的 `not.toContain(<zh 标签>)` 不会被数据里的中文干扰。 */
function promptItem(index: number, overrides: Partial<PromptItem> = {}): PromptItem {
  return makePromptItem(index, {
    text: `prompt text ${index}`,
    group_name: null,
    tags: [],
    competitor_ids: [],
    ...overrides,
  });
}

function renderPromptTable(items: PromptItem[], locale?: 'zh-CN' | 'en-US') {
  return renderWithProviders(
    <PromptTable
      items={items}
      selectedRowKeys={[]}
      onSelectionChange={noop}
      onWeightChange={noop}
      onRepeatCountChange={noop}
      onEdit={noop}
      onDelete={noop}
    />,
    { locale },
  );
}

function renderGeneratePanel(locale?: 'zh-CN' | 'en-US') {
  return renderWithProviders(<GeneratePanel defaultIndustry="other" onGenerate={noop} />, {
    locale,
  });
}

function renderStatusTag(status: FieldStatus, locale?: 'zh-CN' | 'en-US') {
  return renderWithProviders(<FieldStatusTag status={status} />, { locale });
}

function renderSampleAlert(
  grade: 'directional' | 'insufficient' | 'sufficient',
  locale?: 'zh-CN' | 'en-US',
) {
  return renderWithProviders(<SampleSizeAlert grade={grade} count={45} />, { locale });
}

// ---------------------------------------------------------------------------
// ① 意图 `prompt.intents.<id>` · 消费组件 `GeneratePanel` / `PromptTable`
// ---------------------------------------------------------------------------

describe('枚举标签 · prompt.intents（7 类意图）', () => {
  it('① 防空跑：值清单就是这 7 个（顺序 = 被删映射的键顺序），两侧键集恰好相等', () => {
    expect([...INTENT_VALUES]).toEqual([
      'category_awareness',
      'purchase_recommendation',
      'brand_comparison',
      'pricing_plan',
      'local_service',
      'after_sales_reputation',
      'professional_long_tail',
    ]);
    expect(INTENT_VALUES).toHaveLength(7);
    expect(Object.keys(zhCN.prompt.intents).sort()).toEqual([...INTENT_VALUES].sort());
    expect(Object.keys(enUS.prompt.intents).sort()).toEqual([...INTENT_VALUES].sort());
  });

  it('② zh 逐字等于真值表；en 非空、不与 id 同形、不含 CJK', () => {
    for (const id of INTENT_VALUES) {
      expect(zhCN.prompt.intents[id], `zh-CN prompt.intents.${id}`).toBe(INTENT_ZH[id]);
      const rendered = enT()(`prompt.intents.${id}`);
      expect(rendered, `en-US prompt.intents.${id} 非空`).not.toBe('');
      expect(rendered, `en-US prompt.intents.${id} 不许与 id 同形`).not.toBe(id);
      expect(CJK.test(rendered), `en-US prompt.intents.${id} 不含 CJK`).toBe(false);
    }
  });

  it('③ GeneratePanel 在 zh / en 下都渲染词典里的意图标签，中文哨兵不出现', () => {
    const enView = renderGeneratePanel('en-US');
    for (const id of INTENT_VALUES) {
      expect(
        screen.getByRole('checkbox', { name: enUS.prompt.intents[id] }),
        `en-US 意图 ${id}`,
      ).toBeInTheDocument();
      expect(enView.container.textContent).not.toContain(INTENT_ZH[id]);
    }
    enView.unmount();

    renderGeneratePanel();
    for (const id of INTENT_VALUES) {
      expect(
        screen.getByRole('checkbox', { name: INTENT_ZH[id] }),
        `zh-CN 意图 ${id}`,
      ).toBeInTheDocument();
    }
  });

  it('③b PromptTable 的意图列同样查词典（数据驱动的那条路径）', () => {
    const items = INTENT_VALUES.map((intent, index) => promptItem(index, { intent }));
    const enView = renderPromptTable(items, 'en-US');
    for (const id of INTENT_VALUES) {
      expect(screen.getByText(enUS.prompt.intents[id], { selector: '.ant-tag' })).toBeInTheDocument();
      expect(enView.container.textContent).not.toContain(INTENT_ZH[id]);
    }
  });

  it('④ 词典查不到的 intent 渲染成 id 本身，绝不回退中文', () => {
    renderPromptTable([promptItem(0, { intent: 'mystery_intent' as never })]);
    expect(screen.getByText('mystery_intent', { selector: '.ant-tag' })).toBeInTheDocument();
    expect(enumLabel(zhT(), 'prompt.intents', 'mystery_intent')).toBe('mystery_intent');
  });

  it('⑤ 自证（对照组）：把 zh 标签当 children 渲染，③的哨兵判据抓得到', () => {
    renderWithProviders(<span data-testid="leaky">{INTENT_ZH.category_awareness}</span>);
    expect(screen.getByTestId('leaky').textContent).toContain(INTENT_ZH.category_awareness);
    expect(CJK.test(screen.getByTestId('leaky').textContent ?? '')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ② 来源 `prompt.sources.<id>` · 消费组件 `PromptTable`
// ---------------------------------------------------------------------------

describe('枚举标签 · prompt.sources（5 种来源）', () => {
  it('① 防空跑：值清单就是这 5 个，两侧键集恰好相等', () => {
    expect([...PROMPT_SOURCE_VALUES]).toEqual([
      'template',
      'generated',
      'rewritten',
      'manual',
      'imported',
    ]);
    expect(PROMPT_SOURCE_VALUES).toHaveLength(5);
    expect(Object.keys(zhCN.prompt.sources).sort()).toEqual([...PROMPT_SOURCE_VALUES].sort());
    expect(Object.keys(enUS.prompt.sources).sort()).toEqual([...PROMPT_SOURCE_VALUES].sort());
  });

  it('② zh 逐字等于真值表；en 非空、不与 id 同形、不含 CJK', () => {
    for (const id of PROMPT_SOURCE_VALUES) {
      expect(zhCN.prompt.sources[id], `zh-CN prompt.sources.${id}`).toBe(SOURCE_ZH[id]);
      const rendered = enT()(`prompt.sources.${id}`);
      expect(rendered, `en-US prompt.sources.${id} 非空`).not.toBe('');
      expect(rendered, `en-US prompt.sources.${id} 不许与 id 同形`).not.toBe(id);
      expect(CJK.test(rendered), `en-US prompt.sources.${id} 不含 CJK`).toBe(false);
    }
  });

  it('③ PromptTable 的来源列在 zh / en 下都渲染词典标签，中文哨兵不出现', () => {
    const items = PROMPT_SOURCE_VALUES.map((source, index) => promptItem(index, { source }));

    const enView = renderPromptTable(items, 'en-US');
    for (const id of PROMPT_SOURCE_VALUES) {
      expect(screen.getByText(enUS.prompt.sources[id]), `en-US 来源 ${id}`).toBeInTheDocument();
      expect(enView.container.textContent).not.toContain(SOURCE_ZH[id]);
    }
    enView.unmount();

    renderPromptTable(items);
    for (const id of PROMPT_SOURCE_VALUES) {
      expect(screen.getByText(SOURCE_ZH[id]), `zh-CN 来源 ${id}`).toBeInTheDocument();
    }
  });

  it('④ 词典查不到的 source 渲染成 id 本身，绝不回退中文', () => {
    const { container } = renderPromptTable([promptItem(0, { source: 'mystery_source' as never })]);
    expect(screen.getByText('mystery_source')).toBeInTheDocument();
    expect(container.textContent).not.toContain(SOURCE_ZH.template);
    expect(enumLabel(enT(), 'prompt.sources', 'mystery_source')).toBe('mystery_source');
  });

  it('⑤ 自证（对照组）：把 zh 标签当 children 渲染，③的哨兵判据抓得到', () => {
    renderWithProviders(<span data-testid="leaky">{SOURCE_ZH.rewritten}</span>);
    expect(screen.getByTestId('leaky').textContent).toContain(SOURCE_ZH.rewritten);
  });
});

// ---------------------------------------------------------------------------
// ③ 行业 `project.industries.<id>` · 消费组件 `GeneratePanel` / `ProjectTable`
// ---------------------------------------------------------------------------

describe('枚举标签 · project.industries（6 个行业）', () => {
  it('① 防空跑：值清单就是这 6 个，两侧键集恰好相等', () => {
    expect([...INDUSTRY_VALUES]).toEqual([
      'b2b_manufacturing',
      'enterprise_saas',
      'local_service',
      'cross_border_ecommerce',
      'franchise',
      'other',
    ]);
    expect(INDUSTRY_VALUES).toHaveLength(6);
    expect(Object.keys(zhCN.project.industries).sort()).toEqual([...INDUSTRY_VALUES].sort());
    expect(Object.keys(enUS.project.industries).sort()).toEqual([...INDUSTRY_VALUES].sort());
  });

  it('② zh 逐字等于真值表；en 非空、不与 id 同形、不含 CJK', () => {
    for (const id of INDUSTRY_VALUES) {
      expect(zhCN.project.industries[id], `zh-CN project.industries.${id}`).toBe(INDUSTRY_ZH[id]);
      const rendered = enT()(`project.industries.${id}`);
      expect(rendered, `en-US project.industries.${id} 非空`).not.toBe('');
      expect(rendered, `en-US project.industries.${id} 不许与 id 同形`).not.toBe(id);
      expect(CJK.test(rendered), `en-US project.industries.${id} 不含 CJK`).toBe(false);
    }
  });

  it('③ GeneratePanel 的行业单选在 zh / en 下都渲染词典标签，中文哨兵不出现', () => {
    const enView = renderGeneratePanel('en-US');
    for (const id of INDUSTRY_VALUES) {
      expect(
        screen.getByRole('radio', { name: enUS.project.industries[id] }),
        `en-US 行业 ${id}`,
      ).toBeInTheDocument();
      expect(enView.container.textContent).not.toContain(INDUSTRY_ZH[id]);
    }
    enView.unmount();

    renderGeneratePanel();
    for (const id of INDUSTRY_VALUES) {
      expect(
        screen.getByRole('radio', { name: INDUSTRY_ZH[id] }),
        `zh-CN 行业 ${id}`,
      ).toBeInTheDocument();
    }
  });

  it('④ 词典查不到的 industry 渲染成 id 本身，绝不回退中文', () => {
    renderWithProviders(
      <ProjectTable
        projects={[makeProject({ industry: 'mystery_industry' as Industry, industry_label: null })]}
        onOpenEntityCard={noop}
        onOpenPrompts={noop}
        onToggleArchive={noop}
        onDelete={noop}
        onExport={noop}
        onTagsChange={noop}
      />,
      { locale: 'en-US' },
    );
    expect(screen.getByText('mystery_industry')).toBeInTheDocument();
    expect(enumLabel(enT(), 'project.industries', 'mystery_industry')).toBe('mystery_industry');
  });

  it('⑤ 自证（对照组）：把 zh 标签当 children 渲染，③的哨兵判据抓得到', () => {
    renderWithProviders(<span data-testid="leaky">{INDUSTRY_ZH.franchise}</span>);
    expect(screen.getByTestId('leaky').textContent).toContain(INDUSTRY_ZH.franchise);
  });
});

// ---------------------------------------------------------------------------
// ④ 字段状态 `entity.fieldStatuses.<id>` · 消费组件 `FieldStatusTag`
// ---------------------------------------------------------------------------

describe('枚举标签 · entity.fieldStatuses（3 个状态）', () => {
  it('① 防空跑：值清单就是这 3 个，两侧键集恰好相等', () => {
    expect([...FIELD_STATUS_VALUES]).toEqual(['official', 'pending', 'disputed']);
    expect(FIELD_STATUS_VALUES).toHaveLength(3);
    expect(Object.keys(zhCN.entity.fieldStatuses).sort()).toEqual([...FIELD_STATUS_VALUES].sort());
    expect(Object.keys(enUS.entity.fieldStatuses).sort()).toEqual([...FIELD_STATUS_VALUES].sort());
  });

  it('② zh 逐字等于真值表；en 非空、不与 id 同形、不含 CJK', () => {
    for (const id of FIELD_STATUS_VALUES) {
      expect(zhCN.entity.fieldStatuses[id], `zh-CN entity.fieldStatuses.${id}`).toBe(
        FIELD_STATUS_ZH[id],
      );
      const rendered = enT()(`entity.fieldStatuses.${id}`);
      expect(rendered, `en-US entity.fieldStatuses.${id} 非空`).not.toBe('');
      expect(rendered, `en-US entity.fieldStatuses.${id} 不许与 id 同形`).not.toBe(id);
      expect(CJK.test(rendered), `en-US entity.fieldStatuses.${id} 不含 CJK`).toBe(false);
    }
  });

  it('③ FieldStatusTag 在 zh / en 下都渲染词典标签，中文哨兵不出现', () => {
    for (const id of FIELD_STATUS_VALUES) {
      const enView = renderStatusTag(id, 'en-US');
      expect(screen.getByText(enUS.entity.fieldStatuses[id]), `en-US ${id}`).toBeInTheDocument();
      expect(enView.container.textContent).not.toContain(FIELD_STATUS_ZH[id]);
      enView.unmount();

      const zhView = renderStatusTag(id);
      expect(screen.getByText(FIELD_STATUS_ZH[id]), `zh-CN ${id}`).toBeInTheDocument();
      zhView.unmount();
    }
  });

  it('④ 词典查不到的 status ⇒ `enumLabel` 回退 id 本身，绝不回退中文', () => {
    // 渲染层的 miss 走不到：`FieldStatusTag` 同时还索引 `HINT_KEY`（一张 `TranslationKey`
    // 表），喂它一个契约外的 status 会先撞上 Tooltip 那条 `t(undefined)`，测的就不是
    // 标签回退了。所以这一族在**helper 层**钉 miss 语义（`enumLabel` 正是渲染标签的那个函数）。
    expect(enumLabel(zhT(), 'entity.fieldStatuses', 'mystery_status')).toBe('mystery_status');
    expect(enumLabel(enT(), 'entity.fieldStatuses', 'mystery_status')).toBe('mystery_status');
  });

  it('⑤ 自证（对照组）：把 zh 标签当 children 渲染，③的哨兵判据抓得到', () => {
    renderWithProviders(<span data-testid="leaky">{FIELD_STATUS_ZH.disputed}</span>);
    expect(screen.getByTestId('leaky').textContent).toContain(FIELD_STATUS_ZH.disputed);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 样本量告警 `prompt.sampleSize.warnings.<grade>` · 消费组件 `SampleSizeAlert`
// ---------------------------------------------------------------------------

describe('枚举标签 · prompt.sampleSize.warnings（Partial：sufficient 无键）', () => {
  it('① 防空跑：告警键**恰好**是 directional / insufficient，sufficient 没有键', () => {
    expect([...SAMPLE_SIZE_GRADE_VALUES]).toEqual(['sufficient', 'directional', 'insufficient']);
    expect(SAMPLE_SIZE_GRADE_VALUES).toHaveLength(3);
    expect(Object.keys(zhCN.prompt.sampleSize.warnings).sort()).toEqual([
      'directional',
      'insufficient',
    ]);
    expect(Object.keys(enUS.prompt.sampleSize.warnings).sort()).toEqual([
      'directional',
      'insufficient',
    ]);
    expect(Object.keys(zhCN.prompt.sampleSize.warnings)).not.toContain('sufficient');
    expect(Object.keys(enUS.prompt.sampleSize.warnings)).not.toContain('sufficient');
  });

  it('② zh 模板逐字等于真值表，且 60 / 30 已换成常量插值（两侧都不许写死数字）', () => {
    for (const grade of ['directional', 'insufficient'] as const) {
      expect(zhCN.prompt.sampleSize.warnings[grade], `zh-CN warnings.${grade}`).toBe(
        WARNING_ZH[grade],
      );
      const enTemplate = enUS.prompt.sampleSize.warnings[grade];
      expect(enTemplate, `en-US warnings.${grade} 非空`).not.toBe('');
      expect(CJK.test(enTemplate), `en-US warnings.${grade} 不含 CJK`).toBe(false);
    }

    expect(zhCN.prompt.sampleSize.warnings.directional).toContain('{{sufficient}}');
    expect(enUS.prompt.sampleSize.warnings.directional).toContain('{{sufficient}}');
    expect(zhCN.prompt.sampleSize.warnings.insufficient).toContain('{{minimum}}');
    expect(enUS.prompt.sampleSize.warnings.insufficient).toContain('{{minimum}}');
    // 数字必须同源（`api/constants.ts`），不许在词典里写死
    for (const template of [
      zhCN.prompt.sampleSize.warnings.directional,
      enUS.prompt.sampleSize.warnings.directional,
      zhCN.prompt.sampleSize.warnings.insufficient,
      enUS.prompt.sampleSize.warnings.insufficient,
    ]) {
      expect(template).not.toContain(String(SUFFICIENT_SAMPLE_SIZE));
      expect(template).not.toContain(String(MINIMUM_SAMPLE_SIZE));
    }
  });

  it('③ SampleSizeAlert 在 zh / en 下渲染词典告警，数字来自常量，中文哨兵不出现', () => {
    const values = {
      sufficient: String(SUFFICIENT_SAMPLE_SIZE),
      minimum: String(MINIMUM_SAMPLE_SIZE),
    };

    const enDirectional = renderSampleAlert('directional', 'en-US');
    expect(
      screen.getByText(enT()('prompt.sampleSize.warnings.directional', values)),
    ).toBeInTheDocument();
    expect(enDirectional.container.textContent).not.toContain('样本不足');
    expect(enDirectional.container.textContent).toContain(String(SUFFICIENT_SAMPLE_SIZE));
    enDirectional.unmount();

    const zhDirectional = renderSampleAlert('directional');
    expect(
      screen.getByText(zhT()('prompt.sampleSize.warnings.directional', values)),
    ).toBeInTheDocument();
    expect(zhDirectional.container.textContent).toContain('样本不足');
    zhDirectional.unmount();

    const zhInsufficient = renderSampleAlert('insufficient');
    expect(
      screen.getByText(zhT()('prompt.sampleSize.warnings.insufficient', values)),
    ).toBeInTheDocument();
    zhInsufficient.unmount();

    const enInsufficient = renderSampleAlert('insufficient', 'en-US');
    expect(enInsufficient.container.textContent).toContain(String(MINIMUM_SAMPLE_SIZE));
    expect(enInsufficient.container.textContent).not.toContain('样本不足');
  });

  it('③b `sufficient` 渲染 null（Partial 语义：没有告警键 ⇒ 什么都不说）', () => {
    const { container } = renderSampleAlert('sufficient');
    expect(container.textContent).toBe('');
    const enView = renderSampleAlert('sufficient', 'en-US');
    expect(enView.container.textContent).toBe('');
  });

  it('④ 词典查不到的 grade ⇒ `enumLabel` 回退 id 本身，绝不回退中文', () => {
    expect(enumLabel(zhT(), 'prompt.sampleSize.warnings', 'sufficient')).toBe('sufficient');
    expect(enumLabel(enT(), 'prompt.sampleSize.warnings', 'mystery_grade')).toBe('mystery_grade');
  });

  it('⑤ 自证（对照组）：把 zh 告警当 children 渲染，③的哨兵判据抓得到', () => {
    renderWithProviders(
      <span data-testid="leaky">
        {WARNING_ZH.directional.replace('{{sufficient}}', String(SUFFICIENT_SAMPLE_SIZE))}
      </span>,
    );
    expect(screen.getByTestId('leaky').textContent).toContain('样本不足');
  });
});

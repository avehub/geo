/**
 * `EntityFieldCard` 的多值字段分隔符（Task 8 fix1 · 复审 #6 / 裁定 6）。
 *
 * # 为什么这条判据必须在**组件层**
 *
 * `formatFieldValue` 原先对字符串数组固定用顿号 `、` 连接，en locale 下实体卡的
 * `aliases` / `qualifications` / `service_regions` / `cases` / `differentiators` 会渲染成
 * `A、B`——**用户可见的错误**。两道扫描都看不见它：`、` 是 U+3001，不在 `[\u4e00-\u9fa5]` 区间里。
 *
 * 修法是给 `formatFieldValue` 加一个**必填**的分隔符参数（不给默认值：默认值会让新调用点
 * 静默用回顿号），调用点传 `t('common.listSeparator')`。数据层因此仍然**不 import `t`**
 * （裁定 B-2 原样有效）。
 *
 * ⇒ 判据必须落在组件层：只测 `formatFieldValue(['A','B'], ', ')` 的话，把某个调用点改回
 * 字面量 `'、'` 也**不会红**。本文件同时钉住「函数用传入的分隔符」与「组件真的传了词典值」，
 * 后者才是变异自证（fix1 §D-9）打得红的那一层。
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '../test/render';
import EntityFieldCard from './EntityFieldCard';
import { ENTITY_FIELDS, formatFieldValue } from './entity-fields';

const noop = () => undefined;

/** 从数据表里取描述符（而不是手写字面量）：这样 `labelKey` 漂了本文件也会跟着红。 */
function descriptorOf(path: string) {
  const found = ENTITY_FIELDS.find((field) => field.path === path);
  if (found === undefined) throw new Error(`unknown entity field path: ${path}`);
  return found;
}

function renderCard(value: unknown, locale?: 'zh-CN' | 'en-US', path = 'aliases') {
  return renderWithProviders(
    <EntityFieldCard
      descriptor={descriptorOf(path)}
      value={value}
      status="official"
      onSave={noop}
    />,
    { locale },
  );
}

describe('EntityFieldCard · 多值字段的分隔符跟语言走（复审 #6）', () => {
  it('zh-CN 下用顿号连接', () => {
    const { container } = renderCard(['宏宇', 'HongYu']);

    expect(container.textContent).toContain('宏宇、HongYu');
  });

  it('en-US 下用半角逗号+空格连接，且一个顿号都不剩', () => {
    const { container } = renderCard(['宏宇', 'HongYu'], 'en-US');

    // 半角逗号**加空格**：`common.listSeparator` 的 en 值是 `', '`，不是 `','`
    expect(container.textContent).toContain('宏宇, HongYu');
    expect(container.textContent).not.toContain('、');
  });

  it('en-US 下三个以上元素每处都插分隔符（不是只连接前两个）', () => {
    const { container } = renderCard(['a', 'b', 'c'], 'en-US');

    expect(container.textContent).toContain('a, b, c');
  });

  it('字段标题也随语言切换（顺带钉住 labelKey 的消费方）', () => {
    renderCard(['宏宇'], 'en-US');

    expect(screen.getByText('Brand aliases')).toBeInTheDocument();
  });
});

describe('formatFieldValue · 分隔符是**必填**参数，函数本身不再有内置顿号', () => {
  it('传什么就用什么', () => {
    expect(formatFieldValue(['A', 'B'], ', ')).toBe('A, B');
    expect(formatFieldValue(['A', 'B'], '、')).toBe('A、B');
    expect(formatFieldValue(['A', 'B', 'C'], ' | ')).toBe('A | B | C');
  });

  it('单元素不产生分隔符；非字符串数组仍走 JSON', () => {
    expect(formatFieldValue(['A'], ', ')).toBe('A');
    expect(formatFieldValue([{ name: 'x' }], ', ')).toContain('"name"');
  });

  it('非数组分支不受分隔符影响（空值仍是语言中立的长破折号）', () => {
    expect(formatFieldValue(null, ', ')).toBe('—');
    expect(formatFieldValue(undefined, ', ')).toBe('—');
    expect(formatFieldValue('  ', ', ')).toBe('—');
    expect(formatFieldValue('宏宇', ', ')).toBe('宏宇');
    expect(formatFieldValue(2026, ', ')).toBe('2026');
    expect(formatFieldValue(true, ', ')).toBe('true');
    expect(formatFieldValue([], ', ')).toBe('—');
  });
});

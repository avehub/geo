/**
 * `RevisionTimeline` 的新旧值分隔符（Task 8 fix1 · 复审 #6 / 裁定 6）。
 *
 * 这个组件是 `formatFieldValue` 的**第二个**调用点，而且一次调用两处（`old_value` 与
 * `new_value`）。只测 `EntityFieldCard` 的话，把这里的调用点改回字面量 `'、'` 不会红，
 * 所以修订留痕在 en locale 下的分隔符单独钉一份。
 *
 * 🔴 DR-119 之后本组件被**两个页面共用**（实体卡 + 知识库编辑侧滑），所以文件末尾那组
 * 「同一组件渲染两种留痕」是泛化的回归靶心：字段标签由调用方传进来的 resolver 决定，
 * 传错 resolver 必须**露出原始 field_path**（不是静默换成另一套标签）。
 */
import { describe, expect, it } from 'vitest';

import type { EntityCardRevision, KbEntryRevision } from '../api/types';
import { renderWithProviders } from '../test/render';
import { entityFieldLabelKey } from './entity-fields';
import { kbFieldLabelKey } from './kb-fields';
import RevisionTimeline from './RevisionTimeline';

function revision(overrides: Partial<EntityCardRevision> = {}): EntityCardRevision {
  return {
    id: 'rev-1',
    project_id: 'proj-1',
    field_path: 'aliases',
    old_value: ['宏宇'],
    new_value: ['宏宇', 'HongYu'],
    status: 'official',
    note: null,
    edited_at: '2026-09-18T08:30:00Z',
    ...overrides,
  };
}

describe('RevisionTimeline · 新旧值的分隔符跟语言走（复审 #6）', () => {
  it('zh-CN 下新值用顿号连接', () => {
    const { container } = renderWithProviders(
      <RevisionTimeline revisions={[revision()]} labelKeyOf={entityFieldLabelKey} />,
    );

    expect(container.textContent).toContain('宏宇、HongYu');
  });

  it('en-US 下新值用半角逗号+空格连接，且一个顿号都不剩', () => {
    const { container } = renderWithProviders(
      <RevisionTimeline revisions={[revision()]} labelKeyOf={entityFieldLabelKey} />,
      { locale: 'en-US' },
    );

    expect(container.textContent).toContain('宏宇, HongYu');
    expect(container.textContent).not.toContain('、');
  });

  it('en-US 下**旧值**同样走词典分隔符（两处调用点都钉住）', () => {
    const { container } = renderWithProviders(
      <RevisionTimeline
        revisions={[revision({ old_value: ['old-a', 'old-b'], new_value: ['new-a', 'new-b'] })]}
        labelKeyOf={entityFieldLabelKey}
      />,
      { locale: 'en-US' },
    );

    expect(container.textContent).toContain('old-a, old-b');
    expect(container.textContent).toContain('new-a, new-b');
    expect(container.textContent).not.toContain('、');
  });

  it('字段标签走词典（en 侧不复述中文）', () => {
    const { container } = renderWithProviders(
      <RevisionTimeline revisions={[revision()]} labelKeyOf={entityFieldLabelKey} />,
      { locale: 'en-US' },
    );

    expect(container.textContent).toContain('Brand aliases');
  });
});

/**
 * DR-119 · 泛化回归：知识库的 `KbEntryRevision` 与实体卡的 `EntityCardRevision` 六键同构
 * （`field_path` / `old_value` / `new_value` / `status` / `note` / `edited_at`），
 * 所以**同一个组件**吃两种留痕，差别只在调用方传哪张字段标签表。
 *
 * 三条判据各自挡一种劣化：
 * ① 传 `kbFieldLabelKey` ⇒ 标签查 `kb.fields.*`，界面上不露 `body_markdown` 这种机器记号；
 * ② 传错（`entityFieldLabelKey`）⇒ **回落原始 field_path**（组件不许自带第二套标签表兜底）；
 * ③ 新旧值 / 状态标记 / 时间戳的渲染口径两侧一致（共用 `formatFieldValue` + `FieldStatusTag`）。
 */
describe('RevisionTimeline · 同一组件渲染两种留痕（DR-119）', () => {
  const kbRevision: KbEntryRevision = {
    id: 'kb-rev-1',
    entry_id: 'demo-kb-101',
    project_id: 'proj-1',
    field_path: 'body_markdown',
    old_value: '覆盖江苏、浙江两省',
    new_value: '覆盖江苏、浙江、安徽、山东四省',
    status: 'disputed',
    note: null,
    edited_at: '2026-09-19T22:10:00Z',
  };

  it('知识库留痕：zh 侧标签查 kb.fields.*，新旧值并排、disputed 出「存疑」', () => {
    const { container } = renderWithProviders(
      <RevisionTimeline revisions={[kbRevision]} labelKeyOf={kbFieldLabelKey} />,
    );

    expect(container.textContent).toContain('正文');
    expect(container.textContent).not.toContain('body_markdown');
    expect(container.textContent).toContain('存疑');
    expect(container.textContent).toContain('覆盖江苏、浙江两省');
    expect(container.textContent).toContain('→');
    // 🔴 只钉**格式**不钉钟点：`dayjs` 按运行机器的时区渲染（`2026-09-19T22:10:00Z` 在
    // America/New_York 是 18:10、在 UTC+8 是次日 06:10）⇒ 写死钟点会让门禁只在某一个时区绿。
    expect(container.textContent).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it('en 侧同一份 KB 留痕走英文标签（标签表是数据、语言由词典决定）', () => {
    const { container } = renderWithProviders(
      <RevisionTimeline revisions={[kbRevision]} labelKeyOf={kbFieldLabelKey} />,
      { locale: 'en-US' },
    );

    expect(container.textContent).toContain('Body');
    expect(container.textContent).toContain('Conflicting');
    expect(container.textContent).not.toContain('正文');
  });

  it('传错 resolver ⇒ 回落原始 field_path（组件不自带第二套标签表）', () => {
    const { container } = renderWithProviders(
      <RevisionTimeline revisions={[kbRevision]} labelKeyOf={entityFieldLabelKey} />,
    );

    expect(container.textContent).toContain('body_markdown');
    expect(container.textContent).not.toContain('正文');
  });

  it('实体卡那侧不受泛化影响：同一个组件 + entity resolver 仍出实体卡字段标签', () => {
    const { container } = renderWithProviders(
      <RevisionTimeline revisions={[revision()]} labelKeyOf={entityFieldLabelKey} />,
    );

    expect(container.textContent).toContain('品牌别名');
    expect(container.textContent).not.toContain('aliases');
  });
});

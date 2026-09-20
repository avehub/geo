/**
 * `RevisionTimeline` 的新旧值分隔符（Task 8 fix1 · 复审 #6 / 裁定 6）。
 *
 * 这个组件是 `formatFieldValue` 的**第二个**调用点，而且一次调用两处（`old_value` 与
 * `new_value`）。只测 `EntityFieldCard` 的话，把这里的调用点改回字面量 `'、'` 不会红，
 * 所以修订留痕在 en locale 下的分隔符单独钉一份。
 */
import { describe, expect, it } from 'vitest';

import type { EntityCardRevision } from '../api/types';
import { renderWithProviders } from '../test/render';
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
    const { container } = renderWithProviders(<RevisionTimeline revisions={[revision()]} />);

    expect(container.textContent).toContain('宏宇、HongYu');
  });

  it('en-US 下新值用半角逗号+空格连接，且一个顿号都不剩', () => {
    const { container } = renderWithProviders(<RevisionTimeline revisions={[revision()]} />, {
      locale: 'en-US',
    });

    expect(container.textContent).toContain('宏宇, HongYu');
    expect(container.textContent).not.toContain('、');
  });

  it('en-US 下**旧值**同样走词典分隔符（两处调用点都钉住）', () => {
    const { container } = renderWithProviders(
      <RevisionTimeline
        revisions={[revision({ old_value: ['old-a', 'old-b'], new_value: ['new-a', 'new-b'] })]}
      />,
      { locale: 'en-US' },
    );

    expect(container.textContent).toContain('old-a, old-b');
    expect(container.textContent).toContain('new-a, new-b');
    expect(container.textContent).not.toContain('、');
  });

  it('字段标签走词典（en 侧不复述中文）', () => {
    const { container } = renderWithProviders(<RevisionTimeline revisions={[revision()]} />, {
      locale: 'en-US',
    });

    expect(container.textContent).toContain('Brand aliases');
  });
});

/**
 * `CsvToolbar` 的行错误渲染（Plan A Task 8 · 裁定 B-5 / G-2，复审 F-3a）。
 *
 * 这里钉的是**组件层**的三件事，与 `src/api/errors.test.ts` 里那组函数级断言互补：
 * ① 组件真的把行错误交给 `describeCsvRowError`，而不是自己拼一句
 * （断言渲染结果与该函数的返回值逐字相等）；② 命中的广告法红线词不会经导入弹窗上屏；
 * ③「第 N 行」这个外壳走词典，en 下语序正确。
 *
 * 为什么必须有这一层：函数级断言绿了也不能证明组件在用它——`describeCsvRowError`
 * 完全可能是死代码，而组件里躺着一份自己写的 `第 N 行：{reason}`。
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { describeCsvRowError } from '../api/errors';
import { i18n } from '../i18n';
import { mockInvoke } from '../test/invoke-mock';
import { renderWithProviders } from '../test/render';
import CsvToolbar from './CsvToolbar';

const RED_LINE_TERM = '国家级';

function renderToolbar(locale?: 'zh-CN' | 'en-US') {
  return renderWithProviders(
    <CsvToolbar setId="set-1" filenamePrefix="hongyu" onChanged={() => undefined} />,
    { locale },
  );
}

/** 打开导入弹窗、粘一段内容、点确认，返回弹窗里的行错误文本。 */
async function importWithErrors(errors: unknown[]): Promise<string[]> {
  mockInvoke.stubAlways('prompt_set_import_csv', () => ({ items: [], errors }));
  const user = userEvent.setup();

  renderToolbar();
  await user.click(screen.getByRole('button', { name: /导入 CSV/ }));

  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox'), {
    target: { value: 'text,intent,weight,group_name,tags,source,repeat_count\n坏行' },
  });
  await user.click(screen.getByRole('button', { name: /确认导入/ }));

  await waitFor(() => expect(mockInvoke.callsOf('prompt_set_import_csv')).toHaveLength(1));
  const list = await screen.findByRole('list');
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '');
}

describe('CsvToolbar · 整批失败时 detail 里的逐行原因', () => {
  it('prompt_set/empty_import 的 detail 逐行经 describeCsvRowError 上屏', async () => {
    const rowError = { row: 2, reason: 'required', params: {} };
    mockInvoke.stubAlways(
      'prompt_set_import_csv',
      {
        code: 'prompt_set/empty_import',
        params: {},
        message: 'prompt_set/empty_import',
        detail: [rowError],
      },
      'reject',
    );
    const user = userEvent.setup();

    renderToolbar();
    await user.click(screen.getByRole('button', { name: /导入 CSV/ }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'text,intent,weight,group_name,tags,source,repeat_count\n坏行' },
    });
    await user.click(screen.getByRole('button', { name: /确认导入/ }));

    // 主文案仍是稳定 code 的词典句；逐行原因不能丢。
    // antd 的 confirm modal 会把 title 渲染成两处（.ant-modal-title 与 .ant-modal-confirm-title）。
    expect(
      (await screen.findAllByText('CSV 里没有可导入的有效条目，题库未改动')).length,
    ).toBeGreaterThan(0);
    expect(
      await screen.findByText(describeCsvRowError(rowError, i18n.getFixedT('zh-CN'))),
    ).toBeInTheDocument();
  });
});

describe('CsvToolbar · 行错误经词典渲染', () => {
  it('not_allowed 的命中词不上屏，且整行与 describeCsvRowError 的输出逐字相等', async () => {
    const error = {
      row: 3,
      reason: 'not_allowed',
      // 形状照 `csv_io.rs` 的合规那一支：`RowFailure::from_geo` 原样透传 compliance 的 params，
      // 因此除 `value` 外还带 `field` 与 `reason`（简报 A-5）。
      params: { value: RED_LINE_TERM, field: 'content', reason: 'not_allowed' },
    };

    const lines = await importWithErrors([error]);

    expect(lines).toEqual([describeCsvRowError(error, i18n.getFixedT('zh-CN'))]);
    expect(lines[0]).toBe('第 3 行：含广告法禁用表述，请改写后再提交');
    expect(lines.join('\n')).not.toContain(RED_LINE_TERM);
  });

  it('too_long 的 limit 照常显示（不是一刀切藏掉所有 value）', async () => {
    const lines = await importWithErrors([{ row: 7, reason: 'too_long', params: { limit: '120' } }]);

    expect(lines[0]).toContain('120');
    expect(lines[0]).toBe('第 7 行：prompt 文本超过 120 字上限');
  });

  it('多行错误逐行渲染，摘要标题也走词典', async () => {
    const lines = await importWithErrors([
      { row: 2, reason: 'required', params: {} },
      { row: 4, reason: 'invalid_format', params: { value: 'not_an_intent' } },
    ]);

    expect(lines).toEqual([
      '第 2 行：必填的 prompt 文本为空',
      '第 4 行：这一格的内容格式不正确（not_an_intent）',
    ]);
    // 用 findAllByText 而不是 findByText：antd 的确认弹窗把标题渲染**多份**
    // （一份 `.ant-modal-title` 供 `aria-labelledby` 指、一份可见的 `.ant-modal-confirm-title`），
    // 实测 DOM dump 里各节点文本逐字相同。
    //
    // fix1 复审 #2：这里的**份数是 antd 的内部实现**，不该进断言。上一版写成
    // `toEqual([summary, summary])`，注释却自称「不把 antd 的内部渲染份数写进断言」——
    // 自相矛盾，且 antd 升级改渲染份数时本用例会为无关原因红。改成「至少一份，
    // 且**每一份**都全等于这句」：与份数无关，强度不降（仍是全字符串精确相等，
    // 不是 toContain / toBeTruthy），与本文件下面 en-US 那条用例的写法一致。
    const summary = '导入 0 条，失败 2 行';
    const titles = await screen.findAllByText(summary);
    expect(titles.length).toBeGreaterThan(0);
    for (const node of titles) expect(node.textContent).toBe(summary);
  });

  it('en-US 下外壳语序正确（证明「第 N 行」不是组件里拼出来的）', async () => {
    mockInvoke.stubAlways('prompt_set_import_csv', () => ({
      items: [],
      errors: [{ row: 3, reason: 'required', params: {} }],
    }));
    const user = userEvent.setup();

    renderToolbar('en-US');
    await user.click(screen.getByRole('button', { name: /Import CSV/ }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'text,intent' } });
    await user.click(screen.getByRole('button', { name: /Confirm import/ }));

    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')[0].textContent).toBe(
      'Row 3: the required prompt text is empty',
    );
    const titles = await screen.findAllByText('Imported 0 items; 1 rows failed');
    expect(titles.length).toBeGreaterThan(0);
    for (const node of titles) expect(node.textContent).toBe('Imported 0 items; 1 rows failed');
  });

  it('导出弹窗的行数提示走词典，参数插值不留占位符', async () => {
    mockInvoke.stubAlways('prompt_set_export_csv', () => 'text,intent\na,b\nc,d\n');
    const user = userEvent.setup();

    renderToolbar();
    await user.click(screen.getByRole('button', { name: /导出 CSV/ }));

    expect(await screen.findByText(/共 3 行（含表头 7 列）/)).toBeInTheDocument();
    expect(screen.queryByText(/{{/)).not.toBeInTheDocument();
  });
});

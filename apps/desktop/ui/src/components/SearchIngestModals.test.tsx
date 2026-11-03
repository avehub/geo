/**
 * 两个导入弹窗的默认区间。
 *
 * demo 的 `search_board.as_of` 是固定种子日期；默认区间若取系统今天，会把导入数据写到
 * “未来”，陈旧判定与汇总窗口都失真。这里钉住：默认区间从页面给的 `asOf` 推导。
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SearchImportModal from './SearchImportModal';
import SearchPasteModal from './SearchPasteModal';
import type { SearchMetricImportResult } from '../api/types';
import { renderWithProviders } from '../test/render';

const AS_OF = '2026-09-30';

function textboxValues(): string[] {
  return screen
    .getAllByRole('textbox')
    .map((element) => (element as HTMLInputElement).value)
    .filter((value) => value !== '');
}

describe('站长数据导入弹窗 · 默认区间', () => {
  it('导入 CSV / XLSX 弹窗按 asOf 推导区间，不用系统今天', () => {
    renderWithProviders(
      <SearchImportModal
        asOf={AS_OF}
        sources={['baidu_ziyuan_ai']}
        defaultKind="baidu_ziyuan_ai"
        importing={false}
        result={null}
        onCancel={() => {}}
        onSubmit={() => {}}
        onTemplate={() => {}}
      />,
    );

    expect(textboxValues()).toEqual(expect.arrayContaining(['2026-09-03', '2026-09-29']));
  });

  it('粘贴弹窗提交的 periodStart / periodEnd 也按 asOf 推导', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    renderWithProviders(
      <SearchPasteModal
        asOf={AS_OF}
        sources={['baidu_ziyuan_ai']}
        defaultKind="baidu_ziyuan_ai"
        importing={false}
        result={null}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: /粘贴/ }), '关键词\tAI引用量\n工业除尘器\t120');
    await user.click(screen.getByRole('button', { name: /解析并导入/ }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ periodStart: '2026-09-03', periodEnd: '2026-09-29' }),
      ),
    );
  });
});

describe('站长数据导入弹窗 · 未知 reason', () => {
  const unknownResult: SearchMetricImportResult = {
    metrics: [],
    ai_overviews: [],
    native_extras: [],
    errors: [{ row: 7, reason: 'future_reason' }],
    warnings: [],
    data_through: null,
  };

  it('本地化说明在前，机器记号只作为可排查的附加信息', () => {
    renderWithProviders(
      <SearchImportModal
        asOf={AS_OF}
        sources={['baidu_ziyuan_ai']}
        defaultKind="baidu_ziyuan_ai"
        importing={false}
        result={unknownResult}
        onCancel={() => {}}
        onSubmit={() => {}}
        onTemplate={() => {}}
      />,
    );

    expect(screen.getByText(/无法识别的导入问题/)).toBeInTheDocument();
    expect(screen.getByText(/future_reason/)).toBeInTheDocument();
  });
});

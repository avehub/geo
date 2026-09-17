import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PromptSetPage from './PromptSetPage';
import { mockInvoke } from '../test/invoke-mock';
import { renderAtRoute } from '../test/render';
import { PROJECT_ID, SET_ID, makePromptItem, makePromptSet } from '../test/fixtures';
import type { PromptItem, SampleSizeGrade } from '../api/types';

const ROUTE = `/projects/${PROJECT_ID}/prompts`;

const CSV = [
  'text,intent,weight,group_name,tags,source,repeat_count',
  '宏宇泵业和南方泵业哪个好？,brand_comparison,5,品牌对比,,template,1',
].join('\n');

/** 混合意图的题库：60 条品类认知 + 2 条品牌对比，共 62 条（sufficient）。 */
function mixedItems(): PromptItem[] {
  const awareness = Array.from({ length: 60 }, (_, i) => makePromptItem(i));
  const comparison = [
    makePromptItem(60, {
      id: 'item-cmp-1',
      text: '宏宇泵业和南方泵业哪个更靠谱？',
      intent: 'brand_comparison',
      group_name: '品牌对比',
      weight: 5,
      competitor_ids: ['comp-1'],
    }),
    makePromptItem(61, {
      id: 'item-cmp-2',
      text: '凯泉泵业与宏宇泵业的离心泵怎么选？',
      intent: 'brand_comparison',
      group_name: '品牌对比',
      weight: 4,
      competitor_ids: ['comp-2'],
    }),
  ];
  return [...awareness, ...comparison];
}

function stub(grade: SampleSizeGrade = 'sufficient') {
  const items = grade === 'sufficient' ? mixedItems() : mixedItems().slice(0, 45);
  const set = makePromptSet({ items, sample_size_grade: grade });
  mockInvoke.stubAlways('prompt_set_list', () => [
    {
      id: SET_ID,
      project_id: PROJECT_ID,
      version: set.version,
      label: set.label,
      item_count: items.length,
      content_hash: set.content_hash,
      sample_size_grade: grade,
      created_at: set.created_at,
      notes: set.notes,
    },
  ]);
  mockInvoke.stubAlways('prompt_set_get', () => set);
  mockInvoke.stubAlways('prompt_set_export_csv', () => CSV);
  mockInvoke.stubAlways('prompt_item_update', (args) => args.item);
  mockInvoke.stubAlways('prompt_set_generate', () => set);
  mockInvoke.stubAlways('prompt_set_dedupe', () => ({ kept: items, removed: [], duplicate_pairs: 0 }));
  mockInvoke.stubAlways('project_get', () => ({
    project: { id: PROJECT_ID, industry: 'b2b_manufacturing' },
    entity_card: null,
    competitors: [],
    assets: [],
    prompt_set_count: 1,
  }));
  return set;
}

function renderPage() {
  return renderAtRoute(<PromptSetPage />, '/projects/:id/prompts', ROUTE);
}

describe('PromptSetPage', () => {
  beforeEach(() => mockInvoke.reset());

  it('grade=directional 时渲染「样本不足，仅供方向性参考」', async () => {
    stub('directional');
    renderPage();

    expect(
      await screen.findByText(/样本不足，仅供方向性参考：当前 prompt 数低于 60 条/),
    ).toBeInTheDocument();
  });

  it('grade=sufficient 时不渲染样本不足提示', async () => {
    stub('sufficient');
    renderPage();

    expect(await screen.findByText('第 1 版题库')).toBeInTheDocument();
    expect(screen.queryByText(/仅供方向性参考/)).not.toBeInTheDocument();
  });

  it('按意图筛选后只剩品牌对比条目', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');

    // antd 按钮式 Radio 的真实 input 被 pointer-events:none 遮住，用 fireEvent 触发
    fireEvent.click(screen.getByRole('radio', { name: '品牌对比' }));

    const table = await screen.findByRole('table');
    await waitFor(() => {
      expect(within(table).getAllByRole('row')).toHaveLength(3); // 表头 + 2 条
    });
    expect(within(table).getByText('宏宇泵业和南方泵业哪个更靠谱？')).toBeInTheDocument();
  });

  it('调整 weight 调用 prompt_item_update', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');
    // antd 按钮式 Radio 的真实 input 被 pointer-events:none 遮住，用 fireEvent 触发
    fireEvent.click(screen.getByRole('radio', { name: '品牌对比' }));

    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));

    // 第一条品牌对比 prompt 原权重为 5，改成 2 才会触发提交
    const spinbutton = within(table).getAllByRole('spinbutton')[0];
    await user.clear(spinbutton);
    await user.type(spinbutton, '2');
    await user.tab();

    await waitFor(() => expect(mockInvoke.callsOf('prompt_item_update')).toHaveLength(1));
    const sent = mockInvoke.lastArgsOf('prompt_item_update')!.item as PromptItem;
    expect(sent.weight).toBe(2);
    expect(sent.id).toBe('item-cmp-1');
  });

  it('导出 CSV 拿到含表头的字符串', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');

    await user.click(screen.getByRole('button', { name: /导出 CSV/ }));

    await waitFor(() => expect(mockInvoke.callsOf('prompt_set_export_csv')).toHaveLength(1));
    expect(await screen.findByDisplayValue(/text,intent,weight/)).toBeInTheDocument();
    expect(screen.getByText(/共 2 行/)).toBeInTheDocument();
  });

  it('点击生成题库展示进度并在完成后刷新条数', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');

    await user.click(screen.getByRole('button', { name: /生成题库/ }));

    await waitFor(() => expect(mockInvoke.callsOf('prompt_set_generate')).toHaveLength(1));
    const options = mockInvoke.lastArgsOf('prompt_set_generate')!.options as Record<string, unknown>;
    expect(options.target_count).toBe(80);
    expect(options.industry).toBe('b2b_manufacturing');
    expect(await screen.findByText(/hash-abc123/)).toBeInTheDocument();
  });

  it('去重后展示重复对数量', async () => {
    stub('sufficient');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('第 1 版题库');

    await user.click(screen.getByRole('button', { name: /去重检查/ }));

    await waitFor(() => expect(mockInvoke.callsOf('prompt_set_dedupe')).toHaveLength(1));
    expect(await screen.findByText(/重复对：0/)).toBeInTheDocument();
  });
});

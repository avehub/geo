/**
 * 关键词表格的站长数据叠加列。
 *
 * 靶心：只有 AI 面数据时，web 面的「曝光 / 点击」必须显示 `—`，
 * 不能用 0 冒充「这个词零曝光」（DR-94 / DR-101）。
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import KeywordTable from './KeywordTable';
import type { KeywordRowWithSearch } from '../api/library-compose';
import type { KeywordSearchAggregate } from '../api/search-compose';
import { renderWithProviders } from '../test/render';

const aggregate: KeywordSearchAggregate = {
  impressions: null,
  clicks: null,
  ctr: null,
  citations: 62,
  ai_clicks: 0,
  ai_ctr: 0,
  source_count: 1,
  source_kinds: ['baidu_ziyuan_ai'],
  window: { start: '2026-09-01', end: '2026-09-27' },
  completeness: 'partial',
  data_through: '2026-09-27',
  stale: false,
  label_key: 'webmasterData.keywordOverlay.withCompleteness',
};

const row: KeywordRowWithSearch = {
  id: 'kw-1',
  project_id: 'project-1',
  text: '除尘器滤筒更换周期',
  kind: 'core',
  intent: 'category_awareness',
  monthly_volume: 120,
  difficulty: 30,
  priority: 2,
  status: 'approved',
  note: '来自 AI 面',
  source: 'manual',
  position: 0,
  created_at: '2026-09-11T02:10:00Z',
  updated_at: '2026-09-16T09:05:00Z',
  searchAggregate: aggregate,
};

describe('KeywordTable · 站长数据叠加列', () => {
  it('只有 AI 面数据时 web 曝光 / 点击显示 —，不显示 0', () => {
    renderWithProviders(
      <KeywordTable
        rows={[row]}
        selectedRowKeys={[]}
        onSelectionChange={() => {}}
        onStatusChange={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText('曝光合计 — · 点击合计 —')).toBeInTheDocument();
    expect(screen.queryByText('曝光合计 0 · 点击合计 0')).not.toBeInTheDocument();
  });

  it('有 web 面数据时曝光 / 点击与全站其他计数一样走千分位', () => {
    renderWithProviders(
      <KeywordTable
        rows={[{ ...row, searchAggregate: { ...aggregate, impressions: 5780, clicks: 200 } }]}
        selectedRowKeys={[]}
        onSelectionChange={() => {}}
        onStatusChange={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText('曝光合计 5,780 · 点击合计 200')).toBeInTheDocument();
  });
});

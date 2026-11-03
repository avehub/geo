/**
 * 首页「站外数据对账」卡的锚点与陈旧文案。
 *
 * 靶心：`asOf` 必须与站长数据页同用 `board.as_of`；陈旧提示只能说“数据截至某日”，
 * 不能把“距今天数”冒充成“导入时间”。
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OverviewStationCard from './OverviewStationCard';
import type { SearchBoardResult, SearchQueryMetric } from '../api/types';
import { renderWithProviders } from '../test/render';

const metric: SearchQueryMetric = {
  id: 'm-1',
  project_id: 'project-1',
  source_kind: 'toutiao',
  surface: 'web_search',
  query: '工业除尘器',
  page_url: null,
  impressions: 100,
  clicks: 5,
  ctr: 0.05,
  citations: null,
  ai_clicks: null,
  period_start: '2026-08-01',
  period_end: '2026-08-20',
  data_through: '2026-08-20',
  imported_at: '2026-09-02T03:10:00Z',
  completeness: 'partial',
  window_source: 'platform',
  mapping_version: '2026-10-12.1',
};

const board: SearchBoardResult = {
  as_of: '2026-09-30',
  sources: [],
  metrics: [metric],
  ai_overviews: [],
  native_extras: [],
  opportunities: [],
  self_index_summary: null,
  self_index_snapshots: [],
  traffic_split: [],
};

describe('OverviewStationCard · 锚点与陈旧说明', () => {
  it('“最新数据”用 board.as_of，不用最大 data_through', () => {
    renderWithProviders(
      <OverviewStationCard board={board} loading={false} error={null} onOpen={() => {}} />,
    );

    expect(screen.getByText('最新数据 2026-09-30')).toBeInTheDocument();
  });

  it('陈旧 tooltip 只说数据截至日，不把数据年龄写成导入时间', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OverviewStationCard board={board} loading={false} error={null} onOpen={() => {}} />,
    );

    await user.hover(screen.getByText('数据陈旧'));
    await waitFor(() => {
      const tooltip = document.querySelector('.ant-tooltip-inner');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toContain('2026-08-20');
      expect(tooltip?.textContent).not.toContain('导入');
    });
  });
});

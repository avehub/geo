import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import ProjectListPage from './ProjectListPage';
import { mockInvoke } from '../test/invoke-mock';
import { renderWithProviders } from '../test/render';
import { makeProject } from '../test/fixtures';

const hongyu = makeProject({ id: 'p-hongyu', name: '宏宇泵业 GEO', brand_name: '宏宇泵业' });
const valve = makeProject({ id: 'p-valve', name: '南方阀门项目', brand_name: '南方阀门' });
const archived = makeProject({
  id: 'p-archived',
  name: '旧水泵项目',
  brand_name: '宏宇水泵',
  status: 'archived',
  archived_at: '2026-09-01T00:00:00Z',
});

const ALL = [hongyu, valve, archived];

function stubList() {
  mockInvoke.stubAlways('project_list', (args) => {
    const filter = (args.filter ?? {}) as { query?: string | null; include_archived?: boolean };
    let rows = ALL;
    if (!filter.include_archived) rows = rows.filter((row) => row.status === 'active');
    if (filter.query) {
      const q = filter.query;
      rows = rows.filter((row) => row.name.includes(q) || row.brand_name.includes(q));
    }
    return rows;
  });
  mockInvoke.stubAlways('project_archive', () => hongyu);
  mockInvoke.stubAlways('project_delete', () => null);
}

describe('ProjectListPage', () => {
  it('默认只展示未归档项目', async () => {
    stubList();
    renderWithProviders(<ProjectListPage />);

    expect(await screen.findByText('宏宇泵业 GEO')).toBeInTheDocument();
    expect(screen.getByText('南方阀门项目')).toBeInTheDocument();
    expect(screen.queryByText('旧水泵项目')).not.toBeInTheDocument();
    expect(mockInvoke.lastArgsOf('project_list')).toMatchObject({
      filter: { include_archived: false },
    });
  });

  it('搜索「宏宇」触发带 query 的 project_list 并过滤结果', async () => {
    stubList();
    const user = userEvent.setup();
    renderWithProviders(<ProjectListPage />);
    await screen.findByText('宏宇泵业 GEO');

    await user.type(screen.getByPlaceholderText('搜索项目名或品牌名'), '宏宇{enter}');

    await waitFor(() => {
      expect(screen.queryByText('南方阀门项目')).not.toBeInTheDocument();
    });
    expect(screen.getByText('宏宇泵业 GEO')).toBeInTheDocument();
    expect(
      mockInvoke.callsOf('project_list').some((call) =>
        JSON.stringify(call.args).includes('"query":"宏宇"'),
      ),
    ).toBe(true);
  });

  it('勾选「显示已归档」后归档项目出现并标记已归档', async () => {
    stubList();
    const user = userEvent.setup();
    renderWithProviders(<ProjectListPage />);
    await screen.findByText('宏宇泵业 GEO');

    await user.click(screen.getByRole('checkbox', { name: /显示已归档/ }));

    expect(await screen.findByText('旧水泵项目')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('已归档')).toBeInTheDocument();
    expect(mockInvoke.lastArgsOf('project_list')).toMatchObject({
      filter: { include_archived: true },
    });
  });

  it('后端报错时展示中文原因', async () => {
    mockInvoke.stubAlways(
      'project_list',
      { code: 'store/sqlx', message: '数据库读写失败', detail: null },
      'reject',
    );
    renderWithProviders(<ProjectListPage />);

    expect(await screen.findByText(/数据库读写失败/)).toBeInTheDocument();
  });

  it('归档操作调用 project_archive 并刷新列表', async () => {
    stubList();
    const user = userEvent.setup();
    renderWithProviders(<ProjectListPage />);
    await screen.findByText('宏宇泵业 GEO');

    const row = screen.getByText('宏宇泵业 GEO').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /归\s*档/ }));

    await waitFor(() => {
      expect(mockInvoke.callsOf('project_archive')).toHaveLength(1);
    });
    expect(mockInvoke.lastArgsOf('project_archive')).toEqual({ id: 'p-hongyu', archived: true });
  });

  it('新建项目按钮存在且可用', async () => {
    stubList();
    renderWithProviders(<ProjectListPage />);
    await screen.findByText('宏宇泵业 GEO');
    expect(screen.getByRole('button', { name: /新建项目/ })).toBeEnabled();
  });
});

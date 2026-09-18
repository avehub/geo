import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import ProjectListPage from './ProjectListPage';
import { mockInvoke } from '../test/invoke-mock';
import { renderWithProviders } from '../test/render';
import { makeProject } from '../test/fixtures';
import type { Project } from '../api/types';

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

/**
 * user-event 只填 `key`，不填 `keyCode`/`which`，而 antd 标签选择器（rc-select）
 * 的 tags 模式靠 `which === 13` 判定「回车提交新标签」。真实浏览器两者都有，
 * 这里补一份等价事件，避免测试因 jsdom 差异失真。
 */
function pressEnter(element: HTMLElement) {
  fireEvent.keyDown(element, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
}

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

  it('行内「导出」菜单可分别导出竞品 CSV 与资产 CSV', async () => {
    stubList();
    mockInvoke.stubAlways(
      'project_export_competitors_csv',
      () => 'name,aliases,website,note,position\n南方泵业,,,,0',
    );
    mockInvoke.stubAlways(
      'project_export_assets_csv',
      () => 'kind,url,title,note\nowned_page,https://www.hongyu-pump.example,,',
    );
    mockInvoke.stubAlways('export_write_file', () => '/tmp/宏宇泵业-竞品.csv');
    const user = userEvent.setup();
    renderWithProviders(<ProjectListPage />);
    await screen.findByText('宏宇泵业 GEO');

    const row = screen.getByText('宏宇泵业 GEO').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /导\s*出/ }));
    await user.click(await screen.findByText('竞品 CSV'));

    await waitFor(() =>
      expect(mockInvoke.callsOf('project_export_competitors_csv')).toHaveLength(1),
    );
    expect(mockInvoke.lastArgsOf('project_export_competitors_csv')).toEqual({ id: 'p-hongyu' });
    // WKWebView 不支持 blob 下载：必须走系统对话框命令，且 CSV 带 BOM
    expect(mockInvoke.callsOf('export_write_file').length).toBeGreaterThan(0);
    expect(mockInvoke.lastArgsOf('export_write_file')).toEqual({
      default_name: '宏宇泵业-竞品.csv',
      content: 'name,aliases,website,note,position\n南方泵业,,,,0',
      with_bom: true,
    });
    expect(await screen.findByText('竞品 CSV 已导出')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: /导\s*出/ }));
    await user.click(await screen.findByText('资产 CSV'));

    await waitFor(() => expect(mockInvoke.callsOf('project_export_assets_csv')).toHaveLength(1));
    expect(await screen.findByText('资产 CSV 已导出')).toBeInTheDocument();
  });

  it('行内「导出」菜单的项目 JSON 只导出该行项目', async () => {
    stubList();
    mockInvoke.stubAlways('project_export', () => ({ project: valve }));
    mockInvoke.stubAlways('export_write_file', () => '/tmp/南方阀门-geo-项目档案.json');
    const user = userEvent.setup();
    renderWithProviders(<ProjectListPage />);
    await screen.findByText('南方阀门项目');

    const row = screen.getByText('南方阀门项目').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /导\s*出/ }));
    await user.click(await screen.findByText('项目 JSON（全量）'));

    await waitFor(() => expect(mockInvoke.callsOf('project_export')).toHaveLength(1));
    expect(mockInvoke.lastArgsOf('project_export')).toEqual({ id: 'p-valve' });
    expect(mockInvoke.lastArgsOf('export_write_file')).toMatchObject({
      default_name: '南方阀门-geo-项目档案.json',
      with_bom: false,
    });
    expect(await screen.findByText('项目 JSON 已导出')).toBeInTheDocument();
  });

  it('用户在另存为对话框里取消时不报成功', async () => {
    stubList();
    mockInvoke.stubAlways('project_export_competitors_csv', () => 'name,aliases,website,note,position');
    mockInvoke.stubAlways('export_write_file', () => null);
    const user = userEvent.setup();
    renderWithProviders(<ProjectListPage />);
    await screen.findByText('宏宇泵业 GEO');

    const row = screen.getByText('宏宇泵业 GEO').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /导\s*出/ }));
    await user.click(await screen.findByText('竞品 CSV'));

    await waitFor(() => expect(mockInvoke.callsOf('export_write_file')).toHaveLength(1));
    expect(screen.queryByText('竞品 CSV 已导出')).not.toBeInTheDocument();
  });

  it('在列表里直接增删标签会调用 project_update（spec FR-M1-6 标签增删）', async () => {
    stubList();
    mockInvoke.stubAlways('project_update', (args) => args.project);
    const user = userEvent.setup();
    renderWithProviders(<ProjectListPage />);
    await screen.findByText('宏宇泵业 GEO');

    const row = screen.getByText('宏宇泵业 GEO').closest('tr') as HTMLElement;
    const tagsInput = within(row).getByRole('combobox');
    await user.type(tagsInput, '市政');
    pressEnter(tagsInput);

    await waitFor(() => expect(mockInvoke.callsOf('project_update')).toHaveLength(1));
    const sent = mockInvoke.lastArgsOf('project_update')!.project as Project;
    expect(sent.id).toBe('p-hongyu');
    expect(sent.tags).toContain('市政');
    expect(sent.tags).toContain('水泵');
    expect(await screen.findByText('标签已更新')).toBeInTheDocument();
  });

  it('标签写入失败时给出中文原因且不假装成功', async () => {
    stubList();
    mockInvoke.stubAlways(
      'project_update',
      { code: 'validation/failed', message: '标签不能超过 20 个' },
      'reject',
    );
    const user = userEvent.setup();
    renderWithProviders(<ProjectListPage />);
    await screen.findByText('宏宇泵业 GEO');

    const row = screen.getByText('宏宇泵业 GEO').closest('tr') as HTMLElement;
    const tagsInput = within(row).getByRole('combobox');
    await user.type(tagsInput, '太多');
    pressEnter(tagsInput);

    expect(await screen.findByText('标签不能超过 20 个')).toBeInTheDocument();
    expect(screen.queryByText('标签已更新')).not.toBeInTheDocument();
  });

  it('新建项目按钮存在且可用', async () => {
    stubList();
    renderWithProviders(<ProjectListPage />);
    await screen.findByText('宏宇泵业 GEO');
    expect(screen.getByRole('button', { name: /新建项目/ })).toBeEnabled();
  });
});

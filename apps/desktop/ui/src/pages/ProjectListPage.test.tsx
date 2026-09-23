import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import ProjectListPage from './ProjectListPage';
import { mockInvoke } from '../test/invoke-mock';
import { renderWithProviders } from '../test/render';
import { clickClickableMenuItem } from '../test/dropdown';
import { makeProject } from '../test/fixtures';
import type { Project } from '../api/types';
import { demoInvoke } from '../demo/backend';
import { resetDemoDb } from '../demo/db';
import { SEED_PROJECTS } from '../demo/seed/projects';
import zhCN from '../i18n/locales/zh-CN';

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

  // F-2h②：fixture 换成契约内的真实形状。`store/sqlx` 后端**零发射点**
  // （`StoreError::Sqlx` 映射成 `state/conflict` 或 `io/failed`，`geo-store/src/error.rs:146`-`:152`），
  // 拿它当 fixture 会让这条用例永远走词典 miss，断言命中的是 fixture 自己编的中文
  // ⇒ 4 个页面里唯一一个 `Alert description` 分支的页面级测试，实际没覆盖词典渲染。
  const ioFailed = {
    code: 'io/failed',
    params: { reason: 'Permission denied (os error 13)' },
    message: 'io/failed reason=Permission denied (os error 13)',
  };

  it('后端报错时按词典渲染原因（zh-CN）', async () => {
    mockInvoke.stubAlways('project_list', ioFailed, 'reject');
    renderWithProviders(<ProjectListPage />);

    expect(
      await screen.findByText('文件或数据库读写失败：Permission denied (os error 13)'),
    ).toBeInTheDocument();
  });

  // F-2h③（复审 R-3 提前到本轮）：这是唯一能抓到「页面忘了传 `t` / 传了错的 `t`」的形态。
  // 单元级用例证明**词典**能渲染英文，页面级用例才证明**页面**真的把 `t` 接上了——
  // `onError` / `Alert description` 都不在 render 之外求值，靠闭包捕获 `t`，很容易接错。
  it('同一个后端错误在 en-US 下渲染成英文词典文案（页面级冒烟）', async () => {
    mockInvoke.stubAlways('project_list', ioFailed, 'reject');
    renderWithProviders(<ProjectListPage />, { locale: 'en-US' });

    expect(
      await screen.findByText('A file or database operation failed: Permission denied (os error 13)'),
    ).toBeInTheDocument();
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
    await clickClickableMenuItem(user, '竞品 CSV');

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
    await clickClickableMenuItem(user, '资产 CSV');

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
    await clickClickableMenuItem(user, '项目 JSON（全量）');

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
    await clickClickableMenuItem(user, '竞品 CSV');

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

  // Task 7：中文原因改由词典按 code + params 渲染。后端 message 已退化成紧凑日志串
  // （`GeoError::user_message` == `Display` == `"{code} {k}={v}…"`，见 error.rs:286/:297），
  // 所以这里按 `project_service.rs:315` 的真实发射形状补 params，断言换成词典文案。
  it('标签写入失败时给出词典渲染的原因且不假装成功', async () => {
    stubList();
    mockInvoke.stubAlways(
      'project_update',
      {
        code: 'validation/failed',
        params: { field: 'tags', reason: 'out_of_range', expected: '<=20' },
        message: 'validation/failed expected=<=20 field=tags reason=out_of_range',
      },
      'reject',
    );
    const user = userEvent.setup();
    renderWithProviders(<ProjectListPage />);
    await screen.findByText('宏宇泵业 GEO');

    const row = screen.getByText('宏宇泵业 GEO').closest('tr') as HTMLElement;
    const tagsInput = within(row).getByRole('combobox');
    await user.type(tagsInput, '太多');
    pressEnter(tagsInput);

    expect(await screen.findByText('标签超出允许范围（<=20）')).toBeInTheDocument();
    expect(screen.queryByText('标签已更新')).not.toBeInTheDocument();
  });

  /**
   * §B-11（Task 9 复审 Minor #7）：导出文件名模板整份走词典
   * （`project.list.exportJsonFileName` / `exportCsvFileName`），**动机**就是「en locale 下
   * 不许产出中文文件名」。zh 侧上面两条已有精确断言，en 侧此前一条都没有 ⇒ 这里补上，
   * 形状照 zh 那两条，只换 locale 与期望值。
   *
   * ⚠ `{{brand}}` 装的是**品牌名数据**（中文），en 下照旧是中文；变的是模板本体：
   * `-geo-项目档案.json` → `-geo-project.json`，`-{{label}}.csv` 的 `{{label}}` 取自
   * `project.list.competitorsLabel`（zh「竞品」→ en `competitors`）。
   *
   * 两次导出仍走**同一行**（与上面那条 zh 用例同形）。⚠ 原先这里靠「同一行」绕开一个竞态：
   * antd 的 Dropdown 关掉后菜单仍挂在 DOM 里、只是 `pointer-events: none`，换一行再开就会有
   * **两份**同名菜单项，`findByText` 会命中关闭的那份而点击失败。现在点菜单项一律走
   * `src/test/dropdown.ts` 的 `clickClickableMenuItem`（等「可点」而不是等「存在」），
   * 那个约束已经解除；保持同一行只是为了两条用例形状一致、便于对读。
   */
  it('en-US 下导出文件名走英文模板（品牌名是数据，仍为中文）', async () => {
    stubList();
    mockInvoke.stubAlways('project_export', () => ({ project: hongyu }));
    mockInvoke.stubAlways(
      'project_export_competitors_csv',
      () => 'name,aliases,website,note,position',
    );
    mockInvoke.stubAlways('export_write_file', () => '/tmp/hongyu-geo-project.json');
    const user = userEvent.setup();
    renderWithProviders(<ProjectListPage />, { locale: 'en-US' });
    await screen.findByText('宏宇泵业 GEO');

    const row = screen.getByText('宏宇泵业 GEO').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Export/ }));
    await clickClickableMenuItem(user, 'Project JSON (full)');

    await waitFor(() => expect(mockInvoke.callsOf('project_export')).toHaveLength(1));
    expect(mockInvoke.lastArgsOf('project_export')).toEqual({ id: 'p-hongyu' });
    expect(mockInvoke.lastArgsOf('export_write_file')).toMatchObject({
      default_name: '宏宇泵业-geo-project.json',
      with_bom: false,
    });

    await user.click(within(row).getByRole('button', { name: /Export/ }));
    await clickClickableMenuItem(user, 'Competitors CSV');

    await waitFor(() =>
      expect(mockInvoke.callsOf('project_export_competitors_csv')).toHaveLength(1),
    );
    expect(mockInvoke.lastArgsOf('export_write_file')).toMatchObject({
      default_name: '宏宇泵业-competitors.csv',
      with_bom: true,
    });
    expect(await screen.findByText('The competitors CSV was exported')).toBeInTheDocument();
  });

  it('新建项目按钮存在且可用', async () => {
    stubList();
    renderWithProviders(<ProjectListPage />);
    await screen.findByText('宏宇泵业 GEO');
    expect(screen.getByRole('button', { name: /新建项目/ })).toBeEnabled();
  });

  /**
   * 裁定 B-2：页面级 en-US 冒烟。错误路径那条（F-2h③）已经在上面，这里补的是**静态 chrome**
   * ——标题 / 搜索框 placeholder / 复选框 / 两个按钮 / 页脚提示都在 render 里直接求值，
   * 最容易「忘了接 `t`」，而单元级词典测试照样全绿。
   *
   * ⚠ 刻意**不**写「整页无 CJK」：表格里的项目名 / 品牌名 / 别名 / 地域 / 标签都是**数据**
   * （后端发什么就显示什么），en locale 下照旧是中文。行业标签本身已查词典
   * `project.industries.<id>`（`ProjectTable` 的 `industryLabel`），en 下是英文；
   * 「整页无 CJK」这类判据归 Task 15，得先把数据级泄漏面列清楚才写得对。
   */
  it('B-2 · 页面骨架文案在 en-US 下渲染成英文', async () => {
    stubList();
    renderWithProviders(<ProjectListPage />, { locale: 'en-US' });
    await screen.findByText('宏宇泵业 GEO');

    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by project or brand name')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Show archived' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New project/ })).toBeInTheDocument();
    expect(screen.getByText(/^Tip: type in the tags column/)).toBeInTheDocument();
  });

  it('B-2 对照 · 同一批断言在 zh-CN 下渲染成中文（证明英文不是写死进组件的）', async () => {
    stubList();
    renderWithProviders(<ProjectListPage />);
    await screen.findByText('宏宇泵业 GEO');

    expect(screen.getByRole('heading', { name: '项目' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索项目名或品牌名')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '显示已归档' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /刷新/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新建项目/ })).toBeInTheDocument();
    expect(screen.getByText(/^提示：标签列可直接输入后回车增删/)).toBeInTheDocument();
  });
});

/**
 * B-3（简报 §B-3 / A-3）：把 `project_list` **真的转发进 demo 内存后端**，证明
 * 页面 → `client.projectList` → `demoInvoke` → `handlers/project.ts` 这条链是通的，
 * 而不是像上面 15 条那样打在本地桩上。
 *
 * 🔴 为什么必须逐命令 `stubAlways` 闭包（A-3）：`InvokeHandler` 只收 `args`、**收不到 `cmd`**，
 * 所以 `mockInvoke.setFallback` 无从转发；而 `stub` 是**一次性消费**（`invoke()` 对非 always 桩走
 * `list.shift()`）⇒ 勾「显示已归档」后页面会**第二次**拉列表，用 `stub` 第二次就落到 fallback。
 * 本用例最后那条 `>= 2` 就是 §D-9④ 变异（`stubAlways` → `stub`）的钉子。
 *
 * ⚠ 只转发本用例真的会触发的命令（`project_list`），不把 21 条全塞进来（B-3）。
 * ⚠ 断言里的中文只是**种子数据**（品牌名）；界面文案走词典 `zhCN.project.list.showArchived`（B-3）。
 */
describe('ProjectListPage · B-3 demo 后端转发（逐命令 stubAlways 闭包）', () => {
  beforeEach(() => {
    resetDemoDb();
  });

  afterEach(() => {
    resetDemoDb();
    mockInvoke.reset();
  });

  it('种子项目经 demoInvoke 渲染出来，勾「显示已归档」后第二次拉列表带出归档项目', async () => {
    mockInvoke.stubAlways('project_list', (args) => demoInvoke('project_list', args));
    renderWithProviders(<ProjectListPage />);

    // 非空洞断言①：渲染出来的是**种子**里的项目名（active 在列、archived 默认不在列）。
    expect(await screen.findByText(SEED_PROJECTS[0].name)).toBeInTheDocument();
    expect(screen.queryByText(SEED_PROJECTS[1].name)).not.toBeInTheDocument();
    // 非空洞断言②：证明真的走了转发链，而不是撞上别的桩。
    expect(mockInvoke.callsOf('project_list').length).toBeGreaterThanOrEqual(1);
    expect(mockInvoke.lastArgsOf('project_list')).toMatchObject({
      filter: { include_archived: false },
    });

    await userEvent.click(
      screen.getByRole('checkbox', { name: zhCN.project.list.showArchived }),
    );

    expect(await screen.findByText(SEED_PROJECTS[1].name)).toBeInTheDocument();
    // 第二次调用：`stub`（一次性消费）在这里就会落到 fallback ⇒ §D-9④ 的钉子。
    expect(mockInvoke.callsOf('project_list').length).toBeGreaterThanOrEqual(2);
    expect(mockInvoke.lastArgsOf('project_list')).toMatchObject({
      filter: { include_archived: true },
    });
  });
});

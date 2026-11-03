/**
 * M1.5 关键词库的页面测试（走**演示假后端 + 真种子**，口径同 `pages/ActionPage.test.tsx`）。
 *
 * # 这里钉的是**界面形态**
 * handler 侧的裁定（不调模型、静态指标、不做相似度去重）在 `demo/handlers/keyword.test.ts`；
 * 本文件只管它们在界面上**看得见**：
 * - 🔴 那句"静态值"口径说明必须常驻（`library.keyword.staticNote`）；
 * - 生成弹窗里必须挂着 `demoBody`（否则产品负责人会拿演示数据评审选词质量）；
 * - 生成出来的行来源=AI 生成、状态=**待人工审核**（规则 6 的界面侧对价）；
 * - 🔴 「引用到 Prompt 题库」是**真的写路径**：引用完去 demo 库里数得出来（不是演一个假动作）；
 * - 导出 CSV 的预览首行是表头，落盘走既有的 `export_write_file`（不新增导出命令）。
 *
 * # 两处定位口径（照存量测试）
 * - 按钮的可访问名里带着 antd 图标的 `aria-label`（`plus` / `robot` …）⇒ 一律用**正则**匹配；
 * - 两个汉字的按钮 antd 会插空格（`保 存` / `删 除`）⇒ 正则里写 `\s*`。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import KeywordLibraryPage from './KeywordLibraryPage';
import { KEYWORD_CSV_HEADER } from '../api/library-compose';
import { getDemoDb, resetDemoDb } from '../demo/db';
import { SEED_KEYWORDS, SEED_KEYWORD_GENERATED_POOL } from '../demo/seed/keywords';
import { DEFAULT_KEYWORD_GENERATE_OPTIONS } from '../components/library-generate-defaults';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import { SEED_BASELINE_SET_ID } from '../demo/seed/prompt-sets';
import { clickClickablePopupItem } from '../test/dropdown';
import { renderAtRoute } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/keywords`;
const PATH = '/projects/:id/keywords';

/** 种子里第 6 条（AI 生成 + 待人工审核）：用来走"就地采用"这条人工审核路径。 */
const PENDING_ROW = SEED_KEYWORDS[5];
/** 种子里第 1 条（核心词）：用来走搜索与筛选。 */
const CORE_ROW = SEED_KEYWORDS[0];

/**
 * 默认生成条件下能挑出的行数：从弹窗的默认档与预置池**现算**，不抄一个 6 在这里。
 * handler 取 `min(target_count, 命中数)`；"跳过库里已有的等值文本"这一支不影响本值——
 * 池子与初始库零重叠由 `demo/seed.test.ts` 钉住。
 */
const DEFAULT_GENERATED = Math.min(
  DEFAULT_KEYWORD_GENERATE_OPTIONS.target_count,
  SEED_KEYWORD_GENERATED_POOL.filter((row) =>
    DEFAULT_KEYWORD_GENERATE_OPTIONS.kinds.includes(row.kind),
  ).length,
);

function renderPage() {
  return renderAtRoute(<KeywordLibraryPage />, PATH, ROUTE);
}

async function waitLoaded() {
  await screen.findByRole('heading', { name: '关键词库' });
  await screen.findByText(CORE_ROW.text);
}

/** 表格里的数据行（去掉表头）。 */
function tableRows(): HTMLElement[] {
  const table = document.querySelector('.ant-table') as HTMLElement;
  return [...within(table).getAllByRole('row')].slice(1);
}

function rowOf(text: string): HTMLElement {
  const row = tableRows().find((entry) => entry.textContent?.includes(text));
  expect(row, `表格里找不到「${text}」`).toBeDefined();
  return row as HTMLElement;
}

/**
 * 工具栏那个筛选 `Select` 的**可点入口**（照 `pages/PromptSetPage.test.tsx` 的既有写法）。
 *
 * 🔴 不能拿 `getAllByLabelText(label)[0]`：那是外层 `div.ant-select`，点它**不会**展开——
 * antd 的开合挂在子节点 `.ant-select-selector` 的 mousedown 上，而 DOM 事件只向上冒泡、
 * 不会向下传到子节点（实测：点外层 div 之后 `.ant-select-dropdown` 一个都没挂出来，
 * 症状是"选项找不到"，很容易被误读成弹层竞态）。`role="combobox"` 那个 input 在
 * selector **内部**，点它才冒泡得上去。
 */
function toolbarSelect(label: string): HTMLElement {
  return screen.getByRole('combobox', { name: label });
}

/** 勾选某一行的复选框。 */
async function selectRow(user: ReturnType<typeof userEvent.setup>, text: string) {
  const checkbox = rowOf(text).querySelector('input[type="checkbox"]');
  expect(checkbox, `「${text}」那一行没有复选框`).not.toBeNull();
  await user.click(checkbox as HTMLElement);
}

/** 确认弹窗（`modal.confirm`）：点掉那个危险按钮。 */
async function confirmDanger(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  const dialog = await waitFor(() => {
    const node = document.querySelector('.ant-modal-confirm');
    expect(node, '确认弹窗没出现').not.toBeNull();
    return node as HTMLElement;
  });
  await user.click(within(dialog).getByRole('button', { name }));
}

/**
 * 把「引用到 Prompt 题库」弹窗的目标题库改选成**基线题库**。
 *
 * 🔴 弹窗默认选清单第一项，而 `prompt_set_list` 的顺序是 `version DESC, created_at DESC`
 * ⇒ 默认落在**小样本那份**（28 条）上。这里刻意不引用进小样本：它加 2 条就正好踩到
 * `MINIMUM_SAMPLE_SIZE(30)`，而 `sample_size_grade` 在 demo 里是**写死的静态值**（规则 9，
 * 不重算）⇒ 引用完会出现"30 条却仍标 insufficient"这种自相矛盾的形态。
 * 基线题库 62 → 64 条不跨档位，走查的是引用这条**写路径**本身。
 */
async function chooseBaselineSet(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
): Promise<void> {
  await user.click(within(dialog).getByRole('combobox'));
  // 选项文案是 `${label} (${item_count})`，用标签里唯一的那段认它。
  await clickClickablePopupItem(user, /基线题库/);
}

beforeEach(() => {
  resetDemoDb();
  // jsdom 没有这两个静态方法 ⇒ demo 的 `export_write_file` 会抛"运行环境不支持 blob 下载"。
  // 这里补上，让导出这条链路在测试里真的走到底（与浏览器 demo 的行为一致）。
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = vi.fn(() => 'blob:demo');
    URL.revokeObjectURL = vi.fn();
  }
});

describe('KeywordLibraryPage · 首屏', () => {
  it('14 条种子上屏 + 🔴 静态值口径说明常驻 + 枚举标签走词典', async () => {
    renderPage();
    await waitLoaded();

    expect(
      screen.getByText('核心词 · 长尾词 · 品牌词 · 竞品词 · 问题词，可直接引用去优化官网或进 Prompt 题库'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('月搜索量与竞争难度在演示模式下是预置静态值，不由前端抓取或计算。'),
    ).toBeInTheDocument();

    expect(tableRows()).toHaveLength(SEED_KEYWORDS.length);
    // 四张标签表都渲染成词典里的中文，不露裸记号
    expect(screen.getAllByText('核心词').length).toBeGreaterThan(0);
    expect(screen.getAllByText('长尾词').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AI 生成').length).toBeGreaterThan(0);
    expect(screen.getAllByText('待人工审核').length).toBeGreaterThan(0);
    for (const token of ['long_tail', 'pending_review', 'brand_comparison', 'generated']) {
      expect(screen.queryByText(token), `裸记号 ${token} 上屏了`).not.toBeInTheDocument();
    }
    // 指标为 null 的那两条显示空值占位符（两条 × 两列），不是 0
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
  });

  it('按类型筛选 + 搜索：两个条件叠加生效', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(toolbarSelect('按类型筛选'));
    // 弹层内定位：`竞品词` 同时也是表格里「类型」那一列的文案，全文找必然多重命中。
    await clickClickablePopupItem(user, '竞品词');

    await waitFor(() => expect(tableRows()).toHaveLength(2));
    expect(rowOf('澜舟和蓝净除尘器哪个好')).toBeDefined();

    await user.type(screen.getByLabelText('搜索关键词'), '恒宇');
    await waitFor(() => expect(tableRows()).toHaveLength(1));
    expect(screen.getByText('显示 1 / 14 条')).toBeInTheDocument();
  });

  it('按来源筛选：AI 生成那一档只剩 5 条', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(toolbarSelect('按来源筛选'));
    await clickClickablePopupItem(user, 'AI 生成');

    await waitFor(() =>
      expect(tableRows()).toHaveLength(SEED_KEYWORDS.filter((row) => row.source === 'generated').length),
    );
  });
});

describe('KeywordLibraryPage · 手动录入', () => {
  it('录入一条 → 立刻出现在列表末尾，来源=人工录入、状态=已通过', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('button', { name: /手动录入/ }));
    await screen.findByText('录入关键词');
    await user.type(screen.getByPlaceholderText('例如：布袋除尘器厂家'), '除尘器风机选型');
    await user.click(screen.getByRole('button', { name: /保\s*存/ }));

    await screen.findByText('已保存关键词');
    await waitFor(() => expect(tableRows()).toHaveLength(SEED_KEYWORDS.length + 1));
    const added = rowOf('除尘器风机选型');
    expect(added.textContent).toContain('人工录入');
    expect(added.textContent).toContain('已通过');
    expect(getDemoDb().keywords).toHaveLength(SEED_KEYWORDS.length + 1);
  });

  it('🔴 文本留空 ⇒ 表单挡住，一条都不入库', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('button', { name: /手动录入/ }));
    await screen.findByText('录入关键词');
    await user.click(screen.getByRole('button', { name: /保\s*存/ }));

    expect(await screen.findByText('请填写关键词文本')).toBeInTheDocument();
    expect(getDemoDb().keywords).toHaveLength(SEED_KEYWORDS.length);
  });
});

describe('KeywordLibraryPage · AI 生成', () => {
  it('弹窗里那句 demo 说明必须在场；生成出来的行是 AI 生成 + 待人工审核', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('button', { name: /AI\s*生成/ }));
    await screen.findByText('AI 生成关键词');
    expect(
      screen.getByText(
        '演示模式不调用模型：生成结果取自预置语料池，走查的是产物形态（类型、意图、审核态），不是选词质量。',
      ),
    ).toBeInTheDocument();

    // 弹窗的确认按钮与工具栏那个按钮同名 ⇒ 限定在弹窗里点
    const dialog = document.querySelector('.ant-modal-content') as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /AI\s*生成/ }));

    await screen.findByText(`已生成 ${DEFAULT_GENERATED} 条关键词`);
    await waitFor(() => expect(tableRows()).toHaveLength(SEED_KEYWORDS.length + DEFAULT_GENERATED));
    const added = rowOf('除尘器厂家哪家好');
    expect(added.textContent).toContain('AI 生成');
    expect(added.textContent).toContain('待人工审核');
  });
});

describe('KeywordLibraryPage · 人工审核与删除', () => {
  it('就地翻状态：待人工审核 → 已通过，并落进库', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const row = rowOf(PENDING_ROW.text);
    expect(row.textContent).toContain('待人工审核');
    await user.click(within(row).getByText('待人工审核'));
    await clickClickablePopupItem(user, '已通过');

    await screen.findByText('已保存关键词');
    await waitFor(() => expect(rowOf(PENDING_ROW.text).textContent).toContain('已通过'));
    expect(getDemoDb().keywords.find((item) => item.id === PENDING_ROW.id)?.status).toBe('approved');
  });

  it('勾选后删除：行消失，剩下的序号连续', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await selectRow(user, CORE_ROW.text);
    await user.click(screen.getByRole('button', { name: /删除选中/ }));
    await confirmDanger(user, /删\s*除/);

    await screen.findByText('已删除 1 条关键词');
    await waitFor(() => expect(tableRows()).toHaveLength(SEED_KEYWORDS.length - 1));
    expect(screen.queryByText(CORE_ROW.text)).not.toBeInTheDocument();
    // 序号列从 1 连续排到 13（删除后重排 position 的界面侧证据）
    expect(tableRows()[0].textContent).toContain('1');
    expect(tableRows().at(-1)?.textContent).toContain(String(SEED_KEYWORDS.length - 1));
  });
});

describe('KeywordLibraryPage · 站长数据叠加（DR-101）', () => {
  it('能拼上的词显示平台数 + 区间；拼不上的词不显示空占位', async () => {
    renderPage();
    await waitLoaded();

    await waitFor(() =>
      expect(rowOf('工业除尘器').textContent).toContain('来自 3 个平台'),
    );
    const unmatched = rowOf('焊接烟尘净化器');
    expect(unmatched.textContent).not.toContain('来自 ');
  });
});

describe('KeywordLibraryPage · 筛选与批量选择', () => {
  it('切换类型筛选会清空选区，批量删除立即置灰', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await selectRow(user, CORE_ROW.text);
    expect(screen.getByRole('button', { name: /删除选中（1）/ })).toBeEnabled();

    await user.click(toolbarSelect('按类型筛选'));
    await clickClickablePopupItem(user, '核心词');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /删除选中/ })).toBeDisabled(),
    );
  });
});

describe('KeywordLibraryPage · 引用到 Prompt 题库（DR-43）', () => {
  it('勾 2 条 → 选题库 → 引用：题库里真的多出 2 道题', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await selectRow(user, SEED_KEYWORDS[1].text);
    await selectRow(user, SEED_KEYWORDS[2].text);
    await user.click(screen.getByRole('button', { name: /引用到\s*Prompt\s*题库/ }));

    await screen.findByText('将新增 2 道题目');
    // 两条必须显示的口径说明（映射规则 + 来源按人工录入计）
    expect(
      screen.getByText('文本作为题干、意图沿用素材的意图、关键词优先级作为权重；分组与标签留空。'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('引用后来源按「人工录入」计：素材库的 AI 生成标记不会带进题库。'),
    ).toBeInTheDocument();

    const before = getDemoDb().promptItems.filter(
      (item) => item.set_id === SEED_BASELINE_SET_ID,
    ).length;
    const dialog = document.querySelector('.ant-modal-content') as HTMLElement;
    await chooseBaselineSet(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: /引\s*用/ }));

    await screen.findByText(/已引用 2 道题目到/);
    await waitFor(() => {
      const after = getDemoDb().promptItems.filter((item) => item.set_id === SEED_BASELINE_SET_ID);
      expect(after).toHaveLength(before + 2);
      expect(after.map((item) => item.text)).toContain(SEED_KEYWORDS[1].text);
      // 意图沿用素材的意图；权重 = 关键词优先级；来源按人工录入计
      const referenced = after.find((item) => item.text === SEED_KEYWORDS[2].text);
      expect(referenced?.intent).toBe(SEED_KEYWORDS[2].intent);
      expect(referenced?.weight).toBe(SEED_KEYWORDS[2].priority);
      expect(referenced?.source).toBe('manual');
    });
  });

  it('没勾选时引用按钮置灰', async () => {
    renderPage();
    await waitLoaded();

    expect(screen.getByRole('button', { name: /引用到\s*Prompt\s*题库/ })).toBeDisabled();
  });
});

describe('KeywordLibraryPage · 导出 CSV（DR-44）', () => {
  it('预览首行是表头，下载走既有的 export_write_file', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('button', { name: /导出\s*CSV/ }));
    await screen.findByText('导出预览');

    const preview = document.querySelector('.ant-modal-content textarea') as HTMLTextAreaElement;
    expect(preview.value.split('\n')[0]).toBe(KEYWORD_CSV_HEADER.join(','));
    expect(preview.value).toContain(CORE_ROW.text);
    expect(screen.getByText(/geo-keywords-.*\.csv/)).toBeInTheDocument();

    const dialog = document.querySelector('.ant-modal-content') as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /下\s*载/ }));
    await screen.findByText(/已导出：geo-keywords-/);
  });
});

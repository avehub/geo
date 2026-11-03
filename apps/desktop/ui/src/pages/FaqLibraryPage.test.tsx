/**
 * M1.5 FAQ 常见问题库的页面测试（走**演示假后端 + 真种子**）。
 *
 * # 这里钉的是**界面形态**（handler 侧裁定在 `demo/handlers/faq.test.ts`）
 * - 答案是 Markdown 原文，展开行按**预格式文本**呈现，且待审的 AI 答案旁边挂着
 *   「演示模式未执行合规扫描」（规则 6 的界面侧对价）；
 * - 🔴 **JSON-LD 只收已通过**：预览里既有已通过的问答，也**绝不**出现待审/已退回的问题；
 * - 🔴 一条已通过的都没有时，导出按钮**置灰**并给出原因（不是导出一份空壳）；
 * - 引用到 Prompt 题库是真的写路径；FAQ 没有优先级 ⇒ 权重一律用后端默认值 3。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FaqLibraryPage from './FaqLibraryPage';
import { getDemoDb, resetDemoDb } from '../demo/db';
import { SEED_FAQS, SEED_FAQ_GENERATED_POOL } from '../demo/seed/faqs';
import { DEFAULT_FAQ_GENERATE_OPTIONS } from '../components/library-generate-defaults';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import { SEED_BASELINE_SET_ID } from '../demo/seed/prompt-sets';
import { clickClickablePopupItem } from '../test/dropdown';
import { renderAtRoute } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/faq`;
const PATH = '/projects/:id/faq';

/** 种子里第 4 条（批量导入 + 已通过）：它的问题会进 JSON-LD。 */
const APPROVED_ROW = SEED_FAQS[4];
/** 种子里第 7 条（AI 生成 + 待人工审核）：🔴 它绝不该进 JSON-LD。 */
const PENDING_ROW = SEED_FAQS[3];
/** 种子里第 8 条（已退回）：同样绝不该进 JSON-LD。 */
const REJECTED_ROW = SEED_FAQS[7];

/**
 * 默认生成条件下能挑出的行数：从弹窗的默认档与预置池**现算**，不抄一个 6 在这里
 * （口径与 `KeywordLibraryPage.test.tsx` 的同名常量逐字相同）。
 */
const DEFAULT_GENERATED = Math.min(
  DEFAULT_FAQ_GENERATE_OPTIONS.target_count,
  SEED_FAQ_GENERATED_POOL.filter((row) =>
    DEFAULT_FAQ_GENERATE_OPTIONS.intents.includes(row.intent),
  ).length,
);

function renderPage() {
  return renderAtRoute(<FaqLibraryPage />, PATH, ROUTE);
}

async function waitLoaded() {
  await screen.findByRole('heading', { name: 'FAQ 常见问题库' });
  await screen.findByText(APPROVED_ROW.question);
}

/**
 * 表格里的数据行。两个坑各挡一次：
 * - 只取 `.ant-table-tbody`：表头那行也带复选框（全选），从 `.ant-table` 起数会多出一行；
 * - 再按"带复选框"过滤：展开行同样是 `tr`，但它没有复选框那一列。
 */
function tableRows(): HTMLElement[] {
  const body = document.querySelector('.ant-table-tbody') as HTMLElement;
  return [...within(body).getAllByRole('row')].filter(
    (row) => row.querySelector('input[type="checkbox"]') !== null,
  );
}

function rowOf(question: string): HTMLElement {
  const row = tableRows().find((entry) => entry.textContent?.includes(question));
  expect(row, `表格里找不到「${question}」`).toBeDefined();
  return row as HTMLElement;
}

/**
 * 工具栏那个筛选 `Select` 的**可点入口**（照 `pages/PromptSetPage.test.tsx` 的既有写法）。
 *
 * 🔴 不能拿 `getAllByLabelText(label)[0]`：那是外层 `div.ant-select`，点它**不会**展开——
 * antd 的开合挂在子节点 `.ant-select-selector` 的 mousedown 上，而 DOM 事件只向上冒泡、
 * 不会向下传到子节点。`role="combobox"` 那个 input 在 selector **内部**，点它才冒泡得上去。
 */
function toolbarSelect(label: string): HTMLElement {
  return screen.getByRole('combobox', { name: label });
}

async function selectRow(user: ReturnType<typeof userEvent.setup>, question: string) {
  const checkbox = rowOf(question).querySelector('input[type="checkbox"]');
  await user.click(checkbox as HTMLElement);
}

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
 * 🔴 弹窗默认选的是清单第一项，而 `prompt_set_list` 的顺序是 `version DESC, created_at DESC`
 * ⇒ 默认落在**小样本那份**（28 条）上。这两条用例刻意不引用进小样本：它加 2 条就正好踩到
 * `MINIMUM_SAMPLE_SIZE(30)`，而 `sample_size_grade` 在 demo 里是**写死的静态值**（规则 9，
 * 不重算）⇒ 引用完界面上会出现"30 条却仍标 insufficient"这种自相矛盾的形态。
 * 基线题库 62 → 64 条不跨任何档位，走查的是引用这条写路径本身。
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
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = vi.fn(() => 'blob:demo');
    URL.revokeObjectURL = vi.fn();
  }
});

describe('FaqLibraryPage · 首屏', () => {
  it('8 条种子上屏 + 静态值口径说明 + 枚举标签走词典', async () => {
    renderPage();
    await waitLoaded();

    expect(
      screen.getByText('问题 + 答案成对沉淀，可导出成官网的 FAQPage 结构化数据，或引用进 Prompt 题库'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('AI 生成的问答在演示模式下取自预置语料，未执行合规扫描，采用前请人工核对。'),
    ).toBeInTheDocument();

    expect(tableRows()).toHaveLength(SEED_FAQS.length);
    expect(screen.getAllByText('AI 生成').length).toBeGreaterThan(0);
    expect(screen.getAllByText('待人工审核').length).toBeGreaterThan(0);
    for (const token of ['pending_review', 'after_sales_reputation', 'generated']) {
      expect(screen.queryByText(token), `裸记号 ${token} 上屏了`).not.toBeInTheDocument();
    }
  });

  it('展开一行看到答案原文（Markdown 不渲染，按预格式文本呈现）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const row = rowOf(PENDING_ROW.question);
    const icon = row.querySelector('.ant-table-row-expand-icon');
    expect(icon, '那一行没有展开图标').not.toBeNull();
    await user.click(icon as HTMLElement);

    expect(await screen.findByText('答案预览')).toBeInTheDocument();
    // 🔴 原文里的换行与列表记号**原样**保留 ⇒ 断言整段原文逐字在展开行里。
    // 不用 `getByText(原文)`：它只把 **DOM 那一侧**的空白折叠掉，期望串不折叠，
    // 多行原文因此永远比不上（实测 `queryByText(原文)` 为 null、折叠后才命中）——
    // 而那恰好把"换行被保留"这件事测没了。`textContent` 不做归一化，换行照原样对得上。
    const expanded = document.querySelector('.ant-table-expanded-row') as HTMLElement;
    expect(expanded, '展开行没渲染').not.toBeNull();
    expect(expanded.textContent).toContain(PENDING_ROW.answer_markdown);
    // 🔴 待审的 AI 答案旁边挂着那句合规说明
    expect(screen.getByText('演示模式未执行合规扫描')).toBeInTheDocument();
  });

  it('按分类筛选：分类是自由文本数据，选项从清单里现算', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(toolbarSelect('按分类筛选'));
    // 弹层内定位：`选型` 同时也是表格里那一列的 Tag 文案，全文找必然多重命中。
    await clickClickablePopupItem(user, '选型');

    await waitFor(() =>
      expect(tableRows()).toHaveLength(SEED_FAQS.filter((row) => row.category === '选型').length),
    );
  });
});

describe('FaqLibraryPage · 手动录入', () => {
  it('问答成对录入 → 出现在列表末尾，来源=人工录入', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('button', { name: /手动录入/ }));
    await screen.findByText('录入常见问题');
    await user.type(
      screen.getByPlaceholderText('例如：布袋除尘器和滤筒除尘器怎么选？'),
      '除尘器停机后要立刻清灰吗？',
    );
    await user.type(
      screen.getByPlaceholderText('按「结论 → 依据 → 适用工况」写，答案会原样进 JSON-LD。'),
      '建议停机后继续清灰一到两个循环，再关风机。',
    );
    await user.type(screen.getByLabelText('分类'), '维保');
    const dialog = document.querySelector('.ant-modal-content') as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    await screen.findByText('已保存常见问题');
    await waitFor(() => expect(tableRows()).toHaveLength(SEED_FAQS.length + 1));
    expect(rowOf('除尘器停机后要立刻清灰吗？').textContent).toContain('人工录入');
    expect(getDemoDb().faqs).toHaveLength(SEED_FAQS.length + 1);
  });

  it('🔴 答案留空 ⇒ 表单挡住，一条都不入库', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('button', { name: /手动录入/ }));
    await screen.findByText('录入常见问题');
    await user.type(
      screen.getByPlaceholderText('例如：布袋除尘器和滤筒除尘器怎么选？'),
      '只有问题没有答案？',
    );
    const dialog = document.querySelector('.ant-modal-content') as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    expect(await screen.findByText('请填写答案')).toBeInTheDocument();
    expect(getDemoDb().faqs).toHaveLength(SEED_FAQS.length);
  });
});

describe('FaqLibraryPage · AI 生成', () => {
  it('生成的问答一律 AI 生成 + 待人工审核', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('button', { name: /AI\s*生成/ }));
    await screen.findByText('AI 生成常见问题');
    expect(
      screen.getByText('演示模式不调用模型：问答取自预置语料池，走查的是产物形态（分类、意图、审核态、JSON-LD），不是文笔。'),
    ).toBeInTheDocument();

    const dialog = document.querySelector('.ant-modal-content') as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /AI\s*生成/ }));

    await screen.findByText(`已生成 ${DEFAULT_GENERATED} 条常见问题`);
    await waitFor(() => expect(tableRows()).toHaveLength(SEED_FAQS.length + DEFAULT_GENERATED));
    const added = rowOf('除尘器选型需要提供哪些工况参数？');
    expect(added.textContent).toContain('AI 生成');
    expect(added.textContent).toContain('待人工审核');
  });
});

describe('FaqLibraryPage · 导出 FAQPage JSON-LD（🔴 只收已通过）', () => {
  it('预览里只有已通过的问答，待审与已退回的一条都不进', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('button', { name: /导出 FAQPage JSON-LD/ }));
    await screen.findByText('FAQPage 结构化数据预览');
    expect(
      screen.getByText('把这段 JSON-LD 放进官网页面的 head 里，搜索引擎与 AI 助手可以直接读取问答对。 · 收录 5 条已通过的问答'),
    ).toBeInTheDocument();

    const preview = document.querySelector('.ant-modal-content textarea') as HTMLTextAreaElement;
    const payload = JSON.parse(preview.value) as {
      '@type': string;
      mainEntity: { '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }[];
    };
    expect(payload['@type']).toBe('FAQPage');
    expect(payload.mainEntity).toHaveLength(5);
    expect(payload.mainEntity.map((entry) => entry.name)).toContain(APPROVED_ROW.question);
    expect(payload.mainEntity.map((entry) => entry.name)).not.toContain(PENDING_ROW.question);
    expect(payload.mainEntity.map((entry) => entry.name)).not.toContain(REJECTED_ROW.question);
    // 答案按 Markdown 原文进 text
    expect(payload.mainEntity[0].acceptedAnswer.text).toContain('\n');

    const dialog = document.querySelector('.ant-modal-content') as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /下\s*载/ }));
    await screen.findByText(/已导出：geo-faq-/);
  });

  it('🔴 一条已通过的都没有 ⇒ 按钮置灰（不导出空壳）', async () => {
    // 直接改内存库：界面上"逐条打回待审"要走 8 次下拉，这里只验形态不验操作路径。
    for (const row of getDemoDb().faqs) row.status = 'pending_review';

    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const button = screen.getByRole('button', { name: /导出 FAQPage JSON-LD/ });
    expect(button).toBeDisabled();
    await user.hover(button);
    expect(
      await screen.findByText('没有「已通过」的问答可导出：JSON-LD 只收录人工审核通过的条目。'),
    ).toBeInTheDocument();
  });
});

describe('FaqLibraryPage · 引用与删除', () => {
  it('勾 2 条问题引用进题库：权重用后端默认值 3', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await selectRow(user, SEED_FAQS[0].question);
    await selectRow(user, SEED_FAQS[1].question);
    await user.click(screen.getByRole('button', { name: /引用到\s*Prompt\s*题库/ }));

    await screen.findByText('将新增 2 道题目');
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
      const referenced = after.find((item) => item.text === SEED_FAQS[0].question);
      expect(referenced?.weight).toBe(3);
      expect(referenced?.intent).toBe(SEED_FAQS[0].intent);
    });
  });

  it('删除一条：行消失，序号重排', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await selectRow(user, REJECTED_ROW.question);
    await user.click(screen.getByRole('button', { name: /删除选中/ }));
    await confirmDanger(user, /删\s*除/);

    await screen.findByText('已删除 1 条常见问题');
    await waitFor(() => expect(tableRows()).toHaveLength(SEED_FAQS.length - 1));
    expect(screen.queryByText(REJECTED_ROW.question)).not.toBeInTheDocument();
  });
});

/**
 * M6 行动中心的页面测试（走**演示假后端 + 真种子**，口径同 `pages/CollectionPage.test.tsx`）。
 *
 * # 这里钉的是**界面形态**
 * 处方不重排、文稿不调模型、`compliance_checked` 不假装扫过——这些 handler 侧的裁定在
 * `demo/handlers/action.test.ts`。本文件只管它们在界面上**看得见**：
 * - 🔴 两句合规相关的口径说明必须显示（`action.staticNote`、`action.attribution.note`）；
 * - 归因卡片的四个数字与诊断页对得上，且「变化」按**百分点**显示（不是 +13%）；
 * - 标记完成能就地生效，但归因数字一动不动；
 * - 生成文稿走一遍：弹窗 → 待人工审核 → 「演示模式未执行合规扫描」；
 * - 🔴 demo 产不出的导出格式按钮置灰，并逐条说明。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ActionPage from './ActionPage';
import { resetDemoDb } from '../demo/db';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import {
  SEED_ACTIONS,
  SEED_ATTRIBUTION_CARDS,
  SEED_CONTENT_TEMPLATES,
} from '../demo/seed/actions';
import { SEED_GENERATED_CONTENTS } from '../demo/seed/contents';
import { SEED_FACT_CHECK_ISSUES } from '../demo/seed/insights';
import { renderAtRoute } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/action`;
const PATH = '/projects/:id/action';

/** 种子里第 6 条（`todo`）：用来走「标记完成」；第 1 条带着关联的核查问题。 */
const TODO_ACTION = SEED_ACTIONS.find((item) => item.id === 'demo-act-006')!;
const LINKED_ACTION = SEED_ACTIONS.find((item) => item.id === 'demo-act-001')!;

function renderPage() {
  return renderAtRoute(<ActionPage />, PATH, ROUTE);
}

/** 按卡片标题取那张卡。 */
function cardOf(title: string): HTMLElement {
  const card = screen.getByText(title).closest('.ant-card');
  expect(card, `找不到卡片「${title}」`).not.toBeNull();
  return card as HTMLElement;
}

async function waitLoaded() {
  await screen.findByRole('heading', { name: 'GEO 行动中心' });
  await screen.findByText(LINKED_ACTION.title);
}

/** 某张卡里那张表的数据行数（去掉表头）。 */
function dataRowCount(card: HTMLElement): number {
  return within(card).getAllByRole('row').length - 1;
}

/** 处方表里那一行（按处方标题定位）。 */
function rowOf(title: string): HTMLElement {
  const row = within(cardOf('Top 处方'))
    .getAllByRole('row')
    .find((entry) => entry.textContent?.includes(title));
  expect(row, `处方表里找不到「${title}」`).toBeDefined();
  return row as HTMLElement;
}

/** 展开处方行（antd 的展开图标没有可用的可访问名 ⇒ 按 class 取，与既有测试同口径）。 */
async function expandRow(user: ReturnType<typeof userEvent.setup>, title: string) {
  const icon = rowOf(title).querySelector('.ant-table-row-expand-icon');
  expect(icon, '那一行没有展开图标').not.toBeNull();
  await user.click(icon as HTMLElement);
}

beforeEach(() => {
  resetDemoDb();
});

describe('ActionPage · 处方清单', () => {
  it('10 条处方按名次上屏 + 🔴 静态值口径说明 + 快赢汇总', async () => {
    renderPage();
    await waitLoaded();

    expect(dataRowCount(cardOf('Top 处方'))).toBe(SEED_ACTIONS.length);
    expect(
      screen.getByText('处方清单与归因数字在演示模式下是预置静态值，不由前端排序或重算。'),
    ).toBeInTheDocument();
    const quickWins = SEED_ACTIONS.filter((item) => item.quick_win).length;
    expect(quickWins).toBeGreaterThanOrEqual(3); // MVP 验收：≥3 条快赢
    expect(screen.getByText(`其中 ${quickWins} 条预计 1 小时内可完成。`)).toBeInTheDocument();
    expect(screen.getAllByText('1 小时内可完成')).toHaveLength(quickWins);
    // 四类处方的类别标签都查到了词典（没有裸枚举值上屏）。
    expect(screen.getAllByText('站点结构').length).toBeGreaterThan(0);
    expect(screen.queryByText('site_structure')).not.toBeInTheDocument();
  });

  it('按类别筛选只留下该类别的处方', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(within(cardOf('Top 处方')).getByRole('combobox'));
    await user.click(await screen.findByTitle('事实纠错'));

    const expected = SEED_ACTIONS.filter((item) => item.category === 'fact_correction').length;
    await waitFor(() => expect(dataRowCount(cardOf('Top 处方'))).toBe(expected));
    expect(LINKED_ACTION.category).toBe('site_structure');
    expect(screen.queryByText(LINKED_ACTION.title)).not.toBeInTheDocument();
  });

  it('展开一行：依据 / 负责人 / 可交付物 / 涉及引擎都在，关联证据能点进抽屉', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await expandRow(user, LINKED_ACTION.title);

    expect(await screen.findByText(LINKED_ACTION.rationale)).toBeInTheDocument();
    expect(screen.getByText(LINKED_ACTION.owner_hint)).toBeInTheDocument();
    expect(screen.getByText(LINKED_ACTION.deliverable)).toBeInTheDocument();
    // 主表那一列也是「N 道题」，别的处方可能同数 ⇒ 按行取。
    expect(
      within(rowOf(LINKED_ACTION.title)).getByText(`${LINKED_ACTION.affected_prompt_count} 道题`),
    ).toBeInTheDocument();

    // 关联证据渲染成**字段名**（查 `entity.fields`），不是裸 id。
    const issue = SEED_FACT_CHECK_ISSUES.find(
      (entry) => entry.id === LINKED_ACTION.evidence_issue_ids[0],
    )!;
    expect(issue).toBeDefined();
    expect(screen.queryByText(issue.id)).not.toBeInTheDocument();

    // `entity.fields.differentiators` 的中文标签（zh-CN 词典）。
    const evidenceButton = screen.getByRole('button', { name: '差异化卖点' });
    await user.click(evidenceButton);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('证据详情')).toBeInTheDocument();
    expect(within(drawer).getByText(issue.prompt_text)).toBeInTheDocument();
  });

  it('标记完成就地生效，且 🔴 归因数字一动不动', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const attributionBefore = cardOf('闭环归因').textContent;
    expect(TODO_ACTION.status).toBe('todo');
    expect(rowOf(TODO_ACTION.title).textContent).toContain('待办');

    await user.click(within(rowOf(TODO_ACTION.title)).getByRole('button', { name: '标记完成' }));

    expect(await screen.findByText('已更新处方状态')).toBeInTheDocument();
    await waitFor(() => {
      const row = rowOf(TODO_ACTION.title);
      expect(row.textContent).toContain('已完成');
      // 翻成 done 之后，这一行的按钮换成「打回待办 / 标记进行中」。
      expect(within(row).queryByRole('button', { name: '标记完成' })).not.toBeInTheDocument();
      expect(within(row).getByRole('button', { name: '打回待办' })).toBeInTheDocument();
    });
    // 🔴 翻状态不重算归因（归因要靠复测轮的数据，而 demo 的复测轮是种子）。
    expect(cardOf('闭环归因').textContent).toBe(attributionBefore);
  });
});

describe('ActionPage · 闭环归因', () => {
  it('四个指标的 执行前 / 复测后 / 变化 都按种子渲染，变化量是**百分点**', async () => {
    renderPage();
    await waitLoaded();

    const card = cardOf('闭环归因');
    const attribution = SEED_ATTRIBUTION_CARDS[0];
    expect(dataRowCount(card)).toBe(attribution.metrics.length);
    expect(within(card).getByText(attribution.summary)).toBeInTheDocument();
    expect(within(card).getByText(`基线轮: ${attribution.baseline_label}`)).toBeInTheDocument();
    expect(within(card).getByText(`复测轮: ${attribution.retest_label}`)).toBeInTheDocument();
    expect(
      within(card).getByText(`期间完成的动作: ${attribution.action_ids.length}`),
    ).toBeInTheDocument();

    // Brand Coverage 0.42 → 0.55：显示成 42% / 55% / +13 个百分点（不是 +13%）。
    expect(within(card).getByText('42%')).toBeInTheDocument();
    expect(within(card).getByText('55%')).toBeInTheDocument();
    // Brand Coverage（0.42→0.55）与 Top3 率（0.21→0.34）都是 +13 个百分点 ⇒ 两行。
    expect(within(card).getAllByText('+13 个百分点')).toHaveLength(2);
    // 条数类指标：执行前 / 复测后是原值（27 → 15），只有「变化」那一列带单位（−12 条）。
    expect(within(card).getByText('27')).toBeInTheDocument();
    expect(within(card).getByText('15')).toBeInTheDocument();
    expect(within(card).getByText('-12 条')).toBeInTheDocument();

    // 🔴 这句合规口径必须显示（不是因果证明）。
    expect(
      screen.getByText(
        'AI 回答存在随机性，区间按重复采样给出；这张卡片是环比对照，不是因果证明。',
      ),
    ).toBeInTheDocument();
  });
});

describe('ActionPage · 内容生产', () => {
  it('模板目录 6 行 + 已生成文稿 2 行 + 🔴 合规默认值与置灰的导出格式', async () => {
    renderPage();
    await waitLoaded();

    expect(dataRowCount(cardOf('内容模板'))).toBe(SEED_CONTENT_TEMPLATES.length);
    const contents = cardOf('已生成文稿');
    expect(dataRowCount(contents)).toBe(SEED_GENERATED_CONTENTS.length);
    expect(
      within(contents).getByText('生成内容默认待人工审核，通过后才可对外发布（合规红线）。'),
    ).toBeInTheDocument();
    // 种子里那两份是"真后端扫过之后"的样子。
    expect(screen.getAllByText('已过合规扫描')).toHaveLength(2);
    expect(screen.queryByText('演示模式未执行合规扫描')).not.toBeInTheDocument();
    // 审核态查到了词典（没有裸枚举值上屏）。
    expect(screen.queryByText('pending_review')).not.toBeInTheDocument();
    expect(within(contents).getByText('待人工审核')).toBeInTheDocument();
    expect(within(contents).getByText('已通过')).toBeInTheDocument();
    // 🔴 导出按钮在**预览抽屉**的 extra 里（见下面那条用例），表格上只有审核动作。
    expect(within(contents).queryByRole('button', { name: 'Word' })).not.toBeInTheDocument();
  });

  it('fact_correction 处方也有适配模板：弹窗不是空表单（demo-act-003）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const action = SEED_ACTIONS.find((item) => item.category === 'fact_correction')!;
    await user.click(within(rowOf(action.title)).getByRole('button', { name: /生成可交付物/ }));

    const modal = await screen.findByRole('dialog');
    // 有适配模板 ⇒ 默认选中第一个、章节结构可见、确认可点。
    expect(within(modal).getByText('章节结构:')).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: /确\s*认/ })).toBeEnabled();
  });

  it('从模板区生成一份文稿：待人工审核 + 🔴 未执行合规扫描', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    // 带图标的按钮，可访问名含图标自己的 aria-label ⇒ 用正则。
    await user.click(within(cardOf('内容模板')).getByRole('button', { name: /生成文稿/ }));
    const modal = await screen.findByRole('dialog');
    expect(
      within(modal).getByText(
        '正文是预置的演示文稿：演示模式不调用模型，走查的是产物形态而不是文笔。',
      ),
    ).toBeInTheDocument();
    // 从模板区进来 ⇒ 不挂处方（弹窗里没有那张处方说明），默认已选中第一个模板（确定按钮可点）。
    expect(within(modal).queryByText('处方')).not.toBeInTheDocument();
    expect(
      within(modal).getByText('生成内容默认待人工审核，通过后才可对外发布（合规红线）。'),
    ).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: /确\s*认/ })).toBeEnabled();

    await user.click(within(modal).getByRole('button', { name: /确\s*认/ }));

    expect(
      await screen.findByText('已生成演示文稿，状态为待人工审核'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(dataRowCount(cardOf('已生成文稿'))).toBe(SEED_GENERATED_CONTENTS.length + 1),
    );
    // 🔴 新生成的那份：审核态是待人工审核，且明说没跑合规扫描。
    const contents = cardOf('已生成文稿');
    expect(within(contents).getAllByText('待人工审核')).toHaveLength(2);
    expect(within(contents).getAllByText('演示模式未执行合规扫描')).toHaveLength(1);
    // 新文稿不挂处方（从模板区进来的）。
    expect(within(contents).getAllByText('未关联处方')).toHaveLength(1);
  });

  it('人工审核：通过后状态翻「已通过」，且 🔴 不会补上合规扫描', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const contents = cardOf('已生成文稿');
    const row = within(contents)
      .getAllByRole('row')
      .find((entry) => entry.textContent?.includes(SEED_GENERATED_CONTENTS[0].title))!;
    await user.click(within(row).getByRole('button', { name: /通\s*过/ }));

    expect(await screen.findByText('已更新审核态')).toBeInTheDocument();
    await waitFor(() => {
      const after = within(cardOf('已生成文稿'))
        .getAllByRole('row')
        .find((entry) => entry.textContent?.includes(SEED_GENERATED_CONTENTS[0].title))!;
      expect(after.textContent).toContain('已通过');
      // 种子里它已经是 approved ⇒ 那一行的「通过」按钮消失、「打回待审」出现。
      expect(within(after).queryByRole('button', { name: /通\s*过/ })).not.toBeInTheDocument();
      expect(within(after).getByRole('button', { name: '打回待审' })).toBeInTheDocument();
    });
    // 🔴 人工通过 ≠ 合规扫过：那份演示文稿的说明仍要说"未执行合规扫描"。
    expect(screen.queryByText('演示模式未执行合规扫描')).not.toBeInTheDocument();
    expect(screen.getAllByText('已过合规扫描')).toHaveLength(2);
  });

  it('预览文稿：正文是预置演示文稿，且带同一句合规口径', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const contents = cardOf('已生成文稿');
    const row = within(contents)
      .getAllByRole('row')
      .find((entry) => entry.textContent?.includes(SEED_GENERATED_CONTENTS[0].title))!;
    await user.click(within(row).getByRole('button', { name: /预\s*览/ }));

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(SEED_GENERATED_CONTENTS[0].title)).toBeInTheDocument();
    expect(
      within(drawer).getByText(
        '正文是预置的演示文稿：演示模式不调用模型，走查的是产物形态而不是文笔。',
      ),
    ).toBeInTheDocument();
    expect(within(drawer).getByText('已过合规扫描')).toBeInTheDocument();
    // 正文原样落在 <pre> 里（不用 dangerouslySetInnerHTML：数据不是标记）。
    expect(drawer.querySelector('pre')?.textContent).toBe(SEED_GENERATED_CONTENTS[0].body_markdown);

    // 🔴 导出按钮在抽屉的 extra 上：待审文稿不能导出（规则 6），Word 另因桌面端能力置灰。
    const content = SEED_GENERATED_CONTENTS[0];
    expect(content.status).toBe('pending_review');
    expect(content.export_formats).toEqual(['markdown', 'html', 'docx']);
    expect(within(drawer).getByRole('button', { name: 'Markdown' })).toBeDisabled();
    expect(within(drawer).getByRole('button', { name: 'HTML' })).toBeDisabled();
    expect(within(drawer).getByText('只有审核通过的文稿才能导出；待审或已退回的文稿请先通过审核。')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Word' })).toBeDisabled();
    expect(
      within(drawer).getByText('Word 由桌面端提供，演示模式下不可用。'),
    ).toBeInTheDocument();
  });
});

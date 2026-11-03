/**
 * M4 解析与核查页的页面测试（走**演示假后端 + 真种子**，口径同 `pages/CollectionPage.test.tsx`）。
 *
 * # 这里钉的是**界面形态**
 * 筛选的 AND 语义、纠正的写路径、结办的状态机都在 `demo/handlers/insight.test.ts`。
 * 本文件只管它们在界面上**看得见**：
 * - 🔴 三句口径说明（样本子集 / 静态值 / 复核门槛）都在；
 * - 「一键纠正」真的把那条移出复核队列，并长出「已人工纠正」标签；
 * - 🔴 纠正与结办都**不重算**：置信度与事实准确率一动不动；
 * - 结办弹窗把「回答里的说法 vs 实体卡口径」并排摆出来（M4 验收点名要能定位的那组证据）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import InsightPage from './InsightPage';
import { resetDemoDb } from '../demo/db';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_COLLECTION_ROUNDS,
  SEED_LIVE_ROUND_ID,
} from '../demo/seed/collection-rounds';
import {
  SEED_ANSWER_INSIGHTS,
  SEED_FACT_CHECK_ISSUES,
  SEED_FACT_CHECK_SUMMARIES,
} from '../demo/seed/insights';
import { REVIEW_CONFIDENCE_FLOOR } from '../api/constants';
import { renderAtRoute } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/insight`;
const PATH = '/projects/:id/insight';

/** 第 2 轮的复核队列（handler 按 id 升序给 ⇒ 第一行就是这条）。 */
const REVIEW_QUEUE = SEED_ANSWER_INSIGHTS.filter(
  (insight) => insight.round_id === SEED_BASELINE_ROUND_ID && insight.needs_review,
).sort((left, right) => left.id.localeCompare(right.id));
const QUEUE_HEAD = REVIEW_QUEUE[0];
/** 第 2 轮里待处理的那条核查问题（资质说错那条已经在种子里结办过了）。 */
const OPEN_ISSUE = SEED_FACT_CHECK_ISSUES.find(
  (issue) => issue.round_id === SEED_BASELINE_ROUND_ID && issue.status === 'open',
)!;

function renderPage() {
  return renderAtRoute(<InsightPage />, PATH, ROUTE);
}

async function waitLoaded() {
  await screen.findByRole('heading', { name: '回答解析与事实核查' });
  await screen.findByText(SEED_COLLECTION_ROUNDS[3].label, {
    selector: '.ant-select-selection-item',
  });
}

/** 切到某一轮（页头那个选择器有 `aria-label`，与四个筛选器不会混）。 */
async function selectRound(user: ReturnType<typeof userEvent.setup>, roundId: string) {
  const round = SEED_COLLECTION_ROUNDS.find((entry) => entry.id === roundId)!;
  await user.click(screen.getByRole('combobox', { name: '选择轮次' }));
  const options = (await screen.findAllByTitle(round.label)).filter((element) =>
    element.hasAttribute('aria-selected'),
  );
  expect(options).toHaveLength(1);
  await user.click(options[0]);
}

/**
 * 解析结果表的数据行（`insights` tab 里那张表）。
 *
 * 🔴 剔掉 antd 的空表占位行（`.ant-table-placeholder`）：清空筛选结果后它还在，
 * 不剔就会把「0 条」数成「1 行」。
 */
function insightRows(): HTMLElement[] {
  const table = screen.getByRole('table');
  return within(table)
    .getAllByRole('row')
    .filter((row) => !row.classList.contains('ant-table-placeholder'))
    .slice(1);
}

/**
 * 按可访问名取筛选区里的那个 Select（`insight.filters.*Aria`）。
 *
 * 🔴 不用占位文案定位：选中之后占位就没了，用可访问名才与真实用户（含读屏）看到的一致。
 */
async function pickFilter(
  user: ReturnType<typeof userEvent.setup>,
  aria: string,
  option: string,
) {
  await user.click(screen.getByRole('combobox', { name: aria }));
  await user.click(await screen.findByTitle(option));
}

/** 汇总卡里那个 antd `Statistic` 的值（按标题定位：`2` 这类数字在页面上到处都有）。 */
function statisticValue(title: string): string {
  const statistic = screen
    .getAllByText(title)
    .map((hit) => hit.closest('.ant-statistic'))
    .find((node) => node !== null);
  expect(statistic, `找不到统计项「${title}」`).not.toBeNull();
  return (statistic!.querySelector('.ant-statistic-content-value')?.textContent ?? '').trim();
}

/** 展开解析结果的第一行（antd 的展开图标没有可用的可访问名 ⇒ 按 class 取）。 */
async function expandFirstRow(user: ReturnType<typeof userEvent.setup>) {
  const icon = insightRows()[0].querySelector('.ant-table-row-expand-icon');
  expect(icon, '那一行没有展开图标').not.toBeNull();
  await user.click(icon as HTMLElement);
}

beforeEach(() => {
  resetDemoDb();
});

describe('InsightPage · 解析结果', () => {
  it('默认选中最新一轮，🔴 三句口径说明都在', async () => {
    renderPage();
    await waitLoaded();

    expect(
      screen.getByText('演示数据只收录样本条目的解析结果与核查问题。'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('置信度、来源归类与准确率在演示模式下是预置静态值，不由前端重算。'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `置信度低于 ${REVIEW_CONFIDENCE_FLOOR.toFixed(2)} 的条目进人工复核队列。`,
      ),
    ).toBeInTheDocument();

    const live = SEED_ANSWER_INSIGHTS.filter(
      (insight) => insight.round_id === SEED_LIVE_ROUND_ID,
    );
    await waitFor(() => expect(insightRows()).toHaveLength(live.length));
  });

  it('切到第 2 轮：行数是种子里那一轮的条数，且没有裸枚举值上屏', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);

    const seeded = SEED_ANSWER_INSIGHTS.filter(
      (insight) => insight.round_id === SEED_BASELINE_ROUND_ID,
    );
    await waitFor(() => expect(insightRows()).toHaveLength(seeded.length));
    // 提及 / 情感 / 风险标记都查到了词典。
    expect(screen.queryByText('positive')).not.toBeInTheDocument();
    expect(screen.queryByText('suspected_hallucination')).not.toBeInTheDocument();
    expect(screen.getAllByText('待人工复核').length).toBeGreaterThan(0);
  });

  it('「只看未提及」筛选真的收窄了结果集', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);
    const seeded = SEED_ANSWER_INSIGHTS.filter(
      (insight) => insight.round_id === SEED_BASELINE_ROUND_ID,
    );
    await waitFor(() => expect(insightRows()).toHaveLength(seeded.length));

    await pickFilter(user, '按提及情况筛选', '只看未提及');

    const expected = seeded.filter((insight) => !insight.self_mentioned);
    await waitFor(() => expect(insightRows()).toHaveLength(expected.length));
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(seeded.length);
    expect(insightRows().every((row) => row.textContent?.includes('未提及'))).toBe(true);
  });

  it('展开一行：回答形态、引用来源与品牌提及明细都在', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);
    await waitFor(() => expect(insightRows().length).toBeGreaterThan(0));
    await expandFirstRow(user);

    expect(await screen.findByText('品牌提及明细')).toBeInTheDocument();
    expect(screen.getByText('回答形态:')).toBeInTheDocument();
    expect(screen.getByText('引用来源:')).toBeInTheDocument();
    // 提及明细表的表头查到了词典。
    expect(screen.getByText('在对比表里')).toBeInTheDocument();
    expect(screen.getByText('回答原文片段')).toBeInTheDocument();
  });
});

describe('InsightPage · 一键纠正', () => {
  it('纠正后移出复核队列、长出「已人工纠正」标签，且 🔴 置信度不重算', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);
    await pickFilter(user, '按复核状态筛选', '只看待复核');
    await waitFor(() => expect(insightRows()).toHaveLength(REVIEW_QUEUE.length));

    const row = insightRows()[0];
    expect(row.textContent).toContain(QUEUE_HEAD.prompt_text);
    expect(QUEUE_HEAD.needs_review).toBe(true);

    await user.click(within(row).getByRole('button', { name: /纠\s*正/ }));
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText('人工纠正')).toBeInTheDocument();
    // 🔴 弹窗里那句"不重算任何比率"必须显示。
    expect(
      within(modal).getByText(
        '纠正只改这一条的展示与证据行投影，不会重算任何比率（演示模式不做计算）。',
      ),
    ).toBeInTheDocument();
    // 那行是「问题原文」标签 + 值两个兄弟文本节点，整段匹配不到 ⇒ 用子串匹配。
    expect(within(modal).getByText(QUEUE_HEAD.prompt_text, { exact: false })).toBeInTheDocument();

    // 这条种子里本来就是「已提及」；不要关掉开关，否则位次/情感按语义必须一并清空。
    await user.type(within(modal).getByPlaceholderText('未进推荐清单则留空'), '2');
    await user.click(within(modal).getByRole('combobox'));
    await user.click(await screen.findByTitle('正面'));
    await user.click(within(modal).getByRole('button', { name: '提交纠正' }));

    expect(
      await screen.findByText('已记录人工纠正，本条已移出复核队列'),
    ).toBeInTheDocument();
    // 复核队列少了一条。
    await waitFor(() => expect(insightRows()).toHaveLength(REVIEW_QUEUE.length - 1));
    expect(
      insightRows().every((entry) => !entry.textContent?.includes(QUEUE_HEAD.prompt_text)),
    ).toBe(true);

    // 换到「已复核」那一档，能看到纠正的痕迹与**没变**的置信度。
    await pickFilter(user, '按复核状态筛选', '已复核');
    await waitFor(() => {
      const corrected = insightRows().filter((entry) =>
        entry.textContent?.includes(QUEUE_HEAD.prompt_text),
      );
      expect(corrected.length).toBeGreaterThan(0);
      const target = corrected.find((entry) =>
        entry.textContent?.includes('已人工纠正'),
      );
      expect(target, '纠正过的那一行没有长出「已人工纠正」标签').toBeDefined();
      // 三个字段都改了 ⇒ 三个标签都在。
      expect(target!.textContent).toContain('已人工纠正: 是否提及');
      expect(target!.textContent).toContain('已人工纠正: 推荐位次');
      expect(target!.textContent).toContain('已人工纠正: 情感倾向');
      // 🔴 置信度是模型的自评分，人工纠正不改它。
      expect(target!.textContent).toContain(QUEUE_HEAD.confidence.toFixed(2));
    });
  });

  it('推荐位次留空 ⇒ 照常提交（= 未进推荐清单），本条出复核队列', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);
    await pickFilter(user, '按复核状态筛选', '只看待复核');
    await waitFor(() => expect(insightRows()).toHaveLength(REVIEW_QUEUE.length));

    await user.click(within(insightRows()[0]).getByRole('button', { name: /纠\s*正/ }));
    const modal = await screen.findByRole('dialog');
    // InputNumber 带 min={1}，键入 0 会在失焦时被夹回 1 ⇒「位次非法」那一支界面上走不到，
    // 由后端契约兜住（`demo/handlers/insight.test.ts` 钉了 out_of_range）。界面这里走留空这支。
    const rank = within(modal).getByRole('spinbutton');
    // antd 的 InputNumber 是 `type="text"` + `role="spinbutton"`，jest-dom 读到的是字符串。
    expect(rank).toHaveValue(String(QUEUE_HEAD.self_rank));
    await user.clear(rank);
    await user.click(within(modal).getByRole('button', { name: '提交纠正' }));

    expect(await screen.findByText('已记录人工纠正，本条已移出复核队列')).toBeInTheDocument();
    await waitFor(() => expect(insightRows()).toHaveLength(REVIEW_QUEUE.length - 1));
  });
});

describe('InsightPage · 事实核查', () => {
  it('汇总四格 + 🔴 准确率静态口径说明 + 问题清单按种子渲染', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);
    await user.click(screen.getByRole('tab', { name: '事实核查' }));

    const summary = SEED_FACT_CHECK_SUMMARIES[SEED_BASELINE_ROUND_ID];
    expect(summary.fact_accuracy).toBe(0.84);
    await screen.findByText('事实准确率');
    expect(statisticValue('事实准确率')).toBe('84%');
    expect(statisticValue('已核查回答')).toBe(String(summary.checked_answers));
    expect(statisticValue('判为误报')).toBe(String(summary.false_positive_count));
    // 三类问题的条数（`说错了 9` / `说旧了 7` / `漏说了 11`）。
    expect(screen.getByText(`说错了 ${summary.by_kind.wrong}`)).toBeInTheDocument();
    expect(screen.getByText(`说旧了 ${summary.by_kind.outdated}`)).toBeInTheDocument();
    expect(screen.getByText(`漏说了 ${summary.by_kind.missing}`)).toBeInTheDocument();
    // 🔴 这句是"结办了但准确率没动"不像 bug 的唯一保障。
    expect(
      screen.getByText('准确率是采集时的静态口径：人工结办问题不会让它变化（演示模式不重算）。'),
    ).toBeInTheDocument();

    const issues = SEED_FACT_CHECK_ISSUES.filter(
      (issue) => issue.round_id === SEED_BASELINE_ROUND_ID,
    );
    const table = screen.getAllByRole('table').at(-1)!;
    expect(within(table).getAllByRole('row')).toHaveLength(issues.length + 1);
    // 三类问题、更正渠道与实体卡字段都查到了词典（没有裸枚举值）。
    expect(screen.queryByText('official_site')).not.toBeInTheDocument();
    // 🔴 换成 `differentiators`：`price_range` 那条核查本轮改指 `products`（报价并进产品，
    // spec 2026-10-01 · DR-60），种子里仍在的裸字段名是 `differentiators` / `cases`。
    expect(screen.queryByText('differentiators')).not.toBeInTheDocument();
  });

  it('结办一条问题：弹窗并排给出「回答里的说法 vs 实体卡口径」，提交后状态翻已更正', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);
    await user.click(screen.getByRole('tab', { name: '事实核查' }));
    await screen.findByText('事实准确率');

    const table = screen.getAllByRole('table').at(-1)!;
    const row = within(table)
      .getAllByRole('row')
      .find((entry) => entry.textContent?.includes(OPEN_ISSUE.answer_excerpt))!;
    expect(row).toBeDefined();
    expect(row.textContent).toContain('待处理');

    await user.click(within(row).getByRole('button', { name: '标为已更正' }));
    const modal = await screen.findByRole('dialog');
    expect(within(modal).getByText('结办')).toBeInTheDocument();
    // M4 验收点名要能定位的那组证据：回答原文 vs 实体卡字段。
    expect(within(modal).getByText(OPEN_ISSUE.answer_excerpt)).toBeInTheDocument();
    expect(within(modal).getByText(OPEN_ISSUE.entity_value)).toBeInTheDocument();
    await user.type(
      within(modal).getByPlaceholderText('写清楚去哪儿改、改成了什么（可选）'),
      'updated the spec page',
    );
    await user.click(within(modal).getByRole('button', { name: /确\s*认/ }));

    expect(await screen.findByText('已更新核查问题状态')).toBeInTheDocument();
    await waitFor(() => {
      const after = within(screen.getAllByRole('table').at(-1)!)
        .getAllByRole('row')
        .find((entry) => entry.textContent?.includes(OPEN_ISSUE.answer_excerpt))!;
      expect(after.textContent).toContain('已更正');
      // 已更正之后那一行只剩「标为误报 / 重新打开」。
      expect(within(after).queryByRole('button', { name: '标为已更正' })).not.toBeInTheDocument();
      expect(within(after).getByRole('button', { name: '重新打开' })).toBeInTheDocument();
    });
    // 🔴 结办了也不会让准确率变化（demo 不重算）。
    expect(statisticValue('事实准确率')).toBe('84%');
  });

  it('进行中的第 4 轮：核查汇总照样有（种子里四轮都预置了）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await user.click(screen.getByRole('tab', { name: '事实核查' }));

    const summary = SEED_FACT_CHECK_SUMMARIES[SEED_LIVE_ROUND_ID];
    await screen.findByText('已核查回答');
    expect(statisticValue('已核查回答')).toBe(String(summary.checked_answers));
    expect(
      screen.queryByText('这一轮没有可发布的核查汇总（样本不足时不出准确率）。'),
    ).not.toBeInTheDocument();
  });

  it('从核查问题下钻到原始证据（与采集页共用同一个抽屉）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);
    await user.click(screen.getByRole('tab', { name: '事实核查' }));
    await screen.findByText('事实准确率');

    const table = screen.getAllByRole('table').at(-1)!;
    const row = within(table)
      .getAllByRole('row')
      .find((entry) => entry.textContent?.includes(OPEN_ISSUE.answer_excerpt))!;
    await user.click(within(row).getByRole('button', { name: /看\s*证\s*据|看证据/ }));

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('证据详情')).toBeInTheDocument();
    expect(within(drawer).getByText(OPEN_ISSUE.prompt_text)).toBeInTheDocument();
    expect(
      within(drawer).getByText('演示数据未包含截图；真后端会把截图与回答一起留存。'),
    ).toBeInTheDocument();
  });
});

describe('InsightPage · 轮次查询失败不被吞掉', () => {
  it('collection_board 失败时保留页头并显示稳定错误码，而不是空表', async () => {
    renderAtRoute(
      <InsightPage />,
      PATH,
      '/projects/00000000-0000-4000-8000-0000000000ff/insight',
    );

    expect(await screen.findByRole('heading', { name: '回答解析与事实核查' })).toBeInTheDocument();
    expect(await screen.findByText(/项目不存在/)).toBeInTheDocument();
    expect(screen.queryByText('没有符合筛选条件的解析结果')).not.toBeInTheDocument();
  });
});

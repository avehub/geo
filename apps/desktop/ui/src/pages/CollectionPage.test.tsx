/**
 * M3 采集页的页面测试（走**演示假后端 + 真种子**，不是逐命令 stub）。
 *
 * # 为什么走 demo 后端
 * 与 `pages/en-us-page-residual.test.tsx` 同一口径：把 `api/runtime` mock 成 `'demo'`，
 * `api/client.ts` 就会把全部命令分派给 `demo/backend.ts` ⇒ 页面、`api/collection.ts` 的具名
 * wrapper（**args 键名在这里被真分派覆盖**）、handler、种子四层一起走一遍，
 * 与产品负责人在 `mise run web` 里看到的是同一个数据面。
 *
 * # 这里钉的是**界面形态**，不是 handler 行为
 * handler 的算术、幂等与错误码在 `demo/handlers/collection.test.ts`；本文件只管：
 * - 默认选中最新一轮，且"进行中"这一态的提示与空状态都对；
 * - 🔴 三句必须显示的口径说明（样本子集 / 静态值 / 演示不真跑）都在页面上；
 * - 失败任务能就地重跑并长出「看证据」入口；
 * - 排一轮之后界面切到新轮次，停在「排队中」且队列与引擎汇总都是空的。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CollectionPage from './CollectionPage';
import * as collection from '../api/collection';
import { IpcRequestError } from '../api/client';
import { resetDemoDb } from '../demo/db';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_COLLECTION_ROUNDS,
  SEED_COLLECTION_TASKS,
  SEED_ENGINE_RUNS,
  SEED_LIVE_ROUND_ID,
  SEED_USAGE_BOARD,
} from '../demo/seed/collection-rounds';
import { SEED_COLLECTION_RECORDS } from '../demo/seed/collection-records-retest';
import { renderAtRoute } from '../test/render';

// `client.ts` 只从 `./runtime` 取 `runtime` 这一个绑定（照 `en-us-page-residual.test.tsx` 的做法）。
vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/collection`;
const PATH = '/projects/:id/collection';

/** 种子里那条可重跑的失败任务（元宝 / 浏览器自动化 / 被拦截）。 */
const RETRYABLE_TASK = SEED_COLLECTION_TASKS.find(
  (task) => task.id === 'demo-task-live-004',
)!;
/** 第 2 轮里成功且有证据的那条（用来走下钻）。 */
const TASK_WITH_RECORD = SEED_COLLECTION_TASKS.find(
  (task) => task.id === 'demo-task-baseline-001',
)!;

function renderPage() {
  return renderAtRoute(<CollectionPage />, PATH, ROUTE);
}

/** 按卡片标题取那张卡（antd 的 Card head 里就是标题文本）。 */
function cardOf(title: string): HTMLElement {
  const card = screen.getByText(title).closest('.ant-card');
  expect(card, `找不到卡片「${title}」`).not.toBeNull();
  return card as HTMLElement;
}

/**
 * 页面加载完。
 *
 * ⚠ 这一页是**两个往返**：`collection_board`（轮次选择器的选项）与 `collection_round_get`
 * （选中那轮的详情）。只等标题或只等选择器回显，都会落在「详情还没到 ⇒ 卡片里是空状态」
 * 那个窗口里（本轮实测踩过）。所以第三个 `findByText` 等的是详情区才有的字段标签。
 */
function sectionOf(title: string): HTMLElement {
  const section = screen.getByText(title).closest('section');
  expect(section, `找不到区块「${title}」`).not.toBeNull();
  return section as HTMLElement;
}

async function waitLoaded() {
  await screen.findByRole('heading', { name: '多引擎采集' });
  await screen.findByText(SEED_COLLECTION_ROUNDS[3].label);
  await screen.findByText('计划查询');
}

/** 切到某一轮：开轮次选择器 → 点那条选项（选项带 `aria-selected`，回显那条没有）。 */
async function selectRound(user: ReturnType<typeof userEvent.setup>, roundId: string) {
  const round = SEED_COLLECTION_ROUNDS.find((entry) => entry.id === roundId);
  expect(round).toBeDefined();

  await user.click(within(cardOf('采集轮次')).getByRole('combobox'));
  const options = (await screen.findAllByTitle(new RegExp(round!.label))).filter((element) =>
    element.hasAttribute('aria-selected'),
  );
  expect(options, `下拉里没有「${round!.label}」这一项`).toHaveLength(1);
  await user.click(options[0]);
}

/** 某张表的数据行数（去掉表头那一行）。 */
function dataRowCount(table: HTMLElement): number {
  return within(table).getAllByRole('row').length - 1;
}

beforeEach(() => {
  resetDemoDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CollectionPage · 看板与轮次', () => {
  it('默认选中最新一轮（进行中）：running 提示 + 该轮任务队列 + 该轮引擎汇总', async () => {
    renderPage();
    await waitLoaded();

    expect(screen.getByText('采集进行中，下面的数字还会继续变化。')).toBeInTheDocument();

    const liveTasks = SEED_COLLECTION_TASKS.filter((task) => task.round_id === SEED_LIVE_ROUND_ID);
    expect(dataRowCount(cardOf('任务队列'))).toBe(liveTasks.length);
    expect(
      dataRowCount(cardOf('各引擎执行情况')),
    ).toBe(SEED_ENGINE_RUNS[SEED_LIVE_ROUND_ID].length);
    // 进行中那轮只有已完成部分的证据（3 条），不是全量。
    expect(dataRowCount(cardOf('原始证据'))).toBe(
      SEED_COLLECTION_RECORDS.filter((record) => record.round_id === SEED_LIVE_ROUND_ID).length,
    );
  });

  it('🔴 三句必须显示的口径说明都在页面上（样本子集 / 静态值 / 浏览器通道记账）', async () => {
    renderPage();
    await waitLoaded();

    expect(
      screen.getByText('演示数据每轮只收录若干条样本任务与证据，不代表全量采集结果。'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('成功率、耗时与 token 用量在演示模式下是预置静态值，不由前端重算。'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('浏览器自动化通道没有 token 记账，耗时也明显高于官方 API。'),
    ).toBeInTheDocument();
  });

  it('用量看板：累计查询、硬配额进度与 4 轮明细都来自种子', async () => {
    renderPage();
    await waitLoaded();

    const usage = cardOf('用量看板');
    expect(within(usage).getByText(`累计查询: ${SEED_USAGE_BOARD.total_queries}`)).toBeInTheDocument();
    expect(within(usage).getByText('已用 1075 / 1200')).toBeInTheDocument();
    // 未超额 ⇒ 不显示那条红色告警。
    expect(SEED_USAGE_BOARD.quota_exceeded).toBe(false);
    expect(within(usage).queryByText('已超出硬配额，采集已自动暂停。')).not.toBeInTheDocument();
    expect(dataRowCount(usage)).toBe(SEED_USAGE_BOARD.rows.length);
    expect(
      within(usage).getByText('金额估算不在 MVP 范围内：这里只记查询次数与 token 用量。'),
    ).toBeInTheDocument();
  });

  it('切到第 2 轮：7 家引擎的执行汇总 + 8 条证据 + 成功率 97%', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await selectRound(user, SEED_BASELINE_ROUND_ID);

    await waitFor(() =>
      expect(dataRowCount(cardOf('各引擎执行情况'))).toBe(
        SEED_ENGINE_RUNS[SEED_BASELINE_ROUND_ID].length,
      ),
    );
    expect(dataRowCount(cardOf('原始证据'))).toBe(
      SEED_COLLECTION_RECORDS.filter((record) => record.round_id === SEED_BASELINE_ROUND_ID).length,
    );
    const round = SEED_COLLECTION_ROUNDS.find((entry) => entry.id === SEED_BASELINE_ROUND_ID)!;
    const detail = cardOf('采集轮次');
    expect(within(detail).getByText('97%')).toBeInTheDocument();
    expect(within(detail).getByText(String(round.planned_queries))).toBeInTheDocument();
    // 进行中那条提示随之消失。
    expect(
      screen.queryByText('采集进行中，下面的数字还会继续变化。'),
    ).not.toBeInTheDocument();
  });
});

describe('CollectionPage · 矩阵与筛选解耦', () => {
  it('证据表按引擎筛选后，矩阵仍统计整轮记录（不跟着筛选缩水）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await screen.findByText('引擎 × 意图覆盖矩阵');
    const matrix = sectionOf('引擎 × 意图覆盖矩阵');
    const liveEngines = new Set(
      SEED_COLLECTION_RECORDS.filter((record) => record.round_id === SEED_LIVE_ROUND_ID).map(
        (record) => record.engine,
      ),
    );
    expect(dataRowCount(matrix)).toBe(liveEngines.size);

    const evidence = cardOf('原始证据');
    await user.click(within(evidence).getAllByRole('combobox')[0]);
    const options = (await screen.findAllByTitle('豆包')).filter((element) =>
      element.hasAttribute('aria-selected'),
    );
    expect(options).toHaveLength(1);
    await user.click(options[0]);

    await waitFor(() =>
      expect(
        SEED_COLLECTION_RECORDS.filter(
          (record) => record.round_id === SEED_LIVE_ROUND_ID && record.engine === 'doubao',
        ),
      ).toHaveLength(dataRowCount(evidence)),
    );
    // 证据表已被筛成 1 行，但矩阵仍是整轮的 3 个引擎（重新取节点，避免拿到旧引用）。
    await waitFor(() => expect(dataRowCount(sectionOf('引擎 × 意图覆盖矩阵'))).toBe(liveEngines.size));
    expect(within(sectionOf('引擎 × 意图覆盖矩阵')).getByText('Kimi')).toBeInTheDocument();
  });
});

describe('CollectionPage · 子查询错误不静默', () => {
  it('证据列表失败时在区块内出错误提示，页面标题仍在', async () => {
    const spy = vi
      .spyOn(collection, 'collectionRecordList')
      .mockRejectedValue(new IpcRequestError({ code: 'ipc/unknown_command', message: 'ipc/unknown_command', params: {} }));
    renderPage();
    await waitLoaded();

    await waitFor(() =>
      expect(
        screen.getAllByRole('alert').some((element) => element.classList.contains('ant-alert-error')),
      ).toBe(true),
    );
    expect(screen.getByRole('heading', { name: '多引擎采集' })).toBeInTheDocument();
    expect(screen.queryByText('没有符合筛选条件的证据。')).not.toBeInTheDocument();
    spy.mockRestore();
  });

  it('轮次详情失败时显示错误提示，而不是把空任务列表当成正常空态', async () => {
    const spy = vi
      .spyOn(collection, 'collectionRoundGet')
      .mockRejectedValue(new IpcRequestError({ code: 'ipc/unknown_command', message: 'ipc/unknown_command', params: {} }));
    renderPage();
    await screen.findByRole('heading', { name: '多引擎采集' });
    await screen.findByText(SEED_COLLECTION_ROUNDS[3].label);

    await waitFor(() =>
      expect(
        screen.getAllByRole('alert').some((element) => element.classList.contains('ant-alert-error')),
      ).toBe(true),
    );
    expect(screen.getByRole('heading', { name: '多引擎采集' })).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('CollectionPage · 失败任务重跑', () => {
  it('重跑成功：提示 + 状态翻成功 + 尝试次数 +1 + 长出「看证据」入口', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const tasks = cardOf('任务队列');
    const row = within(tasks)
      .getAllByRole('row')
      .find((entry) => entry.textContent?.includes(RETRYABLE_TASK.prompt_text));
    expect(row, '任务队列里找不到那条失败任务').toBeDefined();
    // 失败原因与尝试次数都摆在这一行上。
    expect(row!.textContent).toContain('被拦截');
    expect(row!.textContent).toContain(String(RETRYABLE_TASK.attempt));

    await user.click(within(row!).getByRole('button', { name: /重\s*跑/ }));

    expect(await screen.findByText('重跑完成，证据与解析结果已入库')).toBeInTheDocument();
    await waitFor(() => {
      const after = within(cardOf('任务队列'))
        .getAllByRole('row')
        .find((entry) => entry.textContent?.includes(RETRYABLE_TASK.prompt_text));
      expect(after!.textContent).toContain('成功');
      expect(after!.textContent).toContain(String(RETRYABLE_TASK.attempt + 1));
      expect(within(after!).getByRole('button', { name: '看证据' })).toBeInTheDocument();
      // 重跑之后不再有「重跑」按钮（状态已不是 failed）。
      expect(within(after!).queryByRole('button', { name: /重\s*跑/ })).not.toBeInTheDocument();
    });
  });

  it('🔴 重跑之后轮次的 completed/failed/成功率**不重算**（demo 不做记账口径）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const before = cardOf('采集轮次').textContent;
    const round = SEED_COLLECTION_ROUNDS.find((entry) => entry.id === SEED_LIVE_ROUND_ID)!;
    expect(before).toContain(String(round.completed_queries));

    const row = within(cardOf('任务队列'))
      .getAllByRole('row')
      .find((entry) => entry.textContent?.includes(RETRYABLE_TASK.prompt_text))!;
    await user.click(within(row).getByRole('button', { name: /重\s*跑/ }));
    await screen.findByText('重跑完成，证据与解析结果已入库');

    await waitFor(() => {
      const detail = cardOf('采集轮次');
      expect(detail.textContent).toContain(String(round.completed_queries));
      expect(detail.textContent).toContain(String(round.failed_queries));
      expect(detail.textContent).toContain('97%');
    });
  });
});

describe('CollectionPage · 排一轮采集（演示模式不真跑）', () => {
  it('提交后切到新轮次：停在「排队中」，队列与引擎汇总都是空的', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    // 带图标的按钮，可访问名会含图标自己的 aria-label ⇒ 用正则而不是全等。
    await user.click(screen.getByRole('button', { name: /排一轮采集/ }));
    const modal = await screen.findByRole('dialog');
    // 弹窗里那句「演示模式不发请求」必须显示。
    expect(
      within(modal).getByText(
        '演示模式不发请求：新轮次会停在「排队中」，任务队列为空。',
      ),
    ).toBeInTheDocument();
    expect(within(modal).getByPlaceholderText('留空则沿用品库名')).toBeInTheDocument();

    await user.click(within(modal).getByRole('button', { name: /排\s*队/ }));

    expect(await screen.findByText(/已排队：/)).toBeInTheDocument();
    await screen.findByText(
      '已排队，等待执行。演示模式不会真的调用引擎，这一轮会停在「排队中」。',
    );
    // 🔴 demo 只排队不执行：两个空状态都在。
    expect(screen.getByText('这一轮还没有任务。')).toBeInTheDocument();
    expect(screen.getByText('这一轮还没有引擎执行记录。')).toBeInTheDocument();
    // 计划查询 = 题目数 × 引擎数（默认全选 7 家），完成与失败都是 0。
    const detail = cardOf('采集轮次');
    expect(within(detail).getByText('0%')).toBeInTheDocument();
    expect(detail.textContent).toContain('排队中');
  });
});

describe('CollectionPage · 证据下钻', () => {
  it('从任务行打开抽屉：回答全文 + 引用链接 + 🔴 截图恒为空状态', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);

    await waitFor(() =>
      expect(dataRowCount(cardOf('各引擎执行情况'))).toBe(
        SEED_ENGINE_RUNS[SEED_BASELINE_ROUND_ID].length,
      ),
    );
    const row = within(cardOf('任务队列'))
      .getAllByRole('row')
      .find((entry) => entry.textContent?.includes(TASK_WITH_RECORD.prompt_text))!;
    await user.click(within(row).getByRole('button', { name: '看证据' }));

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('证据详情')).toBeInTheDocument();
    expect(within(drawer).getByText(TASK_WITH_RECORD.prompt_text)).toBeInTheDocument();
    expect(within(drawer).getByRole('heading', { name: '回答全文' })).toBeInTheDocument();
    // 「引用链接」既是小节标题又是表头 ⇒ 按 heading 取，避免多重命中。
    expect(within(drawer).getByRole('heading', { name: '引用链接' })).toBeInTheDocument();
    // 🔴 demo 不抓网页也不截图 ⇒ 这一格永远是那句说明，编一个路径就是假证据。
    expect(
      within(drawer).getByText('演示数据未包含截图；真后端会把截图与回答一起留存。'),
    ).toBeInTheDocument();
  });
});

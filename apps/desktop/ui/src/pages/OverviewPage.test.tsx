/**
 * 项目概览页的**界面形态**（走演示假后端 + 真种子，口径同 `DiagnosisPage.test.tsx`）。
 *
 * 这里钉的是「一屏能不能被读懂」，不是指标自洽（那在 `api/overview-compose.test.ts`
 * 与 `demo/seed.test.ts`）：
 * - 默认落在**最近一轮有结论的**第 3 轮，而不是还在跑的第 4 轮；
 * - 四个头号 KPI 带环比与区间；竞品对照给「差多少」；风险按来源汇总 + 优先项；
 * - 行动给进度与未完成 Top；切到样本不足那轮要出现降级说明且不给环比；
 * - 没有任何结论轮次时是空态 + 去采集，而不是报错。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OverviewPage from './OverviewPage';
import { getDemoDb, resetDemoDb } from '../demo/db';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_COLLECTION_ROUNDS,
  SEED_LIVE_ROUND_ID,
  SEED_RETEST_ROUND_ID,
  SEED_TRIAL_ROUND_ID,
} from '../demo/seed/collection-rounds';
import { SEED_ANSWER_INSIGHTS, SEED_FACT_CHECK_ISSUES } from '../demo/seed/insights';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import { renderAtRoute } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/overview`;
const PATH = '/projects/:id/overview';
const CONCLUSIVE_IDS = [SEED_TRIAL_ROUND_ID, SEED_BASELINE_ROUND_ID, SEED_RETEST_ROUND_ID];

function renderPage() {
  return renderAtRoute(<OverviewPage />, PATH, ROUTE);
}

async function waitLoaded() {
  await screen.findByRole('heading', { name: '项目概览' });
  await screen.findByText(SEED_COLLECTION_ROUNDS[2].label);
}

/** antd `Statistic` 的值（按标题定位；避免与风险卡里的同数字打架）。 */
function statisticValue(title: string): string {
  const statistic = screen
    .getAllByText(title)
    .map((hit) => hit.closest('.ant-statistic'))
    .find((node) => node !== null);
  expect(statistic, `找不到指标「${title}」`).not.toBeNull();
  return (
    statistic!.querySelector('.ant-statistic-content-value')?.textContent ?? ''
  ).trim();
}

const reviewCount = SEED_ANSWER_INSIGHTS.filter(
  (insight) => insight.needs_review && CONCLUSIVE_IDS.includes(insight.round_id),
).reduce((sum) => sum + 1, 0);
const openFactCount = SEED_FACT_CHECK_ISSUES.filter(
  (issue) => issue.status === 'open' && CONCLUSIVE_IDS.includes(issue.round_id),
).length;

beforeEach(() => {
  resetDemoDb();
});

describe('OverviewPage · 默认落在最近有结论的一轮', () => {
  it('四个头号 KPI、环比、区间与样本量一次到位', async () => {
    renderPage();
    await waitLoaded();

    expect(statisticValue('品牌覆盖')).toBe('55%');
    expect(statisticValue('GEO 体检总分')).toBe('55');
    expect(statisticValue('提及份额')).toBe('38%');
    expect(statisticValue('事实准确率')).toBe('91%');

    expect(screen.getByText('+13 个百分点')).toBeInTheDocument();
    expect(screen.getByText('+11')).toBeInTheDocument();
    expect(screen.getByText('+6 个百分点')).toBeInTheDocument();
    expect(screen.getByText('+7 个百分点')).toBeInTheDocument();
    expect(screen.getByText('±5 个百分点')).toBeInTheDocument();
    expect(screen.getByText('±4 分')).toBeInTheDocument();
    expect(screen.getByText(/62 道题/)).toBeInTheDocument();
    expect(screen.getAllByText('样本充足').length).toBeGreaterThan(0);
  });

  it('进行中的第 4 轮不出现在轮次选择器里', async () => {
    renderPage();
    await waitLoaded();

    const live = SEED_COLLECTION_ROUNDS.find((round) => round.id === SEED_LIVE_ROUND_ID)!;
    expect(screen.queryByText(live.label)).not.toBeInTheDocument();
  });

  it('竞品对照直接说清「差多少」：清源覆盖已反超 1 个百分点', async () => {
    renderPage();
    await waitLoaded();

    expect(screen.getByText(/落后.*清源环保.*1 个百分点/)).toBeInTheDocument();
    expect(screen.getByText(/同框题目 9 道/)).toBeInTheDocument();
  });

  it('风险按来源汇总，并给出优先处理项', async () => {
    renderPage();
    await waitLoaded();

    expect(screen.getByText('未读告警 2')).toBeInTheDocument();
    expect(screen.getByText(`事实核查待处理 ${openFactCount}`)).toBeInTheDocument();
    expect(screen.getByText(`待复核解析 ${reviewCount}`)).toBeInTheDocument();
    expect(screen.getByText(/说错了 1/)).toBeInTheDocument();
    expect(screen.getByText(/说旧了 3/)).toBeInTheDocument();
    expect(screen.getByText(/漏说了 2/)).toBeInTheDocument();

    // 优先项：critical 的「说错了」在前，告警「竞品反超」紧随其后。
    expect(screen.getAllByText('说错了').length).toBeGreaterThan(0);
    expect(screen.getAllByText('竞品反超').length).toBeGreaterThan(0);
  });

  it('下一步给进度与未完成 Top，名次照后端', async () => {
    renderPage();
    await waitLoaded();

    expect(screen.getByText('已完成 5 / 10')).toBeInTheDocument();
    expect(screen.getByText('补 3 个高价值引用域名：行业媒体技术稿、百科词条、垂直社区问答')).toBeInTheDocument();
    expect(screen.getByText(/生成术语页/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '去行动中心' })).toBeInTheDocument();
  });
});

describe('OverviewPage · P1 站外对账 / 交付进度 / 引擎差异', () => {
  it('站外对账：两个面各自合计，区间收敛到头条的截至日，参与源与旗标齐备', async () => {
    renderPage();
    await waitLoaded();

    await screen.findByText('站外数据对账');
    expect(await screen.findByText('20,090')).toBeInTheDocument();
    expect(screen.getByText('898')).toBeInTheDocument();
    expect(screen.getByText('参与源没有共同的时间区间，合计仅作量级参考。')).toBeInTheDocument();
    expect(screen.getAllByText(/头条搜索站长平台/).length).toBeGreaterThan(0);
    expect(screen.getByText('参与源 6')).toBeInTheDocument();
    expect(screen.getByText('含采样数据')).toBeInTheDocument();
    expect(screen.getByText('站内分析已排除')).toBeInTheDocument();
  });

  it('交付进度：文章评审队列与官网补丁台账的计数', async () => {
    renderPage();
    await waitLoaded();

    await screen.findByText('交付进度');
    expect(screen.getByText('待审核 2')).toBeInTheDocument();
    expect(screen.getByText('已通过 2')).toBeInTheDocument();
    expect(screen.getByText('已打回 1')).toBeInTheDocument();
    expect(screen.getByText('已发布 6')).toBeInTheDocument();
    expect(screen.getByText('草案 1')).toBeInTheDocument();
    expect(screen.getByText('已撤回 1')).toBeInTheDocument();
  });

  it('引擎差异：最认可 Kimi，最易说错腾讯元宝', async () => {
    renderPage();
    await waitLoaded();

    expect(await screen.findByText('最认可：Kimi 覆盖 63%')).toBeInTheDocument();
    expect(screen.getByText('最易说错：腾讯元宝 事实错误率 18%')).toBeInTheDocument();
    expect(screen.getByText('认知层 78%')).toBeInTheDocument();
    expect(screen.getByText('推荐层 67%')).toBeInTheDocument();
    expect(screen.getByText('决策层 50%')).toBeInTheDocument();
  });
});

describe('OverviewPage · 轮次切换与样本纪律', () => {
  it('切到第 1 轮：样本不足提示出现，环比消失', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('combobox'));
    const trial = SEED_COLLECTION_ROUNDS.find((round) => round.id === SEED_TRIAL_ROUND_ID)!;
    const options = (await screen.findAllByTitle(trial.label)).filter((element) =>
      element.hasAttribute('aria-selected'),
    );
    expect(options).toHaveLength(1);
    await user.click(options[0]);

    await waitFor(() => expect(statisticValue('品牌覆盖')).toBe('20%'));
    expect(screen.getByText(/样本不足（<30 条）/)).toBeInTheDocument();
    expect(screen.queryByText('+13 个百分点')).not.toBeInTheDocument();
    expect(screen.queryByText('+11')).not.toBeInTheDocument();
  });
});

describe('OverviewPage · 空态是正常形态', () => {
  it('一条结论轮次都没有：给空态与去采集入口，行动区照常显示', async () => {
    getDemoDb().collectionRounds = [];
    renderPage();

    expect(await screen.findByRole('heading', { name: '项目概览' })).toBeInTheDocument();
    expect(await screen.findByText('还没有可用的结论轮次')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '去多引擎采集' })).toBeInTheDocument();
    // 项目级待办不依赖轮次结论，仍然要能看到。
    expect(screen.getByText('已完成 5 / 10')).toBeInTheDocument();
  });
});

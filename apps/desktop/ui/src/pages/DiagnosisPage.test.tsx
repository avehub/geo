/**
 * M5 诊断页的页面测试（走**演示假后端 + 真种子**，口径同 `pages/CollectionPage.test.tsx`）。
 *
 * # 这里钉的是**界面形态**
 * 分数是不是自洽、告警真值在哪，都在 `demo/seed.test.ts` 与 `demo/handlers/diagnosis.test.ts`。
 * 本文件只管：
 * - 🔴 「这一轮没有体检结果」是**正常形态**：进行中那轮四个区块各自显示空状态，页面不报错；
 *   而引擎差异**照常渲染**（它是已完成部分的即时口径）；
 * - 样本不足那一轮照样给数字，但 `SampleSizeAlert` 必须把降级说明摆出来；
 * - 口径说明（静态值 / 区间 / 同框分母）都在数字旁边；
 * - 标记已读能就地生效，且**不动任何分数**。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DiagnosisPage from './DiagnosisPage';
import { resetDemoDb } from '../demo/db';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_COLLECTION_ROUNDS,
  SEED_TRIAL_ROUND_ID,
} from '../demo/seed/collection-rounds';
import {
  SEED_ALERTS,
  SEED_COMPETITOR_MATRICES,
  SEED_DIAGNOSIS_OVERVIEWS,
  SEED_ENGINE_SCORES,
  SEED_INTENT_FUNNELS,
  SEED_TREND,
} from '../demo/seed/diagnosis';
import { renderAtRoute } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/diagnosis`;
const PATH = '/projects/:id/diagnosis';

/** 种子里未读的那两条（第 3 轮）：`alertsOf` 按 raised_at DESC ⇒ 004 在最前面。 */
const UNACKED_ALERT = SEED_ALERTS.find((alert) => alert.id === 'demo-alert-004')!;

function renderPage() {
  return renderAtRoute(<DiagnosisPage />, PATH, ROUTE);
}

async function waitLoaded() {
  await screen.findByRole('heading', { name: '诊断与归因' });
  // 轮次清单是第一个往返（`collection_board`），等选择器回显最新那轮。
  await screen.findByText(SEED_COLLECTION_ROUNDS[3].label);
}

/** 切到某一轮（本页只有一个 Select ⇒ 直接按 combobox 取）。 */
async function selectRound(user: ReturnType<typeof userEvent.setup>, roundId: string) {
  const round = SEED_COLLECTION_ROUNDS.find((entry) => entry.id === roundId);
  expect(round).toBeDefined();

  await user.click(screen.getByRole('combobox'));
  const options = (await screen.findAllByTitle(round!.label)).filter((element) =>
    element.hasAttribute('aria-selected'),
  );
  expect(options).toHaveLength(1);
  await user.click(options[0]);
}

/** 等到某一轮的体检结果真的上屏（四个视图都取回来了）。 */
async function waitOverview(roundId: string) {
  const overview = SEED_DIAGNOSIS_OVERVIEWS[roundId];
  await screen.findByText('GEO 体检总分');
  await waitFor(() =>
    expect(statisticValue('GEO 体检总分')).toBe(String(overview.total_score)),
  );
}

/**
 * antd `Statistic` 的值（按标题定位，避免与表格里的同数字打架）。
 *
 * ⚠ 用 `getAllByText` 而不是 `getByText`：`Brand Coverage` 这类标题在页面上同时是
 * 头号 KPI 的标题、趋势图的图例与告警的指标标签 ⇒ 只取「确实挂在 `.ant-statistic` 里」那一个。
 */
function statisticOf(title: string): HTMLElement {
  const statistic = screen
    .getAllByText(title)
    .map((hit) => hit.closest('.ant-statistic'))
    .find((node) => node !== null);
  expect(statistic, `找不到指标「${title}」`).not.toBeNull();
  return statistic as HTMLElement;
}

function statisticValue(title: string): string {
  return (
    statisticOf(title).querySelector('.ant-statistic-content-value')?.textContent ?? ''
  ).trim();
}

/** 某张卡片里那张表的数据行数（去掉表头）。 */
function rowsOfCard(title: string): number {
  const card = screen.getByText(title).closest('.ant-card');
  expect(card, `找不到卡片「${title}」`).not.toBeNull();
  return within(card as HTMLElement).getAllByRole('row').length - 1;
}

beforeEach(() => {
  resetDemoDb();
});

describe('DiagnosisPage · 「这一轮没有体检结果」是正常形态', () => {
  it('默认选中进行中那轮：体检 / 竞品 / 漏斗都是空状态，页面不报错', async () => {
    renderPage();
    await waitLoaded();

    expect(
      await screen.findByText('这一轮还没有体检结果：采集未完成或样本不足时不出结论。'),
    ).toBeInTheDocument();
    // 体检首屏没有 ⇒ 这四个区块也不渲染。
    expect(screen.queryByText('GEO 体检总分')).not.toBeInTheDocument();
    expect(screen.queryByText('五维得分')).not.toBeInTheDocument();
    expect(screen.queryByText('告警')).not.toBeInTheDocument();
    expect(screen.getByText('这一轮没有竞品对标数据。')).toBeInTheDocument();
    expect(screen.getByText('这一轮没有漏斗数据。')).toBeInTheDocument();
    // 🔴 但引擎差异**有**（已完成部分的即时口径），照常渲染 7 家。
    expect(rowsOfCard('引擎差异')).toBe(SEED_ENGINE_SCORES[SEED_COLLECTION_ROUNDS[3].id].length);
    expect(
      screen.getByText('按事实错误率倒序：先看哪些引擎更容易把本品牌说错。'),
    ).toBeInTheDocument();
  });

  it('口径说明必须显示：静态值不重算 + 比率是区间不是单点', async () => {
    renderPage();
    await waitLoaded();

    expect(
      screen.getByText('总分与各维得分在演示模式下是预置静态值，不由前端按权重重算。'),
    ).toBeInTheDocument();
  });
});

describe('DiagnosisPage · 体检首屏（第 2 轮 · 基线体检）', () => {
  it('总分、头号 KPI、五维、趋势、告警、竞品、漏斗、引擎一次到位', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);
    await waitOverview(SEED_BASELINE_ROUND_ID);

    const overview = SEED_DIAGNOSIS_OVERVIEWS[SEED_BASELINE_ROUND_ID];
    expect(statisticValue('Brand Coverage')).toBe('42%');
    expect(statisticValue('Share of Voice')).toBe('32%');
    expect(statisticValue('事实准确率')).toBe('84%');
    expect(statisticValue('被引域名（去重）')).toBe(String(overview.distinct_cited_domains));
    expect(screen.getByText('满分 100')).toBeInTheDocument();
    expect(screen.getByText('±5')).toBeInTheDocument();

    expect(rowsOfCard('五维得分')).toBe(overview.dimensions.length);
    expect(screen.getByText('可见度')).toBeInTheDocument();
    expect(screen.getByText('信源健康')).toBeInTheDocument();
    expect(
      screen.getByText('权重取自产品定义附录 C 的口径，界面只做展示、不做归一化计算。'),
    ).toBeInTheDocument();

    // 趋势：三轮，进行中的那轮不在里面。
    expect(screen.getByRole('img', { name: '环比趋势' })).toBeInTheDocument();
    expect(SEED_TREND).toHaveLength(3);
    expect(
      screen.getByText(/进行中的轮次不进趋势：口径没跑完，画上去就是假变化。/),
    ).toBeInTheDocument();

    expect(rowsOfCard('竞品对标矩阵')).toBe(
      SEED_COMPETITOR_MATRICES[SEED_BASELINE_ROUND_ID].rows.length,
    );
    expect(rowsOfCard('意图漏斗')).toBe(SEED_INTENT_FUNNELS[SEED_BASELINE_ROUND_ID].rows.length);
    expect(rowsOfCard('引擎差异')).toBe(SEED_ENGINE_SCORES[SEED_BASELINE_ROUND_ID].length);
    // 告警是项目级的 4 条（不按轮次收窄）。
    expect(screen.getAllByText('标记已读')).toHaveLength(2);
    expect(screen.getAllByText('取消已读')).toHaveLength(2);
  });

  it('🔴 Share of Voice 的分母口径写在矩阵上（同框 9 道题，不是全部题目）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);
    await waitOverview(SEED_BASELINE_ROUND_ID);

    const matrix = SEED_COMPETITOR_MATRICES[SEED_BASELINE_ROUND_ID];
    expect(
      screen.getByText(
        `Share of Voice 的分母是"同框提到多个品牌"的 ${matrix.head_to_head_prompt_count} 道题，不是全部题目。`,
      ),
    ).toBeInTheDocument();
    // 本品牌那一行要标出来，否则四行数字里看不出哪个是自己。
    expect(screen.getByText('本品牌')).toBeInTheDocument();
  });

  it('意图漏斗的病症结论与小分母提示都在', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);
    await waitOverview(SEED_BASELINE_ROUND_ID);

    const funnel = SEED_INTENT_FUNNELS[SEED_BASELINE_ROUND_ID];
    expect(screen.getByText(funnel.diagnosis_note)).toBeInTheDocument();
    expect(screen.getByText('认知层')).toBeInTheDocument();
    expect(screen.getByText('决策层')).toBeInTheDocument();
  });

  it('标记已读就地生效：按钮翻成「取消已读」+ 长出「已读」标签，且🔴分数一个都不动', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);
    await waitOverview(SEED_BASELINE_ROUND_ID);

    expect(screen.getByText('44')).toBeInTheDocument();
    const ackedBefore = screen.getAllByText('已读').length;

    const item = screen.getByText(UNACKED_ALERT.detail).closest('.ant-list-item');
    expect(item).not.toBeNull();
    expect(UNACKED_ALERT.acknowledged).toBe(false);
    await user.click(within(item as HTMLElement).getByRole('button', { name: '标记已读' }));

    expect(await screen.findByText('已更新告警状态')).toBeInTheDocument();
    await waitFor(() => {
      const after = screen.getByText(UNACKED_ALERT.detail).closest('.ant-list-item') as HTMLElement;
      expect(within(after).getByRole('button', { name: '取消已读' })).toBeInTheDocument();
      expect(screen.getAllByText('已读')).toHaveLength(ackedBefore + 1);
    });

    // 🔴 翻告警不重算总分（demo 不做加权）。
    expect(statisticValue('GEO 体检总分')).toBe('44');
    expect(statisticValue('Brand Coverage')).toBe('42%');
  });

  it('取消已读同样就地生效', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);
    await waitOverview(SEED_BASELINE_ROUND_ID);

    const acked = SEED_ALERTS.find((alert) => alert.acknowledged)!;
    const ackedBefore = screen.getAllByText('已读').length;
    const item = screen.getByText(acked.detail).closest('.ant-list-item') as HTMLElement;
    await user.click(within(item).getByRole('button', { name: '取消已读' }));

    expect(await screen.findByText('已更新告警状态')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('已读')).toHaveLength(ackedBefore - 1));
  });
});

describe('DiagnosisPage · 样本不足那一轮的降级形态', () => {
  it('照样给数字，但 SampleSizeAlert 与置灰说明必须在', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_TRIAL_ROUND_ID);
    await waitOverview(SEED_TRIAL_ROUND_ID);

    const overview = SEED_DIAGNOSIS_OVERVIEWS[SEED_TRIAL_ROUND_ID];
    expect(overview.sample_size_grade).toBe('insufficient');
    expect(statisticValue('GEO 体检总分')).toBe(String(overview.total_score));
    // 样本量分级的告警：标题与说明都在（阈值从 `api/constants.ts` 插值）。
    expect(
      screen.getByText('样本不足（<30 条），不提供精确分数，仅供方向性参考。'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('当前题库共 5 条 prompt。建议补齐到 60 条以上再对外汇报分数。'),
    ).toBeInTheDocument();
    // 置灰是内联样式（`color: #bfbfbf`），不是新 class ⇒ 按样式断言。
    expect(statisticOf('GEO 体检总分').querySelector('.ant-statistic-content-value')).toHaveStyle({
      color: '#bfbfbf',
    });
    // 小样本那一轮没有竞品矩阵与漏斗 ⇒ 两个空状态。
    expect(screen.getByText('这一轮没有竞品对标数据。')).toBeInTheDocument();
    expect(screen.getByText('这一轮没有漏斗数据。')).toBeInTheDocument();
    // 但引擎差异有（3 家通道验证）。
    expect(rowsOfCard('引擎差异')).toBe(SEED_ENGINE_SCORES[SEED_TRIAL_ROUND_ID].length);
  });
});

describe('DiagnosisPage · 轮次查询失败不被吞掉', () => {
  it('collection_board 失败时保留页头并显示稳定错误码，而不是「没有体检结果」', async () => {
    renderAtRoute(
      <DiagnosisPage />,
      PATH,
      '/projects/00000000-0000-4000-8000-0000000000ff/diagnosis',
    );

    expect(await screen.findByRole('heading', { name: '诊断与归因' })).toBeInTheDocument();
    expect(await screen.findByText(/项目不存在/)).toBeInTheDocument();
    expect(screen.queryByText('这一轮还没有体检结果。')).not.toBeInTheDocument();
  });
});

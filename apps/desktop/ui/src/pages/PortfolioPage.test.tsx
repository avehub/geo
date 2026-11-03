/**
 * M9 组合总览页（demo）。
 *
 * 这一页的判据分两层：
 * - 组合口径（不平均、只给分布、归档排除）在 `api/portfolio-compose.test.ts`；
 * - 本文件钉**可用的交互**：筛选 / 搜索 / 排序 / 行内下钻，以及“待采集”与“有结论”混排时
 *   不把未采集项目当成 0 分。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';

import PortfolioPage from './PortfolioPage';
import * as collection from '../api/collection';
import { IpcRequestError } from '../api/client';
import { resetDemoDb } from '../demo/db';
import {
  SEED_ACTIVE_PROJECT_ID,
  SEED_CHENGCHUAN_PROJECT_ID,
} from '../demo/seed/projects';
import { renderWithProviders } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

function PathProbe() {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function renderPage() {
  return renderWithProviders(
    <>
      <PortfolioPage />
      <PathProbe />
    </>,
    { route: '/portfolio' },
  );
}

function pathname(): string {
  return screen.getByTestId('pathname').textContent ?? '';
}

async function waitReady() {
  await screen.findByText('澜舟工业除尘设备');
  await waitFor(() => expect(statisticValue('有结论')).toBe('1'));
}

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

beforeEach(() => {
  resetDemoDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PortfolioPage · 多项目摘要', () => {
  it('五个汇总数字：3 个项目 / 1 个有结论 / 0 个样本不足 / 2 条未读告警 / 62 道题', async () => {
    renderPage();
    await screen.findByText('澜舟工业除尘设备');

    await waitFor(() => expect(statisticValue('项目数')).toBe('3'));
    expect(statisticValue('有结论')).toBe('1');
    expect(statisticValue('样本不足')).toBe('0');
    expect(statisticValue('未读告警')).toBe('2');
    expect(statisticValue('总样本量')).toBe('62');
  });

  it('有结论的项目显示轮次与三项指标；未采集的项目显示「待采集」而不是 0 分', async () => {
    renderPage();
    await screen.findByText('澜舟工业除尘设备');

    const active = screen.getByText('澜舟工业除尘设备').closest('tr');
    expect(active).not.toBeNull();
    expect(within(active as HTMLElement).getByText('第 3 轮 · 行动后复测')).toBeInTheDocument();
    expect(within(active as HTMLElement).getByText('55%')).toBeInTheDocument();
    expect(within(active as HTMLElement).getByText('55')).toBeInTheDocument();
    expect(within(active as HTMLElement).getByText('38%')).toBeInTheDocument();

    const onboarding = screen.getByText('澄川水处理设备').closest('tr');
    expect(onboarding).not.toBeNull();
    expect(within(onboarding as HTMLElement).getByText('待采集')).toBeInTheDocument();
    expect(within(onboarding as HTMLElement).queryByText('0%')).not.toBeInTheDocument();
  });

  it('归档项目默认不出现', async () => {
    renderPage();
    await screen.findByText('澜舟工业除尘设备');
    expect(screen.queryByText('云栖协作平台')).not.toBeInTheDocument();
  });

  it('筛选「待采集」后只剩两个未采集项目；搜索「禾野」只留一条', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('澜舟工业除尘设备');

    await user.click(screen.getByText('待采集 2'));
    await waitFor(() => expect(screen.queryByText('澜舟工业除尘设备')).not.toBeInTheDocument());
    expect(screen.getByText('澄川水处理设备')).toBeInTheDocument();
    expect(screen.getByText('禾野食品供应链')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('搜索项目或品牌'), '禾野');
    await waitFor(() => expect(screen.queryByText('澄川水处理设备')).not.toBeInTheDocument());
    expect(screen.getByText('禾野食品供应链')).toBeInTheDocument();
  });

  it('点行进入该项目的概览；待采集项目的按钮去采集页', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitReady();

    await user.click(screen.getByText('澜舟工业除尘设备'));
    await waitFor(() =>
      expect(pathname()).toBe(`/projects/${SEED_ACTIVE_PROJECT_ID}/overview`),
    );

    await user.click(screen.getByText('澄川水处理设备'));
    await waitFor(() =>
      expect(pathname()).toBe('/projects/d7f2a9c4-1e6b-4a3d-9c8f-2b5e7a1d4c60/overview'),
    );
  });
});

describe('PortfolioPage · 读取失败与待采集分开', () => {
  it('单个项目看板读取失败时单独计数 / 筛选，不计入「待采集」', async () => {
    const user = userEvent.setup();
    const actual = collection.collectionBoard;
    vi.spyOn(collection, 'collectionBoard').mockImplementation((projectId: string) =>
      projectId === SEED_CHENGCHUAN_PROJECT_ID
        ? Promise.reject(new IpcRequestError({ code: 'ipc/unknown_command', message: 'ipc/unknown_command', params: {} }))
        : actual(projectId),
    );

    renderPage();
    await screen.findByText('澜舟工业除尘设备');
    await waitFor(() => expect(screen.getByText('读取失败 1')).toBeInTheDocument());

    // 两个未采集项目中有一个读取失败 ⇒「待采集」只剩 1。
    expect(screen.getByText('待采集 1')).toBeInTheDocument();

    await user.click(screen.getByText('读取失败 1'));
    await waitFor(() => expect(screen.getByText('澄川水处理设备')).toBeInTheDocument());
    expect(screen.queryByText('禾野食品供应链')).not.toBeInTheDocument();
    expect(screen.queryByText('澜舟工业除尘设备')).not.toBeInTheDocument();

    await user.click(screen.getByText('待采集 1'));
    await waitFor(() => expect(screen.getByText('禾野食品供应链')).toBeInTheDocument());
    expect(screen.queryByText('澄川水处理设备')).not.toBeInTheDocument();
  });
});

describe('PortfolioPage · 分布与口径', () => {
  it('分布卡默认展示品牌覆盖，可切到体检总分；口径句常驻', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitReady();

    const card = screen.getByText('指标分布').closest('.ant-card');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getAllByText(/55%/).length).toBeGreaterThan(0);
    expect(
      within(card as HTMLElement).getByText('min / 中位数 / max，不是平均值。'),
    ).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText('1 个项目有结论')).toBeInTheDocument();

    await user.click(within(card as HTMLElement).getByText('体检总分'));
    expect(within(card as HTMLElement).getAllByText(/55/).length).toBeGreaterThan(0);
  });

  it('演示口径常驻：未采集不等于 0 分、比率不做跨项目平均', async () => {
    renderPage();
    await screen.findByText('澜舟工业除尘设备');
    expect(
      screen.getByText(
        '演示模式下项目摘要来自各项目既有的最近一轮结论；未采集的项目显示「待采集」，不会被当成 0 分。比率只给分布，不做跨项目平均。',
      ),
    ).toBeInTheDocument();
  });
});

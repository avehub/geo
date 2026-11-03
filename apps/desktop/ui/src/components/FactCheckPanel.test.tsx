/**
 * 事实核查面板的**错误态**（P2 审查：`fact_check_list` 失败被显示成「没有汇总」）。
 *
 * 这里白盒传一个不存在的轮次 id：demo handler 会以 `validation/failed` 拒绝
 * （`insight.ts` 的 `requireRound`）——正是桌面端某些命令缺失/参数失效时的同一形态。
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import FactCheckPanel from './FactCheckPanel';
import zhCN from '../i18n/locales/zh-CN';
import { renderWithProviders } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

describe('FactCheckPanel · 错误态', () => {
  it('fact_check_list 失败时显示错误码，而不是「没有汇总」', async () => {
    renderWithProviders(
      <FactCheckPanel roundId="00000000-0000-4000-8000-0000000000ff" onOpenEvidence={() => undefined} />,
    );

    expect(await screen.findByText(/采集轮次 ID不是合法 ID/)).toBeInTheDocument();
    expect(screen.queryByText(zhCN.insight.factCheck.noSummary)).not.toBeInTheDocument();
  });
});

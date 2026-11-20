import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AutoBuildPanel from './AutoBuildPanel';
import { mockInvoke } from '../test/invoke-mock';
import { renderWithProviders } from '../test/render';
import { PROJECT_ID, makeEntityCard } from '../test/fixtures';

/**
 * 2026-11-06 用户报障：自动建档返回「抓取成功但 AI 抽取未完成」的降级卡时，
 * 原先的成功提示只有「自动建档完成，字段完整率 20%」——读起来像是抽到了东西。
 * 降级路径必须把「抓了页、AI 没跑」说清楚，并指向模型设置。
 */
describe('AutoBuildPanel · 降级提示', () => {
  beforeEach(() => mockInvoke.reset());

  it('抓取成功但 AI 抽取未完成时用 warning 说明字段来自建项资料', async () => {
    mockInvoke.stubAlways('entity_card_autobuild', () =>
      makeEntityCard({
        completeness: 0.2,
        source: {
          crawled_pages: ['https://k.gaodekuai.cn/', 'https://k.gaodekuai.cn/help'],
          llm_provider: null,
          llm_model: null,
          generated_at: '2026-11-07T01:13:58Z',
        },
      }),
    );
    const onBuilt = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <AutoBuildPanel projectId={PROJECT_ID} defaultDomain="https://k.gaodekuai.cn" onBuilt={onBuilt} />,
    );

    await user.click(screen.getByRole('button', { name: /自动建档/ }));

    await waitFor(() => expect(onBuilt).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(
        '已抓取官网，但 AI 抽取未完成（字段来自建项资料）；请检查「设置 → 模型服务」后重试。',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/自动建档完成，字段完整率/)).not.toBeInTheDocument();
  });

  it('AI 抽取成功时仍显示成功提示（不误报降级）', async () => {
    mockInvoke.stubAlways('entity_card_autobuild', () => makeEntityCard({ completeness: 0.8 }));
    const onBuilt = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <AutoBuildPanel projectId={PROJECT_ID} defaultDomain="https://example.com" onBuilt={onBuilt} />,
    );

    await user.click(screen.getByRole('button', { name: /自动建档/ }));

    await waitFor(() => expect(onBuilt).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('自动建档完成，字段完整率 80%')).toBeInTheDocument();
  });
});

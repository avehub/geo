import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import zhCN from '../../i18n/locales/zh-CN';
import { renderWithProviders } from '../../test/render';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import MetricText from './MetricText';
import SectionCard from './SectionCard';
import StatTile from './StatTile';
import StatusChip, { type ChipStatus } from './StatusChip';
import VerdictBar from './VerdictBar';

const STATUSES: ChipStatus[] = ['ok', 'running', 'warning', 'error', 'todo', 'unavailable', 'insufficient'];

describe('MetricText', () => {
  it('数字与单位同屏，且用等宽数字（内联样式，不新增全局 CSS）', () => {
    render(<MetricText value="42.5" unit="%" size="lg" />);
    expect(screen.getByText('42.5')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    const root = screen.getByText('42.5').parentElement;
    expect(root?.getAttribute('style')).toContain('tabular-nums');
    expect(root?.getAttribute('style')).toContain('font-size: 30px');
  });
});

describe('StatusChip', () => {
  it('七种状态都渲染词典里的词，一个都不隐藏', () => {
    renderWithProviders(
      <div>
        {STATUSES.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
      </div>,
    );
    for (const status of STATUSES) {
      expect(screen.getByText(zhCN.common.status[status]), status).toBeInTheDocument();
    }
  });

  it('允许覆盖文案（枚举值走 enumLabel 时由调用方传入）', () => {
    renderWithProviders(<StatusChip status="ok" label="自定义" />);
    expect(screen.getByText('自定义')).toBeInTheDocument();
  });
});

describe('StatTile', () => {
  it('标签、数字、环比、区间与口径都在；样本不足时给出提示', () => {
    renderWithProviders(
      <StatTile
        label="品牌覆盖"
        value="55"
        unit="%"
        delta={{ text: '+13 个百分点', direction: 'up' }}
        margin="±5 个百分点"
        hint="有多少道题提到了本品牌"
        insufficient
        spark={[1, 2, 3]}
      />,
    );
    expect(screen.getByText('品牌覆盖')).toBeInTheDocument();
    expect(screen.getByText('55')).toBeInTheDocument();
    expect(screen.getByText('+13 个百分点')).toBeInTheDocument();
    expect(screen.getByText('±5 个百分点')).toBeInTheDocument();
    expect(screen.getByText('有多少道题提到了本品牌')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(zhCN.common.status.insufficient))).toBeInTheDocument();
  });
});

describe('SectionCard', () => {
  it('标题、说明与内容各在其位', () => {
    renderWithProviders(
      <SectionCard title="区块" description="一句说明">
        <span>内容</span>
      </SectionCard>,
    );
    expect(screen.getByText('区块')).toBeInTheDocument();
    expect(screen.getByText('一句说明')).toBeInTheDocument();
    expect(screen.getByText('内容')).toBeInTheDocument();
  });
});

describe('VerdictBar', () => {
  it('结论条给出 headline 与动作，tone 落在 data 属性上（可测、可查）', () => {
    renderWithProviders(
      <VerdictBar
        tone="risk"
        kicker="本轮结论"
        headline="豆包事实错误率 18%"
        action={<button type="button">去看待办</button>}
      />,
    );
    expect(screen.getByText('豆包事实错误率 18%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '去看待办' })).toBeInTheDocument();
    expect(screen.getByText('本轮结论').closest('[data-tone]')?.getAttribute('data-tone')).toBe('risk');
  });
});

describe('EmptyState / ErrorState', () => {
  it('空态三型带 variant 标记与动作', () => {
    renderWithProviders(
      <EmptyState variant="no_result" title="没有结果" description="清一下筛选" action={<button type="button">清除</button>} />,
    );
    expect(screen.getByText('没有结果')).toBeInTheDocument();
    expect(screen.getByText('清一下筛选')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument();
    expect(document.querySelector('[data-variant="no_result"]')).not.toBeNull();
  });

  it('错误态原样上屏错误码，并允许重试', async () => {
    const retry = vi.fn();
    renderWithProviders(
      <ErrorState title="取不到数据" description="ipc/unknown_command" onRetry={retry} retryLabel="重试" />,
    );
    expect(screen.getByText('ipc/unknown_command')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

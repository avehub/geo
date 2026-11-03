/**
 * 组合分布卡的**判空边界**（P3 契约整洁度切片 C）。
 *
 * `summarizePortfolio` 在 `count > 0` 时保证 min / median / max 都是数字，但契约类型仍是
 * `number | null`。原来靠 `min!` / `median!` / `max!` 断言，这里钉住三种输入下卡片的行为：
 * - 单项目：min = 中位数 = max，三个数字都要出现；
 * - 空分布（`count === 0`）：显示空态，不渲染数字；
 * - 契约违例（`count > 0` 但三项为 null）：同样落到空态，不把 `null` 格式化成 `0%`。
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import PortfolioDistributionCard from './PortfolioDistributionCard';
import type { MetricDistribution } from '../api/portfolio-compose';
import type { OverviewMetricKey } from '../api/overview-compose';
import zhCN from '../i18n/locales/zh-CN';
import { renderWithProviders } from '../test/render';

const KEYS: readonly OverviewMetricKey[] = [
  'brand_coverage',
  'total_score',
  'share_of_voice',
  'fact_accuracy',
];

/** 四个指标给同一份分布：卡片默认选中 `brand_coverage`，其余键只是为了让 Record 完整。 */
function fullDistribution(value: MetricDistribution): Record<OverviewMetricKey, MetricDistribution> {
  return Object.fromEntries(KEYS.map((key) => [key, value])) as Record<
    OverviewMetricKey,
    MetricDistribution
  >;
}

describe('PortfolioDistributionCard · min / 中位数 / max 判空', () => {
  it('单项目分布 min = 中位数 = max，三个数字都渲染', () => {
    renderWithProviders(
      <PortfolioDistributionCard
        distribution={fullDistribution({ count: 1, min: 0.55, median: 0.55, max: 0.55 })}
      />,
    );

    expect(screen.getByText(/min 55%/)).toBeInTheDocument();
    expect(screen.getByText(/中位数 55%/)).toBeInTheDocument();
    expect(screen.getByText(/max 55%/)).toBeInTheDocument();
    expect(screen.getByText('1 个项目有结论')).toBeInTheDocument();
  });

  it('空分布显示空态，不渲染数字', () => {
    renderWithProviders(
      <PortfolioDistributionCard
        distribution={fullDistribution({ count: 0, min: null, median: null, max: null })}
      />,
    );

    expect(screen.getByText(zhCN.portfolio.distribution.empty)).toBeInTheDocument();
    expect(screen.queryByText(/min /)).not.toBeInTheDocument();
  });

  it('契约违例（count > 0 但三项为 null）落空态，不显示 0%', () => {
    renderWithProviders(
      <PortfolioDistributionCard
        distribution={fullDistribution({ count: 1, min: null, median: null, max: null })}
      />,
    );

    expect(screen.getByText(zhCN.portfolio.distribution.empty)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});

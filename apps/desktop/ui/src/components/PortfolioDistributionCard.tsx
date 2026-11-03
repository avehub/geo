import { useState } from 'react';
import { Card, Empty, Segmented, Space, Typography, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import type { MetricDistribution } from '../api/portfolio-compose';
import type { OverviewMetricKey } from '../api/overview-compose';
import { percentText, plainNumber } from './format';

const METRICS: readonly OverviewMetricKey[] = ['brand_coverage', 'total_score', 'share_of_voice'];

/** 比率指标在图上按 0~100 画；总分本来就是 0~100。 */
function trackValue(key: OverviewMetricKey, value: number): number {
  return key === 'total_score' ? value : value * 100;
}

function valueText(key: OverviewMetricKey, value: number): string {
  return key === 'total_score' ? plainNumber(value) : percentText(value);
}

/**
 * 组合分布：min / 中位数 / max + 一条范围条。
 *
 * 🔴 这不是"平均分"：不同项目的分母不同，平均出来的组合覆盖率没有解释。
 * 范围条让「最差 — 最好」一眼可见，中位数点给一个稳健的中心位置。
 */
export default function PortfolioDistributionCard({
  distribution,
}: {
  distribution: Record<OverviewMetricKey, MetricDistribution>;
}) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [metric, setMetric] = useState<OverviewMetricKey>('brand_coverage');

  const current = distribution[metric];
  // 三项同生同灭（`summarizePortfolio` 的 `count > 0` 分支一次给齐）：先判空再渲染，
  // 下面的范围条与「min / 中位数 / max」都不再对可空字段用 `!`（P3 契约整洁度切片 C）。
  const bounds =
    current.min === null || current.median === null || current.max === null
      ? null
      : { min: current.min, median: current.median, max: current.max };
  const min = bounds === null ? 0 : trackValue(metric, bounds.min);
  const max = bounds === null ? 0 : trackValue(metric, bounds.max);
  const median = bounds === null ? 0 : trackValue(metric, bounds.median);

  return (
    <Card
      size="small"
      title={t('portfolio.distribution.title')}
      style={{ marginBottom: 12 }}
      extra={
        <Segmented
          size="small"
          value={metric}
          onChange={(value) => setMetric(value as OverviewMetricKey)}
          options={METRICS.map((key) => ({
            value: key,
            label: t(
              key === 'brand_coverage'
                ? 'portfolio.distribution.metrics.coverage'
                : key === 'total_score'
                  ? 'portfolio.distribution.metrics.score'
                  : 'portfolio.distribution.metrics.sov',
            ),
          }))}
        />
      }
    >
      {current.count === 0 || bounds === null ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('portfolio.distribution.empty')}
        />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <div style={{ position: 'relative', height: 10, marginTop: 6 }}>
            <div
              style={{
                position: 'absolute',
                insetInline: 0,
                top: 1,
                height: 8,
                borderRadius: 4,
                background: token.colorFillSecondary,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: `${min}%`,
                width: `${Math.max(max - min, 0.6)}%`,
                top: 1,
                height: 8,
                borderRadius: 4,
                background: token.colorPrimaryBorder,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: `${median}%`,
                top: -3,
                width: 16,
                height: 16,
                marginInlineStart: -8,
                borderRadius: 8,
                background: token.colorPrimary,
                border: `2px solid ${token.colorBgContainer}`,
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('portfolio.distribution.min')} {valueText(metric, bounds.min)}
            </Typography.Text>
            <Typography.Text strong>
              {t('portfolio.distribution.median')} {valueText(metric, bounds.median)}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('portfolio.distribution.max')} {valueText(metric, bounds.max)}
            </Typography.Text>
          </div>
          <Space size={8} wrap>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('portfolio.distribution.note')}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('portfolio.distribution.countNote', { value: current.count })}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('portfolio.distribution.archivedNote')}
            </Typography.Text>
          </Space>
        </Space>
      )}
    </Card>
  );
}

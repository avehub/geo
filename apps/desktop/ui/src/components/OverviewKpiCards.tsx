import { Card, Col, Row, Space, Statistic, Tag, Tooltip, Typography, theme } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import type { OverviewMetric, OverviewMetricKey } from '../api/overview-compose';
import type { SampleSizeGrade } from '../api/types';
import type { TranslationKey } from '../i18n/resources';
import { metricDeltaText, percentText, plainNumber } from './format';

/** 指标 → 标题 / 说明的词典键（顺序即展示顺序，与 `buildHeadlineMetrics` 同序）。 */
const META: Record<OverviewMetricKey, { title: TranslationKey; hint: TranslationKey }> = {
  brand_coverage: { title: 'overview.kpi.coverage', hint: 'overview.kpi.coverageHint' },
  total_score: { title: 'overview.kpi.score', hint: 'overview.kpi.scoreHint' },
  share_of_voice: { title: 'overview.kpi.sov', hint: 'overview.kpi.sovHint' },
  fact_accuracy: { title: 'overview.kpi.accuracy', hint: 'overview.kpi.accuracyHint' },
};

/** 环比标签的颜色：涨绿、跌红、持平灰（四个指标都是"涨了更好"）。 */
function deltaColor(delta: number): string {
  if (delta > 0) return 'green';
  if (delta < 0) return 'red';
  return 'default';
}

/**
 * 头号 KPI 四宫格：大数字 + 环比 + 区间 + 一句口径。
 *
 * 🔴 样本不足时数字置灰（`insufficient`）：产品口径是"不显示精确分数、只给方向性参考"。
 * 置灰不是装饰，是让用户别把 20% 当结论。
 */
export default function OverviewKpiCards({
  metrics,
  grade,
}: {
  metrics: OverviewMetric[];
  grade: SampleSizeGrade;
}) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const insufficient = grade === 'insufficient';

  return (
    <Row gutter={12} style={{ marginBottom: 12 }}>
      {metrics.map((metric) => {
        const meta = META[metric.key];
        // 环比标签的四个字段一次算齐：`delta` 判空之后全部来自同一个非空局部值，
        // 渲染处不再需要对 `metric.delta` 用 `!`（P3 契约整洁度切片 C）。
        const rawDelta = metric.delta;
        const delta =
          rawDelta === null
            ? null
            : {
                text: metricDeltaText(t, metric.unit, rawDelta),
                color: deltaColor(rawDelta),
                up: rawDelta >= 0,
              };
        return (
          <Col span={6} key={metric.key}>
            <Card size="small" style={{ height: '100%', boxShadow: token.boxShadowTertiary }}>
              <Statistic
                title={t(meta.title)}
                value={metric.unit === 'percent' ? percentText(metric.value) : plainNumber(metric.value)}
                valueStyle={{
                  fontSize: 28,
                  lineHeight: '36px',
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  color: insufficient ? token.colorTextTertiary : undefined,
                }}
              />
              <Space size={4} wrap style={{ marginTop: 4 }}>
                {delta !== null && (
                  <Tooltip title={t('overview.kpi.deltaNote')}>
                    <Tag
                      color={delta.color}
                      icon={delta.up ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                    >
                      {delta.text}
                    </Tag>
                  </Tooltip>
                )}
                {metric.margin !== null && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t(metric.key === 'brand_coverage' ? 'overview.kpi.margin' : 'overview.kpi.marginScore', {
                      value: plainNumber(metric.margin),
                    })}
                  </Typography.Text>
                )}
              </Space>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 0' }}>
                {t(meta.hint)}
              </Typography.Paragraph>
              {insufficient && (
                <Typography.Text type="warning" style={{ fontSize: 12 }}>
                  {t('overview.kpi.insufficient')}
                </Typography.Text>
              )}
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}

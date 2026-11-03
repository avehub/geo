import { Alert, Card, Empty, Space, Table, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { AttributionCard, AttributionMetric } from '../api/types';
import { metricDeltaText, metricValueText } from './format';
import { enumLabel } from '../i18n/enum-label';

/**
 * M6 闭环归因卡片（基线轮 → 复测轮，中间完成了哪几条动作）。
 *
 * # 🔴 数字以 `metrics` 为准，`summary` 只作叙述
 * `AttributionCard.summary` 是种子里写好的中文叙述，里面也带数字；界面渲染的表格取自
 * `metrics`（`demo/seed.test.ts` 钉住两者一致）。这样即便将来改了种子叙述，界面上也不会
 * 出现"文案说 +18%、表里是 +13 个百分点"这种自相矛盾。
 *
 * # `action.attribution.note` 必须显示
 * 这张卡片把「完成动作」与「指标变化」并排放，不说清"AI 回答有随机性、这不是因果证明"，
 * 就等于在暗示我们能控制模型输出（AGENTS 规则 6 的同族红线）。
 *
 * # delta 的口径
 * 走 `metricDeltaText`（`percent` 单位的 delta 已经是百分点）——与报告页、导出文本同一份实现。
 * 变化量由前端从 before/after 相减得到：这是**展示口径**（同一个数两种写法），不是领域指标。
 */
export default function AttributionCards({ cards }: { cards: AttributionCard[] }) {
  const { t } = useTranslation();

  return (
    <Card size="small" title={t('action.attribution.title')} style={{ marginBottom: 12 }}>
      {cards.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('action.attribution.empty')} />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {cards.map((card) => (
            <Card key={card.id} size="small" type="inner">
              <Space size={4} wrap style={{ marginBottom: 8 }}>
                <Tag color="blue">{`${t('action.attribution.baseline')}: ${card.baseline_label}`}</Tag>
                <Tag color="green">{`${t('action.attribution.retest')}: ${card.retest_label}`}</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {`${t('action.attribution.actions')}: ${card.action_ids.length}`}
                </Typography.Text>
              </Space>
              {/* 叙述是数据级中文，en 界面下照旧显示中文（与表格数据列同口径）。 */}
              <Typography.Paragraph style={{ fontSize: 12 }}>{card.summary}</Typography.Paragraph>
              <Table<AttributionMetric>
                size="small"
                rowKey="metric"
                pagination={false}
                dataSource={card.metrics}
                columns={[
                  {
                    title: t('action.attribution.metric'),
                    dataIndex: 'metric',
                    render: (value: string) => enumLabel(t, 'action.attribution.metrics', value),
                  },
                  {
                    title: t('action.attribution.before'),
                    dataIndex: 'before',
                    render: (value: number, row) => metricValueText(row.unit, value),
                  },
                  {
                    title: t('action.attribution.after'),
                    dataIndex: 'after',
                    render: (value: number, row) => metricValueText(row.unit, value),
                  },
                  {
                    title: t('action.attribution.change'),
                    key: 'change',
                    render: (_, row) => {
                      // `percent` 的差值要换算成百分点（0.13 → +13），`count` 直接相减。
                      const delta =
                        row.unit === 'percent' ? (row.after - row.before) * 100 : row.after - row.before;
                      return metricDeltaText(t, row.unit, delta);
                    },
                  },
                ]}
              />
            </Card>
          ))}
          <Alert type="warning" showIcon message={t('action.attribution.note')} />
        </Space>
      )}
    </Card>
  );
}

import { useMemo } from 'react';
import { Alert, Button, Card, Empty, Progress, Space, Tag, Typography, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { describeIpcError } from '../api/errors';
import type { CompetitorMatrix, CompetitorMatrixRow } from '../api/types';
import { percentText, plainNumber } from './format';

/**
 * 竞品对照：**横向条形**而不是十列矩阵。
 *
 * 首页只需要回答「差多少」：本品牌 + 覆盖最高的两家竞品，各自一条覆盖率条，
 * 条下面给提及份额。完整矩阵（Top1 / Top3 / 正负面 / 事实错误 / 被引域名）留在诊断页，
 * 这里放十列会把"一屏看懂"变成"一屏读表"。
 *
 * 🔴 差距句只陈述数字（覆盖落后/领先几个百分点），不做排名承诺（规则 6）。
 */
export default function OverviewCompetitorsCard({
  matrix,
  loading,
  error,
  onOpen,
}: {
  matrix: CompetitorMatrix | null;
  loading: boolean;
  error: unknown | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const focus = useMemo<CompetitorMatrixRow[]>(() => {
    if (matrix === null) return [];
    const self = matrix.rows.find((row) => row.is_self) ?? null;
    const others = matrix.rows
      .filter((row) => !row.is_self)
      .slice()
      .sort((left, right) => right.coverage - left.coverage)
      .slice(0, 2);
    return self === null ? others.slice(0, 3) : [self, ...others];
  }, [matrix]);

  const self = matrix?.rows.find((row) => row.is_self) ?? null;
  const strongest = focus.find((row) => !row.is_self) ?? null;
  // 先把「差多少」和「跟谁比」收进同一个值：两个非空判断之后 `strongest` 已被收窄，
  // 后面三支都不再需要 `!`（P3 契约整洁度切片 C）。
  const gap =
    self === null || strongest === null
      ? null
      : {
          brand: strongest.brand,
          points: Math.round((strongest.coverage - self.coverage) * 100),
        };

  const gapText =
    gap === null
      ? null
      : gap.points > 0
        ? t('overview.competitors.gapBehind', {
            brand: gap.brand,
            value: plainNumber(gap.points),
          })
        : gap.points < 0
          ? t('overview.competitors.gapAhead', {
              brand: gap.brand,
              value: plainNumber(-gap.points),
            })
          : t('overview.competitors.gapEven', { brand: gap.brand });

  return (
    <Card
      size="small"
      loading={loading}
      title={t('overview.competitors.title')}
      style={{ height: '100%' }}
      extra={
        <Button type="link" size="small" onClick={onOpen}>
          {t('overview.competitors.open')}
        </Button>
      }
    >
      {error !== null ? (
        <Alert type="error" showIcon message={describeIpcError(error, t)} />
      ) : matrix === null ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('overview.competitors.empty')} />
      ) : (
        <>
          {gapText !== null && (
            <Typography.Paragraph strong style={{ marginBottom: 12 }}>
              {gapText}
            </Typography.Paragraph>
          )}
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {focus.map((row) => (
              <div key={row.brand}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }} size={4}>
                  <Space size={4}>
                    <Typography.Text strong={row.is_self}>{row.brand}</Typography.Text>
                    {row.is_self && <Tag color="blue">{t('overview.competitors.self')}</Tag>}
                  </Space>
                  <Typography.Text strong>{percentText(row.coverage)}</Typography.Text>
                </Space>
                <Progress
                  percent={Math.round(row.coverage * 100)}
                  showInfo={false}
                  size="small"
                  strokeColor={row.is_self ? token.colorPrimary : token.colorTextQuaternary}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('overview.competitors.sov', { value: percentText(row.share_of_voice) })}
                </Typography.Text>
              </div>
            ))}
          </Space>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '10px 0 0' }}>
            {t('overview.competitors.note', { total: matrix.head_to_head_prompt_count })}
          </Typography.Paragraph>
        </>
      )}
    </Card>
  );
}

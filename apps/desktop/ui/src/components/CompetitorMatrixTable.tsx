import { Card, Empty, Table, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { CompetitorMatrix, CompetitorMatrixRow } from '../api/types';
import { percentText } from './format';

/**
 * M5 竞品对标矩阵（`pages/DiagnosisPage.tsx` 的一个区块）。
 *
 * 🔴 必须显示的口径：`diagnosis.competitors.headToHeadNote`——Share of Voice 的分母是
 * 「同框提到多个品牌」的题目数（种子里是 9 道），不是全部 62 道。分母不写出来，
 * 这个数字既没法被质疑也没法被信任。
 *
 * 本品牌那一行高亮 + 打一个 `diagnosis.competitors.self` 标签；品牌名是数据，照原样显示。
 */
export default function CompetitorMatrixTable({ matrix }: { matrix: CompetitorMatrix | null }) {
  const { t } = useTranslation();

  return (
    <Card
      size="small"
      title={t('diagnosis.competitors.title')}
      style={{ marginBottom: 12 }}
      extra={
        matrix === null ? null : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {`${t('diagnosis.competitors.sample')}: ${matrix.sample_size} · ${t(
              'diagnosis.competitors.headToHead',
            )}: ${matrix.head_to_head_prompt_count}`}
          </Typography.Text>
        )
      }
    >
      {matrix === null ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('diagnosis.competitors.empty')} />
      ) : (
        <>
          <Table<CompetitorMatrixRow>
            size="small"
            rowKey="brand"
            pagination={false}
            dataSource={matrix.rows}
            columns={[
              {
                title: t('diagnosis.competitors.brand'),
                dataIndex: 'brand',
                render: (value: string, row) => (
                  <Typography.Text strong={row.is_self}>
                    {value}
                    {row.is_self && (
                      <Tag color="blue" style={{ marginInlineStart: 6 }}>
                        {t('diagnosis.competitors.self')}
                      </Tag>
                    )}
                  </Typography.Text>
                ),
              },
              {
                title: t('diagnosis.competitors.coverage'),
                dataIndex: 'coverage',
                render: (value: number) => percentText(value),
              },
              {
                title: t('diagnosis.competitors.shareOfVoice'),
                dataIndex: 'share_of_voice',
                render: (value: number) => percentText(value),
              },
              {
                title: t('diagnosis.competitors.top1Rate'),
                dataIndex: 'top1_rate',
                render: (value: number) => percentText(value),
              },
              {
                title: t('diagnosis.competitors.top3Rate'),
                dataIndex: 'top3_rate',
                render: (value: number) => percentText(value),
              },
              {
                title: t('diagnosis.competitors.mentionOnlyRate'),
                dataIndex: 'mention_only_rate',
                render: (value: number) => percentText(value),
              },
              {
                title: t('diagnosis.competitors.positiveRate'),
                dataIndex: 'positive_rate',
                render: (value: number) => percentText(value),
              },
              {
                title: t('diagnosis.competitors.negativeRate'),
                dataIndex: 'negative_rate',
                render: (value: number) => percentText(value),
              },
              { title: t('diagnosis.competitors.factErrorCount'), dataIndex: 'fact_error_count' },
              { title: t('diagnosis.competitors.citedDomainCount'), dataIndex: 'cited_domain_count' },
            ]}
          />
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
            {t('diagnosis.competitors.headToHeadNote', { total: matrix.head_to_head_prompt_count })}
          </Typography.Paragraph>
        </>
      )}
    </Card>
  );
}

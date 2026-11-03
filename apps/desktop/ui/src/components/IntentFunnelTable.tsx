import { Alert, Card, Empty, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import { MINIMUM_SAMPLE_SIZE } from '../api/constants';
import type { FunnelRow, IntentFunnel } from '../api/types';
import { percentText } from './format';
import { enumLabel } from '../i18n/enum-label';

/**
 * M5 意图漏斗（认知 → 推荐 → 决策）+ 病症结论。
 *
 * # 小分母要显式说
 * 每层都带 `prompt_count`（种子里认知层与推荐层各 9 道题）。低于 `MINIMUM_SAMPLE_SIZE`
 * 时挂一条 `diagnosis.funnel.smallDenominator` 告警：9 道题的比率差一档就是 11 个百分点，
 * 不标出来就会被当成趋势读。阈值复用 `api/constants.ts` 的那个（与后端同源），不新造魔数。
 *
 * 🔴 `diagnosis_note` 是数据级中文（种子里的结论句），界面对它只做展示，不改写、不重算。
 */
export default function IntentFunnelTable({ funnel }: { funnel: IntentFunnel | null }) {
  const { t } = useTranslation();

  const smallDenominator =
    funnel === null ? false : funnel.rows.some((row) => row.prompt_count < MINIMUM_SAMPLE_SIZE);
  const smallest = funnel === null ? 0 : Math.min(...funnel.rows.map((row) => row.prompt_count));

  return (
    <Card size="small" title={t('diagnosis.funnel.title')} style={{ marginBottom: 12 }}>
      {funnel === null ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('diagnosis.funnel.empty')} />
      ) : (
        <>
          {smallDenominator && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 8 }}
              message={t('diagnosis.funnel.smallDenominator', { total: smallest })}
            />
          )}
          <Table<FunnelRow>
            size="small"
            rowKey="stage"
            pagination={false}
            dataSource={funnel.rows}
            columns={[
              {
                title: t('diagnosis.funnel.stage'),
                dataIndex: 'stage',
                render: (value: string) => enumLabel(t, 'diagnosis.funnel.stages', value),
              },
              { title: t('diagnosis.funnel.promptCount'), dataIndex: 'prompt_count' },
              {
                title: t('diagnosis.funnel.mentionRate'),
                dataIndex: 'mention_rate',
                render: (value: number) => percentText(value),
              },
              {
                title: t('diagnosis.funnel.top3Rate'),
                dataIndex: 'top3_rate',
                render: (value: number) => percentText(value),
              },
            ]}
          />
          <Typography.Paragraph style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
            <Typography.Text type="secondary">{t('diagnosis.funnel.note')}: </Typography.Text>
            <Typography.Text>{funnel.diagnosis_note}</Typography.Text>
          </Typography.Paragraph>
        </>
      )}
    </Card>
  );
}

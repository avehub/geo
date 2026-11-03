import { useMemo } from 'react';
import { App, Button, Empty, List, Space, Tag, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as diagnosis from '../api/diagnosis';
import { describeIpcError } from '../api/errors';
import type { AlertItem, AlertSeverity, CollectionRound } from '../api/types';
import { alertMetricUnit, dateTimeText, metricDeltaText } from './format';
import { enumLabel } from '../i18n/enum-label';

/** 严重度 → 标签色：提示蓝、警告橙、严重红。 */
const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  info: 'blue',
  warning: 'orange',
  critical: 'red',
};

/**
 * M5 告警清单（`pages/DiagnosisPage.tsx` 的一个区块）。
 *
 * # 真值是 `db.alerts`，不是 overview 里那份内嵌副本
 * `diagnosis_overview` 读时会用库里的告警覆盖内嵌副本（裁定见 `demo/handlers/diagnosis.ts` 头注释），
 * 所以「标记已读」只要失效 overview 这一个 query key 就能刷新界面。这里按**前缀**失效
 * （`['diagnosis-overview']` 匹配所有轮次）：告警是项目级的，切轮次不该看到两套已读状态。
 *
 * # 轮次名要另外查
 * `AlertItem` 只带 `round_id`（稳定记号），轮次名是数据 ⇒ 由页面把轮次清单传进来做映射。
 * 查不到就退化成显示 id，绝不编一个名字。
 */
export default function AlertList({
  alerts,
  rounds,
}: {
  alerts: AlertItem[];
  rounds: CollectionRound[];
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const labelOf = useMemo(() => {
    const map = new Map(rounds.map((round) => [round.id, round.label]));
    return (roundId: string) => map.get(roundId) ?? roundId;
  }, [rounds]);

  const acknowledgeMutation = useMutation({
    mutationFn: ({ id, acknowledged }: { id: string; acknowledged: boolean }) =>
      diagnosis.diagnosisAlertAcknowledge(id, acknowledged),
    onSuccess: () => {
      message.success(t('diagnosis.alerts.acknowledgeOk'));
      void queryClient.invalidateQueries({ queryKey: ['diagnosis-overview'] });
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  if (alerts.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('diagnosis.alerts.empty')} />;
  }

  return (
    <List<AlertItem>
      size="small"
      dataSource={alerts}
      rowKey={(item) => item.id}
      renderItem={(alert) => {
        // delta 的口径与报告页那侧**同一个**（裁定 3 / E-40）：装的就是百分点或条数，
        // 所以这里只需要问"这个指标是哪种单位"，不再有任何乘 100 的分支。
        const delta =
          alert.delta === null
            ? null
            : metricDeltaText(t, alertMetricUnit(alert.metric), alert.delta);
        return (
          <List.Item
            key={alert.id}
            style={{ opacity: alert.acknowledged ? 0.65 : 1 }}
            actions={[
              <Button
                key="ack"
                size="small"
                type="link"
                loading={acknowledgeMutation.isPending && acknowledgeMutation.variables?.id === alert.id}
                onClick={() =>
                  acknowledgeMutation.mutate({ id: alert.id, acknowledged: !alert.acknowledged })
                }
              >
                {alert.acknowledged
                  ? t('diagnosis.alerts.unacknowledge')
                  : t('diagnosis.alerts.acknowledge')}
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={
                <Space size={4} wrap>
                  <Tag color={SEVERITY_COLORS[alert.severity]}>
                    {enumLabel(t, 'diagnosis.alerts.severities', alert.severity)}
                  </Tag>
                  <Tag>{enumLabel(t, 'diagnosis.alerts.kinds', alert.kind)}</Tag>
                  <Tag color="geekblue">
                    {enumLabel(t, 'diagnosis.alerts.metrics', alert.metric)}
                  </Tag>
                  {alert.engine !== null && (
                    <Tag>{enumLabel(t, 'collection.engines', alert.engine)}</Tag>
                  )}
                  {alert.acknowledged && <Tag>{t('diagnosis.alerts.acknowledged')}</Tag>}
                </Space>
              }
              description={
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  {/* 归因说明是数据级中文（种子里写的），en 界面下照旧显示中文——与表格数据列同口径。 */}
                  <Typography.Text>{alert.detail}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {[
                      `${t('diagnosis.alerts.round')}: ${labelOf(alert.round_id)}`,
                      delta === null ? null : `${t('diagnosis.alerts.delta')}: ${delta}`,
                      `${t('diagnosis.alerts.raisedAt')}: ${dateTimeText(alert.raised_at)}`,
                    ]
                      .filter((part) => part !== null)
                      .join(' · ')}
                  </Typography.Text>
                </Space>
              }
            />
          </List.Item>
        );
      }}
    />
  );
}

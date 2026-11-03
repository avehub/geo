import { useMemo } from 'react';
import { Card, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { EngineScore } from '../api/types';
import { latencyText, percentText } from './format';
import { enumLabel } from '../i18n/enum-label';

/**
 * M5 引擎差异视图：哪个引擎最认可你、哪个最容易把你说错。
 *
 * # 排序是**展示口径**，不是指标计算
 * 词典里那句「按事实错误率倒序」是本视图的读法（先看最容易说错你的那个），所以这里排一次序。
 * 每一行的覆盖率 / 错误率 / 成功率 / 耗时都原样取种子里的静态值，一个都不重算（AGENTS 规则 9）。
 * `useMemo` + 复制数组：`scores` 来自 react-query 缓存，就地 sort 会改到缓存里的对象。
 */
export default function EngineScoreTable({ scores }: { scores: EngineScore[] }) {
  const { t } = useTranslation();

  const rows = useMemo(
    () => [...scores].sort((left, right) => right.fact_error_rate - left.fact_error_rate),
    [scores],
  );

  return (
    <Card size="small" title={t('diagnosis.engines.title')} style={{ marginBottom: 12 }}>
      <Table<EngineScore>
        size="small"
        rowKey="engine"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: t('diagnosis.engines.empty') }}
        columns={[
          {
            title: t('diagnosis.engines.engine'),
            dataIndex: 'engine',
            render: (value: string) => enumLabel(t, 'collection.engines', value),
          },
          { title: t('diagnosis.engines.sample'), dataIndex: 'sample_size' },
          {
            title: t('diagnosis.engines.coverage'),
            dataIndex: 'coverage',
            render: (value: number) => percentText(value),
          },
          {
            title: t('diagnosis.engines.top3Rate'),
            dataIndex: 'top3_rate',
            render: (value: number) => percentText(value),
          },
          {
            title: t('diagnosis.engines.positiveRate'),
            dataIndex: 'positive_rate',
            render: (value: number) => percentText(value),
          },
          {
            title: t('diagnosis.engines.factErrorRate'),
            dataIndex: 'fact_error_rate',
            render: (value: number) => percentText(value),
          },
          {
            title: t('diagnosis.engines.successRate'),
            dataIndex: 'success_rate',
            render: (value: number) => percentText(value),
          },
          {
            title: t('diagnosis.engines.avgLatency'),
            dataIndex: 'avg_latency_ms',
            render: (value: number) => latencyText(t, value),
          },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
        {t('diagnosis.engines.note')}
      </Typography.Paragraph>
    </Card>
  );
}

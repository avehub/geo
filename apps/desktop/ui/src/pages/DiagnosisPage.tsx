import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import * as collection from '../api/collection';
import * as diagnosis from '../api/diagnosis';
import { describeIpcError } from '../api/errors';
import type { DimensionScore } from '../api/types';
import AlertList from '../components/AlertList';
import CompetitorMatrixTable from '../components/CompetitorMatrixTable';
import EngineScoreTable from '../components/EngineScoreTable';
import IntentFunnelTable from '../components/IntentFunnelTable';
import SampleSizeAlert from '../components/SampleSizeAlert';
import PageHeader from '../components/ui/PageHeader';
import TrendChart from '../components/TrendChart';
import { dateTimeText, percentText } from '../components/format';
import { enumLabel } from '../i18n/enum-label';

/**
 * M5 可见度诊断与竞品对标（体检首屏）。
 *
 * 四个视图各拆了一个组件（告警 / 竞品矩阵 / 漏斗 / 引擎差异），本页负责：轮次选择、
 * 总分与五维、趋势折线，以及**把口径说明摆在数字旁边**。
 *
 * 🔴 三条必须显示的口径：
 * - `diagnosis.staticNote`：总分与五维是预置静态值，前端不按权重重算；
 * - `diagnosis.score.marginNote`：比率类指标是**区间**不是单点（重复采样得来）；
 * - `SampleSizeAlert`：样本不足那一轮照样有数字，但界面必须置灰并给方向性提示。
 *
 * # 「这一轮没有体检结果」是正常形态，不是错误
 * `diagnosis_overview` / `competitors` / `funnel` 都可能回 `null`（进行中那轮刻意不出结论），
 * 各区块因此各自显示空状态；只有轮次 id 认不出才会 reject（`describeIpcError` 那一支）。
 * 进行中那轮**有**引擎差异数据（已完成部分的即时口径），所以引擎表照常渲染。
 */
export default function DiagnosisPage() {
  const { id: projectId = '' } = useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [roundId, setRoundId] = useState<string | null>(null);

  const boardQuery = useQuery({
    queryKey: ['collection-board', projectId],
    queryFn: () => collection.collectionBoard(projectId),
    enabled: projectId !== '',
  });
  const rounds = boardQuery.data?.rounds ?? [];
  const selectedRoundId = roundId ?? rounds[rounds.length - 1]?.id ?? null;

  const overviewQuery = useQuery({
    queryKey: ['diagnosis-overview', selectedRoundId],
    queryFn: () => diagnosis.diagnosisOverview(selectedRoundId ?? ''),
    enabled: selectedRoundId !== null,
  });
  const competitorsQuery = useQuery({
    queryKey: ['diagnosis-competitors', selectedRoundId],
    queryFn: () => diagnosis.diagnosisCompetitors(selectedRoundId ?? ''),
    enabled: selectedRoundId !== null,
  });
  const funnelQuery = useQuery({
    queryKey: ['diagnosis-funnel', selectedRoundId],
    queryFn: () => diagnosis.diagnosisFunnel(selectedRoundId ?? ''),
    enabled: selectedRoundId !== null,
  });
  const enginesQuery = useQuery({
    queryKey: ['diagnosis-engines', selectedRoundId],
    queryFn: () => diagnosis.diagnosisEngines(selectedRoundId ?? ''),
    enabled: selectedRoundId !== null,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['collection-board', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['diagnosis-overview'] });
    void queryClient.invalidateQueries({ queryKey: ['diagnosis-competitors'] });
    void queryClient.invalidateQueries({ queryKey: ['diagnosis-funnel'] });
    void queryClient.invalidateQueries({ queryKey: ['diagnosis-engines'] });
  };

  const overview = overviewQuery.data ?? null;
  const insufficient = overview?.sample_size_grade === 'insufficient';

  const roundsError = boardQuery.isError ? boardQuery.error : null;
  const overviewError = overviewQuery.isError ? overviewQuery.error : null;

  return (
    <div>
      <PageHeader
        title={t('diagnosis.title')}
        description={t('diagnosis.subtitle')}
        actions={
          <>
            <Button icon={<ReloadOutlined />} onClick={refresh}>
              {t('common.refresh')}
            </Button>
            <Select
              style={{ width: 280 }}
              value={selectedRoundId ?? undefined}
              placeholder={t('diagnosis.round')}
              onChange={setRoundId}
              options={rounds.map((round) => ({ value: round.id, label: round.label }))}            />
          </>
        }
      />

      {roundsError !== null && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={t('overview.cardUnavailable')}
          description={describeIpcError(roundsError, t)}
        />
      )}

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        {t('diagnosis.staticNote')}
      </Typography.Paragraph>

      {overviewError !== null ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={t('overview.cardUnavailable')}
          description={describeIpcError(overviewError, t)}
        />
      ) : overview === null ? (
        <Alert type="info" showIcon message={t('diagnosis.noData')} style={{ marginBottom: 12 }} />
      ) : (
        <>
          <SampleSizeAlert grade={overview.sample_size_grade} count={overview.sample_size} />

          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={8}>
              <Card size="small">
                <Statistic
                  title={
                    <Space size={4}>
                      <span>{t('diagnosis.score.total')}</span>
                      <Tooltip title={t('diagnosis.score.marginNote')}>
                        <Tag>{t('diagnosis.score.margin', { value: overview.score_margin })}</Tag>
                      </Tooltip>
                    </Space>
                  }
                  // 样本不足时置灰：产品口径是「不显示精确分数、只给方向性参考」，
                  // 数字照旧来自种子（demo 不做加权），但视觉上不当结论读。
                  value={overview.total_score}
                  valueStyle={insufficient ? { color: '#bfbfbf' } : undefined}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('diagnosis.score.outOf')}
                </Typography.Text>
                <Progress
                  percent={overview.total_score}
                  showInfo={false}
                  size="small"
                  status={insufficient ? 'normal' : 'active'}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {`${t('diagnosis.score.sample')}: ${overview.sample_size} · `}
                  {enumLabel(t, 'common.sampleSizeGrades', overview.sample_size_grade)}
                </Typography.Text>
              </Card>
            </Col>
            <Col span={16}>
              <Card size="small">
                <Row gutter={12}>
                  <Col span={6}>
                    <Statistic
                      title={t('diagnosis.score.coverage')}
                      value={percentText(overview.brand_coverage)}
                      valueStyle={insufficient ? { color: '#bfbfbf' } : undefined}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {`${t('diagnosis.score.margin', {
                        value: Math.round(overview.brand_coverage_margin * 100),
                      })} · ${t('diagnosis.score.coverageHint')}`}
                    </Typography.Text>
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title={t('diagnosis.score.sov')}
                      value={percentText(overview.share_of_voice)}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('diagnosis.score.sovHint')}
                    </Typography.Text>
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title={t('diagnosis.score.factAccuracy')}
                      value={percentText(overview.fact_accuracy)}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('diagnosis.score.factAccuracyHint')}
                    </Typography.Text>
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title={t('diagnosis.score.domains')}
                      value={overview.distinct_cited_domains}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('diagnosis.score.domainsHint')}
                    </Typography.Text>
                  </Col>
                </Row>
                <Descriptions size="small" column={3} style={{ marginTop: 8 }}>
                  <Descriptions.Item label={t('diagnosis.score.metricSpec')}>
                    {overview.metric_spec_version}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('diagnosis.score.collectedAt')}>
                    {dateTimeText(overview.collected_at)}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('diagnosis.round')}>
                    {overview.round_label}
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
          </Row>

          <Card size="small" title={t('diagnosis.dimensions.title')} style={{ marginBottom: 12 }}>
            <Table<DimensionScore>
              size="small"
              rowKey="dimension"
              pagination={false}
              dataSource={overview.dimensions}
              columns={[
                {
                  title: t('diagnosis.dimensions.dimension'),
                  dataIndex: 'dimension',
                  render: (value: string) => enumLabel(t, 'diagnosis.dimensions.names', value),
                },
                { title: t('diagnosis.dimensions.score'), dataIndex: 'score' },
                {
                  title: t('diagnosis.dimensions.weight'),
                  dataIndex: 'weight',
                  render: (value: number) => percentText(value),
                },
                { title: t('diagnosis.dimensions.sample'), dataIndex: 'sample_size' },
                // 说明是数据级中文（种子里的解释句），en 界面下照旧显示中文。
                { title: t('diagnosis.dimensions.detail'), dataIndex: 'detail' },
              ]}
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>
              {t('diagnosis.dimensions.weightNote')}
            </Typography.Paragraph>
          </Card>

          <Card size="small" title={t('diagnosis.trend.title')} style={{ marginBottom: 12 }}>
            <TrendChart points={overview.trend} />
          </Card>

          <Card size="small" title={t('diagnosis.alerts.title')} style={{ marginBottom: 12 }}>
            <AlertList alerts={overview.alerts} rounds={rounds} />
          </Card>
        </>
      )}

      {competitorsQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={t('diagnosis.competitors.title')}
          description={describeIpcError(competitorsQuery.error, t)}
        />
      )}
      <CompetitorMatrixTable matrix={competitorsQuery.data ?? null} />
      {funnelQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={t('diagnosis.funnel.title')}
          description={describeIpcError(funnelQuery.error, t)}
        />
      )}
      <IntentFunnelTable funnel={funnelQuery.data ?? null} />
      {enginesQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={t('diagnosis.engines.title')}
          description={describeIpcError(enginesQuery.error, t)}
        />
      )}
      <EngineScoreTable scores={enginesQuery.data ?? []} />
    </div>
  );
}

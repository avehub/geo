import { useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Row, Select, Space, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import * as action from '../api/action';
import * as article from '../api/article';
import * as client from '../api/client';
import * as collection from '../api/collection';
import * as diagnosis from '../api/diagnosis';
import { describeIpcError } from '../api/errors';
import * as insight from '../api/insight';
import * as site from '../api/site';
import {
  buildActionProgress,
  buildHeadlineMetrics,
  buildRiskQueue,
  conclusiveRounds,
  latestConclusiveRound,
  previousConclusiveRound,
} from '../api/overview-compose';
import type {
  ActionItem,
  CollectionRound,
  DiagnosisOverview,
  EngineScore,
  FactCheckBoard,
} from '../api/types';
import OverviewActionsCard from '../components/OverviewActionsCard';
import OverviewAnchorCard from '../components/OverviewAnchorCard';
import OverviewCompetitorsCard from '../components/OverviewCompetitorsCard';
import OverviewDeliveryCard from '../components/OverviewDeliveryCard';
import OverviewKpiCards from '../components/OverviewKpiCards';
import OverviewRisksCard from '../components/OverviewRisksCard';
import OverviewStationCard from '../components/OverviewStationCard';
import SampleSizeAlert from '../components/SampleSizeAlert';
import InfoHint from '../components/ui/InfoHint';
import PageHeader from '../components/ui/PageHeader';
import TrendChart from '../components/TrendChart';
import { percentText } from '../components/format';
import { enumLabel } from '../i18n/enum-label';

/**
 * 项目概览（首页）。
 *
 * # 一屏的顺序 = 用户决策的顺序
 * 口径锚（这是哪一轮）→ 头号 KPI（我现在怎么样）→ 趋势与竞品（在变好还是变坏、差多少）
 * → 风险（哪里最差）→ 行动（下一步做什么）→ 口径说明（凭什么信）。
 *
 * # 🔴 结果区按轮次锚定，待办区按项目累计
 * KPI / 趋势 / 竞品都跟着右上角选中的**有结论的轮次**走；风险与处方是**项目级待办**
 * （上一轮没结办的事实问题今天仍然要处理），所以跨轮累计、每条带轮次名。
 *
 * # 🔴 没有任何结论轮次是正常形态
 * 采集在跑 / 还没跑时，页面不给数字、给空态与去采集入口；行动区照常显示（它不依赖结论）。
 *
 * # 🔴 每个区块独立取数、独立降级
 * 首页是入口，任何一块取不到都不该把整页打成红屏。六个来源里有一半在桌面端尚未接线
 * （差异台账 E-33 起），逐卡显示错误既守规则 8（不屏蔽），也不会让首页失去导航价值。
 *
 * # M9
 * 本页只组装**一个** `ProjectOverviewSnapshot` 所需的材料；组合视角的数据层在
 * `api/portfolio-compose.ts` 的 `summarizePortfolio`（计数 + 分布 + 逐项目行），
 * 项目页与组合页共用同一份口径。
 */
export default function OverviewPage() {
  const { id: projectId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [roundId, setRoundId] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['project-detail', projectId],
    queryFn: () => client.projectGet(projectId),
    enabled: projectId !== '',
  });
  const boardQuery = useQuery({
    queryKey: ['collection-board', projectId],
    queryFn: () => collection.collectionBoard(projectId),
    enabled: projectId !== '',
  });

  const rounds = useMemo<CollectionRound[]>(() => boardQuery.data?.rounds ?? [], [boardQuery.data]);
  const conclusive = useMemo(() => conclusiveRounds(rounds), [rounds]);
  const selectedRound = useMemo<CollectionRound | null>(() => {
    if (conclusive.length === 0) return null;
    if (roundId === null) return latestConclusiveRound(rounds);
    return conclusive.find((round) => round.id === roundId) ?? latestConclusiveRound(rounds);
  }, [conclusive, roundId, rounds]);
  const selectedRoundId = selectedRound?.id ?? null;
  const previousRound = useMemo(
    () => (selectedRoundId === null ? null : previousConclusiveRound(rounds, selectedRoundId)),
    [rounds, selectedRoundId],
  );

  const overviewQuery = useQuery({
    queryKey: ['diagnosis-overview', selectedRoundId],
    queryFn: () => diagnosis.diagnosisOverview(selectedRoundId ?? ''),
    enabled: selectedRoundId !== null,
  });
  const previousOverviewQuery = useQuery({
    queryKey: ['diagnosis-overview', previousRound?.id ?? ''],
    queryFn: () => diagnosis.diagnosisOverview(previousRound?.id ?? ''),
    enabled: previousRound !== null,
  });
  const competitorsQuery = useQuery({
    queryKey: ['diagnosis-competitors', selectedRoundId],
    queryFn: () => diagnosis.diagnosisCompetitors(selectedRoundId ?? ''),
    enabled: selectedRoundId !== null,
  });
  const actionQuery = useQuery({
    queryKey: ['action-board', projectId],
    queryFn: () => action.actionBoard(projectId),
    enabled: projectId !== '',
  });
  const enginesQuery = useQuery({
    queryKey: ['diagnosis-engines', selectedRoundId],
    queryFn: () => diagnosis.diagnosisEngines(selectedRoundId ?? ''),
    enabled: selectedRoundId !== null,
  });
  const funnelQuery = useQuery({
    queryKey: ['diagnosis-funnel', selectedRoundId],
    queryFn: () => diagnosis.diagnosisFunnel(selectedRoundId ?? ''),
    enabled: selectedRoundId !== null,
  });
  const stationQuery = useQuery({
    queryKey: ['search-board', projectId],
    queryFn: () => client.searchBoard(projectId),
    enabled: projectId !== '',
  });
  const articleQuery = useQuery({
    queryKey: ['articles', projectId, 'all'],
    queryFn: () => article.articleList(projectId, { status: 'all' }),
    enabled: projectId !== '',
  });
  const siteQuery = useQuery({
    queryKey: ['site-board', projectId],
    queryFn: () => site.siteBoard(projectId),
    enabled: projectId !== '',
  });

  // 待办是项目级累计：对**每一个有结论的轮次**取核查与复核队列。
  const factQueries = useQueries({
    queries: conclusive.map((round) => ({
      queryKey: ['fact-check', round.id],
      queryFn: () => insight.factCheckList(round.id),
    })),
  });
  const reviewQueries = useQueries({
    queries: conclusive.map((round) => ({
      queryKey: ['insights', round.id, { needs_review: true }],
      queryFn: () => insight.insightList(round.id, { needs_review: true }),
    })),
  });

  const factBoards = useMemo(
    () =>
      conclusive.flatMap((round, index) => {
        const board: FactCheckBoard | undefined = factQueries[index]?.data;
        return board === undefined ? [] : [{ roundId: round.id, board }];
      }),
    [conclusive, factQueries],
  );
  const reviewQueues = useMemo(
    () =>
      conclusive.map((round, index) => ({
        roundId: round.id,
        insights: reviewQueries[index]?.data ?? [],
      })),
    [conclusive, reviewQueries],
  );

  const risks = useMemo(
    () =>
      buildRiskQueue({
        alerts: overviewQuery.data?.alerts ?? [],
        rounds,
        factBoards,
        reviewQueues,
      }),
    [overviewQuery.data, rounds, factBoards, reviewQueues],
  );
  const riskError = useMemo(() => {
    const failed = [...factQueries, ...reviewQueries].find((query) => query.isError);
    return failed?.error ?? null;
  }, [factQueries, reviewQueries]);

  const actions = useMemo<ActionItem[]>(() => actionQuery.data?.actions ?? [], [actionQuery.data]);
  const actionProgress = useMemo(() => buildActionProgress(actions), [actions]);

  const overview: DiagnosisOverview | null = overviewQuery.data ?? null;
  const previous: DiagnosisOverview | null = previousOverviewQuery.data ?? null;
  const metrics = useMemo(
    () => (overview === null ? [] : buildHeadlineMetrics(overview, previous)),
    [overview, previous],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['collection-board', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['diagnosis-overview'] });
    void queryClient.invalidateQueries({ queryKey: ['diagnosis-competitors'] });
    void queryClient.invalidateQueries({ queryKey: ['fact-check'] });
    void queryClient.invalidateQueries({ queryKey: ['insights'] });
    void queryClient.invalidateQueries({ queryKey: ['action-board', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['diagnosis-engines'] });
    void queryClient.invalidateQueries({ queryKey: ['diagnosis-funnel'] });
    void queryClient.invalidateQueries({ queryKey: ['search-board', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['articles', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['site-board', projectId] });
  };

  if (detailQuery.isError) {
    return <Alert type="error" showIcon message={describeIpcError(detailQuery.error, t)} />;
  }

  const project = detailQuery.data?.project ?? null;
  const engines = enginesQuery.data ?? [];
  const funnel = funnelQuery.data ?? null;
  const bestEngine = engines.reduce<EngineScore | null>(
    (best, entry) => (best === null || entry.coverage > best.coverage ? entry : best),
    null,
  );
  const worstEngine = engines.reduce<EngineScore | null>(
    (worst, entry) =>
      worst === null || entry.fact_error_rate > worst.fact_error_rate ? entry : worst,
    null,
  );
  const actionsCard = (
    <OverviewActionsCard
      progress={actionProgress}
      loading={actionQuery.isPending && projectId !== ''}
      error={actionQuery.isError ? actionQuery.error : null}
      onOpen={() => navigate(`/projects/${projectId}/action`)}
    />
  );
  // 轮次清单取不到时**不整页红屏**：首页是入口，导航与项目级待办仍有价值。
  // 结果区给出错误码（不屏蔽），行动区各自再报自己的错。
  const roundsUnavailable = boardQuery.isError;

  return (
    <div>
      <PageHeader
        title={t('overview.title')}
        description={
          project === null
            ? t('overview.subtitle')
            : t('overview.subtitleWithProject', { project: project.name })
        }
        actions={
          <>
            <InfoHint
              title={t('overview.methodology.title')}
              body={
                <>
                  <div>{t('overview.staticNote')}</div>
                  <div style={{ marginTop: 6 }}>{t('overview.methodology.note')}</div>
                  <div style={{ marginTop: 6 }}>{t('overview.methodology.demo')}</div>
                </>
              }
              label={t('overview.methodology.title')}
            />
            <Button icon={<ReloadOutlined />} onClick={refresh}>
              {t('common.refresh')}
            </Button>
            <Select
              style={{ width: 280 }}
              value={selectedRoundId ?? undefined}
              placeholder={t('overview.round')}
              disabled={conclusive.length === 0}
              onChange={setRoundId}
              options={conclusive.map((round) => ({ value: round.id, label: round.label }))}
            />
          </>
        }
      />

      {roundsUnavailable ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('overview.cardUnavailable')}
          description={describeIpcError(boardQuery.error, t)}
        />
      ) : selectedRound === null ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('overview.noRound.title')}
          description={t('overview.noRound.description')}
          action={
            <Button size="small" onClick={() => navigate(`/projects/${projectId}/collection`)}>
              {t('overview.noRound.action')}
            </Button>
          }
        />
      ) : (
        <>
          {project !== null && overview !== null && (
            <OverviewAnchorCard project={project} round={selectedRound} overview={overview} />
          )}
          {overview !== null && (
            <SampleSizeAlert
              grade={overview.sample_size_grade}
              count={overview.sample_size}
            />
          )}

          {overviewQuery.isError ? (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 12 }}
              message={t('overview.cardUnavailable')}
              description={describeIpcError(overviewQuery.error, t)}
            />
          ) : overview === null ? (
            overviewQuery.isPending ? (
              <Card size="small" loading style={{ marginBottom: 12 }} />
            ) : (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={t('diagnosis.noData')}
              />
            )
          ) : (
            <OverviewKpiCards metrics={metrics} grade={overview.sample_size_grade} />
          )}

          {/* 重要性顺序（2026-11-02）：待办 → 趋势/竞品 → 交付/对账。
              风险与处方是产品定义里的第一等公民，紧跟 KPI；趋势是解释，不是下一步。 */}
          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={14}>
              <OverviewRisksCard
                risks={risks}
                loading={[...factQueries, ...reviewQueries].some((query) => query.isPending)}
                error={riskError}
                onOpenDiagnosis={() => navigate(`/projects/${projectId}/diagnosis`)}
                onOpenInsight={() => navigate(`/projects/${projectId}/insight`)}
              />
            </Col>
            <Col span={10}>{actionsCard}</Col>
          </Row>

          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={15}>
              <Card
                size="small"
                loading={overviewQuery.isPending}
                title={t('overview.trend.title')}
                extra={
                  <Button
                    type="link"
                    size="small"
                    onClick={() => navigate(`/projects/${projectId}/diagnosis`)}
                  >
                    {t('overview.trend.open')}
                  </Button>
                }
              >
                {overviewQuery.isError ? (
                  <Alert
                    type="error"
                    showIcon
                    message={t('overview.cardUnavailable')}
                    description={describeIpcError(overviewQuery.error, t)}
                  />
                ) : overview === null ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t('diagnosis.trend.empty')}
                  />
                ) : (
                  <>
                    <TrendChart points={overview.trend} />
                    <Typography.Paragraph
                      type="secondary"
                      style={{ fontSize: 12, margin: '8px 0 0' }}
                    >
                      {t('overview.trend.note')}
                    </Typography.Paragraph>
                    {engines.length > 0 && (
                      <Space wrap style={{ marginTop: 6 }}>
                        {bestEngine !== null && (
                          <Tag color="green">
                            {t('overview.engines.best', {
                              engine: enumLabel(t, 'collection.engines', bestEngine.engine),
                              value: percentText(bestEngine.coverage),
                            })}
                          </Tag>
                        )}
                        {worstEngine !== null && (
                          <Tag color="orange">
                            {t('overview.engines.worst', {
                              engine: enumLabel(t, 'collection.engines', worstEngine.engine),
                              value: percentText(worstEngine.fact_error_rate),
                            })}
                          </Tag>
                        )}
                      </Space>
                    )}
                    {funnel !== null && (
                      <Space wrap style={{ marginTop: 6 }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {t('overview.engines.funnel')}
                        </Typography.Text>
                        {funnel.rows.map((row) => (
                          <Tag key={row.stage}>
                            {enumLabel(t, 'diagnosis.funnel.stages', row.stage)}{' '}
                            {percentText(row.mention_rate)}
                          </Tag>
                        ))}
                      </Space>
                    )}
                  </>
                )}
                {enginesQuery.isError && (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginTop: 8 }}
                    message={t('diagnosis.engines.title')}
                    description={describeIpcError(enginesQuery.error, t)}
                  />
                )}
                {funnelQuery.isError && (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginTop: 8 }}
                    message={t('diagnosis.funnel.title')}
                    description={describeIpcError(funnelQuery.error, t)}
                  />
                )}
              </Card>
            </Col>
            <Col span={9}>
              <OverviewCompetitorsCard
                matrix={competitorsQuery.data ?? null}
                loading={competitorsQuery.isPending && selectedRoundId !== null}
                error={competitorsQuery.isError ? competitorsQuery.error : null}
                onOpen={() => navigate(`/projects/${projectId}/diagnosis`)}
              />
            </Col>
          </Row>

          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={12}>
              <OverviewDeliveryCard
                articles={articleQuery.data ?? null}
                patches={siteQuery.data?.patches ?? null}
                loading={(articleQuery.isLoading || siteQuery.isLoading) && projectId !== ''}
                articleError={articleQuery.isError ? articleQuery.error : null}
                siteError={siteQuery.isError ? siteQuery.error : null}
                onOpenArticles={() => navigate(`/projects/${projectId}/articles`)}
                onOpenSite={() => navigate(`/projects/${projectId}/site`)}
              />
            </Col>
            <Col span={12}>
              <OverviewStationCard
                board={stationQuery.data ?? null}
                loading={stationQuery.isLoading && projectId !== ''}
                error={stationQuery.isError ? stationQuery.error : null}
                onOpen={() => navigate(`/projects/${projectId}/webmaster-data`)}
              />
            </Col>
          </Row>
        </>
      )}

      {/* 待办是项目级的：没有结论轮次时，处方进度仍然要看得见。 */}
      {selectedRound === null && (
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={24}>{actionsCard}</Col>
        </Row>
      )}

    </div>
  );
}

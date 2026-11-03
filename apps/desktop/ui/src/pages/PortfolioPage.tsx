import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import * as collection from '../api/collection';
import * as diagnosis from '../api/diagnosis';
import { describeIpcError } from '../api/errors';
import { buildRiskQueue, latestConclusiveRound } from '../api/overview-compose';
import {
  buildProjectSnapshot,
  filterPortfolioRows,
  summarizePortfolio,
  type PortfolioFilter,
  type PortfolioSort,
  type ProjectOverviewSnapshot,
} from '../api/portfolio-compose';

/** 页面层的筛选：`failed` 不是 compose 的口径，它只过滤“读取失败”的行。 */
type PortfolioViewFilter = PortfolioFilter | 'failed';
import PortfolioDistributionCard from '../components/PortfolioDistributionCard';
import PageHeader from '../components/ui/PageHeader';
import { dateTimeText, percentText, plainNumber } from '../components/format';
import type { TranslationKey } from '../i18n/resources';

/**
 * M9 组合总览（多项目）。
 *
 * # 这一页回答什么
 * 服务商/多项目客户打开客户端先看：**哪些项目有结论、哪些还没采集、哪些最需要处理**。
 * 单项目的深挖留给项目概览，这里只给可比的一行摘要与分布。
 *
 * # 🔴 口径
 * - 只汇总**有结论的最近一轮**；未采集项目显示「待采集」，不当作 0 分，也不进分布；
 * - 比率只给 min / 中位数 / max 分布，**不平均、不求和**（分母不同）；
 * - 归档项目默认排除；
 * - 组合层的风险在本轮只取**未读告警**（完整风险队列在项目概览），列名因此写"未读告警"。
 *
 * # 🔴 取数方式
 * 本轮仍不加聚合命令（E-73）：按项目并行调用既有的 `collection_board` +
 * `diagnosis_overview`，再用 `portfolio-compose` 的纯函数组装快照。M9 真后端若提供
 * `portfolio_overview`，只需替换这一段取数，页面与分布口径不变。
 */
export default function PortfolioPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [filter, setFilter] = useState<PortfolioViewFilter>('all');
  const [sort, setSort] = useState<PortfolioSort>('risk');
  const [query, setQuery] = useState('');

  const projectsQuery = useQuery({
    queryKey: ['projects', { query: null, include_archived: false }],
    queryFn: () => client.projectList({ query: null, include_archived: false }),
  });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);

  const boardQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ['collection-board', project.id],
      queryFn: () => collection.collectionBoard(project.id),
    })),
  });
  const latestRounds = useMemo(
    () => projects.map((_, index) => latestConclusiveRound(boardQueries[index]?.data?.rounds ?? [])),
    [projects, boardQueries],
  );
  const overviewQueries = useQueries({
    queries: projects.map((project, index) => {
      const round = latestRounds[index];
      return {
        queryKey: ['diagnosis-overview', round?.id ?? `none:${project.id}`],
        queryFn: () => diagnosis.diagnosisOverview(round!.id),
        enabled: round !== null,
      };
    }),
  });

  const rows = useMemo<ProjectOverviewSnapshot[]>(
    () =>
      projects.map((project, index) => {
        const board = boardQueries[index]?.data;
        const round = latestRounds[index];
        const overview = overviewQueries[index]?.data ?? null;
        const risks = buildRiskQueue({
          alerts: overview?.alerts ?? [],
          rounds: board?.rounds ?? [],
          factBoards: [],
          reviewQueues: [],
        });
        return buildProjectSnapshot({
          project,
          round,
          overview,
          // 组合表不展示环比：不同项目的轮次时间不同，相减没有意义。
          previous: null,
          risks,
          actions: [],
        });
      }),
    [projects, boardQueries, latestRounds, overviewQueries],
  );

  const rollup = useMemo(() => summarizePortfolio(rows), [rows]);

  const rowErrors = useMemo(() => {
    const errors = new Map<string, unknown>();
    projects.forEach((project, index) => {
      const board = boardQueries[index];
      const overview = overviewQueries[index];
      if (board?.isError) errors.set(project.id, board.error);
      else if (overview?.isError) errors.set(project.id, overview.error);
    });
    return errors;
  }, [projects, boardQueries, overviewQueries]);


  // ⚠ 用 `isLoading` 而不是 `isPending`：未采集项目的 overview 查询是 `enabled: false`，
  // 在 React Query v5 里它仍是 `isPending: true`，用 isPending 会让表格永远盖着 loading 遮罩。
  const visible = useMemo(() => {
    if (filter === 'failed') {
      return filterPortfolioRows(
        rollup.rows.filter((row) => rowErrors.has(row.project.id)),
        { filter: 'all', query, sort },
      );
    }
    // 读取失败的行不是“未采集”：它们单独筛选，其余口径只看读成功的数据。
    const healthy = rollup.rows.filter((row) => !rowErrors.has(row.project.id));
    const source = filter === 'all' ? rollup.rows : healthy;
    return filterPortfolioRows(source, { filter, query, sort });
  }, [rollup.rows, rowErrors, filter, query, sort]);

  const loading =
    projectsQuery.isLoading ||
    boardQueries.some((entry) => entry.isLoading) ||
    overviewQueries.some((entry) => entry.isLoading);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    void queryClient.invalidateQueries({ queryKey: ['collection-board'] });
    void queryClient.invalidateQueries({ queryKey: ['diagnosis-overview'] });
  };

  const riskTotal = (row: ProjectOverviewSnapshot): number =>
    row.risks.reduce((sum, risk) => sum + risk.count, 0);

  const counts = {
    all: rows.length,
    concluded: rows.filter((row) => row.round !== null).length,
    onboarding: rows.filter((row) => row.round === null && !rowErrors.has(row.project.id)).length,
    risks: rows.filter((row) => riskTotal(row) > 0).length,
    failed: rowErrors.size,
  };

  const metricOf = (row: ProjectOverviewSnapshot, key: 'brand_coverage' | 'total_score' | 'share_of_voice') =>
    row.metrics.find((metric) => metric.key === key)?.value;

  const columns: TableProps<ProjectOverviewSnapshot>['columns'] = [
    {
      title: t('portfolio.table.project'),
      key: 'project',
      width: 200,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{row.project.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.project.brand_name}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('portfolio.table.round'),
      key: 'round',
      width: 160,
      render: (_, row) => {
        const error = rowErrors.get(row.project.id);
        if (error !== undefined) {
          return (
            <Tooltip title={describeIpcError(error, t)}>
              <Tag color="red">{t('portfolio.table.failed')}</Tag>
            </Tooltip>
          );
        }
        if (row.round === null) return <Tag>{t('portfolio.table.onboarding')}</Tag>;
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text>{row.round.label}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {dateTimeText(row.round.collected_at)}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: t('portfolio.table.coverage'),
      key: 'coverage',
      width: 140,
      render: (_, row) => {
        const value = metricOf(row, 'brand_coverage');
        if (value === undefined) return <Typography.Text type="secondary">{t('portfolio.table.noData')}</Typography.Text>;
        return (
          <Space size={6}>
            <Progress
              percent={Math.round(value * 100)}
              showInfo={false}
              size="small"
              style={{ width: 84 }}
            />
            <Typography.Text>{percentText(value)}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: t('portfolio.table.score'),
      key: 'score',
      width: 70,
      render: (_, row) => {
        const value = metricOf(row, 'total_score');
        return value === undefined ? (
          <Typography.Text type="secondary">{t('portfolio.table.noData')}</Typography.Text>
        ) : (
          <Typography.Text>{plainNumber(value)}</Typography.Text>
        );
      },
    },
    {
      title: t('portfolio.table.sov'),
      key: 'sov',
      width: 90,
      render: (_, row) => {
        const value = metricOf(row, 'share_of_voice');
        return value === undefined ? (
          <Typography.Text type="secondary">{t('portfolio.table.noData')}</Typography.Text>
        ) : (
          <Typography.Text>{percentText(value)}</Typography.Text>
        );
      },
    },
    {
      title: t('portfolio.table.alerts'),
      key: 'alerts',
      width: 90,
      render: (_, row) => {
        const total = riskTotal(row);
        return total > 0 ? <Tag color="red">{total}</Tag> : <Typography.Text type="secondary">0</Typography.Text>;
      },
    },
    {
      title: t('portfolio.table.action'),
      key: 'action',
      width: 90,
      render: (_, row) => {
        const failed = rowErrors.has(row.project.id);
        const collect = !failed && row.round === null;
        return (
          <Button
            type="link"
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              navigate(
                collect
                  ? `/projects/${row.project.id}/collection`
                  : `/projects/${row.project.id}/overview`,
              );
            }}
          >
            {collect ? t('portfolio.table.collect') : t('portfolio.table.open')}
          </Button>
        );
      },
    },
  ];

  if (projectsQuery.isError) {
    return <Alert type="error" showIcon message={describeIpcError(projectsQuery.error, t)} />;
  }

  return (
    <div>
      <PageHeader
        title={t('portfolio.title')}
        description={t('portfolio.subtitle')}
        actions={
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            {t('common.refresh')}
          </Button>
        }
      />

      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('portfolio.demoNote')}
      </Typography.Paragraph>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        {(
          [
            ['portfolio.stats.projects', rollup.project_count],
            ['portfolio.stats.withRound', rollup.projects_with_round],
            ['portfolio.stats.insufficient', rollup.projects_insufficient],
            ['portfolio.stats.alerts', rollup.risks_total],
            ['portfolio.stats.samples', rollup.total_sample_size],
          ] as const satisfies readonly (readonly [TranslationKey, number])[]
        ).map(([key, value]) => (
          <Col flex="1" key={key} style={{ minWidth: 120 }}>
            <Card size="small">
              <Statistic title={t(key)} value={value} />
            </Card>
          </Col>
        ))}
      </Row>

      <PortfolioDistributionCard distribution={rollup.distribution} />

      {rowErrors.size > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('portfolio.partialError', { value: rowErrors.size })}
        />
      )}

      <Card size="small" title={t('portfolio.table.title')}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented
            size="small"
            value={filter}
            onChange={(value) => setFilter(value as PortfolioViewFilter)}
            options={[
              { value: 'all', label: t('portfolio.filters.all', { value: counts.all }) },
              { value: 'concluded', label: t('portfolio.filters.concluded', { value: counts.concluded }) },
              { value: 'onboarding', label: t('portfolio.filters.onboarding', { value: counts.onboarding }) },
              { value: 'risks', label: t('portfolio.filters.risks', { value: counts.risks }) },
              ...(counts.failed > 0
                ? [
                    {
                      value: 'failed',
                      label: `${t('portfolio.table.failed')} ${counts.failed}`,
                    },
                  ]
                : []),
            ]}
          />
          <Input.Search
            allowClear
            placeholder={t('portfolio.searchPlaceholder')}
            style={{ width: 220 }}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select
            size="small"
            style={{ width: 170 }}
            value={sort}
            onChange={(value) => setSort(value as PortfolioSort)}
            options={[
              { value: 'risk', label: t('portfolio.sort.risk') },
              { value: 'coverage', label: t('portfolio.sort.coverage') },
              { value: 'recent', label: t('portfolio.sort.recent') },
            ]}
          />
        </Space>

        <Table<ProjectOverviewSnapshot>
          size="small"
          rowKey={(row) => row.project.id}
          loading={loading}
          dataSource={visible}
          columns={columns}
          pagination={false}
          scroll={{ x: 840 }}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('portfolio.empty')} />,
          }}
          onRow={(row) => ({
            onClick: () => navigate(`/projects/${row.project.id}/overview`),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>
    </div>
  );
}

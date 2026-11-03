import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import * as collection from '../api/collection';
import { describeIpcError } from '../api/errors';
import type {
  CollectionStatus,
  CollectionTask,
  EngineId,
  EngineRun,
  RecordFilter,
  UsageRow,
} from '../api/types';
import CollectionMatrix from '../components/CollectionMatrix';
import EvidenceDrawer from '../components/EvidenceDrawer';
import EvidenceTable from '../components/EvidenceTable';
import PageHeader from '../components/ui/PageHeader';
import StartRoundModal from '../components/StartRoundModal';
import { countText, dateTimeText, latencyText, percentText, tokensText } from '../components/format';
import { enumLabel } from '../i18n/enum-label';

/** 状态标签的颜色：成功绿、失败红、进行中蓝、排队与跳过灰。 */
const STATUS_COLORS: Record<CollectionStatus, string> = {
  queued: 'default',
  running: 'processing',
  succeeded: 'success',
  failed: 'error',
  skipped: 'default',
};

/**
 * M3 多引擎采集：轮次列表、各引擎执行情况、任务队列（失败可单独重跑）、
 * 原始证据（可下钻到回答全文与引用链接）与用量看板。
 *
 * 🔴 三句必须显示的口径（都在页面顶部）：
 * - `collection.sampleOnly`：种子每轮只收录样本，不是全量；
 * - `collection.staticNote`：成功率 / 耗时 / token 是静态值，前端不重算；
 * - `collection.start.demoNotice`（在弹窗里）：演示模式不真的调用引擎。
 */
export default function CollectionPage() {
  const { id: projectId = '' } = useParams();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [roundId, setRoundId] = useState<string | null>(null);
  const [filters, setFilters] = useState<RecordFilter>({});
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);

  const boardQuery = useQuery({
    queryKey: ['collection-board', projectId],
    queryFn: () => collection.collectionBoard(projectId),
    enabled: projectId !== '',
  });

  const rounds = boardQuery.data?.rounds ?? [];
  // 默认选中最后一轮（`roundsOf` 按 round_index 升序 ⇒ 最后一条就是最新那轮）。
  const selectedRoundId = roundId ?? rounds[rounds.length - 1]?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ['collection-round', selectedRoundId],
    queryFn: () => collection.collectionRoundGet(selectedRoundId ?? ''),
    enabled: selectedRoundId !== null,
  });

  const recordsQuery = useQuery({
    queryKey: ['collection-records', selectedRoundId, filters],
    queryFn: () => collection.collectionRecordList(selectedRoundId ?? '', filters),
    enabled: selectedRoundId !== null,
  });

  // 矩阵回答的是“这一轮每个引擎覆盖了哪些意图”，与证据表的筛选无关；
  // 单独取一份不带筛选的记录，避免选了引擎后矩阵跟着缩成一两行。
  const allRecordsQuery = useQuery({
    queryKey: ['collection-records', selectedRoundId, {}],
    queryFn: () => collection.collectionRecordList(selectedRoundId ?? '', {}),
    enabled: selectedRoundId !== null,
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['collection-board', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['collection-round', selectedRoundId] });
    void queryClient.invalidateQueries({ queryKey: ['collection-records', selectedRoundId] });
  };

  const retryMutation = useMutation({
    mutationFn: (taskId: string) => collection.collectionTaskRetry(taskId),
    onSuccess: () => {
      message.success(t('collection.tasks.retryOk'));
      invalidateAll();
    },
    onError: (error) => {
      // 「演示数据未收录这条任务的重跑结果」是 `state/conflict`，词典渲染出来对用户没意义
      // ⇒ 这一支单独给一句人话（判据见 `demo/handlers/collection.ts` 的 value=no_demo_outcome）。
      const conflict = describeIpcError(error, t);
      message.error(
        conflict.includes('no_demo_outcome') ? t('collection.tasks.retryUnavailable') : conflict,
      );
    },
  });

  const round = detailQuery.data?.round ?? null;
  const usage = boardQuery.data?.usage ?? null;
  const quotaPercent = useMemo(() => {
    if (!usage || usage.quota_queries === null || usage.quota_queries === 0) return 0;
    return Math.min(100, Math.round((usage.total_queries / usage.quota_queries) * 100));
  }, [usage]);

  if (boardQuery.isError) {
    return (
      <Alert type="error" showIcon message={describeIpcError(boardQuery.error, t)} />
    );
  }

  return (
    <div>
      <PageHeader
        title={t('collection.title')}
        description={t('collection.subtitle')}
        actions={
          <>
            <Button icon={<ReloadOutlined />} onClick={invalidateAll}>
              {t('common.refresh')}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setStartOpen(true)}>
              {t('collection.board.start')}
            </Button>
          </>
        }
      />

      <Alert type="info" showIcon style={{ marginBottom: 8 }} message={t('collection.sampleOnly')} />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        {t('collection.staticNote')}
      </Typography.Paragraph>

      <Card
        size="small"
        style={{ marginBottom: 12 }}
        title={t('collection.board.rounds')}
        extra={
          <Select
            style={{ width: 280 }}
            value={selectedRoundId ?? undefined}
            placeholder={t('collection.round.label')}
            onChange={(value) => {
              setRoundId(value);
              setFilters({});
            }}
            options={rounds.map((entry) => ({
              value: entry.id,
              label: `${entry.label} · ${enumLabel(t, 'collection.statuses', entry.status)}`,
            }))}
          />
        }
      >
        {detailQuery.isError ? (
          <Alert type="error" showIcon message={describeIpcError(detailQuery.error, t)} />
        ) : round === null ? (
          <Empty description={t('collection.board.empty')} />
        ) : (
          <>
            {round.status === 'queued' && (
              <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={t('collection.round.notStarted')} />
            )}
            {round.status === 'running' && (
              <Alert type="info" showIcon style={{ marginBottom: 8 }} message={t('collection.round.running')} />
            )}
            <Descriptions size="small" column={4}>
              <Descriptions.Item label={t('collection.round.promptSet')}>
                {`${round.prompt_set_label} (v${round.prompt_set_version})`}
              </Descriptions.Item>
              <Descriptions.Item label={t('collection.round.grade')}>
                <Tag>{enumLabel(t, 'common.sampleSizeGrades', round.sample_size_grade)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('collection.round.metricSpec')}>
                {round.metric_spec_version}
              </Descriptions.Item>
              <Descriptions.Item label={t('collection.round.engines')}>
                <Space size={4} wrap>
                  {round.engine_scope.map((engine) => (
                    <Tag key={engine}>{enumLabel(t, 'collection.engines', engine)}</Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={t('collection.round.repeatCount')}>{round.repeat_count}</Descriptions.Item>
              <Descriptions.Item label={t('collection.round.successRate')}>
                {percentText(round.success_rate)}
              </Descriptions.Item>
              <Descriptions.Item label={t('collection.round.plannedQueries')}>
                {round.planned_queries}
              </Descriptions.Item>
              <Descriptions.Item label={t('collection.round.completedQueries')}>
                {round.completed_queries}
              </Descriptions.Item>
              <Descriptions.Item label={t('collection.round.failedQueries')}>
                {round.failed_queries}
              </Descriptions.Item>
              <Descriptions.Item label={t('collection.round.startedAt')}>
                {dateTimeText(round.started_at) || '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('collection.round.finishedAt')}>
                {dateTimeText(round.finished_at) || '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('collection.round.notes')}>
                {round.notes ?? '—'}
              </Descriptions.Item>
            </Descriptions>
            {round.repeat_count > 1 && (
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                {t('collection.round.repeatNote', { times: round.repeat_count })}
              </Typography.Paragraph>
            )}
          </>
        )}
      </Card>

      {allRecordsQuery.data !== undefined && allRecordsQuery.data.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <CollectionMatrix records={allRecordsQuery.data} />
        </div>
      ) : null}

      <Row gutter={12}>
        <Col span={12}>
          <Card size="small" title={t('collection.engineRuns.title')} style={{ marginBottom: 12 }}>
            <Table<EngineRun>
              size="small"
              rowKey="engine"
              pagination={false}
              dataSource={detailQuery.data?.engines ?? []}
              locale={{ emptyText: t('collection.engineRuns.empty') }}
              columns={[
                {
                  title: t('collection.engineRuns.engine'),
                  dataIndex: 'engine',
                  render: (value: EngineId, row) => (
                    <Space size={4}>
                      <span>{enumLabel(t, 'collection.engines', value)}</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {row.model}
                      </Typography.Text>
                    </Space>
                  ),
                },
                {
                  title: t('collection.engineRuns.channel'),
                  dataIndex: 'channel',
                  render: (value: string) => enumLabel(t, 'collection.channels', value),
                },
                { title: t('collection.engineRuns.succeeded'), dataIndex: 'succeeded' },
                { title: t('collection.engineRuns.failed'), dataIndex: 'failed' },
                {
                  title: t('collection.engineRuns.avgLatency'),
                  dataIndex: 'avg_latency_ms',
                  render: (value: number) => latencyText(t, value),
                },
                {
                  title: t('collection.engineRuns.completionTokens'),
                  dataIndex: 'completion_tokens',
                  render: (value: number) => tokensText(t, value),
                },
              ]}
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              {t('collection.engineRuns.browserNote')}
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title={t('collection.usage.title')} style={{ marginBottom: 12 }}>
            {usage === null || usage.rows.length === 0 ? (
              <Empty description={t('collection.usage.empty')} />
            ) : (
              <>
                <Space size={16} style={{ marginBottom: 8 }}>
                  <Typography.Text>
                    {`${t('collection.usage.totalQueries')}: ${usage.total_queries}`}
                  </Typography.Text>
                  <Typography.Text>
                    {`${t('collection.usage.totalTokens')}: ${countText(usage.total_tokens)}`}
                  </Typography.Text>
                </Space>
                {usage.quota_queries !== null && (
                  <div style={{ marginBottom: 8 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t('collection.usage.quotaProgress', {
                        used: usage.total_queries,
                        quota: usage.quota_queries,
                      })}
                    </Typography.Text>
                    <Progress percent={quotaPercent} status={usage.quota_exceeded ? 'exception' : 'normal'} />
                  </div>
                )}
                {usage.quota_exceeded && (
                  <Alert type="error" showIcon style={{ marginBottom: 8 }} message={t('collection.usage.quotaExceeded')} />
                )}
                <Table<UsageRow>
                  size="small"
                  rowKey="round_id"
                  pagination={false}
                  dataSource={usage.rows}
                  columns={[
                    { title: t('collection.usage.round'), dataIndex: 'round_label' },
                    { title: t('collection.usage.queries'), dataIndex: 'queries' },
                    {
                      title: t('collection.usage.totalTokens'),
                      dataIndex: 'total_tokens',
                      render: (value: number) => countText(value),
                    },
                  ]}
                />
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
                  {t('collection.usage.note')}
                </Typography.Paragraph>
              </>
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" title={t('collection.tasks.title')} style={{ marginBottom: 12 }}>
        <Table<CollectionTask>
          size="small"
          rowKey="id"
          tableLayout="fixed"
          pagination={false}
          dataSource={detailQuery.data?.tasks ?? []}
          locale={{ emptyText: t('collection.tasks.empty') }}
          columns={[
            { title: t('collection.tasks.prompt'), dataIndex: 'prompt_text', ellipsis: true, width: 280 },
            {
              title: t('collection.tasks.intent'),
              dataIndex: 'intent',
              width: 100,
              render: (value: string) => enumLabel(t, 'prompt.intents', value),
            },
            {
              title: t('collection.tasks.engine'),
              dataIndex: 'engine',
              width: 100,
              render: (value: EngineId) => enumLabel(t, 'collection.engines', value),
            },
            {
              title: t('collection.tasks.status'),
              dataIndex: 'status',
              width: 180,
              render: (value: CollectionStatus, row) => (
                <Space size={4}>
                  <Tag color={STATUS_COLORS[value]}>{enumLabel(t, 'collection.taskStatuses', value)}</Tag>
                  {row.failure_reason !== null && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {enumLabel(t, 'collection.failureReasons', row.failure_reason)}
                    </Typography.Text>
                  )}
                </Space>
              ),
            },
            { title: t('collection.tasks.attempt'), dataIndex: 'attempt', width: 80 },
            {
              title: t('common.actions'),
              key: 'actions',
              width: 180,
              render: (_, row) => (
                <Space size={4}>
                  {row.status === 'failed' && (
                    <Button
                      size="small"
                      loading={retryMutation.isPending && retryMutation.variables === row.id}
                      onClick={() => retryMutation.mutate(row.id)}
                    >
                      {t('collection.tasks.retry')}
                    </Button>
                  )}
                  {row.record_id !== null && (
                    <Button size="small" type="link" onClick={() => setEvidenceId(row.record_id)}>
                      {t('collection.tasks.viewRecord')}
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {recordsQuery.isError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={describeIpcError(recordsQuery.error, t)}
        />
      ) : (
        <EvidenceTable
          records={recordsQuery.data ?? []}
          loading={recordsQuery.isFetching}
          filters={filters}
          onFiltersChange={setFilters}
          onOpen={setEvidenceId}
        />
      )}

      <EvidenceDrawer recordId={evidenceId} onClose={() => setEvidenceId(null)} />
      <StartRoundModal
        projectId={projectId}
        open={startOpen}
        onClose={() => setStartOpen(false)}
        onQueued={(queued) => {
          setRoundId(queued.id);
          invalidateAll();
        }}
      />
    </div>
  );
}

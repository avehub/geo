import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Input,
  Modal,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { describeIpcError } from '../api/errors';
import * as insight from '../api/insight';
import type { FactCheckIssue, FactIssueStatus } from '../api/types';
import { confidenceText, dateTimeText, percentText } from './format';
import { enumLabel } from '../i18n/enum-label';

/** 三类事实问题的标签色：说错了红、说旧了橙、漏说了蓝。 */
const KIND_COLORS = { wrong: 'error', outdated: 'warning', missing: 'processing' } as const;

/**
 * M4 事实核查面板（`pages/InsightPage.tsx` 的第二个 tab）。
 *
 * 拆出来的理由：`InsightPage` 加上解析清单已经 500 行出头，而核查这一侧自带一条写路径
 * （人工结办 / 误报 / 重开）与一个确认弹窗，职责完整 ⇒ 按 AGENTS「单文件约 400 行就拆」独立成组件。
 * 轮次由页面统一选中后传进来（两个 tab 共用一个选择器），本组件只管这一轮。
 *
 * 🔴 必须显示的口径：`insight.factCheck.accuracyNote`——人工结办不会让准确率变化，
 * demo 不重算（AGENTS 规则 9）。
 */
export default function FactCheckPanel({
  roundId,
  onOpenEvidence,
}: {
  roundId: string | null;
  onOpenEvidence: (recordId: string) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [resolveTarget, setResolveTarget] = useState<{
    issue: FactCheckIssue;
    status: FactIssueStatus;
  } | null>(null);
  const [resolveNote, setResolveNote] = useState('');

  const factQuery = useQuery({
    queryKey: ['fact-check', roundId],
    queryFn: () => insight.factCheckList(roundId ?? ''),
    enabled: roundId !== null,
  });

  const resolveMutation = useMutation({
    mutationFn: ({
      id,
      status,
      note,
    }: {
      id: string;
      status: FactIssueStatus;
      note: string | null;
    }) => insight.factCheckResolve(id, status, note),
    onSuccess: () => {
      message.success(t('insight.factCheck.resolveOk'));
      void queryClient.invalidateQueries({ queryKey: ['fact-check', roundId] });
      // 证据抽屉里的「核查状态」与这张表同源，一起失效，免得两边显示不一致。
      void queryClient.invalidateQueries({ queryKey: ['collection-records', roundId] });
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  if (factQuery.isError) {
    // 查询失败 ≠「这一轮没有汇总」：后者是正常空态，前者必须露出稳定错误码（规则 8）。
    return (
      <Alert
        type="error"
        showIcon
        message={t('overview.cardUnavailable')}
        description={describeIpcError(factQuery.error, t)}
      />
    );
  }

  const summary = factQuery.data?.summary ?? null;
  const issues = factQuery.data?.issues ?? [];

  return (
    <>
      {summary === null ? (
        <Alert type="warning" showIcon message={t('insight.factCheck.noSummary')} />
      ) : (
        <Row gutter={12} style={{ marginBottom: 12 }}>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title={t('insight.factCheck.accuracy')}
                value={percentText(summary.fact_accuracy)}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title={t('insight.factCheck.checkedAnswers')}
                value={summary.checked_answers}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title={t('insight.factCheck.falsePositives')}
                value={summary.false_positive_count}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" title={t('insight.factCheck.byKind')}>
              <Space size={4} wrap>
                {(Object.keys(summary.by_kind) as Array<keyof typeof summary.by_kind>).map((kind) => (
                  <Tag key={kind} color={KIND_COLORS[kind]}>
                    {`${enumLabel(t, 'insight.kinds', kind)} ${summary.by_kind[kind]}`}
                  </Tag>
                ))}
              </Space>
            </Card>
          </Col>
        </Row>
      )}

      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('insight.factCheck.accuracyNote')}
      </Typography.Paragraph>

      <Table<FactCheckIssue>
        size="small"
        rowKey="id"
        loading={factQuery.isFetching}
        pagination={false}
        dataSource={issues}
        locale={{ emptyText: t('insight.factCheck.empty') }}
        columns={[
          {
            title: t('insight.factCheck.kind'),
            dataIndex: 'kind',
            render: (value: keyof typeof KIND_COLORS) => (
              <Tag color={KIND_COLORS[value]}>{enumLabel(t, 'insight.kinds', value)}</Tag>
            ),
          },
          {
            title: t('insight.factCheck.field'),
            dataIndex: 'field_path',
            render: (value: string) => enumLabel(t, 'entity.fields', value),
          },
          {
            title: t('insight.factCheck.answerExcerpt'),
            dataIndex: 'answer_excerpt',
            ellipsis: true,
          },
          { title: t('insight.factCheck.entityValue'), dataIndex: 'entity_value', ellipsis: true },
          {
            title: t('insight.factCheck.channel'),
            dataIndex: 'correction_channel',
            render: (value: string) => enumLabel(t, 'insight.channels', value),
          },
          {
            title: t('insight.factCheck.confidence'),
            dataIndex: 'confidence',
            render: (value: number) => confidenceText(value),
          },
          {
            title: t('insight.factCheck.status'),
            dataIndex: 'status',
            render: (value: string, row) => (
              <Space direction="vertical" size={0}>
                <Tag>{enumLabel(t, 'insight.issueStatuses', value)}</Tag>
                {row.resolved_at !== null && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {dateTimeText(row.resolved_at)}
                  </Typography.Text>
                )}
              </Space>
            ),
          },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_, row) => (
              <Space size={4} wrap>
                <Button size="small" type="link" onClick={() => onOpenEvidence(row.record_id)}>
                  {t('insight.factCheck.openEvidence')}
                </Button>
                {row.status !== 'corrected' && (
                  <Button
                    size="small"
                    type="link"
                    onClick={() => {
                      setResolveNote(row.note ?? '');
                      setResolveTarget({ issue: row, status: 'corrected' });
                    }}
                  >
                    {t('insight.factCheck.markCorrected')}
                  </Button>
                )}
                {row.status !== 'false_positive' && (
                  <Button
                    size="small"
                    type="link"
                    onClick={() => {
                      setResolveNote(row.note ?? '');
                      setResolveTarget({ issue: row, status: 'false_positive' });
                    }}
                  >
                    {t('insight.factCheck.markFalsePositive')}
                  </Button>
                )}
                {row.status !== 'open' && (
                  <Button
                    size="small"
                    type="link"
                    onClick={() => resolveMutation.mutate({ id: row.id, status: 'open', note: null })}
                  >
                    {t('insight.factCheck.reopen')}
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={resolveTarget !== null}
        title={t('insight.factCheck.resolve')}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        confirmLoading={resolveMutation.isPending}
        onCancel={() => setResolveTarget(null)}
        onOk={() => {
          if (resolveTarget === null) return;
          resolveMutation.mutate({
            id: resolveTarget.issue.id,
            status: resolveTarget.status,
            note: resolveNote.trim() === '' ? null : resolveNote.trim(),
          });
          setResolveTarget(null);
        }}
      >
        <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
          <Descriptions.Item label={t('insight.factCheck.kind')}>
            {resolveTarget === null ? '' : enumLabel(t, 'insight.kinds', resolveTarget.issue.kind)}
          </Descriptions.Item>
          <Descriptions.Item label={t('insight.factCheck.answerExcerpt')}>
            {resolveTarget?.issue.answer_excerpt ?? ''}
          </Descriptions.Item>
          <Descriptions.Item label={t('insight.factCheck.entityValue')}>
            {resolveTarget?.issue.entity_value ?? ''}
          </Descriptions.Item>
        </Descriptions>
        <Input.TextArea
          rows={3}
          value={resolveNote}
          placeholder={t('insight.factCheck.notePlaceholder')}
          onChange={(event) => setResolveNote(event.target.value)}
        />
      </Modal>
    </>
  );
}

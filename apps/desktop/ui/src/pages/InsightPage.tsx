import { useState } from 'react';
import { Alert, Button, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import * as collection from '../api/collection';
import { REVIEW_CONFIDENCE_FLOOR } from '../api/constants';
import { describeIpcError } from '../api/errors';
import * as insight from '../api/insight';
import type { AnswerInsight, BrandMention, InsightFilter, RiskFlag, SourceType } from '../api/types';
import { ENGINE_VALUES, RISK_FLAG_VALUES } from '../api/types';
import EvidenceDrawer from '../components/EvidenceDrawer';
import PageHeader from '../components/ui/PageHeader';
import FactCheckPanel from '../components/FactCheckPanel';
import InsightCorrectModal from '../components/InsightCorrectModal';
import { confidenceText } from '../components/format';
import { enumLabel } from '../i18n/enum-label';

/**
 * M4 回答解析与事实核查。
 *
 * 两个 tab 共用一个轮次选择器：解析结果与核查问题都是**按轮**出的，切轮次两边一起换。
 * 事实核查那一侧（含人工结办的写路径与确认弹窗）拆在 `components/FactCheckPanel.tsx`，
 * 本页只负责选轮次、把 `roundId` 传下去，以及把证据抽屉提到两个 tab 之上共用。
 *
 * 🔴 本页必须显示的口径：`insight.staticNote`——置信度与人工核查阈值都是静态值；
 * 核查侧那句「人工结办不会让准确率变化」由面板自己显示。
 */
export default function InsightPage() {
  const { id: projectId = '' } = useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [roundId, setRoundId] = useState<string | null>(null);
  const [filters, setFilters] = useState<InsightFilter>({});
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [correctTarget, setCorrectTarget] = useState<AnswerInsight | null>(null);

  const roundsQuery = useQuery({
    queryKey: ['collection-board', projectId],
    queryFn: () => collection.collectionBoard(projectId),
    enabled: projectId !== '',
  });
  const rounds = roundsQuery.data?.rounds ?? [];
  const selectedRoundId = roundId ?? rounds[rounds.length - 1]?.id ?? null;

  const insightsQuery = useQuery({
    queryKey: ['insights', selectedRoundId, filters],
    queryFn: () => insight.insightList(selectedRoundId ?? '', filters),
    enabled: selectedRoundId !== null,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['insights', selectedRoundId] });
    void queryClient.invalidateQueries({ queryKey: ['fact-check', selectedRoundId] });
    void queryClient.invalidateQueries({ queryKey: ['collection-records', selectedRoundId] });
  };

  return (
    <div>
      <PageHeader
        title={t('insight.title')}
        description={t('insight.subtitle')}
        actions={
          <Select
            style={{ width: 280 }}
            value={selectedRoundId ?? undefined}
            placeholder={t('insight.round')}
            aria-label={t('insight.roundAria')}
            onChange={(value) => {
              setRoundId(value);
              setFilters({});
            }}
            options={rounds.map((round) => ({ value: round.id, label: round.label }))}
          />
        }
      />

      {roundsQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={t('overview.cardUnavailable')}
          description={describeIpcError(roundsQuery.error, t)}
        />
      )}
      <Alert type="info" showIcon style={{ marginBottom: 8 }} message={t('insight.sampleOnly')} />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('insight.staticNote')}
      </Typography.Paragraph>

      {roundsQuery.isError ? null : (
      <Tabs
        items={[
          {
            key: 'insights',
            label: t('insight.tabs.insights'),
            children: (
              <>
                <Space size={8} wrap style={{ marginBottom: 8 }}>
                  <Select
                    size="small"
                    allowClear
                    style={{ width: 150 }}
                    placeholder={t('insight.filters.engine')}
                    aria-label={t('insight.filters.engineAria')}
                    value={filters.engine ?? undefined}
                    onChange={(value) => setFilters((prev) => ({ ...prev, engine: value ?? null }))}
                    options={[...ENGINE_VALUES].map((engine) => ({
                      value: engine,
                      label: enumLabel(t, 'collection.engines', engine),
                    }))}
                  />
                  <Select
                    size="small"
                    allowClear
                    style={{ width: 160 }}
                    placeholder={t('insight.filters.risk')}
                    aria-label={t('insight.filters.riskAria')}
                    value={filters.risk ?? undefined}
                    onChange={(value) => setFilters((prev) => ({ ...prev, risk: (value ?? null) as RiskFlag | null }))}
                    options={[...RISK_FLAG_VALUES].map((risk) => ({
                      value: risk,
                      label: enumLabel(t, 'insight.risks', risk),
                    }))}
                  />
                  <Select
                    size="small"
                    allowClear
                    style={{ width: 170 }}
                    placeholder={t('insight.filters.review')}
                    aria-label={t('insight.filters.reviewAria')}
                    value={filters.needs_review ?? undefined}
                    onChange={(value) => setFilters((prev) => ({ ...prev, needs_review: value ?? null }))}
                    options={[
                      { value: true, label: t('insight.filters.needsReviewOnly') },
                      { value: false, label: t('insight.list.reviewed') },
                    ]}
                  />
                  <Select
                    size="small"
                    allowClear
                    style={{ width: 170 }}
                    placeholder={t('insight.filters.mentioned')}
                    aria-label={t('insight.filters.mentionedAria')}
                    value={filters.self_mentioned ?? undefined}
                    onChange={(value) => setFilters((prev) => ({ ...prev, self_mentioned: value ?? null }))}
                    options={[
                      { value: true, label: t('insight.filters.mentionedOnly') },
                      { value: false, label: t('insight.filters.notMentionedOnly') },
                    ]}
                  />
                </Space>
                <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                  {t('insight.list.confidenceFloor', { floor: confidenceText(REVIEW_CONFIDENCE_FLOOR) })}
                </Typography.Paragraph>
                {insightsQuery.isError && (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 8 }}
                    message={t('overview.cardUnavailable')}
                    description={describeIpcError(insightsQuery.error, t)}
                  />
                )}
                <Table<AnswerInsight>
                  size="small"
                  rowKey="id"
                  tableLayout="fixed"
                  scroll={{ x: 980 }}
                  loading={insightsQuery.isFetching}
                  pagination={{ pageSize: 8, size: 'small' }}
                  dataSource={insightsQuery.data ?? []}
                  locale={{ emptyText: t('insight.list.empty') }}
                  expandable={{
                    expandedRowRender: (row) => (
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space size={4} wrap>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {t('insight.list.shape')}:
                          </Typography.Text>
                          {row.answer_shape.has_conclusion && <Tag>{t('insight.shape.hasConclusion')}</Tag>}
                          {row.answer_shape.has_table && <Tag>{t('insight.shape.hasTable')}</Tag>}
                          {row.answer_shape.asks_back && <Tag>{t('insight.shape.asksBack')}</Tag>}
                          {row.answer_shape.refused && <Tag color="error">{t('insight.shape.refused')}</Tag>}
                          {!row.answer_shape.has_conclusion &&
                            !row.answer_shape.has_table &&
                            !row.answer_shape.asks_back &&
                            !row.answer_shape.refused && <Tag>{t('insight.shape.plain')}</Tag>}
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {t('insight.list.sources')}:
                          </Typography.Text>
                          {Object.entries(row.source_types).map(([type, total]) => (
                            <Tag key={type}>
                              {`${enumLabel(t, 'collection.sourceTypes', type as SourceType)} ${total ?? 0}`}
                            </Tag>
                          ))}
                        </Space>
                        <Typography.Text strong style={{ fontSize: 12 }}>
                          {t('insight.mentions.title')}
                        </Typography.Text>
                        <Table<BrandMention>
                          size="small"
                          rowKey={(mention) => `${row.id}-${mention.brand}`}
                          pagination={false}
                          dataSource={row.mentions}
                          locale={{ emptyText: t('insight.mentions.empty') }}
                          columns={[
                            { title: t('insight.mentions.brand'), dataIndex: 'brand' },
                            {
                              title: t('insight.mentions.role'),
                              dataIndex: 'role',
                              render: (value: string) => enumLabel(t, 'insight.roles', value),
                            },
                            { title: t('insight.mentions.count'), dataIndex: 'count' },
                            {
                              title: t('insight.mentions.sentiment'),
                              dataIndex: 'sentiment',
                              render: (value: string) => enumLabel(t, 'common.sentiments', value),
                            },
                            {
                              title: t('insight.mentions.rank'),
                              dataIndex: 'rank',
                              render: (value: number | null) => (value === null ? '—' : value),
                            },
                            {
                              title: t('insight.mentions.inTable'),
                              dataIndex: 'in_comparison_table',
                              render: (value: boolean) => (value ? t('common.yes') : t('common.no')),
                            },
                            { title: t('insight.mentions.excerpt'), dataIndex: 'excerpt', ellipsis: true },
                          ]}
                        />
                      </Space>
                    ),
                  }}
                  columns={[
                    { title: t('insight.list.prompt'), dataIndex: 'prompt_text', ellipsis: true, width: 260 },
                    {
                      title: t('insight.list.engine'),
                      dataIndex: 'engine',
                      width: 110,
                      render: (value: string) => enumLabel(t, 'collection.engines', value),
                    },
                    {
                      title: t('insight.list.mentioned'),
                      dataIndex: 'self_mentioned',
                      width: 100,
                      render: (value: boolean) =>
                        value ? (
                          <Tag color="green">{t('collection.records.mentionedYes')}</Tag>
                        ) : (
                          <Tag>{t('collection.records.mentionedNo')}</Tag>
                        ),
                    },
                    {
                      title: t('insight.list.rank'),
                      dataIndex: 'self_rank',
                      width: 70,
                      render: (value: number | null) => (value === null ? '—' : value),
                    },
                    {
                      title: t('insight.list.sentiment'),
                      dataIndex: 'self_sentiment',
                      width: 90,
                      render: (value: string | null) =>
                        value === null ? '—' : enumLabel(t, 'common.sentiments', value),
                    },
                    {
                      title: t('insight.list.confidence'),
                      dataIndex: 'confidence',
                      width: 140,
                      render: (value: number, row) => (
                        <Space size={4}>
                          <span>{confidenceText(value)}</span>
                          {row.needs_review && <Tag color="warning">{t('insight.list.needsReview')}</Tag>}
                        </Space>
                      ),
                    },
                    {
                      title: t('insight.list.risks'),
                      dataIndex: 'risks',
                      width: 200,
                      render: (risks: RiskFlag[], row) => (
                        <Space size={4} wrap>
                          {risks.map((risk) => (
                            <Tag key={risk} color="volcano">
                              {enumLabel(t, 'insight.risks', risk)}
                            </Tag>
                          ))}
                          {row.corrected_fields.map((field) => (
                            <Tag key={field} color="blue">
                              {`${t('insight.list.corrected')}: ${enumLabel(
                                t,
                                'insight.correctedFields',
                                field,
                              )}`}
                            </Tag>
                          ))}
                        </Space>
                      ),
                    },
                    {
                      title: t('common.actions'),
                      key: 'actions',
                      width: 150,
                      render: (_, row) => (
                        <Space size={4}>
                          <Button size="small" type="link" onClick={() => setEvidenceId(row.record_id)}>
                            {t('insight.list.openEvidence')}
                          </Button>
                          <Button size="small" type="link" onClick={() => setCorrectTarget(row)}>
                            {t('insight.list.correct')}
                          </Button>
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'fact-check',
            label: t('insight.tabs.factCheck'),
            children: <FactCheckPanel roundId={selectedRoundId} onOpenEvidence={setEvidenceId} />,
          },
        ]}
      />
      )}

      <EvidenceDrawer recordId={evidenceId} onClose={() => setEvidenceId(null)} />
      <InsightCorrectModal
        target={correctTarget}
        onClose={() => setCorrectTarget(null)}
        onCorrected={() => invalidate()}
      />
    </div>
  );
}

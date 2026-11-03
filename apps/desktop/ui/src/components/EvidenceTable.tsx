import { Button, Card, Select, Space, Table, Tag } from 'antd';
import { useTranslation } from 'react-i18next';

import type { CollectionRecord, CollectionStatus, EngineId, RecordFilter } from '../api/types';
import { COLLECTION_STATUS_VALUES, ENGINE_VALUES, INTENT_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { dateTimeText } from './format';

/**
 * 原始证据表 + 四个筛选器（M3）。
 *
 * 从 `CollectionPage` 里拆出来的理由就是本仓那条「单文件超过约 400 行就考虑拆分」：
 * 页面本身还要放轮次概览、引擎执行、任务队列与用量看板四块。
 * 筛选状态**留在页面**（查询键要用它），本组件只负责渲染与回传。
 */
export default function EvidenceTable({
  records,
  loading,
  filters,
  onFiltersChange,
  onOpen,
}: {
  records: CollectionRecord[];
  loading: boolean;
  filters: RecordFilter;
  onFiltersChange: (next: RecordFilter) => void;
  onOpen: (recordId: string) => void;
}) {
  const { t } = useTranslation();
  const patch = (part: Partial<RecordFilter>) => onFiltersChange({ ...filters, ...part });

  return (
    <Card
      size="small"
      title={t('collection.records.title')}
      extra={
        <Space size={8} wrap>
          <Select
            size="small"
            allowClear
            style={{ width: 140 }}
            placeholder={t('collection.records.filterEngine')}
            value={filters.engine ?? undefined}
            onChange={(value) => patch({ engine: value ?? null })}
            options={[...ENGINE_VALUES].map((engine) => ({
              value: engine,
              label: enumLabel(t, 'collection.engines', engine),
            }))}
          />
          <Select
            size="small"
            allowClear
            style={{ width: 140 }}
            placeholder={t('collection.records.filterIntent')}
            value={filters.intent ?? undefined}
            onChange={(value) => patch({ intent: value ?? null })}
            options={[...INTENT_VALUES].map((intent) => ({
              value: intent,
              label: enumLabel(t, 'prompt.intents', intent),
            }))}
          />
          <Select
            size="small"
            allowClear
            style={{ width: 130 }}
            placeholder={t('collection.records.filterMentioned')}
            value={filters.mentioned ?? undefined}
            onChange={(value) => patch({ mentioned: value ?? null })}
            options={[
              { value: true, label: t('collection.records.mentionedYes') },
              { value: false, label: t('collection.records.mentionedNo') },
            ]}
          />
          <Select
            size="small"
            allowClear
            style={{ width: 130 }}
            placeholder={t('collection.records.filterStatus')}
            value={filters.status ?? undefined}
            onChange={(value) => patch({ status: value ?? null })}
            options={[...COLLECTION_STATUS_VALUES].map((status) => ({
              value: status,
              label: enumLabel(t, 'collection.taskStatuses', status),
            }))}
          />
        </Space>
      }
    >
      <Table<CollectionRecord>
        size="small"
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 8, size: 'small' }}
        dataSource={records}
        locale={{ emptyText: t('collection.records.empty') }}
        columns={[
          { title: t('collection.records.prompt'), dataIndex: 'prompt_text', ellipsis: true },
          {
            title: t('collection.records.engine'),
            dataIndex: 'engine',
            render: (value: EngineId) => enumLabel(t, 'collection.engines', value),
          },
          {
            title: t('collection.records.mentioned'),
            dataIndex: 'mentioned',
            render: (value: boolean) =>
              value ? (
                <Tag color="green">{t('collection.records.mentionedYes')}</Tag>
              ) : (
                <Tag>{t('collection.records.mentionedNo')}</Tag>
              ),
          },
          {
            title: t('collection.records.rank'),
            dataIndex: 'rank',
            render: (value: number | null) => (value === null ? '—' : value),
          },
          {
            title: t('collection.records.sentiment'),
            dataIndex: 'sentiment',
            render: (value: string | null) =>
              value === null ? '—' : enumLabel(t, 'common.sentiments', value),
          },
          { title: t('collection.records.citations'), dataIndex: 'citation_count' },
          {
            title: t('collection.records.status'),
            dataIndex: 'status',
            render: (value: CollectionStatus) => enumLabel(t, 'collection.taskStatuses', value),
          },
          {
            title: t('collection.records.collectedAt'),
            dataIndex: 'collected_at',
            render: (value: string) => dateTimeText(value),
          },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_, row) => (
              <Button size="small" type="link" onClick={() => onOpen(row.id)}>
                {t('collection.records.open')}
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
}

import { Button, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import type { KeywordSearchAggregate } from '../api/search-compose';
import type { KeywordRowWithSearch } from '../api/library-compose';
import type { ContentStatus, KeywordItem } from '../api/types';
import { CONTENT_STATUS_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { countText } from './format';

export interface KeywordTableProps {
  rows: KeywordRowWithSearch[];
  loading?: boolean;
  /** 批量选择：key 即素材 id，由页面层持有（引用到题库 / 批量删除都吃这份选择）。 */
  selectedRowKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  /** 人工审核：就地翻状态（采用 / 退回 / 打回待审），不必打开编辑弹窗。 */
  onStatusChange: (row: KeywordItem, status: ContentStatus) => void;
  onEdit: (row: KeywordItem) => void;
  onDelete: (row: KeywordItem) => void;
}

/**
 * 关键词库表格（spec `2026-09-30-keyword-faq-library-design.md` §3 / §8）。
 *
 * 所有写操作经回调交给页面层，组件本身不直连 IPC（照 `PromptTable` 的分工）。
 *
 * # 标签一律查词典
 * 类型 → `library.kinds.<id>`、来源 → `library.sources.<id>`、审核态 → `action.contentStatuses.<id>`
 * （🔴 审核态**复用** M6 那张表，不新写一份：先例是 `entity.contentStatuses` 那个被收掉的重复面），
 * 意图 → `prompt.intents.<id>`（DR-39：素材与题库共用同一套意图维度）。
 *
 * # 空值占位符
 * `monthly_volume` / `difficulty` 为 `null` 时显示 `—`（不是 0）：0 是"这个指标真的是 0"，
 * `null` 是"没有这个指标"，两者在运营眼里完全不同。`—` 是 U+2014，不属 CJK，
 * 所以可以直接写在组件里（残留扫描的例外表已认领这一类，见 `i18n/no-hardcoded-strings.test.ts`）。
 */
export default function KeywordTable({
  rows,
  loading = false,
  selectedRowKeys,
  onSelectionChange,
  onStatusChange,
  onEdit,
  onDelete,
}: KeywordTableProps) {
  const { t } = useTranslation();

  const hasOverlay = rows.some((row) => row.searchAggregate !== null);
  const columns: ColumnsType<KeywordRowWithSearch> = [
    {
      title: '#',
      dataIndex: 'position',
      key: 'position',
      width: 52,
      render: (_, row) => <Typography.Text type="secondary">{row.position + 1}</Typography.Text>,
    },
    {
      title: t('library.keyword.text'),
      dataIndex: 'text',
      key: 'text',
      width: 260,
      render: (_, row) => (
        <Typography.Text strong ellipsis={{ tooltip: row.text }}>
          {row.text}
        </Typography.Text>
      ),
    },
    {
      title: t('library.keyword.kind'),
      dataIndex: 'kind',
      key: 'kind',
      width: 96,
      render: (_, row) => <Tag>{enumLabel(t, 'library.kinds', row.kind)}</Tag>,
    },
    {
      title: t('library.columns.intent'),
      dataIndex: 'intent',
      key: 'intent',
      width: 110,
      render: (_, row) => <Tag color="blue">{enumLabel(t, 'prompt.intents', row.intent)}</Tag>,
    },
    {
      title: t('library.keyword.monthlyVolume'),
      dataIndex: 'monthly_volume',
      key: 'monthly_volume',
      width: 104,
      align: 'right',
      render: (_, row) =>
        row.monthly_volume === null ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          countText(row.monthly_volume)
        ),
    },
    {
      title: t('library.keyword.difficulty'),
      dataIndex: 'difficulty',
      key: 'difficulty',
      width: 96,
      align: 'right',
      render: (_, row) =>
        row.difficulty === null ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          row.difficulty
        ),
    },
    {
      title: t('library.keyword.priority'),
      dataIndex: 'priority',
      key: 'priority',
      width: 76,
      align: 'right',
      render: (_, row) => row.priority,
    },
    {
      title: t('library.columns.status'),
      dataIndex: 'status',
      key: 'status',
      width: 128,
      render: (_, row) => (
        <Select
          size="small"
          variant="borderless"
          aria-label={t('library.columns.statusAria', { text: row.text })}
          value={row.status}
          style={{ width: 116 }}
          onChange={(status: ContentStatus) => onStatusChange(row, status)}
          options={CONTENT_STATUS_VALUES.map((value) => ({
            value,
            label: enumLabel(t, 'action.contentStatuses', value),
          }))}
        />
      ),
    },
    {
      title: t('library.columns.source'),
      dataIndex: 'source',
      key: 'source',
      width: 104,
      render: (_, row) => (
        <Tag color={row.source === 'generated' ? 'purple' : undefined}>
          {enumLabel(t, 'library.sources', row.source)}
        </Tag>
      ),
    },
    ...(hasOverlay
      ? [
          {
            title: t('library.columns.search'),
            dataIndex: 'searchAggregate',
            width: 150,
            render: (value: KeywordSearchAggregate | null) =>
              value === null ? null : (
                <Space direction="vertical" size={0}>
                  <Typography.Text style={{ fontSize: 12 }}>
                    {t(value.label_key, {
                      nsSeparator: false,
                      total: value.source_count,
                      start: value.window.start,
                      end: value.window.end,
                      completeness: enumLabel(t, 'webmasterData.completeness', value.completeness),
                    })}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {`${t('webmasterData.aggregate.impressions')} ${
                      value.impressions === null ? '—' : countText(value.impressions)
                    } · ${t('webmasterData.aggregate.clicks')} ${
                      value.clicks === null ? '—' : countText(value.clicks)
                    }`}
                  </Typography.Text>
                </Space>
              ),
          },
        ]
      : []),
    {
      title: t('library.columns.note'),
      dataIndex: 'note',
      key: 'note',
      width: 160,
      render: (_, row) =>
        row.note === null ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.note}
          </Typography.Text>
        ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 96,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            aria-label={t('common.edit')}
            onClick={() => onEdit(row)}
          />
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            aria-label={t('common.delete')}
            onClick={() => onDelete(row)}
          />
        </Space>
      ),
    },
  ];

  return (
    <Table<KeywordRowWithSearch>
      size="small"
      rowKey="id"
      tableLayout="fixed"
      loading={loading}
      columns={columns}
      dataSource={rows}
      scroll={{ x: 1432 }}
      pagination={{ pageSize: 20, showSizeChanger: false }}
      rowSelection={{
        selectedRowKeys,
        onChange: (keys) => onSelectionChange(keys.map(String)),
      }}
      locale={{ emptyText: t('library.keyword.empty') }}
    />
  );
}

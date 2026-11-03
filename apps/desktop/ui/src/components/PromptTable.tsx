import { Button, InputNumber, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';

import type { PromptItem } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

export interface PromptTableProps {
  items: PromptItem[];
  loading?: boolean;
  /** 批量选择（spec FR-M2-6）：key 即条目 id，由页面层持有。 */
  selectedRowKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  onWeightChange: (item: PromptItem, weight: number) => void;
  onRepeatCountChange: (item: PromptItem, repeatCount: number) => void;
  onEdit: (item: PromptItem) => void;
  onDelete: (item: PromptItem) => void;
}

/**
 * Prompt 题库表格：文本、意图、权重（1–5 核心词加权）、分组、来源、采样次数与同框竞品数。
 * 所有写操作通过回调交给页面层，组件本身不直连 IPC。
 *
 * 意图与来源的标签查词典 `prompt.intents.<id>` / `prompt.sources.<id>`
 * （`src/i18n/enum-label.ts` 的 `enumLabel`），查不到回退 id 本身——原来那两张 zh 映射的
 * `?? item.intent` 兜底就是这个语义，只是回退的中文标签本身即泄漏面。
 * `#` 与 `Prompt` 两个列头两种语言同形，刻意不建词条（建了只是多一份要同步的键）。
 */
export default function PromptTable({
  items,
  loading = false,
  selectedRowKeys,
  onSelectionChange,
  onWeightChange,
  onRepeatCountChange,
  onEdit,
  onDelete,
}: PromptTableProps) {
  const { t } = useTranslation();

  const columns: ColumnsType<PromptItem> = [
    {
      title: '#',
      dataIndex: 'position',
      key: 'position',
      width: 56,
      render: (_, item) => <Typography.Text type="secondary">{item.position + 1}</Typography.Text>,
    },
    {
      title: 'Prompt',
      dataIndex: 'text',
      key: 'text',
      width: 320,
      render: (_, item) => (
        <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{item.text}</Typography.Text>
      ),
    },
    {
      title: t('prompt.table.intent'),
      dataIndex: 'intent',
      key: 'intent',
      width: 110,
      render: (_, item) => <Tag>{enumLabel(t, 'prompt.intents', item.intent)}</Tag>,
    },
    {
      title: t('prompt.table.weight'),
      dataIndex: 'weight',
      key: 'weight',
      width: 90,
      render: (_, item) => (
        <InputNumber
          size="small"
          min={1}
          max={5}
          value={item.weight}
          aria-label={t('prompt.table.weightAria', { text: item.text })}
          onChange={(value) => {
            if (typeof value === 'number' && value !== item.weight) onWeightChange(item, value);
          }}
        />
      ),
    },
    { title: t('prompt.table.group'), dataIndex: 'group_name', key: 'group_name', width: 110 },
    {
      title: t('prompt.table.tags'),
      dataIndex: 'tags',
      key: 'tags',
      width: 150,
      render: (_, item) =>
        item.tags.length === 0 ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Space size={4} wrap>
            {item.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>
        ),
    },
    {
      title: t('prompt.table.source'),
      dataIndex: 'source',
      key: 'source',
      width: 100,
      render: (_, item) => enumLabel(t, 'prompt.sources', item.source),
    },
    {
      title: t('prompt.table.competitors'),
      dataIndex: 'competitor_ids',
      key: 'competitor_ids',
      width: 90,
      render: (_, item) => item.competitor_ids.length,
    },
    {
      title: t('prompt.table.repeatCount'),
      dataIndex: 'repeat_count',
      key: 'repeat_count',
      width: 90,
      render: (_, item) => (
        <InputNumber
          size="small"
          min={1}
          max={3}
          value={item.repeat_count}
          aria-label={t('prompt.table.repeatCountAria', { text: item.text })}
          onChange={(value) => {
            if (typeof value === 'number' && value !== item.repeat_count) {
              onRepeatCountChange(item, value);
            }
          }}
        />
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 120,
      render: (_, item) => (
        <Space size={0}>
          <Button size="small" type="link" onClick={() => onEdit(item)}>
            {t('common.edit')}
          </Button>
          <Tooltip title={t('prompt.table.deleteHint')}>
            <Button size="small" type="link" danger onClick={() => onDelete(item)}>
              {t('common.delete')}
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Table<PromptItem>
      rowKey="id"
      size="small"
      tableLayout="fixed"
      scroll={{ x: 1240 }}
      loading={loading}
      columns={columns}
      dataSource={items}
      rowSelection={{
        columnWidth: 36,
        selectedRowKeys,
        onChange: (keys) => onSelectionChange(keys.map(String)),
      }}
      pagination={{ pageSize: 20, showSizeChanger: true, size: 'small' }}
      locale={{ emptyText: t('prompt.table.empty') }}
    />
  );
}

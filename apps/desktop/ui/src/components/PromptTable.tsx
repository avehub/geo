import { Button, InputNumber, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import type { PromptItem } from '../api/types';
import { INTENT_LABELS, PROMPT_SOURCE_LABELS } from '../api/types';

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
      render: (_, item) => (
        <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>{item.text}</Typography.Text>
      ),
    },
    {
      title: '意图',
      dataIndex: 'intent',
      key: 'intent',
      width: 110,
      render: (_, item) => <Tag>{INTENT_LABELS[item.intent] ?? item.intent}</Tag>,
    },
    {
      title: '权重',
      dataIndex: 'weight',
      key: 'weight',
      width: 90,
      render: (_, item) => (
        <InputNumber
          size="small"
          min={1}
          max={5}
          value={item.weight}
          aria-label={`权重 ${item.text}`}
          onChange={(value) => {
            if (typeof value === 'number' && value !== item.weight) onWeightChange(item, value);
          }}
        />
      ),
    },
    { title: '分组', dataIndex: 'group_name', key: 'group_name', width: 110 },
    {
      title: '标签',
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
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 100,
      render: (_, item) => PROMPT_SOURCE_LABELS[item.source] ?? item.source,
    },
    {
      title: '同框竞品',
      dataIndex: 'competitor_ids',
      key: 'competitor_ids',
      width: 90,
      render: (_, item) => item.competitor_ids.length,
    },
    {
      title: '采样',
      dataIndex: 'repeat_count',
      key: 'repeat_count',
      width: 90,
      render: (_, item) => (
        <InputNumber
          size="small"
          min={1}
          max={3}
          value={item.repeat_count}
          aria-label={`采样次数 ${item.text}`}
          onChange={(value) => {
            if (typeof value === 'number' && value !== item.repeat_count) {
              onRepeatCountChange(item, value);
            }
          }}
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_, item) => (
        <Space size={0}>
          <Button size="small" type="link" onClick={() => onEdit(item)}>
            编辑
          </Button>
          <Tooltip title="删除后不可恢复，可先导出 CSV 备份">
            <Button size="small" type="link" danger onClick={() => onDelete(item)}>
              删除
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
      loading={loading}
      columns={columns}
      dataSource={items}
      rowSelection={{
        columnWidth: 36,
        selectedRowKeys,
        onChange: (keys) => onSelectionChange(keys.map(String)),
      }}
      pagination={{ pageSize: 20, showSizeChanger: true, size: 'small' }}
      locale={{ emptyText: '题库为空，点上方「生成题库」开始' }}
    />
  );
}

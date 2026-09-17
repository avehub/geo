import { InputNumber, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import type { PromptItem } from '../api/types';
import { INTENT_LABELS } from '../api/types';

const SOURCE_LABELS: Record<PromptItem['source'], string> = {
  template: '模板',
  generated: 'AI 生成',
  rewritten: '口语化改写',
  manual: '人工',
  imported: 'CSV 导入',
};

export interface PromptTableProps {
  items: PromptItem[];
  loading?: boolean;
  onWeightChange: (item: PromptItem, weight: number) => void;
}

/** Prompt 题库表格：文本、意图、权重（1–5 核心词加权）、分组、来源与同框竞品数。 */
export default function PromptTable({ items, loading = false, onWeightChange }: PromptTableProps) {
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
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 100,
      render: (_, item) => SOURCE_LABELS[item.source] ?? item.source,
    },
    {
      title: '同框竞品',
      dataIndex: 'competitor_ids',
      key: 'competitor_ids',
      width: 90,
      render: (_, item) => item.competitor_ids.length,
    },
    { title: '采样', dataIndex: 'repeat_count', key: 'repeat_count', width: 64 },
  ];

  return (
    <Table<PromptItem>
      rowKey="id"
      size="small"
      loading={loading}
      columns={columns}
      dataSource={items}
      pagination={{ pageSize: 20, showSizeChanger: true, size: 'small' }}
      locale={{ emptyText: '题库为空，点上方「生成题库」开始' }}
    />
  );
}

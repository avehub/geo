import { Button, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import type { ContentStatus, FaqItem } from '../api/types';
import { CONTENT_STATUS_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

export interface FaqTableProps {
  rows: FaqItem[];
  loading?: boolean;
  selectedRowKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  onStatusChange: (row: FaqItem, status: ContentStatus) => void;
  onEdit: (row: FaqItem) => void;
  onDelete: (row: FaqItem) => void;
}

/**
 * FAQ 常见问题库表格（spec `2026-09-30-keyword-faq-library-design.md` §3 / §8）。
 *
 * 答案是 Markdown 原文，展开行里按**预格式文本**渲染（`whiteSpace: 'pre-wrap'`）：
 * 🔴 demo 不引 Markdown 解析器（与 `api/content-compose.ts` 对 `html` 那一支同一个取舍），
 * 走查的是"答案成对沉淀 + 能导出成结构化数据"这条链路，不是排版。
 *
 * `category` 是**自由文本数据**（不是枚举）⇒ 不查词典；空白显示「未分类」
 * （`library.filters.uncategorized`，那是界面文案，走词典）。
 */
export default function FaqTable({
  rows,
  loading = false,
  selectedRowKeys,
  onSelectionChange,
  onStatusChange,
  onEdit,
  onDelete,
}: FaqTableProps) {
  const { t } = useTranslation();

  const columns: ColumnsType<FaqItem> = [
    {
      title: '#',
      dataIndex: 'position',
      key: 'position',
      width: 52,
      render: (_, row) => <Typography.Text type="secondary">{row.position + 1}</Typography.Text>,
    },
    {
      title: t('library.faq.question'),
      dataIndex: 'question',
      key: 'question',
      render: (_, row) => <Typography.Text strong>{row.question}</Typography.Text>,
    },
    {
      title: t('library.columns.category'),
      dataIndex: 'category',
      key: 'category',
      width: 108,
      render: (_, row) =>
        row.category === null ? (
          <Typography.Text type="secondary">{t('library.filters.uncategorized')}</Typography.Text>
        ) : (
          <Tag>{row.category}</Tag>
        ),
    },
    {
      title: t('library.columns.intent'),
      dataIndex: 'intent',
      key: 'intent',
      width: 110,
      render: (_, row) => <Tag color="blue">{enumLabel(t, 'prompt.intents', row.intent)}</Tag>,
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
          aria-label={t('library.columns.statusAria', { text: row.question })}
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
    <Table<FaqItem>
      size="small"
      rowKey="id"
      loading={loading}
      columns={columns}
      dataSource={rows}
      scroll={{ x: 900 }}
      // 与 `KeywordTable` 同一档（20）：素材库的量级是几十到几百条，两页的翻页口径不该不一样，
      // 否则"点一次生成 → 新增那批在界面上看得见"这条走查会被第一页截断（spec §11.4）。
      pagination={{ pageSize: 20, showSizeChanger: false }}
      rowSelection={{
        selectedRowKeys,
        onChange: (keys) => onSelectionChange(keys.map(String)),
      }}
      expandable={{
        // 展开行 = 答案原文（预格式文本，见文件头）。
        expandedRowRender: (row) => (
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('library.faq.answerPreview')}
            </Typography.Text>
            <Typography.Paragraph
              style={{ whiteSpace: 'pre-wrap', marginBottom: 0, marginTop: 4 }}
            >
              {row.answer_markdown}
            </Typography.Paragraph>
            {row.source === 'generated' && row.status !== 'approved' ? (
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                {t('library.faq.complianceUnchecked')}
              </Typography.Text>
            ) : null}
          </div>
        ),
      }}
      locale={{ emptyText: t('library.faq.empty') }}
    />
  );
}

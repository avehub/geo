import type { ReactElement } from 'react';
import { Button, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';

import type { Article, ArticleStatus } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { dateTimeText } from './format';

export interface ArticleReviewTableProps {
  rows: Article[];
  loading?: boolean;
  selectedIds: string[];
  /** 方向 id → 标题；模板 id → 名称（页面层查好再传进来，表格不自己取第二份数据）。 */
  directionTitleOf: (directionId: string) => string;
  templateNameOf: (templateId: string) => string;
  onSelectIds: (ids: string[]) => void;
  onPreview: (row: Article) => void;
}

const STATUS_COLORS: Record<ArticleStatus, string> = {
  pending_review: 'orange',
  approved: 'green',
  rejected: 'red',
};

/** 关联对象被删掉时的回落（本轮没有删方向的命令，模板删除后文章仍在队列里 ⇒ 这一支会走到）。 */
function linkedText(value: string): ReactElement {
  return value === '' ? (
    <Typography.Text type="secondary">—</Typography.Text>
  ) : (
    <Typography.Text type="secondary">{value}</Typography.Text>
  );
}

/**
 * ③ 文章评审队列（spec 2026-10-10 · DR-86③，形态照 `KbTable` 的密集表格视图）。
 *
 * # 🔴 待审行常驻那句免责标签（AGENTS 规则 6 的 demo 侧对价）
 * `review.complianceUnchecked` 挂在**标题下面**而不是状态标签的 tooltip 里：生成物一律
 * `pending_review`，"这批稿子没跑过合规扫描"必须在扫一眼队列时就看见，不该靠 hover 才出现。
 * 通过之后它随之消失——评审这道闸过了，这句话就不再成立。
 *
 * # 🔴 正文不进表格
 * 队列只给标题与元信息，正文走预览抽屉（`ArticlePreviewDrawer`）：Markdown 原文塞进单元格
 * 会把行高撑成三屏，而"要不要通过"靠的是读全文，不是读摘要。
 *
 * # 字数是**预置静态值**（规则 9）
 * 直接按数字显示，不做千分位格式化：`word_count` 在 demo 里是种子写死的，格式化只会让它
 * 看起来像一个算出来的指标。
 */
export default function ArticleReviewTable({
  rows,
  loading = false,
  selectedIds,
  directionTitleOf,
  templateNameOf,
  onSelectIds,
  onPreview,
}: ArticleReviewTableProps) {
  const { t } = useTranslation();

  const columns: ColumnsType<Article> = [
    {
      title: t('article.review.columns.title'),
      dataIndex: 'title',
      key: 'title',
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{row.title}</Typography.Text>
          {row.status === 'pending_review' ? (
            <Tag color="orange">{t('article.review.complianceUnchecked')}</Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: t('article.review.columns.direction'),
      dataIndex: 'direction_id',
      key: 'direction_id',
      width: 200,
      render: (_, row) => linkedText(directionTitleOf(row.direction_id)),
    },
    {
      title: t('article.review.columns.template'),
      dataIndex: 'template_id',
      key: 'template_id',
      width: 180,
      render: (_, row) => linkedText(templateNameOf(row.template_id)),
    },
    {
      title: t('article.review.columns.source'),
      dataIndex: 'source',
      key: 'source',
      width: 104,
      render: (_, row) => enumLabel(t, 'article.sources', row.source),
    },
    {
      title: t('article.review.columns.status'),
      dataIndex: 'status',
      key: 'status',
      width: 104,
      render: (_, row) => (
        <Tag color={STATUS_COLORS[row.status]}>{enumLabel(t, 'article.statuses', row.status)}</Tag>
      ),
    },
    {
      title: t('article.review.columns.words'),
      dataIndex: 'word_count',
      key: 'word_count',
      width: 84,
      align: 'right',
      render: (_, row) => row.word_count,
    },
    {
      title: t('article.review.columns.generatedAt'),
      dataIndex: 'generated_at',
      key: 'generated_at',
      width: 148,
      render: (_, row) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {dateTimeText(row.generated_at)}
        </Typography.Text>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 88,
      fixed: 'right',
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => onPreview(row)}>
          {t('article.review.preview')}
        </Button>
      ),
    },
  ];

  return (
    <div data-testid="article-review-table">
      <Table<Article>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1180 }}
        pagination={false}
        locale={{ emptyText: t('article.review.empty') }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => onSelectIds(keys.map((key) => String(key))),
        }}
      />
    </div>
  );
}

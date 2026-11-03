import { Button, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';

import type { ArticleTemplate } from '../api/types';
import { countText, dateTimeText } from './format';
import { enumLabel } from '../i18n/enum-label';

export interface ArticleTemplateTableProps {
  rows: ArticleTemplate[];
  loading?: boolean;
  /** 方向 id → 方向标题（页面层拿方向清单查好再传进来：表格不自己去取第二份数据）。 */
  directionTitleOf: (directionId: string) => string;
  /** 正在「立即生成」的那一行（按钮只让被点的那行转圈，口径照 `SitePatchTable`）。 */
  busyId?: string | null;
  onEdit: (row: ArticleTemplate) => void;
  onRunNow: (row: ArticleTemplate) => void;
  onDelete: (row: ArticleTemplate) => void;
}

/**
 * ② 提示词模板列表（spec 2026-10-10 · DR-86②）。
 *
 * # 为什么模板用表格、方向用卡片
 * 模板是**结构化配置**（挂在哪个方向下、用了哪些槽位、目标字数、最后更新时间），
 * 一屏要能横向对比；方向是散文式的主张（见 `ArticleDirectionCards`）。
 * 同一页里两种密度并存，正是 survey §4B「模板编辑器（抽屉）+ 方向卡」那一组形态。
 *
 * # 槽位以 chips 展示（DR-84 / DR-86②）
 * `slots` 是正文里出现过的槽位清单，标签走 `enumLabel(t, 'article.slots', …)`（DR-88）。
 * 🔴 绑定的知识模块**不在表格里**：它只是"引用了什么"的账（DR-89），放抽屉里以 chips 展示，
 * 免得表格宽到要横向滚动才看得清模板名。
 *
 * 所有写操作经回调交给页面层，组件本身不直连 IPC（照 `KeywordTable` 的分工）。
 */
export default function ArticleTemplateTable({
  rows,
  loading = false,
  directionTitleOf,
  busyId = null,
  onEdit,
  onRunNow,
  onDelete,
}: ArticleTemplateTableProps) {
  const { t } = useTranslation();

  const columns: ColumnsType<ArticleTemplate> = [
    {
      title: t('article.templates.columns.name'),
      dataIndex: 'name',
      key: 'name',
      render: (_, row) => <Typography.Text strong>{row.name}</Typography.Text>,
    },
    {
      title: t('article.templates.columns.direction'),
      dataIndex: 'direction_id',
      key: 'direction_id',
      width: 220,
      // 🔴 显示方向**标题**而不是 direction_id：裸 id 上屏等于把内部记号端给用户。
      // 方向被删掉时（本轮没有删方向的命令，防御性写法）回落空值占位符。
      render: (_, row) => {
        const title = directionTitleOf(row.direction_id);
        return title === '' ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text type="secondary">{title}</Typography.Text>
        );
      },
    },
    {
      title: t('article.templates.columns.slots'),
      dataIndex: 'slots',
      key: 'slots',
      width: 260,
      render: (_, row) => (
        <Space size={4} wrap>
          {row.slots.map((slot) => (
            <Tag key={slot}>{enumLabel(t, 'article.slots', slot)}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t('article.templates.columns.style'),
      dataIndex: 'style',
      key: 'style',
      width: 120,
      render: (_, row) =>
        row.style === '' ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.style}
          </Typography.Text>
        ),
    },
    {
      title: t('article.templates.columns.length'),
      dataIndex: 'length',
      key: 'length',
      width: 96,
      align: 'right',
      render: (_, row) => countText(row.length),
    },
    {
      title: t('article.templates.columns.updatedAt'),
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 148,
      render: (_, row) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {dateTimeText(row.updated_at)}
        </Typography.Text>
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 210,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => onEdit(row)}>
            {t('article.templates.edit')}
          </Button>
          <Button
            type="link"
            size="small"
            loading={busyId === row.id}
            onClick={() => onRunNow(row)}
          >
            {t('article.templates.runNow')}
          </Button>
          <Button type="link" size="small" danger onClick={() => onDelete(row)}>
            {t('article.templates.delete')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div data-testid="article-template-table">
      <Table<ArticleTemplate>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1120 }}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        locale={{ emptyText: t('article.templates.empty') }}
      />
    </div>
  );
}

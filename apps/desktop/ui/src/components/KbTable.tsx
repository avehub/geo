import { Button, Space, Table, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';

import { enumLabel } from '../i18n/enum-label';
import type { KbRow } from './kb-view';
import StatusChip from './ui/StatusChip';

export interface KbTableProps {
  rows: KbRow[];
  selectedIds: string[];
  busyId: string | null;
  onSelectIds: (ids: string[]) => void;
  onEdit: (row: KbRow) => void;
  onDelete: (row: KbRow) => void;
  onVerify: (row: KbRow) => void;
  onCopy: (row: KbRow) => void;
}

/**
 * 表格视图（DR-76 的 `table` 档；2026-10-31 起是**默认视图**）。
 *
 * 一屏 50 行、48px 行高：25 条种子条目一页放得下，这是「知识库压到 2 屏」的落点。
 * 标题列把「模块 / 形式 / 场景」收进右侧弱文本（超长省略），不再各占一列；
 * 状态用统一 `StatusChip`；动作四个文字按钮，24px 高。
 */
export default function KbTable({
  rows,
  selectedIds,
  busyId,
  onSelectIds,
  onEdit,
  onDelete,
  onVerify,
  onCopy,
}: KbTableProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const columns: ColumnsType<KbRow> = [
    {
      title: t('kb.view.columns.title'),
      dataIndex: 'title',
      width: 280,
      render: (title: string, row) => {
        const meta = [
          enumLabel(t, 'kb.modules', row.module),
          enumLabel(t, 'kb.kinds', row.kind),
          row.scenario === null ? null : enumLabel(t, 'kb.scenarios', row.scenario),
        ]
          .filter((part): part is string => part !== null)
          .join(' · ');
        return (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: 14,
                lineHeight: '24px',
                flexShrink: 0,
                maxWidth: '55%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 12,
                lineHeight: '22px',
                color: token.colorTextTertiary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {meta}
            </span>
          </div>
        );
      },
    },
    {
      title: t('kb.view.columns.status'),
      dataIndex: 'status',
      width: 96,
      render: (status: KbRow['status']) => (
        <StatusChip
          status={status === 'approved' ? 'ok' : status === 'rejected' ? 'error' : 'warning'}
          label={enumLabel(t, 'action.contentStatuses', status)}
        />
      ),
    },
    {
      title: t('kb.view.columns.source'),
      dataIndex: 'source',
      width: 88,
      render: (source: KbRow['source']) => enumLabel(t, 'kb.sources', source),
    },
    {
      title: t('kb.view.columns.updatedAt'),
      dataIndex: 'updatedAt',
      width: 108,
      render: (updatedAt: string) => updatedAt.slice(0, 10),
    },
    {
      title: t('kb.view.columns.actions'),
      width: 208,
      render: (_unused, row) => (
        <Space size={2}>
          <Button type="text" size="small" onClick={() => onCopy(row)}>
            {t('kb.actions.copy')}
          </Button>
          <Button type="text" size="small" onClick={() => onEdit(row)}>
            {t('kb.actions.edit')}
          </Button>
          <Button type="text" size="small" loading={busyId === row.id} onClick={() => onVerify(row)}>
            {t('kb.actions.verify')}
          </Button>
          <Button type="text" size="small" danger onClick={() => onDelete(row)}>
            {t('kb.actions.delete')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Table<KbRow>
      rowKey="id"
      size="middle"
      tableLayout="fixed"
      scroll={{ x: 780 }}
      columns={columns}
      dataSource={rows}
      pagination={{ pageSize: 20, showSizeChanger: false }}
      rowSelection={{
        selectedRowKeys: selectedIds,
        onChange: (keys) => onSelectIds(keys.map((key) => String(key))),
      }}
    />
  );
}

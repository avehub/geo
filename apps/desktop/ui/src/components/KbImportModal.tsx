import { useState } from 'react';
import { Alert, Modal, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';

import { enumLabel } from '../i18n/enum-label';
import type { KbImportRow } from './kb-import';

export interface KbImportModalProps {
  rows: KbImportRow[];
  importing: boolean;
  onCancel: () => void;
  onImport: (rows: KbImportRow[]) => void;
}

/**
 * 「从实体卡导入」勾选弹窗（DR-81）。
 *
 * 🔴 两句口径必须看见：① 导入是**一次性复制**（`kb.import.hint` 常驻 Alert）；
 * ② 每行的落入状态继承源头可信度（`official` → 已通过，其余 → 待审核），
 * 存疑的内容不会借着导入直接变成可交付。
 */
export default function KbImportModal({ rows, importing, onCancel, onImport }: KbImportModalProps) {
  const { t } = useTranslation();
  // 🔴 默认全勾选，但**不能在 useState 初值里算**：Modal 打开时 `project_get` 还在飞，
  // 首帧 `rows === []`，初值会是空数组且再也不更新 ⇒ OK 按钮永久置灰（走查过的那个坑）。
  // 用 React 官方的「prop 变化时调整 state」写法（渲染期比较、连着两次 setState），
  // 而不是 effect：effect 体里的同步 setState 会被 `react-hooks/set-state-in-effect`
  // 判成级联渲染（M6 那一轮门禁点名的就是它）。
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [rowsSeen, setRowsSeen] = useState<KbImportRow[]>(rows);
  if (rowsSeen !== rows) {
    setRowsSeen(rows);
    setSelectedKeys(rows.map((row) => row.key));
  }

  const columns: ColumnsType<KbImportRow> = [
    {
      title: t('kb.import.columnPreview'),
      dataIndex: 'title',
      render: (_unused, row) => (
        <>
          <Typography.Text strong>{row.title}</Typography.Text>
          <Typography.Paragraph
            type="secondary"
            ellipsis={{ rows: 1 }}
            style={{ marginBottom: 0, fontSize: 12 }}
          >
            {row.body}
          </Typography.Paragraph>
        </>
      ),
    },
    {
      title: t('kb.import.columnModule'),
      dataIndex: 'module',
      width: 120,
      render: (module: KbImportRow['module']) => enumLabel(t, 'kb.modules', module),
    },
    {
      title: t('kb.import.columnStatus'),
      dataIndex: 'status',
      width: 100,
      render: (status: KbImportRow['status']) => (
        <Tag color={status === 'approved' ? 'green' : 'orange'}>
          {enumLabel(t, 'action.contentStatuses', status)}
        </Tag>
      ),
    },
  ];

  const selected = rows.filter((row) => selectedKeys.includes(row.key));

  return (
    <Modal
      open
      width={760}
      title={t('kb.import.title')}
      okText={t('kb.import.submit')}
      cancelText={t('common.cancel')}
      confirmLoading={importing}
      okButtonProps={{ disabled: selected.length === 0 }}
      onCancel={onCancel}
      onOk={() => onImport(selected)}
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('kb.import.hint')} />
      {rows.length === 0 ? (
        <Typography.Paragraph type="secondary">{t('kb.import.empty')}</Typography.Paragraph>
      ) : (
        <Table<KbImportRow>
          rowKey="key"
          size="small"
          columns={columns}
          dataSource={rows}
          pagination={false}
          // 🔴 `scroll.y` 不是可有可无的滚动条：antd 一旦设了 `scroll.y` 就把 `tableLayout`
          // 收成 fixed，预览列才会被夹在弹窗宽度里——产品行的正文是**一整行没有空格的 JSON**，
          // auto 布局下它会把整张表撑出弹窗（走查实拍到的那个横向溢出）。
          scroll={{ y: 360 }}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys.map((key) => String(key))),
          }}
        />
      )}
    </Modal>
  );
}

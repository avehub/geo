import { Modal, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';

import type { SitePatchEvent } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { dateTimeText } from './format';

export interface SitePatchHistoryModalProps {
  /** 打开的是哪一条补丁（`null` = 关闭）。标题里带上它的名字，免得同时开过几条之后分不清。 */
  patchTitle: string | null;
  events: SitePatchEvent[];
  loading?: boolean;
  onClose: () => void;
}

/**
 * 一条补丁的**全量历史**（spec DR-45 / DR-47：照 Ahrefs Patches 的 "Show history"）。
 *
 * # 🔴 时间正序，与实体卡的修订时间线刻意相反
 * `db.ts` 的 `sitePatchEventsOf` 按 `created_at ASC` 排：历史是"从头读到尾"的一本账
 * （这条补丁是怎么从草案走到线上的），而修订时间线是"最近改了什么"。两个方向都成立，
 * 但混着用会让读者以为最上面那条是最新的。
 *
 * # 为什么历史值得单独一个弹窗
 * 它是"谁在什么时候把什么改上线了"的唯一凭据，也是 M6.5 与 M7 报告证据附录对齐的那一环。
 * 台账表里放不下（一行 8 条事件就把表撑爆了），所以行内只留一个入口。
 */
export default function SitePatchHistoryModal({
  patchTitle,
  events,
  loading = false,
  onClose,
}: SitePatchHistoryModalProps) {
  const { t } = useTranslation();

  const columns: ColumnsType<SitePatchEvent> = [
    {
      title: t('site.history.at'),
      dataIndex: 'created_at',
      width: 150,
      render: (_, row) => (
        <Typography.Text style={{ fontSize: 12 }}>{dateTimeText(row.created_at)}</Typography.Text>
      ),
    },
    {
      title: t('site.patches.columns.status'),
      dataIndex: 'kind',
      width: 120,
      render: (_, row) => <Tag>{enumLabel(t, 'site.eventKinds', row.kind)}</Tag>,
    },
    {
      title: t('site.history.channel'),
      dataIndex: 'channel_kind',
      width: 150,
      render: (_, row) =>
        row.channel_kind === null ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text style={{ fontSize: 12 }}>
            {enumLabel(t, 'site.channelKinds', row.channel_kind)}
          </Typography.Text>
        ),
    },
    {
      title: t('site.history.note'),
      dataIndex: 'note',
      render: (_, row) =>
        row.note === null ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text style={{ fontSize: 12 }}>{row.note}</Typography.Text>
        ),
    },
  ];

  return (
    <Modal
      open
      title={patchTitle === null ? t('site.history.title') : `${t('site.history.title')} · ${patchTitle}`}
      width={760}
      footer={null}
      onCancel={onClose}
    >
      <Table<SitePatchEvent>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={events}
        pagination={false}
        locale={{ emptyText: t('site.history.empty') }}
      />
    </Modal>
  );
}

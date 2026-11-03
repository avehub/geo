import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  LinkOutlined,
  PictureOutlined,
  ProfileOutlined,
  SoundOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Button, Card, Checkbox, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { KbEntryKind } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import StatusChip from './ui/StatusChip';
import { isMediaKind, isScriptModule, type KbRow } from './kb-view';

const KIND_ICONS: Record<KbEntryKind, typeof ProfileOutlined> = {
  statement: ProfileOutlined,
  text: FileTextOutlined,
  link: LinkOutlined,
  image: PictureOutlined,
  video: VideoCameraOutlined,
  file: FileTextOutlined,
};

export interface KbEntryCardProps {
  row: KbRow;
  selected: boolean;
  busy: boolean;
  onSelect: (row: KbRow, selected: boolean) => void;
  onEdit: (row: KbRow) => void;
  onDelete: (row: KbRow) => void;
  onVerify: (row: KbRow) => void;
  onCopy: (row: KbRow) => void;
  onPreview: (row: KbRow) => void;
}

/**
 * 一条知识的卡片（M1.2b · DR-78 / DR-79）。
 *
 * # 按形式渲染，不再"一种卡片装所有"
 * - `statement` 与话术模块：**引文体**（左竖线）+ 一键复制（Intercom / Help Scout 的
 *   saved-reply 同族——话术的价值在"能立刻粘出去"）；
 * - `text`：三行折叠 + 展开（Notion 卡片摘要同族）；
 * - `link`：地址外链 chip；
 * - 媒体三档：**画廊格**（类型图标 + mime 徽章），点击开预览 Drawer，不拉远端流（规则 2）。
 *
 * 🔴 复制按钮只给"有正文可复制"的形式（statement / text / 话术）：给图片卡一个复制按钮
 * 复制出来的是图注，用户会以为复制了图片地址。
 */
export default function KbEntryCard({
  row,
  selected,
  busy,
  onSelect,
  onEdit,
  onDelete,
  onVerify,
  onCopy,
  onPreview,
}: KbEntryCardProps) {
  const { t } = useTranslation();
  const Icon = KIND_ICONS[row.kind];
  const script = isScriptModule(row.module);
  const copyable = row.kind === 'statement' || row.kind === 'text' || script;

  // 头部只留「勾选 / 图标 / 标题 / 状态」四项：种类、场景、来源下沉到 meta 行，
  // 否则 5 个 Tag 在 300–400px 的卡片里会折成两行，卡片高度直接多 30px。
  const statusChip =
    row.status === 'approved' ? 'ok' : row.status === 'rejected' ? 'error' : 'warning';
  const head = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <Checkbox
        checked={selected}
        aria-label={row.title}
        onChange={(event) => onSelect(row, event.target.checked)}
      />
      <Icon aria-hidden />
      <Typography.Text strong ellipsis style={{ flex: 1, minWidth: 0 }}>
        {row.title}
      </Typography.Text>
      <StatusChip
        status={statusChip}
        label={enumLabel(t, 'action.contentStatuses', row.status)}
      />
    </div>
  );

  const actions = (
    <Space size={2} wrap>
      {copyable ? (
        <Button
          type="text"
          size="small"
          icon={<CopyOutlined />}
          aria-label={t('kb.actions.copy')}
          onClick={() => onCopy(row)}
        >
          {t('kb.actions.copy')}
        </Button>
      ) : null}
      <Button
        type="text"
        size="small"
        icon={<EditOutlined />}
        aria-label={t('kb.actions.edit')}
        onClick={() => onEdit(row)}
      >
        {t('kb.actions.edit')}
      </Button>
      <Button
        type="text"
        size="small"
        loading={busy}
        aria-label={t('kb.actions.verify')}
        onClick={() => onVerify(row)}
      >
        {t('kb.actions.verify')}
      </Button>
      <Button
        type="text"
        size="small"
        danger
        icon={<DeleteOutlined />}
        aria-label={t('kb.actions.delete')}
        onClick={() => onDelete(row)}
      >
        {t('kb.actions.delete')}
      </Button>
    </Space>
  );

  const meta = (
    <div style={{ fontSize: 12, lineHeight: '18px', color: 'inherit' }}>
      <div style={{ color: 'inherit', opacity: 0.9 }}>
        {[
          enumLabel(t, 'kb.kinds', row.kind),
          row.scenario === null ? null : enumLabel(t, 'kb.scenarios', row.scenario),
          enumLabel(t, 'kb.sources', row.source),
        ]
          .filter((part): part is string => part !== null)
          .join(' · ')}
      </div>
      <Space size={6} wrap style={{ marginTop: 2 }}>
        {row.tags.slice(0, 2).map((tag) => (
          <Tag key={tag} style={{ marginInlineEnd: 0 }}>
            {tag}
          </Tag>
        ))}
        {row.tags.length > 2 ? <Tag style={{ marginInlineEnd: 0 }}>{`+${row.tags.length - 2}`}</Tag> : null}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {row.verifiedAt === null
            ? t('kb.entry.unverified')
            : t('kb.entry.verifiedAt', { time: row.verifiedAt.slice(0, 10) })}
          {' · '}
          {t('kb.entry.updatedAt', { time: row.updatedAt.slice(0, 10) })}
        </Typography.Text>
      </Space>
    </div>
  );

  if (isMediaKind(row.kind)) {
    return (
      <Card
        size="small"
        style={{ height: '100%' }}
        title={head}
        extra={
          <Button size="small" onClick={() => onPreview(row)} aria-label={t('kb.entry.preview')}>
            {t('kb.entry.preview')}
          </Button>
        }
      >
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <Space size={6}>
            <Icon style={{ fontSize: 22 }} aria-hidden />
            {row.mime === null ? null : <Tag>{row.mime}</Tag>}
          </Space>
          <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
            {row.body}
          </Typography.Paragraph>
          {meta}
          {actions}
        </Space>
      </Card>
    );
  }

  const body =
    row.kind === 'statement' || script ? (
      <div
        style={{
          borderLeft: '3px solid #1677ff',
          paddingLeft: 10,
          whiteSpace: 'pre-wrap',
        }}
      >
        <Typography.Paragraph
          ellipsis={{
            rows: 3,
            expandable: true,
            symbol: (isExpanded: boolean) =>
              isExpanded ? t('kb.entry.collapse') : t('kb.entry.expand'),
          }}
          style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}
        >
          {row.body}
        </Typography.Paragraph>
      </div>
    ) : row.kind === 'text' ? (
      <Typography.Paragraph
        ellipsis={{
          rows: 2,
          expandable: true,
          symbol: (isExpanded: boolean) => (isExpanded ? t('kb.entry.collapse') : t('kb.entry.expand')),
        }}
        style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}
      >
        {row.body}
      </Typography.Paragraph>
    ) : (
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {row.body.trim() === '' ? null : (
          <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
            {row.body}
          </Typography.Paragraph>
        )}
        {row.url === null ? null : (
          <Typography.Link href={row.url} target="_blank" rel="noreferrer noopener">
            <SoundOutlined aria-hidden /> {row.url}
          </Typography.Link>
        )}
      </Space>
    );

  return (
    <Card size="small" title={head}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        {body}
        {meta}
        {actions}
      </Space>
    </Card>
  );
}

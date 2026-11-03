import {
  FileTextOutlined,
  LinkOutlined,
  PictureOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Drawer, Space, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import { enumLabel } from '../i18n/enum-label';
import type { KbRow } from './kb-view';

export interface KbPreviewDrawerProps {
  row: KbRow | null;
  onClose: () => void;
}

const MEDIA_ICONS: Record<string, typeof PictureOutlined> = {
  image: PictureOutlined,
  video: VideoCameraOutlined,
  file: FileTextOutlined,
};

/**
 * 素材预览侧滑（DR-78）。
 * 🔴 **不加载远端媒体**（规则 2 / 测试不联网同族）：只展示类型图标、mime、地址与图注，
 * 并把原因写在面上（`kb.entry.mediaNote`）——用户不该猜"为什么图是空的"。
 */
export default function KbPreviewDrawer({ row, onClose }: KbPreviewDrawerProps) {
  const { t } = useTranslation();
  if (row === null) return null;
  const Icon = MEDIA_ICONS[row.kind] ?? LinkOutlined;

  return (
    <Drawer open width={480} title={row.title} onClose={onClose}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space size={6} wrap>
          <Tag>{enumLabel(t, 'kb.kinds', row.kind)}</Tag>
          {row.mime === null ? null : <Tag>{row.mime}</Tag>}
          <Tag>{enumLabel(t, 'kb.modules', row.module)}</Tag>
        </Space>
        <div
          style={{
            border: '1px dashed #d9d9d9',
            borderRadius: 8,
            padding: 28,
            textAlign: 'center',
          }}
        >
          <Icon style={{ fontSize: 40 }} aria-hidden />
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            {t('kb.entry.mediaNote')}
          </Typography.Paragraph>
        </div>
        {row.url === null ? null : (
          <Typography.Link href={row.url} target="_blank" rel="noreferrer noopener">
            {row.url}
          </Typography.Link>
        )}
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
          {row.body}
        </Typography.Paragraph>
      </Space>
    </Drawer>
  );
}

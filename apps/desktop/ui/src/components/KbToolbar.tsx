import {
  DeleteOutlined,
  DownloadOutlined,
  ImportOutlined,
  PlusOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Button, Segmented, Space, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ContentStatus, KbEntryKind, KbModule, KbSource } from '../api/types';

export type KbViewMode = 'group' | 'table';

export interface KbFilters {
  module: KbModule | 'all';
  kind: KbEntryKind | 'all';
  status: ContentStatus | 'all';
  source: KbSource | 'all';
  search: string;
}

export type KbExportKind = 'markdown' | 'json';

export interface KbToolbarProps {
  view: KbViewMode;
  onViewChange: (view: KbViewMode) => void;
  total: number;
  shown: number;
  selectedCount: number;
  exportDisabled: Record<KbExportKind, boolean>;
  onAdd: () => void;
  onImport: () => void;
  onGenerate: () => void;
  onVerify: () => void;
  onExport: (kind: KbExportKind) => void;
  onDelete: () => void;
}

/**
 * 工具条：搜索 + 四个过滤 + **视图切换**（DR-76）+ 全部动作入口。
 *
 * 🔴 状态过滤的选项标签查 `action.contentStatuses`（内容审核态全产品共用一张表，
 * 与条目卡 / 表格视图同口径）；模块 / 形式 / 来源查 `kb.*` 自己的表。
 * 🔴 导出置灰条件由调用方算好传进来（`api/kb-compose.ts` 的闸门）：零条可交付才置灰。
 */
export default function KbToolbar({
  view,
  onViewChange,
  total,
  shown,
  selectedCount,
  exportDisabled,
  onAdd,
  onImport,
  onGenerate,
  onVerify,
  onExport,
  onDelete,
}: KbToolbarProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 12,
      }}
    >
      <Space wrap size={8}>
        <Segmented
          aria-label={t('kb.view.label')}
          value={view}
          onChange={(next) => onViewChange(next as KbViewMode)}
          options={[
            { value: 'group', label: t('kb.view.group') },
            { value: 'table', label: t('kb.view.table') },
          ]}
        />
        <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
          {t('kb.filters.shown', { shown, total })}
        </span>
      </Space>
      <Space wrap size={8}>
        <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
          {t('kb.entry.add')}
        </Button>
        <Button icon={<ImportOutlined />} onClick={onImport}>
          {t('kb.actions.import')}
        </Button>
        <Button icon={<RobotOutlined />} onClick={onGenerate}>
          {t('kb.actions.generate')}
        </Button>
        <Button
          icon={<SafetyCertificateOutlined />}
          disabled={selectedCount === 0}
          onClick={onVerify}
        >
          {t('kb.actions.batchVerify')}
        </Button>
        <Button
          icon={<DownloadOutlined />}
          disabled={exportDisabled.markdown}
          onClick={() => onExport('markdown')}
        >
          {t('kb.actions.exportMarkdown')}
        </Button>
        <Button
          icon={<DownloadOutlined />}
          disabled={exportDisabled.json}
          onClick={() => onExport('json')}
        >
          {t('kb.actions.exportJson')}
        </Button>
        <Button danger icon={<DeleteOutlined />} disabled={selectedCount === 0} onClick={onDelete}>
          {t('kb.actions.batchDelete')}
        </Button>
      </Space>
    </div>
  );
}

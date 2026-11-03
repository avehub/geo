import { Button, Input, Select, Space, Typography } from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import {
  SITE_CHANNEL_KIND_VALUES,
  SITE_PATCH_KIND_VALUES,
  SITE_PATCH_STATUS_VALUES,
} from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import type { SitePatchFilters } from './site-patch-filters';

export interface SitePatchToolbarProps {
  filters: SitePatchFilters;
  onFiltersChange: (filters: SitePatchFilters) => void;
  /** 筛选后 / 全部（那句「显示 x / y 条」）。 */
  shown: number;
  total: number;
  selectedCount: number;
  onGenerate: () => void;
  onAdd: () => void;
  onExport: () => void;
  onDeleteSelected: () => void;
}

/**
 * 补丁工作台的工具条：四个筛选 + 四个动作（spec DR-54 第 3 块）。
 *
 * 🔴 拆出来的理由不只是行数：这一条上「筛选」与「动作」是两种东西，
 * 混在页面的 JSX 里会让 `SitePage` 的 return 变成一屏按钮。
 * 筛选状态由页面持有（它要用来算导出哪一批），本组件只是它的受控视图。
 *
 * 🔴 搜索框**同时**挂 `onChange` 与 `onSearch`：前者让筛选跟着打字走（几十条数据没有防抖的必要），
 * 后者让回车与那个放大镜按钮也有反应——只挂一个的话，另一种操作方式就是哑的。
 */
export default function SitePatchToolbar({
  filters,
  onFiltersChange,
  shown,
  total,
  selectedCount,
  onGenerate,
  onAdd,
  onExport,
  onDeleteSelected,
}: SitePatchToolbarProps) {
  const { t } = useTranslation();
  const patch = (values: Partial<SitePatchFilters>) => onFiltersChange({ ...filters, ...values });

  return (
    <Space wrap style={{ marginBottom: 12 }}>
      <Input.Search
        allowClear
        style={{ width: 220 }}
        aria-label={t('site.patches.search')}
        placeholder={t('site.patches.search')}
        value={filters.search}
        onChange={(event) => patch({ search: event.target.value })}
        onSearch={(value) => patch({ search: value })}
      />
      <Select
        style={{ width: 132 }}
        aria-label={t('site.patches.columns.status')}
        value={filters.status}
        onChange={(value: SitePatchFilters['status']) => patch({ status: value })}
        options={[
          { value: 'all', label: t('site.patches.filterStatus') },
          ...SITE_PATCH_STATUS_VALUES.map((value) => ({
            value,
            label: enumLabel(t, 'site.patchStatuses', value),
          })),
        ]}
      />
      <Select
        style={{ width: 190 }}
        aria-label={t('site.patches.columns.kind')}
        value={filters.kind}
        onChange={(value: SitePatchFilters['kind']) => patch({ kind: value })}
        options={[
          { value: 'all', label: t('site.patches.filterKind') },
          ...SITE_PATCH_KIND_VALUES.map((value) => ({
            value,
            label: enumLabel(t, 'site.patchKinds', value),
          })),
        ]}
      />
      <Select
        style={{ width: 170 }}
        aria-label={t('site.patches.columns.channel')}
        value={filters.channel}
        onChange={(value: SitePatchFilters['channel']) => patch({ channel: value })}
        options={[
          { value: 'all', label: t('site.patches.filterChannel') },
          ...SITE_CHANNEL_KIND_VALUES.map((value) => ({
            value,
            label: enumLabel(t, 'site.channelKinds', value),
          })),
        ]}
      />
      <Button icon={<RobotOutlined />} onClick={onGenerate}>
        {t('site.patches.generate')}
      </Button>
      <Button icon={<PlusOutlined />} onClick={onAdd}>
        {t('site.patches.add')}
      </Button>
      <Button icon={<DownloadOutlined />} onClick={onExport}>
        {t('site.patches.export')}
      </Button>
      <Button
        danger
        icon={<DeleteOutlined />}
        disabled={selectedCount === 0}
        onClick={onDeleteSelected}
      >
        {selectedCount > 0
          ? t('site.patches.deleteSelectedCount', { selected: selectedCount })
          : t('site.patches.deleteSelected')}
      </Button>
      <Typography.Text type="secondary">
        {t('site.patches.filtered', { shown, total })}
      </Typography.Text>
    </Space>
  );
}

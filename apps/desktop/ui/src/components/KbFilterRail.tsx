import type { ReactNode } from 'react';
import { Button, Input, Select, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ContentStatus } from '../api/types';
import {
  KB_ENTRY_KIND_VALUES,
  KB_MODULE_VALUES,
  KB_SOURCE_VALUES,
} from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import type { KbFilters } from './KbToolbar';
import SectionCard from './ui/SectionCard';

const CONTENT_STATUSES: readonly ContentStatus[] = ['pending_review', 'approved', 'rejected'];

/**
 * 知识库左筛选轨（2026-10-31）。
 *
 * 把搜索与四个过滤从横向工具条搬进 200px 的竖轨：横向工具条一屏放不下，
 * 会挤到第二行、把首屏高度吃掉；竖轨则让「筛选」和「动作」各归其位（飞书/Notion 同族）。
 * 控件的 aria-label 与原来逐字相同——既有测试与读屏路径不变。
 */
export default function KbFilterRail({
  filters,
  onFiltersChange,
  onReset,
}: {
  filters: KbFilters;
  onFiltersChange: (patch: Partial<KbFilters>) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const all = t('kb.filters.all');

  const field = (label: string, control: ReactNode) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, lineHeight: '18px', color: token.colorTextSecondary }}>{label}</span>
      {control}
    </label>
  );

  return (
    <SectionCard title={t('kb.filters.title')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input.Search
          allowClear
          placeholder={t('kb.filters.searchPlaceholder')}
          aria-label={t('kb.filters.searchPlaceholder')}
          value={filters.search}
          onChange={(event) => onFiltersChange({ search: event.target.value })}
        />
        {field(
          t('kb.filters.module'),
          <Select
            style={{ width: '100%' }}
            aria-label={t('kb.filters.module')}
            value={filters.module}
            onChange={(module) => onFiltersChange({ module })}
            options={[
              { value: 'all', label: all },
              ...KB_MODULE_VALUES.map((module) => ({
                value: module,
                label: enumLabel(t, 'kb.modules', module),
              })),
            ]}
          />,
        )}
        {field(
          t('kb.filters.kind'),
          <Select
            style={{ width: '100%' }}
            aria-label={t('kb.filters.kind')}
            value={filters.kind}
            onChange={(kind) => onFiltersChange({ kind })}
            options={[
              { value: 'all', label: all },
              ...KB_ENTRY_KIND_VALUES.map((kind) => ({
                value: kind,
                label: enumLabel(t, 'kb.kinds', kind),
              })),
            ]}
          />,
        )}
        {field(
          t('kb.filters.status'),
          <Select
            style={{ width: '100%' }}
            aria-label={t('kb.filters.status')}
            value={filters.status}
            onChange={(status) => onFiltersChange({ status })}
            options={[
              { value: 'all', label: all },
              ...CONTENT_STATUSES.map((status) => ({
                value: status,
                label: enumLabel(t, 'action.contentStatuses', status),
              })),
            ]}
          />,
        )}
        {field(
          t('kb.filters.source'),
          <Select
            style={{ width: '100%' }}
            aria-label={t('kb.filters.source')}
            value={filters.source}
            onChange={(source) => onFiltersChange({ source })}
            options={[
              { value: 'all', label: all },
              ...KB_SOURCE_VALUES.map((source) => ({
                value: source,
                label: enumLabel(t, 'kb.sources', source),
              })),
            ]}
          />,
        )}
        <Button block onClick={onReset}>
          {t('kb.filters.reset')}
        </Button>
      </div>
    </SectionCard>
  );
}

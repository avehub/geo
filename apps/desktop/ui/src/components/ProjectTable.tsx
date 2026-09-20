import { Button, Dropdown, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import dayjs from 'dayjs';

import type { Project } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import type { TranslationKey } from '../i18n/resources';

/** 行内导出目标：项目全量 JSON、竞品 CSV、资产 CSV（spec FR-M1-6）。 */
export type ProjectExportKind = 'json' | 'competitors_csv' | 'assets_csv';

/**
 * 导出菜单。装**词典 key** 而不是译文：这是模块级常量，求值时没有 React 上下文
 * （同 `entity-fields.ts` 的裁定 B-2）。`key` 仍是 `ProjectExportKind`，与菜单回调同源。
 */
const EXPORT_MENU_ITEMS: { key: ProjectExportKind; labelKey: TranslationKey }[] = [
  { key: 'json', labelKey: 'project.export.json' },
  { key: 'competitors_csv', labelKey: 'project.export.competitorsCsv' },
  { key: 'assets_csv', labelKey: 'project.export.assetsCsv' },
];

export interface ProjectTableProps {
  projects: Project[];
  loading?: boolean;
  onOpenEntityCard: (project: Project) => void;
  onOpenPrompts: (project: Project) => void;
  onToggleArchive: (project: Project) => void;
  onDelete: (project: Project) => void;
  onExport: (project: Project, kind: ProjectExportKind) => void;
  onTagsChange: (project: Project, tags: string[]) => void;
}

/**
 * 行业列。`industry === 'other'` 且后端给了 `industry_label` 时优先显示**用户自己填的那个
 * 字符串**——那是数据不是标签，不查词典；其余情况查 `project.industries.<id>`，
 * 查不到回退 id 本身（`enumLabel`，照 `ProviderSelect` 的先例）。
 */
function industryLabel(t: TFunction, project: Project): string {
  if (project.industry === 'other' && project.industry_label) return project.industry_label;
  return enumLabel(t, 'project.industries', project.industry);
}

/**
 * 项目列表表格。所有写操作通过回调交给页面层，组件本身不直连 IPC。
 *
 * 行业标签查词典 `project.industries.<id>`（见 `industryLabel`）；运行时清单是
 * `api/types.ts` 的 `INDUSTRY_VALUES`（本组件不生成选项，只渲染后端发来的 id）。
 *
 * 别名列表用 `common.listSeparator` 连接而不是写死顿号：zh 用「、」、en 用「, 」，
 * 连接符本身就是需要翻译的文案。
 */
export default function ProjectTable({
  projects,
  loading = false,
  onOpenEntityCard,
  onOpenPrompts,
  onToggleArchive,
  onDelete,
  onExport,
  onTagsChange,
}: ProjectTableProps) {
  const { t } = useTranslation();

  const columns: ColumnsType<Project> = [
    {
      title: t('project.table.name'),
      dataIndex: 'name',
      key: 'name',
      render: (_, project) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{project.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('project.table.brand', { brand: project.brand_name })}
            {project.aliases.length > 0
              ? t('project.table.aliases', {
                  aliases: project.aliases.join(t('common.listSeparator')),
                })
              : ''}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('project.table.industry'),
      dataIndex: 'industry',
      key: 'industry',
      width: 160,
      render: (_, project) => industryLabel(t, project),
    },
    { title: t('project.table.region'), dataIndex: 'region', key: 'region', width: 120 },
    {
      title: t('project.table.tags'),
      dataIndex: 'tags',
      key: 'tags',
      width: 220,
      render: (_, project) => (
        <Select
          mode="tags"
          size="small"
          variant="borderless"
          style={{ width: '100%' }}
          open={false}
          suffixIcon={null}
          tokenSeparators={[',', '，']}
          placeholder={t('project.table.tagsPlaceholder')}
          aria-label={t('project.table.tagsAria', { name: project.name })}
          value={project.tags}
          onChange={(tags) => onTagsChange(project, tags as string[])}
        />
      ),
    },
    {
      title: t('project.table.status'),
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (_, project) =>
        project.status === 'archived' ? (
          <Tag color="default">{t('project.table.archived')}</Tag>
        ) : (
          <Tag color="blue">{t('project.table.active')}</Tag>
        ),
    },
    {
      title: t('project.table.updatedAt'),
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 150,
      render: (_, project) => dayjs(project.updated_at).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 330,
      render: (_, project) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => onOpenEntityCard(project)}>
            {t('project.table.openEntityCard')}
          </Button>
          <Button size="small" type="link" onClick={() => onOpenPrompts(project)}>
            {t('project.table.openPrompts')}
          </Button>
          <Button size="small" onClick={() => onToggleArchive(project)}>
            {project.status === 'archived' ? t('project.table.unarchive') : t('project.table.archive')}
          </Button>
          <Dropdown
            menu={{
              items: EXPORT_MENU_ITEMS.map((item) => ({ key: item.key, label: t(item.labelKey) })),
              onClick: ({ key }) => onExport(project, key as ProjectExportKind),
            }}
          >
            <Button size="small">{t('project.table.export')}</Button>
          </Dropdown>
          <Tooltip title={t('project.table.deleteHint')}>
            <Button size="small" danger onClick={() => onDelete(project)}>
              {t('common.delete')}
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Table<Project>
      rowKey="id"
      size="middle"
      loading={loading}
      columns={columns}
      dataSource={projects}
      pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
      locale={{ emptyText: t('project.table.empty') }}
    />
  );
}

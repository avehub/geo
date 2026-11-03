import { Button, Dropdown, Select, Space, Table, Tooltip, Typography, theme } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { Project } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { dateText } from './format';
import type { TranslationKey } from '../i18n/resources';
import StatusChip from './ui/StatusChip';

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
 * 项目列表表格（2026-10-30 三稿 · 飞书参照）。
 *
 * # 🔴 修掉的宽度事故
 * 一稿把行业 / 地域 / 标签 / 更新时间 / 操作都做成固定列（合计 1070px），
 * 项目名这一列没有宽度 ⇒ 在 1280 与 1024 下被压到 **30px**，名字竖着折成三行。
 * 三稿把「品牌 / 别名 / 行业 / 地域 / 更新时间」并进项目名下方的**副行**（超长省略 + Tooltip），
 * 表格只保留四列：项目（弹性）、标签、状态、操作。1024 下项目名仍有约 290px。
 *
 * # 行内动作
 * 归档 + 导出留在行内（高频、要一眼看到），实体卡 / 题库 / 删除收进「更多」菜单——
 * 飞书表格同族的做法，避免一行五个按钮把列宽吃掉。
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
  const { token } = theme.useToken();

  const columns: ColumnsType<Project> = [
    {
      title: t('project.table.name'),
      dataIndex: 'name',
      key: 'name',
      render: (_, project) => {
        // 别名紧贴品牌（它本来就是「品牌：X（别名 Y）」的括号补充），
        // 其余三段才用列表连接符——否则会出现「品牌：禾野、（别名 …）」这种断句。
        const brandText =
          t('project.table.brand', { brand: project.brand_name }) +
          (project.aliases.length > 0
            ? t('project.table.aliases', {
                aliases: project.aliases.join(t('common.listSeparator')),
              })
            : '');
        const metaParts = [
          brandText,
          industryLabel(t, project),
          project.region,
          t('project.table.updatedShort', {
            time: dateText(project.updated_at),
          }),
        ];
        const meta = metaParts.join(t('common.listSeparator'));

        return (
          // 单行主单元格：行高才能稳在 48（密度口径）。品牌 / 行业 / 地域 / 更新时间
          // 放在名字右侧的弱文本里，超长省略、悬停看全文——飞书表格同族。
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <Typography.Text
              strong
              ellipsis
              style={{ flexShrink: 0, maxWidth: '60%', fontSize: 14, lineHeight: '24px' }}
            >
              {project.name}
            </Typography.Text>
            <Tooltip title={meta} placement="topLeft">
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
                {metaParts.map((part, index) => (
                  // 每一段各自成节点：枚举守卫要能精确找到「industry 渲染成 id」的那一段，
                  // 同时整行仍然是一个可省略的单行。
                  <span key={part}>
                    {index === 0 ? null : (
                      <span style={{ marginInline: 4 }}>{t('common.listSeparator')}</span>
                    )}
                    <span>{part}</span>
                  </span>
                ))}
              </span>
            </Tooltip>
          </div>
        );
      },
    },
    {
      title: t('project.table.tags'),
      dataIndex: 'tags',
      key: 'tags',
      width: 200,
      render: (_, project) => (
        <Select
          mode="tags"
          size="small"
          maxTagCount={1}
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
      width: 88,
      render: (_, project) =>
        project.status === 'archived' ? (
          <StatusChip status="todo" label={t('project.table.archived')} />
        ) : (
          <StatusChip status="ok" label={t('project.table.active')} />
        ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 160,
      render: (_, project) => (
        <Space size={4}>
          <Button type="text" size="small" onClick={() => onToggleArchive(project)}>
            {project.status === 'archived' ? t('project.table.unarchive') : t('project.table.archive')}
          </Button>
          <Dropdown
            menu={{
              items: EXPORT_MENU_ITEMS.map((item) => ({ key: item.key, label: t(item.labelKey) })),
              onClick: ({ key }) => onExport(project, key as ProjectExportKind),
            }}
          >
            <Button type="text" size="small">{t('project.table.export')}</Button>
          </Dropdown>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'entity', label: t('project.table.openEntityCard'), onClick: () => onOpenEntityCard(project) },
                { key: 'prompts', label: t('project.table.openPrompts'), onClick: () => onOpenPrompts(project) },
                { type: 'divider' },
                {
                  key: 'delete',
                  label: t('common.delete'),
                  danger: true,
                  onClick: () => onDelete(project),
                },
              ],
            }}
          >
            <Button size="small" icon={<MoreOutlined />} aria-label={t('common.more')} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <Table<Project>
      rowKey="id"
      size="middle"
      tableLayout="fixed"
      loading={loading}
      columns={columns}
      dataSource={projects}
      pagination={{ pageSize: 20, showSizeChanger: false, hideOnSinglePage: true }}
      locale={{ emptyText: t('project.table.empty') }}
    />
  );
}

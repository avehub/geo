import { Button, Dropdown, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

import type { Project } from '../api/types';
import { INDUSTRY_LABELS } from '../api/types';

/** 行内导出目标：项目全量 JSON、竞品 CSV、资产 CSV（spec FR-M1-6）。 */
export type ProjectExportKind = 'json' | 'competitors_csv' | 'assets_csv';

const EXPORT_MENU_ITEMS = [
  { key: 'json', label: '项目 JSON（全量）' },
  { key: 'competitors_csv', label: '竞品 CSV' },
  { key: 'assets_csv', label: '资产 CSV' },
];

export interface ProjectTableProps {
  projects: Project[];
  loading?: boolean;
  onOpenEntityCard: (project: Project) => void;
  onOpenPrompts: (project: Project) => void;
  onToggleArchive: (project: Project) => void;
  onDelete: (project: Project) => void;
  onExport: (project: Project, kind: ProjectExportKind) => void;
}

function industryLabel(project: Project): string {
  if (project.industry === 'other' && project.industry_label) return project.industry_label;
  return INDUSTRY_LABELS[project.industry] ?? project.industry;
}

/** 项目列表表格。所有写操作通过回调交给页面层，组件本身不直连 IPC。 */
export default function ProjectTable({
  projects,
  loading = false,
  onOpenEntityCard,
  onOpenPrompts,
  onToggleArchive,
  onDelete,
  onExport,
}: ProjectTableProps) {
  const columns: ColumnsType<Project> = [
    {
      title: '项目名',
      dataIndex: 'name',
      key: 'name',
      render: (_, project) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{project.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            品牌：{project.brand_name}
            {project.aliases.length > 0 ? `（别名 ${project.aliases.join('、')}）` : ''}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '行业',
      dataIndex: 'industry',
      key: 'industry',
      width: 160,
      render: (_, project) => industryLabel(project),
    },
    { title: '地域', dataIndex: 'region', key: 'region', width: 120 },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      width: 180,
      render: (_, project) =>
        project.tags.length === 0 ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Space size={4} wrap>
            {project.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Space>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (_, project) =>
        project.status === 'archived' ? <Tag color="default">已归档</Tag> : <Tag color="blue">进行中</Tag>,
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 150,
      render: (_, project) => dayjs(project.updated_at).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 330,
      render: (_, project) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => onOpenEntityCard(project)}>
            实体卡
          </Button>
          <Button size="small" type="link" onClick={() => onOpenPrompts(project)}>
            题库
          </Button>
          <Button size="small" onClick={() => onToggleArchive(project)}>
            {project.status === 'archived' ? '取消归档' : '归档'}
          </Button>
          <Dropdown
            menu={{
              items: EXPORT_MENU_ITEMS,
              onClick: ({ key }) => onExport(project, key as ProjectExportKind),
            }}
          >
            <Button size="small">导出</Button>
          </Dropdown>
          <Tooltip title="删除后不可恢复">
            <Button size="small" danger onClick={() => onDelete(project)}>
              删除
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
      locale={{ emptyText: '还没有项目，点右上角「新建项目」开始' }}
    />
  );
}

import { useCallback, useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, Input, Space, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import { describeIpcError } from '../api/errors';
import type { Project, ProjectFilter } from '../api/types';
import ProjectTable, { type ProjectExportKind } from '../components/ProjectTable';

/** M1 入口：多项目列表、搜索、归档、删除与导出。 */
export default function ProjectListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const { t } = useTranslation();

  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const filter = useMemo<ProjectFilter>(
    () => ({ query: query.trim() === '' ? null : query.trim(), include_archived: includeArchived }),
    [query, includeArchived],
  );

  const listQuery = useQuery({
    queryKey: ['projects', filter],
    queryFn: () => client.projectList(filter),
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    [queryClient],
  );

  const archiveMutation = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      client.projectArchive(id, archived),
    onSuccess: (project) => {
      message.success(project.status === 'archived' ? '已归档' : '已取消归档');
      void invalidate();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => client.projectDelete(id),
    onSuccess: () => {
      message.success('项目已删除');
      void invalidate();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const tagsMutation = useMutation({
    mutationFn: ({ project, tags }: { project: Project; tags: string[] }) =>
      client.projectUpdate({ ...project, tags }),
    onSuccess: () => {
      message.success('标签已更新');
      void invalidate();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  async function handleExport(project: Project, kind: ProjectExportKind) {
    try {
      if (kind === 'json') {
        const payload = await client.projectExport(project.id);
        const saved = await client.exportWriteFile(
          `${project.brand_name}-geo-项目档案.json`,
          JSON.stringify(payload, null, 2),
          false,
        );
        if (saved !== null) message.success('项目 JSON 已导出');
        return;
      }
      const csv =
        kind === 'competitors_csv'
          ? await client.projectExportCompetitorsCsv(project.id)
          : await client.projectExportAssetsCsv(project.id);
      const label = kind === 'competitors_csv' ? '竞品' : '资产';
      const saved = await client.exportWriteFile(`${project.brand_name}-${label}.csv`, csv, true);
      if (saved !== null) message.success(`${label} CSV 已导出`);
    } catch (error) {
      message.error(describeIpcError(error, t));
    }
  }

  function confirmDelete(project: Project) {
    modal.confirm({
      title: `删除项目「${project.name}」？`,
      content: '项目下的实体卡、竞品、资产与 prompt 题库都会一并删除，且不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteMutation.mutateAsync(project.id),
    });
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>
            项目
          </Typography.Title>
          <Input.Search
            allowClear
            placeholder="搜索项目名或品牌名"
            style={{ width: 260 }}
            onSearch={(value) => setQuery(value)}
          />
          <Checkbox
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          >
            显示已归档
          </Checkbox>
        </Space>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void listQuery.refetch()}
            loading={listQuery.isFetching}
          >
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/projects/new/wizard')}>
            新建项目
          </Button>
        </Space>
      </Space>

      {listQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="加载项目失败"
          description={describeIpcError(listQuery.error, t)}
        />
      )}

      <ProjectTable
        projects={listQuery.data ?? []}
        loading={listQuery.isPending || listQuery.isFetching}
        onOpenEntityCard={(project) => navigate(`/projects/${project.id}/entity-card`)}
        onOpenPrompts={(project) => navigate(`/projects/${project.id}/prompts`)}
        onToggleArchive={(project) =>
          archiveMutation.mutate({ id: project.id, archived: project.status !== 'archived' })
        }
        onDelete={confirmDelete}
        onExport={(project, kind) => void handleExport(project, kind)}
        onTagsChange={(project, tags) => tagsMutation.mutate({ project, tags })}
      />

      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        提示：标签列可直接输入后回车增删（最多 20 个）；每行「导出」可下载项目 JSON（含实体卡、竞品、资产与题库），或单独的竞品 / 资产 CSV。
      </Typography.Paragraph>
    </div>
  );
}

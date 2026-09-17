import { useCallback, useMemo, useState } from 'react';
import { Alert, App, Button, Checkbox, Input, Space, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import * as client from '../api/client';
import { IpcRequestError } from '../api/client';
import type { Project, ProjectFilter } from '../api/types';
import ProjectTable from '../components/ProjectTable';

function describeError(error: unknown): string {
  if (error instanceof IpcRequestError) return error.userMessage;
  return error instanceof Error ? error.message : '未知错误';
}

/** M1 入口：多项目列表、搜索、归档、删除与导出。 */
export default function ProjectListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();

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
    onError: (error) => message.error(describeError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => client.projectDelete(id),
    onSuccess: () => {
      message.success('项目已删除');
      void invalidate();
    },
    onError: (error) => message.error(describeError(error)),
  });

  const exportMutation = useMutation({
    mutationFn: (id: string) => client.projectExport(id),
    onSuccess: (payload) => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${payload.project.brand_name}-geo-项目档案.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      message.success('项目 JSON 已导出');
    },
    onError: (error) => message.error(describeError(error)),
  });

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
          description={describeError(listQuery.error)}
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
      />

      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        提示：右键行可导出项目 JSON（含实体卡、竞品、资产与题库）。
        <Button
          type="link"
          size="small"
          disabled={(listQuery.data ?? []).length === 0}
          onClick={() => exportMutation.mutate((listQuery.data ?? [])[0].id)}
        >
          导出第一个项目
        </Button>
      </Typography.Paragraph>
    </div>
  );
}

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
      message.success(
        project.status === 'archived' ? t('project.list.archived') : t('project.list.unarchived'),
      );
      void invalidate();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => client.projectDelete(id),
    onSuccess: () => {
      message.success(t('project.list.deleted'));
      void invalidate();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const tagsMutation = useMutation({
    mutationFn: ({ project, tags }: { project: Project; tags: string[] }) =>
      client.projectUpdate({ ...project, tags }),
    onSuccess: () => {
      message.success(t('project.list.tagsUpdated'));
      void invalidate();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  async function handleExport(project: Project, kind: ProjectExportKind) {
    try {
      if (kind === 'json') {
        const payload = await client.projectExport(project.id);
        const saved = await client.exportWriteFile(
          t('project.list.exportJsonFileName', { brand: project.brand_name }),
          JSON.stringify(payload, null, 2),
          false,
        );
        if (saved !== null) message.success(t('project.list.jsonExported'));
        return;
      }
      const csv =
        kind === 'competitors_csv'
          ? await client.projectExportCompetitorsCsv(project.id)
          : await client.projectExportAssetsCsv(project.id);
      // 文件名整份走词典：分隔符与语序在两种语言里不同，组件里不许再拼接（裁定 B-5 同族纪律）
      const label =
        kind === 'competitors_csv'
          ? t('project.list.competitorsLabel')
          : t('project.list.assetsLabel');
      const saved = await client.exportWriteFile(
        t('project.list.exportCsvFileName', { brand: project.brand_name, label }),
        csv,
        true,
      );
      if (saved !== null) message.success(t('project.list.csvExported', { label }));
    } catch (error) {
      message.error(describeIpcError(error, t));
    }
  }

  function confirmDelete(project: Project) {
    modal.confirm({
      title: t('project.list.deleteConfirmTitle', { name: project.name }),
      content: t('project.list.deleteConfirmContent'),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: () => deleteMutation.mutateAsync(project.id),
    });
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('project.list.title')}
          </Typography.Title>
          <Input.Search
            allowClear
            placeholder={t('project.list.searchPlaceholder')}
            style={{ width: 260 }}
            onSearch={(value) => setQuery(value)}
          />
          <Checkbox
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          >
            {t('project.list.showArchived')}
          </Checkbox>
        </Space>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void listQuery.refetch()}
            loading={listQuery.isFetching}
          >
            {t('project.list.refresh')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/projects/new/wizard')}>
            {t('project.list.newProject')}
          </Button>
        </Space>
      </Space>

      {listQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('project.list.loadFailed')}
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
        {t('project.list.hint')}
      </Typography.Paragraph>
    </div>
  );
}

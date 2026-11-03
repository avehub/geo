import { useMemo, useState } from 'react';
import { Alert, App, Button, Input, Select, Space, Typography } from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { describeIpcError } from '../api/errors';
import * as client from '../api/client';
import * as library from '../api/library';
import {
  composeKeywordCsv,
  keywordCsvFileName,
  withSearchAggregate,
} from '../api/library-compose';
import type {
  ContentStatus,
  KeywordGenerateOptions,
  KeywordItem,
  KeywordKind,
  LibrarySource,
  PromptDraft,
} from '../api/types';
import {
  CONTENT_STATUS_VALUES,
  KEYWORD_KIND_VALUES,
  LIBRARY_SOURCE_VALUES,
} from '../api/types';
import KeywordEditorModal, { type KeywordFormValues } from '../components/KeywordEditorModal';
import KeywordGenerateModal from '../components/KeywordGenerateModal';
import KeywordTable from '../components/KeywordTable';
import LibraryExportModal from '../components/LibraryExportModal';
import LibraryReferenceModal from '../components/LibraryReferenceModal';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import { enumLabel } from '../i18n/enum-label';

type KindFilter = KeywordKind | 'all';
type SourceFilter = LibrarySource | 'all';
type StatusFilter = ContentStatus | 'all';

/**
 * M1.5 关键词库（spec `2026-09-30-keyword-faq-library-design.md`）。
 *
 * # 这一页解决什么
 * 素材的**沉淀**与**引用**：手动录入或 AI 生成一批关键词/长尾词，人工审核后，
 * 要么导出 CSV 拿去改官网页面，要么直接引用进 M2 的 Prompt 题库去采集（DR-43 / DR-44）。
 *
 * # 🔴 demo 的边界（规则 9）
 * 月搜索量与竞争难度是种子里的**静态值**；「AI 生成」是从预置语料池里挑一批，不调模型。
 * 两件事都在界面上写明（`staticNote` 常驻、生成弹窗里再挂 `demoBody`），
 * 免得产品负责人拿演示数据当真实调研评审。
 *
 * # 筛选在前端做，不进后端契约
 * 类型 / 来源 / 状态 / 关键词搜索四个筛选都是**展示层**的过滤（照 `PromptSetPage` 的既有做法）：
 * 素材库的量级是几百条，一次 `keyword_list` 拿全再筛，比给命令加四个入参更省契约面。
 */
export default function KeywordLibraryPage() {
  const { id: projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const { t } = useTranslation();

  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<KeywordItem | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ['keywords', projectId],
    queryFn: () => library.keywordList(projectId),
    enabled: projectId !== '',
  });

  const searchBoardQuery = useQuery({
    queryKey: ['search-board', projectId],
    queryFn: () => client.searchBoard(projectId),
    enabled: projectId !== '',
  });
  const searchMetrics = useMemo(
    () => searchBoardQuery.data?.metrics ?? [],
    [searchBoardQuery.data],
  );
  const searchAsOf = searchBoardQuery.data?.as_of ?? '';

  // 🔴 包一层 `useMemo`：`listQuery.data ?? []` 每次渲染都新建一个数组，
  // 直接拿它当下面几个 `useMemo` 的依赖会让筛选结果每帧重算（eslint react-hooks 会点名）。
  // 站长数据按规范化词面拼到关键词行上（DR-101）；拼不上就是 `null`，界面不显示空占位。
  const rows = useMemo(
    () => withSearchAggregate(listQuery.data ?? [], searchMetrics, searchAsOf),
    [listQuery.data, searchMetrics, searchAsOf],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['keywords', projectId] });
  };

  /** 任何筛选变化都清空选区：批量删除 / 引用只作用于用户当前看得见的行。 */
  const updateFilter = (apply: () => void) => {
    apply();
    setSelectedKeys([]);
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (kindFilter !== 'all' && row.kind !== kindFilter) return false;
      if (sourceFilter !== 'all' && row.source !== sourceFilter) return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      return needle === '' || row.text.toLowerCase().includes(needle);
    });
  }, [rows, kindFilter, sourceFilter, statusFilter, search]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedKeys.includes(row.id)),
    [rows, selectedKeys],
  );

  const addMutation = useMutation({
    mutationFn: (values: KeywordFormValues) =>
      library.keywordAdd(projectId, [
        {
          text: values.text,
          kind: values.kind,
          intent: values.intent,
          priority: values.priority,
          note: values.note,
        },
      ]),
    onSuccess: () => {
      message.success(t('library.keyword.saved'));
      setEditorOpen(false);
      setEditing(null);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const updateMutation = useMutation({
    mutationFn: (item: KeywordItem) => library.keywordUpdate(item),
    onSuccess: () => {
      message.success(t('library.keyword.saved'));
      setEditorOpen(false);
      setEditing(null);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => library.keywordDelete(projectId, ids),
    onSuccess: (remaining, ids) => {
      message.success(t('library.keyword.deleted', { total: ids.length }));
      setSelectedKeys([]);
      // 后端回的就是剩余快照 ⇒ 直接写进缓存，比 invalidate 再 list 少一次往返。
      queryClient.setQueryData(['keywords', projectId], remaining);
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const generateMutation = useMutation({
    mutationFn: (options: KeywordGenerateOptions) => library.keywordGenerate(projectId, options),
    onSuccess: (added) => {
      if (added.length === 0) {
        message.info(t('library.keyword.generatedNone'));
      } else {
        message.success(t('library.keyword.generated', { total: added.length }));
      }
      setGenerateOpen(false);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  function confirmDelete(ids: string[]) {
    modal.confirm({
      title: t('library.keyword.deleteConfirmTitle'),
      content: t('library.keyword.deleteConfirmContent', { total: ids.length }),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: () => deleteMutation.mutateAsync(ids),
    });
  }

  function submitEditor(values: KeywordFormValues) {
    if (editing === null) {
      addMutation.mutate(values);
      return;
    }
    updateMutation.mutate({ ...editing, ...values });
  }

  /** DR-43 的映射：文本 → 题干、意图沿用、优先级 → 权重；分组与标签留空（理由见词典 `sourceNote`）。 */
  const referenceDrafts: PromptDraft[] = selectedRows.map((row) => ({
    text: row.text,
    intent: row.intent,
    weight: row.priority,
    group_name: null,
    tags: [],
  }));

  if (listQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('library.keyword.title')}
        description={describeIpcError(listQuery.error, t)}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={t('library.keyword.title')}
        description={t('library.keyword.subtitle')}
      />
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('library.keyword.staticNote')} />

      <SectionCard>
        <Space size={12} wrap style={{ marginBottom: 12, width: '100%' }}>
          <Input.Search
            allowClear
            style={{ width: 220 }}
            aria-label={t('library.keyword.searchAria')}
            placeholder={t('library.keyword.searchPlaceholder')}
            onSearch={(value) => updateFilter(() => setSearch(value))}
            onChange={(event) => updateFilter(() => setSearch(event.target.value))}
          />
          <Select
            size="middle"
            style={{ width: 168 }}
            aria-label={t('library.filters.kindAria')}
            value={kindFilter}
            onChange={(value) => updateFilter(() => setKindFilter(value as KindFilter))}
            options={[
              { value: 'all', label: t('library.filters.allKinds', { total: rows.length }) },
              ...KEYWORD_KIND_VALUES.map((value) => ({
                value,
                label: enumLabel(t, 'library.kinds', value),
              })),
            ]}
          />
          <Select
            style={{ width: 148 }}
            aria-label={t('library.filters.sourceAria')}
            value={sourceFilter}
            onChange={(value) => updateFilter(() => setSourceFilter(value as SourceFilter))}
            options={[
              { value: 'all', label: t('library.filters.allSources') },
              ...LIBRARY_SOURCE_VALUES.map((value) => ({
                value,
                label: enumLabel(t, 'library.sources', value),
              })),
            ]}
          />
          <Select
            style={{ width: 148 }}
            aria-label={t('library.filters.statusAria')}
            value={statusFilter}
            onChange={(value) => updateFilter(() => setStatusFilter(value as StatusFilter))}
            options={[
              { value: 'all', label: t('library.filters.allStatuses') },
              ...CONTENT_STATUS_VALUES.map((value) => ({
                value,
                label: enumLabel(t, 'action.contentStatuses', value),
              })),
            ]}
          />
          <Button
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            {t('library.actions.add')}
          </Button>
          <Button icon={<RobotOutlined />} onClick={() => setGenerateOpen(true)}>
            {t('library.actions.generate')}
          </Button>
          <Button
            icon={<SendOutlined />}
            disabled={selectedRows.length === 0}
            onClick={() => setReferenceOpen(true)}
          >
            {t('library.actions.reference')}
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => setExportOpen(true)}>
            {t('library.actions.exportCsv')}
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={selectedKeys.length === 0}
            onClick={() => confirmDelete(selectedKeys)}
          >
            {selectedKeys.length > 0
              ? t('library.actions.deleteSelectedCount', { selected: selectedKeys.length })
              : t('library.actions.deleteSelected')}
          </Button>
          <Typography.Text type="secondary">
            {t('library.filters.filtered', { shown: visible.length, total: rows.length })}
          </Typography.Text>
        </Space>

        <KeywordTable
          rows={visible}
          loading={listQuery.isFetching}
          selectedRowKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          onStatusChange={(row, status) => updateMutation.mutate({ ...row, status })}
          onEdit={(row) => {
            setEditing(row);
            setEditorOpen(true);
          }}
          onDelete={(row) => confirmDelete([row.id])}
        />
      </SectionCard>

      {editorOpen ? (
        <KeywordEditorModal
          item={
            editing === null
              ? null
              : {
                  text: editing.text,
                  kind: editing.kind,
                  intent: editing.intent,
                  priority: editing.priority,
                  note: editing.note,
                  status: editing.status,
                }
          }
          saving={editing === null ? addMutation.isPending : updateMutation.isPending}
          onCancel={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
          onSubmit={submitEditor}
        />
      ) : null}

      {generateOpen ? (
        <KeywordGenerateModal
          generating={generateMutation.isPending}
          onCancel={() => setGenerateOpen(false)}
          onGenerate={(options) => generateMutation.mutate(options)}
        />
      ) : null}

      <LibraryReferenceModal
        open={referenceOpen}
        projectId={projectId}
        drafts={referenceDrafts}
        previews={selectedRows.map((row) => row.text)}
        mappingNote={t('library.reference.keywordMappingNote')}
        onClose={() => setReferenceOpen(false)}
        onReferenced={() => {
          setSelectedKeys([]);
          // 引用写的是**题库**那一侧，本页的数据没变；让题库页那两个缓存失效，切过去就是新的
          // （键名与 `pages/PromptSetPage.tsx` 逐字一致：清单是 ['prompt-sets', projectId]、
          // 单份是 ['prompt-set', setId]，后者按前缀匹配就能全 invalidate）。
          void queryClient.invalidateQueries({ queryKey: ['prompt-sets', projectId] });
          void queryClient.invalidateQueries({ queryKey: ['prompt-set'] });
        }}
      />

      <LibraryExportModal
        open={exportOpen}
        title={t('library.export.title')}
        hint={t('library.actions.demoModeHint')}
        fileName={keywordCsvFileName(projectId)}
        content={composeKeywordCsv(selectedRows.length > 0 ? selectedRows : visible)}
        withBom
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}

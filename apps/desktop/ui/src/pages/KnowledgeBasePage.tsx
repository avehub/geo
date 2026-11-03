import { useMemo, useState } from 'react';
import { Alert, App } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { projectGet } from '../api/client';
import { describeIpcError } from '../api/errors';
import * as kb from '../api/kb';
import {
  composeKbJson,
  composeKbMarkdown,
  kbJsonFileName,
  kbMarkdownFileName,
} from '../api/kb-compose';
import type { KbEntry, KbGenerateOptions, KbModule } from '../api/types';
import KbBoardHeader from '../components/KbBoardHeader';
import KbFilterRail from '../components/KbFilterRail';
import KbEntryDrawer, { type KbFormValues } from '../components/KbEntryDrawer';
import KbGenerateModal, { type KbGenerateFormValues } from '../components/KbGenerateModal';
import KbImportModal from '../components/KbImportModal';
import KbModulePanels from '../components/KbModulePanels';
import KbPreviewDrawer from '../components/KbPreviewDrawer';
import KbTable from '../components/KbTable';
import KbToolbar, { type KbExportKind, type KbFilters, type KbViewMode } from '../components/KbToolbar';
import LibraryExportModal from '../components/LibraryExportModal';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import { buildImportRows, toImportDrafts, type KbImportRow } from '../components/kb-import';
import { groupByModule, toKbRows, type KbRow } from '../components/kb-view';

const ALL_FILTERS: KbFilters = {
  module: 'all',
  kind: 'all',
  status: 'all',
  source: 'all',
  search: '',
};

/**
 * M1.2b 知识库（spec `2026-10-10-kb-redesign-and-article-studio-design.md` · DR-73 … DR-82）。
 *
 * # 与上一轮的三个不同
 * ① **同步块没了**（DR-73）：页面只有落库行；「结合项目录入的信息」走「从实体卡导入」
 *    一次性复制（DR-81），导入后源头再改不跟随；
 * ② **两种视图**（DR-76）：分组卡片（话术按场景分段、素材走画廊格）与密集表格
 *    （Notion 数据库视图同族；competitor 筛出来即 battlecard）；
 * ③ **编辑改侧滑**（DR-77），话术 / 定义句带一键复制（DR-79）。
 *
 * # demo 的边界（规则 9 / 规则 2 / 规则 6）
 * 「AI 生成」不调模型（预置语料池）、图片与视频不拉流、搜索是 `includes`——
 * 三件事都在界面上写明（`demoHint` 常驻 + 生成弹窗免责 + 预览抽屉那句媒体说明）。
 */
export default function KnowledgeBasePage() {
  const { id: projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const { t } = useTranslation();

  const [filters, setFilters] = useState<KbFilters>(ALL_FILTERS);
  const [view, setView] = useState<KbViewMode>('table');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<KbEntry | null>(null);
  const [defaultModule, setDefaultModule] = useState<KbModule | undefined>(undefined);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState<KbRow | null>(null);
  const [exportKind, setExportKind] = useState<KbExportKind | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const boardQuery = useQuery({
    queryKey: ['kb-board', projectId],
    queryFn: () => kb.kbBoard(projectId),
    enabled: projectId !== '',
  });
  const board = boardQuery.data ?? null;

  /** 导入预览需要实体卡 + 竞品 + 资产：`project_get` 一次拿全（ProjectDetail）。 */
  const detailQuery = useQuery({
    queryKey: ['project-detail', projectId],
    queryFn: () => projectGet(projectId),
    enabled: projectId !== '' && importOpen,
  });

  const rows = useMemo<KbRow[]>(() => (board === null ? [] : toKbRows(board.entries)), [board]);

  /**
   * 编辑侧滑「修订历史」页签要的那一份（DR-119）：`kb_board` 一次带回**全项目**的留痕，
   * 这里按当前编辑的条目筛。
   *
   * 🔴 读出口寄生在 board 上 ⇒ **不发第二条命令**、也不加第二份缓存键：保存之后那句
   * `refresh()`（失效 `['kb-board', projectId]`）顺带就把新留痕拉回来了，
   * 不需要像实体卡页那样再失效一个 `['entity-card-revisions', …]`。
   */
  const editingRevisions = useMemo(
    () =>
      board === null || editing === null
        ? []
        : board.revisions.filter((revision) => revision.entry_id === editing.id),
    [board, editing],
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['kb-board', projectId] });
  };

  const visible = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.module !== 'all' && row.module !== filters.module) return false;
      if (filters.kind !== 'all' && row.kind !== filters.kind) return false;
      if (filters.source !== 'all' && row.source !== filters.source) return false;
      if (filters.status !== 'all' && row.status !== filters.status) return false;
      if (needle === '') return true;
      return (
        row.title.toLowerCase().includes(needle) ||
        row.body.toLowerCase().includes(needle) ||
        row.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [rows, filters]);

  const groups = useMemo(() => groupByModule(visible), [visible]);

  const addMutation = useMutation({
    mutationFn: (drafts: Parameters<typeof kb.kbEntryAdd>[1]) => kb.kbEntryAdd(projectId, drafts),
    onSuccess: (added) => {
      message.success(t('kb.entry.added', { added: added.length }));
      setEditorOpen(false);
      setEditing(null);
      setImportOpen(false);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const updateMutation = useMutation({
    mutationFn: (entry: KbEntry) => kb.kbEntryUpdate(entry),
    onMutate: (entry) => setBusyId(entry.id),
    onSuccess: () => {
      message.success(t('kb.entry.saved'));
      setEditorOpen(false);
      setEditing(null);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
    onSettled: () => setBusyId(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => kb.kbEntryDelete(projectId, ids),
    onSuccess: (_remaining, ids) => {
      message.success(t('kb.entry.deleted'));
      setSelectedIds((previous) => previous.filter((id) => !ids.includes(id)));
      refresh();
    },
    onError: (error) => {
      message.error(describeIpcError(error, t));
      message.error(t('kb.entry.deleteFailed'));
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (ids: string[]) => kb.kbEntryVerify(projectId, ids),
    onMutate: (ids) => setBusyId(ids[0] ?? null),
    onSuccess: (_remaining, ids) => {
      message.success(t('kb.entry.verified', { selected: ids.length }));
      setSelectedIds([]);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
    onSettled: () => setBusyId(null),
  });

  const generateMutation = useMutation({
    mutationFn: (options: KbGenerateOptions) => kb.kbGenerate(projectId, options),
    onSuccess: (added) => {
      if (added.length === 0) {
        message.info(t('kb.generate.empty'));
      } else {
        message.success(t('kb.generate.done', { added: added.length }));
      }
      setGenerateOpen(false);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  /** 一键复制（DR-79）：话术 / 定义句的价值在"能立刻粘出去"。 */
  async function copyRow(row: KbRow) {
    const text = row.body.trim() === '' ? row.title : row.body;
    try {
      await navigator.clipboard.writeText(text);
      message.success(t('kb.entry.copied'));
    } catch {
      message.error(t('kb.entry.copyFailed'));
    }
  }

  function confirmDelete(ids: string[]) {
    modal.confirm({
      title: t('kb.actions.delete'),
      content: t('kb.actions.deleteConfirm', { selected: ids.length }),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: () => deleteMutation.mutateAsync(ids),
    });
  }

  function submitEditor(values: KbFormValues) {
    if (editing === null) {
      addMutation.mutate([
        {
          module: values.module,
          kind: values.kind,
          scenario: values.scenario,
          title: values.title,
          body_markdown: values.body_markdown,
          url: values.url,
          mime: values.mime,
          tags: values.tags,
        },
      ]);
      return;
    }
    updateMutation.mutate({ ...editing, ...values });
  }

  /** 打开录入 / 编辑侧滑；`row === null` 即新增，`presetModule` 让"从哪个模块点的就落哪个模块"。 */
  function openEditor(row: KbRow | null, presetModule?: KbModule) {
    setEditing(row === null ? null : (board?.entries.find((item) => item.id === row.id) ?? null));
    setDefaultModule(presetModule);
    setEditorOpen(true);
  }

  const importRows = useMemo<KbImportRow[]>(
    () => buildImportRows(detailQuery.data ?? null, t, t('common.listSeparator')),
    [detailQuery.data, t],
  );

  const markdown = useMemo(
    () => composeKbMarkdown(rows, t, t('kb.export.docTitle'), t('kb.export.docNote')),
    [rows, t],
  );
  const json = useMemo(() => composeKbJson(rows, t, projectId), [rows, t, projectId]);
  const exportContent = exportKind === 'json' ? json : markdown;

  if (boardQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('kb.loadFailed')}
        description={describeIpcError(boardQuery.error, t)}
      />
    );
  }

  const rowHandlers = {
    onSelect: (row: KbRow, selected: boolean) =>
      setSelectedIds((previous) =>
        selected ? [...previous, row.id] : previous.filter((id) => id !== row.id),
      ),
    onEdit: (row: KbRow) => openEditor(row),
    onDelete: (row: KbRow) => confirmDelete([row.id]),
    onVerify: (row: KbRow) => verifyMutation.mutate([row.id]),
    onCopy: (row: KbRow) => void copyRow(row),
    onPreview: (row: KbRow) => setPreview(row),
  };

  return (
    <div>
      <PageHeader title={t('kb.title')} description={t('kb.lead')} />
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('kb.demoHint')} />

      {board === null ? null : <KbBoardHeader stats={board.stats} />}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ width: 184, flexShrink: 0 }}>
          <KbFilterRail
            filters={filters}
            onFiltersChange={(patch) => {
              setFilters((previous) => ({ ...previous, ...patch }));
              // 选区跟着筛选走：否则批量删除 / 核实会动到用户已经看不见的行。
              setSelectedIds([]);
            }}
            onReset={() => {
              setFilters(ALL_FILTERS);
              setSelectedIds([]);
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
      <SectionCard>
        <KbToolbar
          view={view}
          onViewChange={setView}
          total={rows.length}
          shown={visible.length}
          selectedCount={selectedIds.length}
          exportDisabled={{ markdown: markdown === null, json: json === null }}
          onAdd={() => openEditor(null, filters.module === 'all' ? undefined : filters.module)}
          onImport={() => setImportOpen(true)}
          onGenerate={() => setGenerateOpen(true)}
          onVerify={() => verifyMutation.mutate(selectedIds)}
          onExport={setExportKind}
          onDelete={() => confirmDelete(selectedIds)}
        />

        {view === 'group' ? (
          <KbModulePanels
            groups={groups}
            selectedIds={selectedIds}
            busyId={busyId}
            emptyText={
              rows.length === 0
                ? `${t('kb.entry.empty')} · ${t('kb.entry.emptyBody')}`
                : t('kb.filters.noMatch')
            }
            {...rowHandlers}
          />
        ) : (
          <KbTable
            rows={visible}
            selectedIds={selectedIds}
            busyId={busyId}
            onSelectIds={setSelectedIds}
            onEdit={rowHandlers.onEdit}
            onDelete={rowHandlers.onDelete}
            onVerify={rowHandlers.onVerify}
            onCopy={rowHandlers.onCopy}
          />
        )}
      </SectionCard>
        </div>
      </div>

      {editorOpen ? (
        <KbEntryDrawer
          entry={
            editing === null
              ? null
              : {
                  module: editing.module,
                  kind: editing.kind,
                  scenario: editing.scenario,
                  title: editing.title,
                  body_markdown: editing.body_markdown,
                  url: editing.url,
                  mime: editing.mime,
                  tags: editing.tags,
                  status: editing.status,
                }
          }
          revisions={editingRevisions}
          defaultModule={defaultModule}
          saving={addMutation.isPending || updateMutation.isPending}
          onCancel={() => {
            setEditorOpen(false);
            setEditing(null);
          }}
          onSubmit={submitEditor}
        />
      ) : null}

      {generateOpen ? (
        <KbGenerateModal
          generating={generateMutation.isPending}
          onCancel={() => setGenerateOpen(false)}
          onGenerate={(values: KbGenerateFormValues) => generateMutation.mutate(values)}
        />
      ) : null}

      {importOpen ? (
        <KbImportModal
          rows={importRows}
          importing={addMutation.isPending}
          onCancel={() => setImportOpen(false)}
          onImport={(selected) => addMutation.mutate(toImportDrafts(selected))}
        />
      ) : null}

      <KbPreviewDrawer row={preview} onClose={() => setPreview(null)} />

      <LibraryExportModal
        open={exportKind !== null}
        title={exportKind === 'json' ? t('kb.export.jsonTitle') : t('kb.export.markdownTitle')}
        hint={`${
          exportKind === 'json' ? t('kb.export.jsonHint') : t('kb.export.markdownHint')
        } · ${t('kb.actions.demoModeHint')}`}
        fileName={exportKind === 'json' ? kbJsonFileName(projectId) : kbMarkdownFileName(projectId)}
        content={exportContent ?? ''}
        withBom={false}
        onClose={() => setExportKind(null)}
      />
    </div>
  );
}

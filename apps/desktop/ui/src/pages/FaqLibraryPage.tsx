import { useMemo, useState } from 'react';
import { Alert, App, Button, Input, Select, Space, Tooltip, Typography } from 'antd';
import {
  CodeOutlined,
  DeleteOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { describeIpcError } from '../api/errors';
import * as library from '../api/library';
import { adoptedFaqCount, composeFaqJsonLd, faqJsonLdFileName } from '../api/library-compose';
import type {
  ContentStatus,
  FaqGenerateOptions,
  FaqItem,
  IntentCategory,
  PromptDraft,
} from '../api/types';
import { CONTENT_STATUS_VALUES, INTENT_VALUES } from '../api/types';
import FaqEditorModal, { type FaqFormValues } from '../components/FaqEditorModal';
import FaqGenerateModal from '../components/FaqGenerateModal';
import FaqTable from '../components/FaqTable';
import LibraryExportModal from '../components/LibraryExportModal';
import LibraryReferenceModal from '../components/LibraryReferenceModal';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import { enumLabel } from '../i18n/enum-label';

type StatusFilter = ContentStatus | 'all';
type IntentFilter = IntentCategory | 'all';

/** FAQ 引用的权重：`FaqItem` 没有优先级字段，一律用 `PromptDraft` 的后端默认值 3。 */
const FAQ_REFERENCE_WEIGHT = 3;

/**
 * 「未分类」在筛选器里的记号。
 *
 * 值是**稳定 ASCII 记号**而不是展示文案（照 `PromptSetPage` 的 `NO_GROUP` 那条裁定）：
 * 它同时充当 `Select` 的 `value`，拿中文当 value 的话 en 界面下筛选状态里仍是一个中文串。
 */
const UNCATEGORIZED = '__uncategorized__';

/**
 * M1.5 FAQ 常见问题库（spec `2026-09-30-keyword-faq-library-design.md`）。
 *
 * # 这一页解决什么
 * 把"用户会怎么问 + 官方怎么答"成对沉淀下来，两个引用出口：
 * ① 导出 **`FAQPage` JSON-LD** 贴进官网（DR-44），让搜索引擎与 AI 助手直接读到问答对；
 * ② 把问题引用进 M2 的 Prompt 题库（DR-43），用真实问法去采集各引擎的回答。
 *
 * # 🔴 只导出**已采用**的问答
 * `composeFaqJsonLd` 只收 `status === 'approved'`：待审的答案是"AI 生成、还没人看过"，
 * 把它贴到官网上正是 GEO 场景里最容易翻车的一类错误（AGENTS 规则 6）。
 * 一条都没有时按钮置灰并说明原因（`exportDisabled`），而不是导出一份空壳。
 */
export default function FaqLibraryPage() {
  const { id: projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const { t } = useTranslation();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [intentFilter, setIntentFilter] = useState<IntentFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<FaqItem | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ['faqs', projectId],
    queryFn: () => library.faqList(projectId),
    enabled: projectId !== '',
  });

  // 🔴 包一层 `useMemo`：`listQuery.data ?? []` 每次渲染都新建一个数组，
  // 直接拿它当下面几个 `useMemo` 的依赖会让筛选结果每帧重算（eslint react-hooks 会点名）。
  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['faqs', projectId] });
  };

  /** 任何筛选变化都清空选区：批量删除 / 引用只作用于用户当前看得见的行。 */
  const updateFilter = (apply: () => void) => {
    apply();
    setSelectedKeys([]);
  };

  /** 分类是自由文本数据 ⇒ 选项从当前清单里现算（不查词典、不预置）。 */
  const categories = useMemo(
    () => [...new Set(rows.map((row) => row.category).filter((value) => value !== null))].sort(),
    [rows],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (intentFilter !== 'all' && row.intent !== intentFilter) return false;
      if (categoryFilter === UNCATEGORIZED) {
        if (row.category !== null) return false;
      } else if (categoryFilter !== 'all' && row.category !== categoryFilter) {
        return false;
      }
      if (needle === '') return true;
      return (
        row.question.toLowerCase().includes(needle) ||
        row.answer_markdown.toLowerCase().includes(needle)
      );
    });
  }, [rows, statusFilter, intentFilter, categoryFilter, search]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedKeys.includes(row.id)),
    [rows, selectedKeys],
  );

  const addMutation = useMutation({
    mutationFn: (values: FaqFormValues) =>
      library.faqAdd(projectId, [
        {
          question: values.question,
          answer_markdown: values.answer_markdown,
          category: values.category,
          intent: values.intent,
        },
      ]),
    onSuccess: () => {
      message.success(t('library.faq.saved'));
      setEditorOpen(false);
      setEditing(null);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const updateMutation = useMutation({
    mutationFn: (item: FaqItem) => library.faqUpdate(item),
    onSuccess: () => {
      message.success(t('library.faq.saved'));
      setEditorOpen(false);
      setEditing(null);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => library.faqDelete(projectId, ids),
    onSuccess: (remaining, ids) => {
      message.success(t('library.faq.deleted', { total: ids.length }));
      setSelectedKeys([]);
      queryClient.setQueryData(['faqs', projectId], remaining);
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const generateMutation = useMutation({
    mutationFn: (options: FaqGenerateOptions) => library.faqGenerate(projectId, options),
    onSuccess: (added) => {
      if (added.length === 0) {
        message.info(t('library.faq.generatedNone'));
      } else {
        message.success(t('library.faq.generated', { total: added.length }));
      }
      setGenerateOpen(false);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  function confirmDelete(ids: string[]) {
    modal.confirm({
      title: t('library.faq.deleteConfirmTitle'),
      content: t('library.faq.deleteConfirmContent', { total: ids.length }),
      okText: t('common.delete'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: () => deleteMutation.mutateAsync(ids),
    });
  }

  function submitEditor(values: FaqFormValues) {
    if (editing === null) {
      addMutation.mutate(values);
      return;
    }
    updateMutation.mutate({ ...editing, ...values });
  }

  /** DR-43 的映射：问题 → 题干、意图沿用；FAQ 没有优先级 ⇒ 权重用后端默认值。 */
  const referenceDrafts: PromptDraft[] = selectedRows.map((row) => ({
    text: row.question,
    intent: row.intent,
    weight: FAQ_REFERENCE_WEIGHT,
    group_name: null,
    tags: [],
  }));

  const jsonLd = composeFaqJsonLd(rows);

  if (listQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('library.faq.title')}
        description={describeIpcError(listQuery.error, t)}
      />
    );
  }

  return (
    <div>
      <PageHeader title={t('library.faq.title')} description={t('library.faq.subtitle')} />
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('library.faq.staticNote')} />

      <SectionCard>
        <Space size={12} wrap style={{ marginBottom: 12, width: '100%' }}>
          <Input.Search
            allowClear
            style={{ width: 220 }}
            aria-label={t('library.faq.searchAria')}
            placeholder={t('library.faq.searchPlaceholder')}
            onSearch={(value) => updateFilter(() => setSearch(value))}
            onChange={(event) => updateFilter(() => setSearch(event.target.value))}
          />
          <Select
            style={{ width: 168 }}
            aria-label={t('library.filters.categoryAria')}
            value={categoryFilter}
            onChange={(value) => updateFilter(() => setCategoryFilter(value))}
            options={[
              { value: 'all', label: t('library.filters.allCategories', { total: rows.length }) },
              ...categories.map((value) => ({ value, label: value })),
              { value: UNCATEGORIZED, label: t('library.filters.uncategorized') },
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
          <Select
            style={{ width: 148 }}
            aria-label={t('library.filters.intentAria')}
            value={intentFilter}
            onChange={(value) => updateFilter(() => setIntentFilter(value as IntentFilter))}
            options={[
              { value: 'all', label: t('library.filters.allIntents', { total: rows.length }) },
              ...INTENT_VALUES.map((value) => ({
                value,
                label: enumLabel(t, 'prompt.intents', value),
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
          <Tooltip title={jsonLd === null ? t('library.faq.exportDisabled') : ''}>
            <Button icon={<CodeOutlined />} disabled={jsonLd === null} onClick={() => setExportOpen(true)}>
              {t('library.actions.exportJsonLd')}
            </Button>
          </Tooltip>
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

        <FaqTable
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
        <FaqEditorModal
          item={
            editing === null
              ? null
              : {
                  question: editing.question,
                  answer_markdown: editing.answer_markdown,
                  category: editing.category,
                  intent: editing.intent,
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
        <FaqGenerateModal
          generating={generateMutation.isPending}
          onCancel={() => setGenerateOpen(false)}
          onGenerate={(options) => generateMutation.mutate(options)}
        />
      ) : null}

      <LibraryReferenceModal
        open={referenceOpen}
        projectId={projectId}
        drafts={referenceDrafts}
        previews={selectedRows.map((row) => row.question)}
        mappingNote={t('library.reference.faqMappingNote')}
        onClose={() => setReferenceOpen(false)}
        onReferenced={() => {
          setSelectedKeys([]);
          void queryClient.invalidateQueries({ queryKey: ['prompt-sets', projectId] });
          void queryClient.invalidateQueries({ queryKey: ['prompt-set'] });
        }}
      />

      <LibraryExportModal
        open={exportOpen}
        title={t('library.faq.jsonldTitle')}
        hint={`${t('library.faq.jsonldHint')} · ${t('library.faq.jsonldIncluded', {
          total: adoptedFaqCount(rows),
        })}`}
        fileName={faqJsonLdFileName(projectId)}
        content={jsonLd ?? ''}
        withBom={false}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}

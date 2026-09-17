import { useCallback, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Radio, Select, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import * as client from '../api/client';
import { IpcRequestError } from '../api/client';
import type {
  GenerateOptions,
  IntentCategory,
  PromptDraft,
  PromptItem,
  PromptSet,
  PromptSource,
} from '../api/types';
import { INTENT_LABELS, PROMPT_SOURCE_LABELS } from '../api/types';
import CsvToolbar from '../components/CsvToolbar';
import GeneratePanel from '../components/GeneratePanel';
import PromptItemEditor from '../components/PromptItemEditor';
import PromptTable from '../components/PromptTable';
import SampleSizeAlert from '../components/SampleSizeAlert';

type IntentFilter = IntentCategory | 'all';
/** 没有分组的条目在筛选器里归到这一档。 */
const NO_GROUP = '未分组';

function describeError(error: unknown): string {
  if (error instanceof IpcRequestError) return error.userMessage;
  return error instanceof Error ? error.message : '未知错误';
}

function groupOf(item: PromptItem): string {
  const name = item.group_name?.trim();
  return name === undefined || name === '' ? NO_GROUP : name;
}

/** M2 Prompt 智能题库：生成、筛选、增删改、加权、去重检查与 CSV 往返。 */
export default function PromptSetPage() {
  const { id: projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();

  const [intentFilter, setIntentFilter] = useState<IntentFilter>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<PromptSource | 'all'>('all');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [editor, setEditor] = useState<{ item: PromptItem | null } | null>(null);
  const [dedupeSummary, setDedupeSummary] = useState<string | null>(null);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => client.projectGet(projectId),
    enabled: projectId !== '',
  });

  const listQuery = useQuery({
    queryKey: ['prompt-sets', projectId],
    queryFn: () => client.promptSetList(projectId),
    enabled: projectId !== '',
  });

  const activeId = listQuery.data?.[0]?.id ?? null;

  const setQuery = useQuery({
    queryKey: ['prompt-set', activeId],
    queryFn: () => client.promptSetGet(activeId as string),
    enabled: Boolean(activeId),
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['prompt-sets', projectId] });
    if (activeId) void queryClient.invalidateQueries({ queryKey: ['prompt-set', activeId] });
  }, [activeId, projectId, queryClient]);

  /** 条目写回缓存并刷新版本摘要：内容哈希与样本量分级都由后端重算，前端不自己拼。 */
  const applySet = useCallback(
    (updated: PromptSet) => {
      queryClient.setQueryData(['prompt-set', updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['prompt-sets', projectId] });
    },
    [projectId, queryClient],
  );

  const generateMutation = useMutation({
    mutationFn: (options: GenerateOptions) => client.promptSetGenerate(projectId, options),
    onSuccess: (promptSet) => {
      // 新快照要立刻成为「当前题库」，否则列表还没刷新，页面会停在旧版本上，
      // 用户会以为点了没反应；setQueryData 也避免旧缓存伪装成「刚生成的新版本」
      queryClient.setQueryData(['prompt-set', promptSet.id], promptSet);
      void queryClient.invalidateQueries({ queryKey: ['prompt-sets', projectId] });
      message.success(`已生成 ${promptSet.items.length} 条 prompt（第 ${promptSet.version} 版）`);
      setDedupeSummary(null);
      setSelectedKeys([]);
    },
    onError: (error) => message.error(describeError(error)),
  });

  const itemMutation = useMutation({
    mutationFn: ({ item, notice }: { item: PromptItem; notice?: string }) =>
      client.promptItemUpdate(item).then((updated) => ({ updated, notice })),
    onSuccess: ({ notice }) => {
      if (notice) message.success(notice);
      // 改一条也会换掉整份快照的 content_hash，重取比手工打补丁可靠
      refresh();
    },
    onError: (error) => message.error(describeError(error)),
  });

  const addMutation = useMutation({
    mutationFn: (draft: PromptDraft) => client.promptItemAdd(activeId as string, [draft]),
    onSuccess: (updated) => {
      applySet(updated);
      message.success(`已新增 1 条，当前共 ${updated.items.length} 条`);
      setEditor(null);
    },
    onError: (error) => message.error(describeError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => client.promptItemDelete(activeId as string, ids),
    onSuccess: (updated, ids) => {
      applySet(updated);
      setSelectedKeys([]);
      message.success(`已删除 ${ids.length} 条，剩余 ${updated.items.length} 条`);
    },
    onError: (error) => message.error(describeError(error)),
  });

  const dedupeMutation = useMutation({
    mutationFn: () => client.promptSetDedupe(activeId as string),
    onSuccess: (report) => {
      setDedupeSummary(
        `重复对：${report.duplicate_pairs}，合并移除：${report.removed.length}，保留：${report.kept.length}`,
      );
      setSelectedKeys([]);
      refresh();
    },
    onError: (error) => message.error(describeError(error)),
  });

  const promptSet = setQuery.data ?? null;
  const items = useMemo(() => {
    const all = promptSet?.items ?? [];
    return all.filter(
      (item) =>
        (intentFilter === 'all' || item.intent === intentFilter) &&
        (groupFilter === 'all' || groupOf(item) === groupFilter) &&
        (sourceFilter === 'all' || item.source === sourceFilter),
    );
  }, [groupFilter, intentFilter, promptSet, sourceFilter]);

  const groupOptions = useMemo(() => {
    const groups = new Set((promptSet?.items ?? []).map(groupOf));
    return [
      { value: 'all', label: '全部分组' },
      ...Array.from(groups)
        .sort()
        .map((group) => ({ value: group, label: group })),
    ];
  }, [promptSet]);

  const sourceOptions = useMemo(
    () => [
      { value: 'all', label: '全部来源' },
      ...(Object.keys(PROMPT_SOURCE_LABELS) as PromptSource[]).map((value) => ({
        value,
        label: PROMPT_SOURCE_LABELS[value],
      })),
    ],
    [],
  );

  function confirmDelete(ids: string[]) {
    modal.confirm({
      title: `删除选中的 ${ids.length} 条 prompt？`,
      content: '删除后内容哈希与样本量分级会重算，且不可恢复（可先导出 CSV 备份）。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteMutation.mutateAsync(ids),
    });
  }

  function submitEditor(draft: PromptDraft) {
    const current = editor?.item ?? null;
    if (current === null) {
      addMutation.mutate(draft);
      return;
    }
    itemMutation.mutate({
      item: {
        ...current,
        text: draft.text,
        intent: draft.intent,
        weight: draft.weight ?? current.weight,
        group_name: draft.group_name ?? null,
        repeat_count: draft.repeat_count ?? current.repeat_count,
        tags: draft.tags ?? current.tags,
      },
      notice: '已更新',
    });
    setEditor(null);
  }

  if (listQuery.isError || setQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载题库失败"
        description={describeError(listQuery.error ?? setQuery.error)}
      />
    );
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Prompt 题库
        </Typography.Title>
        <CsvToolbar
          setId={activeId ?? ''}
          filenamePrefix={promptSet?.label ?? 'geo'}
          onChanged={refresh}
        />
      </Space>

      <GeneratePanel
        defaultIndustry={projectQuery.data?.project?.industry ?? 'b2b_manufacturing'}
        loading={generateMutation.isPending}
        onGenerate={(options) => generateMutation.mutate(options)}
      />

      {promptSet === null ? (
        <Card>
          <Typography.Paragraph type="secondary">
            还没有题库。设置好生成参数后点「生成题库」，系统会产出 60–100 条覆盖 7 类意图的
            中文口语化 prompt，并保存为一个带内容哈希的版本快照。
          </Typography.Paragraph>
        </Card>
      ) : (
        <>
          <Card size="small" style={{ marginBottom: 12 }}>
            <Space size={16} wrap>
              <Typography.Text strong>{promptSet.label}</Typography.Text>
              <Tag color="blue">第 {promptSet.version} 版</Tag>
              <Typography.Text type="secondary">共 {promptSet.items.length} 条</Typography.Text>
              <Typography.Text type="secondary" copyable={{ text: promptSet.content_hash }}>
                内容哈希 {promptSet.content_hash}
              </Typography.Text>
              <Typography.Text type="secondary">
                口径 {promptSet.metric_spec_version}
              </Typography.Text>
              <Button
                size="small"
                loading={dedupeMutation.isPending}
                disabled={!activeId}
                onClick={() => dedupeMutation.mutate()}
              >
                去重检查
              </Button>
            </Space>
            {promptSet.notes ? (
              <Alert type="info" showIcon style={{ marginTop: 8 }} message={promptSet.notes} />
            ) : null}
            {dedupeSummary ? (
              <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0 }} type="secondary">
                {dedupeSummary}
              </Typography.Paragraph>
            ) : null}
          </Card>

          <SampleSizeAlert grade={promptSet.sample_size_grade} count={promptSet.items.length} />

          <Card size="small">
            <Space size={12} wrap style={{ marginBottom: 12, width: '100%' }}>
              <Radio.Group
                optionType="button"
                size="small"
                value={intentFilter}
                onChange={(event) => setIntentFilter(event.target.value as IntentFilter)}
                options={[
                  { value: 'all', label: `全部（${promptSet.items.length}）` },
                  ...(Object.keys(INTENT_LABELS) as IntentCategory[]).map((value) => ({
                    value,
                    label: INTENT_LABELS[value],
                  })),
                ]}
              />
              <Select
                size="small"
                style={{ width: 150 }}
                aria-label="按分组筛选"
                value={groupFilter}
                options={groupOptions}
                onChange={setGroupFilter}
              />
              <Select
                size="small"
                style={{ width: 140 }}
                aria-label="按来源筛选"
                value={sourceFilter}
                options={sourceOptions}
                onChange={(value) => setSourceFilter(value as PromptSource | 'all')}
              />
              <Button
                size="small"
                icon={<PlusOutlined />}
                disabled={!activeId}
                onClick={() => setEditor({ item: null })}
              >
                新增 prompt
              </Button>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={selectedKeys.length === 0}
                loading={deleteMutation.isPending}
                onClick={() => confirmDelete(selectedKeys)}
              >
                删除选中{selectedKeys.length > 0 ? `（${selectedKeys.length}）` : ''}
              </Button>
              <Typography.Text type="secondary">
                筛出 {items.length} / {promptSet.items.length} 条
              </Typography.Text>
            </Space>
            <PromptTable
              items={items}
              loading={setQuery.isFetching}
              selectedRowKeys={selectedKeys}
              onSelectionChange={setSelectedKeys}
              onWeightChange={(item, weight) => itemMutation.mutate({ item: { ...item, weight } })}
              onRepeatCountChange={(item, repeatCount) =>
                itemMutation.mutate({ item: { ...item, repeat_count: repeatCount } })
              }
              onEdit={(item) => setEditor({ item })}
              onDelete={(item) => confirmDelete([item.id])}
            />
          </Card>
        </>
      )}

      {editor !== null ? (
        <PromptItemEditor
          item={editor.item}
          saving={editor.item === null ? addMutation.isPending : itemMutation.isPending}
          onCancel={() => setEditor(null)}
          onSubmit={submitEditor}
        />
      ) : null}
    </div>
  );
}

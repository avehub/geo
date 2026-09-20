import { useCallback, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Radio, Select, Space, Tag, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import * as client from '../api/client';
import { describeErrorCode, describeIpcError } from '../api/errors';
import type {
  GenerateOptions,
  IntentCategory,
  PromptDraft,
  PromptItem,
  PromptSet,
  PromptSource,
} from '../api/types';
import { INTENT_VALUES, PROMPT_SOURCE_VALUES } from '../api/types';
import CsvToolbar from '../components/CsvToolbar';
import GeneratePanel from '../components/GeneratePanel';
import PromptItemEditor from '../components/PromptItemEditor';
import PromptTable from '../components/PromptTable';
import SampleSizeAlert from '../components/SampleSizeAlert';
import { enumLabel } from '../i18n/enum-label';

type IntentFilter = IntentCategory | 'all';
/**
 * 没有分组的条目在筛选器里归到这一档。
 *
 * 值是**稳定 ASCII 记号**而不是展示文案（Task 9）：它同时充当分组 `Select` 的 `value`，
 * 拿中文当 value 的话 en locale 下筛选状态里仍是一个中文串。展示文案走
 * `prompt.promptSet.groupFilterNoGroup`，在 `groupOptions` 里映射。
 */
const NO_GROUP = '__ungrouped__';

function groupOf(item: PromptItem): string {
  const name = item.group_name?.trim();
  return name === undefined || name === '' ? NO_GROUP : name;
}

/** 后端 `degradation_note()` 的机器行前缀（`prompt_service.rs` 的 `DEGRADED_PREFIX`）。 */
const DEGRADED_PREFIX = 'degraded ';

/**
 * `notes` 按行分派（计划正文那条"控制器裁定"，简报 B-6）。
 *
 * 后端发的是 `degraded ` + **紧凑 JSON** 的单行 ASCII 机器行，字段是 `stage` / `code` / `params`
 * （`apps/desktop/src-tauri/src/services/prompt_service.rs` 的 `degradation_note`）。
 * **机器行不许原样显示给用户**，所以这里 `JSON.parse` 之后走词典：`stage` 取译文，
 * `code` + `params` 交给 Task 7 的 `describeIpcError` 渲染。
 *
 * 其余行**原样渲染**——`notes` 里还并存着既存的中文散文行（配额不足、合规拦截那几条，
 * 裁定 §H-2 明令不许顺手改），以及升级前落库的老数据。解析失败或形状不对同样原样渲染并
 * `console.warn`：`notes` 是**持久化**字段，宁可见到一行难看的原文，也不要因为一次形状漂移
 * 把整块提示静默吞掉。
 */
function describeNoteLine(line: string, t: TFunction): string {
  if (!line.startsWith(DEGRADED_PREFIX)) return line;

  let record: unknown;
  try {
    record = JSON.parse(line.slice(DEGRADED_PREFIX.length));
  } catch {
    console.warn('[geo-i18n] malformed degraded note line, rendering raw:', line);
    return line;
  }

  if (typeof record !== 'object' || record === null) {
    console.warn('[geo-i18n] degraded note is not an object, rendering raw:', line);
    return line;
  }

  const { stage, code, params } = record as { stage?: unknown; code?: unknown; params?: unknown };
  if (typeof code !== 'string' || code === '' || typeof stage !== 'string') {
    console.warn('[geo-i18n] degraded note is missing stage/code, rendering raw:', line);
    return line;
  }

  const values: Record<string, string> = {};
  if (typeof params === 'object' && params !== null) {
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      if (typeof value === 'string') values[key] = value;
    }
  }

  // stage 走 raw passthrough：后端将来加了第三种 stage，界面露出机器记号（显眼、可排查），
  // 而不是静默渲染成半句话。两个 stage 键的覆盖断言在 no-hardcoded-strings.test.ts（B-4 同类问题：
  // 扫描测试只看字面量，抓不到这种从数据里拼出来的 key）。
  const stageKey = `prompt.promptSet.notes.stage.${stage}`;
  const rendered = t(stageKey, { nsSeparator: false });
  const stageText =
    typeof rendered === 'string' && rendered !== '' && rendered !== stageKey ? rendered : stage;

  // `fallbackMessage` 填 code 本身：词典 miss 时阶梯第 ③ 级会回落它，露出稳定记号比露一句
  // 中文更利于排障。裁定 B-7 选项 A：走导出的 `describeErrorCode`，不再合成假的
  // `IpcRequestError`——机器行里本来就没有 Error 对象，造一个只为满足 `instanceof` 是噪音。
  const detail = describeErrorCode(code, values, code, t);

  return t('prompt.promptSet.notes.degraded', { stage: stageText, detail });
}

/** M2 Prompt 智能题库：生成、筛选、增删改、加权、去重检查与 CSV 往返。 */
export default function PromptSetPage() {
  const { id: projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const { t } = useTranslation();

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
      message.success(
        t('prompt.promptSet.generated', {
          total: promptSet.items.length,
          version: promptSet.version,
        }),
      );
      setDedupeSummary(null);
      setSelectedKeys([]);
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const itemMutation = useMutation({
    mutationFn: ({ item, notice }: { item: PromptItem; notice?: string }) =>
      client.promptItemUpdate(item).then((updated) => ({ updated, notice })),
    onSuccess: ({ notice }) => {
      if (notice) message.success(notice);
      // 改一条也会换掉整份快照的 content_hash，重取比手工打补丁可靠
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const addMutation = useMutation({
    mutationFn: (draft: PromptDraft) => client.promptItemAdd(activeId as string, [draft]),
    onSuccess: (updated) => {
      applySet(updated);
      message.success(t('prompt.promptSet.added', { total: updated.items.length }));
      setEditor(null);
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => client.promptItemDelete(activeId as string, ids),
    onSuccess: (updated, ids) => {
      applySet(updated);
      setSelectedKeys([]);
      message.success(
        t('prompt.promptSet.removed', { deleted: ids.length, total: updated.items.length }),
      );
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const dedupeMutation = useMutation({
    mutationFn: () => client.promptSetDedupe(activeId as string),
    onSuccess: (report) => {
      setDedupeSummary(
        t('prompt.promptSet.dedupeSummary', {
          pairs: report.duplicate_pairs,
          removed: report.removed.length,
          kept: report.kept.length,
        }),
      );
      setSelectedKeys([]);
      refresh();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
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
    const options = Array.from(groups).map((group) => ({
      value: group,
      label: group === NO_GROUP ? t('prompt.promptSet.groupFilterNoGroup') : group,
    }));
    // 按**展示文案**排序而不是按 value：真实分组名两者逐字相同，只有「未分组」那一档不同，
    // 所以 zh 下的顺序与抽取前完全一致，en 下 'Ungrouped' 也落在合理位置。
    options.sort((left, right) =>
      left.label < right.label ? -1 : left.label > right.label ? 1 : 0,
    );
    return [{ value: 'all', label: t('prompt.promptSet.groupFilterAll') }, ...options];
  }, [promptSet, t]);

  const sourceOptions = useMemo(
    () => [
      { value: 'all', label: t('prompt.promptSet.sourceFilterAll') },
      // 来源标签查 `prompt.sources.<id>`，查不到回退 id 本身（照 `ProviderSelect` 的先例）；
      // 运行时枚举清单是 `api/types.ts` 的 `PROMPT_SOURCE_VALUES`，选项顺序 = 值清单顺序。
      ...PROMPT_SOURCE_VALUES.map((value) => ({
        value,
        label: enumLabel(t, 'prompt.sources', value),
      })),
    ],
    [t],
  );

  function confirmDelete(ids: string[]) {
    modal.confirm({
      title: t('prompt.promptSet.deleteConfirmTitle', { total: ids.length }),
      content: t('prompt.promptSet.deleteConfirmContent'),
      okText: t('prompt.promptSet.deleteConfirmOk'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
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
      notice: t('prompt.promptSet.updated'),
    });
    setEditor(null);
  }

  if (listQuery.isError || setQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('prompt.promptSet.loadFailed')}
        description={describeIpcError(listQuery.error ?? setQuery.error, t)}
      />
    );
  }

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t('prompt.promptSet.title')}
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
            {t('prompt.promptSet.empty')}
          </Typography.Paragraph>
        </Card>
      ) : (
        <>
          <Card size="small" style={{ marginBottom: 12 }}>
            <Space size={16} wrap>
              <Typography.Text strong>{promptSet.label}</Typography.Text>
              <Tag color="blue">{t('prompt.promptSet.version', { version: promptSet.version })}</Tag>
              <Typography.Text type="secondary">
                {t('prompt.promptSet.itemCount', { total: promptSet.items.length })}
              </Typography.Text>
              <Typography.Text type="secondary" copyable={{ text: promptSet.content_hash }}>
                {t('prompt.promptSet.contentHash', { hash: promptSet.content_hash })}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t('prompt.promptSet.metricSpec', { spec: promptSet.metric_spec_version })}
              </Typography.Text>
              <Button
                size="small"
                loading={dedupeMutation.isPending}
                disabled={!activeId}
                onClick={() => dedupeMutation.mutate()}
              >
                {t('prompt.promptSet.dedupe')}
              </Button>
            </Space>
            {promptSet.notes ? (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 8 }}
                message={promptSet.notes
                  .split('\n')
                  .filter((line) => line.trim() !== '')
                  .map((line, index) => (
                    <div key={`${index}:${line.slice(0, 32)}`}>{describeNoteLine(line, t)}</div>
                  ))}
              />
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
                  {
                    value: 'all',
                    label: t('prompt.promptSet.intentFilterAll', { total: promptSet.items.length }),
                  },
                  // 意图标签查 `prompt.intents.<id>`，查不到回退 id 本身；运行时枚举清单是
                  // `api/types.ts` 的 `INTENT_VALUES`，选项顺序 = 值清单顺序。
                  ...INTENT_VALUES.map((value) => ({
                    value,
                    label: enumLabel(t, 'prompt.intents', value),
                  })),
                ]}
              />
              <Select
                size="small"
                style={{ width: 150 }}
                aria-label={t('prompt.promptSet.groupFilterAria')}
                value={groupFilter}
                options={groupOptions}
                onChange={setGroupFilter}
              />
              <Select
                size="small"
                style={{ width: 140 }}
                aria-label={t('prompt.promptSet.sourceFilterAria')}
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
                {t('prompt.promptSet.addPrompt')}
              </Button>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={selectedKeys.length === 0}
                loading={deleteMutation.isPending}
                onClick={() => confirmDelete(selectedKeys)}
              >
                {selectedKeys.length > 0
                  ? t('prompt.promptSet.deleteSelectedCount', { selected: selectedKeys.length })
                  : t('prompt.promptSet.deleteSelected')}
              </Button>
              <Typography.Text type="secondary">
                {t('prompt.promptSet.filtered', {
                  shown: items.length,
                  total: promptSet.items.length,
                })}
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

import { useCallback, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Radio, Space, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import * as client from '../api/client';
import { IpcRequestError } from '../api/client';
import type { GenerateOptions, IntentCategory, PromptItem } from '../api/types';
import { INTENT_LABELS } from '../api/types';
import CsvToolbar from '../components/CsvToolbar';
import GeneratePanel from '../components/GeneratePanel';
import PromptTable from '../components/PromptTable';
import SampleSizeAlert from '../components/SampleSizeAlert';

type IntentFilter = IntentCategory | 'all';

function describeError(error: unknown): string {
  if (error instanceof IpcRequestError) return error.userMessage;
  return error instanceof Error ? error.message : '未知错误';
}

/** M2 Prompt 智能题库：生成、筛选、加权、去重检查与 CSV 往返。 */
export default function PromptSetPage() {
  const { id: projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const [intentFilter, setIntentFilter] = useState<IntentFilter>('all');
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

  const generateMutation = useMutation({
    mutationFn: (options: GenerateOptions) => client.promptSetGenerate(projectId, options),
    onSuccess: (promptSet) => {
      // 新快照直接写缓存，避免「生成完还看旧版本」的错觉
      queryClient.setQueryData(['prompt-set', promptSet.id], promptSet);
      void queryClient.invalidateQueries({ queryKey: ['prompt-sets', projectId] });
      message.success(`已生成 ${promptSet.items.length} 条 prompt（第 ${promptSet.version} 版）`);
      setDedupeSummary(null);
    },
    onError: (error) => message.error(describeError(error)),
  });

  const weightMutation = useMutation({
    mutationFn: (item: PromptItem) => client.promptItemUpdate(item),
    onSuccess: (updated) => {
      const current = setQuery.data;
      if (current) {
        queryClient.setQueryData(['prompt-set', current.id], {
          ...current,
          items: current.items.map((item) => (item.id === updated.id ? updated : item)),
        });
      }
    },
    onError: (error) => message.error(describeError(error)),
  });

  const dedupeMutation = useMutation({
    mutationFn: () => client.promptSetDedupe(activeId as string),
    onSuccess: (report) => {
      setDedupeSummary(
        `重复对：${report.duplicate_pairs}，合并移除：${report.removed.length}，保留：${report.kept.length}`,
      );
      refresh();
    },
    onError: (error) => message.error(describeError(error)),
  });

  const promptSet = setQuery.data ?? null;
  const items = useMemo(() => {
    const all = promptSet?.items ?? [];
    return intentFilter === 'all' ? all : all.filter((item) => item.intent === intentFilter);
  }, [intentFilter, promptSet]);

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
            <Radio.Group
              optionType="button"
              size="small"
              style={{ marginBottom: 12 }}
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
            <PromptTable
              items={items}
              loading={setQuery.isFetching}
              onWeightChange={(item, weight) => weightMutation.mutate({ ...item, weight })}
            />
          </Card>
        </>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Alert, App, Button, Descriptions, Input, Space, Tag, Typography } from 'antd';
import { KeyOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as client from '../api/client';
import { IpcRequestError } from '../api/client';
import type { LlmTestResult } from '../api/types';

function describeError(error: unknown): string {
  if (error instanceof IpcRequestError) return error.userMessage;
  return error instanceof Error ? error.message : '未知错误';
}

export interface SecretStatusPanelProps {
  /** `llm_providers` 返回的 provider 取值（与后端 `as_str()` 同源）。 */
  provider: string;
}

/**
 * API Key 管理：状态、保存、删除与连通性测试。
 *
 * 红线（AGENTS.md 规则 3）：Key 只写进系统钥匙串，界面上保存后立即清空输入框，
 * 也不做任何本地缓存；后端 `secret_status` 只回 `configured` 与引用串。
 */
export default function SecretStatusPanel({ provider }: SecretStatusPanelProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<LlmTestResult | null>(null);

  const statusQuery = useQuery({
    queryKey: ['secret-status', provider],
    queryFn: () => client.secretStatus(provider),
    enabled: provider !== '',
  });

  const saveMutation = useMutation({
    mutationFn: (secret: string) => client.secretSet(provider, secret),
    onSuccess: () => {
      setValue('');
      setFailure(null);
      message.success('API Key 已写入系统钥匙串');
      void queryClient.invalidateQueries({ queryKey: ['secret-status', provider] });
    },
    onError: (error) => message.error(describeError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => client.secretDelete(provider),
    onSuccess: () => {
      message.success('API Key 已删除');
      void queryClient.invalidateQueries({ queryKey: ['secret-status', provider] });
    },
    onError: (error) => message.error(describeError(error)),
  });

  const testMutation = useMutation({
    mutationFn: () => client.llmProviderTest(provider),
    onSuccess: (payload) => {
      setResult(payload);
      setFailure(payload.ok ? null : (payload.message ?? '连接失败'));
    },
    onError: (error) => {
      setResult(null);
      setFailure(describeError(error));
    },
  });

  const status = statusQuery.data ?? null;
  const configured = status?.configured ?? false;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space size={8} wrap>
        {status === null ? (
          <Tag>读取中</Tag>
        ) : (
          <Tag color={configured ? 'success' : 'warning'}>{configured ? '已配置' : '未配置'}</Tag>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {status?.secret_ref ?? '—'}
        </Typography.Text>
      </Space>

      <Space.Compact style={{ width: '100%', maxWidth: 520 }}>
        <Input.Password
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="请输入 API Key"
          autoComplete="off"
        />
        <Button
          type="primary"
          icon={<KeyOutlined />}
          loading={saveMutation.isPending}
          onClick={() => {
            const secret = value.trim();
            if (secret === '') {
              message.warning('请先输入 API Key');
              return;
            }
            saveMutation.mutate(secret);
          }}
        >
          保存到钥匙串
        </Button>
      </Space.Compact>

      <Space>
        <Button loading={testMutation.isPending} onClick={() => testMutation.mutate()}>
          测试连接
        </Button>
        <Button
          danger
          disabled={!configured}
          loading={deleteMutation.isPending}
          onClick={() => deleteMutation.mutate()}
        >
          删除 Key
        </Button>
      </Space>

      {failure && <Alert type="error" showIcon message={failure} />}

      {result?.ok && (
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="模型">{result.model}</Descriptions.Item>
          <Descriptions.Item label="耗时">{`${result.latency_ms} ms`}</Descriptions.Item>
          <Descriptions.Item label="用量">{`${result.prompt_tokens} / ${result.completion_tokens} tokens`}</Descriptions.Item>
          <Descriptions.Item label="成本">{`¥${result.cost_cny.toFixed(2)}`}</Descriptions.Item>
        </Descriptions>
      )}

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Key 只保存在本机系统钥匙串，数据库里只留引用串；换机或重装需要重新填写。
      </Typography.Text>
    </Space>
  );
}

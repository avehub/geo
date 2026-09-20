import { useState } from 'react';
import { Alert, App, Button, Descriptions, Input, Space, Tag, Typography } from 'antd';
import { KeyOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import { describeIpcError } from '../api/errors';
import type { LlmTestResult } from '../api/types';

export interface SecretStatusPanelProps {
  /** `llm_providers` 返回的 provider 取值（与后端 `as_str()` 同源）。 */
  provider: string;
}

/**
 * API Key 管理：状态、保存、删除与连通性测试。
 *
 * 红线（AGENTS.md 规则 3）：Key 只写进系统钥匙串，界面上保存后立即清空输入框，
 * 也不做任何本地缓存；后端 `secret_status` 只回 `configured` 与引用串。
 *
 * 本地的 `describeError` 删掉了，改调 Task 7 的 `describeIpcError`（Task 7 的 commit 明写
 * 这一处留给 Task 8）：`error.userMessage` 今天是 `{code} {k}={v}…` 的**紧凑日志串**，
 * 而 `'未知错误'` 那句兜底是组件里的硬编码中文。词典渲染后两者都按当前语言出话。
 *
 * ⚠ `payload.message ?? t('settings.secret.testFailed')`：`LlmTestResult.message` 是**后端
 * 产出的自然语言**，英文 locale 下仍是中文。这是继 `ProviderInfo.label_zh` 与 notes 散文行之后的
 * 第三处同类泄漏，但它不是 `IpcError`（没有 `code` 可查词典），修它要动 `llm_provider_test`
 * 的返回契约 ⇒ 超出本任务写集，已记进 task-8-report.md 的 backlog。
 */
export default function SecretStatusPanel({ provider }: SecretStatusPanelProps) {
  const { message } = App.useApp();
  const { t } = useTranslation();
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
      message.success(t('settings.secret.saved'));
      void queryClient.invalidateQueries({ queryKey: ['secret-status', provider] });
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => client.secretDelete(provider),
    onSuccess: () => {
      message.success(t('settings.secret.deleted'));
      void queryClient.invalidateQueries({ queryKey: ['secret-status', provider] });
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const testMutation = useMutation({
    mutationFn: () => client.llmProviderTest(provider),
    onSuccess: (payload) => {
      setResult(payload);
      setFailure(payload.ok ? null : (payload.message ?? t('settings.secret.testFailed')));
    },
    onError: (error) => {
      setResult(null);
      setFailure(describeIpcError(error, t));
    },
  });

  const status = statusQuery.data ?? null;
  const configured = status?.configured ?? false;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space size={8} wrap>
        {status === null ? (
          <Tag>{t('settings.secret.reading')}</Tag>
        ) : (
          <Tag color={configured ? 'success' : 'warning'}>
            {configured ? t('settings.secret.configured') : t('settings.secret.notConfigured')}
          </Tag>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {status?.secret_ref ?? '—'}
        </Typography.Text>
      </Space>

      <Space.Compact style={{ width: '100%', maxWidth: 520 }}>
        <Input.Password
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('settings.secret.placeholder')}
          autoComplete="off"
        />
        <Button
          type="primary"
          icon={<KeyOutlined />}
          loading={saveMutation.isPending}
          onClick={() => {
            const secret = value.trim();
            if (secret === '') {
              message.warning(t('settings.secret.emptyWarning'));
              return;
            }
            saveMutation.mutate(secret);
          }}
        >
          {t('settings.secret.save')}
        </Button>
      </Space.Compact>

      <Space>
        <Button loading={testMutation.isPending} onClick={() => testMutation.mutate()}>
          {t('settings.secret.test')}
        </Button>
        <Button
          danger
          disabled={!configured}
          loading={deleteMutation.isPending}
          onClick={() => deleteMutation.mutate()}
        >
          {t('settings.secret.delete')}
        </Button>
      </Space>

      {failure && <Alert type="error" showIcon message={failure} />}

      {result?.ok && (
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label={t('settings.secret.result.model')}>{result.model}</Descriptions.Item>
          <Descriptions.Item label={t('settings.secret.result.latency')}>{`${result.latency_ms} ms`}</Descriptions.Item>
          <Descriptions.Item label={t('settings.secret.result.usage')}>{`${result.prompt_tokens} / ${result.completion_tokens} tokens`}</Descriptions.Item>
          <Descriptions.Item label={t('settings.secret.result.cost')}>{`¥${result.cost_cny.toFixed(2)}`}</Descriptions.Item>
        </Descriptions>
      )}

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('settings.secret.hint')}
      </Typography.Text>
    </Space>
  );
}

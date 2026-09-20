import { useState } from 'react';
import { Alert, App, Button, Card, Input, Space, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import { describeIpcError } from '../api/errors';
import type { EntityCard } from '../api/types';

export interface AutoBuildPanelProps {
  projectId: string;
  defaultDomain?: string;
  onBuilt: (card: EntityCard) => void;
}

/**
 * 域名自动建档：抓取自有站点 → LLM 结构化抽取实体卡。
 *
 * 只抓自有域名（后端 `geo-crawler` 负责 robots 与页数上限），
 * LLM 不可用时后端返回「待确认」降级实体卡，不报错。
 *
 * 错误文案改走 Task 7 的 `describeIpcError`（Task 7 的 commit 明写「CsvToolbar/SecretStatus
 * 的 describeError 留给 Task 8」，本组件同理）：原先这里读 `error.userMessage`，而它今天是
 * `{code} {k}={v}…` 的**紧凑日志串**，等于把日志端给用户；非 IPC 异常还有一句硬编码中文兜底。
 * 换成词典渲染后两种情况都按当前语言出话，兜底是 `common.unknownError`，
 * 且 `describeIpcError` 自己会 `console.warn` 留下排障线索。
 */
export default function AutoBuildPanel({ projectId, defaultDomain = '', onBuilt }: AutoBuildPanelProps) {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const [domain, setDomain] = useState(defaultDomain);
  const [localError, setLocalError] = useState<string | null>(null);

  const buildMutation = useMutation({
    mutationFn: (value: string) => client.entityCardAutobuild(projectId, value),
    onSuccess: (card) => {
      onBuilt(card);
      message.success(
        t('entity.autobuild.success', { percent: Math.round(card.completeness * 100) }),
      );
    },
    onError: (error) => {
      const text = describeIpcError(error, t);
      setLocalError(text);
      message.error(text);
    },
  });

  function submit() {
    const value = domain.trim();
    if (value === '') {
      setLocalError(t('entity.autobuild.emptyDomain'));
      return;
    }
    setLocalError(null);
    buildMutation.mutate(value);
  }

  return (
    <Card
      size="small"
      title={t('entity.autobuild.title')}
      style={{ marginBottom: 16 }}
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('entity.autobuild.scopeHint')}
        </Typography.Text>
      }
    >
      <Space.Compact style={{ width: '100%', maxWidth: 520 }}>
        <Input
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          onPressEnter={submit}
          placeholder={t('entity.autobuild.domainPlaceholder')}
          allowClear
        />
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={buildMutation.isPending}
          onClick={submit}
        >
          {t('entity.autobuild.submit')}
        </Button>
      </Space.Compact>

      {localError && (
        <Alert type="error" showIcon style={{ marginTop: 12 }} message={localError} />
      )}
      {buildMutation.isPending && (
        <Alert type="info" showIcon style={{ marginTop: 12 }} message={t('entity.autobuild.running')} />
      )}
    </Card>
  );
}

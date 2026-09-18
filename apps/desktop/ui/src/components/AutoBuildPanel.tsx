import { useState } from 'react';
import { Alert, App, Button, Card, Input, Space, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';

import * as client from '../api/client';
import { IpcRequestError } from '../api/client';
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
 */
export default function AutoBuildPanel({ projectId, defaultDomain = '', onBuilt }: AutoBuildPanelProps) {
  const { message } = App.useApp();
  const [domain, setDomain] = useState(defaultDomain);
  const [localError, setLocalError] = useState<string | null>(null);

  const buildMutation = useMutation({
    mutationFn: (value: string) => client.entityCardAutobuild(projectId, value),
    onSuccess: (card) => {
      onBuilt(card);
      message.success(`自动建档完成，字段完整率 ${Math.round(card.completeness * 100)}%`);
    },
    onError: (error) => {
      const text =
        error instanceof IpcRequestError ? error.userMessage : '自动建档失败，请稍后重试';
      setLocalError(text);
      message.error(text);
    },
  });

  function submit() {
    const value = domain.trim();
    if (value === '') {
      setLocalError('请输入要抓取的官网域名，例如 www.example.com');
      return;
    }
    setLocalError(null);
    buildMutation.mutate(value);
  }

  return (
    <Card
      size="small"
      title="域名自动建档"
      style={{ marginBottom: 16 }}
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          仅抓自有域名，遵守 robots.txt，最多 8 页
        </Typography.Text>
      }
    >
      <Space.Compact style={{ width: '100%', maxWidth: 520 }}>
        <Input
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          onPressEnter={submit}
          placeholder="例如：www.hongyu-pump.com"
          allowClear
        />
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={buildMutation.isPending}
          onClick={submit}
        >
          自动建档
        </Button>
      </Space.Compact>

      {localError && (
        <Alert type="error" showIcon style={{ marginTop: 12 }} message={localError} />
      )}
      {buildMutation.isPending && (
        <Alert type="info" showIcon style={{ marginTop: 12 }} message="正在抓取官网并抽取实体卡…" />
      )}
    </Card>
  );
}

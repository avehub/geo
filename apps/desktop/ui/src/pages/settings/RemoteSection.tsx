/**
 * 设置 · 远程内容与更新段（Task 11）。
 *
 * # 这一段回答三个问题
 * 1. **现在用的是什么**：每项产物的版本与来源（`remote` / `builtin` / `none`）；
 * 2. **为什么是这样**：上次同步的状态与原因码（`unavailable` / `rejected_digest` …）；
 * 3. **怎么让它变成远程**：一个「立即同步」按钮（I-3：除此之外**没有**定时轮询）。
 *
 * # 🔴 三个刻意的设计
 * - **不显示「最新版本」**：客户端只知道自己拿到了什么，不知道服务端"最新"是什么。
 *   写"已是最新"是一句无法验证的断言（也是绝对化用语）。
 * - **`degraded` 必须显式说出来**：内置兜底能让应用照常工作，但用户有权知道
 *   「现在执行的是随安装包冻结的规则」，而不是以为远程内容已经生效。
 * - **同步失败不弹错误框**：失败写进 `remote_sync_log` 并在本段展示（沿用 I-1）。
 */
import { Alert, Button, Card, Descriptions, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as client from '../../api/client';
import type { RemoteItemStatus } from '../../api/types-remote';
import type { SectionProps } from './sections';

/** 来源 → 颜色。只用三种（远程/内置/无），与后端 `RemoteSource` 闭合枚举一致。 */
const SOURCE_COLOR: Record<string, string> = {
  remote: 'green',
  builtin: 'gold',
  none: 'default',
};

export default function RemoteSection(_props: SectionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['remote-status'],
    queryFn: () => client.remoteStatus(),
  });

  const syncMutation = useMutation({
    mutationFn: () => client.remoteSync(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['remote-status'] });
    },
  });

  const status = statusQuery.data ?? null;
  const report = syncMutation.data ?? null;
  const degraded = status?.degraded ?? true;

  const rows: RemoteItemStatus[] = status?.items.length
    ? status.items
    : (status?.builtin_versions ?? []);

  return (
    <Card size="small" title={t('settings.sections.remote')} loading={statusQuery.isLoading}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t('settings.remote.desc')}
        </Typography.Paragraph>

        {status !== null && degraded && (
          <Alert type="warning" showIcon message={t('settings.remote.degraded')} />
        )}
        {status !== null && !degraded && (
          <Alert type="success" showIcon message={t('settings.remote.healthy')} />
        )}

        {report !== null && (
          <Alert
            type={report.status === 'ok' ? 'success' : 'warning'}
            showIcon
            message={t('settings.remote.syncResult', {
              status: report.status,
              changed: report.changed.length,
              failed: report.failed.length,
            })}
          />
        )}

        <Descriptions
          size="small"
          column={1}
          items={[
            {
              key: 'endpoint',
              label: t('settings.remote.endpoint'),
              children: status?.base_url ?? t('settings.remote.unknown'),
            },
            {
              key: 'key',
              label: t('settings.remote.publicKey'),
              children:
                status?.public_key_configured === true
                  ? t('settings.remote.keyConfigured')
                  : t('settings.remote.keyMissing'),
            },
            {
              key: 'last',
              label: t('settings.remote.lastSync'),
              children: status?.last_sync
                ? `${status.last_sync.started_at} · ${status.last_sync.status}`
                : t('settings.remote.never'),
            },
          ]}
        />

        <Table<RemoteItemStatus>
          size="small"
          rowKey="key"
          pagination={false}
          dataSource={rows}
          columns={[
            { title: t('settings.remote.itemKey'), dataIndex: 'key' },
            { title: t('settings.remote.itemVersion'), dataIndex: 'version', width: 140 },
            {
              title: t('settings.remote.itemSource'),
              dataIndex: 'source',
              width: 120,
              render: (source: string) => (
                <Tag color={SOURCE_COLOR[source] ?? 'default'}>
                  {t(`settings.remote.source.${source}`, { defaultValue: source })}
                </Tag>
              ),
            },
          ]}
        />

        <Space>
          <Button
            type="primary"
            loading={syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
          >
            {syncMutation.isPending ? t('settings.remote.syncing') : t('settings.remote.syncNow')}
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('settings.remote.syncHint')}
          </Typography.Text>
        </Space>
      </Space>
    </Card>
  );
}

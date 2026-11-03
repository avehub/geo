/**
 * 设置 · 采集与频控段（Plan B Task 2 机械平移自 `pages/SettingsPage.tsx`）。
 *
 * 本段是**自动保存**段（spec DR-28）：并发与频控是"调完立刻要看效果"的旋钮，
 * 多一个保存按钮只会被读成"没生效"。
 */
import { Card, InputNumber, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { AppSettings, ConcurrencyConfig, RateLimitConfig } from '../../api/types';
import type { SectionProps } from './sections';

// 两个补丁函数：`InputNumber` 清空时回调 null，用 `??` 回落到默认值，
// 比动态键 + 类型强转安全，也不会把 null 写进设置。
function patchConcurrency(settings: AppSettings, patch: Partial<ConcurrencyConfig>): AppSettings {
  return { ...settings, concurrency: { ...settings.concurrency, ...patch } };
}

function patchRateLimit(settings: AppSettings, patch: Partial<RateLimitConfig>): AppSettings {
  return { ...settings, rate_limit: { ...settings.rate_limit, ...patch } };
}

export default function CollectionSection({ settings, patch }: SectionProps) {
  const { t } = useTranslation();

  return (
    <Card size="small" title={t('settings.page.crawlerCard')}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('settings.page.crawlerHint')}
      </Typography.Paragraph>
      <Space size={24} wrap>
        <div>
          <label htmlFor="settings-max-parallel" style={{ marginRight: 8 }}>
            {t('settings.page.maxParallel')}
          </label>
          <InputNumber
            id="settings-max-parallel"
            min={1}
            max={16}
            value={settings.concurrency.max_parallel}
            onChange={(value) => patch(patchConcurrency(settings, { max_parallel: value ?? 3 }))}
          />
        </div>
        <div>
          <label htmlFor="settings-queue-size" style={{ marginRight: 8 }}>
            {t('settings.page.queueSize')}
          </label>
          <InputNumber
            id="settings-queue-size"
            min={1}
            max={10000}
            value={settings.concurrency.queue_size}
            onChange={(value) => patch(patchConcurrency(settings, { queue_size: value ?? 200 }))}
          />
        </div>
        <div>
          <label htmlFor="settings-rpm" style={{ marginRight: 8 }}>
            {t('settings.page.requestsPerMinute')}
          </label>
          <InputNumber
            id="settings-rpm"
            min={1}
            max={600}
            value={settings.rate_limit.requests_per_minute}
            onChange={(value) =>
              patch(patchRateLimit(settings, { requests_per_minute: value ?? 20 }))
            }
          />
        </div>
        <div>
          <label htmlFor="settings-interval" style={{ marginRight: 8 }}>
            {t('settings.page.minIntervalMs')}
          </label>
          <InputNumber
            id="settings-interval"
            min={0}
            max={60000}
            step={100}
            value={settings.rate_limit.min_interval_ms}
            onChange={(value) => patch(patchRateLimit(settings, { min_interval_ms: value ?? 1500 }))}
          />
        </div>
        <div>
          <label htmlFor="settings-retry" style={{ marginRight: 8 }}>
            {t('settings.page.retryMax')}
          </label>
          <InputNumber
            id="settings-retry"
            min={0}
            max={10}
            value={settings.rate_limit.retry_max}
            onChange={(value) => patch(patchRateLimit(settings, { retry_max: value ?? 3 }))}
          />
        </div>
      </Space>
    </Card>
  );
}

import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import { describeIpcError } from '../api/errors';
import type { AppSettings, ConcurrencyConfig, ModelConfig, RateLimitConfig } from '../api/types';
import ProviderSelect from '../components/ProviderSelect';
import ProxyForm from '../components/ProxyForm';
import SecretStatusPanel from '../components/SecretStatus';

// 三个段落各给一个补丁函数：`InputNumber` 清空时回调 null，用 `??` 回落到默认值，
// 比动态键 + 类型强转安全，也不会把 null 写进设置。
function patchConcurrency(settings: AppSettings, patch: Partial<ConcurrencyConfig>): AppSettings {
  return { ...settings, concurrency: { ...settings.concurrency, ...patch } };
}

function patchRateLimit(settings: AppSettings, patch: Partial<RateLimitConfig>): AppSettings {
  return { ...settings, rate_limit: { ...settings.rate_limit, ...patch } };
}

function patchModel(settings: AppSettings, patch: Partial<ModelConfig>): AppSettings {
  return { ...settings, model: { ...settings.model, ...patch } };
}

/**
 * 设置页：模型服务商与 API Key、代理、采集并发与频控、语言与通知。
 *
 * 所有编辑都先在本地草稿上进行，点「保存设置」才整包写库——设置是段落化存储，
 * 半包提交会把没改的段落冲掉。代理与超时影响的是已构造好的 HTTP 客户端，
 * 保存后提示重启生效（P0-B 接上热重建）。
 */
export default function SettingsPage() {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AppSettings | null>(null);

  const providersQuery = useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => client.llmProviders(),
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => client.settingsGet(),
  });

  const saveMutation = useMutation({
    mutationFn: (settings: AppSettings) => client.settingsUpdate(settings),
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings'], saved);
      setDraft(null);
      message.success(t('settings.page.saved'));
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  if (settingsQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message={t('settings.page.loadFailed')}
        description={describeIpcError(settingsQuery.error, t)}
      />
    );
  }

  const settings = draft ?? settingsQuery.data ?? null;
  const providers = providersQuery.data ?? [];

  if (settings === null) {
    return <Card loading />;
  }

  const patch = (next: AppSettings) => setDraft(next);

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {t('settings.page.title')}
      </Typography.Title>

      <Row gutter={16}>
        <Col span={14}>
          <Card size="small" title={t('settings.page.modelCard')} style={{ marginBottom: 16 }}>
            <ProviderSelect
              providers={providers}
              value={settings.model.provider}
              baseUrl={settings.model.base_url ?? ''}
              onBaseUrlChange={(baseUrl) =>
                patch({
                  ...settings,
                  model: {
                    ...settings.model,
                    base_url: baseUrl.trim() === '' ? null : baseUrl.trim(),
                  },
                })
              }
              onChange={(provider) =>
                patch({
                  ...settings,
                  model: {
                    ...settings.model,
                    provider,
                    model: null,
                    // 切走「自定义」就清掉地址覆盖：后端对预设服务商同样认这个字段，
                    // 留着会让请求悄悄走到用户早就切掉的地址上。
                    base_url: provider === 'custom' ? (settings.model.base_url ?? null) : null,
                  },
                })
              }
            />

            <Divider style={{ margin: '16px 0' }} />

            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div>
                <label htmlFor="settings-model-name" style={{ marginRight: 8 }}>
                  {t('settings.page.modelName')}
                </label>
                <Input
                  id="settings-model-name"
                  style={{ maxWidth: 320 }}
                  value={settings.model.model ?? ''}
                  placeholder={t('settings.page.modelNamePlaceholder')}
                  onChange={(event) =>
                    patch({
                      ...settings,
                      model: {
                        ...settings.model,
                        model: event.target.value === '' ? null : event.target.value,
                      },
                    })
                  }
                />
              </div>

              <Space size={24} wrap>
                <div>
                  <label htmlFor="settings-temperature" style={{ marginRight: 8 }}>
                    {t('settings.page.temperature')}
                  </label>
                  <InputNumber
                    id="settings-temperature"
                    min={0}
                    max={2}
                    step={0.1}
                    value={settings.model.temperature}
                    onChange={(value) =>
                      patch(patchModel(settings, { temperature: value ?? 0.3 }))
                    }
                  />
                </div>
                <div>
                  <label htmlFor="settings-timeout" style={{ marginRight: 8 }}>
                    {t('settings.page.timeoutSeconds')}
                  </label>
                  <InputNumber
                    id="settings-timeout"
                    min={5}
                    max={600}
                    value={settings.model.timeout_secs}
                    onChange={(value) =>
                      patch(patchModel(settings, { timeout_secs: value ?? 60 }))
                    }
                  />
                </div>
              </Space>
            </Space>
          </Card>

          <Card size="small" title={t('settings.page.proxyCard')} style={{ marginBottom: 16 }}>
            <ProxyForm
              value={settings.proxy}
              onChange={(proxy) => patch({ ...settings, proxy })}
            />
          </Card>

          <Card size="small" title={t('settings.page.crawlerCard')} style={{ marginBottom: 16 }}>
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
                  onChange={(value) =>
                    patch(patchConcurrency(settings, { max_parallel: value ?? 3 }))
                  }
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
                  onChange={(value) =>
                    patch(patchConcurrency(settings, { queue_size: value ?? 200 }))
                  }
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
                  onChange={(value) =>
                    patch(patchRateLimit(settings, { min_interval_ms: value ?? 1500 }))
                  }
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
                  onChange={(value) =>
                    patch(patchRateLimit(settings, { retry_max: value ?? 3 }))
                  }
                />
              </div>
            </Space>
          </Card>
        </Col>

        <Col span={10}>
          <Card size="small" title="API Key" style={{ marginBottom: 16 }}>
            <SecretStatusPanel provider={settings.model.provider} />
          </Card>

          <Card size="small" title={t('settings.page.languageCard')} style={{ marginBottom: 16 }}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div>
                <label htmlFor="settings-language" style={{ marginRight: 8 }}>
                  {t('settings.page.uiLanguage')}
                </label>
                <Select
                  id="settings-language"
                  style={{ width: 200 }}
                  value={settings.language}
                  options={[{ value: 'zh_cn', label: t('settings.page.languageZhCn') }]}
                  onChange={(language) => patch({ ...settings, language })}
                />
                <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  {t('settings.page.languageHint')}
                </Typography.Text>
              </div>
              <Space size={24} wrap>
                <Space size={8}>
                  <Switch
                    id="settings-notify-finish"
                    checked={settings.notify.on_finish}
                    onChange={(onFinish) =>
                      patch({ ...settings, notify: { ...settings.notify, on_finish: onFinish } })
                    }
                  />
                  <label htmlFor="settings-notify-finish">{t('settings.page.notifyOnFinish')}</label>
                </Space>
                <Space size={8}>
                  <Switch
                    id="settings-notify-risk"
                    checked={settings.notify.on_risk}
                    onChange={(onRisk) =>
                      patch({ ...settings, notify: { ...settings.notify, on_risk: onRisk } })
                    }
                  />
                  <label htmlFor="settings-notify-risk">{t('settings.page.notifyOnRisk')}</label>
                </Space>
                <Space size={8}>
                  <Switch
                    id="settings-notify-sound"
                    checked={settings.notify.sound}
                    onChange={(sound) =>
                      patch({ ...settings, notify: { ...settings.notify, sound } })
                    }
                  />
                  <label htmlFor="settings-notify-sound">{t('settings.page.notifySound')}</label>
                </Space>
              </Space>
            </Space>
          </Card>

          <Space>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saveMutation.isPending}
              disabled={draft === null}
              onClick={() => saveMutation.mutate(settings)}
            >
              {t('settings.page.save')}
            </Button>
            <Button disabled={draft === null} onClick={() => setDraft(null)}>
              {t('settings.page.discard')}
            </Button>
            {draft !== null && (
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                {t('settings.page.unsaved')}
              </Typography.Text>
            )}
          </Space>
        </Col>
      </Row>
    </div>
  );
}

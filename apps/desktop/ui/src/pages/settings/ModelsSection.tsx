/**
 * 设置 · 模型服务商段（Plan B Task 2 机械平移自 `pages/SettingsPage.tsx`；Task 4 补上
 * 中转站预设、模型协议与「拉取模型列表」）。
 *
 * 🔴 本段是**显式保存**段（`sections.ts` 的 `isAutoSaveSection` 返回 false，spec DR-28）：
 * 接口地址与 API Key 半包提交会冲掉别的段落（`settings_update` 是整包写），
 * 而且"填一半就落库"会让连通性测试测到一个跑不通的配置。
 *
 * # 🔴 「拉取模型列表」读的是**草稿**，不是已落库那份（DR-34）
 * 这一点与同页的「测试连接」刻意**相反**：`llm_provider_test` 走的是后端 `client_for`，
 * 它读库里已保存的设置，于是"不先保存就测"测的是旧值（已知用户 bug #5，demo 原样复现）。
 * 拉模型名列表没有理由重蹈覆辙——用户正在填的厂商 / 协议 / 地址就该拿它去拉，
 * 所以入参直接取自本段的草稿（`settings` prop 就是草稿）。
 *
 * # 🔴 拉回来的清单**绑在拉它时那套配置上**
 * 清单存在本地 state 里，连同一个 `signature`（厂商 + 协议 + 接口地址）。三者任一改动，
 * 旧清单与旧错误一起**不再上屏**：把 A 家的模型名挂在 B 家的下拉里，比不给下拉更容易骗到人。
 * 用 signature 比对而不是 `useEffect` 清状态，是为了让"清单属于哪套配置"这件事**只有一处判据**。
 *
 * # 🔴 `api_key` 恒传 `null`（AGENTS 规则 3）
 * Key 只活在 `SecretStatusPanel` 与系统钥匙串里，从不经这条命令出去；
 * 真后端在 Plan C 里自己去钥匙串读（`api/types-llm.ts` 的 `LlmModelsQuery` 有这一段说明）。
 */
import { useState } from 'react';
import { Alert, AutoComplete, Button, Card, Divider, InputNumber, Space, Typography } from 'antd';
import { CloudDownloadOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as client from '../../api/client';
import { describeIpcError } from '../../api/errors';
import type { AppSettings, ModelsListSource, ModelConfig } from '../../api/types';
import ProviderSelect from '../../components/ProviderSelect';
import SecretStatusPanel from '../../components/SecretStatus';
import type { SectionProps } from './sections';

function patchModel(settings: AppSettings, patch: Partial<ModelConfig>): AppSettings {
  return { ...settings, model: { ...settings.model, ...patch } };
}

/** 一次拉取的结果（成功或失败），连同"拉它时那套配置"的指纹。 */
interface FetchOutcome {
  signature: string;
  models: string[];
  source: ModelsListSource;
  /** 失败时装 `unknown`（交给 `describeIpcError` 按词典渲染），成功时恒为 `null`。 */
  error: unknown | null;
}

export default function ModelsSection({ settings, providers, patch, saveState }: SectionProps) {
  const { t } = useTranslation();
  const [outcome, setOutcome] = useState<FetchOutcome | null>(null);

  const preset = providers.find((info) => info.provider === settings.model.provider) ?? null;
  // 生效地址 = 用户填的覆盖值，否则回落该厂商的预设地址；两边都空就是 `null`
  // （`custom` 走到这一支时后端会拦下，报"缺少服务地址"）。
  const effectiveBaseUrl = (() => {
    const raw = (settings.model.base_url ?? preset?.base_url ?? '').trim();
    return raw === '' ? null : raw;
  })();
  const signature = JSON.stringify([
    settings.model.provider,
    settings.model.protocol,
    effectiveBaseUrl,
  ]);

  const modelsMutation = useMutation({
    mutationFn: (query: { signature: string } & Parameters<typeof client.llmModelsList>[0]) =>
      client.llmModelsList(query),
    onSuccess: (result, variables) =>
      setOutcome({
        signature: variables.signature,
        models: result.models,
        source: result.source,
        error: null,
      }),
    onError: (error, variables) =>
      setOutcome({ signature: variables.signature, models: [], source: 'preset', error }),
  });

  // 配置一改，`signature` 就不再匹配 ⇒ 上一次的清单与错误一起退场（见文件头）。
  const current = outcome !== null && outcome.signature === signature ? outcome : null;
  const options = (current?.models ?? []).map((model) => ({ value: model }));
  const resultText =
    current === null
      ? null
      : current.error !== null
        ? null
        : current.models.length === 0
          ? t('settings.modelList.empty')
          : current.source === 'upstream'
            ? t('settings.modelList.resultUpstream', { total: current.models.length })
            : t('settings.modelList.resultPreset', { total: current.models.length });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title={t('settings.page.modelCard')}>
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
          protocol={settings.model.protocol}
          onProtocolChange={(protocol) => patch(patchModel(settings, { protocol }))}
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
                // 协议同理：它只对 `custom` 有意义，带着 `anthropic` 切到直连厂商
                // 会让「拉取模型列表」按一个那家根本不听的协议去拉。
                protocol: provider === 'custom' ? settings.model.protocol : 'openai_compat',
              },
            })
          }
        />

        <Divider style={{ margin: '16px 0' }} />

        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space size={12} wrap align="center">
            <Button
              icon={<CloudDownloadOutlined />}
              loading={modelsMutation.isPending}
              onClick={() =>
                modelsMutation.mutate({
                  signature,
                  provider: settings.model.provider,
                  protocol: settings.model.protocol,
                  base_url: effectiveBaseUrl,
                  // 🔴 恒 null：AGENTS 规则 3，Key 不经这条命令出去。
                  api_key: null,
                })
              }
            >
              {modelsMutation.isPending
                ? t('settings.modelList.fetching')
                : t('settings.modelList.fetch')}
            </Button>
            {/* 常驻说明：demo 端的是预置清单，走查的人必须随时看得出这是假数据。 */}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('settings.modelList.hint')}
            </Typography.Text>
          </Space>

          {resultText !== null && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {resultText}
            </Typography.Text>
          )}

          {current?.error != null && (
            <Alert
              type="error"
              showIcon
              message={describeIpcError(current.error, t)}
              description={t('settings.modelList.keepTyped')}
            />
          )}

          <div>
            <label htmlFor="settings-model-name" style={{ marginRight: 8 }}>
              {t('settings.page.modelName')}
            </label>
            {/*
              `AutoComplete` 而不是 `Select`：模型名既可能来自拉回来的清单，也可能要手输
              （自定义服务商在 demo 里恒为空清单）。用 `Select` 就等于禁掉手输，
              而"拉取失败也不清掉已填的模型名"这条承诺也就无从谈起。
            */}
            <AutoComplete
              id="settings-model-name"
              style={{ width: 320 }}
              value={settings.model.model ?? ''}
              options={options}
              placeholder={t('settings.page.modelNamePlaceholder')}
              filterOption={(input, option) =>
                String(option?.value ?? '')
                  .toLowerCase()
                  .includes(input.trim().toLowerCase())
              }
              onChange={(model: string) =>
                patch({
                  ...settings,
                  model: { ...settings.model, model: model === '' ? null : model },
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
                onChange={(value) => patch(patchModel(settings, { temperature: value ?? 0.3 }))}
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
                onChange={(value) => patch(patchModel(settings, { timeout_secs: value ?? 60 }))}
              />
            </div>
          </Space>
        </Space>
      </Card>

      <Card size="small" title="API Key">
        <SecretStatusPanel provider={settings.model.provider} />
      </Card>

      <Space>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saveState.saving}
          disabled={!saveState.dirty}
          onClick={saveState.save}
        >
          {t('settings.page.save')}
        </Button>
        <Button disabled={!saveState.dirty} onClick={saveState.discard}>
          {t('settings.page.discard')}
        </Button>
        {saveState.dirty && (
          <Typography.Text type="warning" style={{ fontSize: 12 }}>
            {t('settings.page.unsaved')}
          </Typography.Text>
        )}
      </Space>
    </Space>
  );
}

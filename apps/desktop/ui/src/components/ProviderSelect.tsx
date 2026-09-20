import { Input, Radio, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { ProviderInfo } from '../api/types';

/** 后端 `LlmProvider::Custom.as_str()`，选中它时接口地址必须用户填。 */
const CUSTOM_PROVIDER = 'custom';

/**
 * provider 稳定 id → 展示名（计划正文那条"控制器裁定"点名的泄漏面）。
 *
 * 原先这里直接渲染后端给的 `{provider.label_zh}`（`ProviderInfo.label_zh` ←
 * `LlmProvider::label_zh()`），英文 locale 下仍是中文——而组件扫描只查 CJK **字面量**，
 * 抓不到它。现在查 `settings.providers.<id>`，7 个 id 逐字取自
 * `crates/geo-llm/src/provider.rs` 的 `as_str()`。
 *
 * **查不到时回退 provider id 本身，绝不回退 `label_zh`**：回退它就等于把泄漏面原地留着，
 * 而且会让"词典漏了一个 id"变成静默的中文串而不是显眼的机器记号。
 * `nsSeparator: false` 与 `src/api/errors.ts` 的 `LOOKUP_OPTIONS` 同理——key 是从后端数据
 * 拼出来的，默认的 `:` 分隔符会把带冒号的 key 切成两半，`rendered !== key` 的 miss 判据当场失效。
 *
 * `ProviderInfo.label_zh` 字段本身**不删**（删它要连带改 demo 种子、`src/test/fixtures.ts`、
 * Task 11/14），Park 到 Plan B/C；但 UI 侧任何代码都不再读它。
 */
function providerLabel(t: TFunction, provider: string): string {
  const key = `settings.providers.${provider}`;
  const rendered = t(key, { nsSeparator: false });
  return typeof rendered === 'string' && rendered !== '' && rendered !== key ? rendered : provider;
}

export interface ProviderSelectProps {
  providers: ProviderInfo[];
  value: string;
  onChange: (provider: string) => void;
  /** 用户填写的接口地址覆盖值；预设服务商为空即用后端预设地址。 */
  baseUrl: string;
  onBaseUrlChange: (baseUrl: string) => void;
}

/**
 * 模型服务商选择。
 *
 * 预设服务商的 `base_url` 与默认模型都是**只读**的：地址写死在后端
 * `geo-llm::provider`，前端只展示，避免用户改出连不上的地址。
 * 选「自定义」时接口地址变成必填输入框（spec FR-L1），空值由后端
 * `config_from_settings` 拦下，文案经词典按当前语言渲染。
 */
export default function ProviderSelect({
  providers,
  value,
  onChange,
  baseUrl,
  onBaseUrlChange,
}: ProviderSelectProps) {
  const { t } = useTranslation();
  const current = providers.find((provider) => provider.provider === value) ?? null;
  const presetUrl = current?.base_url ?? '';
  const isCustom = value === CUSTOM_PROVIDER;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Radio.Group value={value} onChange={(event) => onChange(String(event.target.value))}>
        <Space direction="vertical" size={4}>
          {providers.map((provider) => (
            <Radio key={provider.provider} value={provider.provider}>
              {providerLabel(t, provider.provider)}
            </Radio>
          ))}
        </Space>
      </Radio.Group>

      {isCustom ? (
        <div>
          <label htmlFor="settings-base-url" style={{ marginRight: 8 }}>
            {t('settings.providerForm.baseUrl')}
          </label>
          <Input
            id="settings-base-url"
            style={{ maxWidth: 420 }}
            value={baseUrl}
            placeholder="https://api.example.com/v1"
            onChange={(event) => onBaseUrlChange(event.target.value)}
          />
          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {t('settings.providerForm.baseUrlHint')}
          </Typography.Text>
        </div>
      ) : (
        <Space size={8} wrap>
          <Typography.Text type="secondary">{t('settings.providerForm.baseUrlReadonly')}</Typography.Text>
          <Typography.Text>{presetUrl}</Typography.Text>
        </Space>
      )}

      <div>
        <label htmlFor="settings-default-model" style={{ marginRight: 8 }}>
          {t('settings.providerForm.defaultModel')}
        </label>
        <Input
          id="settings-default-model"
          style={{ maxWidth: 320 }}
          value={current?.default_model ?? ''}
          disabled
        />
        <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          {t('settings.providerForm.defaultModelHint')}
        </Typography.Text>
      </div>
    </Space>
  );
}

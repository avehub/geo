import { Input, Radio, Space, Typography } from 'antd';

import type { ProviderInfo } from '../api/types';

/** 后端 `LlmProvider::Custom.as_str()`，选中它时接口地址必须用户填。 */
const CUSTOM_PROVIDER = 'custom';

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
 * `config_from_settings` 拦下并给中文提示。
 */
export default function ProviderSelect({
  providers,
  value,
  onChange,
  baseUrl,
  onBaseUrlChange,
}: ProviderSelectProps) {
  const current = providers.find((provider) => provider.provider === value) ?? null;
  const presetUrl = current?.base_url ?? '';
  const isCustom = value === CUSTOM_PROVIDER;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Radio.Group value={value} onChange={(event) => onChange(String(event.target.value))}>
        <Space direction="vertical" size={4}>
          {providers.map((provider) => (
            <Radio key={provider.provider} value={provider.provider}>
              {provider.label_zh}
            </Radio>
          ))}
        </Space>
      </Radio.Group>

      {isCustom ? (
        <div>
          <label htmlFor="settings-base-url" style={{ marginRight: 8 }}>
            接口地址
          </label>
          <Input
            id="settings-base-url"
            style={{ maxWidth: 420 }}
            value={baseUrl}
            placeholder="https://api.example.com/v1"
            onChange={(event) => onBaseUrlChange(event.target.value)}
          />
          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            OpenAI 兼容服务，需以 http:// 或 https:// 开头；必填
          </Typography.Text>
        </div>
      ) : (
        <Space size={8} wrap>
          <Typography.Text type="secondary">接口地址：</Typography.Text>
          <Typography.Text>{presetUrl}</Typography.Text>
        </Space>
      )}

      <div>
        <label htmlFor="settings-default-model" style={{ marginRight: 8 }}>
          默认模型
        </label>
        <Input
          id="settings-default-model"
          style={{ maxWidth: 320 }}
          value={current?.default_model ?? ''}
          disabled
        />
        <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          想换模型在下方「模型名」里填，留空即用默认模型
        </Typography.Text>
      </div>
    </Space>
  );
}

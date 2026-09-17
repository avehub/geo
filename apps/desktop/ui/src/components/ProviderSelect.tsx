import { Input, Radio, Space, Typography } from 'antd';

import type { ProviderInfo } from '../api/types';

export interface ProviderSelectProps {
  providers: ProviderInfo[];
  value: string;
  onChange: (provider: string) => void;
}

/**
 * 模型服务商选择。`base_url` 与默认模型都是**只读**的：
 * 预设写死在后端 `geo-llm::provider`，前端只展示，避免用户改出连不上的地址。
 * 「自定义」的空 base_url 由后端在 `config_from_settings` 里拦下并给中文提示。
 */
export default function ProviderSelect({ providers, value, onChange }: ProviderSelectProps) {
  const current = providers.find((provider) => provider.provider === value) ?? null;
  const baseUrl = current?.base_url ?? '';

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

      <Space size={8} wrap>
        <Typography.Text type="secondary">接口地址：</Typography.Text>
        <Typography.Text>{baseUrl === '' ? '（自定义服务商，接口地址随设置一起保存）' : baseUrl}</Typography.Text>
      </Space>

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

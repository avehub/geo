import { Input, Select, Space } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ModelProtocol, ProviderInfo } from '../api/types';
import { MODEL_PROTOCOL_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import FormField from './ui/FormField';

/**
 * 后端 `LlmProvider::Custom.as_str()`，选中它时接口地址与**模型协议**都必须由用户给。
 *
 * 🔴 Plan B Task 4 起厂商清单一共 **12** 项：这 7 个 Rust 稳定 id 之外还有 5 家 demo 独有的
 * 中转站（`openrouter` / `siliconflow` / `302ai` / `yunwu` / `deepbricks`，DR-33）。
 * 本组件不区分两者——它只按 `providers` 数组渲染，"只有 custom 需要选协议"这条判据用的是
 * **稳定 id**而不是"第几项"，所以加厂商不会改变行为。
 */
const CUSTOM_PROVIDER = 'custom';

export interface ProviderSelectProps {
  providers: ProviderInfo[];
  value: string;
  onChange: (provider: string) => void;
  /**
   * 接口地址覆盖值：`null` = 尚未覆盖，输入框显示该服务商的官方默认地址；空串 = 用户主动清空。
   *
   * 2026-11-06 用户裁定：**所有服务商**的接口地址都改成可编辑输入框（不再只读展示预设值），
   * 预设值只是预填，用户可改成企业网关或代理。因此这里不能再用「空串即预设」的旧语义，
   * 否则用户清空输入框时会被受控值立刻填回默认地址。
   */
  baseUrl: string | null;
  onBaseUrlChange: (baseUrl: string) => void;
  /**
   * 模型协议（Plan B Task 4 · DR-34）。🔴 **只在 `custom` 下渲染控件**：
   * 预设厂商与中转站走哪种协议由后端固定，给它们一个能改的下拉等于允许用户改出
   * 一个连不上的配置（判据在 `ProviderSelect.test.tsx`：不出现，而不是置灰）。
   */
  protocol: ModelProtocol;
  onProtocolChange: (protocol: ModelProtocol) => void;
}

/**
 * 模型服务商选择（2026-11-06 飞书式重排）。
 *
 * 形态：单列「模型服务商下拉 → 模型协议（仅自定义）→ 接口地址输入框」。
 * 接口地址对**所有**服务商都是可编辑的，官方默认值由 `ProviderInfo.base_url` 预填；
 * `custom` 没有预设值，所以是空输入框 + 必填说明。默认模型不再单独占一个只读输入框，
 * 改由页面在「模型名」下方用一句说明展示（见 `pages/settings/ModelsSection.tsx`）。
 */
export default function ProviderSelect({
  providers,
  value,
  onChange,
  baseUrl,
  onBaseUrlChange,
  protocol,
  onProtocolChange,
}: ProviderSelectProps) {
  const { t } = useTranslation();
  /**
   * 🔴 按 `provider` 去重（先到先得）。
   *
   * 远程目录条目与内置「自定义」共用 `provider: 'custom'`（后端 `LlmProvider::parse`
   * 只认 7 个内置 id + custom），不去重会在下拉里出现两个 value 相同的选项：
   * 选中哪个都只会把 `custom` 传出去，`base_url` 填不上，用户看到的是"点了没反应"。
   * 去重后下拉仍是内置 7 项；远程中转站改由「远程内容与更新」段展示。
   */
  const optionsSource = providers.filter(
    (provider, index, all) => all.findIndex((item) => item.provider === provider.provider) === index,
  );
  const current = optionsSource.find((provider) => provider.provider === value) ?? null;
  const presetUrl = current?.base_url ?? '';
  const isCustom = value === CUSTOM_PROVIDER;
  const baseUrlValue = baseUrl ?? presetUrl;

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <FormField label={t('settings.providerForm.provider')} htmlFor="settings-provider">
        <Select
          id="settings-provider"
          style={{ width: '100%', maxWidth: 520 }}
          value={value}
          onChange={(provider: string) => onChange(provider)}
          options={optionsSource.map((provider) => ({
            value: provider.provider,
            label: enumLabel(t, 'settings.providers', provider.provider),
          }))}
          showSearch
          optionFilterProp="label"
          // 12 项在测试与真实下拉里都能一次渲染完，避免虚拟滚动把选项顺序断言变成抽奖。
          virtual={false}
        />
      </FormField>

      {isCustom ? (
        // 顺序照 spec §6：协议 → 接口地址（先说"按哪种协议说话"，再填"跟谁说"）。
        <FormField
          label={t('settings.providerForm.protocol')}
          htmlFor="settings-protocol"
          hint={t('settings.providerForm.protocolHint')}
        >
          <Select<ModelProtocol>
            id="settings-protocol"
            style={{ width: 200 }}
            value={protocol}
            options={MODEL_PROTOCOL_VALUES.map((item) => ({
              value: item,
              label: enumLabel(t, 'settings.protocols', item),
            }))}
            onChange={onProtocolChange}
          />
        </FormField>
      ) : null}

      <FormField
        label={t('settings.providerForm.baseUrl')}
        htmlFor="settings-base-url"
        hint={
          isCustom
            ? t('settings.providerForm.baseUrlCustomHint')
            : t('settings.providerForm.baseUrlHint')
        }
      >
        <Input
          id="settings-base-url"
          style={{ width: '100%', maxWidth: 520 }}
          value={baseUrlValue}
          placeholder={isCustom ? t('settings.providerForm.baseUrlPlaceholder') : undefined}
          onChange={(event) => onBaseUrlChange(event.target.value)}
        />
      </FormField>
    </Space>
  );
}

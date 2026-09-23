import { Input, Radio, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ProviderInfo } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

/** 后端 `LlmProvider::Custom.as_str()`，选中它时接口地址必须用户填。 */
const CUSTOM_PROVIDER = 'custom';

/**
 * provider 稳定 id → 展示名：走全仓**唯一**那份查表机制 `i18n/enum-label.ts` 的 `enumLabel`
 * （`settings.providers.<id>`，7 个 id 逐字取自 `crates/geo-llm/src/provider.rs` 的 `as_str()`）。
 *
 * 这里原先自带一份同形的本地 `providerLabel`，现已收掉：机制细节（为什么必须 `nsSeparator: false`、
 * 为什么查不到时**回退 id 本身而绝不回退 `label_zh`**）只写在 `enum-label.ts` 一处，
 * 「不许再长回第二份」的判据在 `ProviderSelect.test.tsx`（命中清单恰好是 enum-label + 一处已认领例外）。
 *
 * 为什么不能直接渲染后端给的 `ProviderInfo.label_zh`：那是后端产出的自然语言，英文 locale 下
 * 仍是中文，而组件扫描只查 CJK **字面量**、抓不到它。该字段本身**不删**（删它要连带改 demo 种子、
 * `src/test/fixtures.ts` 与多条命令的返回契约），Park 到 Plan B/C；但 UI 侧任何代码都不再读它。
 */

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
              {enumLabel(t, 'settings.providers', provider.provider)}
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
            // 占位提示也会上屏 ⇒ 走词典（值逐字搬过去、不改文案；判据在 no-hardcoded-strings.test.ts）
            placeholder={t('settings.providerForm.baseUrlPlaceholder')}
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

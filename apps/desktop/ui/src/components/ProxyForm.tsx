import { Input, Space, Switch, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ProxyConfig } from '../api/types';

export interface ProxyFormProps {
  value: ProxyConfig | null;
  onChange: (next: ProxyConfig | null) => void;
}

const PROTOCOLS = ['http://', 'https://', 'socks5://'];

/**
 * 代理设置。默认关闭（直连）；开启后必须给出带协议的地址，
 * 与后端 `validate_settings` 的口径一致，前端先拦一道省一次往返。
 */
export default function ProxyForm({ value, onChange }: ProxyFormProps) {
  const { t } = useTranslation();
  const enabled = value?.enabled ?? false;
  const url = value?.url ?? '';
  const invalid = enabled && url.trim() !== '' && !PROTOCOLS.some((prefix) => url.startsWith(prefix));

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Space size={8}>
        <Switch
          id="settings-proxy-enabled"
          checked={enabled}
          onChange={(checked) => onChange({ enabled: checked, url: checked ? url : null })}
        />
        <label htmlFor="settings-proxy-enabled">{t('settings.proxy.enable')}</label>
      </Space>

      {enabled && (
        <>
          <Input
            style={{ maxWidth: 420 }}
            value={url}
            status={invalid ? 'error' : undefined}
            // 占位提示也会上屏 ⇒ 走词典（#54，值逐字搬过去、不改文案；判据在
            // `i18n/no-hardcoded-strings.test.ts` 与 `components/ProxyForm.test.tsx`）。
            placeholder={t('settings.proxy.placeholder')}
            onChange={(event) => onChange({ enabled: true, url: event.target.value })}
          />
          <Typography.Text type={invalid ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
            {invalid ? t('settings.proxy.invalidUrl') : t('settings.proxy.hint')}
          </Typography.Text>
        </>
      )}
    </Space>
  );
}

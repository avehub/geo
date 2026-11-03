/**
 * 设置 · 通用段（Plan B Task 3 · spec §6 / DR-28 / DR-29 / DR-32 / DR-35）。
 *
 * 五张卡：外观 · 语言 · 权限与隐私 · 网络代理 · 通知。
 *
 * # 🔴 两类写入，两条路（DR-28 / DR-29）
 * - **外观与界面语言**写 `store/preferences.ts`（localStorage），**即时生效、不落库**：
 *   主题是首帧就要确定的事，等 `settings_get` 往返回来才切会闪一次白；
 * - **生成内容语言 / 隐私开关 / 代理 / 通知**写 `AppSettings` 草稿，本段是自动保存段
 *   （500ms 防抖后整包写库），所以段内**没有**保存按钮。
 *
 * # 🔴 权限三项在 demo 里恒为 `unsupported`
 * 数据来自新命令 `app_environment`（spec DR-35）。浏览器确实没有 macOS 的通知 /
 * 文件与文件夹 / 屏幕录制授权，所以「去系统设置」置灰并说明由桌面端提供——
 * 与 M7 对 docx/pdf/png 的既有形态同一口径，不演一个点了没反应的按钮。
 */
import { Alert, Button, Card, Descriptions, Divider, Select, Space, Switch, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as client from '../../api/client';
import { describeIpcError } from '../../api/errors';
import type { Permissions, PrivacyConfig } from '../../api/types';
import ProxyForm from '../../components/ProxyForm';
import { LOCALES, type Locale } from '../../i18n';
import { enumLabel } from '../../i18n/enum-label';
import type { TranslationKey } from '../../i18n/resources';
import { usePreferences } from '../../store/preferences';
import {
  FONT_SCALES,
  THEME_MODES,
  type FontScale,
  type ThemeMode,
} from '../../theme/appearance';
import type { SectionProps } from './sections';

/** 三项系统权限 → 词典键。键名来自 `Permissions` 契约，`Record` 保证一个都不漏。 */
const PERMISSION_ITEM_KEYS: Record<keyof Permissions, TranslationKey> = {
  notification: 'settings.permissionItems.notification',
  files_and_folders: 'settings.permissionItems.files_and_folders',
  screen_recording: 'settings.permissionItems.screen_recording',
};

/** 四项数据外发开关 → 词典键（`PrivacyConfig` 的键集，同上）。 */
const PRIVACY_ITEM_KEYS: Record<keyof PrivacyConfig, TranslationKey> = {
  share_entity_card: 'settings.permissionsCard.share_entity_card',
  share_prompts: 'settings.permissionsCard.share_prompts',
  share_crawled_text: 'settings.permissionsCard.share_crawled_text',
  share_diagnostics: 'settings.permissionsCard.share_diagnostics',
};

/**
 * 生成内容语言的可选值。
 *
 * ⚠ 与界面语言的 `LOCALES`（`zh-CN` / `en-US`，连字符）**刻意不同形**：这里写库的
 * `AppSettings.language` 是下划线形态（`zh_cn` / `en_us`），与 Rust `geo-domain::Language`
 * 同枚举。两者是两个字段、两个控件，不做联动（DR-32）。
 */
const CONTENT_LANGUAGES = ['zh_cn', 'en_us'] as const;

const CONTENT_LANGUAGE_KEYS: Record<(typeof CONTENT_LANGUAGES)[number], TranslationKey> = {
  zh_cn: 'settings.languageGroup.contentZhCn',
  en_us: 'settings.languageGroup.contentEnUs',
};

function patchPrivacy(settings: PrivacyConfigSource, patch: Partial<PrivacyConfig>): PrivacyConfigSource {
  return { ...settings, privacy: { ...settings.privacy, ...patch } };
}

/** 只为让 `patchPrivacy` 的入参类型短一点：本段拿到的整包设置。 */
type PrivacyConfigSource = SectionProps['settings'];

export default function GeneralSection({ settings, patch }: SectionProps) {
  const { t } = useTranslation();
  const locale = usePreferences((state) => state.locale);
  const setLocale = usePreferences((state) => state.setLocale);
  const themeMode = usePreferences((state) => state.theme);
  const setTheme = usePreferences((state) => state.setTheme);
  const fontScale = usePreferences((state) => state.fontScale);
  const setFontScale = usePreferences((state) => state.setFontScale);

  const environmentQuery = useQuery({
    queryKey: ['app-environment'],
    queryFn: () => client.appEnvironment(),
  });
  const permissions = environmentQuery.data?.permissions ?? null;
  const environmentError = environmentQuery.isError ? environmentQuery.error : null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
      <Card size="small" style={{ flex: '1 1 420px', minWidth: 320 }} title={t('settings.appearance.card')}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space size={24} wrap>
            <div>
              <label htmlFor="settings-theme" style={{ marginRight: 8 }}>
                {t('settings.appearance.theme')}
              </label>
              <Select<ThemeMode>
                id="settings-theme"
                style={{ width: 160 }}
                value={themeMode}
                options={THEME_MODES.map((mode) => ({
                  value: mode,
                  label: enumLabel(t, 'settings.themes', mode),
                }))}
                onChange={setTheme}
              />
            </div>
            <div>
              <label htmlFor="settings-font-scale" style={{ marginRight: 8 }}>
                {t('settings.appearance.fontScale')}
              </label>
              <Select<FontScale>
                id="settings-font-scale"
                style={{ width: 160 }}
                value={fontScale}
                options={FONT_SCALES.map((scale) => ({
                  value: scale,
                  label: enumLabel(t, 'settings.fontScales', scale),
                }))}
                onChange={setFontScale}
              />
            </div>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('settings.appearance.hint')}
          </Typography.Text>
        </Space>
      </Card>

      <Card size="small" style={{ flex: '1 1 420px', minWidth: 320 }} title={t('settings.languageGroup.card')}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <label htmlFor="settings-ui-language" style={{ marginRight: 8 }}>
              {t('settings.languageGroup.ui')}
            </label>
            <Select<Locale>
              id="settings-ui-language"
              style={{ width: 200 }}
              value={locale}
              options={LOCALES.map((value) => ({
                value,
                label: enumLabel(t, 'common.languages', value),
              }))}
              onChange={setLocale}
            />
            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              {t('settings.languageGroup.uiHint')}
            </Typography.Text>
          </div>
          <div>
            <label htmlFor="settings-content-language" style={{ marginRight: 8 }}>
              {t('settings.languageGroup.content')}
            </label>
            <Select
              id="settings-content-language"
              style={{ width: 200 }}
              value={settings.language}
              options={CONTENT_LANGUAGES.map((value) => ({
                value,
                label: t(CONTENT_LANGUAGE_KEYS[value]),
              }))}
              onChange={(language: string) => patch({ ...settings, language })}
            />
            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              {t('settings.languageGroup.contentHint')}
            </Typography.Text>
          </div>
        </Space>
      </Card>

      <Card size="small" style={{ flex: '1 1 420px', minWidth: 320 }} title={t('settings.permissionsCard.title')}>
        <Typography.Text strong>{t('settings.permissionsCard.systemTitle')}</Typography.Text>
        {environmentError !== null ? (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 8 }}
            message={t('settings.page.environmentFailed')}
            description={describeIpcError(environmentError, t)}
          />
        ) : (
          <Descriptions
            size="small"
            column={1}
            style={{ marginTop: 8 }}
            items={(Object.keys(PERMISSION_ITEM_KEYS) as (keyof Permissions)[]).map((item) => ({
              key: item,
              label: t(PERMISSION_ITEM_KEYS[item]),
              children:
                permissions === null ? (
                  <Typography.Text type="secondary">{t('common.loading')}</Typography.Text>
                ) : (
                  <Tag>{enumLabel(t, 'settings.permissions', permissions[item])}</Tag>
                ),
            }))}
          />
        )}
        <Space size={8} style={{ marginTop: 8 }}>
          {/* 🔴 置灰而不是隐藏：走查的人要能看到"这个能力存在，只是演示模式给不了"。 */}
          <Button size="small" disabled>
            {t('settings.permissionsCard.openSystemSettings')}
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('settings.permissionsCard.desktopOnly')}
          </Typography.Text>
        </Space>

        <Divider style={{ margin: '16px 0' }} />

        <Typography.Text strong>{t('settings.permissionsCard.privacyTitle')}</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
          {t('settings.permissionsCard.privacyHint')}
        </Typography.Paragraph>
        <Space direction="vertical" size={8}>
          {(Object.keys(PRIVACY_ITEM_KEYS) as (keyof PrivacyConfig)[]).map((item) => (
            <Space size={8} key={item}>
              <Switch
                id={`settings-privacy-${item}`}
                checked={settings.privacy[item]}
                onChange={(checked) => patch(patchPrivacy(settings, { [item]: checked }))}
              />
              <label htmlFor={`settings-privacy-${item}`}>
                {t(PRIVACY_ITEM_KEYS[item])}
              </label>
            </Space>
          ))}
        </Space>
      </Card>

      <Card size="small" style={{ flex: '1 1 420px', minWidth: 320 }} title={t('settings.page.proxyCard')}>
        <ProxyForm value={settings.proxy} onChange={(proxy) => patch({ ...settings, proxy })} />
      </Card>

      <Card size="small" style={{ flex: '1 1 420px', minWidth: 320 }} title={t('settings.page.notifyCard')}>
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
              onChange={(sound) => patch({ ...settings, notify: { ...settings.notify, sound } })}
            />
            <label htmlFor="settings-notify-sound">{t('settings.page.notifySound')}</label>
          </Space>
        </Space>
      </Card>
    </div>
  );
}

/**
 * 设置 · 关于段（Plan B Task 5 · spec §6 / DR-35 / 裁定 4）。
 *
 * 版本与构建号来自 `app_environment`（与 `GeneralSection` / `StorageSection` 共用同一个
 * queryKey，一次会话只发一次）。demo 的 `build_number` 恒为 `'web-demo'`——它诚实标出
 * 运行形态，而不是编一个 CI 构建号。
 *
 * # 🔴 这里**不放**「扩展」（裁定 4）
 * skill 安装与导入、客服机器人整体推到二期。连置灰占位都不留：留一个点不动的入口，
 * 比不出现更容易被走查的人当成缺陷（spec §2）。判据在 `AboutSection.test.tsx`
 * ——中英两侧各扫一遍，出现「扩展 / skill / 客服机器人」任何一个就红。
 */
import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Modal, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { check } from '@tauri-apps/plugin-updater';
import { useTranslation } from 'react-i18next';

import * as client from '../../api/client';
import { runtime } from '../../api/runtime';
import { describeIpcError } from '../../api/errors';
import type { SectionProps } from './sections';

export default function AboutSection(_props: SectionProps) {
  const { t, i18n } = useTranslation();
  const environmentQuery = useQuery({
    queryKey: ['app-environment'],
    queryFn: () => client.appEnvironment(),
  });
  const environment = environmentQuery.data ?? null;
  const environmentError = environmentQuery.isError ? environmentQuery.error : null;

  /**
   * 远程内容的版本事实。
   *
   * 🔴 与设置段共用 `['remote-status']` 这一个 queryKey：一次会话里两处看到的是
   * 同一份事实，不会出现"设置段说内置、关于页说远程"。
   */
  const remoteQuery = useQuery({
    queryKey: ['remote-status'],
    queryFn: () => client.remoteStatus(),
  });
  const legalQuery = useQuery({
    queryKey: ['remote-legal-index'],
    queryFn: () => client.remoteLegalIndex(),
  });
  const remote = remoteQuery.data ?? null;
  const legal = legalQuery.data ?? null;

  /** 「打开隐私政策」：正文现取，取不到就如实说取不到（不显示旧文本）。 */
  const [policy, setPolicy] = useState<{ title: string; text: string } | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);

  /**
   * 「检查更新」（DR-R8 / 0.2）。
   *
   * 🔴 失败**只提示、不阻塞**：断网、更新端点不可达、签名配置缺失都只落成一行
   *    warning，页面其余内容照常可用 —— 更新检查是便利功能，不是启动前置条件。
   * 🔴 不在前台轮询：只有用户点这个按钮才发一次请求（隐私政策 §6 的口径）。
   */
  type UpdateCheck =
    | { status: 'idle' }
    | { status: 'available'; version: string; notes: string | null }
    | { status: 'none' }
    | { status: 'error'; message: string };
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck>({ status: 'idle' });
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  async function onCheckUpdate() {
    setCheckingUpdate(true);
    try {
      const update = await check();
      if (update === null) {
        setUpdateCheck({ status: 'none' });
      } else {
        setUpdateCheck({
          status: 'available',
          version: update.version,
          notes: update.body?.trim() ? update.body : null,
        });
      }
    } catch (error) {
      setUpdateCheck({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCheckingUpdate(false);
    }
  }
  const locale = i18n.language === 'en-US' ? 'en-US' : 'zh-CN';

  async function openPolicy() {
    setPolicyError(null);
    try {
      const doc = await client.remoteLegalGet('privacy_policy', locale);
      if (doc.text === null) {
        setPolicyError(t('settings.aboutExtra.unavailable'));
        return;
      }
      setPolicy({ title: doc.title ?? t('settings.aboutExtra.openPrivacy'), text: doc.text });
    } catch (error) {
      setPolicyError(describeIpcError(error, t));
    }
  }

  const privacyDoc = (legal?.value as { docs?: Record<string, Record<string, { version?: number; title?: string }>> } | null)
    ?.docs?.privacy_policy?.[locale];
  const rulepackVersion =
    remote?.items.find((item) => item.key === 'rulepacks')?.version ??
    remote?.builtin_versions.find((item) => item.key === 'rulepacks')?.version;
  const lastSyncAt = remote?.last_sync?.started_at ?? null;

  return (
    <Card
      size="small"
      title={t('settings.sections.about')}
      loading={environment === null && environmentError === null}
    >
      {environmentError !== null ? (
        <Alert
          type="error"
          showIcon
          message={t('settings.page.environmentFailed')}
          description={describeIpcError(environmentError, t)}
        />
      ) : null}
      {environment !== null && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {t('common.appName')}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('common.tagline')}
          </Typography.Text>

          <Descriptions
            size="small"
            column={1}
            items={[
              {
                key: 'version',
                label: t('settings.about.version'),
                children: environment.app_version,
              },
              {
                key: 'build',
                label: t('settings.about.build'),
                children: environment.build_number,
              },
              {
                key: 'rulepack',
                label: t('settings.aboutExtra.rulepack'),
                children: rulepackVersion === undefined ? t('settings.remote.unknown') : rulepackVersion,
              },
              {
                key: 'legal',
                label: t('settings.aboutExtra.legal'),
                children: privacyDoc?.version === undefined ? t('settings.remote.unknown') : privacyDoc.version,
              },
              {
                key: 'lastSync',
                label: t('settings.aboutExtra.lastSync'),
                children: lastSyncAt ?? t('settings.remote.never'),
              },
              {
                key: 'licenses',
                label: t('settings.about.licenses'),
                children: (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('settings.about.licensesValue')}
                  </Typography.Text>
                ),
              },
            ]}
          />

          <Space direction="vertical" size={4}>
            <Space wrap>
              <Button onClick={() => void openPolicy()}>{t('settings.aboutExtra.openPrivacy')}</Button>
              {runtime === 'tauri' && (
                <Button loading={checkingUpdate} onClick={() => void onCheckUpdate()}>
                  {checkingUpdate
                    ? t('settings.aboutExtra.checkingUpdate')
                    : t('settings.aboutExtra.checkUpdate')}
                </Button>
              )}
            </Space>
            {updateCheck.status === 'available' && (
              <Space direction="vertical" size={2}>
                <Typography.Text style={{ fontSize: 12 }}>
                  {t('settings.aboutExtra.updateAvailable', { version: updateCheck.version })}
                </Typography.Text>
                {updateCheck.notes !== null && (
                  <Typography.Paragraph
                    type="secondary"
                    style={{ fontSize: 12, marginBottom: 0, whiteSpace: 'pre-wrap' }}
                  >
                    {updateCheck.notes}
                  </Typography.Paragraph>
                )}
              </Space>
            )}
            {updateCheck.status === 'none' && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('settings.aboutExtra.upToDate')}
              </Typography.Text>
            )}
            {updateCheck.status === 'error' && (
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                {t('settings.aboutExtra.updateCheckFailed', { message: updateCheck.message })}
              </Typography.Text>
            )}
            {policyError !== null && (
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                {policyError}
              </Typography.Text>
            )}
          </Space>

          <Modal
            open={policy !== null}
            title={policy?.title}
            footer={null}
            onCancel={() => setPolicy(null)}
            width={720}
          >
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 480, overflow: 'auto' }}>
              {policy?.text}
            </Typography.Paragraph>
          </Modal>

        </Space>
      )}
    </Card>
  );
}

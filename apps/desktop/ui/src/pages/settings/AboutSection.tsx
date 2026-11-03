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
import { Alert, Card, Descriptions, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as client from '../../api/client';
import { describeIpcError } from '../../api/errors';
import type { SectionProps } from './sections';

export default function AboutSection(_props: SectionProps) {
  const { t } = useTranslation();
  const environmentQuery = useQuery({
    queryKey: ['app-environment'],
    queryFn: () => client.appEnvironment(),
  });
  const environment = environmentQuery.data ?? null;
  const environmentError = environmentQuery.isError ? environmentQuery.error : null;

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

          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            {t('settings.about.phase2')}
          </Typography.Paragraph>
        </Space>
      )}
    </Card>
  );
}

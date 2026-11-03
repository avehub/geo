/**
 * 设置 · 数据与存储段（Plan B Task 5 · spec §6 / DR-35）。
 *
 * 六行本机事实（数据目录 / 库文件 / 库大小 / 截图目录 / 日志目录 / 导出目录）+ 迁移数，
 * 全部来自 `app_environment`（DR-35：一次给全，不拆成 `storage_info` / `permission_status`）。
 *
 * # 🔴 这一段是**只读**的，两个动作按钮置灰
 * 「打开目录」「更改目录」在浏览器里做不到（打不开访达、也弹不出系统目录选择器），
 * 所以照 M7 对 docx/pdf/png 的既有口径处理：**照旧渲染但置灰 + 一句说明**，
 * 不演一个点了没反应的按钮。Plan C 再加 `storage_open_dir` / `storage_change_dir`
 * 两条命令（spec DR-35 的裁定理由）。
 *
 * # 🔴 这些路径在 demo 里并不存在
 * `demo/handlers/app-environment.ts` 端的是一组形状正确的静态值（AGENTS 规则 9：
 * demo 不碰文件系统）。所以段首常驻一句"演示模式不读写磁盘"——少了它，
 * 走查的人会以为那是自己机器上的真实占用。
 *
 * # 库大小走 `bytesText`
 * 裸字节数（`3481600`）在设置页里既读不出量级，也会被当成某个 id。
 */
import { Alert, Button, Card, Descriptions, Space, Typography } from 'antd';
import { FolderOpenOutlined, SwapOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as client from '../../api/client';
import { describeIpcError } from '../../api/errors';
import { bytesText } from '../../components/format';
import type { SectionProps } from './sections';

export default function StorageSection(_props: SectionProps) {
  const { t } = useTranslation();
  const environmentQuery = useQuery({
    // 与 `GeneralSection` 共用同一个 queryKey：同一次会话里只发一次 `app_environment`。
    queryKey: ['app-environment'],
    queryFn: () => client.appEnvironment(),
  });
  const storage = environmentQuery.data?.storage ?? null;
  const environmentError = environmentQuery.isError ? environmentQuery.error : null;

  return (
    <Card
      size="small"
      title={t('settings.sections.storage')}
      loading={storage === null && environmentError === null}
    >
      {environmentError !== null ? (
        <Alert
          type="error"
          showIcon
          message={t('settings.page.environmentFailed')}
          description={describeIpcError(environmentError, t)}
        />
      ) : null}
      {storage !== null && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            {t('settings.storage.hint')}
          </Typography.Paragraph>

          <Descriptions
            size="small"
            column={1}
            items={[
              {
                key: 'data_dir',
                label: t('settings.storage.dataDir'),
                children: <Typography.Text copyable={{ text: storage.data_dir }}>{storage.data_dir}</Typography.Text>,
              },
              {
                key: 'db_path',
                label: t('settings.storage.dbPath'),
                children: <Typography.Text copyable={{ text: storage.db_path }}>{storage.db_path}</Typography.Text>,
              },
              {
                key: 'db_size',
                label: t('settings.storage.dbSize'),
                children: bytesText(storage.db_size_bytes),
              },
              {
                key: 'screenshots_dir',
                label: t('settings.storage.screenshotsDir'),
                children: storage.screenshots_dir,
              },
              {
                key: 'log_dir',
                label: t('settings.storage.logDir'),
                children: storage.log_dir,
              },
              {
                key: 'export_dir',
                label: t('settings.storage.exportDir'),
                children:
                  storage.export_dir === null ? (
                    <Typography.Text type="secondary">{t('settings.storage.exportDirNone')}</Typography.Text>
                  ) : (
                    storage.export_dir
                  ),
              },
              {
                key: 'migrations',
                label: t('settings.storage.migrations'),
                children: String(storage.migrations_applied),
              },
            ]}
          />

          <Space size={8} wrap>
            {/* 🔴 置灰而不是隐藏：走查的人要能看到"这个能力存在，只是演示模式给不了"。 */}
            <Button size="small" icon={<FolderOpenOutlined />} disabled>
              {t('settings.storage.openDir')}
            </Button>
            <Button size="small" icon={<SwapOutlined />} disabled>
              {t('settings.storage.changeDir')}
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('settings.storage.desktopOnly')}
            </Typography.Text>
          </Space>
        </Space>
      )}
    </Card>
  );
}

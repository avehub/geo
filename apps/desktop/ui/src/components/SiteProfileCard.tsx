import { Alert, Button, Card, Collapse, Form, Input, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import type { SiteOwnership, SitePage, SitePlatform, SiteProfile } from '../api/types';
import { SITE_OWNERSHIP_VALUES, SITE_PLATFORM_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { dateTimeText } from './format';

/** 档案表单的值形状：页面层把它转成 `site_profile_save` 的三个入参。 */
export interface SiteProfileFormValues {
  platform: SitePlatform;
  ownership: SiteOwnership;
  note: string | null;
}

export interface SiteProfileCardProps {
  /** `null` = 这个项目还没建档（站点页是导航直达的落点，这是正常状态而不是错误，DR-51）。 */
  profile: SiteProfile | null;
  pages: SitePage[];
  /** 项目里的官网地址。🔴 域名**只读**：它逐字来自 `Project.website`，不在两处各存一份。 */
  website: string | null;
  saving: boolean;
  onSave: (values: SiteProfileFormValues) => void;
}

/**
 * 站点接入页第 1 块：**站点档案 + 受管页面清单**（spec DR-49 / DR-54）。
 *
 * # 为什么档案只有三个可填项
 * 「引入站点」的最小闭环是**说清这个站长什么样、谁能改它**：建站形态决定哪几条通道可行
 * （`saas_builder` 基本没有公开写 API ⇒ 只剩落地包），谁在管决定要不要走交接单
 * （`no_access` / `agency` 是国内中小企业的常态）。域名不提供编辑入口——它是 `Project.website`
 * 的镜像，两处各存一份必然漂移。
 *
 * # 🔴 页面清单是只读的（DR-56③）
 * `SitePage[]` 在 demo 里是**静态预置**（真后端由爬虫发现，AGENTS 规则 9）。它的作用只有一个：
 * 给补丁的 `target_url` 一份**可选清单**，不用手打网址（`SitePatchEditorModal` 的那个下拉）。
 * 所以这里既没有"新增页面"也没有"删除页面"——加一个按钮就等于承诺 demo 能改一份它改不了的数据。
 *
 * # 🔴 `Form` 的 `key` 是刻意加的
 * `initialValues` 只在挂载时生效，而档案是**异步**到的（`null` → 对象）。不 remount 就会看到
 * 三个空下拉。用 `profile?.id ?? 'none'` 当 key：建档成功后 remount 一次填上真值，
 * 之后再保存 `id` 不变 ⇒ 不会把用户正在改的表单冲掉。
 *
 * # 🔴 因此**绝不能**把外部 `Form.useForm()` 的实例传进来
 * rc-field-form 的 store 活在那个 hook 里、**不随 `<Form>` 的 remount 重建**：
 * remount 时 `setInitialValues(values, true)` 走的是 `setValues({}, initialValues, store)`
 * ——**旧 store 压在新 initialValues 之上**。首屏档案还没到，store 里已经写进了
 * `platform: 'unknown'`；等真档案到了、`key` 变了、`<Form>` 重挂了，
 * 三个下拉仍然是「尚未确认」，上面那个 remount 技巧等于白做。
 * 不传 `form` 让每次挂载各自建 store，`key` 才有意义（本组件也不需要命令式操作表单）。
 */
export default function SiteProfileCard({
  profile,
  pages,
  website,
  saving,
  onSave,
}: SiteProfileCardProps) {
  const { t } = useTranslation();

  const domain = profile?.domain ?? website ?? '';
  const pageColumns: ColumnsType<SitePage> = [
    {
      title: t('site.pages.url'),
      dataIndex: 'url',
      render: (_, row) => (
        <Typography.Text
          style={{ fontSize: 12, maxWidth: '100%' }}
          ellipsis={{ tooltip: row.url }}
          copyable={{ text: row.url }}
        >
          {row.url}
        </Typography.Text>
      ),
    },
    {
      title: t('site.pages.role'),
      dataIndex: 'role',
      width: 116,
      render: (_, row) => <Tag>{enumLabel(t, 'site.pages.roles', row.role)}</Tag>,
    },
    {
      title: t('site.pages.pageTitle'),
      dataIndex: 'title',
      width: 160,
      render: (_, row) =>
        row.title === null ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text style={{ fontSize: 12 }}>{row.title}</Typography.Text>
        ),
    },
    {
      title: t('site.pages.lastChecked'),
      dataIndex: 'last_checked_at',
      width: 148,
      render: (_, row) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {row.last_checked_at === null ? t('site.pages.never') : dateTimeText(row.last_checked_at)}
        </Typography.Text>
      ),
    },
    {
      title: t('site.pages.crawlable'),
      dataIndex: 'crawlable',
      width: 108,
      render: (_, row) =>
        row.crawlable ? (
          <Tag color="success">{t('site.pages.crawlableYes')}</Tag>
        ) : (
          <Tag color="error">{t('site.pages.crawlableNo')}</Tag>
        ),
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Tooltip title={t('site.profile.hint')}>
          <span>{t('site.profile.title')}</span>
        </Tooltip>
      }
      style={{ marginBottom: 12 }}
    >

      {domain === '' ? (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('site.profile.domainMissing')} />
      ) : null}
      {profile === null ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('site.profile.empty')} />
      ) : null}

      <Form<SiteProfileFormValues>
        key={profile?.id ?? 'none'}
        layout="vertical"
        initialValues={{
          platform: profile?.platform ?? 'unknown',
          ownership: profile?.ownership ?? 'unknown',
          note: profile?.note ?? null,
        }}
        onFinish={(values) =>
          onSave({
            platform: values.platform,
            ownership: values.ownership,
            note: values.note === null ? null : values.note.trim() || null,
          })
        }
      >
        <Space size={12} align="start" wrap style={{ width: '100%' }}>
          <Form.Item label={t('site.profile.domain')} style={{ marginBottom: 12, minWidth: 260 }}>
            <Typography.Text copyable={domain === '' ? false : { text: domain }}>
              {domain === '' ? '—' : domain}
            </Typography.Text>
          </Form.Item>
          <Form.Item name="platform" label={t('site.profile.platform')} style={{ marginBottom: 12, minWidth: 220 }}>
            <Select
              options={SITE_PLATFORM_VALUES.map((value) => ({
                value,
                label: enumLabel(t, 'site.platforms', value),
              }))}
            />
          </Form.Item>
          <Form.Item name="ownership" label={t('site.profile.ownership')} style={{ marginBottom: 12, minWidth: 240 }}>
            <Select
              options={SITE_OWNERSHIP_VALUES.map((value) => ({
                value,
                label: enumLabel(t, 'site.ownerships', value),
              }))}
            />
          </Form.Item>
        </Space>
        <Form.Item name="note" label={t('site.profile.note')} style={{ marginBottom: 12 }}>
          <Input.TextArea rows={2} placeholder={t('site.profile.notePlaceholder')} />
        </Form.Item>
        <Space size={8}>
          <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving}>
            {t('site.profile.save')}
          </Button>
          {profile === null ? null : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {`${t('site.profile.updated')}: ${dateTimeText(profile.updated_at)}`}
            </Typography.Text>
          )}
        </Space>
      </Form>

      <Card
        size="small"
        type="inner"
        title={t('site.pages.title')}
        style={{ marginTop: 12 }}
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('site.pages.hint')}
          </Typography.Text>
        }
      >
        <Collapse
          ghost
          items={[
            {
              key: 'pages',
              label: t('site.pages.expand'),
              forceRender: true,
              children: (
                <Table<SitePage>
                  size="small"
                  rowKey="id"
                  tableLayout="fixed"
                  columns={pageColumns}
                  dataSource={pages}
                  pagination={false}
                  locale={{ emptyText: t('site.pages.empty') }}
                />
              ),
            },
          ]}
        />
      </Card>
    </Card>
  );
}

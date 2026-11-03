import { useState } from 'react';
import {
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as action from '../api/action';
import * as client from '../api/client';
import {
  composeContent,
  contentFileName,
  CONTENT_EXPORTABLE_FORMATS,
  type ContentExportKind,
} from '../api/content-compose';
import { describeIpcError } from '../api/errors';
import type {
  ActionItem,
  ContentStatus,
  ContentTemplate,
  ExportFormat,
  GeneratedContent,
} from '../api/types';
import { dateTimeText } from './format';
import { enumLabel } from '../i18n/enum-label';

/** 审核态配色：待审橙、通过绿、退回红。 */
const STATUS_COLORS: Record<ContentStatus, string> = {
  pending_review: 'orange',
  approved: 'green',
  rejected: 'red',
};

/**
 * M6 内容生产区块：模板目录 + 已生成文稿（预览 / 人工审核 / 导出）。
 *
 * # 🔴 生成内容默认待人工审核（AGENTS 规则 6）
 * `pending_review` 是新生成文稿的默认态，界面上挂着 `action.contents.pendingNote`；
 * 通过之后才谈得上对外发布。`compliance_checked` 只表示"跑过红线词扫描"，
 * demo 新生成的那一份是 `false` ⇒ 显示 `action.contents.complianceUnchecked`，不假声明。
 *
 * # 导出只产 Markdown 与"预格式 HTML"
 * 判据与理由在 `api/content-compose.ts`：demo 不引 Markdown 解析器，走查的是导出通路。
 * 其余格式置灰，并**逐条**说明"由桌面端提供"（`action.export.desktopOnly`）。
 *
 * 正文用 `<pre>` 原样显示：文稿是数据，不解析成 HTML（也就没有注入口）。
 */
export default function ContentPanel({
  contents,
  templates,
  actions,
  onGenerateFromTemplate,
}: {
  contents: GeneratedContent[];
  templates: ContentTemplate[];
  actions: ActionItem[];
  onGenerateFromTemplate: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [preview, setPreview] = useState<GeneratedContent | null>(null);

  const reviewMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ContentStatus }) =>
      action.contentUpdateStatus(id, status),
    onSuccess: (content) => {
      message.success(t('action.contents.statusOk'));
      void queryClient.invalidateQueries({ queryKey: ['action-board'] });
      // 抽屉里开着的就是这一份：就地替换，免得"点了通过、抽屉还显示待审"。
      setPreview((current) => (current?.id === content.id ? content : current));
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const actionTitleOf = (actionId: string | null) =>
    actionId === null
      ? t('action.contents.noAction')
      : (actions.find((item) => item.id === actionId)?.title ?? actionId);

  const templateKindOf = (templateId: string) =>
    enumLabel(
      t,
      'action.templates.kinds',
      templates.find((template) => template.id === templateId)?.kind ?? templateId,
    );

  async function exportContent(content: GeneratedContent, kind: ContentExportKind) {
    try {
      // withBom 只对 CSV 有意义（Excel 认中文靠它）；md / html 自带 charset 声明。
      const path = await client.exportWriteFile(
        contentFileName(content, kind),
        composeContent(content, kind),
        false,
      );
      if (path === null) {
        message.info(t('action.export.cancelled'));
        return;
      }
      message.success(t('action.export.done', { path }));
    } catch (error) {
      message.error(describeIpcError(error, t));
    }
  }

  /** 一份文稿的导出按钮组：能产出的亮着，其余置灰并在下面逐条说明。 */
  function exportButtons(content: GeneratedContent) {
    // 规则 6：待审 / 已退回的 AI 文稿不能被当成交付物导出（与 KB / FAQ / 文章 / 站点同一道闸门）。
    const exportable = content.status === 'approved';
    const unavailable = content.export_formats.filter(
      (format) => !(CONTENT_EXPORTABLE_FORMATS as readonly ExportFormat[]).includes(format),
    );
    return (
      <Space direction="vertical" size={4}>
        <Space size={4} wrap>
          {content.export_formats.map((format) => {
            const kind = format as ContentExportKind;
            const enabled =
              exportable &&
              (CONTENT_EXPORTABLE_FORMATS as readonly ExportFormat[]).includes(format);
            return (
              <Button
                key={format}
                size="small"
                disabled={!enabled}
                onClick={() => void exportContent(content, kind)}
              >
                {enumLabel(t, 'common.exportFormats', format)}
              </Button>
            );
          })}
        </Space>
        {exportable ? null : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('action.export.onlyApproved')}
          </Typography.Text>
        )}
        {unavailable.map((format) => (
          <Typography.Text key={format} type="secondary" style={{ fontSize: 12 }}>
            {t('action.export.desktopOnly', {
              format: enumLabel(t, 'common.exportFormats', format),
            })}
          </Typography.Text>
        ))}
      </Space>
    );
  }

  return (
    <>
      <Card
        size="small"
        title={t('action.templates.title')}
        style={{ marginBottom: 12 }}
        extra={
          <Button size="small" icon={<PlusOutlined />} onClick={onGenerateFromTemplate}>
            {t('action.templates.generate')}
          </Button>
        }
      >
        <Table<ContentTemplate>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={templates}
          locale={{ emptyText: t('action.templates.empty') }}
          columns={[
            {
              title: t('action.templates.kind'),
              dataIndex: 'kind',
              render: (value: string) => enumLabel(t, 'action.templates.kinds', value),
            },
            {
              title: t('action.templates.sections'),
              dataIndex: 'section_keys',
              render: (keys: string[]) => (
                <Space size={4} wrap>
                  {keys.map((key) => (
                    <Tag key={key}>{enumLabel(t, 'action.templateSections', key)}</Tag>
                  ))}
                </Space>
              ),
            },
            {
              title: t('action.templates.formats'),
              dataIndex: 'export_formats',
              render: (formats: ExportFormat[]) => (
                <Space size={4} wrap>
                  {formats.map((format) => (
                    <Tag key={format}>{enumLabel(t, 'common.exportFormats', format)}</Tag>
                  ))}
                </Space>
              ),
            },
            {
              title: t('action.templates.targets'),
              dataIndex: 'target_categories',
              render: (categories: string[]) => (
                <Space size={4} wrap>
                  {categories.map((category) => (
                    <Tag key={category} color="blue">
                      {enumLabel(t, 'action.categories', category)}
                    </Tag>
                  ))}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card size="small" title={t('action.contents.title')} style={{ marginBottom: 12 }}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('action.contents.pendingNote')}
        </Typography.Paragraph>
        <Table<GeneratedContent>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={contents}
          locale={{ emptyText: t('action.contents.empty') }}
          columns={[
            { title: t('action.contents.contentTitle'), dataIndex: 'title', ellipsis: true },
            {
              title: t('action.contents.template'),
              dataIndex: 'template_id',
              render: (value: string) => templateKindOf(value),
            },
            {
              title: t('action.contents.action'),
              dataIndex: 'action_id',
              ellipsis: true,
              render: (value: string | null) => actionTitleOf(value),
            },
            {
              title: t('action.contents.status'),
              dataIndex: 'status',
              render: (value: ContentStatus, row) => (
                <Space direction="vertical" size={0}>
                  <Tag color={STATUS_COLORS[value]}>
                    {enumLabel(t, 'action.contentStatuses', value)}
                  </Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {row.compliance_checked
                      ? t('action.contents.complianceChecked')
                      : t('action.contents.complianceUnchecked')}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: t('action.contents.createdAt'),
              dataIndex: 'created_at',
              render: (value: string) => dateTimeText(value),
            },
            {
              title: t('common.actions'),
              key: 'actions',
              render: (_, row) => (
                <Space size={4} wrap>
                  <Button size="small" type="link" onClick={() => setPreview(row)}>
                    {t('action.contents.preview')}
                  </Button>
                  {row.status !== 'approved' && (
                    <Button
                      size="small"
                      type="link"
                      onClick={() => reviewMutation.mutate({ id: row.id, status: 'approved' })}
                    >
                      {t('action.contents.approve')}
                    </Button>
                  )}
                  {row.status !== 'rejected' && (
                    <Button
                      size="small"
                      type="link"
                      onClick={() => reviewMutation.mutate({ id: row.id, status: 'rejected' })}
                    >
                      {t('action.contents.reject')}
                    </Button>
                  )}
                  {row.status !== 'pending_review' && (
                    <Button
                      size="small"
                      type="link"
                      onClick={() =>
                        reviewMutation.mutate({ id: row.id, status: 'pending_review' })
                      }
                    >
                      {t('action.contents.reopen')}
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        open={preview !== null}
        width={720}
        title={preview?.title ?? ''}
        onClose={() => setPreview(null)}
        extra={preview === null ? null : exportButtons(preview)}
      >
        {preview !== null && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Descriptions size="small" column={2}>
              <Descriptions.Item label={t('action.contents.template')}>
                {templateKindOf(preview.template_id)}
              </Descriptions.Item>
              <Descriptions.Item label={t('action.contents.status')}>
                <Tag color={STATUS_COLORS[preview.status]}>
                  {enumLabel(t, 'action.contentStatuses', preview.status)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('action.contents.action')}>
                {actionTitleOf(preview.action_id)}
              </Descriptions.Item>
              <Descriptions.Item label={t('action.contents.updatedAt')}>
                {dateTimeText(preview.updated_at)}
              </Descriptions.Item>
            </Descriptions>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {preview.compliance_checked
                ? t('action.contents.complianceChecked')
                : t('action.contents.complianceUnchecked')}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('action.contents.demoBody')}
            </Typography.Text>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: '#fafafa',
                padding: 12,
                margin: 0,
                fontSize: 12,
              }}
            >
              {preview.body_markdown}
            </pre>
          </Space>
        )}
      </Drawer>
    </>
  );
}

import { AutoComplete, Form, Input, Modal, Select, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type {
  ContentStatus,
  SiteChannelKind,
  SitePatch,
  SitePatchEvent,
  SitePatchKind,
  SitePage,
} from '../api/types';
import {
  CONTENT_STATUS_VALUES,
  SITE_CHANNEL_KIND_VALUES,
  SITE_PATCH_KIND_VALUES,
} from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { dateTimeText } from './format';

/** 表单值形状：新建时页面层转成 `SitePatchDraft`，编辑时并进原行转成 `SitePatch`。 */
export interface SitePatchFormValues {
  kind: SitePatchKind;
  title: string;
  target_url: string;
  target_hint: string | null;
  body: string;
  channel_kind: SiteChannelKind;
  /** 只在**编辑**时出现（新建走 `site_patch_add`，后端把审核态固定成 `approved`）。 */
  review_status: ContentStatus;
}

export interface SitePatchEditorModalProps {
  /** 传行即「编辑」，传 `null` 即「新建」（照 `KeywordEditorModal` 的口径）。 */
  patch: SitePatch | null;
  /** 受管页面清单：落点从这份清单里挑，不用手打网址（DR-49）。 */
  pages: SitePage[];
  /** 这条补丁的历史事件（编辑时显示在底部；新建时传空数组）。 */
  events: SitePatchEvent[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: SitePatchFormValues) => void;
}

/** 正文是代码：等宽字体 + 不换行截断会让 HTML 片段没法读，所以 `whiteSpace: pre`。 */
const BODY_STYLE = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 };

/**
 * 补丁的新建 / 编辑弹窗（spec DR-47 / DR-54）。
 *
 * # 🔴 新建时**不给**审核态与来源
 * `site_patch_add` 把 `source` 固定成 `manual`、`review_status` 固定成 `approved`
 * （人工录入的东西不需要再审一遍自己）。让前端自选审核态就等于允许
 * "把 AI 生成的草案洗成人工已通过"——而"人工审核通过"正是 `publish` 的唯一闸门（规则 6）。
 * 编辑时审核态可改：那**就是**人工审核这个动作（照 `keyword_update` 的既有口径）。
 *
 * # 🔴 校验只抄后端那三条，不自造
 * 标题 / 落点 / 正文非空白，与 `handlers/site-patch.ts` 的三个 `validation/failed` 逐字同形。
 * 不加长度上限、不校验 URL 形状：Rust 侧还没有这张表的契约，多写一条就是"demo 自造校验规则"
 * （§B-2③），真后端落地时两侧必然打架。
 *
 * # 🔴 落点用 `AutoComplete` 而不是 `Select`
 * 清单里的 6 个页面要能挑，但 `llms.txt` / `robots.txt` 这类**站点级**落点和
 * "新建一个术语页"这种**还不存在的**落点都挑不出来 ⇒ 必须允许自由输入。
 */
export default function SitePatchEditorModal({
  patch,
  pages,
  events,
  saving,
  onCancel,
  onSubmit,
}: SitePatchEditorModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<SitePatchFormValues>();

  return (
    <Modal
      open
      title={patch === null ? t('site.editor.createTitle') : t('site.editor.editTitle')}
      width={820}
      okText={t('site.editor.save')}
      cancelText={t('site.editor.cancel')}
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => {
        void form
          .validateFields()
          .then((values) =>
            onSubmit({
              ...values,
              title: values.title.trim(),
              target_url: values.target_url.trim(),
              target_hint: values.target_hint === null ? null : values.target_hint.trim() || null,
            }),
          )
          .catch(() => undefined);
      }}
    >
      <Form<SitePatchFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          kind: patch?.kind ?? SITE_PATCH_KIND_VALUES[0],
          title: patch?.title ?? '',
          target_url: patch?.target_url ?? '',
          target_hint: patch?.target_hint ?? null,
          body: patch?.body ?? '',
          channel_kind: patch?.channel_kind ?? 'bundle',
          review_status: patch?.review_status ?? 'approved',
        }}
      >
        <Space size={12} align="start" wrap style={{ width: '100%' }}>
          <Form.Item name="kind" label={t('site.editor.kind')} style={{ marginBottom: 12, minWidth: 220 }}>
            <Select
              options={SITE_PATCH_KIND_VALUES.map((value) => ({
                value,
                label: enumLabel(t, 'site.patchKinds', value),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="channel_kind"
            label={t('site.editor.channel')}
            style={{ marginBottom: 12, minWidth: 200 }}
          >
            <Select
              options={SITE_CHANNEL_KIND_VALUES.map((value) => ({
                value,
                label: enumLabel(t, 'site.channelKinds', value),
              }))}
            />
          </Form.Item>
          {patch === null ? null : (
            <Form.Item
              name="review_status"
              label={t('site.editor.review')}
              style={{ marginBottom: 12, minWidth: 160 }}
            >
              <Select
                options={CONTENT_STATUS_VALUES.map((value) => ({
                  value,
                  label: enumLabel(t, 'action.contentStatuses', value),
                }))}
              />
            </Form.Item>
          )}
        </Space>

        <Form.Item
          name="title"
          label={t('site.editor.titleField')}
          rules={[{ required: true, whitespace: true, message: t('site.editor.requiredTitle') }]}
        >
          <Input placeholder={t('site.editor.titlePlaceholder')} />
        </Form.Item>

        <Form.Item
          name="target_url"
          label={t('site.editor.targetUrl')}
          extra={t('site.editor.pickPage')}
          rules={[{ required: true, whitespace: true, message: t('site.editor.requiredTarget') }]}
        >
          <AutoComplete
            options={pages.map((page) => ({
              value: page.url,
              label: page.title === null ? page.url : `${page.url} · ${page.title}`,
            }))}
            filterOption={(input, option) =>
              String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())
            }
          />
        </Form.Item>

        <Form.Item name="target_hint" label={t('site.editor.targetHint')}>
          <Input.TextArea rows={2} placeholder={t('site.editor.targetHintPlaceholder')} />
        </Form.Item>

        <Form.Item
          name="body"
          label={t('site.editor.body')}
          extra={t('site.editor.bodyHint')}
          rules={[{ required: true, whitespace: true, message: t('site.editor.requiredBody') }]}
        >
          <Input.TextArea rows={14} style={BODY_STYLE} />
        </Form.Item>
      </Form>

      {patch === null ? null : (
        <>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {t('site.editor.historyTitle')}
          </Typography.Text>
          {events.length === 0 ? (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
              {t('site.editor.noHistory')}
            </Typography.Paragraph>
          ) : (
            <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
              {events.map((event) => (
                <li key={event.id}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {`${dateTimeText(event.created_at)} · ${enumLabel(t, 'site.eventKinds', event.kind)}`}
                    {event.channel_kind === null
                      ? ''
                      : ` · ${enumLabel(t, 'site.channelKinds', event.channel_kind)}`}
                    {event.note === null ? '' : ` — ${event.note}`}
                  </Typography.Text>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}

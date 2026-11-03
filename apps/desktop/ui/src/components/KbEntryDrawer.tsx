import { useEffect } from 'react';
import { Button, Drawer, Empty, Form, Input, Select, Space, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';

import type {
  ContentStatus,
  KbEntryKind,
  KbEntryRevision,
  KbModule,
  KbScenario,
} from '../api/types';
import {
  KB_ENTRY_KIND_VALUES,
  KB_MODULE_VALUES,
  KB_SCENARIO_VALUES,
  KB_SCRIPT_MODULES,
} from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { kbFieldLabelKey } from './kb-fields';
import RevisionTimeline from './RevisionTimeline';

export interface KbFormValues {
  module: KbModule;
  kind: KbEntryKind;
  scenario: KbScenario | null;
  title: string;
  body_markdown: string;
  url: string | null;
  mime: string | null;
  tags: string[];
  status?: ContentStatus;
}

export interface KbEntryDrawerProps {
  /** `null` = 新增。 */
  entry: KbFormValues | null;
  /**
   * **当前这一条**的修订留痕（DR-119），新的在前。
   *
   * 🔴 必填而不是给默认值（同 `formatFieldValue` 的 `listSeparator` 那条裁定）：给默认值
   * 会让新的调用点静默传空数组，于是"改了一条知识却看不到历史"变成隐形缺陷。
   * 数据来自 `kb_board` 返回体的 `revisions`（寄生读出口，命令面不加），由页面按 `entry_id` 筛好。
   * 新增（`entry === null`）时传 `[]` 即可：那时根本不渲染页签。
   */
  revisions: KbEntryRevision[];
  defaultModule?: KbModule;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: KbFormValues) => void;
}

interface FormShape {
  module: KbModule;
  kind: KbEntryKind;
  scenario: KbScenario | 'none';
  title: string;
  body_markdown: string;
  url: string | null;
  mime: string | null;
  tags: string[];
  status: ContentStatus;
}

const CONTENT_STATUSES: readonly ContentStatus[] = ['pending_review', 'approved', 'rejected'];
const MEDIA_KINDS: readonly KbEntryKind[] = ['image', 'video', 'file'];

/**
 * 录入 / 编辑侧滑（DR-77，Notion 的 side peek / Guru 卡片编辑器同族）。
 *
 * 比弹窗宽、不挡左侧模块面板：改一条话术时还能看见同场景的邻居。
 * 🔴 场景选择**只**在两个话术模块出现（DR-75）；状态选择**只**在编辑时出现
 * （新增的审核态由后端定：人工 `approved`、导入按源头、生成 `pending_review`）。
 *
 * # 编辑时的两个页签（DR-119）
 * 「编辑」+「修订历史」：Guru / Notion 的卡片编辑器都把 history 收在同一个侧滑里，
 * 改完当场能看见自己刚留下的那条（新旧值并排），不用另开一页。
 * 🔴 **新增时不出页签**：还没有条目就没有历史，出一个恒为空的页签只是噪音。
 * 🔴 两个页签都用 antd `Tabs` 的 `items`（非活动页签**不销毁**）：表单一旦被卸载，
 * `Form.useForm()` 那个实例就与 DOM 脱钩，切回来时 `useEffect` 的依赖没变 ⇒ 不会重新
 * `setFieldsValue`，用户会看到一张**空表单**（改过的值全丢在视图里）。
 */
export default function KbEntryDrawer({
  entry,
  revisions,
  defaultModule,
  saving,
  onCancel,
  onSubmit,
}: KbEntryDrawerProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<FormShape>();
  const module = Form.useWatch('module', form) ?? defaultModule ?? KB_MODULE_VALUES[0];
  const kind = Form.useWatch('kind', form) ?? 'statement';
  const script = KB_SCRIPT_MODULES.includes(module);

  useEffect(() => {
    form.setFieldsValue(
      entry === null
        ? {
            module: defaultModule ?? KB_MODULE_VALUES[0],
            kind: 'statement',
            scenario: 'none',
            title: '',
            body_markdown: '',
            url: null,
            mime: null,
            tags: [],
            status: 'approved',
          }
        : { ...entry, scenario: entry.scenario ?? 'none', status: entry.status ?? 'approved' },
    );
  }, [entry, defaultModule, form]);

  const formPane = (
    <Form<FormShape> form={form} layout="vertical">
      <Form.Item name="module" label={t('kb.editor.module')} rules={[{ required: true }]}>
        <Select
          options={KB_MODULE_VALUES.map((value) => ({
            value,
            label: enumLabel(t, 'kb.modules', value),
          }))}
        />
      </Form.Item>
      <Form.Item name="kind" label={t('kb.editor.kind')} rules={[{ required: true }]}>
        <Select
          options={KB_ENTRY_KIND_VALUES.map((value) => ({
            value,
            label: enumLabel(t, 'kb.kinds', value),
          }))}
        />
      </Form.Item>
      {script ? (
        <Form.Item name="scenario" label={t('kb.editor.scenario')}>
          <Select
            options={[
              { value: 'none', label: t('kb.editor.scenarioNone') },
              ...KB_SCENARIO_VALUES.map((value) => ({
                value,
                label: enumLabel(t, 'kb.scenarios', value),
              })),
            ]}
          />
        </Form.Item>
      ) : null}
      <Form.Item
        name="title"
        label={t('kb.editor.title')}
        rules={[{ required: true, whitespace: true, message: t('kb.editor.titleRequired') }]}
      >
        <Input />
      </Form.Item>
      <Form.Item
        name="body_markdown"
        label={t('kb.editor.body')}
        extra={MEDIA_KINDS.includes(kind) ? t('kb.editor.bodyMediaHint') : undefined}
      >
        <Input.TextArea rows={8} />
      </Form.Item>
      {kind === 'link' || MEDIA_KINDS.includes(kind) ? (
        <Form.Item name="url" label={t('kb.editor.url')}>
          <Input />
        </Form.Item>
      ) : null}
      {MEDIA_KINDS.includes(kind) ? (
        <Form.Item name="mime" label={t('kb.editor.mime')}>
          <Input />
        </Form.Item>
      ) : null}
      <Form.Item name="tags" label={t('kb.editor.tags')}>
        <Select mode="tags" open={false} suffixIcon={null} tokenSeparators={[',', '，']} />
      </Form.Item>
      {entry === null ? null : (
        <Form.Item name="status" label={t('kb.editor.status')}>
          <Select
            options={CONTENT_STATUSES.map((value) => ({
              value,
              label: enumLabel(t, 'action.contentStatuses', value),
            }))}
          />
        </Form.Item>
      )}
    </Form>
  );

  /**
   * 🔴 空态在**这里**分流，不交给 `RevisionTimeline`（DR-119）：那个共用组件的空态文案是
   * `entity.revisions.empty`（实体卡页的口径），知识库要说自己那句 `kb.revisions.empty`。
   * 组件的 props 也因此只有两个（`revisions` + `labelKeyOf`），不多一个 `emptyKey`
   * ——可选 prop 会有人忘传，然后这一页上出现实体卡的文案。
   */
  const revisionsPane =
    revisions.length === 0 ? (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('kb.revisions.empty')} />
    ) : (
      <RevisionTimeline revisions={revisions} labelKeyOf={kbFieldLabelKey} />
    );

  return (
    <Drawer
      open
      width={560}
      title={entry === null ? t('kb.editor.titleAdd') : t('kb.editor.titleEdit')}
      onClose={onCancel}
      extra={
        <Space>
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button
            type="primary"
            loading={saving}
            onClick={() => {
              void form
                .validateFields()
                .then((values) => {
                  onSubmit({
                    module: values.module,
                    kind: values.kind,
                    scenario: values.scenario === 'none' ? null : values.scenario,
                    title: values.title,
                    body_markdown: values.body_markdown,
                    url: values.url,
                    mime: values.mime,
                    tags: values.tags,
                    ...(entry === null ? {} : { status: values.status }),
                  });
                })
                .catch(() => undefined);
            }}
          >
            {t('kb.editor.submit')}
          </Button>
        </Space>
      }
    >
      {entry === null ? (
        formPane
      ) : (
        <Tabs
          defaultActiveKey="edit"
          items={[
            { key: 'edit', label: t('common.edit'), children: formPane },
            { key: 'revisions', label: t('kb.revisions.title'), children: revisionsPane },
          ]}
        />
      )}
    </Drawer>
  );
}

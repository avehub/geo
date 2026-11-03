import { Form, Input, InputNumber, Modal, Select } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ContentStatus, IntentCategory, KeywordKind } from '../api/types';
import { CONTENT_STATUS_VALUES, INTENT_VALUES, KEYWORD_KIND_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

/** 表单值形状：新增时页面层转成 `KeywordDraft`，编辑时并进原行转成 `KeywordItem`。 */
export interface KeywordFormValues {
  text: string;
  kind: KeywordKind;
  intent: IntentCategory;
  priority: number;
  note: string | null;
  status: ContentStatus;
}

export interface KeywordEditorModalProps {
  /** 传行即「编辑」，传 null 即「新增」（照 `PromptItemEditor` 的口径）。 */
  item: KeywordFormValues | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: KeywordFormValues) => void;
}

/**
 * 关键词的手动录入 / 编辑弹窗（spec DR-37：素材"支持手动录入"那一半）。
 *
 * 只在需要时挂载（父组件条件渲染），所以 `initialValues` 每次都是干净的，不用手动 reset。
 *
 * 🔴 **不给"来源"选项**：`source` 由后端固定（手动录入 = `manual`，AI 生成 = `generated`），
 * 让前端自选来源就等于允许"把 AI 生成的素材洗成人工录入"（`handlers/keyword.ts` 的头注释）。
 * 编辑时 `status` 可改——那正是人工审核的动作（采用 / 退回 / 打回待审）。
 *
 * 🔴 **不自造长度上限**：`PromptItemEditor` 的 `MAX_PROMPT_CHARS` 是与 Rust 的
 * `geo_domain::prompt::MAX_PROMPT_CHARS` 对齐的，而关键词在 Rust 侧还没有契约
 * ⇒ 这里只做"非空白"这一条与 handler 完全同形的校验（§B-2③：不自造校验规则）。
 */
export default function KeywordEditorModal({
  item,
  saving,
  onCancel,
  onSubmit,
}: KeywordEditorModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<KeywordFormValues>();

  return (
    <Modal
      open
      title={item === null ? t('library.keyword.addTitle') : t('library.keyword.editTitle')}
      width={560}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => {
        void form
          .validateFields()
          .then((values) =>
            onSubmit({
              ...values,
              text: values.text.trim(),
              note: values.note === null ? null : values.note.trim() || null,
            }),
          )
          .catch(() => undefined);
      }}
    >
      <Form<KeywordFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          text: item?.text ?? '',
          kind: item?.kind ?? KEYWORD_KIND_VALUES[0],
          intent: item?.intent ?? INTENT_VALUES[0],
          priority: item?.priority ?? 3,
          note: item?.note ?? null,
          status: item?.status ?? 'approved',
        }}
      >
        <Form.Item
          name="text"
          label={t('library.keyword.text')}
          rules={[{ required: true, whitespace: true, message: t('library.keyword.requiredText') }]}
        >
          <Input placeholder={t('library.keyword.textPlaceholder')} />
        </Form.Item>
        <Form.Item name="kind" label={t('library.keyword.kind')}>
          <Select
            options={KEYWORD_KIND_VALUES.map((value) => ({
              value,
              label: enumLabel(t, 'library.kinds', value),
            }))}
          />
        </Form.Item>
        <Form.Item name="intent" label={t('library.columns.intent')}>
          <Select
            options={INTENT_VALUES.map((value) => ({
              value,
              label: enumLabel(t, 'prompt.intents', value),
            }))}
          />
        </Form.Item>
        <Form.Item name="priority" label={t('library.keyword.priority')}>
          <InputNumber min={1} max={5} style={{ width: 120 }} />
        </Form.Item>
        <Form.Item name="status" label={t('library.columns.status')}>
          <Select
            options={CONTENT_STATUS_VALUES.map((value) => ({
              value,
              label: enumLabel(t, 'action.contentStatuses', value),
            }))}
          />
        </Form.Item>
        <Form.Item name="note" label={t('common.noteOptional')}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

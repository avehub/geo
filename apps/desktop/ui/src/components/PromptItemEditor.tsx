import { Form, Input, InputNumber, Modal, Select, Space } from 'antd';
import { useTranslation } from 'react-i18next';

import type { PromptDraft, PromptItem } from '../api/types';
import { INTENT_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

/** 与后端 `geo_domain::prompt::MAX_PROMPT_CHARS` 对齐，超长在写库前就被挡下。 */
const MAX_PROMPT_CHARS = 300;

export interface PromptItemEditorProps {
  /** 传条目即「编辑」，传 null 即「新增」。 */
  item: PromptItem | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (draft: PromptDraft) => void;
}

/**
 * 单条 prompt 的新增/编辑弹窗（spec FR-M2-6「增」「改」）。
 *
 * 只在需要时挂载（父组件条件渲染），因此 `initialValues` 每次都是干净的，
 * 不用手动 reset 表单。来源由后端固定为 `manual`，这里不给选择。
 *
 * 意图选项的**运行时清单**是 `api/types.ts` 的 `INTENT_VALUES`（语言中立的稳定 id）；
 * 标签查词典 `prompt.intents.<id>`（`enumLabel`，查不到回退 id 本身）。选项在组件体内构造，
 * 因为模块级常量求值时没有 React 上下文、拿不到 `t`（同 `entity-fields.ts` 装 key 的裁定 B-2）。
 */
export default function PromptItemEditor({
  item,
  saving,
  onCancel,
  onSubmit,
}: PromptItemEditorProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<PromptDraft>();
  const intentOptions = INTENT_VALUES.map((value) => ({
    value,
    label: enumLabel(t, 'prompt.intents', value),
  }));

  return (
    <Modal
      open
      title={item === null ? t('prompt.editor.addTitle') : t('prompt.editor.editTitle')}
      width={560}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => {
        void form
          .validateFields()
          .then((values) => onSubmit({ ...values, text: values.text.trim() }))
          .catch(() => undefined);
      }}
    >
      <Form<PromptDraft>
        form={form}
        layout="vertical"
        initialValues={{
          text: item?.text ?? '',
          intent: item?.intent ?? 'category_awareness',
          weight: item?.weight ?? 3,
          group_name: item?.group_name ?? null,
          repeat_count: item?.repeat_count ?? 1,
          tags: item?.tags ?? [],
        }}
      >
        <Form.Item
          name="text"
          label={t('prompt.editor.text')}
          rules={[
            { required: true, whitespace: true, message: t('prompt.editor.textRequired') },
            { max: MAX_PROMPT_CHARS, message: t('prompt.editor.textTooLong', { max: MAX_PROMPT_CHARS }) },
          ]}
        >
          <Input.TextArea rows={3} showCount maxLength={MAX_PROMPT_CHARS} />
        </Form.Item>
        <Form.Item name="intent" label={t('prompt.editor.intent')} rules={[{ required: true, message: t('prompt.editor.intentRequired') }]}>
          <Select options={intentOptions} />
        </Form.Item>
        <Space size={16}>
          <Form.Item name="weight" label={t('prompt.editor.weight')} tooltip={t('prompt.editor.weightTooltip')}>
            <InputNumber min={1} max={5} />
          </Form.Item>
          <Form.Item
            name="repeat_count"
            label={t('prompt.editor.repeatCount')}
            tooltip={t('prompt.editor.repeatCountTooltip')}
          >
            <InputNumber min={1} max={3} />
          </Form.Item>
        </Space>
        <Form.Item name="group_name" label={t('prompt.editor.group')} tooltip={t('prompt.editor.groupTooltip')}>
          <Input allowClear placeholder={t('prompt.editor.groupPlaceholder')} />
        </Form.Item>
        <Form.Item name="tags" label={t('prompt.editor.tags')} tooltip={t('prompt.editor.tagsTooltip')}>
          <Select
            mode="tags"
            open={false}
            suffixIcon={null}
            tokenSeparators={[',', '，']}
            placeholder={t('prompt.editor.tagsPlaceholder')}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

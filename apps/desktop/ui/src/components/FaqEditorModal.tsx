import { Form, Input, Modal, Select } from 'antd';
import { useTranslation } from 'react-i18next';

import type { ContentStatus, IntentCategory } from '../api/types';
import { CONTENT_STATUS_VALUES, INTENT_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

/** 表单值形状：新增时页面层转成 `FaqDraft`，编辑时并进原行转成 `FaqItem`。 */
export interface FaqFormValues {
  question: string;
  answer_markdown: string;
  category: string | null;
  intent: IntentCategory;
  status: ContentStatus;
}

export interface FaqEditorModalProps {
  item: FaqFormValues | null;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: FaqFormValues) => void;
}

/**
 * FAQ 的手动录入 / 编辑弹窗（spec DR-37）。
 *
 * 口径与 `KeywordEditorModal` 逐字同族（不给"来源"选项、不自造长度上限、
 * 只在需要时挂载所以 `initialValues` 天然干净），那边有完整理由，这里不抄第二份。
 *
 * 答案是 **Markdown 原文**：`Input.TextArea` 直接收，不做所见即所得编辑器
 * （要引富文本依赖，而 demo 的产物形态用预格式文本就能走查）。
 */
export default function FaqEditorModal({ item, saving, onCancel, onSubmit }: FaqEditorModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<FaqFormValues>();

  return (
    <Modal
      open
      title={item === null ? t('library.faq.addTitle') : t('library.faq.editTitle')}
      width={640}
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
              question: values.question.trim(),
              category: values.category === null ? null : values.category.trim() || null,
            }),
          )
          .catch(() => undefined);
      }}
    >
      <Form<FaqFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          question: item?.question ?? '',
          answer_markdown: item?.answer_markdown ?? '',
          category: item?.category ?? null,
          intent: item?.intent ?? INTENT_VALUES[0],
          status: item?.status ?? 'approved',
        }}
      >
        <Form.Item
          name="question"
          label={t('library.faq.question')}
          rules={[
            { required: true, whitespace: true, message: t('library.faq.requiredQuestion') },
          ]}
        >
          <Input placeholder={t('library.faq.questionPlaceholder')} />
        </Form.Item>
        <Form.Item
          name="answer_markdown"
          label={t('library.faq.answer')}
          rules={[
            { required: true, whitespace: true, message: t('library.faq.requiredAnswer') },
          ]}
        >
          <Input.TextArea rows={8} placeholder={t('library.faq.answerPlaceholder')} />
        </Form.Item>
        <Form.Item name="category" label={t('library.columns.category')}>
          <Input />
        </Form.Item>
        <Form.Item name="intent" label={t('library.columns.intent')}>
          <Select
            options={INTENT_VALUES.map((value) => ({
              value,
              label: enumLabel(t, 'prompt.intents', value),
            }))}
          />
        </Form.Item>
        <Form.Item name="status" label={t('library.columns.status')}>
          <Select
            options={CONTENT_STATUS_VALUES.map((value) => ({
              value,
              label: enumLabel(t, 'action.contentStatuses', value),
            }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

import { Alert, Form, InputNumber, Modal, Select, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { FaqGenerateOptions } from '../api/types';
import { INTENT_VALUES, LIBRARY_GENERATE_MAX, LIBRARY_GENERATE_MIN } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { DEFAULT_FAQ_GENERATE_OPTIONS } from './library-generate-defaults';

export interface FaqGenerateModalProps {
  generating: boolean;
  onCancel: () => void;
  onGenerate: (options: FaqGenerateOptions) => void;
}

/**
 * 「AI 生成常见问题」弹窗。口径与 `KeywordGenerateModal` 逐字同族（预置批次、`demoBody` 必须显示），
 * 只是维度从"关键词类型"换成 M2 的 7 类意图（DR-39：素材与题库共用同一套意图维度，
 * 于是生成出来的问答可以一对一引用进 Prompt 题库）。
 */
export default function FaqGenerateModal({ generating, onCancel, onGenerate }: FaqGenerateModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<FaqGenerateOptions>();

  return (
    <Modal
      open
      title={t('library.faq.generateTitle')}
      width={520}
      okText={t('library.actions.generate')}
      cancelText={t('common.cancel')}
      confirmLoading={generating}
      onCancel={onCancel}
      onOk={() => {
        void form
          .validateFields()
          .then((values) =>
            onGenerate({ intents: values.intents, target_count: values.target_count }),
          )
          .catch(() => undefined);
      }}
    >
      <Form<FaqGenerateOptions>
        form={form}
        layout="vertical"
        initialValues={DEFAULT_FAQ_GENERATE_OPTIONS}
      >
        <Form.Item
          name="intents"
          label={t('library.faq.intentsLabel')}
          rules={[{ required: true, message: t('library.faq.intentsLabel') }]}
        >
          <Select
            mode="multiple"
            options={INTENT_VALUES.map((value) => ({
              value,
              label: enumLabel(t, 'prompt.intents', value),
            }))}
          />
        </Form.Item>
        <Form.Item name="target_count" label={t('library.faq.targetCountLabel')}>
          <InputNumber min={LIBRARY_GENERATE_MIN} max={LIBRARY_GENERATE_MAX} style={{ width: 120 }} />
        </Form.Item>
        <Alert type="info" showIcon message={t('library.faq.demoBody')} />
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          {t('library.faq.complianceUnchecked')}
        </Typography.Text>
      </Form>
    </Modal>
  );
}

import { Alert, Form, InputNumber, Modal, Select, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { KeywordGenerateOptions } from '../api/types';
import { KEYWORD_KIND_VALUES, LIBRARY_GENERATE_MAX, LIBRARY_GENERATE_MIN } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { DEFAULT_KEYWORD_GENERATE_OPTIONS } from './library-generate-defaults';

export interface KeywordGenerateModalProps {
  generating: boolean;
  onCancel: () => void;
  onGenerate: (options: KeywordGenerateOptions) => void;
}

/**
 * 「AI 生成关键词」弹窗（spec DR-42：demo 的生成是**预置批次**，不调模型）。
 *
 * 🔴 `demoBody` 那句必须显示：不写清楚，产品负责人会拿它当真实的选词质量评审
 * （AGENTS 规则 9 的界面侧对价，与 `ContentGenerateModal` 的 `action.contents.demoBody` 同族）。
 */
export default function KeywordGenerateModal({
  generating,
  onCancel,
  onGenerate,
}: KeywordGenerateModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<KeywordGenerateOptions>();

  return (
    <Modal
      open
      title={t('library.keyword.generateTitle')}
      width={520}
      okText={t('library.actions.generate')}
      cancelText={t('common.cancel')}
      confirmLoading={generating}
      onCancel={onCancel}
      onOk={() => {
        void form
          .validateFields()
          .then((values) => onGenerate({ kinds: values.kinds, target_count: values.target_count }))
          .catch(() => undefined);
      }}
    >
      <Form<KeywordGenerateOptions>
        form={form}
        layout="vertical"
        initialValues={DEFAULT_KEYWORD_GENERATE_OPTIONS}
      >
        <Form.Item
          name="kinds"
          label={t('library.keyword.kindsLabel')}
          rules={[{ required: true, message: t('library.keyword.kindsLabel') }]}
        >
          <Select
            mode="multiple"
            options={KEYWORD_KIND_VALUES.map((value) => ({
              value,
              label: enumLabel(t, 'library.kinds', value),
            }))}
          />
        </Form.Item>
        <Form.Item name="target_count" label={t('library.keyword.targetCountLabel')}>
          <InputNumber min={LIBRARY_GENERATE_MIN} max={LIBRARY_GENERATE_MAX} style={{ width: 120 }} />
        </Form.Item>
        <Alert type="info" showIcon message={t('library.keyword.demoBody')} />
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          {t('library.keyword.staticNote')}
        </Typography.Text>
      </Form>
    </Modal>
  );
}

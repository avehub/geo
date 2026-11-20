import { Form, InputNumber, Modal, Select } from 'antd';
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
 * 演示2026-11-19 产品裁定：演示提示已全部移除；弹窗不再重复 `demoBody`
 * （AGENTS 规则 9 的界面侧对价已上收到全局细条）。
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
      </Form>
    </Modal>
  );
}

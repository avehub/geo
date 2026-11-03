import { Alert, Form, InputNumber, Modal, Select } from 'antd';
import { useTranslation } from 'react-i18next';

import type { KbModule } from '../api/types';
import { KB_MODULE_VALUES, LIBRARY_GENERATE_MAX, LIBRARY_GENERATE_MIN } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

export interface KbGenerateFormValues {
  modules: KbModule[];
  target_count: number;
}

export interface KbGenerateModalProps {
  generating: boolean;
  onCancel: () => void;
  onGenerate: (values: KbGenerateFormValues) => void;
}

/**
 * 「AI 生成知识条目」的选项弹窗（M1.2b；模块清单按 taxonomy v2，DR-74）。
 *
 * 🔴 **免责说明必须显示**（AGENTS 规则 9 / 规则 6）：demo 不调模型、生成内容来自预置语料池、
 * 未执行合规扫描 ⇒ 产物一律 `pending_review`。少写一句，产品负责人就会拿演示数据
 * 评审"AI 生成的知识质量"。
 *
 * 条数上下限**复用**素材库那一档（`LIBRARY_GENERATE_MIN` / `MAX`）：两处各写一份常量
 * 就是下一个漂移面。
 */
export default function KbGenerateModal({ generating, onCancel, onGenerate }: KbGenerateModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<KbGenerateFormValues>();

  return (
    <Modal
      open
      title={t('kb.generate.title')}
      width={560}
      okText={t('kb.generate.submit')}
      cancelText={t('common.cancel')}
      confirmLoading={generating}
      onCancel={onCancel}
      onOk={() => {
        void form
          .validateFields()
          .then((values) => onGenerate(values))
          .catch(() => undefined);
      }}
    >
      <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('kb.generate.demoNote')} />
      <Form<KbGenerateFormValues>
        form={form}
        layout="vertical"
        initialValues={{ modules: [], target_count: LIBRARY_GENERATE_MIN }}
      >
        <Form.Item
          name="modules"
          label={t('kb.generate.modules')}
          rules={[{ required: true, type: 'array', min: 1, message: t('kb.generate.modulesRequired') }]}
        >
          <Select
            mode="multiple"
            options={KB_MODULE_VALUES.map((module) => ({
              value: module,
              label: enumLabel(t, 'kb.modules', module),
            }))}
          />
        </Form.Item>
        <Form.Item name="target_count" label={t('kb.generate.count')}>
          <InputNumber min={LIBRARY_GENERATE_MIN} max={LIBRARY_GENERATE_MAX} style={{ width: 120 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

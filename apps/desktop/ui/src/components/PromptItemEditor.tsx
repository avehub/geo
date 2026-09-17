import { Form, Input, InputNumber, Modal, Select, Space } from 'antd';

import type { IntentCategory, PromptDraft, PromptItem } from '../api/types';
import { INTENT_LABELS } from '../api/types';

/** 与后端 `geo_domain::prompt::MAX_PROMPT_CHARS` 对齐，超长在写库前就被挡下。 */
const MAX_PROMPT_CHARS = 300;

const INTENT_OPTIONS = (Object.keys(INTENT_LABELS) as IntentCategory[]).map((value) => ({
  value,
  label: INTENT_LABELS[value],
}));

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
 */
export default function PromptItemEditor({
  item,
  saving,
  onCancel,
  onSubmit,
}: PromptItemEditorProps) {
  const [form] = Form.useForm<PromptDraft>();

  return (
    <Modal
      open
      title={item === null ? '新增 prompt' : '编辑 prompt'}
      width={560}
      okText="保存"
      cancelText="取消"
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
        }}
      >
        <Form.Item
          name="text"
          label="Prompt 文本"
          rules={[
            { required: true, whitespace: true, message: '请输入 prompt 文本' },
            { max: MAX_PROMPT_CHARS, message: `不能超过 ${MAX_PROMPT_CHARS} 字` },
          ]}
        >
          <Input.TextArea rows={3} showCount maxLength={MAX_PROMPT_CHARS} />
        </Form.Item>
        <Form.Item name="intent" label="意图" rules={[{ required: true, message: '请选择意图' }]}>
          <Select options={INTENT_OPTIONS} />
        </Form.Item>
        <Space size={16}>
          <Form.Item name="weight" label="权重" tooltip="1–5，核心词加权，越高越先采集">
            <InputNumber min={1} max={5} />
          </Form.Item>
          <Form.Item
            name="repeat_count"
            label="采样次数"
            tooltip="1–3，P0-B 采集时这条 prompt 重复问几次"
          >
            <InputNumber min={1} max={3} />
          </Form.Item>
        </Space>
        <Form.Item name="group_name" label="分组" tooltip="留空则按意图自动归组">
          <Input allowClear placeholder="留空按意图归组" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

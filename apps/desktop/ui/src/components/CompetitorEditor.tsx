import { Alert, Button, Form, Input, Space, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';

export const MIN_COMPETITORS = 3;
export const MAX_COMPETITORS = 5;

/**
 * 第 5 步：竞品 3–5 家。
 *
 * 竞品数量下限是产品口径（M2 要求「竞品同框 prompt」才能算 SOV），
 * 因此这里既给持续可见的提示，也在提交时二次拦截。
 */
export default function CompetitorEditor() {
  const competitors = Form.useWatch<unknown[]>('competitors') ?? [];
  const validCount = competitors.filter(
    (item) => typeof item === 'object' && item !== null && String((item as { name?: string }).name ?? '').trim() !== '',
  ).length;
  const tooFew = validCount < MIN_COMPETITORS;
  const tooMany = competitors.length > MAX_COMPETITORS;

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        填写 {MIN_COMPETITORS}–{MAX_COMPETITORS} 家直接竞品。题库会自动生成「本品牌 vs 竞品」同框
        prompt，用于后续计算 Share of Voice。
      </Typography.Paragraph>

      {tooFew && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`至少填写 ${MIN_COMPETITORS} 家竞品（当前 ${validCount} 家）`}
          description="竞品不足会导致「品牌对比」类 prompt 无法覆盖，SOV 指标不可用。"
        />
      )}
      {tooMany && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={`竞品不能超过 ${MAX_COMPETITORS} 家`}
        />
      )}

      <Form.List name="competitors">
        {(fields, { add, remove }) => (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {fields.map((field) => (
              <Space key={field.key} align="baseline" wrap>
                <Form.Item
                  name={[field.name, 'name']}
                  rules={[{ max: 50, message: '竞品名称不能超过 50 字' }]}
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder="竞品名称" style={{ width: 180 }} />
                </Form.Item>
                <Form.Item
                  name={[field.name, 'website']}
                  rules={[{ type: 'url', message: '请输入合法的 URL（含 http/https）' }]}
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder="竞品官网（可选）" style={{ width: 240 }} />
                </Form.Item>
                <Form.Item name={[field.name, 'note']} style={{ marginBottom: 0 }}>
                  <Input placeholder="备注（可选）" style={{ width: 200 }} />
                </Form.Item>
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => remove(field.name)}
                  aria-label="删除该竞品"
                />
              </Space>
            ))}
            <Button
              icon={<PlusOutlined />}
              onClick={() => add({ name: '', aliases: [], website: null, note: null })}
              disabled={fields.length >= MAX_COMPETITORS}
            >
              添加竞品
            </Button>
          </Space>
        )}
      </Form.List>
    </div>
  );
}

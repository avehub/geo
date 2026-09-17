import { useState } from 'react';
import { Button, Card, Checkbox, Form, InputNumber, Radio, Space, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';

import type { GenerateOptions, Industry, IntentCategory } from '../api/types';
import { INDUSTRY_LABELS, INTENT_LABELS } from '../api/types';

export const DEFAULT_TARGET_COUNT = 80;
export const MIN_TARGET_COUNT = 60;

const INTENTS = Object.keys(INTENT_LABELS) as IntentCategory[];
const INDUSTRIES = Object.keys(INDUSTRY_LABELS) as Industry[];

export interface GeneratePanelProps {
  defaultIndustry: Industry;
  loading?: boolean;
  onGenerate: (options: GenerateOptions) => void;
}

/**
 * 题库生成参数面板。
 *
 * 目标条数下限取 60：这是「样本充足」的门槛（见 `SampleSizeAlert`），
 * 低于它生成的题库只能给方向性结论，不如一开始就拦住。
 */
export default function GeneratePanel({
  defaultIndustry,
  loading = false,
  onGenerate,
}: GeneratePanelProps) {
  const [targetCount, setTargetCount] = useState<number>(DEFAULT_TARGET_COUNT);
  const [industry, setIndustry] = useState<Industry>(defaultIndustry);
  const [intents, setIntents] = useState<IntentCategory[]>(INTENTS);
  const [repeatCount, setRepeatCount] = useState<number>(1);

  return (
    <Card size="small" title="生成题库" style={{ marginBottom: 16 }}>
      <Form layout="inline" style={{ rowGap: 12 }}>
        <Form.Item label="目标条数">
          <InputNumber
            min={MIN_TARGET_COUNT}
            max={200}
            value={targetCount}
            onChange={(value) => setTargetCount(typeof value === 'number' ? value : MIN_TARGET_COUNT)}
          />
        </Form.Item>
        <Form.Item label="重复采样">
          <InputNumber
            min={1}
            max={3}
            value={repeatCount}
            onChange={(value) => setRepeatCount(typeof value === 'number' ? value : 1)}
          />
        </Form.Item>
        <Form.Item label="行业模板" style={{ width: '100%' }}>
          <Radio.Group
            optionType="button"
            size="small"
            value={industry}
            onChange={(event) => setIndustry(event.target.value as Industry)}
            options={INDUSTRIES.map((value) => ({ value, label: INDUSTRY_LABELS[value] }))}
          />
        </Form.Item>
        <Form.Item label="意图覆盖" style={{ width: '100%' }}>
          <Checkbox.Group
            value={intents}
            onChange={(values) => setIntents(values as IntentCategory[])}
            options={INTENTS.map((value) => ({ value, label: INTENT_LABELS[value] }))}
          />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={loading}
              onClick={() =>
                onGenerate({
                  target_count: targetCount,
                  industry,
                  intents,
                  repeat_count: repeatCount,
                })
              }
            >
              生成题库
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              管线：模板展开 → AI 扩写 → 口语化改写 → 竞品同框 → 去重 → 版本化快照
            </Typography.Text>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}

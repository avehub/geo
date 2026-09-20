import { useState } from 'react';
import { Button, Card, Checkbox, Form, InputNumber, Radio, Space, Typography } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import type { GenerateOptions, Industry, IntentCategory } from '../api/types';
import { INDUSTRY_VALUES, INTENT_VALUES } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

export const DEFAULT_TARGET_COUNT = 80;
export const MIN_TARGET_COUNT = 60;

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
 *
 * 行业与意图的**运行时清单**是 `api/types.ts` 的 `INDUSTRY_VALUES` / `INTENT_VALUES`
 * （语言中立的稳定 id）；标签查词典 `project.industries.<id>` / `prompt.intents.<id>`，
 * 走 `src/i18n/enum-label.ts` 的 `enumLabel`，查不到回退 id 本身（照 `ProviderSelect` 的先例）。
 * 选项顺序 = 值清单顺序，与被删掉的那两张标签映射的键顺序逐字一致。
 */
export default function GeneratePanel({
  defaultIndustry,
  loading = false,
  onGenerate,
}: GeneratePanelProps) {
  const { t } = useTranslation();
  const [targetCount, setTargetCount] = useState<number>(DEFAULT_TARGET_COUNT);
  const [industry, setIndustry] = useState<Industry>(defaultIndustry);
  const [intents, setIntents] = useState<IntentCategory[]>([...INTENT_VALUES]);
  const [repeatCount, setRepeatCount] = useState<number>(1);

  return (
    <Card size="small" title={t('prompt.generate.title')} style={{ marginBottom: 16 }}>
      <Form layout="inline" style={{ rowGap: 12 }}>
        <Form.Item label={t('prompt.generate.targetCount')}>
          <InputNumber
            min={MIN_TARGET_COUNT}
            max={200}
            value={targetCount}
            onChange={(value) => setTargetCount(typeof value === 'number' ? value : MIN_TARGET_COUNT)}
          />
        </Form.Item>
        <Form.Item label={t('prompt.generate.repeatCount')}>
          <InputNumber
            min={1}
            max={3}
            value={repeatCount}
            onChange={(value) => setRepeatCount(typeof value === 'number' ? value : 1)}
          />
        </Form.Item>
        <Form.Item label={t('prompt.generate.industry')} style={{ width: '100%' }}>
          <Radio.Group
            optionType="button"
            size="small"
            value={industry}
            onChange={(event) => setIndustry(event.target.value as Industry)}
            options={INDUSTRY_VALUES.map((value) => ({
              value,
              label: enumLabel(t, 'project.industries', value),
            }))}
          />
        </Form.Item>
        <Form.Item label={t('prompt.generate.intents')} style={{ width: '100%' }}>
          <Checkbox.Group
            value={intents}
            onChange={(values) => setIntents(values as IntentCategory[])}
            options={INTENT_VALUES.map((value) => ({
              value,
              label: enumLabel(t, 'prompt.intents', value),
            }))}
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
              {t('prompt.generate.submit')}
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('prompt.generate.pipeline')}
            </Typography.Text>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );
}

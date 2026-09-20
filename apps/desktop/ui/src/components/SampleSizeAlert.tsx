import { Alert } from 'antd';
import { useTranslation } from 'react-i18next';

import type { SampleSizeGrade } from '../api/types';
import { SAMPLE_SIZE_WARNINGS } from '../api/types';
import { SUFFICIENT_SAMPLE_SIZE } from '../api/constants';

/**
 * 样本量纪律（产品文档第 4 节）：<60 条只给方向性结论，<30 条不给精确分数。
 *
 * `sufficient` 时不渲染任何东西——不要拿「一切正常」的提示去稀释真正的风险告警。
 *
 * 说明文案走 `prompt.sampleSize.detail`；插值变量刻意不叫 `count`，因为 i18next 见到
 * `count` 会走复数分支去找 `key_one` / `key_other`（本词典没有这两条，会静默回落）。
 *
 * ⚠ 告警**标题**仍复用后端 `SampleSizeGrade::warning_zh()`（`api/types.ts` 的
 * `SAMPLE_SIZE_WARNINGS`）——那是英文 locale 下仍显示中文的泄漏面，但 `types.ts` 归
 * Task 9 的写集，本任务不越界改（简报 §C）。接缝已记进 task-8-report.md。
 */
export default function SampleSizeAlert({
  grade,
  count,
}: {
  grade: SampleSizeGrade;
  count: number;
}) {
  const { t } = useTranslation();
  const warning = SAMPLE_SIZE_WARNINGS[grade];
  if (!warning) return null;

  return (
    <Alert
      type={grade === 'insufficient' ? 'error' : 'warning'}
      showIcon
      style={{ marginBottom: 12 }}
      message={warning}
      description={t('prompt.sampleSize.detail', {
        total: count,
        target: SUFFICIENT_SAMPLE_SIZE,
      })}
    />
  );
}

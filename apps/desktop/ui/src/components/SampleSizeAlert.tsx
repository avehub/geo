import { Alert } from 'antd';

import type { SampleSizeGrade } from '../api/types';
import { SAMPLE_SIZE_WARNINGS } from '../api/types';

/**
 * 样本量纪律（产品文档第 4 节）：<60 条只给方向性结论，<30 条不给精确分数。
 *
 * 文案直接复用后端 `SampleSizeGrade::warning_zh()`，避免前后端口径漂移。
 * `sufficient` 时不渲染任何东西——不要拿「一切正常」的提示去稀释真正的风险告警。
 */
export default function SampleSizeAlert({
  grade,
  count,
}: {
  grade: SampleSizeGrade;
  count: number;
}) {
  const warning = SAMPLE_SIZE_WARNINGS[grade];
  if (!warning) return null;

  return (
    <Alert
      type={grade === 'insufficient' ? 'error' : 'warning'}
      showIcon
      style={{ marginBottom: 12 }}
      message={warning}
      description={`当前题库共 ${count} 条 prompt。建议补齐到 60 条以上再对外汇报分数。`}
    />
  );
}

import { Alert } from 'antd';
import { useTranslation } from 'react-i18next';

import type { SampleSizeGrade } from '../api/types';
import { MINIMUM_SAMPLE_SIZE, SUFFICIENT_SAMPLE_SIZE } from '../api/constants';
import { enumLabel } from '../i18n/enum-label';

/**
 * 有告警文案的那几档。`prompt.sampleSize.warnings` 是 `Partial`：`sufficient` **没有**键，
 * 这张语言中立的清单取代了被删掉的 `SAMPLE_SIZE_WARNINGS` 兼着的运行时清单职责，
 * 也把「`sufficient` 什么都不说」这个语义钉在组件里（哨兵见 `enum-label.test.tsx`）。
 */
const GRADES_WITH_WARNING: readonly SampleSizeGrade[] = ['directional', 'insufficient'];

/**
 * 样本量纪律（产品文档第 4 节）：<60 条只给方向性结论，<30 条不给精确分数。
 *
 * `sufficient` 时不渲染任何东西——不要拿「一切正常」的提示去稀释真正的风险告警。
 *
 * 说明文案走 `prompt.sampleSize.detail`，告警标题走 `prompt.sampleSize.warnings.<grade>`
 * （`enumLabel`，查不到回退 grade 本身）。两处的插值变量都刻意不叫 `count`，因为 i18next
 * 见到 `count` 会走复数分支去找 `key_one` / `key_other`（本词典没有这两条，会静默回落）。
 *
 * 阈值数字一律从 `api/constants.ts` 插值进去，词典里不写死（60 / 30 与后端同源）。
 */
export default function SampleSizeAlert({
  grade,
  count,
}: {
  grade: SampleSizeGrade;
  count: number;
}) {
  const { t } = useTranslation();
  if (!GRADES_WITH_WARNING.includes(grade)) return null;

  return (
    <Alert
      type={grade === 'insufficient' ? 'error' : 'warning'}
      showIcon
      style={{ marginBottom: 12 }}
      message={enumLabel(t, 'prompt.sampleSize.warnings', grade, {
        sufficient: String(SUFFICIENT_SAMPLE_SIZE),
        minimum: String(MINIMUM_SAMPLE_SIZE),
      })}
      description={t('prompt.sampleSize.detail', {
        total: count,
        target: SUFFICIENT_SAMPLE_SIZE,
      })}
    />
  );
}

import { Tag, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';

import type { FieldStatus } from '../api/types';
import { FIELD_STATUS_LABELS } from '../api/types';
import type { TranslationKey } from '../i18n/resources';

const COLOR: Record<FieldStatus, string> = {
  official: 'green',
  pending: 'orange',
  disputed: 'red',
};

/**
 * 状态**解释**的词典 key。装 key 而不是译文，因为这是模块级常量、求值时没有 React 上下文
 * （同 `entity-fields.ts` 的裁定 B-2）。
 *
 * 标签本身（`FIELD_STATUS_LABELS`）仍来自 `api/types.ts`：那是「后端产出自然语言」的
 * 枚举标签映射，`types.ts` 归 Task 9 的写集（简报 §C 只允许本任务改它的 `CsvRowError`），
 * 本任务不越界。接缝已记进 task-8-report.md 的 Task 9 交接段。
 */
const HINT_KEY: Record<FieldStatus, TranslationKey> = {
  official: 'entity.fieldStatusHint.official',
  pending: 'entity.fieldStatusHint.pending',
  disputed: 'entity.fieldStatusHint.disputed',
};

/** 实体卡字段的可信状态标记。颜色即口径：绿=官方、橙=待确认、红=存疑。 */
export default function FieldStatusTag({ status }: { status: FieldStatus }) {
  const { t } = useTranslation();

  return (
    <Tooltip title={t(HINT_KEY[status])}>
      <Tag color={COLOR[status]} style={{ marginInlineEnd: 0 }}>
        {FIELD_STATUS_LABELS[status]}
      </Tag>
    </Tooltip>
  );
}

import { Tag, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';

import type { FieldStatus } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
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
 * 标签本体则查 `entity.fieldStatuses.<id>`（`src/i18n/enum-label.ts` 的 `enumLabel`），
 * 查不到回退 id 本身、绝不回退中文；`FieldStatus` 的运行时清单是 `api/types.ts` 的
 * `FIELD_STATUS_VALUES`（本组件只渲染传进来的那一个状态，不遍历清单）。
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
        {enumLabel(t, 'entity.fieldStatuses', status)}
      </Tag>
    </Tooltip>
  );
}

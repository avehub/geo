import { Tag, Tooltip } from 'antd';

import type { FieldStatus } from '../api/types';
import { FIELD_STATUS_LABELS } from '../api/types';

const COLOR: Record<FieldStatus, string> = {
  official: 'green',
  pending: 'orange',
  disputed: 'red',
};

const HINT: Record<FieldStatus, string> = {
  official: '与官方口径一致，可直接用于内容生产',
  pending: 'AI 抽取或人工待确认，使用前请核对',
  disputed: '与公开信息存在冲突，需人工裁决',
};

/** 实体卡字段的可信状态标记。颜色即口径：绿=官方、橙=待确认、红=存疑。 */
export default function FieldStatusTag({ status }: { status: FieldStatus }) {
  return (
    <Tooltip title={HINT[status]}>
      <Tag color={COLOR[status]} style={{ marginInlineEnd: 0 }}>
        {FIELD_STATUS_LABELS[status]}
      </Tag>
    </Tooltip>
  );
}

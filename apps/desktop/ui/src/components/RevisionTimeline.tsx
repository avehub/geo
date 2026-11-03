import { Empty, Timeline, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

import type { FieldStatus } from '../api/types';
import { formatFieldValue } from './entity-fields';
import { dateTimeSecondsText } from './format';
import FieldStatusTag from './FieldStatusTag';

/**
 * 修订留痕的**结构子集**：本组件真正会读的六个键（DR-119）。
 *
 * `EntityCardRevision`（`api/types.ts:315`）与 `KbEntryRevision`（`api/types-kb.ts`）
 * 都比它多几个归属键（`id` / `project_id`，KB 那边还有 `entry_id`），但**六键同名同型** ⇒
 * 两种留痕都能直接喂进来，不需要适配器、也不需要联合类型分派。
 *
 * 🔴 这里是"组件需要什么就声明什么"（结构类型），不是"两种留痕的并集"：
 * 再加一个消费方（例如将来的站点补丁台账）只要它的留痕有这六个键就能复用本组件，
 * **不许**为此新造第二个时间线组件——两个组件必然漂移，一个组件 + N 个字段标签 resolver 才不会。
 */
export interface RevisionLike {
  field_path: string;
  old_value: unknown | null;
  new_value: unknown | null;
  status: FieldStatus;
  note: string | null;
  edited_at: string;
}

export interface RevisionTimelineProps {
  /** 已经排好序的留痕（两侧都是**新的在前**）。 */
  revisions: RevisionLike[];
  /**
   * `field_path` → 词典 key；查不到返回 `null`，此时界面回落**原始 path**（露出机器记号，
   * 比静默换成另一套标签安全）。实体卡传 `entityFieldLabelKey`、知识库传 `kbFieldLabelKey`。
   *
   * 🔴 由调用方传而不是组件内部按形状猜：留痕上没有"我属于哪个页面"的记号，
   * 靠 `field_path` 反查两张标签表会得到"碰巧命中"的错标签。
   */
  labelKeyOf: (path: string) => string | null;
}

/**
 * 字段级修订留痕时间线（新的在前）。实体卡页与知识库编辑侧滑**共用**这一个组件（DR-119）。
 *
 * 🔴 空态那句用的是 `entity.revisions.empty`：今天只有实体卡页会把**可能为空**的数组直接喂进来。
 * 知识库那侧在自己那边分流（`components/KbEntryDrawer.tsx` 渲染 `kb.revisions.empty` 再决定
 * 要不要挂本组件），所以两份空态文案不会互相抢；本组件的 props 刻意只有两个，
 * 不再多一个 `emptyKey`——多一个可选 prop 就会有人忘传，然后 KB 页上出现实体卡的空态文案。
 */
export default function RevisionTimeline({ revisions, labelKeyOf }: RevisionTimelineProps) {
  const { t } = useTranslation();
  // 语言相关的列表连接符（fix1 复审 #6）：作为**参数**送进数据层函数，
  // 而不是把 `t` 渗进 `entity-fields.ts`（裁定 B-2）。
  const listSeparator = t('common.listSeparator');

  if (revisions.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('entity.revisions.empty')} />;
  }

  return (
    <Timeline
      items={revisions.map((revision) => {
        const labelKey = labelKeyOf(revision.field_path);
        return {
          color: revision.status === 'disputed' ? 'red' : revision.status === 'pending' ? 'orange' : 'green',
          children: (
            <div>
              <Typography.Text strong>
                {labelKey === null ? revision.field_path : t(labelKey)}
              </Typography.Text>{' '}
              <FieldStatusTag status={revision.status} />
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {dateTimeSecondsText(revision.edited_at)}
                </Typography.Text>
              </div>
              <Typography.Text style={{ fontSize: 12 }}>
                {formatFieldValue(revision.old_value, listSeparator)} →{' '}
                {formatFieldValue(revision.new_value, listSeparator)}
              </Typography.Text>
              {revision.note ? <div>{revision.note}</div> : null}
            </div>
          ),
        };
      })}
    />
  );
}

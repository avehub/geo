import { Empty, Timeline, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';

import type { EntityCardRevision } from '../api/types';
import { ENTITY_FIELDS, formatFieldValue } from './entity-fields';
import FieldStatusTag from './FieldStatusTag';

/**
 * 字段路径 → `entity.fields.*` 的词典 key；查不到返回 null。
 *
 * 返回 **key 或 null**（而不是 `key ?? path`）是刻意的：`path` 是后端给的原始字段路径
 * （可能是 `products[0].name` 这种带下标的），把它当 key 喂给 `t()` 只是"碰巧"因为
 * i18next 未命中会原样返回 key。那种隐式依赖一改 `nsSeparator` 就碎，所以调用点显式分流。
 */
function fieldLabelKey(path: string): string | null {
  const match = ENTITY_FIELDS.find((field) => path === field.path || path.startsWith(`${field.path}.`));
  return match === undefined ? null : match.labelKey;
}

/** 实体卡字段级修订留痕，最新在前。 */
export default function RevisionTimeline({ revisions }: { revisions: EntityCardRevision[] }) {
  const { t } = useTranslation();

  if (revisions.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('entity.revisions.empty')} />;
  }

  return (
    <Timeline
      items={revisions.map((revision) => {
        const labelKey = fieldLabelKey(revision.field_path);
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
                  {dayjs(revision.edited_at).format('YYYY-MM-DD HH:mm:ss')}
                </Typography.Text>
              </div>
              <Typography.Text style={{ fontSize: 12 }}>
                {formatFieldValue(revision.old_value)} → {formatFieldValue(revision.new_value)}
              </Typography.Text>
              {revision.note ? <div>{revision.note}</div> : null}
            </div>
          ),
        };
      })}
    />
  );
}

import { Empty, Timeline, Typography } from 'antd';
import dayjs from 'dayjs';

import type { EntityCardRevision } from '../api/types';
import { ENTITY_FIELDS, formatFieldValue } from './EntityFieldCard';
import FieldStatusTag from './FieldStatusTag';

function fieldLabel(path: string): string {
  return ENTITY_FIELDS.find((field) => path === field.path || path.startsWith(`${field.path}.`))
    ?.label ?? path;
}

/** 实体卡字段级修订留痕，最新在前。 */
export default function RevisionTimeline({ revisions }: { revisions: EntityCardRevision[] }) {
  if (revisions.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有修订记录" />;
  }

  return (
    <Timeline
      items={revisions.map((revision) => ({
        color: revision.status === 'disputed' ? 'red' : revision.status === 'pending' ? 'orange' : 'green',
        children: (
          <div>
            <Typography.Text strong>{fieldLabel(revision.field_path)}</Typography.Text>{' '}
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
      }))}
    />
  );
}

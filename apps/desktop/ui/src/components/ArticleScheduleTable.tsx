import { Button, Space, Switch, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';

import type { ArticleSchedule } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import type { TranslationKey } from '../i18n/resources';
import { dateTimeText } from './format';

export interface ArticleScheduleTableProps {
  rows: ArticleSchedule[];
  loading?: boolean;
  /** 模板 id → 模板名（页面层查好再传进来，理由同 `ArticleTemplateTable` 的方向标题）。 */
  templateNameOf: (templateId: string) => string;
  /** 正在「立即运行」的那一条。 */
  busyId?: string | null;
  onToggle: (row: ArticleSchedule, enabled: boolean) => void;
  onRunNow: (row: ArticleSchedule) => void;
  onEdit: (row: ArticleSchedule) => void;
}

/**
 * ISO 8601 的星期几（1 = 周一 … 7 = 周日）→ 词典键。
 *
 * 🔴 **不走 `enumLabel`**：`weekday` 是**数字**而不是稳定记号串，`enumLabel` 拼出来的键会是
 * `article.weekdays.3`（词典里是 `wed`）。这张表就是数字与键名之间唯一的映射，
 * 键名类型是 `TranslationKey` ⇒ 写错一个字母 `tsc -b` 就红（动态拼键抓不到这种错，
 * 见 `i18n/enum-label.ts` 的头注释）。
 */
const WEEKDAY_KEYS: Record<number, TranslationKey> = {
  1: 'article.weekdays.mon',
  2: 'article.weekdays.tue',
  3: 'article.weekdays.wed',
  4: 'article.weekdays.thu',
  5: 'article.weekdays.fri',
  6: 'article.weekdays.sat',
  7: 'article.weekdays.sun',
};

/**
 * ③ 生成排期表（spec 2026-10-10 · DR-86③）。
 *
 * # 🔴 开关与「立即运行」是两件事（DR-85）
 * - 开关只决定 `next_run_at` 算不算得出来（关掉 ⇒ 空值占位符，不是一个假时间）；
 * - 「立即运行」不受开关约束：停用的排期也能手动跑一次（handler 也不翻 `enabled`）。
 * 演示模式**没有定时器**，到点不会自动出稿 ⇒ 页面上那句 `schedules.demoBody` 常驻，
 * 这张表只提供"手动触发一次"的替身。
 *
 * # 🔴 「运行时间」那一格按频率变形
 * 日更只有 `HH:mm`；周更要带星期几（`星期三 16:00`），否则"每周"这三个字没法落到具体哪一天。
 * 两格都**不留空**：日更行的星期信息本来就不存在，硬塞一个空值占位符会让人以为"这条排期坏了"
 * （页面测试因此钉住"启用的日更行里一个占位符都没有"）。
 *
 * # 空值占位符
 * `next_run_at` / `last_run_at` 为 `null` 时显示 `—`（不是空串）：`—` 是 U+2014、不属 CJK，
 * 可以直接写在组件里（口径与 `KeywordTable` / `PromptTable` 逐字相同）。
 */
export default function ArticleScheduleTable({
  rows,
  loading = false,
  templateNameOf,
  busyId = null,
  onToggle,
  onRunNow,
  onEdit,
}: ArticleScheduleTableProps) {
  const { t } = useTranslation();

  const columns: ColumnsType<ArticleSchedule> = [
    {
      title: t('article.schedules.columns.template'),
      dataIndex: 'template_id',
      key: 'template_id',
      render: (_, row) => {
        const name = templateNameOf(row.template_id);
        return name === '' ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text strong>{name}</Typography.Text>
        );
      },
    },
    {
      title: t('article.schedules.columns.freq'),
      dataIndex: 'freq',
      key: 'freq',
      width: 92,
      render: (_, row) => enumLabel(t, 'article.freqs', row.freq),
    },
    {
      title: t('article.schedules.columns.time'),
      dataIndex: 'time',
      key: 'time',
      width: 168,
      render: (_, row) =>
        row.freq === 'weekly' && row.weekday !== null
          ? `${t(WEEKDAY_KEYS[row.weekday] ?? WEEKDAY_KEYS[1])} ${row.time}`
          : row.time,
    },
    {
      title: t('article.schedules.columns.nextRun'),
      dataIndex: 'next_run_at',
      key: 'next_run_at',
      width: 150,
      render: (_, row) =>
        row.next_run_at === null ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text style={{ fontSize: 12 }}>{dateTimeText(row.next_run_at)}</Typography.Text>
        ),
    },
    {
      title: t('article.schedules.columns.lastRun'),
      dataIndex: 'last_run_at',
      key: 'last_run_at',
      width: 150,
      render: (_, row) =>
        row.last_run_at === null ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {dateTimeText(row.last_run_at)}
          </Typography.Text>
        ),
    },
    {
      title: t('article.schedules.columns.runCount'),
      dataIndex: 'run_count',
      key: 'run_count',
      width: 84,
      align: 'right',
      render: (_, row) => row.run_count,
    },
    {
      title: t('article.schedules.columns.enabled'),
      dataIndex: 'enabled',
      key: 'enabled',
      width: 84,
      render: (_, row) => (
        <Switch
          size="small"
          checked={row.enabled}
          aria-label={t('article.schedules.enabledAria', { name: templateNameOf(row.template_id) })}
          onChange={(enabled) => onToggle(row, enabled)}
        />
      ),
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 168,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => onEdit(row)}>
            {t('article.schedules.edit')}
          </Button>
          <Button
            type="link"
            size="small"
            loading={busyId === row.id}
            onClick={() => onRunNow(row)}
          >
            {t('article.schedules.runNow')}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div data-testid="article-schedule-table">
      <Table<ArticleSchedule>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1080 }}
        pagination={false}
        locale={{ emptyText: t('article.schedules.empty') }}
      />
    </div>
  );
}

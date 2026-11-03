import { Form, Modal, Select, Switch, TimePicker } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';

import type { ArticleFreq, ArticleSchedule, ArticleTemplate } from '../api/types';
import { ARTICLE_FREQ_VALUES, ARTICLE_WEEKDAY_MAX, ARTICLE_WEEKDAY_MIN } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import type { TranslationKey } from '../i18n/resources';

/** 表单值形状：`time` 是 `Dayjs`（`TimePicker` 的口径），提交时格式化成契约要的 `HH:mm`。 */
export interface ArticleScheduleFormValues {
  template_id: string;
  freq: ArticleFreq;
  time: Dayjs;
  weekday: number | null;
  enabled: boolean;
}

export interface ArticleScheduleModalProps {
  /** 传行即「编辑」，传 null 即「新建」。 */
  schedule: ArticleSchedule | null;
  templates: ArticleTemplate[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: {
    id: string | null;
    template_id: string;
    freq: ArticleFreq;
    time: string;
    weekday: number | null;
    enabled: boolean;
  }) => void;
}

/** 星期几的词典键（与 `ArticleScheduleTable` 同一张表：数字 → 键名，不走 `enumLabel`）。 */
const WEEKDAY_KEYS: Record<number, TranslationKey> = {
  1: 'article.weekdays.mon',
  2: 'article.weekdays.tue',
  3: 'article.weekdays.wed',
  4: 'article.weekdays.thu',
  5: 'article.weekdays.fri',
  6: 'article.weekdays.sat',
  7: 'article.weekdays.sun',
};

const WEEKDAYS = Array.from(
  { length: ARTICLE_WEEKDAY_MAX - ARTICLE_WEEKDAY_MIN + 1 },
  (_, index) => ARTICLE_WEEKDAY_MIN + index,
);

/** 新建时的默认运行时间（`HH:mm`，与种子里那条日更排期同一个量级的上午时段）。 */
const DEFAULT_TIME = '09:00';

/**
 * 新建 / 编辑一条生成排期（spec 2026-10-10 · DR-84 / DR-86③，表单形态参照 survey §3.5 的
 * 「就地展开」：只在选了「每周」时才出现星期那一栏，日更不需要它）。
 *
 * # 🔴 demo 没有定时器（DR-85）
 * 这个弹窗只写"打算什么时候跑"这份**配置**，不注册任何定时器；`next_run_at` 由 handler 按
 * freq + time 算出来当显示值。所以「启用」那一栏的说明写在页面上（`schedules.demoBody` 常驻），
 * 弹窗里不再复述一遍——同一句话出现两次只会让人以为是两处不同的机制。
 *
 * # 🔴 `run_count` / `last_run_at` 不在表单里
 * "跑过几次"是运行的账，编辑表单改不动它（handler 也不接受这两个字段，
 * 口径同 `kb_entry_update` 不许改 `verified_at`）。
 */
export default function ArticleScheduleModal({
  schedule,
  templates,
  saving,
  onCancel,
  onSubmit,
}: ArticleScheduleModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<ArticleScheduleFormValues>();
  const freq = Form.useWatch('freq', form) ?? ARTICLE_FREQ_VALUES[0];

  return (
    <Modal
      open
      width={560}
      title={
        schedule === null
          ? t('article.schedules.editor.createTitle')
          : t('article.schedules.editor.editTitle')
      }
      okText={t('article.schedules.editor.ok')}
      cancelText={t('common.cancel')}
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => {
        void form
          .validateFields()
          .then((values) =>
            onSubmit({
              id: schedule?.id ?? null,
              template_id: values.template_id,
              freq: values.freq,
              // 契约要的是 `HH:mm` 字面量（不做时区换算，见 `handlers/article-schedule.ts`）。
              time: values.time.format('HH:mm'),
              weekday: values.freq === 'weekly' ? values.weekday : null,
              enabled: values.enabled,
            }),
          )
          .catch(() => undefined);
      }}
    >
      <Form<ArticleScheduleFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          template_id: schedule?.template_id ?? (templates[0]?.id ?? ''),
          freq: schedule?.freq ?? ARTICLE_FREQ_VALUES[0],
          time: dayjs(schedule?.time ?? DEFAULT_TIME, 'HH:mm'),
          weekday: schedule?.weekday ?? ARTICLE_WEEKDAY_MIN,
          enabled: schedule?.enabled ?? true,
        }}
      >
        <Form.Item
          name="template_id"
          label={t('article.schedules.editor.templateLabel')}
          rules={[{ required: true, message: t('article.schedules.editor.templateRequired') }]}
        >
          <Select
            options={templates.map((row) => ({ value: row.id, label: row.name }))}
            placeholder={t('article.schedules.editor.templateLabel')}
          />
        </Form.Item>
        <Form.Item name="freq" label={t('article.schedules.editor.freqLabel')}>
          <Select
            options={ARTICLE_FREQ_VALUES.map((value) => ({
              value,
              label: enumLabel(t, 'article.freqs', value),
            }))}
          />
        </Form.Item>
        {freq === 'weekly' ? (
          <Form.Item
            name="weekday"
            label={t('article.schedules.editor.weekdayLabel')}
            rules={[{ required: true, message: t('article.schedules.editor.weekdayRequired') }]}
          >
            <Select
              options={WEEKDAYS.map((value) => ({
                value,
                label: t(WEEKDAY_KEYS[value]),
              }))}
            />
          </Form.Item>
        ) : null}
        <Form.Item name="time" label={t('article.schedules.editor.timeLabel')}>
          <TimePicker format="HH:mm" minuteStep={5} allowClear={false} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item
          name="enabled"
          label={t('article.schedules.editor.enabledLabel')}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/**
 * M6 文章管理 Article Studio：**排期 + 文章评审队列**那 4 条命令
 * （`article_schedule_list` / `_save` / `_run` / `article_list`）。
 * 方向与模板那 6 条在 `handlers/article.ts`（单文件约 400 行的软线，AGENTS「代码风格」）。
 * 设计规格 `docs/superpowers/specs/2026-10-10-kb-redesign-and-article-studio-design.md`（DR-84 … DR-89）。
 *
 * 🔴 **Rust 侧没有对应实现**（差异台账 §4g E-64 起），理由与另一半逐字相同。
 *
 * # 🔴 demo 不做的三件事（DR-85 / E-65 / E-66，界面上都有常驻说明）
 * ① **没有真 cron**：排期到点**不会**自己跑，`next_run_at` 只是按 freq + time 算出来的**显示值**；
 *   `article_schedule_run` 是"人点一下立即运行"的替身，界面上写明"演示模式不跑真实定时任务"；
 * ② **不调模型**：生成物逐字取自 `seed/articles.ts` 的 `SEED_ARTICLE_POOL`，**按标题去重**，
 *   池子用完回**空数组**而不是错误；
 * ③ **不做合规扫描**：生成物一律 `pending_review`（AGENTS 规则 6），界面上另挂免责标签。
 *
 * # 🔴 一处「一条命令两件事」（DR-87 把命令面冻在 10 条，DR-86③ 又要「批量通过」这个动作）
 * **文章评审**搭在 `article_list` 上：`review` 有值即先批量改状态、再回**快照**
 * （形状照 `kb_entry_verify`）。真后端落地时应当拆成 `article_review`（差异台账 §4g E-64）。
 * 另一半取舍（**方向归档**搭在 `article_direction_add` 上）见 `article.ts` 的头注释。
 *
 * # 语言约束（门禁 7 / §B-11）
 * 本目录非注释 CJK 必须为 0 ⇒ 字符串常量全是 ASCII；文章标题与正文逐字来自 `seed/articles.ts`。
 */
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import {
  articleScheduleById,
  articleSchedulesOf,
  articleTemplateById,
  articlesOf,
  getDemoDb,
} from '../db';
import { SEED_ARTICLE_POOL } from '../seed/articles';
import type { Article, ArticleFreq, ArticleSchedule, ArticleStatus } from '../../api/types';
import {
  ARTICLE_FREQ_VALUES,
  ARTICLE_STATUS_VALUES,
  ARTICLE_WEEKDAY_MAX,
  ARTICLE_WEEKDAY_MIN,
} from '../../api/types';
import {
  asBoolean,
  asRecord,
  asString,
  asStringList,
  newId,
  nowIso,
  requireProject,
} from './shared';

/** `HH:mm`（24 小时制）。🔴 认不出就报错，不收敛：它决定 `next_run_at` 算在哪一刻。 */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `weekday` 的契约区间串（`validation/failed` 的 `expected` 参数，语言中立 ASCII）。 */
const WEEKDAY_EXPECTED = `${ARTICLE_WEEKDAY_MIN}~${ARTICLE_WEEKDAY_MAX}`;

/**
 * 下一次运行时间：`from` **之后**最近的那一次 `HH:mm`（weekly 再对齐到 ISO 星期几）。
 *
 * 🔴 `HH:mm` 是**界面上的墙上时间**，不是 UTC。用本地时区构造候选时刻，再交给
 * `toISOString()` 存库；界面用同一个本地时区格式化回来，才不会再出现「运行时间 09:30、
 * 下次运行 17:30」。真后端接 cron 时应显式带时区（差异台账 §4g E-65 已登记“没有真 cron”，
 * 这里补的是显示口径）。
 *
 * @param weekday ISO 8601 的 1~7（7 = 周日）；`daily` 传 `null` 即可，本函数不看它。
 */
export function nextRunAt(
  from: Date,
  freq: ArticleFreq,
  time: string,
  weekday: number | null,
): string {
  const [hour, minute] = time.split(':').map((part) => Number(part));
  const candidate = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
    hour,
    minute,
    0,
    0,
  );
  if (freq === 'weekly') {
    // ISO 的 7（周日）对应 `Date.getDay()` 的 0 ⇒ 取模即得。
    const target = (weekday ?? ARTICLE_WEEKDAY_MIN) % 7;
    candidate.setDate(candidate.getDate() + ((target - candidate.getDay() + 7) % 7));
  }
  // 已经过了今天这一刻 ⇒ 顺一个周期（严格晚于 `from`："现在"不算下次运行）。
  if (candidate.getTime() <= from.getTime()) {
    candidate.setDate(candidate.getDate() + (freq === 'weekly' ? 7 : 1));
  }
  return candidate.toISOString();
}

/** 频率入参：它决定 `next_run_at` 的算法 ⇒ 认不出就报错（照 `requireChannelKind`）。 */
function requireFreq(value: unknown): ArticleFreq {
  const raw = asString(value);
  if (!(ARTICLE_FREQ_VALUES as readonly string[]).includes(raw)) {
    throw demoError('validation/failed', {
      field: 'schedule_freq',
      reason: 'not_allowed',
      value: raw,
    });
  }
  return raw as ArticleFreq;
}

/** 时间入参：`HH:mm`，认不出就报错。 */
function requireTime(value: unknown): string {
  const raw = asString(value).trim();
  if (!TIME_PATTERN.test(raw)) {
    throw demoError('validation/failed', {
      field: 'schedule_time',
      reason: 'invalid_format',
      value: raw,
    });
  }
  return raw;
}

/**
 * 星期入参：`weekly` 必填且必须在 1~7；`daily` 恒 `null`（**不报错**，照 DR-75 的 `scenario`
 * 口径——把一条日更排期误带了星期，落库时悄悄摘掉比拒整条更贴合"编辑别丢内容"）。
 */
function weekdayFor(freq: ArticleFreq, value: unknown): number | null {
  if (freq !== 'weekly') return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw demoError('validation/failed', { field: 'schedule_weekday', reason: 'required' });
  }
  if (value < ARTICLE_WEEKDAY_MIN || value > ARTICLE_WEEKDAY_MAX) {
    throw demoError('validation/failed', {
      field: 'schedule_weekday',
      reason: 'out_of_range',
      expected: WEEKDAY_EXPECTED,
      value: String(value),
    });
  }
  return value;
}

/** `article_schedule_list`：排期清单（按 `next_run_at`，停用的沉底，见 `db.ts`）。 */
export const articleScheduleList: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));
  return structuredClone(articleSchedulesOf(db, project.id));
};

/**
 * `article_schedule_save`：新建或就地改一条排期，回**那一条**。
 *
 * 🔴 demo 没有定时器（DR-85）：`enabled` 只决定 `next_run_at` 算不算得出来，到点不会自己跑。
 * 🔴 就地改时 `run_count` / `last_run_at` 取库里那份——"跑过几次"是运行的账，编辑表单改不动它
 * （同 `kb_entry_update` 不许改 `verified_at` 的理由）。
 * 🔴 一次写操作只取一个时间戳：`next_run_at` 也从它推，不另取第二个 `nowIso()`。
 */
export const articleScheduleSave: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));
  const draft = asRecord(args.schedule);

  const templateId = asString(draft.template_id).trim();
  const template = articleTemplateById(db, templateId);
  if (template === undefined || template.project_id !== project.id) {
    throw demoError('validation/failed', {
      field: 'template_id',
      reason: 'invalid_id',
      value: templateId,
    });
  }
  const freq = requireFreq(draft.freq);
  const time = requireTime(draft.time);
  const weekday = weekdayFor(freq, draft.weekday);
  const enabled = asBoolean(draft.enabled);

  const stamp = nowIso();
  const nextRun = enabled ? nextRunAt(new Date(stamp), freq, time, weekday) : null;
  const existing = articleScheduleById(db, asString(draft.id).trim());
  if (existing !== undefined && existing.project_id === project.id) {
    Object.assign(existing, {
      template_id: templateId,
      freq,
      time,
      weekday,
      enabled,
      next_run_at: nextRun,
    });
    return structuredClone(existing);
  }

  const created: ArticleSchedule = {
    id: newId(),
    project_id: project.id,
    template_id: templateId,
    freq,
    time,
    weekday,
    enabled,
    next_run_at: nextRun,
    last_run_at: null,
    run_count: 0,
  };
  db.articleSchedules.push(structuredClone(created));
  return created;
};

/**
 * `article_schedule_run`：立即跑一次。🔴 **没有真 cron，这一支是替身**（DR-85 / E-65）。
 *
 * - 给 `schedule_id` ⇒ **按排期跑**：记 `last_run_at` / `run_count` / 重算 `next_run_at`，
 *   产物 `source: 'scheduled'`；停用的排期也**能**手动跑（"立即运行"不受开关约束），但不翻 `enabled`；
 * - 给 `template_id` ⇒ 模板上的**「立即生成」**：不动任何排期的账，产物 `source: 'manual'`、
 *   `schedule_id` 为 `null`。
 *
 * 🔴 生成物逐字取自 `SEED_ARTICLE_POOL`，**按标题去重**（只跟本项目已有的文章比）；
 * 池子用完回**空数组**且**不记账**（"跑了一次却没产出"不该被记成一次运行）。
 * 🔴 一律 `pending_review`（规则 6）：demo 不做合规扫描，人工评审是唯一那道闸。
 */
export const articleScheduleRun: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));

  const scheduleId = asString(args.schedule_id).trim();
  const templateId = asString(args.template_id).trim();
  if (scheduleId === '' && templateId === '') {
    throw demoError('validation/failed', { field: 'schedule_id', reason: 'required' });
  }

  const bySchedule = scheduleId !== '';
  const schedule = bySchedule ? articleScheduleById(db, scheduleId) : undefined;
  if (bySchedule && (schedule === undefined || schedule.project_id !== project.id)) {
    throw demoError('validation/failed', {
      field: 'schedule_id',
      reason: 'invalid_id',
      value: scheduleId,
    });
  }
  const wantedTemplateId = bySchedule ? (schedule as ArticleSchedule).template_id : templateId;
  const template = articleTemplateById(db, wantedTemplateId);
  if (template === undefined || template.project_id !== project.id) {
    throw demoError('validation/failed', {
      field: 'template_id',
      reason: 'invalid_id',
      value: wantedTemplateId,
    });
  }

  const written = new Set(articlesOf(db, project.id).map((row) => row.title));
  const pick = SEED_ARTICLE_POOL.find((row) => !written.has(row.title));
  if (pick === undefined) return [];

  const stamp = nowIso();
  const created: Article = {
    id: newId(),
    project_id: project.id,
    direction_id: template.direction_id,
    template_id: template.id,
    schedule_id: bySchedule ? (schedule as ArticleSchedule).id : null,
    source: bySchedule ? 'scheduled' : 'manual',
    title: pick.title,
    body_markdown: pick.body_markdown,
    status: 'pending_review',
    word_count: pick.word_count,
    generated_at: stamp,
  };
  db.articles.push(structuredClone(created));

  if (bySchedule && schedule !== undefined) {
    schedule.last_run_at = stamp;
    schedule.run_count += 1;
    schedule.next_run_at = schedule.enabled
      ? nextRunAt(new Date(stamp), schedule.freq, schedule.time, schedule.weekday)
      : null;
  }

  return [created];
};

/**
 * `article_list`：文章评审队列（`generated_at DESC`）。
 *
 * - `status`：状态筛选。**契约外的值当没传**（不误伤成空清单，照 `site_patch` 筛选的口径）；
 * - 🔴 `review` 有值时这是一次**写操作**：先批量改状态、再回**快照**（见文件头）。
 *   认不出的 id 忽略（幂等）；空 `ids` 是 no-op；`review.status` 契约外**报错**——
 *   它是"把稿子判成哪一档"的命令动词，悄悄收敛等于替用户做了一次评审。
 */
export const articleList: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));

  if (args.review !== null && args.review !== undefined) {
    const review = asRecord(args.review);
    const status = asString(review.status);
    if (!(ARTICLE_STATUS_VALUES as readonly string[]).includes(status)) {
      throw demoError('validation/failed', {
        field: 'review_status',
        reason: 'not_allowed',
        value: status,
      });
    }
    const ids = new Set(asStringList(review.ids));
    for (const row of db.articles) {
      if (row.project_id !== project.id || !ids.has(row.id)) continue;
      row.status = status as ArticleStatus;
    }
  }

  const status = asString(args.status);
  const rows = articlesOf(db, project.id);
  const kept = (ARTICLE_STATUS_VALUES as readonly string[]).includes(status)
    ? rows.filter((row) => row.status === status)
    : rows;
  return structuredClone(kept);
};

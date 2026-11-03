/**
 * M6 文章管理（Article Studio）10 条命令的行为测试
 * （spec `2026-10-10-kb-redesign-and-article-studio-design.md` DR-84 … DR-89）。
 *
 * # 分工
 * - **界面形态**（三工作区 / 槽位插入 / 实时预览 / 评审队列）⇒ `pages/ArticleStudioPage.test.tsx`；
 * - **导出物闸门**（只有 `approved` 进 Markdown）⇒ `api/article-compose.test.ts`；
 * - **args 键名漂移** ⇒ 由页面测试经 `api/article.ts` 覆盖；
 * - 本文件管**行为**：十个命令的正/反例、排期 `run_now` 的按标题去重、生成物恒 `pending_review`。
 *
 * # 🔴 这里钉的是「demo 刻意不做的事」（AGENTS 规则 9 / 规则 6 / 规则 2）
 * ① **没有真 cron**：排期到点不会自己跑，`article_schedule_run` 是"手动触发一次"的替身；
 * ② **不调模型**：生成物逐字来自 `seed/articles.ts` 的预置文章池（按标题去重，池子用完回空数组）；
 * ③ **不做合规扫描**：生成物一律 `pending_review`，界面上另挂免责标签（规则 6 的 demo 侧对价）；
 * ④ **刷新即重置**：`resetDemoDb()` 之后一切回种子（每个用例的 `afterEach`）。
 *
 * # 🔴 两处「一条命令两件事」的取舍（DR-87 把命令面冻在 10 条，DR-86 又要求这两个动作）
 * - **方向归档**搭在 `article_direction_add` 上（带 `id` 即就地改，形状照 `competitor_upsert`）；
 * - **文章评审**搭在 `article_list` 上（带 `review` 即先改后回快照，形状照 `kb_entry_verify`）。
 * 两条都在 `handlers/article.ts` 的头注释里点名，本文件各自有用例钉住。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type {
  Article,
  ArticleDirection,
  ArticleSchedule,
  ArticleTemplate,
} from '../../api/types';
import { ARTICLE_LENGTH_MAX, ARTICLE_LENGTH_MIN, isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import {
  SEED_ARTICLES,
  SEED_ARTICLE_DIRECTIONS,
  SEED_ARTICLE_DIRECTION_POOL,
  SEED_ARTICLE_POOL,
  SEED_ARTICLE_SCHEDULES,
  SEED_ARTICLE_TEMPLATES,
} from '../seed/articles';
import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID } from '../seed/projects';

/** 把「同步 throw」与「rejected promise」两种 handler 形状收成同一个 catch（照 `site.test.ts`）。 */
async function capture(thunk: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(thunk)
    .then(
      () => null,
      (cause: unknown) => cause,
    );
}

function errorCode(cause: unknown): string | null {
  return isIpcErrorPayload(cause) ? cause.code : null;
}

function errorParams(cause: unknown): Record<string, string> | null {
  return isIpcErrorPayload(cause) ? (cause.params ?? null) : null;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const MISSING_PROJECT_ID = '00000000-0000-4000-8000-0000000000aa';
const MISSING_ROW_ID = '00000000-0000-4000-8000-0000000000bb';

const directions = (projectId = SEED_ACTIVE_PROJECT_ID) =>
  demoInvoke<ArticleDirection[]>('article_direction_list', { project_id: projectId });
const templates = (projectId = SEED_ACTIVE_PROJECT_ID) =>
  demoInvoke<ArticleTemplate[]>('article_template_list', { project_id: projectId });
const schedules = (projectId = SEED_ACTIVE_PROJECT_ID) =>
  demoInvoke<ArticleSchedule[]>('article_schedule_list', { project_id: projectId });
const articles = (args: Record<string, unknown> = {}) =>
  demoInvoke<Article[]>('article_list', { project_id: SEED_ACTIVE_PROJECT_ID, ...args });

/** 跑一次排期（`schedule_id` 那一支）。 */
const runSchedule = (scheduleId: string) =>
  demoInvoke<Article[]>('article_schedule_run', {
    project_id: SEED_ACTIVE_PROJECT_ID,
    schedule_id: scheduleId,
  });

/** 模板「立即生成」（`template_id` 那一支）。 */
const runTemplate = (templateId: string) =>
  demoInvoke<Article[]>('article_schedule_run', {
    project_id: SEED_ACTIVE_PROJECT_ID,
    template_id: templateId,
  });

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/article · article_direction_list / _add / _generate', () => {
  it('方向清单逐字来自种子，按 created_at ASC（含那条已归档的）', async () => {
    const rows = await directions();

    expect(rows).toHaveLength(SEED_ARTICLE_DIRECTIONS.length);
    expect(rows.map((row) => row.id)).toEqual(SEED_ARTICLE_DIRECTIONS.map((row) => row.id));
    expect(rows.map((row) => row.status)).toContain('archived');
    // 另一个项目一条都没有（不串项目）。
    expect(await directions(SEED_ARCHIVED_PROJECT_ID)).toEqual([]);
  });

  it('项目不存在 ⇒ project/not_found（kind 恒为契约里那个值）', async () => {
    const cause = await capture(() => directions(MISSING_PROJECT_ID));

    expect(errorCode(cause)).toBe('project/not_found');
    expect(errorParams(cause)).toEqual({ kind: 'project', id: MISSING_PROJECT_ID });
  });

  it('手动新增方向：source 固定 manual、status 固定 active，id 是 uuid v4、时间是 RFC3339', async () => {
    const created = await demoInvoke<ArticleDirection>('article_direction_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      title: '滤袋寿命与更换周期问答',
      summary: '把运维最常问的更换周期写成一篇可核验的问答。',
      // 🔴 前端自称 generated / archived 都不算数（照 `keyword_add` 的 source 口径）。
      source: 'generated',
      status: 'archived',
    });

    expect(created.id).toMatch(UUID_V4);
    expect(created.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(created.source).toBe('manual');
    expect(created.status).toBe('active');
    expect(created.created_at).toMatch(RFC3339);
    expect((await directions()).map((row) => row.id)).toContain(created.id);
  });

  it('标题空白 ⇒ validation/failed（field 是稳定记号，params 全 ASCII）', async () => {
    const cause = await capture(() =>
      demoInvoke('article_direction_add', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        title: '   ',
        summary: null,
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({ field: 'direction_title', reason: 'required' });
    expect(JSON.stringify(errorParams(cause))).not.toMatch(/[\u3000-\u303f\u4e00-\u9fa5\uff00-\uffef]/);
  });

  it('🔴 归档搭在 add 上：带 id 即就地改状态（DR-87 只有 10 条命令，没有 direction_update）', async () => {
    const target = SEED_ARTICLE_DIRECTIONS[0];

    const archived = await demoInvoke<ArticleDirection>('article_direction_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      id: target.id,
      status: 'archived',
    });

    expect(archived.id).toBe(target.id);
    expect(archived.status).toBe('archived');
    // 没传的字段保持原值（就地改，不是覆盖成空）。
    expect(archived.title).toBe(target.title);
    expect(archived.summary).toBe(target.summary);
    expect(archived.created_at).toBe(target.created_at);
    expect((await directions()).filter((row) => row.status === 'archived')).toHaveLength(2);
  });

  it('归档认不出的 id ⇒ validation/failed + reason invalid_id', async () => {
    const cause = await capture(() =>
      demoInvoke('article_direction_add', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        id: MISSING_ROW_ID,
        status: 'archived',
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'direction_id',
      reason: 'invalid_id',
      value: MISSING_ROW_ID,
    });
  });

  it('AI 生成方向：从预置池里挑，source=generated，按标题去重，池子用完回空数组', async () => {
    const first = await demoInvoke<ArticleDirection[]>('article_direction_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      target_count: 2,
    });

    expect(first).toHaveLength(2);
    expect(first.every((row) => row.source === 'generated')).toBe(true);
    expect(first.every((row) => row.status === 'active')).toBe(true);
    expect(first.map((row) => row.title)).toEqual(
      SEED_ARTICLE_DIRECTION_POOL.slice(0, 2).map((row) => row.title),
    );

    // 第二次只剩池子里最后一条（前两条标题已在库里 ⇒ 跳过）。
    const second = await demoInvoke<ArticleDirection[]>('article_direction_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      target_count: 2,
    });
    expect(second).toHaveLength(SEED_ARTICLE_DIRECTION_POOL.length - 2);

    // 池子用完 ⇒ 空数组（不是错误，照 `kb_generate` 的口径）。
    const third = await demoInvoke<ArticleDirection[]>('article_direction_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      target_count: 2,
    });
    expect(third).toEqual([]);
  });

  it('生成条数被夹进 LIBRARY_GENERATE 区间（0 ⇒ 1）', async () => {
    const rows = await demoInvoke<ArticleDirection[]>('article_direction_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      target_count: 0,
    });

    expect(rows).toHaveLength(1);
  });
});

describe('demo/handlers/article · article_template_list / _save / _delete', () => {
  it('模板清单来自种子：槽位与 kb_modules 都是契约内的值，bindings 三段齐全', async () => {
    const rows = await templates();

    expect(rows).toHaveLength(SEED_ARTICLE_TEMPLATES.length);
    expect(rows.every((row) => row.prompt_template.includes('{{'))).toBe(true);
    expect(rows.every((row) => row.slots.length > 0)).toBe(true);
    expect(rows[0].bindings.product_names.length).toBeGreaterThan(0);
    expect(rows[0].bindings.keyword_texts.length).toBeGreaterThan(0);
    expect(typeof rows[0].bindings.audience).toBe('string');
    expect(await templates(SEED_ARCHIVED_PROJECT_ID)).toEqual([]);
  });

  it('新建模板：created_at == updated_at，id 是 uuid v4，方向 id 原样落下', async () => {
    const direction = SEED_ARTICLE_DIRECTIONS[0];
    const saved = await demoInvoke<ArticleTemplate>('article_template_save', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      template: {
        direction_id: direction.id,
        name: '运维成本对照模板',
        prompt_template: '请为 {{brand}} 写一篇运维成本对照说明。',
        slots: ['brand'],
        bindings: { product_names: [], keyword_texts: [], audience: null },
        kb_modules: ['product'],
        style: '对照表体',
        length: 900,
      },
    });

    expect(saved.id).toMatch(UUID_V4);
    expect(saved.direction_id).toBe(direction.id);
    expect(saved.created_at).toBe(saved.updated_at);
    expect(saved.length).toBe(900);
    expect((await templates()).map((row) => row.id)).toContain(saved.id);
  });

  it('就地改模板：id 不变、updated_at 前推、字数被夹进契约区间', async () => {
    const target = SEED_ARTICLE_TEMPLATES[0];

    const saved = await demoInvoke<ArticleTemplate>('article_template_save', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      template: {
        id: target.id,
        direction_id: target.direction_id,
        name: '选型科普长文模板（改版）',
        prompt_template: target.prompt_template,
        slots: target.slots,
        bindings: target.bindings,
        kb_modules: target.kb_modules,
        style: target.style,
        length: 99999,
      },
    });

    expect(saved.id).toBe(target.id);
    expect(saved.name).toBe('选型科普长文模板（改版）');
    expect(saved.length).toBe(ARTICLE_LENGTH_MAX);
    expect(Date.parse(saved.updated_at)).toBeGreaterThanOrEqual(Date.parse(target.updated_at));
    expect((await templates()).filter((row) => row.id === target.id)).toHaveLength(1);

    const short = await demoInvoke<ArticleTemplate>('article_template_save', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      template: { ...target, length: 1 },
    });
    expect(short.length).toBe(ARTICLE_LENGTH_MIN);
  });

  it('名称/正文空白与认不出的方向 ⇒ validation/failed（三种 field 各不相同）', async () => {
    const blank = await capture(() =>
      demoInvoke('article_template_save', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        template: {
          direction_id: SEED_ARTICLE_DIRECTIONS[0].id,
          name: '  ',
          prompt_template: 'x',
          slots: [],
          bindings: { product_names: [], keyword_texts: [], audience: null },
          kb_modules: [],
          style: '',
          length: 800,
        },
      }),
    );
    expect(errorParams(blank)).toEqual({ field: 'template_name', reason: 'required' });

    const noPrompt = await capture(() =>
      demoInvoke('article_template_save', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        template: {
          direction_id: SEED_ARTICLE_DIRECTIONS[0].id,
          name: 'ok',
          prompt_template: '   ',
          slots: [],
          bindings: { product_names: [], keyword_texts: [], audience: null },
          kb_modules: [],
          style: '',
          length: 800,
        },
      }),
    );
    expect(errorParams(noPrompt)).toEqual({ field: 'prompt_template', reason: 'required' });

    const badDirection = await capture(() =>
      demoInvoke('article_template_save', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        template: {
          direction_id: MISSING_ROW_ID,
          name: 'ok',
          prompt_template: 'x',
          slots: [],
          bindings: { product_names: [], keyword_texts: [], audience: null },
          kb_modules: [],
          style: '',
          length: 800,
        },
      }),
    );
    expect(errorCode(badDirection)).toBe('validation/failed');
    expect(errorParams(badDirection)).toEqual({
      field: 'direction_id',
      reason: 'invalid_id',
      value: MISSING_ROW_ID,
    });
  });

  it('契约外的槽位与知识模块被丢掉（不收敛成第一个成员，也不报错）', async () => {
    const saved = await demoInvoke<ArticleTemplate>('article_template_save', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      template: {
        direction_id: SEED_ARTICLE_DIRECTIONS[0].id,
        name: '槽位白名单模板',
        prompt_template: '请为 {{brand}} 写一篇说明。',
        slots: ['brand', 'nope', 'brand'],
        bindings: { product_names: [], keyword_texts: [], audience: null },
        kb_modules: ['product', 'not_a_module'],
        style: '',
        length: 800,
      },
    });

    expect(saved.slots).toEqual(['brand']);
    expect(saved.kb_modules).toEqual(['product']);
  });

  it('删模板回剩余快照，认不出的 id 忽略（幂等），并连带删掉挂在它上面的排期', async () => {
    const target = SEED_ARTICLE_TEMPLATES[0];
    const bound = SEED_ARTICLE_SCHEDULES.filter((row) => row.template_id === target.id);
    expect(bound.length).toBeGreaterThan(0);

    const rest = await demoInvoke<ArticleTemplate[]>('article_template_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: [target.id, MISSING_ROW_ID],
    });

    expect(rest).toHaveLength(SEED_ARTICLE_TEMPLATES.length - 1);
    expect(rest.map((row) => row.id)).not.toContain(target.id);
    const left = await schedules();
    expect(left.map((row) => row.template_id)).not.toContain(target.id);
    expect(left).toHaveLength(SEED_ARTICLE_SCHEDULES.length - bound.length);
    // 🔴 已生成的文章保留（`template_id` 只是历史引用，不跟着删）。
    expect(await articles()).toHaveLength(SEED_ARTICLES.length);
  });
});

describe('demo/handlers/article · article_schedule_list / _save', () => {
  it('排期清单来自种子：启用的日更排在前，停用的周更 next_run_at 为 null', async () => {
    const rows = await schedules();

    expect(rows).toHaveLength(SEED_ARTICLE_SCHEDULES.length);
    expect(rows[0].enabled).toBe(true);
    expect(rows[0].freq).toBe('daily');
    expect(rows[0].next_run_at).toMatch(RFC3339);
    expect(rows[1].enabled).toBe(false);
    expect(rows[1].freq).toBe('weekly');
    expect(rows[1].next_run_at).toBeNull();
    expect(await schedules(SEED_ARCHIVED_PROJECT_ID)).toEqual([]);
  });

  it('新建日更排期：weekday 强制 null、启用即算出 next_run_at', async () => {
    const saved = await demoInvoke<ArticleSchedule>('article_schedule_save', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      schedule: {
        template_id: SEED_ARTICLE_TEMPLATES[2].id,
        freq: 'daily',
        time: '08:15',
        // 🔴 daily 传了 weekday 也强制置 null（照 DR-75 的 scenario 口径：不报错，避免误伤）。
        weekday: 5,
        enabled: true,
      },
    });

    expect(saved.id).toMatch(UUID_V4);
    expect(saved.weekday).toBeNull();
    expect(saved.enabled).toBe(true);
    expect(saved.run_count).toBe(0);
    expect(saved.last_run_at).toBeNull();
    expect(saved.next_run_at).toMatch(RFC3339);
    // `HH:mm` 是用户看到的墙上时间；落库的 UTC 串必须按**本地时区**换算后再显示回 08:15。
    expect(
      new Date(saved.next_run_at as string).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    ).toBe('08:15');
  });

  it('新建周更排期：weekday 必填，缺失/越界各发一条 validation/failed', async () => {
    const missing = await capture(() =>
      demoInvoke('article_schedule_save', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        schedule: {
          template_id: SEED_ARTICLE_TEMPLATES[2].id,
          freq: 'weekly',
          time: '08:15',
          weekday: null,
          enabled: true,
        },
      }),
    );
    expect(errorParams(missing)).toEqual({ field: 'schedule_weekday', reason: 'required' });

    const outOfRange = await capture(() =>
      demoInvoke('article_schedule_save', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        schedule: {
          template_id: SEED_ARTICLE_TEMPLATES[2].id,
          freq: 'weekly',
          time: '08:15',
          weekday: 9,
          enabled: true,
        },
      }),
    );
    expect(errorParams(outOfRange)).toEqual({
      expected: '1~7',
      field: 'schedule_weekday',
      reason: 'out_of_range',
      value: '9',
    });

    const ok = await demoInvoke<ArticleSchedule>('article_schedule_save', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      schedule: {
        template_id: SEED_ARTICLE_TEMPLATES[2].id,
        freq: 'weekly',
        time: '08:15',
        weekday: 3,
        enabled: true,
      },
    });
    expect(ok.weekday).toBe(3);
  });

  it('时间格式与频率白名单：认不出就报错，不收敛（照 site.ts 的 requireChannelKind）', async () => {
    const badTime = await capture(() =>
      demoInvoke('article_schedule_save', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        schedule: {
          template_id: SEED_ARTICLE_TEMPLATES[0].id,
          freq: 'daily',
          time: '25:00',
          weekday: null,
          enabled: true,
        },
      }),
    );
    expect(errorParams(badTime)).toEqual({
      field: 'schedule_time',
      reason: 'invalid_format',
      value: '25:00',
    });

    const badFreq = await capture(() =>
      demoInvoke('article_schedule_save', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        schedule: {
          template_id: SEED_ARTICLE_TEMPLATES[0].id,
          freq: 'monthly',
          time: '08:15',
          weekday: null,
          enabled: true,
        },
      }),
    );
    expect(errorParams(badFreq)).toEqual({
      field: 'schedule_freq',
      reason: 'not_allowed',
      value: 'monthly',
    });

    const badTemplate = await capture(() =>
      demoInvoke('article_schedule_save', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        schedule: {
          template_id: MISSING_ROW_ID,
          freq: 'daily',
          time: '08:15',
          weekday: null,
          enabled: true,
        },
      }),
    );
    expect(errorParams(badTemplate)).toEqual({
      field: 'template_id',
      reason: 'invalid_id',
      value: MISSING_ROW_ID,
    });
  });

  it('就地改排期：关掉开关 ⇒ next_run_at 清空；再打开 ⇒ 重新算出来', async () => {
    const target = SEED_ARTICLE_SCHEDULES[0];

    const off = await demoInvoke<ArticleSchedule>('article_schedule_save', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      schedule: { ...target, enabled: false },
    });
    expect(off.id).toBe(target.id);
    expect(off.enabled).toBe(false);
    expect(off.next_run_at).toBeNull();

    const on = await demoInvoke<ArticleSchedule>('article_schedule_save', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      schedule: { ...target, enabled: true },
    });
    expect(on.enabled).toBe(true);
    expect(on.next_run_at).toMatch(RFC3339);
    // 停机期间不该有"跑过"的账。
    expect(on.run_count).toBe(target.run_count);
  });
});

describe('demo/handlers/article · article_schedule_run（🔴 没有真 cron，这一支是替身）', () => {
  it('按排期跑一次：新增 1 篇 pending_review、source=scheduled，并记 last_run_at / run_count', async () => {
    const schedule = SEED_ARTICLE_SCHEDULES[0];
    const template = SEED_ARTICLE_TEMPLATES.find((row) => row.id === schedule.template_id);

    const created = await runSchedule(schedule.id);

    expect(created).toHaveLength(1);
    const row = created[0];
    expect(row.id).toMatch(UUID_V4);
    expect(row.status).toBe('pending_review');
    expect(row.source).toBe('scheduled');
    expect(row.schedule_id).toBe(schedule.id);
    expect(row.template_id).toBe(schedule.template_id);
    expect(row.direction_id).toBe(template?.direction_id);
    expect(row.generated_at).toMatch(RFC3339);
    // 🔴 逐字来自预置池（规则 9：不调模型），字数也是池子里的静态值。
    const used = SEED_ARTICLE_POOL.filter(
      (item) => !SEED_ARTICLES.some((seed) => seed.title === item.title),
    );
    expect(row.title).toBe(used[0].title);
    expect(row.body_markdown).toBe(used[0].body_markdown);
    expect(row.word_count).toBe(used[0].word_count);

    const after = (await schedules()).find((item) => item.id === schedule.id);
    expect(after?.run_count).toBe(schedule.run_count + 1);
    expect(after?.last_run_at).toMatch(RFC3339);
    expect((await articles()).map((item) => item.id)).toContain(row.id);
  });

  it('🔴 按标题去重：连着跑把池子跑空，之后回空数组（不再新增、也不再记账）', async () => {
    const schedule = SEED_ARTICLE_SCHEDULES[0];
    const available = SEED_ARTICLE_POOL.filter(
      (item) => !SEED_ARTICLES.some((seed) => seed.title === item.title),
    ).length;
    expect(available).toBeGreaterThan(1);

    const titles: string[] = [];
    for (let index = 0; index < available; index += 1) {
      const created = await runSchedule(schedule.id);
      expect(created, `第 ${index + 1} 次运行`).toHaveLength(1);
      titles.push(created[0].title);
    }
    expect(new Set(titles).size).toBe(available);

    const exhausted = await runSchedule(schedule.id);
    expect(exhausted).toEqual([]);
    expect((await articles()).filter((row) => row.status === 'pending_review')).toHaveLength(
      SEED_ARTICLES.filter((row) => row.status === 'pending_review').length + available,
    );
  });

  it('模板「立即生成」：source=manual、schedule_id 为 null，且不动排期的账', async () => {
    const template = SEED_ARTICLE_TEMPLATES[1];
    const schedule = SEED_ARTICLE_SCHEDULES[0];

    const created = await runTemplate(template.id);

    expect(created).toHaveLength(1);
    expect(created[0].source).toBe('manual');
    expect(created[0].schedule_id).toBeNull();
    expect(created[0].template_id).toBe(template.id);
    expect(created[0].status).toBe('pending_review');
    const after = (await schedules()).find((row) => row.id === schedule.id);
    expect(after?.run_count).toBe(schedule.run_count);
  });

  it('两个 id 都不给 / 给认不出的 id ⇒ validation/failed', async () => {
    const neither = await capture(() =>
      demoInvoke('article_schedule_run', { project_id: SEED_ACTIVE_PROJECT_ID }),
    );
    expect(errorParams(neither)).toEqual({ field: 'schedule_id', reason: 'required' });

    const badSchedule = await capture(() => runSchedule(MISSING_ROW_ID));
    expect(errorParams(badSchedule)).toEqual({
      field: 'schedule_id',
      reason: 'invalid_id',
      value: MISSING_ROW_ID,
    });

    const badTemplate = await capture(() => runTemplate(MISSING_ROW_ID));
    expect(errorParams(badTemplate)).toEqual({
      field: 'template_id',
      reason: 'invalid_id',
      value: MISSING_ROW_ID,
    });
  });

  it('停用的排期也能手动跑一次（「立即运行」不受开关约束），但不改 enabled', async () => {
    const disabled = SEED_ARTICLE_SCHEDULES[1];
    expect(disabled.enabled).toBe(false);

    const created = await runSchedule(disabled.id);

    expect(created).toHaveLength(1);
    const after = (await schedules()).find((row) => row.id === disabled.id);
    expect(after?.enabled).toBe(false);
    expect(after?.run_count).toBe(disabled.run_count + 1);
  });
});

describe('demo/handlers/article · article_list（含搭在这条上的评审写路径）', () => {
  it('文章清单按 generated_at DESC，逐字来自种子；别的项目一条都没有', async () => {
    const rows = await articles();

    expect(rows).toHaveLength(SEED_ARTICLES.length);
    for (let index = 1; index < rows.length; index += 1) {
      expect(Date.parse(rows[index - 1].generated_at)).toBeGreaterThanOrEqual(
        Date.parse(rows[index].generated_at),
      );
    }
    expect(
      await demoInvoke<Article[]>('article_list', { project_id: SEED_ARCHIVED_PROJECT_ID }),
    ).toEqual([]);
  });

  it('状态筛选只收契约内的值，认不出的值当没传（不误伤成空清单）', async () => {
    const pending = await articles({ status: 'pending_review' });
    expect(pending).toHaveLength(SEED_ARTICLES.filter((row) => row.status === 'pending_review').length);
    expect(pending.every((row) => row.status === 'pending_review')).toBe(true);

    const all = await articles({ status: 'all' });
    expect(all).toHaveLength(SEED_ARTICLES.length);
    const bogus = await articles({ status: 'published' });
    expect(bogus).toHaveLength(SEED_ARTICLES.length);
  });

  it('🔴 批量通过搭在 article_list 上：先改后回快照（DR-87 没有 article_update 这条命令）', async () => {
    const pending = SEED_ARTICLES.filter((row) => row.status === 'pending_review');
    expect(pending).toHaveLength(2);

    const snapshot = await articles({
      review: { ids: pending.map((row) => row.id), status: 'approved' },
    });

    expect(snapshot).toHaveLength(SEED_ARTICLES.length);
    expect(snapshot.filter((row) => row.status === 'approved')).toHaveLength(
      SEED_ARTICLES.filter((row) => row.status === 'approved').length + 2,
    );
    // 库里真的改了（不是只改了返回值）。
    expect(getDemoDb().articles.filter((row) => row.status === 'approved')).toHaveLength(
      SEED_ARTICLES.filter((row) => row.status === 'approved').length + 2,
    );
  });

  it('评审打回同样走这一支；认不出的 id 忽略（幂等），空 ids 是 no-op', async () => {
    const target = SEED_ARTICLES.find((row) => row.status === 'pending_review');

    const rejected = await articles({
      review: { ids: [target!.id, MISSING_ROW_ID], status: 'rejected' },
    });
    expect(rejected.find((row) => row.id === target!.id)?.status).toBe('rejected');

    const noop = await articles({ review: { ids: [], status: 'approved' } });
    expect(noop).toHaveLength(SEED_ARTICLES.length);
    expect(noop.find((row) => row.id === target!.id)?.status).toBe('rejected');
  });

  it('🔴 生成物一律 pending_review：跑一次之后没有任何一篇直接是 approved（规则 6）', async () => {
    await runSchedule(SEED_ARTICLE_SCHEDULES[0].id);

    const created = (await articles()).filter(
      (row) => !SEED_ARTICLES.some((seed) => seed.id === row.id),
    );
    expect(created).toHaveLength(1);
    expect(created.every((row) => row.status === 'pending_review')).toBe(true);
  });

  it('刷新即重置：resetDemoDb() 之后一切回种子', async () => {
    await runSchedule(SEED_ARTICLE_SCHEDULES[0].id);
    expect(await articles()).toHaveLength(SEED_ARTICLES.length + 1);

    resetDemoDb();

    expect(await articles()).toHaveLength(SEED_ARTICLES.length);
    expect(await directions()).toHaveLength(SEED_ARTICLE_DIRECTIONS.length);
    expect(await templates()).toHaveLength(SEED_ARTICLE_TEMPLATES.length);
    expect(await schedules()).toHaveLength(SEED_ARTICLE_SCHEDULES.length);
  });
});

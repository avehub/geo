/**
 * M1.5 `faq_*` 5 条命令的行为测试（spec `2026-09-30-keyword-faq-library-design.md` §6 / §7）。
 *
 * 分工与「demo 刻意不做的事」四条与 `keyword.test.ts` 逐字同族，这里只写 FAQ 特有的：
 * - 答案是 **Markdown 原文**，handler 不解析、不渲染、不做长度截断（规则 9）；
 * - `category` 是**自由文本**（数据，不是枚举）⇒ 空白收成 `null`，不做归类；
 * - 生成的问答一律 `pending_review`，界面上另挂「演示模式未执行合规扫描」（规则 6）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { FaqItem } from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { resetDemoDb } from '../db';
import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID } from '../seed/projects';
import { SEED_FAQS, SEED_FAQ_GENERATED_POOL } from '../seed/faqs';

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
  return isIpcErrorPayload(cause) ? cause.params ?? null : null;
}

async function list(projectId: string = SEED_ACTIVE_PROJECT_ID): Promise<FaqItem[]> {
  return demoInvoke<FaqItem[]>('faq_list', { project_id: projectId });
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/faq · faq_list', () => {
  it('回该项目全部问答，按 position 升序；答案原文逐字来自种子', async () => {
    const rows = await list();

    expect(rows).toHaveLength(SEED_FAQS.length);
    expect(rows.map((row) => row.position)).toEqual(rows.map((_, index) => index));
    expect(rows.map((row) => row.answer_markdown)).toEqual(
      SEED_FAQS.map((row) => row.answer_markdown),
    );
  });

  it('项目不存在 ⇒ project/not_found；归档项目 ⇒ 空数组', async () => {
    const cause = await capture(() => list('no-such-project'));
    expect(errorCode(cause)).toBe('project/not_found');
    expect(await list(SEED_ARCHIVED_PROJECT_ID)).toEqual([]);
  });
});

describe('demo/handlers/faq · faq_add（手动录入）', () => {
  it('问答成对入库：source 固定 manual、status 是 approved、分类空白收成 null', async () => {
    const added = await demoInvoke<FaqItem[]>('faq_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      drafts: [
        {
          question: ' 除尘器可以异地搬迁吗？ ',
          answer_markdown: '可以，但要重新做基础与管道对接，搬迁前记录清灰时序。',
          category: '   ',
          intent: 'after_sales_reputation',
        },
      ],
    });

    expect(added).toHaveLength(1);
    expect(added[0].question).toBe('除尘器可以异地搬迁吗？');
    expect(added[0].category).toBeNull();
    expect(added[0].source).toBe('manual');
    expect(added[0].status).toBe('approved');
    expect(added[0].position).toBe(SEED_FAQS.length);
    expect(added[0].id).toMatch(UUID_V4);
    expect(added[0].created_at).toMatch(RFC3339);
    expect(added[0].updated_at).toBe(added[0].created_at);

    expect(await list()).toHaveLength(SEED_FAQS.length + 1);
  });

  it('问题为空白 ⇒ validation/failed { field: question, reason: required }', async () => {
    const cause = await capture(() =>
      demoInvoke('faq_add', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        drafts: [{ question: '  ', answer_markdown: '有答案', intent: 'pricing_plan' }],
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({ field: 'question', reason: 'required' });
  });

  it('答案为空白 ⇒ validation/failed { field: answer_markdown, reason: required }', async () => {
    const cause = await capture(() =>
      demoInvoke('faq_add', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        drafts: [{ question: '有答案吗？', answer_markdown: '', intent: 'pricing_plan' }],
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({ field: 'answer_markdown', reason: 'required' });
  });

  it('空 drafts ⇒ validation/failed { field: drafts, reason: required }', async () => {
    const cause = await capture(() =>
      demoInvoke('faq_add', { project_id: SEED_ACTIVE_PROJECT_ID, drafts: [] }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({ field: 'drafts', reason: 'required' });
  });
});

describe('demo/handlers/faq · faq_update', () => {
  it('可改问题/答案/分类/意图/状态；🔴 project_id / position / created_at / source 保留', async () => {
    const target = SEED_FAQS[3];
    expect(target.source).toBe('generated');

    const updated = await demoInvoke<FaqItem>('faq_update', {
      item: {
        ...target,
        project_id: SEED_ARCHIVED_PROJECT_ID,
        position: 42,
        created_at: '2020-01-01T00:00:00Z',
        source: 'manual',
        question: '环保验收要准备哪些材料？',
        answer_markdown: '改过的答案',
        category: '合规',
        status: 'approved',
      },
    });

    expect(updated.id).toBe(target.id);
    expect(updated.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(updated.position).toBe(target.position);
    expect(updated.created_at).toBe(target.created_at);
    expect(updated.source).toBe('generated');
    expect(updated.question).toBe('环保验收要准备哪些材料？');
    expect(updated.answer_markdown).toBe('改过的答案');
    expect(updated.category).toBe('合规');
    expect(updated.status).toBe('approved');
    expect(updated.updated_at).toMatch(RFC3339);
  });

  it('🔴 空白问题 / 空白答案与 faq_add 同构：validation/failed', async () => {
    const target = SEED_FAQS[0];
    const before = await list();

    const blankQuestion = await capture(() =>
      demoInvoke('faq_update', { item: { ...target, question: '   ' } }),
    );
    expect(errorCode(blankQuestion)).toBe('validation/failed');
    expect(errorParams(blankQuestion)).toEqual({ field: 'question', reason: 'required' });

    const blankAnswer = await capture(() =>
      demoInvoke('faq_update', { item: { ...target, answer_markdown: '\n  ' } }),
    );
    expect(errorCode(blankAnswer)).toBe('validation/failed');
    expect(errorParams(blankAnswer)).toEqual({ field: 'answer_markdown', reason: 'required' });

    expect(await list()).toEqual(before);
  });

  it('id 认不出 ⇒ validation/failed { field: faq_id, reason: invalid_id, value }', async () => {
    const cause = await capture(() =>
      demoInvoke('faq_update', { item: { ...SEED_FAQS[0], id: 'no-such-faq' } }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'faq_id',
      reason: 'invalid_id',
      value: 'no-such-faq',
    });
  });
});

describe('demo/handlers/faq · faq_delete', () => {
  it('回剩余快照并重排 position；幂等；允许删空', async () => {
    const remaining = await demoInvoke<FaqItem[]>('faq_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: [SEED_FAQS[1].id, 'no-such-faq'],
    });

    expect(remaining).toHaveLength(SEED_FAQS.length - 1);
    expect(remaining.map((row) => row.position)).toEqual(remaining.map((_, index) => index));

    const emptied = await demoInvoke<FaqItem[]>('faq_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: remaining.map((row) => row.id),
    });
    expect(emptied).toEqual([]);
  });
});

describe('demo/handlers/faq · faq_generate（🔴 预置批次，不调模型）', () => {
  it('按 intents 从预置池里挑，产物一律 generated + pending_review', async () => {
    const generated = await demoInvoke<FaqItem[]>('faq_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      // 这两类在预置池里合起来有 4 行（`purchase_recommendation` 2 + `after_sales_reputation` 2），
      // 所以要 3 条挑得满；`pricing_plan` / `local_service` 各只有 1 行，用来验"挑不满就少给"。
      options: { intents: ['purchase_recommendation', 'after_sales_reputation'], target_count: 3 },
    });

    const poolQuestions = SEED_FAQ_GENERATED_POOL.filter(
      (row) => row.intent === 'purchase_recommendation' || row.intent === 'after_sales_reputation',
    ).map((row) => row.question);
    expect(generated.map((row) => row.question)).toEqual(poolQuestions.slice(0, 3));
    expect(generated.every((row) => row.source === 'generated')).toBe(true);
    expect(generated.every((row) => row.status === 'pending_review')).toBe(true);
    expect(generated.every((row) => row.answer_markdown !== '')).toBe(true);

    expect(await list()).toHaveLength(SEED_FAQS.length + 3);
  });

  it('intents 为空（或全是契约外的值）⇒ validation/failed { field: intents, reason: required }', async () => {
    const empty = await capture(() =>
      demoInvoke('faq_generate', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        options: { intents: [], target_count: 3 },
      }),
    );
    expect(errorCode(empty)).toBe('validation/failed');
    expect(errorParams(empty)).toEqual({ field: 'intents', reason: 'required' });

    const bogus = await capture(() =>
      demoInvoke('faq_generate', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        options: { intents: ['not_an_intent'], target_count: 3 },
      }),
    );
    expect(errorCode(bogus)).toBe('validation/failed');
  });

  it('重复生成不会入库两份同问题的问答（等值判断，不是相似度去重）', async () => {
    await demoInvoke('faq_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { intents: ['professional_long_tail'], target_count: 2 },
    });
    const second = await demoInvoke<FaqItem[]>('faq_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { intents: ['professional_long_tail'], target_count: 2 },
    });

    const rows = await list();
    const questions = rows.map((row) => row.question);
    expect(new Set(questions).size).toBe(questions.length);
    expect(second.length).toBeLessThanOrEqual(2);
  });

  it('规则 6：生成产物永远不会是 approved', async () => {
    const generated = await demoInvoke<FaqItem[]>('faq_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { intents: ['purchase_recommendation'], target_count: 2, status: 'approved' },
    });

    expect(generated.every((row) => row.status === 'pending_review')).toBe(true);
  });
});

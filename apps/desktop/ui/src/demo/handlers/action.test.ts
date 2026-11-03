/**
 * M6 `action_*` / `content_*` 4 条命令的行为测试。
 *
 * # 分工
 * - **错误 params 的精确键集** ⇒ `error-contract.test.ts`。
 * - **args 键名漂移** ⇒ 由 `pages/ActionPage` 的测试经 `api/action.ts` 覆盖。
 * - **种子自洽**（归因四个数 == 两轮 overview、`quick_win` ≥3、`evidence_issue_ids` 指向真存在的
 *   核查问题）⇒ `demo/seed.test.ts`。
 * - 本文件管**行为**：看板形状、处方状态机、文稿生成的产物形态与合规默认值。
 *
 * # 🔴 这里钉的是「demo 刻意不做的事」（AGENTS 规则 9 / 规则 6）
 * ① `content_generate` **不调模型**：标题与正文逐字取自 `seed/contents.ts`，按模板种类选；
 * ② 新文稿一律 `pending_review` + `compliance_checked: false`——demo 没有合规扫描器，
 *    写成 `true` 就是假声明；
 * ③ 翻处方状态**不动归因数字**（归因要靠复测轮的数据，而 demo 的复测轮是种子）；
 * ④ `content_update_status` 的 `note` 收下来但**不进 DTO**（`GeneratedContent` 没有备注字段）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { ActionBoard, ActionItem, GeneratedContent } from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID } from '../seed/projects';
import {
  SEED_ACTIONS,
  SEED_ATTRIBUTION_CARDS,
  SEED_CONTENT_TEMPLATES,
} from '../seed/actions';
import { SEED_CONTENT_BODIES, SEED_CONTENT_TITLES, SEED_GENERATED_CONTENTS } from '../seed/contents';

/** 把「同步 throw」与「rejected promise」两种形状收成同一个 catch。 */
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

function errorParams(cause: unknown): unknown {
  return isIpcErrorPayload(cause) ? cause.params : null;
}

/** 种子里的 Top 10 处方：第 6 条是 `todo`（用来走查"翻成已完成"），第 1 条是 `done`。 */
const TODO_ACTION_ID = 'demo-act-006';
const DONE_ACTION_ID = 'demo-act-001';
const GLOSSARY_TEMPLATE_ID = 'demo-tpl-glossary-page';
const CSV_TEMPLATE_ID = 'demo-tpl-comparison-table';

async function boardOf(projectId: string): Promise<ActionBoard> {
  return demoInvoke<ActionBoard>('action_board', { project_id: projectId });
}

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/action · action_board', () => {
  it('一次往返拿全四块：处方按 rank 升序、文稿按创建时间倒序、归因与模板目录逐字来自种子', async () => {
    const board = await boardOf(SEED_ACTIVE_PROJECT_ID);

    expect(board.actions.map((action) => action.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(board.actions).toEqual(
      [...SEED_ACTIONS].sort((left, right) => left.rank - right.rank),
    );
    expect(board.attribution).toEqual(SEED_ATTRIBUTION_CARDS);
    expect(board.templates).toEqual(SEED_CONTENT_TEMPLATES);
    // 种子里两份文稿：09-26 的待审在前、09-25 的已通过在后。
    expect(board.contents.map((content) => content.id)).toEqual([
      'demo-content-001',
      'demo-content-002',
    ]);
    expect(board.contents).toEqual(SEED_GENERATED_CONTENTS);
  });

  it('没有行动数据的项目：三块为空，但模板目录照旧给全（目录是产品能力，不是项目数据）', async () => {
    const board = await boardOf(SEED_ARCHIVED_PROJECT_ID);

    expect(board.actions).toEqual([]);
    expect(board.attribution).toEqual([]);
    expect(board.contents).toEqual([]);
    expect(board.templates).toEqual(SEED_CONTENT_TEMPLATES);
  });

  it('项目 id 认不出 ⇒ project/not_found（不是 validation/failed）', async () => {
    const cause = await capture(() => demoInvoke('action_board', { project_id: 'nope' }));

    expect(errorCode(cause)).toBe('project/not_found');
  });
});

describe('demo/handlers/action · action_update_status', () => {
  it('翻成 done ⇒ 盖 completed_at 并刷新 updated_at', async () => {
    const before = SEED_ACTIONS.find((action) => action.id === TODO_ACTION_ID);
    expect(before?.status).toBe('todo');
    expect(before?.completed_at).toBeNull();

    const done = await demoInvoke<ActionItem>('action_update_status', {
      action_id: TODO_ACTION_ID,
      status: 'done',
    });

    expect(done.status).toBe('done');
    expect(done.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(done.updated_at).toBe(done.completed_at);
    expect(getDemoDb().actions.find((action) => action.id === TODO_ACTION_ID)).toEqual(done);
  });

  it('重复点"完成"不把完成时间推后（`completed_at ??=`）', async () => {
    const first = await demoInvoke<ActionItem>('action_update_status', {
      action_id: TODO_ACTION_ID,
      status: 'done',
    });
    const second = await demoInvoke<ActionItem>('action_update_status', {
      action_id: TODO_ACTION_ID,
      status: 'done',
    });

    expect(second.completed_at).toBe(first.completed_at);
  });

  it('翻回 todo / in_progress ⇒ 清掉 completed_at', async () => {
    for (const status of ['todo', 'in_progress'] as const) {
      const reopened = await demoInvoke<ActionItem>('action_update_status', {
        action_id: DONE_ACTION_ID,
        status,
      });

      expect(reopened.status).toBe(status);
      expect(reopened.completed_at).toBeNull();
      // 种子里这条原本带着 2026-09-19 的完成时间 ⇒ 确实被清掉了。
      expect(SEED_ACTIONS.find((action) => action.id === DONE_ACTION_ID)?.completed_at).not.toBeNull();
    }
  });

  it('契约外的状态收敛成 todo（最保守：不声称已经做完）', async () => {
    const action = await demoInvoke<ActionItem>('action_update_status', {
      action_id: DONE_ACTION_ID,
      status: 'shipped',
    });

    expect(action.status).toBe('todo');
    expect(action.completed_at).toBeNull();
  });

  it('🔴 翻状态不重排处方、不动归因数字（demo 不做排序算法）', async () => {
    const before = await boardOf(SEED_ACTIVE_PROJECT_ID);
    for (const action of SEED_ACTIONS) {
      await demoInvoke('action_update_status', { action_id: action.id, status: 'done' });
    }
    const after = await boardOf(SEED_ACTIVE_PROJECT_ID);

    expect(after.actions.map((action) => action.id)).toEqual(
      before.actions.map((action) => action.id),
    );
    expect(after.actions.every((action) => action.status === 'done')).toBe(true);
    expect(after.attribution).toEqual(before.attribution);
    expect(after.attribution[0].metrics).toEqual(SEED_ATTRIBUTION_CARDS[0].metrics);
  });

  it('处方 id 认不出 ⇒ validation/failed + field=action_id', async () => {
    const cause = await capture(() =>
      demoInvoke('action_update_status', { action_id: 'nope', status: 'done' }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'action_id',
      reason: 'invalid_id',
      value: 'nope',
    });
  });
});

describe('demo/handlers/action · content_generate（不调模型，端预置演示文稿）', () => {
  it('🔴 产物一律 pending_review + compliance_checked=false（规则 6：demo 没有合规扫描器）', async () => {
    const content = await demoInvoke<GeneratedContent>('content_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      template_id: GLOSSARY_TEMPLATE_ID,
    });

    expect(content.status).toBe('pending_review');
    expect(content.compliance_checked).toBe(false);
    expect(content.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(content.updated_at).toBe(content.created_at);
    expect(content.action_id).toBeNull();
    expect(content.id).not.toBe('demo-content-001');
    expect(content.id).not.toBe('demo-content-002');
  });

  it('标题与正文按模板种类逐字取自种子；导出格式随模板走', async () => {
    const glossary = await demoInvoke<GeneratedContent>('content_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      template_id: GLOSSARY_TEMPLATE_ID,
    });
    expect(glossary.title).toBe(SEED_CONTENT_TITLES.glossary_page);
    expect(glossary.body_markdown).toBe(SEED_CONTENT_BODIES.glossary_page);
    expect(glossary.export_formats).toEqual(['markdown', 'html', 'docx']);

    const table = await demoInvoke<GeneratedContent>('content_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      template_id: CSV_TEMPLATE_ID,
    });
    expect(table.title).toBe(SEED_CONTENT_TITLES.comparison_table);
    // 对比表这类产物导 CSV，不导 docx（与模板目录一致）。
    expect(table.export_formats).toEqual(['markdown', 'html', 'csv']);
  });

  it('带 action_id 时把文稿挂回那条处方，并出现在看板最前面', async () => {
    const content = await demoInvoke<GeneratedContent>('content_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      template_id: GLOSSARY_TEMPLATE_ID,
      action_id: TODO_ACTION_ID,
    });
    expect(content.action_id).toBe(TODO_ACTION_ID);

    const board = await boardOf(SEED_ACTIVE_PROJECT_ID);
    expect(board.contents).toHaveLength(SEED_GENERATED_CONTENTS.length + 1);
    expect(board.contents[0].id).toBe(content.id);
    expect(getDemoDb().contents.some((entry) => entry.id === content.id)).toBe(true);
  });

  it('模板 id 认不出 ⇒ validation/failed + field=template_id；处方 id 认不出同理', async () => {
    const badTemplate = await capture(() =>
      demoInvoke('content_generate', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        template_id: 'nope',
      }),
    );
    expect(errorCode(badTemplate)).toBe('validation/failed');
    expect(errorParams(badTemplate)).toEqual({
      field: 'template_id',
      reason: 'invalid_id',
      value: 'nope',
    });

    // 不静默丢弃：那会让"挂到哪条处方"变成猜。
    const badAction = await capture(() =>
      demoInvoke('content_generate', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        template_id: GLOSSARY_TEMPLATE_ID,
        action_id: 'nope',
      }),
    );
    expect(errorCode(badAction)).toBe('validation/failed');
    expect(errorParams(badAction)).toEqual({
      field: 'action_id',
      reason: 'invalid_id',
      value: 'nope',
    });
    // 两次都没落库。
    expect(getDemoDb().contents).toHaveLength(SEED_GENERATED_CONTENTS.length);
  });

  it('🔴 action_id 属于别的项目 ⇒ validation/failed invalid_id（不把 A 的处方挂到 B 上）', async () => {
    const cause = await capture(() =>
      demoInvoke('content_generate', {
        project_id: SEED_ARCHIVED_PROJECT_ID,
        template_id: GLOSSARY_TEMPLATE_ID,
        action_id: TODO_ACTION_ID,
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'action_id',
      reason: 'invalid_id',
      value: TODO_ACTION_ID,
    });
    expect(getDemoDb().contents).toHaveLength(SEED_GENERATED_CONTENTS.length);
  });

  it('项目 id 认不出 ⇒ project/not_found', async () => {
    const cause = await capture(() =>
      demoInvoke('content_generate', { project_id: 'nope', template_id: GLOSSARY_TEMPLATE_ID }),
    );

    expect(errorCode(cause)).toBe('project/not_found');
  });
});

describe('demo/handlers/action · content_update_status（人工审核）', () => {
  it('通过 / 退回 / 打回待审都只翻状态并刷新 updated_at', async () => {
    for (const status of ['approved', 'rejected', 'pending_review'] as const) {
      const updated = await demoInvoke<GeneratedContent>('content_update_status', {
        content_id: 'demo-content-001',
        status,
      });

      expect(updated.status).toBe(status);
      expect(updated.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      // 正文与创建时间不动（demo 里文稿不可编辑）。
      expect(updated.body_markdown).toBe(SEED_CONTENT_BODIES.glossary_page);
      expect(updated.created_at).toBe('2026-09-26T08:00:00Z');
    }
  });

  it('契约外的状态收敛成 pending_review（规则 6：默认待人工审核）', async () => {
    const updated = await demoInvoke<GeneratedContent>('content_update_status', {
      content_id: 'demo-content-002',
      status: 'published',
    });

    expect(updated.status).toBe('pending_review');
    // 种子里这条原本是 approved ⇒ 收敛把已通过的文稿打回待审，方向是保守的那一侧。
    expect(SEED_GENERATED_CONTENTS.find((entry) => entry.id === 'demo-content-002')?.status).toBe(
      'approved',
    );
  });

  it('🔴 note 收下来但不进 DTO（`GeneratedContent` 没有备注字段，凭空加就是造契约）', async () => {
    const updated = await demoInvoke<GeneratedContent>('content_update_status', {
      content_id: 'demo-content-001',
      status: 'rejected',
      note: 'quote needs a source',
    });

    expect(Object.keys(updated).sort()).toEqual(
      Object.keys(SEED_GENERATED_CONTENTS[0]).sort(),
    );
    expect('note' in updated).toBe(false);
  });

  it('🔴 审核不补合规扫描：compliance_checked 保持原值', async () => {
    const generated = await demoInvoke<GeneratedContent>('content_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      template_id: GLOSSARY_TEMPLATE_ID,
    });
    expect(generated.compliance_checked).toBe(false);

    const approved = await demoInvoke<GeneratedContent>('content_update_status', {
      content_id: generated.id,
      status: 'approved',
    });
    expect(approved.status).toBe('approved');
    expect(approved.compliance_checked).toBe(false);

    // 种子里那两份"已经生成过"的文稿是 true（代表真后端扫过之后的样子）。
    expect(SEED_GENERATED_CONTENTS.every((entry) => entry.compliance_checked)).toBe(true);
  });

  it('文稿 id 认不出 ⇒ validation/failed + field=content_id', async () => {
    const cause = await capture(() =>
      demoInvoke('content_update_status', { content_id: 'nope', status: 'approved' }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'content_id',
      reason: 'invalid_id',
      value: 'nope',
    });
  });
});

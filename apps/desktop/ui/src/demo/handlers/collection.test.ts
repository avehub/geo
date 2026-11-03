/**
 * M3 `collection_*` 6 条命令的行为测试。
 *
 * # 分工（照 `project.test.ts` 的口径，别把同一件事钉三遍）
 * - **错误 params 的精确键集** ⇒ `error-contract.test.ts`；本文件只点 `code` 与关键 `params.field`。
 * - **args 键名漂移** ⇒ 由页面测试经 `api/collection.ts` 的具名导出走真实分派覆盖。
 * - 本文件管**行为**：看板形状、排队轮次的算术、重跑链路的幂等、筛选与详情。
 *
 * # 🔴 这里钉的是「demo 刻意不做的事」
 * `collection_start` 只排队、不执行；`collection_task_retry` 不重跑，只推入预置产物；
 * 重跑之后轮次的 `completed/failed/success_rate` **不重算**（AGENTS 规则 9：不在 demo 里实现
 * 记账口径）。这三条一旦"顺手实现"，就会与真后端漂移，所以每一条都要有断言。
 *
 * # 语言约束（门禁 7）
 * 本目录非注释 CJK 必须为 0 ⇒ 断言里的中文数据一律经 `SEED_*` 常量引用。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type {
  CollectionBoard,
  CollectionRecord,
  CollectionRecordDetail,
  CollectionRound,
  CollectionRoundDetail,
  CollectionTask,
} from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import {
  SEED_ACTIVE_PROJECT_ID,
  SEED_ARCHIVED_PROJECT_ID,
} from '../seed/projects';
import {
  SEED_BASELINE_SET_ID,
  SEED_PILOT_SET_ID,
  SEED_PROMPT_ITEMS,
  SEED_PROMPT_SETS,
} from '../seed/prompt-sets';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_COLLECTION_ROUNDS,
  SEED_COLLECTION_TASKS,
  SEED_ENGINE_RUNS,
  SEED_LIVE_ROUND_ID,
  SEED_TRIAL_ROUND_ID,
  SEED_USAGE_BOARD,
} from '../seed/collection-rounds';
import { SEED_COLLECTION_RECORDS, SEED_RETRY_OUTCOMES } from '../seed/collection-records-retest';
import { SEED_BASELINE_RECORDS } from '../seed/collection-records';

/** 把「同步 throw」与「rejected promise」两种形状收成同一个 catch（照 `backend.test.ts`）。 */
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

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/collection · collection_board', () => {
  it('演示项目：轮次按 round_index 升序 + 用量看板逐字来自种子', async () => {
    const board = await demoInvoke<CollectionBoard>('collection_board', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });

    expect(board.rounds.map((round) => round.id)).toEqual(
      SEED_COLLECTION_ROUNDS.map((round) => round.id),
    );
    expect(board.rounds.map((round) => round.round_index)).toEqual([1, 2, 3, 4]);
    expect(board.usage).toEqual(SEED_USAGE_BOARD);
  });

  it('没有采集数据的项目：轮次为空 + 空看板（配额未设 ⇒ 两个 quota 都是 null）', async () => {
    const board = await demoInvoke<CollectionBoard>('collection_board', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
    });

    expect(board.rounds).toEqual([]);
    expect(board.usage.rows).toEqual([]);
    expect(board.usage.total_queries).toBe(0);
    expect(board.usage.quota_queries).toBeNull();
    expect(board.usage.quota_exceeded).toBe(false);
  });

  it('项目 id 认不出 ⇒ project/not_found（不是 validation/failed）', async () => {
    const cause = await capture(() => demoInvoke('collection_board', { project_id: 'nope' }));

    expect(errorCode(cause)).toBe('project/not_found');
  });
});

describe('demo/handlers/collection · collection_round_get', () => {
  it('一轮详情 = 轮次 + 该轮各引擎执行汇总 + 该轮队列任务', async () => {
    const detail = await demoInvoke<CollectionRoundDetail>('collection_round_get', {
      round_id: SEED_BASELINE_ROUND_ID,
    });

    expect(detail.round.id).toBe(SEED_BASELINE_ROUND_ID);
    expect(detail.engines).toEqual(SEED_ENGINE_RUNS[SEED_BASELINE_ROUND_ID]);
    expect(detail.tasks.length).toBeGreaterThan(0);
    expect(detail.tasks.every((task) => task.round_id === SEED_BASELINE_ROUND_ID)).toBe(true);
  });

  it('刚排队的新轮次：引擎汇总与任务队列都是空的（demo 不执行）', async () => {
    const queued = await demoInvoke<CollectionRound>('collection_start', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { prompt_set_id: SEED_BASELINE_SET_ID, engine_scope: ['doubao'], repeat_count: 1 },
    });
    const detail = await demoInvoke<CollectionRoundDetail>('collection_round_get', {
      round_id: queued.id,
    });

    expect(detail.round.status).toBe('queued');
    expect(detail.engines).toEqual([]);
    expect(detail.tasks).toEqual([]);
  });

  it('轮次 id 认不出 ⇒ validation/failed + field=round_id（契约里没有 round_not_found 这个码）', async () => {
    const cause = await capture(() => demoInvoke('collection_round_get', { round_id: 'nope' }));

    expect(errorCode(cause)).toBe('validation/failed');
    expect(isIpcErrorPayload(cause) && cause.params).toEqual({
      field: 'round_id',
      reason: 'invalid_id',
      value: 'nope',
    });
  });
});

describe('demo/handlers/collection · collection_start（只排队，不执行）', () => {
  it('新轮次是 queued、completed/failed 都是 0、样本量分级回落最保守的 insufficient', async () => {
    const round = await demoInvoke<CollectionRound>('collection_start', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: {
        prompt_set_id: SEED_BASELINE_SET_ID,
        engine_scope: ['doubao', 'kimi'],
        repeat_count: 2,
      },
    });

    expect(round.status).toBe('queued');
    expect(round.completed_queries).toBe(0);
    expect(round.failed_queries).toBe(0);
    expect(round.success_rate).toBe(0);
    expect(round.started_at).toBeNull();
    expect(round.finished_at).toBeNull();
    expect(round.sample_size_grade).toBe('insufficient');
    // round_index 接在种子的第 4 轮之后。
    expect(round.round_index).toBe(5);
    expect(round.repeat_count).toBe(2);
    expect(round.engine_scope).toEqual(['doubao', 'kimi']);
    expect(getDemoDb().collectionRounds).toHaveLength(SEED_COLLECTION_ROUNDS.length + 1);
  });

  it('planned_queries = 题目数 × 引擎数，**不乘**重复采样（与种子里第 3 轮同口径）', async () => {
    const items = SEED_PROMPT_ITEMS.filter((item) => item.set_id === SEED_BASELINE_SET_ID).length;
    const round = await demoInvoke<CollectionRound>('collection_start', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: {
        prompt_set_id: SEED_BASELINE_SET_ID,
        engine_scope: ['doubao', 'kimi', 'metaso'],
        repeat_count: 3,
      },
    });

    expect(round.planned_queries).toBe(items * 3);
    // 对照组：种子里 repeat_count = 2 的第 3 轮，计划数同样是 62 × 7（不乘 2）。
    const retest = SEED_COLLECTION_ROUNDS.find((entry) => entry.id === SEED_BASELINE_ROUND_ID);
    expect(retest?.repeat_count).toBe(1);
    expect(
      SEED_COLLECTION_ROUNDS.find((entry) => entry.repeat_count === 2)?.planned_queries,
    ).toBe(items * 7);
  });

  it('label 缺省时回落题库名（handler 里不许造中文字面量）；给了就用给的', async () => {
    const set = SEED_PROMPT_SETS.find((entry) => entry.id === SEED_PILOT_SET_ID);
    const fallback = await demoInvoke<CollectionRound>('collection_start', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { prompt_set_id: SEED_PILOT_SET_ID, engine_scope: ['doubao'], repeat_count: 1 },
    });
    expect(fallback.label).toBe(set?.label);
    expect(fallback.prompt_set_label).toBe(set?.label);

    const named = await demoInvoke<CollectionRound>('collection_start', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: {
        prompt_set_id: SEED_PILOT_SET_ID,
        engine_scope: ['doubao'],
        repeat_count: 1,
        label: 'Round Five',
      },
    });
    expect(named.label).toBe('Round Five');
  });

  it('题库不属于该项目 ⇒ prompt_set/not_found；引擎范围为空 ⇒ validation/failed', async () => {
    const missingSet = await capture(() =>
      demoInvoke('collection_start', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        options: { prompt_set_id: 'nope', engine_scope: ['doubao'], repeat_count: 1 },
      }),
    );
    expect(errorCode(missingSet)).toBe('prompt_set/not_found');

    const emptyScope = await capture(() =>
      demoInvoke('collection_start', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        options: { prompt_set_id: SEED_BASELINE_SET_ID, engine_scope: [], repeat_count: 1 },
      }),
    );
    expect(errorCode(emptyScope)).toBe('validation/failed');
    expect(isIpcErrorPayload(emptyScope) && emptyScope.params).toEqual({
      field: 'engine_scope',
      reason: 'empty',
    });
  });

  it('契约外的引擎 id 被丢掉（收敛而不拒绝）；全丢掉就等于范围为空', async () => {
    const round = await demoInvoke<CollectionRound>('collection_start', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: {
        prompt_set_id: SEED_BASELINE_SET_ID,
        engine_scope: ['doubao', 'not_an_engine', 'doubao'],
        repeat_count: 1,
      },
    });
    expect(round.engine_scope).toEqual(['doubao']);

    const cause = await capture(() =>
      demoInvoke('collection_start', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        options: { prompt_set_id: SEED_BASELINE_SET_ID, engine_scope: ['nope'], repeat_count: 1 },
      }),
    );
    expect(errorCode(cause)).toBe('validation/failed');
  });

  it('repeat_count 超出 1~3 ⇒ validation/failed + out_of_range', async () => {
    for (const repeat of [0, 4, 1.5]) {
      const cause = await capture(() =>
        demoInvoke('collection_start', {
          project_id: SEED_ACTIVE_PROJECT_ID,
          options: { prompt_set_id: SEED_BASELINE_SET_ID, engine_scope: ['doubao'], repeat_count: repeat },
        }),
      );
      expect(errorCode(cause), String(repeat)).toBe('validation/failed');
      expect(isIpcErrorPayload(cause) && cause.params?.reason, String(repeat)).toBe('out_of_range');
    }
  });

  it('排队的新轮次**不进**用量看板（demo 不记账）', async () => {
    await demoInvoke('collection_start', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { prompt_set_id: SEED_BASELINE_SET_ID, engine_scope: ['doubao'], repeat_count: 1 },
    });
    const board = await demoInvoke<CollectionBoard>('collection_board', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });

    expect(board.rounds).toHaveLength(SEED_COLLECTION_ROUNDS.length + 1);
    expect(board.usage.rows).toHaveLength(SEED_USAGE_BOARD.rows.length);
    expect(board.usage.total_queries).toBe(SEED_USAGE_BOARD.total_queries);
  });
});

describe('demo/handlers/collection · collection_task_retry（推入预置产物，不真的重跑）', () => {
  const retryable = Object.keys(SEED_RETRY_OUTCOMES);

  it('种子认领的 6 条失败任务都能重跑：任务翻成功、证据与解析结果进库', async () => {
    expect(retryable).toHaveLength(6);

    for (const taskId of retryable) {
      resetDemoDb();
      const before = getDemoDb().collectionRecords.length;
      const task = await demoInvoke<CollectionTask>('collection_task_retry', { task_id: taskId });

      expect(task.id, taskId).toBe(taskId);
      expect(task.status, taskId).toBe('succeeded');
      expect(task.failure_reason, taskId).toBeNull();
      expect(task.record_id, taskId).not.toBeNull();
      // attempt 照真后端 +1（种子里这些任务是 attempt 1 或 2）。
      expect(
        task.attempt,
        taskId,
      ).toBe((SEED_COLLECTION_TASKS.find((entry) => entry.id === taskId)?.attempt ?? 0) + 1);
      // 时间戳取预置证据的 collected_at（不读时钟）⇒ 证据与任务对得上，且可复现。
      expect(task.finished_at, taskId).toBe(SEED_RETRY_OUTCOMES[taskId].collected_at);
      expect(getDemoDb().collectionRecords, taskId).toHaveLength(before + 1);
    }
  });

  it('重复重跑同一条任务不会把证据推进库两次（幂等）', async () => {
    const taskId = retryable[0];
    const first = await demoInvoke<CollectionTask>('collection_task_retry', { task_id: taskId });
    const afterFirst = getDemoDb().collectionRecords.length;

    // 第二次调用时任务已经不是 failed ⇒ state/conflict（而不是"又插一条证据"）。
    const cause = await capture(() => demoInvoke('collection_task_retry', { task_id: taskId }));
    expect(errorCode(cause)).toBe('state/conflict');
    expect(getDemoDb().collectionRecords).toHaveLength(afterFirst);
    expect(first.record_id).not.toBeNull();
  });

  it('没失败的任务不许重跑；没有预置产物的失败任务 ⇒ state/conflict + value=no_demo_outcome', async () => {
    const succeeded = SEED_COLLECTION_TASKS.find((task) => task.status === 'succeeded');
    const notFailed = await capture(() =>
      demoInvoke('collection_task_retry', { task_id: succeeded?.id ?? '' }),
    );
    expect(errorCode(notFailed)).toBe('state/conflict');
    expect(isIpcErrorPayload(notFailed) && notFailed.params).toEqual({
      reason: 'not_allowed',
      value: 'succeeded',
    });

    // 种子里所有失败任务都有预置产物（判据在 `demo/seed.test.ts`）⇒ 这一支只能靠造一条来走。
    getDemoDb().collectionTasks.push({
      ...structuredClone(SEED_COLLECTION_TASKS[0]),
      id: 'demo-task-no-outcome',
      status: 'failed',
    });
    const noOutcome = await capture(() =>
      demoInvoke('collection_task_retry', { task_id: 'demo-task-no-outcome' }),
    );
    expect(errorCode(noOutcome)).toBe('state/conflict');
    expect(isIpcErrorPayload(noOutcome) && noOutcome.params).toEqual({
      reason: 'not_allowed',
      value: 'no_demo_outcome',
    });
  });

  it('任务 id 认不出 ⇒ validation/failed + field=task_id', async () => {
    const cause = await capture(() => demoInvoke('collection_task_retry', { task_id: 'nope' }));

    expect(errorCode(cause)).toBe('validation/failed');
    expect(isIpcErrorPayload(cause) && cause.params?.field).toBe('task_id');
  });

  it('🔴 重跑之后轮次的 completed/failed/success_rate 一个都不重算（规则 9）', async () => {
    const taskId = retryable.find((id) => id.startsWith('demo-task-baseline'));
    const before = SEED_COLLECTION_ROUNDS.find((round) => round.id === SEED_BASELINE_ROUND_ID);
    await demoInvoke('collection_task_retry', { task_id: taskId ?? '' });

    const detail = await demoInvoke<CollectionRoundDetail>('collection_round_get', {
      round_id: SEED_BASELINE_ROUND_ID,
    });
    expect(detail.round.completed_queries).toBe(before?.completed_queries);
    expect(detail.round.failed_queries).toBe(before?.failed_queries);
    expect(detail.round.success_rate).toBe(before?.success_rate);
    // 引擎执行汇总同样是静态种子，重跑不动它。
    expect(detail.engines).toEqual(SEED_ENGINE_RUNS[SEED_BASELINE_ROUND_ID]);
  });
});

describe('demo/handlers/collection · collection_record_list / record_get', () => {
  it('列表行不带回答全文（详情才带），且只含该轮的记录', async () => {
    const rows = await demoInvoke<CollectionRecord[]>('collection_record_list', {
      round_id: SEED_BASELINE_ROUND_ID,
      filter: {},
    });

    expect(rows.length).toBe(SEED_BASELINE_RECORDS.length);
    expect(rows.every((row) => row.round_id === SEED_BASELINE_ROUND_ID)).toBe(true);
    expect(rows[0]).not.toHaveProperty('answer_text');
    expect(rows[0]).not.toHaveProperty('citations');
  });

  it('四个筛选条件按 AND 组合；契约外的 status ⇒ validation/failed', async () => {
    const all = await demoInvoke<CollectionRecord[]>('collection_record_list', {
      round_id: SEED_BASELINE_ROUND_ID,
      filter: {},
    });
    const engine = all[0].engine;
    const mentioned = all.find((row) => row.mentioned === true);

    const byEngine = await demoInvoke<CollectionRecord[]>('collection_record_list', {
      round_id: SEED_BASELINE_ROUND_ID,
      filter: { engine },
    });
    expect(byEngine.every((row) => row.engine === engine)).toBe(true);
    expect(byEngine.length).toBeLessThan(all.length);

    const byBoth = await demoInvoke<CollectionRecord[]>('collection_record_list', {
      round_id: SEED_BASELINE_ROUND_ID,
      filter: { engine, mentioned: true },
    });
    expect(byBoth.every((row) => row.engine === engine && row.mentioned)).toBe(true);
    expect(byBoth.length).toBeLessThanOrEqual(byEngine.length);

    // `null` = 该维不筛（与"筛 false"是两件事）。
    const notFiltered = await demoInvoke<CollectionRecord[]>('collection_record_list', {
      round_id: SEED_BASELINE_ROUND_ID,
      filter: { engine: null, mentioned: null, status: null, intent: null },
    });
    expect(notFiltered).toHaveLength(all.length);
    expect(mentioned?.mentioned).toBe(true);

    const cause = await capture(() =>
      demoInvoke('collection_record_list', {
        round_id: SEED_BASELINE_ROUND_ID,
        filter: { status: 'not_a_status' },
      }),
    );
    expect(errorCode(cause)).toBe('validation/failed');
    expect(isIpcErrorPayload(cause) && cause.params?.field).toBe('status');
  });

  it('详情给完整快照（回答全文 + 引用 + token），id 认不出 ⇒ validation/failed + field=record_id', async () => {
    const seeded = SEED_COLLECTION_RECORDS[0] ?? SEED_BASELINE_RECORDS[0];
    const detail = await demoInvoke<CollectionRecordDetail>('collection_record_get', {
      id: seeded.id,
    });

    expect(detail.id).toBe(seeded.id);
    expect(detail.answer_text).toBe(seeded.answer_text);
    expect(detail.citations).toEqual(seeded.citations);

    const cause = await capture(() => demoInvoke('collection_record_get', { id: 'nope' }));
    expect(errorCode(cause)).toBe('validation/failed');
    expect(isIpcErrorPayload(cause) && cause.params?.field).toBe('record_id');
  });

  it('进行中那轮只有已完成部分的证据（界面上"数字还会变"这句的数据前提）', async () => {
    const rows = await demoInvoke<CollectionRecord[]>('collection_record_list', {
      round_id: SEED_LIVE_ROUND_ID,
      filter: {},
    });
    const trial = await demoInvoke<CollectionRecord[]>('collection_record_list', {
      round_id: SEED_TRIAL_ROUND_ID,
      filter: {},
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(trial.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(
      SEED_COLLECTION_ROUNDS.find((round) => round.id === SEED_LIVE_ROUND_ID)?.planned_queries ?? 0,
    );
  });
});

/**
 * M4 `insight_*` / `fact_check_*` 4 条命令的行为测试。
 *
 * # 分工（照 `collection.test.ts` 的口径，别把同一件事钉三遍）
 * - **错误 params 的精确键集** ⇒ `error-contract.test.ts`；本文件只点 `code` 与关键 `params`。
 * - **args 键名漂移** ⇒ 由页面测试经 `api/insight.ts` 的具名导出走真实分派覆盖。
 * - **种子自洽**（`needs_review` 与 `REVIEW_CONFIDENCE_FLOOR` 对齐、`fact_accuracy` 与 `by_kind`
 *   手工对齐）⇒ `demo/seed.test.ts`。
 * - 本文件管**行为**：筛选的 AND 语义、人工纠正的写路径与同步面、结办的状态机。
 *
 * # 🔴 这里钉的是「demo 刻意不做的事」（AGENTS 规则 9）
 * ① 纠正**不触发任何重算**：`confidence` / `fact_accuracy` / 各维度得分都还是静态值；
 * ② 结办核查问题**不改实体卡**；
 * ③ 唯一被同步的是同一条事实在两个 DTO 上的两份写法（证据行投影 + `mentions` 里的 `self` 行）。
 * 这三条一旦"顺手实现"，就会与真后端漂移，所以每一条都要有断言。
 *
 * # 语言约束（门禁 7）
 * 本目录非注释 CJK 必须为 0 ⇒ 断言里的中文数据一律经 `SEED_*` 常量引用。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type {
  AnswerInsight,
  CollectionRecordDetail,
  EntityCard,
  FactCheckBoard,
  FactCheckIssue,
} from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { REVIEW_CONFIDENCE_FLOOR } from '../../api/constants';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import { SEED_ACTIVE_PROJECT_ID } from '../seed/projects';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_LIVE_ROUND_ID,
  SEED_RETEST_ROUND_ID,
  SEED_TRIAL_ROUND_ID,
} from '../seed/collection-rounds';
import {
  SEED_ANSWER_INSIGHTS,
  SEED_FACT_CHECK_ISSUES,
  SEED_FACT_CHECK_SUMMARIES,
  SEED_RETRY_INSIGHTS,
} from '../seed/insights';

/** 把「同步 throw」与「rejected promise」两种形状收成同一个 catch（照 `collection.test.ts`）。 */
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

/** 种子里那几条解析结果的 id 是 `demo-ins-<record 尾段>`（纯字符串搬运）。 */
const TRIAL_REVIEW_INSIGHT_ID = 'demo-ins-trial-002';
const TRIAL_REVIEW_RECORD_ID = 'demo-rec-trial-002';
const RETEST_CORRECTED_INSIGHT_ID = 'demo-ins-retest-005';
/** 重跑之后才进库的那一条（`SEED_RETRY_OUTCOMES` 的同名键）。 */
const RETRY_TASK_ID = 'demo-task-baseline-003';
/** 结办时人工填的处理说明（测试输入，不是种子数据 ⇒ 就地定义一份）。 */
const RESOLVE_NOTE = '官网报价页已改版';

function insightsOfRound(roundId: string): AnswerInsight[] {
  return SEED_ANSWER_INSIGHTS.filter((insight) => insight.round_id === roundId);
}

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/insight · insight_list', () => {
  it('一轮的解析结果按 id 升序，逐字来自种子', async () => {
    const listed = await demoInvoke<AnswerInsight[]>('insight_list', {
      round_id: SEED_BASELINE_ROUND_ID,
    });
    const seeded = insightsOfRound(SEED_BASELINE_ROUND_ID);

    expect(listed.map((insight) => insight.id)).toEqual(
      [...seeded].map((insight) => insight.id).sort((left, right) => left.localeCompare(right)),
    );
    expect(listed).toEqual(seeded);
    expect(listed.every((insight) => insight.round_id === SEED_BASELINE_ROUND_ID)).toBe(true);
  });

  it('四个筛选条件按 AND 组合（引擎 + 复核队列 + 是否提及 + 风险标记）', async () => {
    const all = await demoInvoke<AnswerInsight[]>('insight_list', {
      round_id: SEED_BASELINE_ROUND_ID,
      filter: {},
    });
    const filtered = await demoInvoke<AnswerInsight[]>('insight_list', {
      round_id: SEED_BASELINE_ROUND_ID,
      filter: { engine: 'metaso', needs_review: true, self_mentioned: false, risk: null },
    });

    expect(filtered.length).toBeLessThan(all.length);
    expect(filtered.every((insight) => insight.engine === 'metaso')).toBe(true);
    expect(filtered.every((insight) => insight.needs_review)).toBe(true);
    expect(filtered.every((insight) => !insight.self_mentioned)).toBe(true);
    // 每个条件都真的在收窄：单独放宽任一条，结果集都要变大或相等。
    const onlyEngine = await demoInvoke<AnswerInsight[]>('insight_list', {
      round_id: SEED_BASELINE_ROUND_ID,
      filter: { engine: 'metaso' },
    });
    expect(onlyEngine.length).toBeGreaterThanOrEqual(filtered.length);
  });

  it('只看复核队列 = 种子里 needs_review 的那几条；置信度门槛由界面解释，不由 handler 重算', async () => {
    const queue = await demoInvoke<AnswerInsight[]>('insight_list', {
      round_id: SEED_BASELINE_ROUND_ID,
      filter: { needs_review: true },
    });
    const seededQueue = insightsOfRound(SEED_BASELINE_ROUND_ID).filter(
      (insight) => insight.needs_review,
    );

    expect(queue).toEqual(seededQueue);
    expect(queue.length).toBeGreaterThan(0);
    // 门槛常量确实被种子用上（一致性判据在 `seed.test.ts`，这里只证明 handler 没有另立一套）。
    expect(queue.some((insight) => insight.confidence < REVIEW_CONFIDENCE_FLOOR)).toBe(true);
  });

  it('契约外的风险标记当作「不筛」（收敛而不拒绝）', async () => {
    const withoutFilter = await demoInvoke<AnswerInsight[]>('insight_list', {
      round_id: SEED_TRIAL_ROUND_ID,
      filter: {},
    });
    const bogusRisk = await demoInvoke<AnswerInsight[]>('insight_list', {
      round_id: SEED_TRIAL_ROUND_ID,
      filter: { risk: 'not_a_risk_flag' },
    });

    expect(bogusRisk).toEqual(withoutFilter);

    const suspected = await demoInvoke<AnswerInsight[]>('insight_list', {
      round_id: SEED_TRIAL_ROUND_ID,
      filter: { risk: 'suspected_hallucination' },
    });
    expect(suspected.length).toBeGreaterThan(0);
    expect(suspected.every((insight) => insight.risks.includes('suspected_hallucination'))).toBe(
      true,
    );
    expect(suspected.length).toBeLessThan(withoutFilter.length);
  });

  it('重跑之前库里没有那条解析结果，重跑之后才出现（失败 → 重跑 → 证据出现）', async () => {
    const expected = SEED_RETRY_INSIGHTS[RETRY_TASK_ID];
    expect(expected).toBeDefined();

    const before = await demoInvoke<AnswerInsight[]>('insight_list', {
      round_id: SEED_BASELINE_ROUND_ID,
    });
    expect(before.some((insight) => insight.id === expected.id)).toBe(false);

    await demoInvoke('collection_task_retry', { task_id: RETRY_TASK_ID });

    const after = await demoInvoke<AnswerInsight[]>('insight_list', {
      round_id: SEED_BASELINE_ROUND_ID,
    });
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((insight) => insight.id === expected.id)).toEqual(expected);
    // 重复重跑不许把同一条推进库两次。
    await capture(() => demoInvoke('collection_task_retry', { task_id: RETRY_TASK_ID }));
    const again = await demoInvoke<AnswerInsight[]>('insight_list', {
      round_id: SEED_BASELINE_ROUND_ID,
    });
    expect(again).toHaveLength(after.length);
  });

  it('进行中的第 4 轮照样能列解析结果（采集没跑完 ≠ 没有已解析的回答）', async () => {
    const live = await demoInvoke<AnswerInsight[]>('insight_list', {
      round_id: SEED_LIVE_ROUND_ID,
    });

    expect(live).toEqual(insightsOfRound(SEED_LIVE_ROUND_ID));
    expect(live.length).toBeGreaterThan(0);
  });

  it('轮次 id 认不出 ⇒ validation/failed + field=round_id（契约里没有 round_not_found 这个码）', async () => {
    const cause = await capture(() => demoInvoke('insight_list', { round_id: 'nope' }));

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'round_id',
      reason: 'invalid_id',
      value: 'nope',
    });
  });
});

describe('demo/handlers/insight · insight_correct（人工纠正只许改三项）', () => {
  it('改三项 + 记 corrected_fields + 出复核队列 + 盖 reviewed_at', async () => {
    const before = getDemoDb().insights.find((entry) => entry.id === TRIAL_REVIEW_INSIGHT_ID);
    expect(before?.needs_review).toBe(true);
    expect(before?.reviewed_at).toBeNull();

    const corrected = await demoInvoke<AnswerInsight>('insight_correct', {
      id: TRIAL_REVIEW_INSIGHT_ID,
      correction: { self_mentioned: true, self_rank: 2, self_sentiment: 'positive' },
    });

    expect(corrected.self_mentioned).toBe(true);
    expect(corrected.self_rank).toBe(2);
    expect(corrected.self_sentiment).toBe('positive');
    expect(corrected.corrected_fields).toEqual(['self_mentioned', 'self_rank', 'self_sentiment']);
    expect(corrected.needs_review).toBe(false);
    expect(corrected.reviewed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // 库里也是这个形状（不是只在返回值上做样子）。
    expect(getDemoDb().insights.find((entry) => entry.id === TRIAL_REVIEW_INSIGHT_ID)).toEqual(
      corrected,
    );
  });

  it('🔴 纠正不触发任何重算：confidence 与 fact_accuracy 都还是采集时的静态值', async () => {
    const before = insightsOfRound(SEED_BASELINE_ROUND_ID).find(
      (insight) => insight.id === 'demo-ins-baseline-001',
    );
    expect(before).toBeDefined();

    const corrected = await demoInvoke<AnswerInsight>('insight_correct', {
      id: before!.id,
      correction: { self_mentioned: true, self_rank: 1, self_sentiment: 'positive' },
    });
    expect(corrected.confidence).toBe(before!.confidence);

    const board = await demoInvoke<FactCheckBoard>('fact_check_list', {
      round_id: SEED_BASELINE_ROUND_ID,
    });
    expect(board.summary?.fact_accuracy).toBe(
      SEED_FACT_CHECK_SUMMARIES[SEED_BASELINE_ROUND_ID].fact_accuracy,
    );
  });

  it('「未提及」与位次 / 情感互斥：翻成未提及时两者一并清空', async () => {
    const corrected = await demoInvoke<AnswerInsight>('insight_correct', {
      id: RETEST_CORRECTED_INSIGHT_ID,
      correction: { self_mentioned: false },
    });

    expect(corrected.self_mentioned).toBe(false);
    expect(corrected.self_rank).toBeNull();
    expect(corrected.self_sentiment).toBeNull();
    // 种子里这条本来就纠正过这两项 ⇒ 不重复记（corrected_fields 是集合语义）。
    expect(corrected.corrected_fields).toEqual(['self_mentioned', 'self_rank']);
  });

  it('🔴 未提及 + 位次同时提交 ⇒ 位次必须被清空，不能落成自相矛盾状态', async () => {
    const before = (await demoInvoke<AnswerInsight[]>('insight_list', {
      round_id: SEED_RETEST_ROUND_ID,
    })).find((row) => row.self_mentioned && row.self_rank !== null);
    expect(before).toBeDefined();

    const corrected = await demoInvoke<AnswerInsight>('insight_correct', {
      id: before!.id,
      correction: { self_mentioned: false, self_rank: 2 },
    });

    expect(corrected.self_mentioned).toBe(false);
    expect(corrected.self_rank).toBeNull();
    expect(corrected.self_sentiment).toBeNull();
    expect(corrected.mentions.find((row) => row.role === 'self')?.rank).toBeNull();
  });

  it('同步证据行投影与 mentions 里的 self 行（同一条事实的两份写法）', async () => {
    await demoInvoke<AnswerInsight>('insight_correct', {
      id: TRIAL_REVIEW_INSIGHT_ID,
      correction: { self_mentioned: true, self_rank: 3, self_sentiment: 'negative' },
    });

    const record = await demoInvoke<CollectionRecordDetail>('collection_record_get', {
      id: TRIAL_REVIEW_RECORD_ID,
    });
    expect(record.mentioned).toBe(true);
    expect(record.rank).toBe(3);
    expect(record.sentiment).toBe('negative');

    const insight = getDemoDb().insights.find((entry) => entry.id === TRIAL_REVIEW_INSIGHT_ID);
    const selfMention = insight?.mentions.find((mention) => mention.role === 'self');
    // 种子里这条原本「未提及」⇒ 没有 self 行；纠正后也不凭空造一行（造行 = 造数据）。
    expect(selfMention).toBeUndefined();
  });

  it('种子里已有 self 行的那条，纠正后 self 行跟着走', async () => {
    const corrected = await demoInvoke<AnswerInsight>('insight_correct', {
      id: RETEST_CORRECTED_INSIGHT_ID,
      correction: { self_rank: 4, self_sentiment: 'neutral' },
    });

    expect(corrected.self_rank).toBe(4);
    const selfMention = corrected.mentions.find((mention) => mention.role === 'self');
    expect(selfMention?.rank).toBe(4);
    expect(selfMention?.sentiment).toBe('neutral');
  });

  it('self_rank 只收正整数：0 / 负数 / 小数 ⇒ validation/failed；null 允许（= 未进推荐清单）', async () => {
    for (const bogus of [0, -1, 2.5]) {
      const cause = await capture(() =>
        demoInvoke('insight_correct', {
          id: TRIAL_REVIEW_INSIGHT_ID,
          correction: { self_rank: bogus },
        }),
      );
      expect(errorCode(cause)).toBe('validation/failed');
      expect(errorParams(cause)).toEqual({
        field: 'self_rank',
        reason: 'out_of_range',
        expected: '>=1',
        value: String(bogus),
      });
    }

    const nulled = await demoInvoke<AnswerInsight>('insight_correct', {
      id: TRIAL_REVIEW_INSIGHT_ID,
      correction: { self_mentioned: true, self_rank: null },
    });
    expect(nulled.self_rank).toBeNull();
    expect(nulled.corrected_fields).toContain('self_rank');
  });

  it('契约外的情感值收敛成 null（不凭空盖一个中性戳）', async () => {
    const corrected = await demoInvoke<AnswerInsight>('insight_correct', {
      id: TRIAL_REVIEW_INSIGHT_ID,
      correction: { self_mentioned: true, self_sentiment: 'ecstatic' },
    });

    expect(corrected.self_sentiment).toBeNull();
    expect(corrected.corrected_fields).toContain('self_sentiment');
  });

  it('纠正载荷里的非人工字段（置信度 / 风险 / 提及明细 / 回答形态）原样忽略，不报错', async () => {
    const before = insightsOfRound(SEED_TRIAL_ROUND_ID).find(
      (insight) => insight.id === TRIAL_REVIEW_INSIGHT_ID,
    );
    expect(before).toBeDefined();

    const corrected = await demoInvoke<AnswerInsight>('insight_correct', {
      id: TRIAL_REVIEW_INSIGHT_ID,
      correction: {
        self_mentioned: true,
        confidence: 1,
        risks: [],
        mentions: [],
        answer_shape: { has_conclusion: false, has_table: false, asks_back: true, refused: true },
      },
    });

    expect(corrected.confidence).toBe(before!.confidence);
    expect(corrected.risks).toEqual(before!.risks);
    expect(corrected.answer_shape).toEqual(before!.answer_shape);
    expect(corrected.corrected_fields).toEqual(['self_mentioned']);
  });

  it('insight id 认不出 ⇒ validation/failed + field=insight_id', async () => {
    const cause = await capture(() =>
      demoInvoke('insight_correct', { id: 'nope', correction: { self_mentioned: true } }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'insight_id',
      reason: 'invalid_id',
      value: 'nope',
    });
  });
});

describe('demo/handlers/insight · fact_check_list', () => {
  it('一轮的核查问题按 id 升序 + 汇总逐字来自种子', async () => {
    const board = await demoInvoke<FactCheckBoard>('fact_check_list', {
      round_id: SEED_RETEST_ROUND_ID,
    });
    const seeded = SEED_FACT_CHECK_ISSUES.filter(
      (issue) => issue.round_id === SEED_RETEST_ROUND_ID,
    );

    expect(board.issues).toEqual(seeded);
    expect(board.summary).toEqual(SEED_FACT_CHECK_SUMMARIES[SEED_RETEST_ROUND_ID]);
  });

  it('四轮都有汇总（含小样本的通道验证轮）⇒ summary 为 null 这一支今天是防御性的', async () => {
    for (const roundId of [
      SEED_TRIAL_ROUND_ID,
      SEED_BASELINE_ROUND_ID,
      SEED_RETEST_ROUND_ID,
      SEED_LIVE_ROUND_ID,
    ]) {
      const board = await demoInvoke<FactCheckBoard>('fact_check_list', { round_id: roundId });
      expect(board.summary?.round_id).toBe(roundId);
    }
  });

  it('轮次 id 认不出 ⇒ validation/failed + field=round_id', async () => {
    const cause = await capture(() => demoInvoke('fact_check_list', { round_id: 'nope' }));

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'round_id',
      reason: 'invalid_id',
      value: 'nope',
    });
  });
});

describe('demo/handlers/insight · fact_check_resolve', () => {
  it('结办成 corrected ⇒ 盖 resolved_at；重新打开 ⇒ 清空', async () => {
    const resolved = await demoInvoke<FactCheckIssue>('fact_check_resolve', {
      id: 'demo-fc-001',
      status: 'corrected',
      note: `  ${RESOLVE_NOTE}  `,
    });

    expect(resolved.status).toBe('corrected');
    expect(resolved.resolved_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // note 收下并 trim（空白串当没给）。
    expect(resolved.note).toBe(RESOLVE_NOTE);

    const reopened = await demoInvoke<FactCheckIssue>('fact_check_resolve', {
      id: 'demo-fc-001',
      status: 'open',
    });
    expect(reopened.status).toBe('open');
    expect(reopened.resolved_at).toBeNull();
    // 重新打开不清 note（处理说明是历史，不是状态）。
    expect(reopened.note).toBe(resolved.note);
  });

  it('误报结办走 false_positive，同样盖 resolved_at', async () => {
    const resolved = await demoInvoke<FactCheckIssue>('fact_check_resolve', {
      id: 'demo-fc-003',
      status: 'false_positive',
    });

    expect(resolved.status).toBe('false_positive');
    expect(resolved.resolved_at).not.toBeNull();
    expect(resolved.note).toBeNull();
  });

  it('🔴 结办不重算 fact_accuracy，也不动实体卡（真后端会不会联动是后端的事）', async () => {
    const cardBefore = await demoInvoke<EntityCard | null>('entity_card_get', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });
    expect(cardBefore).not.toBeNull();

    for (const issue of SEED_FACT_CHECK_ISSUES.filter(
      (entry) => entry.round_id === SEED_BASELINE_ROUND_ID,
    )) {
      await demoInvoke('fact_check_resolve', { id: issue.id, status: 'corrected' });
    }

    const board = await demoInvoke<FactCheckBoard>('fact_check_list', {
      round_id: SEED_BASELINE_ROUND_ID,
    });
    // 全部结办了，准确率仍是采集时的静态值（界面上要看得见这件事）。
    expect(board.issues.every((issue) => issue.status === 'corrected')).toBe(true);
    expect(board.summary).toEqual(SEED_FACT_CHECK_SUMMARIES[SEED_BASELINE_ROUND_ID]);

    const cardAfter = await demoInvoke<EntityCard | null>('entity_card_get', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });
    expect(cardAfter).toEqual(cardBefore);
  });

  it('契约外的状态收敛成 open（最保守：不声称已处理）', async () => {
    const resolved = await demoInvoke<FactCheckIssue>('fact_check_resolve', {
      id: 'demo-fc-002',
      status: 'done_and_dusted',
    });

    expect(resolved.status).toBe('open');
    expect(resolved.resolved_at).toBeNull();
    // 种子里这条原本是 corrected 且已盖 resolved_at ⇒ 收敛成 open 会把已结办的打回去。
    expect(SEED_FACT_CHECK_ISSUES.find((issue) => issue.id === 'demo-fc-002')?.status).toBe(
      'corrected',
    );
  });

  it('issue id 认不出 ⇒ validation/failed + field=issue_id', async () => {
    const cause = await capture(() =>
      demoInvoke('fact_check_resolve', { id: 'nope', status: 'corrected' }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'issue_id',
      reason: 'invalid_id',
      value: 'nope',
    });
  });
});

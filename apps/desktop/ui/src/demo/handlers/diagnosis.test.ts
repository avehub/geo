/**
 * M5 `diagnosis_*` 5 条命令的行为测试。
 *
 * # 分工
 * - **错误 params 的精确键集** ⇒ `error-contract.test.ts`。
 * - **args 键名漂移** ⇒ 由 `pages/DiagnosisPage` 的测试经 `api/diagnosis.ts` 覆盖。
 * - **种子自洽**（总分 == 五维加权、矩阵里澜舟那行与位次分布对齐、趋势三轮的口径）
 *   ⇒ `demo/seed.test.ts`。
 * - 本文件管**行为**：三态返回（数据 / `null` / `validation/failed`）、告警的唯一写路径。
 *
 * # 🔴 这里钉的是两件 demo 的刻意裁定
 * ① **告警真值是 `db.alerts`**，不是 `DiagnosisOverview.alerts` 那份内嵌副本：读时覆盖、写只写库里。
 *    判据取「排序」——`alertsOf` 是 `raised_at DESC`，种子里的内嵌副本是编排顺序，两者不同序
 *    ⇒ 一旦 handler 改回内嵌副本，这条断言立刻红。
 * ② **分数一个都不算**：翻告警、改状态都不动 `total_score` / `dimensions`（AGENTS 规则 9）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type {
  AlertItem,
  CollectionRound,
  CompetitorMatrix,
  DiagnosisOverview,
  EngineScore,
  IntentFunnel,
} from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import { SEED_ACTIVE_PROJECT_ID } from '../seed/projects';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_LIVE_ROUND_ID,
  SEED_RETEST_ROUND_ID,
  SEED_TRIAL_ROUND_ID,
} from '../seed/collection-rounds';
import { SEED_BASELINE_SET_ID } from '../seed/prompt-sets';
import {
  SEED_ALERTS,
  SEED_COMPETITOR_MATRICES,
  SEED_DIAGNOSIS_OVERVIEWS,
  SEED_ENGINE_SCORES,
  SEED_INTENT_FUNNELS,
  SEED_TREND,
} from '../seed/diagnosis';

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

/** 种子里 2 条已读（第 2 轮）+ 2 条未读（第 3 轮），红点与"标记已读"都能走查。 */
const UNACKED_ALERT_ID = 'demo-alert-004';
const ACKED_ALERT_ID = 'demo-alert-001';

async function overviewOf(roundId: string): Promise<DiagnosisOverview | null> {
  return demoInvoke<DiagnosisOverview | null>('diagnosis_overview', { round_id: roundId });
}

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/diagnosis · diagnosis_overview', () => {
  it('三轮的体检结果逐字来自种子；告警与趋势取真值源而不是内嵌副本', async () => {
    for (const roundId of [SEED_TRIAL_ROUND_ID, SEED_BASELINE_ROUND_ID, SEED_RETEST_ROUND_ID]) {
      const overview = await overviewOf(roundId);
      const seeded = SEED_DIAGNOSIS_OVERVIEWS[roundId];

      expect(overview).not.toBeNull();
      expect(overview?.round_id).toBe(roundId);
      expect(overview?.total_score).toBe(seeded.total_score);
      expect(overview?.dimensions).toEqual(seeded.dimensions);
      expect(overview?.brand_coverage).toBe(seeded.brand_coverage);
      expect(overview?.metric_spec_version).toBe(seeded.metric_spec_version);
      // 趋势：三轮口径一致（进行中那轮不进趋势）。
      expect(overview?.trend).toEqual(SEED_TREND);
      // 🔴 告警：`alertsOf` 是 raised_at DESC，种子内嵌副本是编排顺序 ⇒ 顺序不同才说明覆盖生效。
      expect(overview?.alerts.map((alert) => alert.id)).not.toEqual(
        seeded.alerts.map((alert) => alert.id),
      );
      expect(overview?.alerts.map((alert) => alert.id)).toEqual([
        'demo-alert-004',
        'demo-alert-003',
        'demo-alert-002',
        'demo-alert-001',
      ]);
    }
  });

  it('告警是项目级的：三轮 overview 里都是同 4 条（不按 round_id 收窄）', async () => {
    const trial = await overviewOf(SEED_TRIAL_ROUND_ID);
    const retest = await overviewOf(SEED_RETEST_ROUND_ID);

    expect(SEED_ALERTS).toHaveLength(4);
    expect(trial?.alerts).toEqual(retest?.alerts);
    expect(trial?.alerts.every((alert) => alert.project_id === SEED_ACTIVE_PROJECT_ID)).toBe(true);
  });

  it('进行中的第 4 轮：轮次存在但没有体检结果 ⇒ null（不是错误，也不给 0 分）', async () => {
    const overview = await overviewOf(SEED_LIVE_ROUND_ID);

    expect(overview).toBeNull();
    // 引擎差异视图是即时口径，进行中那轮**有**（界面上标注"数字会变"）。
    const engines = await demoInvoke<EngineScore[]>('diagnosis_engines', {
      round_id: SEED_LIVE_ROUND_ID,
    });
    expect(engines).toEqual(SEED_ENGINE_SCORES[SEED_LIVE_ROUND_ID]);
  });

  it('刚排队的新轮次：overview 为 null、引擎差异为空数组、竞品与漏斗为 null', async () => {
    const round = await demoInvoke<CollectionRound>('collection_start', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: {
        prompt_set_id: SEED_BASELINE_SET_ID,
        engine_scope: ['doubao'],
        repeat_count: 1,
      },
    });

    expect(await overviewOf(round.id)).toBeNull();
    expect(
      await demoInvoke<EngineScore[]>('diagnosis_engines', { round_id: round.id }),
    ).toEqual([]);
    expect(await demoInvoke('diagnosis_competitors', { round_id: round.id })).toBeNull();
    expect(await demoInvoke('diagnosis_funnel', { round_id: round.id })).toBeNull();
  });

  it('🔴 翻告警不重算任何分数（demo 不做加权，规则 9）', async () => {
    const before = await overviewOf(SEED_BASELINE_ROUND_ID);
    await demoInvoke('diagnosis_alert_acknowledge', { alert_id: UNACKED_ALERT_ID });
    const after = await overviewOf(SEED_BASELINE_ROUND_ID);

    expect(after?.total_score).toBe(before?.total_score);
    expect(after?.dimensions).toEqual(before?.dimensions);
    expect(after?.brand_coverage).toBe(before?.brand_coverage);
    expect(after?.fact_accuracy).toBe(before?.fact_accuracy);
    expect(after?.distinct_cited_domains).toBe(before?.distinct_cited_domains);
    // 唯一变的是那条告警的已读位。
    expect(after?.alerts.find((alert) => alert.id === UNACKED_ALERT_ID)?.acknowledged).toBe(true);
    expect(before?.alerts.find((alert) => alert.id === UNACKED_ALERT_ID)?.acknowledged).toBe(false);
  });

  it('返回值是副本：改返回值不会污染库', async () => {
    const overview = await overviewOf(SEED_BASELINE_ROUND_ID);
    overview!.total_score = 0;
    overview!.alerts.pop();

    const again = await overviewOf(SEED_BASELINE_ROUND_ID);
    expect(again?.total_score).toBe(SEED_DIAGNOSIS_OVERVIEWS[SEED_BASELINE_ROUND_ID].total_score);
    expect(again?.alerts).toHaveLength(SEED_ALERTS.length);
    expect(getDemoDb().alerts).toHaveLength(SEED_ALERTS.length);
  });

  it('轮次 id 认不出 ⇒ validation/failed + field=round_id（≠「这一轮没有数据」）', async () => {
    for (const command of [
      'diagnosis_overview',
      'diagnosis_competitors',
      'diagnosis_funnel',
      'diagnosis_engines',
    ]) {
      const cause = await capture(() => demoInvoke(command, { round_id: 'nope' }));

      expect(errorCode(cause)).toBe('validation/failed');
      expect(errorParams(cause)).toEqual({
        field: 'round_id',
        reason: 'invalid_id',
        value: 'nope',
      });
    }
  });
});

describe('demo/handlers/diagnosis · diagnosis_competitors / funnel / engines', () => {
  it('竞品矩阵与意图漏斗只有第 2、3 轮有；小样本的通道验证轮是 null', async () => {
    expect(await demoInvoke('diagnosis_competitors', { round_id: SEED_BASELINE_ROUND_ID })).toEqual(
      SEED_COMPETITOR_MATRICES[SEED_BASELINE_ROUND_ID],
    );
    expect(await demoInvoke('diagnosis_competitors', { round_id: SEED_RETEST_ROUND_ID })).toEqual(
      SEED_COMPETITOR_MATRICES[SEED_RETEST_ROUND_ID],
    );
    expect(await demoInvoke('diagnosis_competitors', { round_id: SEED_TRIAL_ROUND_ID })).toBeNull();

    expect(await demoInvoke('diagnosis_funnel', { round_id: SEED_BASELINE_ROUND_ID })).toEqual(
      SEED_INTENT_FUNNELS[SEED_BASELINE_ROUND_ID],
    );
    expect(await demoInvoke('diagnosis_funnel', { round_id: SEED_TRIAL_ROUND_ID })).toBeNull();
  });

  it('矩阵里本品牌那一行 is_self 为真，且同框题分母摆在明面上', async () => {
    const matrix = await demoInvoke<CompetitorMatrix>('diagnosis_competitors', {
      round_id: SEED_RETEST_ROUND_ID,
    });
    const self = matrix!.rows.find((row) => row.is_self);

    expect(matrix!.rows.filter((row) => row.is_self)).toHaveLength(1);
    expect(self?.coverage).toBe(0.55);
    expect(matrix!.head_to_head_prompt_count).toBeGreaterThan(0);
    expect(matrix!.sample_size).toBe(62);
  });

  it('漏斗三层齐全，且 prompt_count 显式说明"只覆盖一部分题"', async () => {
    const funnel = await demoInvoke<IntentFunnel>('diagnosis_funnel', {
      round_id: SEED_RETEST_ROUND_ID,
    });

    expect(funnel!.rows.map((row) => row.stage)).toEqual([
      'awareness',
      'recommendation',
      'decision',
    ]);
    // 36 道进漏斗 < 该轮 62 道题（其余三类意图不进漏斗，界面要说明）。
    expect(funnel!.rows.reduce((sum, row) => sum + row.prompt_count, 0)).toBe(36);
    expect(funnel!.diagnosis_note.length).toBeGreaterThan(0);
  });

  it('引擎差异四轮都有；进行中那轮样本量小于全量（界面上标注"数字会变"）', async () => {
    const live = await demoInvoke<EngineScore[]>('diagnosis_engines', {
      round_id: SEED_LIVE_ROUND_ID,
    });
    const baseline = await demoInvoke<EngineScore[]>('diagnosis_engines', {
      round_id: SEED_BASELINE_ROUND_ID,
    });

    expect(live).toEqual(SEED_ENGINE_SCORES[SEED_LIVE_ROUND_ID]);
    expect(baseline.every((row) => row.sample_size === 62)).toBe(true);
    expect(live.every((row) => row.sample_size < 62)).toBe(true);
  });
});

describe('demo/handlers/diagnosis · diagnosis_alert_acknowledge', () => {
  it('缺省即「标记已读」，返回整条告警（调用方就地替换那一行，不必重拉 overview）', async () => {
    const alert = await demoInvoke<AlertItem>('diagnosis_alert_acknowledge', {
      alert_id: UNACKED_ALERT_ID,
    });

    expect(alert.id).toBe(UNACKED_ALERT_ID);
    expect(alert.acknowledged).toBe(true);
    expect(alert.detail).toBe(SEED_ALERTS.find((entry) => entry.id === UNACKED_ALERT_ID)?.detail);
    expect(getDemoDb().alerts.find((entry) => entry.id === UNACKED_ALERT_ID)?.acknowledged).toBe(
      true,
    );
  });

  it('显式传 false 可取消已读', async () => {
    const acked = await demoInvoke<AlertItem>('diagnosis_alert_acknowledge', {
      alert_id: ACKED_ALERT_ID,
    });
    expect(acked.acknowledged).toBe(true);

    const unacked = await demoInvoke<AlertItem>('diagnosis_alert_acknowledge', {
      alert_id: ACKED_ALERT_ID,
      acknowledged: false,
    });
    expect(unacked.acknowledged).toBe(false);
  });

  it('契约外的 acknowledged 值按 false 收（`asBoolean` 只认字面 true）', async () => {
    const alert = await demoInvoke<AlertItem>('diagnosis_alert_acknowledge', {
      alert_id: UNACKED_ALERT_ID,
      acknowledged: 'yes',
    });

    expect(alert.acknowledged).toBe(false);
  });

  it('🔴 只写 `db.alerts` 一处：库里那条与 overview 里那份始终是同一个值', async () => {
    await demoInvoke('diagnosis_alert_acknowledge', { alert_id: UNACKED_ALERT_ID });

    const inDb = getDemoDb().alerts.find((entry) => entry.id === UNACKED_ALERT_ID);
    const inOverview = (await overviewOf(SEED_RETEST_ROUND_ID))?.alerts.find(
      (entry) => entry.id === UNACKED_ALERT_ID,
    );
    expect(inDb?.acknowledged).toBe(true);
    expect(inOverview?.acknowledged).toBe(true);
    expect(inOverview).toEqual(inDb);
    // 未读红点只剩种子里那 1 条未读的。
    const unread = getDemoDb().alerts.filter((entry) => !entry.acknowledged);
    expect(unread.map((entry) => entry.id)).toEqual(['demo-alert-003']);
  });

  it('告警 id 认不出 ⇒ validation/failed + field=alert_id', async () => {
    const cause = await capture(() =>
      demoInvoke('diagnosis_alert_acknowledge', { alert_id: 'nope' }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'alert_id',
      reason: 'invalid_id',
      value: 'nope',
    });
  });
});

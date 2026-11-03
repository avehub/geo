/**
 * 项目概览的**组装口径**（项目级 + M9 组合级）。
 *
 * # 这一层为什么存在
 * 首页要同时回答「我现在怎么样」「哪里最差」「下一步做什么」。这三件事来自四个模块
 * （采集轮次 / 诊断 / 核查 / 行动），但**没有一个模块的 DTO 能单独回答**：
 * - `CollectionRound` 没有样本量与结论，`DiagnosisOverview` 没有前一轮对照；
 * - 风险散在 `AlertItem` / `FactCheckIssue` / `AnswerInsight.needs_review` 三处；
 * - M9 的组合视角又不能把各项目的比率直接取平均（分母不同）。
 * 所以这里用纯函数把「哪些轮次算结论」「环比怎么取」「风险怎么排」「组合怎么汇总」
 * 钉在一处，桌面端将来复用同一份（与 `search-compose.ts` 同族）。
 *
 * # 🔴 规则 9：这里不做领域算法
 * 覆盖率、准确率、总分都是种子/后端的静态值；本文件只做**选择、相减、排序、计数、分位数**。
 * 不重算五维、不判定机会、不重算样本分级。
 */
import { describe, expect, it } from 'vitest';

import {
  buildActionProgress,
  buildHeadlineMetrics,
  buildRiskQueue,
  conclusiveRounds,
  latestConclusiveRound,
  previousConclusiveRound,
} from './overview-compose';
import type { AnswerInsight, FactCheckBoard } from './types';
import { SEED_ACTIONS } from '../demo/seed/actions';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_COLLECTION_ROUNDS,
  SEED_LIVE_ROUND_ID,
  SEED_RETEST_ROUND_ID,
  SEED_TRIAL_ROUND_ID,
} from '../demo/seed/collection-rounds';
import { SEED_ALERTS, SEED_DIAGNOSIS_OVERVIEWS } from '../demo/seed/diagnosis';
import { SEED_ANSWER_INSIGHTS, SEED_FACT_CHECK_ISSUES } from '../demo/seed/insights';

const CONCLUSIVE_IDS = [SEED_TRIAL_ROUND_ID, SEED_BASELINE_ROUND_ID, SEED_RETEST_ROUND_ID];

function boardOf(roundId: string): FactCheckBoard {
  return {
    issues: SEED_FACT_CHECK_ISSUES.filter((issue) => issue.round_id === roundId),
    summary: null,
  };
}

function queueOf(roundId: string): { roundId: string; insights: AnswerInsight[] } {
  return {
    roundId,
    insights: SEED_ANSWER_INSIGHTS.filter(
      (insight) => insight.round_id === roundId && insight.needs_review,
    ),
  };
}

describe('轮次选择：进行中的一轮永远不进结论', () => {
  it('只把 succeeded / partial 当结论，顺序照 round_index', () => {
    expect(conclusiveRounds(SEED_COLLECTION_ROUNDS).map((round) => round.id)).toEqual(
      CONCLUSIVE_IDS,
    );
  });

  it('默认取最近一轮有结论的（第 3 轮），不是最新那轮（第 4 轮在跑）', () => {
    expect(latestConclusiveRound(SEED_COLLECTION_ROUNDS)?.id).toBe(SEED_RETEST_ROUND_ID);
  });

  it('上一轮取第 2 轮；第 1 轮没有上一轮', () => {
    expect(previousConclusiveRound(SEED_COLLECTION_ROUNDS, SEED_RETEST_ROUND_ID)?.id).toBe(
      SEED_BASELINE_ROUND_ID,
    );
    expect(previousConclusiveRound(SEED_COLLECTION_ROUNDS, SEED_TRIAL_ROUND_ID)).toBeNull();
  });

  it('空清单 / 只有进行中的轮次都回 null', () => {
    expect(latestConclusiveRound([])).toBeNull();
    expect(
      latestConclusiveRound(SEED_COLLECTION_ROUNDS.filter((round) => round.id === SEED_LIVE_ROUND_ID)),
    ).toBeNull();
  });
});

describe('头号 KPI：值取当前轮，环比取上一轮', () => {
  it('第 3 轮对第 2 轮的四个数与环比逐项正确', () => {
    const current = SEED_DIAGNOSIS_OVERVIEWS[SEED_RETEST_ROUND_ID];
    const previous = SEED_DIAGNOSIS_OVERVIEWS[SEED_BASELINE_ROUND_ID];
    const metrics = buildHeadlineMetrics(current, previous);

    expect(metrics.map((metric) => metric.key)).toEqual([
      'brand_coverage',
      'total_score',
      'share_of_voice',
      'fact_accuracy',
    ]);

    const coverage = metrics[0];
    expect(coverage.value).toBeCloseTo(0.55, 10);
    expect(coverage.delta).toBe(13);
    expect(coverage.margin).toBe(5);
    expect(coverage.unit).toBe('percent');

    const score = metrics[1];
    expect(score.value).toBe(55);
    expect(score.delta).toBe(11);
    expect(score.margin).toBe(4);
    expect(score.unit).toBe('score');

    expect(metrics[2].delta).toBe(6);
    expect(metrics[2].margin).toBeNull();
    expect(metrics[3].delta).toBe(7);
    expect(metrics[3].margin).toBeNull();
  });

  it('没有上一轮 ⇒ 四个环比逐项为 null（总分不出现假变化）', () => {
    const current = SEED_DIAGNOSIS_OVERVIEWS[SEED_RETEST_ROUND_ID];
    const metrics = buildHeadlineMetrics(current, null);
    expect(metrics.map((metric) => [metric.key, metric.delta])).toEqual([
      ['brand_coverage', null],
      ['total_score', null],
      ['share_of_voice', null],
      ['fact_accuracy', null],
    ]);
  });

  it('总分环比只读一次上一轮的值（不重复调用取数函数）', () => {
    const current = SEED_DIAGNOSIS_OVERVIEWS[SEED_RETEST_ROUND_ID];
    const previous = SEED_DIAGNOSIS_OVERVIEWS[SEED_BASELINE_ROUND_ID];
    let reads = 0;
    const counted: typeof previous = {
      ...previous,
      get total_score() {
        reads += 1;
        return previous.total_score;
      },
    };

    const score = buildHeadlineMetrics(current, counted).find(
      (metric) => metric.key === 'total_score',
    );
    expect(score?.delta).toBe(11);
    expect(reads).toBe(1);
  });

  it('指标口径变了 ⇒ 环比为 null（不给假变化）', () => {
    const current = SEED_DIAGNOSIS_OVERVIEWS[SEED_RETEST_ROUND_ID];

    const drifted = {
      ...SEED_DIAGNOSIS_OVERVIEWS[SEED_BASELINE_ROUND_ID],
      metric_spec_version: 'geo-metrics-v2',
    };
    expect(buildHeadlineMetrics(current, drifted).every((metric) => metric.delta === null)).toBe(
      true,
    );
  });
});

describe('风险队列：项目级累计、按严重度排、只收有结论的轮次', () => {
  const risks = buildRiskQueue({
    alerts: SEED_ALERTS,
    rounds: SEED_COLLECTION_ROUNDS,
    factBoards: CONCLUSIVE_IDS.map((roundId) => ({ roundId, board: boardOf(roundId) })),
    reviewQueues: CONCLUSIVE_IDS.map(queueOf),
  });

  it('只收未读告警；已读的两条不出现', () => {
    const alertItems = risks.filter((risk) => risk.source === 'alert');
    expect(alertItems.map((risk) => risk.id).sort()).toEqual(
      SEED_ALERTS.filter((alert) => !alert.acknowledged)
        .map((alert) => `alert:${alert.id}`)
        .sort(),
    );
  });

  it('只数 status=open 的事实问题，并排除进行中那轮的预置问题', () => {
    const factCount = risks
      .filter((risk) => risk.source === 'fact_check')
      .reduce((sum, risk) => sum + risk.count, 0);
    const expected = SEED_FACT_CHECK_ISSUES.filter(
      (issue) => issue.status === 'open' && CONCLUSIVE_IDS.includes(issue.round_id),
    ).length;
    expect(factCount).toBe(expected);
    expect(risks.some((risk) => risk.round_id === SEED_LIVE_ROUND_ID)).toBe(false);
  });

  it('复核队列只累计有结论的轮次，条数与种子一致', () => {
    const reviewCount = risks
      .filter((risk) => risk.source === 'review')
      .reduce((sum, risk) => sum + risk.count, 0);
    const expected = SEED_ANSWER_INSIGHTS.filter(
      (insight) => insight.needs_review && CONCLUSIVE_IDS.includes(insight.round_id),
    ).length;
    expect(reviewCount).toBe(expected);
  });

  it('第一条一定是 critical（说错了优先于告警与待复核）', () => {
    expect(risks[0].severity).toBe('critical');
    expect(risks[0].id).toBe(`fact:${SEED_BASELINE_ROUND_ID}:wrong`);
  });

  it('严重度单调不减；同级按来源（告警 → 核查 → 复核）排', () => {
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    for (let index = 1; index < risks.length; index += 1) {
      expect(rank[risks[index].severity]).toBeGreaterThanOrEqual(rank[risks[index - 1].severity]);
    }
  });

  it('事实问题按轮次 × 类型成行，不把两轮的同一种问题揉成一条', () => {
    const outdated = risks.filter((risk) => risk.source === 'fact_check' && risk.kind === 'outdated');
    expect(outdated.map((risk) => risk.round_id).sort()).toEqual(
      [SEED_BASELINE_ROUND_ID, SEED_RETEST_ROUND_ID].sort(),
    );
  });
});

describe('行动进度：计数 + 未完成 Top（不改后端名次）', () => {
  const progress = buildActionProgress(SEED_ACTIONS);

  it('三态计数与种子一致', () => {
    expect(progress.total).toBe(SEED_ACTIONS.length);
    expect(progress.done).toBe(SEED_ACTIONS.filter((item) => item.status === 'done').length);
    expect(progress.in_progress).toBe(
      SEED_ACTIONS.filter((item) => item.status === 'in_progress').length,
    );
    expect(progress.todo).toBe(SEED_ACTIONS.filter((item) => item.status === 'todo').length);
  });

  it('快赢只数未完成的；Top 未完成按后端 rank 升序', () => {
    expect(progress.quick_wins_open).toBe(
      SEED_ACTIONS.filter((item) => item.quick_win && item.status !== 'done').length,
    );
    const ranks = progress.top_open.map((item) => item.rank);
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
    expect(progress.top_open.every((item) => item.status !== 'done')).toBe(true);
    expect(progress.top_open).toHaveLength(Math.min(5, progress.todo + progress.in_progress));
  });
});

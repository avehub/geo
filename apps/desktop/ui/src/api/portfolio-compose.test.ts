/**
 * M9 组合汇总与单项目快照的纯函数（与 `overview-compose.ts` 分开）。
 *
 * 🔴 这一组判据钉的是组合口径：**比率不平均、只给分布**；归档默认排除；没有结论的项目
 * 计入项目数但不进分布；行按「风险多 → 覆盖低」排。M9 组合页落地时只渲染这些数，
 * 不再改数据面。
 */
import { describe, expect, it } from 'vitest';

import type { OverviewRisk } from './overview-compose';
import {
  buildProjectSnapshot,
  filterPortfolioRows,
  summarizePortfolio,
  type ProjectOverviewSnapshot,
} from './portfolio-compose';
import { SEED_ACTIONS } from '../demo/seed/actions';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_COLLECTION_ROUNDS,
  SEED_LIVE_ROUND_ID,
  SEED_RETEST_ROUND_ID,
} from '../demo/seed/collection-rounds';
import { SEED_DIAGNOSIS_OVERVIEWS } from '../demo/seed/diagnosis';
import { SEED_ACTIVE_PROJECT_ID, SEED_PROJECTS } from '../demo/seed/projects';

describe('M9 组合汇总：比率不做平均，只给分布', () => {
  function snapshot(
    id: string,
    name: string,
    status: 'active' | 'archived',
    coverage: number | null,
    score: number | null,
    riskTotal: number,
    sampleSize: number,
    grade: 'sufficient' | 'directional',
  ): ProjectOverviewSnapshot {
    return {
      project: {
        id,
        name,
        brand_name: name,
        status,
        website: null,
      },
      round:
        coverage === null
          ? null
          : {
              id: `${id}-round`,
              label: `${name} round`,
              round_index: 1,
              collected_at: '2026-09-23T02:12:00Z',
              sample_size: sampleSize,
              sample_size_grade: grade,
              metric_spec_version: 'geo-metrics-v1',
            },
      metrics:
        coverage === null || score === null
          ? []
          : [
              {
                key: 'brand_coverage',
                unit: 'percent',
                value: coverage,
                delta: null,
                margin: null,
              },
              {
                key: 'total_score',
                unit: 'score',
                value: score,
                delta: null,
                margin: null,
              },
            ],
      risks: Array.from({ length: riskTotal }, (_, index) => ({
        id: `${id}-risk-${index}`,
        source: 'alert' as const,
        severity: 'info' as const,
        count: 1,
        kind: 'coverage_drop',
        round_id: null,
        round_label: null,
        detail: null,
      })),
      actions: { total: 0, done: 0, in_progress: 0, todo: 0, quick_wins_open: 0, top_open: [] },
    };
  }

  const a = snapshot('p-a', 'A', 'active', 0.55, 55, 3, 62, 'sufficient');
  const b = snapshot('p-b', 'B', 'active', 0.31, 31, 1, 30, 'directional');
  const c = snapshot('p-c', 'C', 'archived', 0.9, 90, 9, 100, 'sufficient');
  const d = snapshot('p-d', 'D', 'active', null, null, 0, 0, 'directional');

  it('默认排除归档项目；没有轮次的项目计入项目数但不进分布', () => {
    const rollup = summarizePortfolio([a, b, c, d]);
    expect(rollup.project_count).toBe(3);
    expect(rollup.projects_with_round).toBe(2);
    expect(rollup.total_sample_size).toBe(92);
    expect(rollup.projects_with_risks).toBe(2);
    expect(rollup.risks_total).toBe(4);
    expect(rollup.projects_insufficient).toBe(1);
    expect(rollup.distribution.brand_coverage).toEqual({
      count: 2,
      min: 0.31,
      median: 0.43,
      max: 0.55,
    });
  });

  it('includeArchived 打开时把归档项目一并算进来', () => {
    const rollup = summarizePortfolio([a, b, c, d], { includeArchived: true });
    expect(rollup.project_count).toBe(4);
    expect(rollup.projects_with_round).toBe(3);
    expect(rollup.distribution.total_score).toEqual({ count: 3, min: 31, median: 55, max: 90 });
  });

  it('行按「风险多 → 覆盖低」排，没有轮次的项目排最后', () => {
    const rollup = summarizePortfolio([a, b, d]);
    expect(rollup.rows.map((row) => row.project.id)).toEqual(['p-a', 'p-b', 'p-d']);
  });

  it('没有任何项目时回全零，不抛错', () => {
    const rollup = summarizePortfolio([]);
    expect(rollup.project_count).toBe(0);
    expect(rollup.distribution.brand_coverage).toEqual({
      count: 0,
      min: null,
      median: null,
      max: null,
    });
    expect(rollup.latest_collected_at).toBeNull();
  });
});

describe('单项目快照：给 M9 的行与项目页共用同一份形状', () => {
  it('从项目 + 轮次 + 当前/上一轮 overview + 风险 + 处方组装', () => {
    const risks: OverviewRisk[] = [];
    const snapshot = buildProjectSnapshot({
      project: SEED_PROJECTS.find((project) => project.id === SEED_ACTIVE_PROJECT_ID)!,
      round: SEED_COLLECTION_ROUNDS.find((round) => round.id === SEED_RETEST_ROUND_ID)!,
      overview: SEED_DIAGNOSIS_OVERVIEWS[SEED_RETEST_ROUND_ID],
      previous: SEED_DIAGNOSIS_OVERVIEWS[SEED_BASELINE_ROUND_ID],
      risks,
      actions: SEED_ACTIONS,
    });

    expect(snapshot.project.id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(snapshot.round?.sample_size).toBe(62);
    expect(snapshot.metrics[0].delta).toBe(13);
    expect(snapshot.actions.total).toBe(SEED_ACTIONS.length);
  });

  it('没有结论时轮次与指标都为空，但项目本身仍是一行', () => {
    const snapshot = buildProjectSnapshot({
      project: SEED_PROJECTS.find((project) => project.id === SEED_ACTIVE_PROJECT_ID)!,
      round: SEED_COLLECTION_ROUNDS.find((round) => round.id === SEED_LIVE_ROUND_ID)!,
      overview: null,
      previous: null,
      risks: [],
      actions: [],
    });
    expect(snapshot.round).toBeNull();
    expect(snapshot.metrics).toEqual([]);
  });
});


describe('组合页的筛选与排序（页面只渲染，口径住在这里）', () => {
  function simple(
    id: string,
    name: string,
    riskTotal: number,
    coverage: number | null,
    collectedAt: string | null,
  ): ProjectOverviewSnapshot {
    return {
      project: { id, name, brand_name: name, status: 'active', website: null },
      round:
        coverage === null
          ? null
          : {
              id: `${id}-round`,
              label: `${name} round`,
              round_index: 1,
              collected_at: collectedAt ?? '2026-09-23T00:00:00Z',
              sample_size: 30,
              sample_size_grade: 'sufficient',
              metric_spec_version: 'geo-metrics-v1',
            },
      metrics:
        coverage === null
          ? []
          : [
              {
                key: 'brand_coverage' as const,
                unit: 'percent' as const,
                value: coverage,
                delta: null,
                margin: null,
              },
            ],
      risks: Array.from({ length: riskTotal }, (_, index) => ({
        id: `${id}-risk-${index}`,
        source: 'alert' as const,
        severity: 'info' as const,
        count: 1,
        kind: 'coverage_drop',
        round_id: null,
        round_label: null,
        detail: null,
      })),
      actions: { total: 0, done: 0, in_progress: 0, todo: 0, quick_wins_open: 0, top_open: [] },
    };
  }

  const a = simple('p-a', 'Alpha', 3, 0.55, '2026-09-23T00:00:00Z');
  const b = simple('p-b', 'Beta', 1, 0.31, '2026-08-01T00:00:00Z');
  const d = simple('p-d', 'Delta', 0, null, null);

  it('按状态筛选：有结论 / 待采集 / 有告警', () => {
    expect(filterPortfolioRows([a, b, d], { filter: 'concluded' }).map((row) => row.project.id)).toEqual([
      'p-a',
      'p-b',
    ]);
    expect(filterPortfolioRows([a, b, d], { filter: 'onboarding' }).map((row) => row.project.id)).toEqual([
      'p-d',
    ]);
    expect(filterPortfolioRows([a, b, d], { filter: 'risks' }).map((row) => row.project.id)).toEqual([
      'p-a',
      'p-b',
    ]);
    expect(filterPortfolioRows([a, b, d], { filter: 'all' })).toHaveLength(3);
  });

  it('按项目名 / 品牌名搜索（大小写不敏感，空串不筛）', () => {
    expect(filterPortfolioRows([a, b, d], { query: 'beta' }).map((row) => row.project.id)).toEqual([
      'p-b',
    ]);
    expect(filterPortfolioRows([a, b, d], { query: '  ' })).toHaveLength(3);
    expect(filterPortfolioRows([a, b, d], { query: 'nope' })).toEqual([]);
  });

  it('三种排序：风险优先（默认）/ 覆盖低优先 / 最近采集', () => {
    expect(filterPortfolioRows([d, b, a], { sort: 'risk' }).map((row) => row.project.id)).toEqual([
      'p-a',
      'p-b',
      'p-d',
    ]);
    expect(
      filterPortfolioRows([a, b, d], { sort: 'coverage' }).map((row) => row.project.id),
    ).toEqual(['p-b', 'p-a', 'p-d']);
    expect(filterPortfolioRows([b, a, d], { sort: 'recent' }).map((row) => row.project.id)).toEqual([
      'p-a',
      'p-b',
      'p-d',
    ]);
  });
});

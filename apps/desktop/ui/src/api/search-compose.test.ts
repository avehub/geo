/**
 * 前端组装层的判据（DR-95 / DR-101 / DR-109 … DR-116）。
 *
 * 🔴 这一层是本轮 demo 价值的最大增量（DR-99 放宽）：映射查表、A 类求和、B 类重算、筛选、
 * 交集区间与对账在这里**真做**，所以判据必须钉住三条最容易被写错的口径：
 * ① **B 类只能重算**（把汇总 CTR 改成各源 ctr 的算术平均 ⇒ 这里红，§7 变异 ③）；
 * ② **`analytics` 组永不进 A 类合计**（把百度统计的会话量纲并进去 ⇒ 这里红，§7 变异 ②）；
 * ③ **汇总区间是各源 `data_through` 的交集**，不是用户选的区间（§7 变异 ⑤）。
 * 外加两条纪律：所有面向用户的词都是 **i18n key**（本文件的最后一条判据逐个查两侧词典），
 * 且**换语言不改变任何数字**。
 */
import { describe, expect, it } from 'vitest';

import { i18n, initI18n } from '../i18n';
import enUS from '../i18n/locales/en-US';
import zhCN from '../i18n/locales/zh-CN';
import { STALE_AFTER_DAYS } from './constants';
import {
  aggregateForKeywordRow,
  defaultSearchFilter,
  filterMetrics,
  filterNativeExtras,
  isStaleData,
  normalizeQuery,
  pivotMetrics,
  reconcile,
  resolveAggregateWindow,
  suggestSources,
  summarizeMetrics,
} from './search-compose';
import { withSearchAggregate } from './library-compose';
import type {
  SearchQueryMetric,
  SelfIndexSnapshot,
} from './types-search';
import type { KeywordItem } from './types';

const PROJECT_ID = 'a1f3c0d2-4b6e-4a11-9f3c-7d2e5b8a0c14';
const AS_OF = '2026-10-12';

// ⚠ 这一层**不吃** `SearchSource`：合计与区间都是从**参与合计的指标行**推出来的
// （一个源"参与"= 它在筛选范围内有行），源卡片上的 `data_through` 只用于源列表那一段的展示。
function metric(patch: Partial<SearchQueryMetric> = {}): SearchQueryMetric {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    project_id: PROJECT_ID,
    source_kind: 'baidu_ziyuan',
    surface: 'web_search',
    query: '工业除尘器',
    page_url: null,
    impressions: 1000,
    clicks: 30,
    ctr: 0.03,
    citations: null,
    ai_clicks: null,
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    data_through: '2026-09-30',
    imported_at: '2026-10-01T02:00:00Z',
    completeness: 'full',
    window_source: 'platform',
    mapping_version: '2026-10-12.1',
    ...patch,
  };
}

function snapshot(patch: Partial<SelfIndexSnapshot> = {}): SelfIndexSnapshot {
  return {
    id: `snap-${Math.random().toString(36).slice(2)}`,
    project_id: PROJECT_ID,
    kind: 'ai_citation',
    key: 'geo优化怎么做',
    engine: 'baidu_ai',
    surface: 'ai_answer',
    cited: false,
    cite_position_band: null,
    rank_band: null,
    snippet_hash: null,
    title_hash: null,
    robots_ok: null,
    canonical_ok: null,
    schema_types: null,
    observed_at: '2026-09-20T02:00:00Z',
    round_id: 'round-1',
    ...patch,
  };
}

/** 词典里按点号路径取叶子（判"compose 吐出来的 key 不是裸键"）。 */
function dictionaryLeaf(tree: unknown, key: string): string | null {
  let node: unknown = tree;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' && node !== '' ? node : null;
}

describe('词面规范化（DR-101：按规范化词面把汇总指标拼到关键词行上）', () => {
  it('大小写、全角、首尾空白都归一，中文原样保留', () => {
    expect(normalizeQuery('  Industrial Dust Collector ')).toBe('industrial dust collector');
    expect(normalizeQuery('ＧＥＯ优化')).toBe('geo优化');
    expect(normalizeQuery('工业除尘器')).toBe('工业除尘器');
    expect(normalizeQuery('\u3000GEO\u3000')).toBe('geo');
    // 归一是幂等的：拼行时两边都过一遍，所以再过一遍不许变。
    expect(normalizeQuery(normalizeQuery('ＧＥＯ优化'))).toBe('geo优化');
  });
});

describe('A 类求和 + B 类重算（DR-95）', () => {
  const rows = [
    metric({ source_kind: 'baidu_ziyuan', impressions: 1000, clicks: 30, ctr: 0.03 }),
    metric({ source_kind: 'gsc', impressions: 2000, clicks: 80, ctr: 0.04, data_through: '2026-09-27' }),
  ];

  it('曝光与点击跨平台求和（不相交事件集合），点击率只能重算', () => {
    const totals = summarizeMetrics(rows, defaultSearchFilter(), AS_OF);
    expect(totals.impressions).toBe(3000);
    expect(totals.clicks).toBe(110);
    expect(totals.ctr).toBeCloseTo(110 / 3000, 10);
    // 🔴 §7 变异 ③：绝不是各源 ctr 的算术平均（0.03 与 0.04 的平均是 0.035）。
    expect(totals.ctr).not.toBeCloseTo((0.03 + 0.04) / 2, 6);
  });

  it('🔴 站内分析组永不进 A 类合计（DR-110 护栏 2 / §7 变异 ②）', () => {
    const withAnalytics = [
      ...rows,
      metric({
        source_kind: 'baidu_tongji',
        impressions: 99999,
        clicks: 99999,
      }),
    ];
    // 🔴 指标行上**没有** group 字段：分组只能查目录表（`catalogEntryOf(kind).group`）。
    // 按行上的字段判，就等于让导入数据自己决定要不要被算进 A 类合计。
    const totals = summarizeMetrics(withAnalytics, defaultSearchFilter(), AS_OF);
    expect(totals.impressions, '百度统计被并进曝光合计了').toBe(3000);
    expect(totals.clicks).toBe(110);
    expect(totals.flags.map((flag) => flag.flag_key)).toContain(
      'webmasterData.aggregate.excludedAnalytics',
    );
  });

  it('AI 面的引用量求和，AI 点击率的分母是**引用量**（不是曝光量）', () => {
    const ai = [
      metric({
        source_kind: 'baidu_ziyuan_ai',
        surface: 'ai_answer',
        impressions: 1000,
        clicks: null,
        ctr: null,
        citations: 120,
        ai_clicks: 30,
      }),
      metric({
        source_kind: 'baidu_ziyuan_ai',
        surface: 'ai_answer',
        query: '布袋除尘器',
        impressions: 500,
        clicks: null,
        ctr: null,
        citations: 80,
        ai_clicks: 10,
      }),
    ];
    const totals = summarizeMetrics(ai, { ...defaultSearchFilter(), surface: 'ai_answer' }, AS_OF);
    expect(totals.citations).toBe(200);
    expect(totals.ai_clicks).toBe(40);
    expect(totals.ai_ctr).toBeCloseTo(40 / 200, 10);
    // 🔴 分母写成曝光量（1500）就是全份数据里最容易写错的那个数（§5.2 第 2 条）。
    expect(totals.ai_ctr).not.toBeCloseTo(40 / 1500, 6);
  });

  it('默认只看传统搜索面；显式选"两个面"才跨面合计，并挂 crossSurface 旗标', () => {
    const mixed = [
      ...rows,
      metric({
        source_kind: 'baidu_ziyuan_ai',
        surface: 'ai_answer',
        impressions: 700,
        clicks: null,
        citations: 120,
        ai_clicks: 30,
      }),
    ];
    expect(summarizeMetrics(mixed, defaultSearchFilter(), AS_OF).impressions).toBe(3000);
    const both = summarizeMetrics(mixed, { ...defaultSearchFilter(), surface: 'both' }, AS_OF);
    expect(both.impressions).toBe(3700);
    expect(both.flags.map((flag) => flag.flag_key)).toContain('webmasterData.aggregate.crossSurface');
  });

  it('null 指标当"没有这一列"跳过，不当 0（分母为 0 时比率是 null 而不是 0）', () => {
    const totals = summarizeMetrics(
      [metric({ impressions: null, clicks: null, ctr: null })],
      defaultSearchFilter(),
      AS_OF,
    );
    expect(totals.impressions).toBe(0);
    expect(totals.ctr).toBeNull();
  });
});

describe('汇总区间收敛到各源交集（DR-109 / §7 变异 ⑤）', () => {
  const rows = [
    metric({ source_kind: 'baidu_ziyuan', data_through: '2026-09-30', period_end: '2026-09-30' }),
    metric({ source_kind: 'gsc', data_through: '2026-09-27', period_end: '2026-09-30' }),
  ];

  it('区间末日收敛到最早的 data_through，并点名受限源', () => {
    const window_ = resolveAggregateWindow(rows, { from: '2026-09-01', to: '2026-09-30' });
    expect(window_.start).toBe('2026-09-01');
    expect(window_.end).toBe('2026-09-27');
    expect(window_.limited_by).toEqual(['gsc']);
    expect(window_.note_key).toBe('webmasterData.aggregate.windowLimited');
  });

  it('🔴 不是"用户选的区间"：用户选到 9/30，合计区间仍然只到 9/27', () => {
    const totals = summarizeMetrics(
      rows,
      { ...defaultSearchFilter(), from: '2026-09-01', to: '2026-09-30' },
      AS_OF,
    );
    expect(totals.window.end).toBe('2026-09-27');
    expect(totals.window.end).not.toBe('2026-09-30');
  });

  it('🔴 多周期不重叠时窗口为空，不能把不同月份混成一个倒挂或错位的区间', () => {
    const disjoint = resolveAggregateWindow(
      [
        metric({ source_kind: 'gsc', period_start: '2026-09-01', period_end: '2026-09-10', data_through: '2026-09-10' }),
        metric({ source_kind: 'gsc', period_start: '2026-09-20', period_end: '2026-09-30', data_through: '2026-09-30' }),
      ],
      { from: null, to: null },
    );
    expect(disjoint.start).toBeNull();
    expect(disjoint.end).toBeNull();
    expect(disjoint.limited_by).toEqual([]);
  });

  it('各源截至日一致时不点名任何源，文案换成普通的区间句', () => {
    const aligned = resolveAggregateWindow(
      [metric({ data_through: '2026-09-30' }), metric({ source_kind: 'gsc', data_through: '2026-09-30' })],
      { from: '2026-09-01', to: '2026-09-30' },
    );
    expect(aligned.limited_by).toEqual([]);
    expect(aligned.note_key).toBe('webmasterData.aggregateWindow');
  });

  it('没有参与源 ⇒ 区间是 null（界面显示空态，不显示 1970）', () => {
    const empty = resolveAggregateWindow([], { from: null, to: null });
    expect(empty.start).toBeNull();
    expect(empty.end).toBeNull();
  });
});

describe('陈旧与完整性旗标（DR-105 / DR-110）', () => {
  it('当天不算陈旧、超过 STALE_AFTER_DAYS 的次日算（边界）', () => {
    expect(STALE_AFTER_DAYS).toBe(35);
    expect(isStaleData('2026-09-07', AS_OF)).toBe(false); // 正好 35 天
    expect(isStaleData('2026-09-06', AS_OF)).toBe(true); // 36 天
    expect(isStaleData('2026-10-12', AS_OF)).toBe(false);
  });

  it('陈旧源挂旗标并带上截至日与天数；采样源挂 sampled 旗标', () => {
    const totals = summarizeMetrics(
      [
        metric({ source_kind: 'toutiao', data_through: '2026-08-01' }),
        metric({ source_kind: 'gsc', completeness: 'sampled', data_through: '2026-09-27' }),
      ],
      defaultSearchFilter(),
      AS_OF,
    );
    const keys = totals.flags.map((flag) => flag.flag_key);
    expect(keys).toContain('webmasterData.staleWarning');
    expect(keys).toContain('webmasterData.sampledWarning');
    const stale = totals.flags.find((flag) => flag.flag_key === 'webmasterData.staleWarning');
    expect(stale?.source_kinds).toEqual(['toutiao']);
    expect(stale?.params).toEqual({ through: '2026-08-01', days: '72' });
    const sampled = totals.flags.find((flag) => flag.flag_key === 'webmasterData.sampledWarning');
    expect(sampled?.source_kinds).toEqual(['gsc']);
  });

  it('参与源清单永远给出（DR-112：给数字同时给得出账）', () => {
    const totals = summarizeMetrics(
      [
        metric({ source_kind: 'baidu_ziyuan', data_through: '2026-09-30' }),
        metric({ source_kind: 'gsc', completeness: 'sampled', data_through: '2026-09-27', window_source: 'user_stated' }),
      ],
      defaultSearchFilter(),
      AS_OF,
    );
    expect(totals.participants.map((row) => row.source_kind).sort()).toEqual(['baidu_ziyuan', 'gsc']);
    const gsc = totals.participants.find((row) => row.source_kind === 'gsc');
    expect(gsc?.completeness).toBe('sampled');
    expect(gsc?.window_source).toBe('user_stated');
    expect(gsc?.data_through).toBe('2026-09-27');
  });
});

describe('筛选（DR-112：取消一个源 ⇒ 合计与区间**都**变）', () => {
  const rows = [
    metric({ source_kind: 'baidu_ziyuan', impressions: 1000, clicks: 30, data_through: '2026-09-30' }),
    metric({ source_kind: 'gsc', impressions: 2000, clicks: 80, data_through: '2026-09-27' }),
    metric({ source_kind: 'gsc', query: '布袋除尘器', period_start: '2026-08-01', period_end: '2026-08-31', data_through: '2026-08-31' }),
  ];

  it('取消勾选 GSC ⇒ 合计变小、区间末日跟着往后放', () => {
    const all = summarizeMetrics(rows, defaultSearchFilter(), AS_OF);
    const only = summarizeMetrics(
      rows,
      { ...defaultSearchFilter(), source_kinds: ['baidu_ziyuan'] },
      AS_OF,
    );
    // 不限时间时第三行（8 月那一行，默认 1000 曝光）也在范围内 ⇒ 4000，不是 1000 + 2000。
    // 这正是下面那条 `window.end == 2026-08-31` 的由来：它把交集区间拽回了 8 月。
    expect(all.impressions).toBe(4000);
    expect(only.impressions).toBe(1000);
    // 8 月那行与 9 月的两行没有共同区间 ⇒ 汇总窗口为空，而不是把 9 月数据标成 8/31。
    expect(all.window.start).toBeNull();
    expect(all.window.end).toBeNull();
    expect(only.window.end).toBe('2026-09-30');
    expect(only.participants.map((row) => row.source_kind)).toEqual(['baidu_ziyuan']);
  });

  it('时间区间按"相交即计入"筛（行是按区间导入的，不按天拆）', () => {
    expect(filterMetrics(rows, { ...defaultSearchFilter(), from: '2026-09-01', to: '2026-09-30' })).toHaveLength(2);
    expect(filterMetrics(rows, { ...defaultSearchFilter(), from: '2026-08-01', to: '2026-08-31' })).toHaveLength(1);
    expect(filterMetrics(rows, defaultSearchFilter())).toHaveLength(3);
  });

  it('三种透视：按关键词（跨源合并同词面）/ 按页面 / 按平台', () => {
    const pivoted = [
      metric({ source_kind: 'baidu_ziyuan', query: 'GEO 优化', impressions: 1000, clicks: 30 }),
      metric({ source_kind: 'gsc', query: 'geo优化', impressions: 2000, clicks: 80, data_through: '2026-09-27' }),
      metric({ source_kind: 'gsc', query: '', page_url: 'https://example.com/a', impressions: 500, clicks: 10 }),
    ];
    const byQuery = pivotMetrics(pivoted, { ...defaultSearchFilter(), pivot: 'query' });
    expect(byQuery.map((row) => row.key)).toEqual(['geo优化']);
    expect(byQuery[0].impressions).toBe(3000);
    expect(byQuery[0].source_kinds.sort()).toEqual(['baidu_ziyuan', 'gsc']);
    // 🔴 分子分母都只算进桶的那两行：第三行是**页面级**行（query 为空串），按关键词透视时
    // 它没有关键词维度、不进这个桶 ⇒ 它的 500 / 10 既不进 `impressions` 也不进 `ctr`。
    // 把分母写成 3500 就是"分子按桶、分母按全表"那种最容易溜过去的错。
    expect(byQuery[0].ctr).toBeCloseTo(110 / 3000, 10);
    expect(byQuery[0].ctr).not.toBeCloseTo(120 / 3500, 6);

    const byEngine = pivotMetrics(pivoted, { ...defaultSearchFilter(), pivot: 'engine' });
    expect(byEngine.map((row) => row.key).sort()).toEqual(['baidu_ziyuan', 'gsc']);

    const byPage = pivotMetrics(pivoted, { ...defaultSearchFilter(), pivot: 'page' });
    expect(byPage.map((row) => row.key)).toEqual(['https://example.com/a']);
  });
});

describe('C 类平台独有维度（DR-107）也跟时间筛选走', () => {
  it('有 metric_id 的回查指标区间；表级的用 observed_at；区间外的都收窄', () => {
    const metrics = [
      metric({ id: 'm-window', period_start: '2026-09-01', period_end: '2026-09-30' }),
    ];
    const extras = [
      {
        id: 'nx-metric', project_id: PROJECT_ID, source_kind: 'baidu_ziyuan' as const,
        label: '平均排名', value: 3.2, metric_id: 'm-window', observed_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'nx-old', project_id: PROJECT_ID, source_kind: 'bing_wmt' as const,
        label: 'Grounding Queries', value: 8, metric_id: null, observed_at: '2026-08-01T00:00:00Z',
      },
      {
        id: 'nx-in', project_id: PROJECT_ID, source_kind: 'bing_wmt' as const,
        label: 'Grounding Queries', value: 12, metric_id: null, observed_at: '2026-09-20T00:00:00Z',
      },
    ];

    const filtered = filterNativeExtras(extras, metrics, {
      ...defaultSearchFilter(),
      from: '2026-09-15',
      to: '2026-09-30',
    });

    expect(filtered.map((row) => row.id)).toEqual(['nx-metric', 'nx-in']);
  });
});

describe('对账（DR-116 三条）', () => {
  const l1 = [
    snapshot({ cited: true }),
    snapshot({ round_id: 'round-2' }),
    snapshot({ round_id: 'round-3' }),
    snapshot({ round_id: 'round-4' }),
  ];
  const l3 = [
    metric({
      source_kind: 'baidu_ziyuan_ai',
      surface: 'ai_answer',
      query: 'GEO优化怎么做',
      impressions: 1000,
      citations: 120,
      ai_clicks: 30,
    }),
  ];

  it('① 差异率超阈值 ⇒ 出对账差异事件（阈值 RECONCILE_DIVERGENCE）', () => {
    const result = reconcile(l1, l3);
    expect(result.divergences).toHaveLength(1);
    const event = result.divergences[0];
    expect(event.l1_rate).toBeCloseTo(0.25, 10); // 4 轮里被引 1 次
    expect(event.l3_rate).toBeCloseTo(0.12, 10); // 120 / 1000
    expect(event.divergence).toBeGreaterThan(0.3);
    expect(event.event_key).toBe('webmasterData.reconcile.divergenceEvent');
    expect(event.source_kind).toBe('baidu_ziyuan_ai');
  });

  it('② 冲突时展示以 L3 为准，但 L1 的原始抽样保留可查', () => {
    const row = reconcile(l1, l3).rows[0];
    expect(row.displayed_from).toBe('l3');
    // 展示词保留 L1 原文（不是规范化后的 ASCII 版本）。
    expect(row.query).toBe('geo优化怎么做');
    expect(row.display).toBe('geo优化怎么做');
    expect(row.displayed_rate).toBeCloseTo(0.12, 10);
    expect(row.l1_rate).toBeCloseTo(0.25, 10);
    expect(row.l1_samples).toBe(4);
    expect(row.reconciled).toBe(true);
  });

  it('③ L3 缺失不阻断：L1 照常展示并标"未经平台对账"', () => {
    const result = reconcile(l1, []);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].reconciled).toBe(false);
    expect(result.rows[0].displayed_from).toBe('l1');
    expect(result.rows[0].displayed_rate).toBeCloseTo(0.25, 10);
    expect(result.divergences).toEqual([]);
    expect(result.unreconciled_key).toBe('webmasterData.reconcile.notReconciled');
  });

  it('差异在阈值内 ⇒ 不出事件（先拍后调的阈值不该天天报警）', () => {
    const close = reconcile(
      [snapshot({ cited: true }), snapshot({ round_id: 'round-2' }), snapshot({ round_id: 'round-3' })],
      [
        metric({
          source_kind: 'baidu_ziyuan_ai',
          surface: 'ai_answer',
          query: 'geo优化怎么做',
          impressions: 1000,
          citations: 300, // 0.30 vs L1 的 1/3 ≈ 0.333 ⇒ 差 10%
        }),
      ],
    );
    expect(close.divergences).toEqual([]);
    expect(close.rows[0].reconciled).toBe(true);
  });

  it('展示词取原始 key：全角标点 / 大小写不被规范化掉', () => {
    const result = reconcile(
      [snapshot({ key: 'GEO 优化，怎么做？' })],
      [metric({ source_kind: 'baidu_ziyuan_ai', surface: 'ai_answer', query: 'geo优化,怎么做?', citations: 10, impressions: 100 })],
    );
    expect(result.rows[0].query).toBe('geo优化,怎么做?');
    expect(result.rows[0].display).toBe('GEO 优化，怎么做？');
  });

  it('只对 AI 引用快照与 AI 面指标：页面可索引性快照不参与对账', () => {
    const result = reconcile(
      [...l1, snapshot({ kind: 'page_indexability', key: 'https://example.com/a', engine: 'gsc', surface: null, cited: null, robots_ok: false })],
      l3,
    );
    expect(result.rows.map((row) => row.query)).toEqual(['geo优化怎么做']);
  });
});

describe('拼到关键词行上（DR-101）', () => {
  const rows = [
    metric({ source_kind: 'baidu_ziyuan', query: 'GEO 优化', impressions: 1000, clicks: 30 }),
    metric({ source_kind: 'gsc', query: 'geo优化', impressions: 2000, clicks: 80, data_through: '2026-09-27', completeness: 'sampled' }),
    metric({ source_kind: 'baidu_ziyuan_ai', surface: 'ai_answer', query: 'GEO优化', citations: 120, ai_clicks: 30, impressions: 900 }),
  ];

  it('按规范化词面拼上"汇总指标 + 来自 N 个平台 + 区间 + 完整性"', () => {
    const aggregate = aggregateForKeywordRow('geo优化', rows, AS_OF);
    expect(aggregate).not.toBeNull();
    expect(aggregate?.impressions).toBe(3000);
    expect(aggregate?.clicks).toBe(110);
    expect(aggregate?.citations).toBe(120);
    expect(aggregate?.ctr).toBeCloseTo(110 / 3000, 10);
    expect(aggregate?.source_count).toBe(3);
    // 关键词行报的是**覆盖区间**（多周期累计），不是各源交集；09-30 是最晚的 data_through。
    expect(aggregate?.window).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(aggregate?.completeness).toBe('sampled');
    expect(aggregate?.label_key).toBe('webmasterData.keywordOverlay.withCompleteness');
  });

  it('🔴 多周期不重叠时关键词行报覆盖区间，不能出现起点晚于终点', () => {
    const disjoint = [
      metric({ source_kind: 'gsc', query: 'GEO 优化', period_start: '2026-09-01', period_end: '2026-09-10', data_through: '2026-09-10' }),
      metric({ source_kind: 'gsc', query: 'geo优化', period_start: '2026-09-20', period_end: '2026-09-30', data_through: '2026-09-30' }),
    ];
    const aggregate = aggregateForKeywordRow('geo优化', disjoint, AS_OF);
    expect(aggregate?.window).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('🔴 只有 AI 面数据时，web 面曝光 / 点击是 null，不是 0', () => {
    const aiOnly = [
      metric({
        source_kind: 'baidu_ziyuan_ai',
        surface: 'ai_answer',
        query: '除尘器滤筒更换周期',
        impressions: 410,
        clicks: 21,
        citations: 62,
        ai_clicks: null,
      }),
    ];
    const aggregate = aggregateForKeywordRow('除尘器滤筒更换周期', aiOnly, AS_OF);
    expect(aggregate).not.toBeNull();
    expect(aggregate?.impressions).toBeNull();
    expect(aggregate?.clicks).toBeNull();
    expect(aggregate?.ctr).toBeNull();
    expect(aggregate?.citations).toBe(62);
  });

  it('🔴 拼不上返回 null（界面不显示空占位，更不用 0 冒充）', () => {
    expect(aggregateForKeywordRow('没有这个词', rows, AS_OF)).toBeNull();
    expect(aggregateForKeywordRow('没有这个词', [], AS_OF)).toBeNull();
  });

  it('library-compose 把汇总挂到关键词行上，拼不上的那行是 null', () => {
    const keyword = (text: string): KeywordItem => ({
      id: `kw-${text}`,
      project_id: PROJECT_ID,
      text,
      kind: 'core',
      intent: 'category_awareness',
      monthly_volume: null,
      difficulty: null,
      priority: 3,
      status: 'approved',
      note: null,
      source: 'manual',
      position: 0,
      created_at: '2026-09-11T02:10:00Z',
      updated_at: '2026-09-16T09:05:00Z',
    });
    const rowsOut = withSearchAggregate([keyword('GEO优化'), keyword('布袋除尘器')], rows, AS_OF);
    expect(rowsOut).toHaveLength(2);
    expect(rowsOut[0].searchAggregate?.impressions).toBe(3000);
    expect(rowsOut[0].text).toBe('GEO优化');
    expect(rowsOut[1].searchAggregate).toBeNull();
  });
});

describe('接入建议（DR-111：只依据传入分布，不含内置默认推荐）', () => {
  it('按客户自己的流量分布给建议，占比降序，二期源一律"可以等"', () => {
    const suggestions = suggestSources([
      { engine: 'google', share: 0.11 },
      { engine: 'baidu', share: 0.62 },
      { engine: 'toutiao', share: 0.18 },
      { engine: 'sogou', share: 0.02 },
      { engine: 'so_360', share: 0.01 },
      { engine: 'other', share: 0.06 },
    ]);
    expect(suggestions.map((item) => item.source_kind)).toEqual([
      'baidu_ziyuan',
      'toutiao',
      'gsc',
      'sogou',
      'so_360',
    ]);
    expect(suggestions.slice(0, 3).every((item) => item.reason_key === 'webmasterData.onboarding.suggestion')).toBe(true);
    expect(suggestions.slice(3).every((item) => item.reason_key === 'webmasterData.onboarding.later')).toBe(true);
    expect(suggestions[0].share).toBe(0.62);
  });

  it('🔴 没有站内分析数据 ⇒ 一条建议都不给（不显示通用推荐）', () => {
    expect(suggestSources([])).toEqual([]);
    expect(suggestSources([{ engine: 'baidu', share: 0 }])).toEqual([]);
  });

  it('占比很小的一期源也归到"可以等"（阈值 3%，DR-111 那个例子的口径）', () => {
    const suggestions = suggestSources([
      { engine: 'baidu', share: 0.9 },
      { engine: 'bing', share: 0.005 },
    ]);
    expect(suggestions.map((item) => item.reason_key)).toEqual([
      'webmasterData.onboarding.suggestion',
      'webmasterData.onboarding.later',
    ]);
  });
});

describe('语言无关性（规则 7 + §5.1 那条"换语言不改变数字"）', () => {
  const rows = [
    metric({ source_kind: 'baidu_ziyuan', impressions: 1000, clicks: 30 }),
    metric({ source_kind: 'gsc', impressions: 2000, clicks: 80, data_through: '2026-09-27' }),
    metric({ source_kind: 'baidu_ziyuan_ai', surface: 'ai_answer', citations: 120, ai_clicks: 30 }),
  ];

  it('切到 en-US 之后每一个数字都逐字不变（compose 里没有任何一处查词典）', async () => {
    initI18n('zh-CN');
    const before = JSON.stringify({
      totals: summarizeMetrics(rows, defaultSearchFilter(), AS_OF),
      pivots: pivotMetrics(rows, defaultSearchFilter()),
      window: resolveAggregateWindow(rows, { from: '2026-09-01', to: '2026-09-30' }),
      keyword: aggregateForKeywordRow('工业除尘器', rows, AS_OF),
      reconcile: reconcile([snapshot({ key: '工业除尘器', cited: true })], rows),
      suggestions: suggestSources([{ engine: 'baidu', share: 1 }]),
    });
    await i18n.changeLanguage('en-US');
    const after = JSON.stringify({
      totals: summarizeMetrics(rows, defaultSearchFilter(), AS_OF),
      pivots: pivotMetrics(rows, defaultSearchFilter()),
      window: resolveAggregateWindow(rows, { from: '2026-09-01', to: '2026-09-30' }),
      keyword: aggregateForKeywordRow('工业除尘器', rows, AS_OF),
      reconcile: reconcile([snapshot({ key: '工业除尘器', cited: true })], rows),
      suggestions: suggestSources([{ engine: 'baidu', share: 1 }]),
    });
    await i18n.changeLanguage('zh-CN');
    expect(after).toBe(before);
  });

  it('compose 吐出来的每一个 i18n key 在两侧词典里都解析得出非空叶子（不许裸键上屏）', () => {
    const keys = new Set<string>();
    const totals = summarizeMetrics(
      [
        ...rows,
        metric({ source_kind: 'toutiao', data_through: '2026-08-01' }),
        metric({ source_kind: 'gsc', completeness: 'partial', data_through: '2026-09-27' }),
        metric({ source_kind: 'baidu_tongji', impressions: 5 }),
      ],
      { ...defaultSearchFilter(), surface: 'both' },
      AS_OF,
    );
    for (const flag of totals.flags) keys.add(flag.flag_key);
    keys.add(totals.window.note_key);
    for (const item of suggestSources([{ engine: 'baidu', share: 0.6 }, { engine: 'sogou', share: 0.01 }])) {
      keys.add(item.reason_key);
    }
    const reconciled = reconcile([snapshot({ cited: true })], [
      metric({ source_kind: 'baidu_ziyuan_ai', surface: 'ai_answer', citations: 10, impressions: 1000 }),
    ]);
    for (const event of reconciled.divergences) keys.add(event.event_key);
    expect(reconciled.unreconciled_key).not.toBeNull();
    keys.add(reconciled.unreconciled_key as string);
    keys.add(aggregateForKeywordRow('工业除尘器', rows, AS_OF)?.label_key as string);
    keys.add(resolveAggregateWindow(rows, { from: null, to: null }).note_key);

    expect(keys.size).toBeGreaterThanOrEqual(8);
    for (const key of keys) {
      expect(dictionaryLeaf(zhCN, key), `zh-CN 缺 ${key}`).not.toBeNull();
      expect(dictionaryLeaf(enUS, key), `en-US 缺 ${key}`).not.toBeNull();
    }
  });
});

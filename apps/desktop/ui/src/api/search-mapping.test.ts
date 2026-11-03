/**
 * 声明式指标映射表的判据（spec `2026-10-12-webmaster-data-integration-design.md` DR-107）。
 *
 * 钉四件事：① 版本号可审计（每行都带 `since_version`）；② 百度《AI 流量分析》官方导出的五列
 * 原文**逐字**对上（一级出处：`fixtures/search/` 那两份空表的表头）；③ 每个 canonical **A 类**
 * 指标至少有一个源能映射到（否则"跨平台求和"是句空话）；④ 映射不上的列回 `null`
 * ⇒ 调用方据此进 `native_extras` 原样留档，**不静默丢弃**（DR-107 点名的"最坏的失败形态"）。
 */
import { describe, expect, it } from 'vitest';

import {
  MAPPING_VERSION,
  SEARCH_METRIC_MAPPING,
  aliasColumnsOf,
  canonicalColumnOf,
  isNumericColumn,
  mappingRowsFor,
  requiredMetricColumnsOf,
  tierOf,
} from './search-mapping';
import { SEARCH_SOURCE_VALUES } from './types-search';

describe('映射表本体', () => {
  it('版本号钉死在 2026-10-12.1（DR-107：平台改表头就是要 +1 的信号）', () => {
    expect(MAPPING_VERSION).toBe('2026-10-12.1');
  });

  it('每一行都带 since_version（可审计性：任何数字都能回答"当时按哪一版口径进来的"）', () => {
    expect(SEARCH_METRIC_MAPPING.length).toBeGreaterThan(0);
    for (const row of SEARCH_METRIC_MAPPING) {
      expect(row.since_version, `${row.source_kind}/${row.native_field} 缺 since_version`).toBe(
        MAPPING_VERSION,
      );
    }
  });

  it('9 个源都查得到（映射行允许为空，但查表不许抛）', () => {
    for (const kind of SEARCH_SOURCE_VALUES) {
      expect(Array.isArray(mappingRowsFor(kind)), `${kind} 查表失败`).toBe(true);
    }
  });

  it('同一个源里同一个原文列名不许出现两次（否则就是两个真值源）', () => {
    const seen = new Set<string>();
    for (const row of SEARCH_METRIC_MAPPING) {
      const key = `${row.source_kind}|${row.native_field}`;
      expect(seen.has(key), `重复映射 ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('每个 canonical A 类指标至少有一个源能映射到（DR-95 的求和才有输入）', () => {
    const tierA = SEARCH_METRIC_MAPPING.filter((row) => row.tier === 'a').map(
      (row) => row.canonical_column,
    );
    for (const metric of ['impressions', 'clicks', 'citations'] as const) {
      expect(tierA, `${metric} 没有任何源映射得到`).toContain(metric);
    }
  });
});

describe('百度《AI 流量分析》官方导出（一级出处：fixtures/search/ 两份空表的表头原文）', () => {
  it('热门关键词表五列逐字对上（DR-108 点名这五条）', () => {
    expect(canonicalColumnOf('baidu_ziyuan_ai', '关键词')).toBe('query');
    expect(canonicalColumnOf('baidu_ziyuan_ai', 'AI引用量')).toBe('citations');
    expect(canonicalColumnOf('baidu_ziyuan_ai', 'AI曝光量')).toBe('impressions');
    expect(canonicalColumnOf('baidu_ziyuan_ai', 'AI点击量')).toBe('clicks');
    expect(canonicalColumnOf('baidu_ziyuan_ai', 'AI点击率')).toBe('ctr_check');
  });

  it('热门页面表的「页面」列也认得（第二份 fixture 的表头）', () => {
    expect(canonicalColumnOf('baidu_ziyuan_ai', '页面')).toBe('page_url');
  });

  it('必备列 = 官方导出那四个指标列（缺一个就报错，不猜；E-72 ③）', () => {
    expect([...requiredMetricColumnsOf('baidu_ziyuan_ai')].sort()).toEqual(
      ['citations', 'clicks', 'ctr_check', 'impressions'].sort(),
    );
  });
});

describe('分层与单位（DR-95 的 A / B / C 三层落在数据上）', () => {
  it('可加的三个指标是 a 类，比率是 b 类，维度列不是指标', () => {
    expect(tierOf('impressions')).toBe('a');
    expect(tierOf('clicks')).toBe('a');
    expect(tierOf('citations')).toBe('a');
    expect(tierOf('ctr_check')).toBe('b');
    expect(tierOf('cited_pages')).toBe('c');
    expect(tierOf('query')).toBe('dimension');
    expect(tierOf('page_url')).toBe('dimension');
  });

  it('数字列与文本列分得开（粘贴解析靠它决定要不要归一数字）', () => {
    expect(isNumericColumn('impressions')).toBe(true);
    expect(isNumericColumn('ctr_check')).toBe(true);
    expect(isNumericColumn('query')).toBe(false);
    expect(isNumericColumn('page_url')).toBe(false);
  });
});

describe('认不出与兜底', () => {
  it('映射不上的列回 null（调用方进 native_extras，DR-107）', () => {
    // 百度传统面的「平均排名」刻意不映射：`SearchQueryMetric` 没有位次字段（DR-118 只记位次带），
    // 于是它必须留在 C 类面板里，而不是被悄悄扔掉或伪装成 0。
    expect(canonicalColumnOf('baidu_ziyuan', '平均排名')).toBeNull();
    expect(canonicalColumnOf('gsc', 'Position')).toBeNull();
    expect(canonicalColumnOf('bing_wmt', 'Grounding Queries')).toBeNull();
  });

  it('我们自己的模板列名与规范列同名 ⇒ 认得（identity 兜底，大小写与首尾空白不敏感）', () => {
    expect(canonicalColumnOf('manual', 'impressions')).toBe('impressions');
    expect(canonicalColumnOf('manual', ' Impressions ')).toBe('impressions');
    expect(canonicalColumnOf('manual', 'CITATIONS')).toBe('citations');
    expect(canonicalColumnOf('manual', 'page_url')).toBe('page_url');
  });

  it('空表头一律认不出（不许把空列名当成某一列）', () => {
    expect(canonicalColumnOf('gsc', '')).toBeNull();
    expect(canonicalColumnOf('gsc', '   ')).toBeNull();
  });

  it('alias_columns 是映射表的投影，不是第二份手抄（DR-108 ↔ DR-107 单一真值源）', () => {
    const aliases = aliasColumnsOf('baidu_ziyuan_ai');
    expect(aliases['AI引用量']).toBe('citations');
    expect(Object.keys(aliases)).toHaveLength(mappingRowsFor('baidu_ziyuan_ai').length);
  });
});

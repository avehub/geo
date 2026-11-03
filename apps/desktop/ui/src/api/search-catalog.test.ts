/**
 * 源目录表的判据（spec DR-108：**加一个源只加数据、不改页面**）。
 *
 * 钉五件事：① 9 个 kind 全覆盖且不重复（含二期那两个）；② `phase: 2` 的**不进渲染集**
 * （渲染一个永远点不动的入口 = 让用户以为是自己配错了，DR-92）；③ 百度《AI 流量分析》的
 * 官方列名对照**逐字**在目录表里（一级出处：`fixtures/search/` 的两份空表）；
 * ④ 没有官方接口的源**不许**出现 `api` 这一档（DR-93 / DR-114 / AGENTS 规则 11：
 * 自动化程度到 `paste_parse` 为止）；⑤ 每个 label / 口径说明的 i18n key 在**两侧**词典里都存在
 * （裸键上屏是这一页最容易犯的错，`enum-label-prefixes.test.ts` 守的是同一类缺陷）。
 */
import { describe, expect, it } from 'vitest';

import enUS from '../i18n/locales/en-US';
import zhCN from '../i18n/locales/zh-CN';
import {
  SEARCH_SOURCE_CATALOG,
  catalogByGroup,
  catalogEntryOf,
  renderableCatalog,
  resolveDataThrough,
  searchSecretRef,
} from './search-catalog';
import { SEARCH_INGEST_MODE_VALUES, SEARCH_SOURCE_VALUES } from './types-search';
import type { SearchSourceKind } from './types-search';

/** 按点号路径在词典里取叶子；取不到回 `null`（判据要的是"存在且非空"）。 */
function dictionaryLeaf(tree: unknown, key: string): string | null {
  let node: unknown = tree;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' && node !== '' ? node : null;
}

describe('目录表覆盖面（DR-108：加源只加数据）', () => {
  it('9 个 kind 各一行，不多不少', () => {
    expect(SEARCH_SOURCE_CATALOG).toHaveLength(SEARCH_SOURCE_VALUES.length);
    expect(SEARCH_SOURCE_CATALOG.map((entry) => entry.kind).sort()).toEqual(
      [...SEARCH_SOURCE_VALUES].sort(),
    );
  });

  it('每个 kind 都查得到自己那一行', () => {
    for (const kind of SEARCH_SOURCE_VALUES) {
      expect(catalogEntryOf(kind).kind, `${kind} 查不到目录行`).toBe(kind);
    }
  });
});

describe('分组与分期（DR-92 / DR-104）', () => {
  it('百度统计单独成 analytics 补充组，其余按 region 落进国内 / 海外两段', () => {
    const groupOf = (kind: SearchSourceKind) => catalogEntryOf(kind).group;
    expect(groupOf('baidu_tongji')).toBe('analytics');
    expect(groupOf('gsc')).toBe('webmaster_global');
    expect(groupOf('bing_wmt')).toBe('webmaster_global');
    for (const kind of ['baidu_ziyuan_ai', 'baidu_ziyuan', 'toutiao', 'sogou', 'so_360', 'manual'] as const) {
      expect(groupOf(kind), `${kind} 应当在国内段`).toBe('webmaster_cn');
    }
  });

  it('渲染集按三段顺序给出，且 analytics 段只有百度统计', () => {
    expect(catalogByGroup().map((section) => section.group)).toEqual([
      'webmaster_cn',
      'webmaster_global',
      'analytics',
    ]);
    const analytics = catalogByGroup().find((section) => section.group === 'analytics');
    expect(analytics?.entries.map((entry) => entry.kind)).toEqual(['baidu_tongji']);
  });

  it('搜狗 / 360 是二期：枚举与目录行齐全，但不进渲染集', () => {
    expect(catalogEntryOf('sogou').phase).toBe(2);
    expect(catalogEntryOf('so_360').phase).toBe(2);
    const rendered = renderableCatalog().map((entry) => entry.kind);
    expect(rendered).not.toContain('sogou');
    expect(rendered).not.toContain('so_360');
    expect(rendered).toHaveLength(SEARCH_SOURCE_VALUES.length - 2);
    for (const entry of renderableCatalog()) expect(entry.phase).toBe(1);
  });
});

describe('接入形态（DR-93 / DR-113 / DR-114）', () => {
  it('三家走官方接口授权，其余一律 none（凭据形态与取数方式是两个正交维度）', () => {
    for (const kind of ['gsc', 'bing_wmt', 'baidu_tongji'] as const) {
      expect(catalogEntryOf(kind).auth_mode, `${kind} 应当是 oauth`).toBe('oauth');
    }
    for (const kind of ['baidu_ziyuan_ai', 'baidu_ziyuan', 'toutiao', 'sogou', 'so_360', 'manual'] as const) {
      expect(catalogEntryOf(kind).auth_mode, `${kind} 不需要授权`).toBe('none');
    }
  });

  it('🔴 没有官方接口的源不许出现 api 这一档（自动化程度到 paste_parse 为止，规则 11）', () => {
    for (const entry of SEARCH_SOURCE_CATALOG) {
      const hasApi = entry.ingest_modes.includes('api');
      expect(hasApi, `${entry.kind} 没有读数接口却挂了 api`).toBe(entry.auth_mode === 'oauth');
      for (const mode of entry.ingest_modes) {
        expect(SEARCH_INGEST_MODE_VALUES, `${entry.kind} 出现了词表外的取数形态`).toContain(mode);
      }
    }
  });

  it('粘贴解析是无接口源的主路径（DR-113：界面上是主按钮），manual 只有人工填报', () => {
    for (const kind of ['baidu_ziyuan_ai', 'baidu_ziyuan', 'toutiao', 'sogou', 'so_360'] as const) {
      expect(catalogEntryOf(kind).ingest_modes, `${kind} 缺 paste_parse`).toContain('paste_parse');
    }
    expect(catalogEntryOf('manual').ingest_modes).toEqual(['manual_entry']);
  });

  it('凭据引用串是账号级**两段**（DR-96：与 E-56 那个三段串方向相反）', () => {
    expect(searchSecretRef('gsc')).toBe('keyring://search/gsc');
    expect(searchSecretRef('baidu_tongji')).toBe('keyring://search/baidu_tongji');
    // 🔴 两段（`search/<kind>`）而不是三段：`parse_secret_ref` 只吃两段（E-56 的教训）。
    expect(searchSecretRef('gsc').replace('keyring://', '').split('/')).toHaveLength(2);
  });
});

describe('列名对照（DR-108 的 alias_columns，出处见 search-mapping.ts）', () => {
  it('百度《AI 流量分析》官方五列 + 页面表首列逐字在目录表里', () => {
    const aliases = catalogEntryOf('baidu_ziyuan_ai').alias_columns;
    expect(aliases['关键词']).toBe('query');
    expect(aliases['AI引用量']).toBe('citations');
    expect(aliases['AI曝光量']).toBe('impressions');
    expect(aliases['AI点击量']).toBe('clicks');
    expect(aliases['AI点击率']).toBe('ctr_check');
    expect(aliases['页面']).toBe('page_url');
  });

  it('目录表的对照 == 映射表的投影（不许各写一份）', () => {
    // 这条判据钉的是"单一真值源"：目录行里的对照直接由 search-mapping 的表派生。
    expect(catalogEntryOf('gsc').alias_columns['Impressions']).toBe('impressions');
    expect(catalogEntryOf('baidu_ziyuan').alias_columns['展现量']).toBe('impressions');
    // 刻意没有别名的源：空对照是合法结论（认列只剩"与模板同名"这条兜底）。
    expect(catalogEntryOf('bing_wmt').alias_columns).toEqual({});
    expect(catalogEntryOf('baidu_tongji').alias_columns).toEqual({});
  });
});

describe('数据截至规则（DR-108 / DR-109）', () => {
  it('GSC 取官方"约 2~3 天"的上界，百度统计近实时，灰度期的百度 AI 面不假设延迟', () => {
    expect(catalogEntryOf('gsc').data_through_rule.lag_days).toBe(3);
    expect(catalogEntryOf('baidu_tongji').data_through_rule.lag_days).toBe(0);
    expect(catalogEntryOf('baidu_tongji').data_through_rule.cadence).toBe('near_realtime');
    expect(catalogEntryOf('baidu_ziyuan_ai').data_through_rule.cadence).toBe('unknown');
    for (const entry of SEARCH_SOURCE_CATALOG) {
      expect(entry.data_through_rule.lag_days, `${entry.kind} 的延迟天数不合法`).toBeGreaterThanOrEqual(0);
    }
  });

  it('数据截至日 = 平台可用日与导出区间末日里**更早**的那个（DR-109）', () => {
    // 导出周期到 9/30，但平台只更新到 9/28（延迟 3 天，导入发生在 10/01）⇒ 以 9/28 为准。
    expect(
      resolveDataThrough('gsc', { period_end: '2026-09-30', imported_at: '2026-10-01T02:00:00Z' }),
    ).toBe('2026-09-28');
    // 平台比区间还新 ⇒ 以区间末日为准（不能凭空多算三天）。
    expect(
      resolveDataThrough('gsc', { period_end: '2026-09-10', imported_at: '2026-10-01T02:00:00Z' }),
    ).toBe('2026-09-10');
    // 近实时的源：导入当天就是数据截至日。
    expect(
      resolveDataThrough('baidu_tongji', {
        period_end: '2026-10-05',
        imported_at: '2026-10-01T02:00:00Z',
      }),
    ).toBe('2026-10-01');
  });
});

describe('绑定与文档链接', () => {
  it('绑定字段只用 siteUrl / siteId 两个（非敏感，DR-96），人工填报没有绑定', () => {
    expect(catalogEntryOf('gsc').binding_fields).toEqual(['siteUrl']);
    expect(catalogEntryOf('baidu_tongji').binding_fields).toEqual(['siteId']);
    expect(catalogEntryOf('manual').binding_fields).toEqual([]);
    for (const entry of SEARCH_SOURCE_CATALOG) {
      for (const field of entry.binding_fields) {
        expect(['siteUrl', 'siteId'], `${entry.kind} 的绑定字段会收敏感信息`).toContain(field);
      }
    }
  });

  it('文档链接要么没有（manual），要么是 https（界面上是可点的出处）', () => {
    expect(catalogEntryOf('manual').docs_url).toBeNull();
    for (const entry of SEARCH_SOURCE_CATALOG) {
      if (entry.docs_url !== null) {
        expect(entry.docs_url.startsWith('https://'), `${entry.kind} 的 docs_url 不是 https`).toBe(true);
      }
    }
  });
});

describe('i18n key 不许裸奔（规则 7）', () => {
  it('每行的 label / 口径说明在 zh-CN 与 en-US 两侧都解析得出非空叶子', () => {
    for (const entry of SEARCH_SOURCE_CATALOG) {
      for (const key of [entry.label_key, entry.metric_notes_key]) {
        expect(dictionaryLeaf(zhCN, key), `zh-CN 缺 ${key}`).not.toBeNull();
        expect(dictionaryLeaf(enUS, key), `en-US 缺 ${key}`).not.toBeNull();
      }
    }
  });

  it('label key 的命名口径 == enumLabel 的前缀 + kind（词典那一节就是这么写的）', () => {
    expect(catalogEntryOf('gsc').label_key).toBe('webmasterData.sources.gsc');
    expect(catalogEntryOf('gsc').metric_notes_key).toBe('webmasterData.metricNotes.gsc');
  });
});

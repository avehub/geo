/**
 * 常驻守卫：**源码里用到的每一个 `enumLabel` 命名空间，都必须在 zh-CN 与 en-US 词典里真的存在。**
 *
 * # 为什么需要这一层（本轮实测抓到的破绽形状）
 * `enumLabel(t, '<prefix>', id)` 的前缀是**字面量**，但 id 是数据 ⇒ 键是拼出来的。
 * 于是「前缀写错一个字母」在类型系统里完全合法、在 `dictionary.test.ts`（只管两侧对齐）里也
 * 完全合法，运行期只会**静默回退成 id 本身**：界面上就出现 `pending_review` 这种裸枚举值。
 * 本轮实测就是这么漏的——`components/ContentPanel.tsx` 查的是 `entity.contentStatuses`，
 * 而词典里那一节叫 `action.contentStatuses`，两个文件各自都"对"。
 *
 * `enum-label.test.tsx` 钉的是**具体某个枚举**的五段式哨兵（M1/M2 那几张表），
 * 它不可能覆盖将来新增的命名空间；本文件反过来，管的是**前缀这个层面**的全集。
 *
 * # 判据形状
 * 从生产源码里用正则捞出全部 `enumLabel(t, '…'` 的字面前缀（`import.meta.glob` + `?raw`，
 * 与 `no-hardcoded-strings.test.ts` 同一套扫描面口径：排除 `.test.` 与词典自身），
 * 逐个在两侧词典里按点号路径解析，要求解析出一个**非空、叶子全为非空字符串**的对象。
 *
 * 🔴 前缀清单**逐字钉死**（内容 + 条数）：清单就是本守卫的扫描面自证。
 * 少一个前缀说明正则退化成了空跑；多一个说明新增了命名空间 ⇒ 必须回来确认两侧都补齐了。
 */
import { describe, expect, it } from 'vitest';

import enUS from './locales/en-US';
import zhCN from './locales/zh-CN';

/** 生产源码全集（与 `no-hardcoded-strings.test.ts` 的 `SOURCES` 同口径）。 */
const SOURCES = import.meta.glob(
  ['../**/*.{ts,tsx}', '../App.tsx', '../main.tsx', '!../**/*.test.*', '!./locales/**'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** `enumLabel(t, '<prefix>'`：只认字面前缀（动态拼出来的前缀本守卫看不见，也不该出现）。 */
const ENUM_LABEL_CALL = /enumLabel\(\s*t\s*,\s*'([^']+)'/g;

const USED_PREFIXES: string[] = (() => {
  const found = new Set<string>();
  for (const source of Object.values(SOURCES)) {
    for (const match of source.matchAll(ENUM_LABEL_CALL)) found.add(match[1]);
  }
  return [...found].sort();
})();

/**
 * 今天用到的全部命名空间（清单本体逐字钉在下面，条数由末尾那条 `toHaveLength` 持有）。
 *
 * Plan B Task 3 加了 4 个（`common.languages` 界面语言、`settings.themes` 主题档、
 * `settings.fontScales` 字号档、`settings.permissions` 系统权限状态）；Task 4 加了
 * `settings.protocols`（自定义服务商的模型协议，键名 == `MODEL_PROTOCOL_VALUES`）。
 * M1.5 素材层加了 2 个（`library.kinds` 关键词类型、`library.sources` 素材来源，两页共用）。
 * M6 文章管理加了 4 个（`article.freqs` 排期频率、`article.slots` 提示词槽位、
 * `article.sources` 方向与文章的来源、`article.statuses` 文章评审态，spec 2026-10-10 · DR-88）。
 * M5.5 站长数据加了 **9** 个（`webmasterData.authModes` 接入方式、`.completeness` 完整性旗标、
 * `.groups` 数据源分组、`.ingestModes` 取数形态、`.opportunity.statuses` 机会处置态、
 * `.pivots` 透视维度、`.sources` 平台名、`.surfaces` 搜索面、`.windowSources` 区间出处，
 * spec 2026-10-12 · DR-91 / DR-107 / DR-112）。🔴 其中 `.sources` 是**平台专名**（百度搜索资源平台 /
 * Google Search Console / Bing Webmaster Tools …）：它进枚举命名空间而不是散在文案里，
 * 是为了让"平台名在两种语言下都逐字受控"（规则 7 + 走查第 17 条）。
 * 🔴 二期源（搜狗 / 360）的键**本轮就在词典里**（DR-108：加源只加数据、不改页面），
 * 所以 `.sources` 这一档的条数比界面上渲染出来的源多两个——这不是残留，是刻意的。
 *
 * ⚠ 变更这里之前先想清楚：新增一条 = 新增了枚举命名空间（两侧词典都要补齐）；
 * 减少一条 = 要么某个枚举不再上屏，要么**调用点被删/改名了**（后者正是本守卫要拦的形状）。
 */
const EXPECTED_PREFIXES = [
  'action.attribution.metrics',
  'action.categories',
  'action.contentStatuses',
  'action.levels',
  'action.statuses',
  'action.templateSections',
  'action.templates.kinds',
  // M6 文章管理的四张标签表（DR-88 点名这四个前缀走 `enumLabel`）。
  // 🔴 `article.statuses` 与 `action.contentStatuses` 三档取值同形但**刻意两张表**：
  // 一边是"稿子能不能交付"，一边是"处方内容审没审"，各自演进（理由见 `locales/zh-CN/article.ts`）。
  'article.freqs',
  'article.slots',
  'article.sources',
  'article.statuses',
  'collection.channels',
  'collection.engines',
  'collection.failureReasons',
  'collection.sourceTypes',
  'collection.statuses',
  'collection.taskStatuses',
  'common.exportFormats',
  'common.languages',
  'common.sampleSizeGrades',
  'common.sentiments',
  'diagnosis.alerts.kinds',
  'diagnosis.alerts.metrics',
  'diagnosis.alerts.severities',
  'diagnosis.dimensions.names',
  'diagnosis.funnel.stages',
  'entity.fieldStatuses',
  'entity.fields',
  'insight.channels',
  'insight.correctedFields',
  'insight.issueStatuses',
  'insight.kinds',
  'insight.risks',
  'insight.roles',
  // M1.2 知识层的三张标签表（模块 / 素材形式 / 来源）。审核态与字段可信状态**刻意不在这里**：
  // 它们分别复用 `action.contentStatuses` 与 `entity.fieldStatuses`（spec 2026-10-01 · DR-70），
  // 两处都已有前缀 ⇒ 知识库不新写一份（这正是本守卫要拦的"同一个枚举两张标签表"）。
  'kb.kinds',
  'kb.modules',
  'kb.scenarios',
  'kb.sources',
  // M1.5 素材层的两张标签表（关键词类型 / 素材来源，`library.kinds` 与 `library.sources`）
  'library.kinds',
  'library.sources',
  'project.industries',
  'prompt.intents',
  'prompt.sampleSize.warnings',
  'prompt.sources',
  'report.columns',
  'report.metrics',
  'report.sections',
  'report.variantHints',
  'report.variants',
  'settings.fontScales',
  'settings.permissions',
  'settings.protocols',
  'settings.providers',
  'settings.themes',
  // M6.5 站点接入与补丁工作台的 13 张标签表（通道 / 补丁 / 凭据 / 页面清单等）。
  'site.channelKinds',
  'site.channelStatuses',
  'site.channels.about',
  'site.channels.endpointPlaceholder',
  'site.credentialsStates',
  'site.eventKinds',
  'site.export.about',
  'site.export.kinds',
  'site.ownerships',
  'site.pages.roles',
  'site.patchKinds',
  'site.patchStatuses',
  'site.platforms',
  'webmasterData.authModes',
  'webmasterData.completeness',
  'webmasterData.groups',
  'webmasterData.ingestModes',
  'webmasterData.opportunity.statuses',
  'webmasterData.pivots',
  'webmasterData.sources',
  'webmasterData.surfaces',
  'webmasterData.windowSources',
] as const;

/** 按点号路径解析；任何一段不是对象就回 `null`（`entity.contentStatuses` 就是这么被抓住的）。 */
function resolvePath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) return null;
  }
  return current;
}

/** 这一节是不是一个「非空、叶子全为非空字符串」的标签表。 */
function isLabelTable(node: unknown): boolean {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return false;
  const entries = Object.entries(node as Record<string, unknown>);
  return entries.length > 0 && entries.every(([, value]) => typeof value === 'string' && value !== '');
}

describe('i18n · enumLabel 命名空间守卫', () => {
  it('防空跑：扫描面真的捞到了前缀，且清单逐字钉死', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(60);
    expect(USED_PREFIXES.length).toBeGreaterThanOrEqual(30);
    expect(USED_PREFIXES).toEqual([...EXPECTED_PREFIXES]);
    expect(EXPECTED_PREFIXES).toHaveLength(76);
  });

  it('每个前缀在 zh-CN 与 en-US 两侧都解析出一张非空标签表', () => {
    const missing: string[] = [];
    for (const prefix of USED_PREFIXES) {
      if (!isLabelTable(resolvePath(zhCN, prefix))) missing.push(`zh-CN.${prefix}`);
      if (!isLabelTable(resolvePath(enUS, prefix))) missing.push(`en-US.${prefix}`);
    }
    expect(missing, '这些 enumLabel 前缀在词典里不存在（运行期会静默回退成裸枚举 id）').toEqual([]);
  });

  it('🔴 前缀本身不在扫描面里（`entity.contentStatuses` 那个破绽的形状已消除）', () => {
    expect(USED_PREFIXES).not.toContain('entity.contentStatuses');
    // 它对应的那一节真名在这里，两侧都有。
    expect(isLabelTable(resolvePath(zhCN, 'action.contentStatuses'))).toBe(true);
    expect(isLabelTable(resolvePath(enUS, 'action.contentStatuses'))).toBe(true);
  });

  it('自证（对照组）：写错一个字母的前缀解析不出来，判据不是永真', () => {
    expect(resolvePath(zhCN, 'action.contentStatuses')).not.toBeNull();
    expect(resolvePath(zhCN, 'action.contentStatuse')).toBeNull();
    expect(resolvePath(zhCN, 'entity.contentStatuses')).toBeNull();
    expect(isLabelTable(resolvePath(zhCN, 'action'))).toBe(false);
    expect(isLabelTable(resolvePath(zhCN, 'action.statuses.todo'))).toBe(false);
  });
});

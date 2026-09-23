/**
 * `AssetKind` 的**跨语言 / 跨端一致性**哨兵（#24，台账 #13）。
 *
 * # 为什么必须有这一份
 * Task 9b 把前端那张 `ASSET_KIND_LABELS` 删掉了（零消费者），但删之前它是**漂的**：
 * 后端 `AssetKind::Baike.label_zh()` = `百科词条`，前端表写的是 `百科`。
 * 删表把漂移藏起来了，没有把它钉住——将来谁恢复资产 UI（`api/types.ts:88-91` 那条注释
 * 已经在指路），照旧会各写一份。所以这里把两侧**运行时解析**后钉在一起：
 * - zh 标签的真值源是 `crates/geo-domain/src/asset.rs` 的 `label_zh()`（**只读**，Rust 不改）；
 * - 稳定 id 的真值源是同文件的 `enum AssetKind` + `#[serde(rename_all = "snake_case")]`；
 * - 前端侧读 `src/api/types.ts` 的 `AssetKind` 字面量联合。
 *
 * # 三条判据（都不是「以缺席为判据」的永真式）
 * ① 变体 ↔ 联合成员**双向**相等（9 条，snake_case 换算规则本身也被钉住）；
 * ② `Baike` 的 zh 标签**逐字**是 `百科词条`，并且**不是**当初漂掉的那个 `百科`；
 * ③ 前端任何生产源码里出现**裸**「百科」（不是「百科词条」）⇒ 红。
 *   这一条是「漂移不许回来」的常驻守卫，对照组在最后一个用例里（塞一份进去必须被抓到）。
 */
import { describe, expect, it } from 'vitest';

import { readRepoFile } from '../test/repo-file';

const ASSET_RS = readRepoFile('crates', 'geo-domain', 'src', 'asset.rs');
const TYPES_TS = readRepoFile('apps', 'desktop', 'ui', 'src', 'api', 'types.ts');

/** 前端生产源码全集（含词典：漂移最可能落在词典里）。测试文件排除。 */
const UI_SOURCES = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.*'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** `pub enum AssetKind { … }` 的变体名（跳过 `#[default]` 这类属性行）。 */
function rustVariants(source: string): string[] {
  const body = /pub enum AssetKind \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
  return [...body.matchAll(/^\s{4}([A-Z][A-Za-z0-9]*),\s*$/gm)].map((match) => match[1]);
}

/** `label_zh()` 的 `Self::X => "…"` 全表。 */
function rustLabelsZh(source: string): Map<string, string> {
  // `\s{4}` 而不是四个字面空格：eslint 的 no-regex-spaces 会拦连续空格（数不准，也容易被格式化改掉）
  const body = /pub fn label_zh\(&self\) -> &'static str \{([\s\S]*?)\n\s{4}\}/.exec(source)?.[1] ?? '';
  const labels = new Map<string, string>();
  for (const match of body.matchAll(/Self::([A-Z][A-Za-z0-9]*)\s*=>\s*"([^"]*)"/g)) {
    labels.set(match[1], match[2]);
  }
  return labels;
}

/** `#[serde(rename_all = "snake_case")]` 的换算（`OwnedPage` → `owned_page`）。 */
function snakeCase(variant: string): string {
  return variant.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** `export type AssetKind = 'a' | 'b';` 的字面量成员。 */
function unionMembers(source: string): string[] {
  const body = /export type AssetKind =([\s\S]*?);/.exec(source)?.[1] ?? '';
  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
}

/**
 * 裸「百科」（后面不接「词条」）的命中清单。
 *
 * ⚠ 刻意**不带 `g` 标志**：带 `g` 的正则是有状态的（`lastIndex` 跨调用累加），
 * 同一个正则对象反复 `.test()` 会漏掉第二次之后的命中——判据会变成看调用顺序的假绿。
 */
const BARE_BAIKE = /百科(?!词条)/;

function bareBaikeHits(entries: ReadonlyArray<readonly [string, string]>): string[] {
  return entries
    .filter(([, source]) => BARE_BAIKE.test(source))
    .map(([path]) => path)
    .sort();
}

const VARIANTS = rustVariants(ASSET_RS);
const LABELS_ZH = rustLabelsZh(ASSET_RS);
const FRONTEND_IDS = unionMembers(TYPES_TS);

describe('#24 · AssetKind 的跨端一致性（后端是真值源）', () => {
  it('防空跑：Rust 侧解析出 9 个变体、9 条 zh 标签，且换算规则确实挂着 snake_case', () => {
    expect(VARIANTS).toHaveLength(9);
    expect(LABELS_ZH.size).toBe(9);
    expect([...LABELS_ZH.keys()].sort()).toEqual([...VARIANTS].sort());
    // 换算前提本身也要钉：serde 属性一改，下面的 id 比对就失去意义（会静默变成两套东西）
    const attrs = /((?:^#\[.*\]\n)+)pub enum AssetKind/m.exec(ASSET_RS)?.[1] ?? '';
    expect(attrs).toContain('#[serde(rename_all = "snake_case")]');
  });

  it('前端 `AssetKind` 联合与 Rust 变体**双向**相等（id 就是 snake_case 变体名）', () => {
    const expected = VARIANTS.map(snakeCase).sort();

    expect(FRONTEND_IDS).toHaveLength(9);
    expect({
      缺失: expected.filter((id) => !FRONTEND_IDS.includes(id)),
      多出: FRONTEND_IDS.filter((id) => !expected.includes(id)),
    }).toEqual({ 缺失: [], 多出: [] });
  });

  it('Baike 的 zh 标签逐字是「百科词条」，不是当初漂掉的「百科」', () => {
    expect(LABELS_ZH.get('Baike')).toBe('百科词条');
    expect(LABELS_ZH.get('Baike')).not.toBe('百科');
    // 整表也钉一遍：真值源改了这里就红，逼着来的人重新对账（而不是静默跟着改）
    expect(Object.fromEntries(LABELS_ZH)).toEqual({
      OwnedPage: '自有页面',
      Baike: '百科词条',
      Zhihu: '知乎',
      Xiaohongshu: '小红书',
      Baijiahao: '百家号',
      IndustryMedia: '行业媒体',
      Ecommerce: '电商详情页',
      SocialAccount: '社媒账号',
      Other: '其他',
    });
  });

  it('前端生产源码里一处裸「百科」都没有（漂移不许回来）', () => {
    // 防空跑：扫描面真的覆盖到了前端源码，不是空集（glob 相对本文件 ⇒ 同目录是 `./types.ts`）
    const paths = Object.keys(UI_SOURCES);
    expect(paths.length, '扫描面塌了').toBeGreaterThanOrEqual(50);
    expect(paths).toContain('./types.ts');
    expect(paths).toContain('../i18n/locales/zh-CN/entity.ts');

    expect(
      bareBaikeHits(Object.entries(UI_SOURCES)),
      '出现裸「百科」⇒ 与后端 AssetKind::label_zh() 漂移（要写就写全「百科词条」）',
    ).toEqual([]);
  });

  it('自证（对照组）：往任一前端文件塞一个裸「百科」会被扫出来，写全「百科词条」则放行', () => {
    expect(bareBaikeHits([['../planted.ts', "const label = '百科';"]])).toEqual(['../planted.ts']);
    expect(bareBaikeHits([['../planted.ts', "const label = '百科词条';"]])).toEqual([]);
  });
});

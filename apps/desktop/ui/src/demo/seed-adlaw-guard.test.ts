/**
 * P1-02：demo 种子语料的**规则 6 自动守卫**（广告法绝对化用语）。
 *
 * # 为什么要有这一条
 * 规则 6 禁止 UI 与生成内容出现「保证排名 / 霸屏 / 第一 / 最」一类绝对化用语，Rust 侧有
 * `compliance::check()` 在生成、编辑与 CSV 导入三条路上真扫；但 **demo 种子语料**是手写静态数据，
 * 从来不经过那条管线——写种子的人打了一句「排名第一」，界面上就真上屏了，而且没有任何东西会红。
 * 本文件把种子语料钉在同一个词表上，让规则 6 在 demo 侧也有自动守卫。
 *
 * # 三条刻意的设计选择
 * 1. **词表只有一份**：直接读 Rust `compliance.rs` 里 `include_str!` 的同一个文件
 *    `crates/geo-domain/data/adlaw_terms.txt`（走 `test/repo-file.ts`）。前端**不抄**词表——
 *    抄一份就会漂（P3-07：`bannedZh` 比权威词表少 22 条，就是这么来的）。
 * 2. **扫导出值，不扫源码**：`import.meta.glob('./seed/*.ts', { eager: true })` 拿到种子模块，
 *    递归取导出值里的每一个字符串叶子。正则扫源码会同时命中注释与标识符（噪声），
 *    也会漏掉运行时拼出来的串（`[...A, ...B]`、`Object.fromEntries`）；扫值只看真正会上屏的数据。
 * 3. **豁免是「值判据」而不是「文件判据」**：见 `ALLOWLIST`。整文件豁免等于给某个种子模块开
 *    永久后门；这里每条豁免都同时钉住 module + 叶子路径形状 + 值里的原句，值一改就自动失效变红，
 *    必须重新给理由。
 *
 * # 判据非永真（防空转）
 * 全绿的形态有四种假的：词表读空、glob 没匹配到文件、扫描函数根本不看值、豁免表把一切都放行。
 * 因此配了：词表条数下界（≥30）+ 模块数与字符串叶子数下界 + 三条反向探针
 * （裸红线串必须红；kb 路径但缺守则原句必须红；`100%` 落在别的列必须红）
 * + 「每条豁免规则必须真的被用到」（陈旧豁免会被点名）。
 */
import { describe, expect, it } from 'vitest';

import { readRepoFile } from '../test/repo-file';
import { ENGINE_COLUMN_KEYS } from './seed/reports';

/**
 * 权威词表（单一真值源 = `crates/geo-domain/src/compliance.rs` 的 `TERMS_SOURCE`）。
 * 解析规则与 Rust `terms()` 逐字一致：trim、去空行、去 `#` 注释。
 */
const ADLAW_TERMS: string[] = readRepoFile('crates', 'geo-domain', 'data', 'adlaw_terms.txt')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

/** 种子模块全集（转换期冻结，21 个文件；新增种子文件只会让这条更严）。 */
const SEED_MODULES = import.meta.glob('./seed/*.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

interface AllowRule {
  /** 被豁免的那一个红线词（一条规则只豁免一个词，不做「整类放行」）。 */
  term: string;
  /** 被豁免的那一个种子模块（glob key）。 */
  module: string;
  /** 叶子路径形状：精确到「哪个导出 + 哪个字段/列」，不给全模块放行。 */
  pathPattern: RegExp;
  /** 整串全等判据（纯数据面用）。与 `valueIncludes` 二选一，必须给出且只给出一个。 */
  valueEquals?: string;
  /**
   * 子串判据：值里必须**逐字**含有这段「引用禁语以禁止它」的原句。
   * 原句就是豁免理由本身——它被改掉时豁免自动失效，必须重新论证。
   */
  valueIncludes?: string;
  reason: string;
}

/**
 * 显式豁免表。两类，每条都写清理由：
 * - **(a) 引用禁语以禁止它**的合规守则 / 提示词类语料：这些串本身就是一条「不许这么说」的指令，
 *   禁语是被引用的对象，不是对外主张；
 * - **(b) 纯数据面**的 `100%`：报告引擎差异表的 `success_rate` 列，是采集成功率统计值，
 *   不是对效果或排名的承诺。
 */
const ALLOWLIST: AllowRule[] = [
  {
    term: '保证排名',
    module: './seed/remote.ts',
    pathPattern: /^REMOTE_COMPLIANCE\.terms\[\d+]\.term$/,
    valueEquals: '保证排名',
    reason:
      '(a) 远程合规词库的种子样例：`terms[].term` 字段本身就是被禁用的词，' +
      '它是**黑名单条目**而不是对外主张（真后端同一份数据由 `adlaw_terms` 扫描使用）。',
  },
  {
    term: '包上首页',
    module: './seed/remote.ts',
    pathPattern: /^REMOTE_COMPLIANCE\.terms\[\d+]\.term$/,
    valueEquals: '包上首页',
    reason:
      '(a) 同上：合规词库的 `term` 字段是黑名单条目，出现在这里正是为了被拦截。',
  },
  {
    term: '绝对',
    module: './seed/articles.ts',
    pathPattern: /^SEED_ARTICLE_TEMPLATES\[\d+]\.prompt_template$/,
    valueIncludes: '不使用绝对化表述',
    reason:
      '(a) 文章模板的提示词尾句「……不使用绝对化表述」是给模型的**写作约束**，' +
      '「绝对」出现在被禁止项的名称里，不是对外主张。',
  },
  {
    term: '排名第一',
    module: './seed/kb.ts',
    pathPattern: /^SEED_KB_ENTRIES\[\d+]\.body_markdown$/,
    valueIncludes: '等绝对化用语',
    reason:
      '(a) 知识库「对外表述守则」条目正文，逐字引用「保证达标」「排名第一」来**禁止**它们；' +
      '这是合规守则语料，不是营销文案。',
  },
  {
    term: '绝对',
    module: './seed/kb.ts',
    pathPattern: /^SEED_KB_ENTRIES\[\d+]\.body_markdown$/,
    valueIncludes: '等绝对化用语',
    reason: '(a) 同一条守则正文里的「绝对化用语」这个词组本身含「绝对」，与上一条同源。',
  },
  {
    term: '100%',
    module: './seed/reports.ts',
    // 只豁免引擎差异表的 success_rate 那一列（下面的用例把列号钉在 ENGINE_COLUMN_KEYS 上）。
    pathPattern: /^SEED_REPORTS\.[^.]+\.sections\.engines\[\d+]\.rows\[\d+]\[4]$/,
    valueEquals: '100%',
    reason:
      '(b) 报告引擎差异表 `success_rate` 列的统计值（采集成功率 100%），纯数据面；' +
      '不是对效果、排名或收益的承诺，且整串全等才豁免。',
  },
];

interface StringLeaf {
  module: string;
  exportName: string;
  path: string;
  value: string;
}

type Hit = StringLeaf & { term: string };

/** 递归深度上限：种子是纯数据，实际深度远低于此；上限只为兜住意外成环。 */
const MAX_DEPTH = 16;

/** 递归收集一个导出值里的全部字符串叶子（带可读路径，便于报点）。 */
function collectStrings(
  value: unknown,
  path: string,
  depth: number,
  seen: WeakSet<object>,
  out: Array<{ path: string; value: string }>,
): void {
  if (typeof value === 'string') {
    out.push({ path, value });
    return;
  }
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return;
  const object = value as object;
  // 同一个对象被两个导出共享（如 `[...A, ...B]`）时按导出各扫一次，只在单次递归里防环。
  if (seen.has(object)) return;
  seen.add(object);
  if (Array.isArray(object)) {
    object.forEach((entry, index) => {
      collectStrings(entry, `${path}[${index}]`, depth + 1, seen, out);
    });
    return;
  }
  for (const [key, entry] of Object.entries(object as Record<string, unknown>)) {
    collectStrings(entry, path === '' ? key : `${path}.${key}`, depth + 1, seen, out);
  }
}

/** 对单个字符串叶子跑权威词表，返回全部命中（与 Rust `compliance::scan` 同判据：子串命中）。 */
function scanLeaf(leaf: StringLeaf): Hit[] {
  const hits: Hit[] = [];
  for (const term of ADLAW_TERMS) {
    if (leaf.value.includes(term)) hits.push({ ...leaf, term });
  }
  return hits;
}

function seedLeaves(): StringLeaf[] {
  const leaves: StringLeaf[] = [];
  for (const [module, exports] of Object.entries(SEED_MODULES)) {
    for (const [exportName, value] of Object.entries(exports)) {
      const out: Array<{ path: string; value: string }> = [];
      collectStrings(value, exportName, 0, new WeakSet<object>(), out);
      for (const entry of out) {
        leaves.push({ module, exportName, path: entry.path, value: entry.value });
      }
    }
  }
  return leaves;
}

function matchesRule(hit: Hit, rule: AllowRule): boolean {
  if (rule.term !== hit.term || rule.module !== hit.module) return false;
  if (!rule.pathPattern.test(hit.path)) return false;
  if (rule.valueEquals !== undefined) return hit.value === rule.valueEquals;
  if (rule.valueIncludes !== undefined) return hit.value.includes(rule.valueIncludes);
  return false;
}

const allowingRule = (hit: Hit): AllowRule | undefined =>
  ALLOWLIST.find((rule) => matchesRule(hit, rule));

function formatHit(hit: Hit): string {
  return `- ${hit.module} · ${hit.path} · 命中「${hit.term}」\n  ${hit.value}`;
}

/** 反向探针用的假叶子：`exportName` 只参与报点，不参与豁免判据。 */
const leaf = (module: string, path: string, value: string): StringLeaf => ({
  module,
  exportName: path.split('.')[0] ?? '',
  path,
  value,
});

describe('demo 种子语料的广告法守卫（规则 6 / P1-02）', () => {
  it('权威词表真的读到了：条数下界 ≥30，且含已知红线词', () => {
    // 文件读空（路径写错 / 词表被清空）会让下面的扫描全绿——先把「读到了」钉住。
    expect(ADLAW_TERMS.length).toBeGreaterThanOrEqual(30);
    expect(ADLAW_TERMS).toContain('保证排名');
    expect(ADLAW_TERMS).toContain('排名第一');
    expect(ADLAW_TERMS).toContain('100%');
    expect(ADLAW_TERMS.every((term) => term !== '' && !term.startsWith('#'))).toBe(true);
  });

  it('扫描面真的覆盖了种子目录：模块数与字符串叶子数都有下界', () => {
    const modules = Object.keys(SEED_MODULES);
    expect(modules.length).toBeGreaterThanOrEqual(21);
    // 点名断言：glob 写错（例如 pattern 少了 `./`）时，上面那条 `>=` 未必红，这里必须红。
    expect(modules).toContain('./seed/kb.ts');
    expect(modules).toContain('./seed/articles.ts');
    expect(modules).toContain('./seed/reports.ts');
    expect(seedLeaves().length).toBeGreaterThan(1000);
  });

  it('报告 success_rate 列号与豁免规则里的列下标一致（豁免理由不靠注释自证）', () => {
    expect(ENGINE_COLUMN_KEYS[4]).toBe('success_rate');
  });

  it('任何种子字符串都不得命中广告法红线词（豁免仅限 ALLOWLIST）', () => {
    const hits = seedLeaves().flatMap(scanLeaf);
    const violations = hits.filter((hit) => allowingRule(hit) === undefined);
    // 先给可读清单，再给结构化断言：红的时候直接看得见是哪一条语料。
    expect(violations.map(formatHit).join('\n')).toBe('');
    expect(violations).toEqual([]);
  });

  it('每条豁免规则都真的被用到（陈旧豁免必须被点名删除）', () => {
    for (const rule of ALLOWLIST) {
      expect(
        [rule.valueEquals, rule.valueIncludes].filter((value) => value !== undefined).length,
        `豁免规则必须给出且只给出一个值判据：${rule.module} ${rule.term}`,
      ).toBe(1);
      const used = seedLeaves()
        .flatMap(scanLeaf)
        .some((hit) => matchesRule(hit, rule));
      expect(used, `豁免规则已失效（种子语料改了？）：${rule.module} · ${rule.term}`).toBe(true);
    }
  });

  it('反向探针 ①：裸红线串必须被判红，且不落在任何豁免里', () => {
    const probe = scanLeaf(leaf('./seed/__probe.ts', 'PROBE', '宏宇泵业保证排名第一，效果最佳'));
    const terms = probe.map((hit) => hit.term);
    // 三个词都在权威词表里：词表读空或扫描函数空转时，这条会先红。
    expect(terms).toContain('保证排名');
    expect(terms).toContain('排名第一');
    expect(terms).toContain('最佳');
    expect(probe.every((hit) => allowingRule(hit) === undefined)).toBe(true);
  });

  it('反向探针 ②：路径对得上但缺「引用禁语以禁止它」原句，仍必须红', () => {
    // 豁免钉的是原句，不是文件：同一字段里写一句真的违规文案不能借道放行。
    const probe = scanLeaf(
      leaf(
        './seed/kb.ts',
        'SEED_KB_ENTRIES[99].body_markdown',
        '本产品排名第一，效果最佳，客户首选。',
      ),
    );
    expect(probe.length).toBeGreaterThan(0);
    expect(probe.every((hit) => allowingRule(hit) === undefined)).toBe(true);
  });

  it('反向探针 ③：`100%` 落在 success_rate 之外的列必须红', () => {
    const probe = scanLeaf(
      leaf(
        './seed/reports.ts',
        'SEED_REPORTS.demo-round-baseline.sections.engines[0].rows[1][0]',
        '100%',
      ),
    );
    expect(probe.map((hit) => hit.term)).toContain('100%');
    expect(probe.every((hit) => allowingRule(hit) === undefined)).toBe(true);
  });
});

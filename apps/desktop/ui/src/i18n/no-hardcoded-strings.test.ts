/**
 * 存量文案抽取的三道扫描守卫（Plan A Task 8 建于组件层；Task 9 按裁定 B-1 把**抽取面**
 * 从 `components/` 扩到 `pages/` + `App.tsx` + `main.tsx`。计划正文步骤 1 + 裁定 B-1 / B-4）。
 *
 * # 为什么是「扫源码的测试」而不是 i18next 的 `CustomTypeOptions` 模块增强
 *
 * Task 6 刻意没做模块增强：`t` 必须是宽松的 `string` 入参，Task 7 的动态键
 * `` t(`errors.${code}`) `` 才写得出来（裁定 B-1）。代价是写死的 key 拼错也不报编译错，
 * 运行期原样露出裸 key，而 `fallbackLng` 只救「zh 有 en 漏」，救不了两侧都拼错的情况。
 * 于是这里用**静态扫描**补上：把源码里 `t('字面量')` 的 key 全抓出来，逐个对词典做成员判断。
 *
 * # 扫描实现选型：`import.meta.glob(…, { query: '?raw' })` 而不是 `node:fs`
 *
 * 两种都实测跑通、返回**逐字相同的 40 个文件**（证据见 task-8-report.md）。选 glob 的理由：
 * 1. `tsconfig.app.json` 的 `types` 不含 node，用 `node:fs` 就得像 `dictionary.test.ts` /
 *    `tailwind-sources.test.ts` 那样加 `/// <reference types="node" />` 把 @types/node 拉进
 *    **测试文件的编译面**；`import.meta.glob` 由 `vite/client` 提供类型，零额外依赖。
 * 2. 文件集在**转换期**冻结，不依赖运行期 cwd 或 `import.meta.url` 能否解析成真实目录
 *    （门禁命令的 cwd 是 `apps/desktop/ui`，但在仓库根直接跑 vitest 时是仓库根）。
 * 3. 排除项是一行可读的 glob 数组，而不是三个命令式 `.filter()` 谓词
 *    （`/\.test\./` 会匹配路径里任何位置、`includes('/i18n/locales/')` 依赖 posix 分隔符）。
 *
 * # 判据非永真（§E 的硬要求）
 *
 * 本文件的三条断言都以「某个输出的**缺席**」为判据，因此每条都配了对照组：
 * `stripComments` 真的放过注释里的 CJK、`literalTKeys` 真的跳过模板串与变量入参、
 * `missingKeys` 真的能报出改错一个字母的 key。见下面「自证」那几条用例。
 */
import { describe, expect, it } from 'vitest';

import { ENTITY_FIELDS } from '../components/entity-fields';
import { WIZARD_STEPS } from '../components/wizard-steps';
import enUS from './locales/en-US';
import zhCN from './locales/zh-CN';

/**
 * 生产源码全集：`src/**` 去掉测试文件、词典文件与 `resources.ts`。
 *
 * 词典文件本身当然含中文（它就是中文），`resources.ts` 只有类型；
 * 测试文件由 Task 15 的口径另行处理（存量断言钉的是 zh-CN 渲染结果）。
 */
const SOURCES = import.meta.glob(
  [
    '../**/*.{ts,tsx}',
    // 入口层两个文件显式列出：要让 `../**/*.tsx` 匹配到它们，得靠 globstar 吃掉「零个目录段」，
    // 这条语义不该只靠默认成立——写进 pattern 数组，再由下面那条 `toContain` 断言钉住。
    '../App.tsx',
    '../main.tsx',
    '!../**/*.test.*',
    '!./locales/**',
    '!./resources.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/**
 * **抽取面**（Task 9 裁定 B-1）：`components/` + `pages/` + 两个入口文件。
 *
 * 它比 `SOURCES`（glob 扫描面）**窄**，两者刻意不合一：
 * - `SOURCES` 负责「字面量 key 的拼写保护」，覆盖 `src/**` 全部生产源码；
 * - `EXTRACTION_SOURCES` 负责「注释之外不许有 CJK」，只覆盖已经抽过文案的那几层。
 *
 * 刻意**不含** `src/api/`：那里的中文是注释与诊断串（`problemsOf` 的问题标签只进
 * `console.warn` 与断言消息，不上屏），由 Task 15 的残留口径单独处置。
 *
 * ⚠ 这四个前缀就是「扫描面缩小」变异自证的注入点：拿掉 `'../pages/'`，
 * 下面 `pages/` 那条点名断言必须变红（防空跑的唯一非永真保障）。
 */
const EXTRACTION_ROOTS = ['../components/', '../pages/', '../App.tsx', '../main.tsx'] as const;

const EXTRACTION_SOURCES = Object.fromEntries(
  Object.entries(SOURCES).filter(([path]) => EXTRACTION_ROOTS.some((root) => path.startsWith(root))),
);

/**
 * 两个子集都从 `EXTRACTION_SOURCES` 派生（而不是从 `SOURCES`）：这样「把某一层的 root 从
 * `EXTRACTION_ROOTS` 里拿掉」会**同时**打红该层的点名断言与总量断言。
 * 若从 `SOURCES` 派生，缩小抽取面时点名断言仍然数得出那 5 个页面文件 ⇒ 变异自证抓不到。
 */
/** Task 8 的抽取面：`src/components/` 下的 19 个文件（17 个 .tsx + 2 个数据模块）。 */
const COMPONENT_SOURCES = Object.fromEntries(
  Object.entries(EXTRACTION_SOURCES).filter(([path]) => path.startsWith('../components/')),
);

/** Task 9 新纳入的抽取面：`src/pages/` 下的 5 个页面（页面测试已被 `SOURCES` 排除）。 */
const PAGE_SOURCES = Object.fromEntries(
  Object.entries(EXTRACTION_SOURCES).filter(([path]) => path.startsWith('../pages/')),
);

const CJK = /[\u4e00-\u9fa5]/;

/**
 * 去掉 JS/TS 源码里的注释，**保留字符串与模板串原样**（含其中的 `//`）。
 *
 * 为什么不用正则一把梭：`placeholder="http://127.0.0.1:7890"` 与
 * `extra="自动建档会抓取官网首页…"` 里的 `//` 会让「从 `//` 删到行尾」这种写法
 * 把真实代码一起吃掉，扫描就漏了。所以这里做一个 5 状态的线性扫描器。
 * 块注释里的换行**保留**，这样报出来的行号与原文件对齐。
 *
 * # 已知边界：不识别**正则字面量**（fix1 复审 #5；控制器裁定「只补注释，不加状态机」）
 *
 * 这台扫描器有 5 个状态（code / 行注释 / 块注释 / 单双引号 / 模板串），没有 regex 状态。
 * 错位条件是明确的：只有**内容里带引号或带行注释记号**的正则字面量才会让掩码跑偏
 * （扫描器把正则的收尾斜杠当普通字符、把它后面的引号当字符串起点）。
 *
 * ⚠ **错位之后两个方向都会出错**（fix1 复审 Minor B 的更正：这里原先只写了「不会误报」，是错的）：
 * - **漏报**：正则里含 `//` 时扫描器进入幻影 line 状态，从错位点到行尾的**真实代码**被当注释丢掉；
 * - **误报**：正则里含引号时扫描器进入幻影 quote 状态，而 quote / template 分支**只找终止引号、
 *   不再剥注释**，于是从错位点到下一个同种引号之间的**注释中文会被当成代码原样输出**
 *   ⇒ CJK 残留断言假红。
 *
 * 内容不含引号也不含行注释记号的正则字面量则完全无害：扫描器把它的斜杠与元字符
 * 当普通代码字符逐个原样输出，状态始终停在 code。
 *
 * 另一条结构性事实（复审席核过）：template 状态只对反引号退出、**不跟踪 `${`**，
 * 所以写在模板插值里的正则字面量对这台扫描器是**惰性**的——整段被当模板串原样输出，
 * 连「内容不含引号」这个前提都不需要。
 *
 * 实测（Task 9 扩面后重跑；命令与逐处核验见 task-9-report.md §B-1）：
 * - 普查范围是**整张 glob 扫描面**（`src/**` 去掉测试文件、`locales/`、`resources.ts`），
 *   而不是「本轮新加进来的目录」——fix1 就是在这里被写窄过一次。
 * - 触发形式命中 **11 处**：`api/error-text.ts` 5、`api/errors.ts` 4、
 *   `pages/PromptSetPage.tsx` 1、`components/CsvToolbar.tsx` 1。
 * - 其中 **8 处是真正则字面量**（`error-text.ts` 5 + `errors.ts` 3）。逐处机械核验内容：
 *   **8/8 既不含引号也不含 `//` ⇒ 0 处错位风险**，判据没有变弱。
 *   （其中 `api/errors.ts` 有一处写在模板串的插值里，核验脚本要能把反引号放行才看得见。）
 * - 另外 **3 处是 `.split('\n')` / `.split(';')`**：入参是**普通字符串字面量**、不是正则，
 *   quote 状态本来就正确处理它们 ⇒ 无害。
 *   ⚠ 顺带更正 fix1 的一条实测记录：它写「抽取面零命中、`rg` exit 1」，但那两处
 *   `.split('\n')` 确实在抽取面里、也确实匹配触发形式。**结论（0 处错位风险）不变，
 *   变的是命中计数**——所以这里只写核验结果，不写「本目录零正则字面量」这种会过期的断言。
 * - 本轮新写进 `pages/**` 与入口层的代码**没有引入任何正则字面量**。
 *
 * 为什么**不**现在就加 regex 状态：当前没有会让它出错的输入，加状态机只是增加复杂度与
 * 新的误判面（JSX 里的 `/`、除法、注释里的 URL 都要靠启发式区分）。
 *
 * ⚠ **Task 9 把抽取面扩到 `pages/` + `App.tsx`、或把 glob 扫描面再放宽时必须重跑这两条核验**：
 * (a) 触发形式清单（`rg 'RegExp\(|\.matchAll\(|\.match\(|\.replace\(|\.split\(|\.test\('`）；
 * (b) 对每个命中的字面量核「内容是否含引号或行注释记号」。
 * 一旦 (b) 出现真命中，**先补 regex 状态再扩面**，否则本文件的判据会静默变弱。
 */
function stripComments(source: string): string {
  let out = '';
  let index = 0;
  let state: 'code' | 'line' | 'block' | 'quote' | 'template' = 'code';
  let quote = '';

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        out += char;
      }
      index += 1;
      continue;
    }

    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code';
        index += 2;
        continue;
      }
      if (char === '\n') out += char;
      index += 1;
      continue;
    }

    if (state === 'quote' || state === 'template') {
      const terminator = state === 'template' ? '`' : quote;
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 2;
        continue;
      }
      if (char === terminator) state = 'code';
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      state = 'line';
      index += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block';
      index += 2;
      continue;
    }
    if (char === "'" || char === '"') {
      state = 'quote';
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '`') {
      state = 'template';
      out += char;
      index += 1;
      continue;
    }
    out += char;
    index += 1;
  }

  return out;
}

/** 注释之外仍含 CJK 的行号（1-based）。 */
function cjkLines(source: string): number[] {
  const hits: number[] = [];
  stripComments(source)
    .split('\n')
    .forEach((line, index) => {
      if (CJK.test(line)) hits.push(index + 1);
    });
  return hits;
}

/**
 * 抓出 `t('字面量')` / `t("字面量")` 的 key。
 *
 * 结尾接受 `,` 或 `)`：`t('a.b')` 与 `t('a.b', { row: 1 })` 都要抓，
 * 而模板串 `` t(`errors.${code}`) `` 与变量入参 `t(key)` **必须跳过**
 * ——后者是 Task 7 动态键的合法形态，报成拼写错误就是误判。
 */
const T_LITERAL_CALL = /\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]/g;

function literalTKeys(source: string): string[] {
  return [...stripComments(source).matchAll(T_LITERAL_CALL)].map((match) => match[2]);
}

function leafPaths(node: unknown, prefix = '', out: string[] = []): string[] {
  if (typeof node === 'string') {
    if (prefix !== '') out.push(prefix);
    return out;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      leafPaths(value, prefix === '' ? key : `${prefix}.${key}`, out);
    }
  }
  return out;
}

const ZH_KEYS = new Set(leafPaths(zhCN));
const EN_KEYS = new Set(leafPaths(enUS));

/** 一份源码里「词典查不到」的字面量 key（两侧都查，比 B-1 的最低要求更严）。 */
function missingKeys(source: string): string[] {
  return literalTKeys(source).filter((key) => !ZH_KEYS.has(key) || !EN_KEYS.has(key));
}

describe('扫描面本身（防空跑：glob 写错时「0 个文件全都干净」也是永真）', () => {
  it('扫到了 src 下全部生产源码，且排除了测试文件、词典与 resources.ts', () => {
    const paths = Object.keys(SOURCES);
    expect(paths.length).toBeGreaterThanOrEqual(38);
    expect(paths.filter((path) => path.includes('.test.'))).toEqual([]);
    expect(paths.filter((path) => path.includes('/locales/'))).toEqual([]);
    expect(paths.filter((path) => path.endsWith('resources.ts'))).toEqual([]);
    expect(paths.some((path) => path.endsWith('components/AppLayout.tsx'))).toBe(true);
    // Task 9 把入口层纳进抽取面，先证明它们真的在 glob 里（`../**/*.tsx` 能否匹配到
    // 上层同目录文件靠的是 globstar 吃掉零段，这条断言就是它的哨兵）。
    expect(paths).toContain('../App.tsx');
    expect(paths).toContain('../main.tsx');
  });

  it('components/ 下扫到了 19 个文件（17 个 .tsx + entity-fields.ts + wizard-steps.ts）', () => {
    const paths = Object.keys(COMPONENT_SOURCES);
    expect(paths).toHaveLength(19);
    expect(paths.filter((path) => path.endsWith('.tsx'))).toHaveLength(17);
  });

  // 裁定 B-1 要求的那条点名断言：抽取面里 `pages/` 恰好是 5 个页面文件。
  // 用 `toEqual` 而不是 `toHaveLength`：多一个页面（或 glob 意外把测试文件放进来）同样要报。
  it('B-1 · pages/ 下扫到的恰好是 5 个页面文件（把 pages 从抽取面拿掉，这条必须红）', () => {
    expect(Object.keys(PAGE_SOURCES).sort()).toEqual([
      '../pages/EntityCardPage.tsx',
      '../pages/ProjectListPage.tsx',
      '../pages/ProjectWizardPage.tsx',
      '../pages/PromptSetPage.tsx',
      '../pages/SettingsPage.tsx',
    ]);
  });

  it('B-1 · 抽取面 = components(19) + pages(5) + App.tsx + main.tsx，且不含 api/', () => {
    const paths = Object.keys(EXTRACTION_SOURCES);
    expect(paths).toHaveLength(26);
    expect(paths.filter((path) => path.startsWith('../api/'))).toEqual([]);
    expect(paths.filter((path) => EXTRACTION_ROOTS.some((root) => !path.startsWith(root))).length)
      .toBeGreaterThan(0);
  });
});

describe('Task 15 的残留判据提前到本轮：抽取面下只剩注释含中文', () => {
  it('components/ + pages/ + App.tsx + main.tsx 在注释之外不含任何 CJK 字符', () => {
    const offenders = Object.entries(EXTRACTION_SOURCES)
      .map(([path, source]) => ({ path, lines: cjkLines(source) }))
      .filter((entry) => entry.lines.length > 0)
      .map((entry) => `${entry.path}: ${entry.lines.join(', ')}`);

    expect(offenders, '这些行在注释之外仍含中文，必须迁进词典（Task 8 = components，Task 9 = pages + 入口层）')
      .toEqual([]);
  });

  it('自证（对照组）：注释里的中文放过，字符串与裸 JSX 文本里的中文抓到', () => {
    expect(cjkLines('// 这是行注释\nconst a = 1;')).toEqual([]);
    expect(cjkLines('/* 块注释\n   第二行也是注释 */\nconst a = 1;')).toEqual([]);
    expect(cjkLines("const label = '这是字面量';")).toEqual([1]);
    expect(cjkLines('<div>裸 JSX 文本</div>')).toEqual([1]);
    expect(cjkLines('const label = `模板串里的中文`;')).toEqual([1]);
    // 字符串里的 `//` 不得被当成行注释起点（否则后面真实的中文会被一起吃掉）
    expect(cjkLines('const url = "http://127.0.0.1"; // 注释\nconst b = "中文";')).toEqual([2]);
  });
});

describe('B-1 · 字面量 i18n key 的拼写保护', () => {
  it('生产源码里每个字面量形式的 t() 调用，其 key 在 zh-CN 与 en-US 两侧都存在', () => {
    const offenders = Object.entries(SOURCES)
      .map(([path, source]) => ({ path, keys: missingKeys(source) }))
      .filter((entry) => entry.keys.length > 0)
      .map((entry) => `${entry.path}: ${entry.keys.join(', ')}`);

    expect(offenders, '这些字面量 key 在词典里查不到（拼错或忘了建词条）').toEqual([]);
  });

  /**
   * 防空跑（fix1 复审 #4 / 裁定 4）：上面那条 offenders 断言在「**一个 key 都没抽到**」时是
   * **永真**的——`[].filter(...)` 恒为空数组。若 `T_LITERAL_CALL` 因源码格式变化整体失效，
   * 或 glob 键路径写错导致 `SOURCES` 取到空串，拼写保护就会静默消失而门禁仍然全绿。
   *
   * 三道守卫：总量下界（抓整体失效）、覆盖面下界（抓「只在个别文件上还能工作」）、
   * 点名样本（一个具体的、可失败的断言）。
   *
 * 实测（Task 10 重跑探针，输出见 task-10-report.md）：扫描面 **43** 个文件，
 * 其中 **21 个**抽出字面量 key，共 **279 个**（`components/` 180 + `pages/` 99）。
 * ⚠ 下面那 3 个 `toHaveLength` 是**扫描面精确计数**，不是可以放着不动的常量：
 * **新增或删除任何生产文件都必须同步改这里**（Task 10 就是因为这句没写下来，
 * 让实现者以为它属禁改范围、只能停下来请裁）。
 *
 * 下界按裁定 B-10.3 取「实测值减 10 后向下取整到十位」：
 * - **总量**：278 − 10 = 268 → **260**。
 * - **覆盖面**：⚠ 这里**不能**照搬同一条算式——20 − 10 = 10，比 fix1 定的 `>= 16` 还低，
 *   直接违反裁定 B-1 的「下界不许放宽」。B-10.3 对覆盖面的原话是「同理按扩面后的实测值
 *   **重设并留余量**」，所以按总量那条的**同一相对余量**（260/278 ≈ 93.5%）折算：
 *   20 × 0.935 ≈ 18.7 → 取 **18**（既高于旧下界 16，又留了 2 个文件的余量）。
 *   这条取舍已在报告里点名请控制器复核。
 *
 * 判据用 `>=` 而不是 `toBe`，所以以后加词条只会让它更宽松，不必回来改这里。
   *
 * ⚠ 已知覆盖边界（Task 9 复核后依然如此，**不是**本条守卫能兜的）：`src/api/errors.ts` 与
   * `src/api/error-text.ts` 抽出 **0** 个 key——它们的键是 `REASONS_PREFIX` / `CSV_REASONS_PREFIX`
   * 这类**常量拼接**后经 `render(t, key, values)` 消费的，`T_LITERAL_CALL` 结构上抓不到
   * （这与「跳过模板串/变量入参」是同一条设计取舍：宁可漏抓也不误判 Task 7 的动态键）。
   * 那批前缀常量的拼写由 `api/errors.test.ts` 的逐条**输出级**断言钉住。
   */
  it('防空跑：抽取器真的从真实源码里抽到了 key（总量 + 覆盖面 + 点名样本）', () => {
    const perFile = Object.entries(SOURCES).map(([path, source]) => ({
      path,
      keys: literalTKeys(source),
    }));
    const total = perFile.reduce((sum, entry) => sum + entry.keys.length, 0);
    const withKeys = perFile.filter((entry) => entry.keys.length > 0);

    expect(
      total,
      '字面量 key 总数低于下界 ⇒ 抽取器可能整体失效，offenders 断言会变成永真',
    ).toBeGreaterThanOrEqual(260);
    expect(
      withKeys.length,
      '抽出 key 的文件数低于下界 ⇒ 抽取器可能只在个别文件上还能工作',
    ).toBeGreaterThanOrEqual(18);

    // 点名样本：先钉 glob 键路径（写错一个字符 ⇒ 下一行取到 undefined 直接抛），再钉一个具体 key
    expect(Object.keys(SOURCES)).toContain('../components/AppLayout.tsx');
    expect(literalTKeys(SOURCES['../components/AppLayout.tsx'])).toContain('nav.projects');
    // Task 9 扩面后补一个**页面层**的点名样本：只钉 `components/` 的话，
    // 「抽取器在 pages/ 上失效」这件事三条守卫一条都抓不到。
    expect(Object.keys(SOURCES)).toContain('../pages/SettingsPage.tsx');
    expect(literalTKeys(SOURCES['../pages/SettingsPage.tsx'])).toContain('settings.page.save');
  });

  it('自证（对照组）：只抓字面量，模板串与变量入参被跳过', () => {
    const source = [
      "const a = t('common.save');",
      "const b = t('common.cancel', { row: 1 });",
      'const c = t(`errors.${code}`);',
      'const d = t(dynamicKey);',
      'const e = render(t, key, {});',
    ].join('\n');

    expect(literalTKeys(source)).toEqual(['common.save', 'common.cancel']);
  });

  it('自证（对照组）：把一个 key 改错一个字母，同一套判据就会报出来（非永真）', () => {
    expect(missingKeys("t('common.sav')")).toEqual(['common.sav']);
    expect(missingKeys("t('common.save')")).toEqual([]);
    // 只在单侧存在的 key 同样要报（B-1 的最低要求是 zh 侧，这里两侧都查）
    expect(missingKeys("t('nav.projects')")).toEqual([]);
  });
});

describe('B-4 · 词典条目必须跟得上数据表（扫描抓不到从数据表读出的变量 key）', () => {
  it('防空跑：两张数据表的规模与文件注释一致', () => {
    expect(ENTITY_FIELDS).toHaveLength(11);
    expect(WIZARD_STEPS).toHaveLength(5);
  });

  it('ENTITY_FIELDS 的每个 labelKey 在两侧都存在', () => {
    const missing = ENTITY_FIELDS.flatMap((field) =>
      [field.labelKey]
        .filter((key) => !ZH_KEYS.has(key) || !EN_KEYS.has(key))
        .map((key) => `${field.path} -> ${key}`),
    );
    expect(missing, '新增实体卡字段时忘了建词条是静默的，界面会露出裸 key').toEqual([]);
  });

  it('WIZARD_STEPS 的每个 titleKey / descriptionKey 在两侧都存在', () => {
    const missing = WIZARD_STEPS.flatMap((step, index) =>
      [step.titleKey, step.descriptionKey]
        .filter((key) => !ZH_KEYS.has(key) || !EN_KEYS.has(key))
        .map((key) => `step[${index}] -> ${key}`),
    );
    expect(missing).toEqual([]);
  });

  it('数据表里的 key 形状与 B-3 的 namespace 归属一致（不许塞进 fields.*）', () => {
    for (const field of ENTITY_FIELDS) {
      expect(field.labelKey, field.path).toBe(`entity.fields.${field.path}`);
    }
    for (const step of WIZARD_STEPS) {
      expect(step.titleKey).toMatch(/^project\.wizard\.steps\.[a-z_]+\.title$/);
      expect(step.descriptionKey).toMatch(/^project\.wizard\.steps\.[a-z_]+\.description$/);
    }
  });
});

/**
 * B-4 的**同类问题**：`PromptSetPage.describeNoteLine` 与 `ProviderSelect.providerLabel`
 * 的 key 都是从**后端数据**拼出来的（`stage` / `provider` id），扫描测试只看字面量，抓不到。
 * 忘建词条是静默的——前者会退化成 raw passthrough 露出机器记号，后者会退化成 provider id。
 * 所以这两处各自的键集在这里被逐个钉住。
 *
 * （`ProviderSelect` 那 7 个 id 的哨兵断言在 `src/components/ProviderSelect.test.tsx`，
 * 因为它的判据是"渲染结果里不出现 `label_zh`"，必须渲染组件才测得到。）
 */
describe('B-4 · notes 机器行的 stage 键集（同样是扫描抓不到的动态 key）', () => {
  /**
   * 后端 `degradation_note()` 的全部调用点：`prompt_service.rs` 里只有 `"expansion"` 与
   * `"rewrite"` 两个字面量（另有 4 处在同文件的测试里）。
   */
  const NOTE_STAGES = ['expansion', 'rewrite'] as const;

  it('防空跑：stage 就是这两个，且词典里没有多出来的 stage 键', () => {
    expect(NOTE_STAGES).toHaveLength(2);
    expect(Object.keys(zhCN.prompt.promptSet.notes.stage).sort()).toEqual([...NOTE_STAGES].sort());
    expect(Object.keys(enUS.prompt.promptSet.notes.stage).sort()).toEqual([...NOTE_STAGES].sort());
  });

  it('每个 stage 两侧都有非空译文，且译文不与机器记号同形（否则 raw passthrough 就白做了）', () => {
    for (const stage of NOTE_STAGES) {
      const path = `prompt.promptSet.notes.stage.${stage}`;
      expect(ZH_KEYS.has(path), `zh-CN 缺 ${path}`).toBe(true);
      expect(EN_KEYS.has(path), `en-US 缺 ${path}`).toBe(true);
      expect(zhCN.prompt.promptSet.notes.stage[stage]).not.toBe(stage);
      expect(enUS.prompt.promptSet.notes.stage[stage]).not.toBe(stage);
    }
  });

  it('degraded 模板两侧都在，且 stage 与 detail 两个槽位都不缺', () => {
    for (const keys of [ZH_KEYS, EN_KEYS]) {
      expect(keys.has('prompt.promptSet.notes.degraded')).toBe(true);
    }
    expect(zhCN.prompt.promptSet.notes.degraded).toContain('{{stage}}');
    expect(zhCN.prompt.promptSet.notes.degraded).toContain('{{detail}}');
    expect(enUS.prompt.promptSet.notes.degraded).toContain('{{stage}}');
    expect(enUS.prompt.promptSet.notes.degraded).toContain('{{detail}}');
  });
});

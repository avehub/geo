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

/**
 * 残留字符类（Task 15a 第 6 条扩容 · 台账 #02 #05 #12 #14）。
 *
 * 原先只有 `[\u4e00-\u9fa5]`（CJK 统一表意文字），**看不见中文标点与全角形式**：
 * `、`（U+3001）、`。`（U+3002）、`〈`（U+3008）、`，`（U+FF0C）、`：`（U+FF1A）、
 * `（`（U+FF08）、全角空格（U+3000）全在区间外。Task 8 复审 #6 的 `join('、')`
 * 就是这么漏过去的（那处本身已修成必填的 `listSeparator` 参数，见 `components/entity-fields.ts`）。
 *
 * 三段区间与 `i18n/enum-label.test.tsx:51`、`api/client.demo-runtime.test.ts:41`、
 * `demo/backend.test.ts:31` 等处的既有残留判据**同集合**（书写顺序照 `enum-label.test.tsx`），
 * 全仓不再有第二套更窄的字符类。
 * （`demo/seed.test.ts:275` 那处窄区间是**正向**断言「种子题干必须是中文」，不属残留守卫，不改。）
 *
 * 🔴 扩容方向只增不减。对照组见下面「自证（对照组）：字符类真的看得见中文标点与全角形式」。
 */
const CJK = /[\u3000-\u303f\u4e00-\u9fa5\uff00-\uffef]/;

/**
 * 去掉 JS/TS 源码里的注释，**保留字符串与模板串原样**（含其中的 `//`）。
 *
 * 为什么不用正则一把梭：`placeholder="http://127.0.0.1:7890"` 与
 * `extra="自动建档会抓取官网首页…"` 里的 `//` 会让「从 `//` 删到行尾」这种写法
 * 把真实代码一起吃掉，扫描就漏了。所以这里做一个 5 状态的线性扫描器。
 * 块注释里的换行**保留**，这样报出来的行号与原文件对齐。
 *
 * # regex 状态（Task 15a 第 6 条：扩面之前必须先补的那一步）
 *
 * 这台扫描器原先只有 5 个状态（code / 行注释 / 块注释 / 单双引号 / 模板串），**没有 regex 状态**。
 * 错位条件是明确的：只有**内容里带引号或带行注释记号**的正则字面量才会让掩码跑偏
 * （扫描器把正则的收尾斜杠当普通字符、把它后面的引号当字符串起点）。
 *
 * ⚠ **错位之后两个方向都会出错**（fix1 复审 Minor B 的更正：这里原先只写了「不会误报」，是错的）：
 * - **漏报**：正则里含 `//` 时扫描器进入幻影 line 状态，从错位点到行尾的**真实代码**被当注释丢掉；
 * - **误报**：正则里含引号时扫描器进入幻影 quote 状态，而 quote / template 分支**只找终止引号、
 *   不再剥注释**，于是从错位点到下一个同种引号之间的**注释中文会被当成代码原样输出**
 *   ⇒ CJK 残留断言假红。
 *
 * Task 9 那次普查（命令与逐处核验见 task-9-report.md §B-1）的结论是「抽取面 0 处错位风险」，
 * 所以当时的裁定是「只补注释，不加状态机」。**Task 15a 把残留判据的扫描面从抽取面（26 个文件）
 * 扩到整张 glob 扫描面（63 个文件）时重跑了同一条普查，结论变了**：
 * `demo/handlers/shared.ts:48` 的 `const MUST_QUOTE = /[",\n\r]/;` **含引号** ⇒ 真命中。
 * 实测后果正是上面那个「误报」方向：该文件从 `:48` 起掩码跑偏，**58 行注释被当成代码**报出来
 * （普查脚本与逐行输出见 task-15a-report.md）。按本文件当时写下的明文规则
 * 「一旦 (b) 出现真命中，**先补 regex 状态再扩面**，否则本文件的判据会静默变弱」，这里补上第 6 个状态。
 *
 * 「这个 `/` 是不是正则起点」用两条**合取**判定，两条都取保守方向：
 * 1. **前一个有效字符**落在 `( , = : [ ! & | ? { ; + - * % ~ ^` 里，或**前一个标识符**是
 *    `return` / `typeof` / `instanceof` / `in` / `of` / `new` / `delete` / `void` / `do` /
 *    `else` / `yield` / `await` / `case` / `throw` 之一（`prevSignificant` 为空 = 文件开头也算）；
 * 2. 从 `/` 起**在同一行内**找得到收尾的 `/`（JS 的正则字面量不能跨行），期间正确处理 `\` 转义
 *    与 `[...]` 字符类（类里的 `/` 不收尾，`demo/handlers/entity-card.ts:66` 的 `/[/?#]/` 才切得对）。
 *
 * ⚠ 刻意**不**把 `<` 放进第 1 条的字符集：JSX 的闭合标签 `</div>` 会被误判成正则起点，
 * 而抽取面里 `.tsx` 占 17/19，这个误判面比它能救回来的写法大得多。
 * 代价是 `a < /中文/.test(b)` 这种（本仓 0 处）不被识别——但退化方向是**把 `/` 当普通代码字符
 * 原样输出**，即与加 regex 状态之前逐字一致，**不新增漏报**。第 2 条不成立时同样退回原样输出
 * （例：`<div>{a}</div> // 注释` 里闭合标签那个 `/`）。
 *
 * ⚠ 正则字面量的正文**原样输出、不打码**：它是代码不是注释，里面的中文标点
 * （`api/error-text.ts:66` 的 `/[：:]$/`、`:82` 的 `/[，、；：,;:（(【[]$/`）同样属于
 * 「语言相关字面量」，必须进例外表被逐条认领，而不是被扫描器悄悄吃掉。
 * 打码等于新开一个漏报面，与本条判据扩容的目的相反。
 *
 * 内容不含引号也不含行注释记号的正则字面量，加不加 regex 状态结果**逐字相同**
 * （实测：整张扫描面 63 个文件里只有 6 个文件的掩码发生变化，全部是真正的正则字面量，
 * 且 `.tsx` 一个都没有 ⇒ JSX 没有被误伤）。
 *
 * 另一条结构性事实（复审席核过，Task 15a 未改）：template 状态只对反引号退出、**不跟踪 `${`**，
 * 所以写在模板插值里的正则字面量对这台扫描器是**惰性**的——整段被当模板串原样输出。
 *
 * ⚠ **再把 glob 扫描面放宽时必须重跑这条普查**（脚本见 task-15a-report.md）：逐个正则字面量核
 * (a) 内容是否含引号或行注释记号；(b) 它前面那个有效字符是否落在第 1 条的字符集**之外**。
 * 两条只要有一条不成立，本文件的判据就会静默变弱。
 */
/**
 * `/` 之后**可以**紧跟正则字面量的那些前导字符。
 *
 * ⚠ 刻意**不含** `<`（JSX 闭合标签 `</div>`）、`>`（JSX 开标签收尾，也是 `=>` 的尾字符）、
 * `}`（JSX 文本里的 `{count}/total`）与 `)` / `]` / 引号 / 标识符字符——这些之后 `/` 一律按
 * 除法处理。代价是 `() => /re/.test(x)` 这种箭头函数直返正则（本仓 0 处）认不出来，
 * 而漏判的退化方向是「把 `/` 当普通字符**原样输出**」，即与加 regex 状态之前逐字一致
 * ⇒ 只会保留旧有的那个错位风险，**不新增漏报**。
 */
const REGEX_PREV_CHARS = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '-', '*', '%', '~', '^',
]);

/** `/` 之后可以紧跟正则字面量的那些**关键字**（前一个标识符整词匹配）。 */
const REGEX_PREV_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else',
  'yield', 'await', 'case', 'throw',
]);

/**
 * 从 `start`（指向开正则的那个 `/`）起找**同一行内**的收尾斜杠，返回它之后的下标。
 *
 * 找不到就返回 `-1` ⇒ 调用方把 `/` 当普通代码字符原样输出（保守退化，见上面那段文档）。
 * 期间要正确处理 `\` 转义与 `[...]` 字符类：类里的 `/` 不收尾，否则 `/[/?#]/` 会被切成 `/[?`。
 */
function regexLiteralEnd(source: string, start: number): number {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const char = source[index];
    if (char === '\n') return -1;
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (inClass) {
      if (char === ']') inClass = false;
      index += 1;
      continue;
    }
    if (char === '[') {
      inClass = true;
      index += 1;
      continue;
    }
    if (char === '/') return index + 1;
    index += 1;
  }
  return -1;
}

function stripComments(source: string): string {
  let out = '';
  let index = 0;
  let state: 'code' | 'line' | 'block' | 'quote' | 'template' = 'code';
  let quote = '';
  /** code 状态下最近一个**非空白**字符（用来判 `/` 是除法还是正则起点）。 */
  let prevSignificant = '';
  /** code 状态下最近一个标识符整词（`return /re/` 这种要靠它认出来）。 */
  let prevWord = '';

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        out += char;
        prevSignificant = '';
        prevWord = '';
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
      if (char === terminator) {
        state = 'code';
        prevSignificant = char;
        prevWord = '';
      }
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
    if (
      char === '/' &&
      (prevSignificant === '' || REGEX_PREV_CHARS.has(prevSignificant) || REGEX_PREV_WORDS.has(prevWord))
    ) {
      const end = regexLiteralEnd(source, index);
      if (end !== -1) {
        // 正文原样输出（不打码）：正则里的中文标点同样要被例外表逐条认领。
        out += source.slice(index, end);
        index = end;
        prevSignificant = '/';
        prevWord = '';
        continue;
      }
    }
    if (char === "'" || char === '"') {
      state = 'quote';
      quote = char;
      out += char;
      index += 1;
      prevSignificant = char;
      prevWord = '';
      continue;
    }
    if (char === '`') {
      state = 'template';
      out += char;
      index += 1;
      prevSignificant = char;
      prevWord = '';
      continue;
    }
    out += char;
    if (/[A-Za-z0-9_$]/.test(char)) {
      prevWord += char;
      prevSignificant = char;
    } else if (!/\s/.test(char)) {
      prevSignificant = char;
      prevWord = '';
    }
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

/** 一处 CJK 残留：文件 + 行号（1-based）+ **已剥注释**的那一行原文（正则正文按裁定原样保留）。 */
type Residual = { path: string; line: number; text: string };

function residualsOf(path: string, source: string): Residual[] {
  const hits: Residual[] = [];
  stripComments(source)
    .split('\n')
    .forEach((text, index) => {
      if (CJK.test(text)) hits.push({ path, line: index + 1, text });
    });
  return hits;
}

/**
 * # 残留判据的形状（Task 15a 第 6 条 · 台账 #02 #05 #12 #14）
 *
 * 判据 = 「**排除数据类之后的骨架无 CJK** + **例外表**」，两半都不可省：
 * 只有前半没有例外表 ⇒ 语言相关的输入/输出契约（`tokenSeparators` 的全角逗号）无处安放，
 * 只能靠放宽字符类让它绿（🔴 明令禁止）；只有例外表没有语义类 ⇒ 演示种子数据那 146 行中文
 * 要逐行登记，例外表立刻膨胀成第二份数据副本，也就没人再看得懂它在认领什么。
 *
 * 三个部件各自都带哨兵（见下面那几条用例）：
 * - **语义类**：形状钉死到文件集，且反向断言「`src/demo/` 的骨架文件**不在**类里」；
 * - **例外表**：逐条钉命中数（多一行少一行都红），且每处残留必须**恰好**被一条认领；
 * - **字符类**：对照组证明「旧区间看不见、新区间看得见」，扩容本身不是永真断言。
 */

/**
 * 语义类 1（Task 15a 第 7 条 · 台账 #14）：**演示种子数据**。
 *
 * 这个目录里的中文**就是产品要求**（AGENTS 规则 9：demo 要可信就得有真语料；台账已裁定
 * 「中文种子数据继续随桌面端产物发布」并向用户点名）。它整份是数据、没有骨架，
 * 所以按**目录前缀**整类放行。
 *
 * 🔴 形状严格限定在 `src/demo/seed/`，**不许**放宽成 `src/demo/`：`demo/backend.ts`、
 * `demo/db.ts`、`demo/handlers/**` 都是骨架，它们的中文残留必须照扫。
 * 下面那条「语义类形状钉死」用例把这个边界正反两面都钉住了。
 */
const DEMO_SEED_PREFIX = '../demo/seed/';

/** 今天属于语义类 1 的文件集（钉死；多一个少一个都红 ⇒ 前缀不会被悄悄放宽）。 */
const DEMO_SEED_EXPECTED = [
  '../demo/seed/entity-cards.ts',
  '../demo/seed/projects.ts',
  '../demo/seed/prompt-items-insufficient.ts',
  '../demo/seed/prompt-items-sufficient.ts',
  '../demo/seed/prompt-sets.ts',
  '../demo/seed/settings.ts',
] as const;

/**
 * 语义类 2：**测试夹具数据**（与语义类 1 同性质，但形状是**单个文件**、不是目录前缀）。
 *
 * `src/test/fixtures.ts` 是组件/页面测试共用的桩数据工厂（`makeProject()` 的 `宏宇泵业 GEO`、
 * `makeEntityCard()` 的标准名与服务地域…），它的中文同样是**数据**：断言钉的就是
 * 「后端发什么就显示什么」，en locale 下照旧是中文（`pages/ProjectListPage.test.tsx` 的
 * B-2 注释早把这条口径写下来了）。它不是 `.test.` 文件，所以在 glob 扫描面里。
 *
 * ⚠ 这一类是 Task 15a 在简报之外补的（第 7 条只点名了 `src/demo/seed/**`）：
 * 第 15 条已把 `src/test/invoke-mock.ts` 纳入扫描面，同目录的夹具数据不登记就会 newly 判红。
 * 已在 task-15a-report.md 里向控制器点名请裁。
 */
const TEST_FIXTURE_DATA = ['../test/fixtures.ts'] as const;

/** 这份文件属于哪个语义类（数据类整份放行）；`null` = 骨架，必须逐行接受扫描。 */
function dataClassOf(path: string): string | null {
  if (path.startsWith(DEMO_SEED_PREFIX)) return '演示种子数据';
  if ((TEST_FIXTURE_DATA as readonly string[]).includes(path)) return '测试夹具数据';
  return null;
}

/**
 * 行级例外表：**骨架文件**里被裁定保留的语言相关字面量与开发者诊断串。
 *
 * 用「文件 + 行内容正则」而不是行号：上下移动不会让例外失效，而改动那一行本身会。
 * `hits` 是今天的命中数，逐条钉死 ⇒ 例外表**不许悄悄长大**（多一处同类字面量 ⇒ 必须回来
 * 改数字并补理由，这正是想要的摩擦）。同一条残留被两条例外认领也算失败（表必须互斥）。
 */
type ResidualException = {
  paths: readonly string[];
  /** 匹配「已剥注释后的那一行」。 */
  line: RegExp;
  hits: number;
  reason: string;
};

const RESIDUAL_EXCEPTIONS: readonly ResidualException[] = [
  {
    // 台账 #11（第 8 条）：7 处，逐处点名。
    paths: [
      '../components/EntityFieldCard.tsx',
      '../components/ProjectTable.tsx',
      '../components/PromptItemEditor.tsx',
      '../components/WizardSteps.tsx',
    ],
    line: /tokenSeparators=\{\[',', '，'\]\}/,
    hits: 7,
    reason:
      'antd `Select mode="tags"` 的**输入契约**，不是语言相关文案：用户敲半角 `,` 或全角 `，` 都要能切成 token，' +
      '两个分隔符必须同时写死。改成词典键反而会让「能切什么」随界面语言漂移（en 下敲全角逗号就切不动了），' +
      '那才是真缺陷。裁定：维持定性、登记在此（**不是**改成词典键）。',
  },
  {
    paths: ['../api/error-text.ts'],
    line: /\['[（【「]', '[）】」]'\]/,
    hits: 3,
    reason:
      '`BRACKETS` 全角括号/引号对照表（数据列）：`（ID：）` 这类空洞在 zh 用全角、en 用半角，' +
      '判据两边都要认，所以这张表**必须**同时含全角与半角。它不上屏，只参与 `problemsOf` 的判定。',
  },
  {
    paths: ['../api/error-text.ts'],
    line: /\/\[：:\]\$\//,
    hits: 1,
    reason:
      '判定「结尾悬空冒号」的正则字面量：全角 `：` 与半角 `:` 都要认，属**输出契约**而不是文案。' +
      '（regex 正文按裁定原样输出、不打码 ⇒ 它必须在这里被显式认领，而不是被扫描器悄悄吃掉。）',
  },
  {
    paths: ['../api/error-text.ts'],
    line: /problems\.push\(/,
    hits: 10,
    reason:
      '`problemsOf` 的**开发者诊断**标签（BASE 既有；本文件顶部那段「刻意不含 `src/api/`」的注释讲的就是它）：' +
      '只进 `console.warn` 与门禁断言消息，**永不上屏**，因此不进词典。',
  },
  {
    // 台账 #16（第 15 条）。
    paths: ['../test/invoke-mock.ts'],
    line: /未预期的 IPC 调用/,
    hits: 1,
    reason:
      'BASE 既有的**开发者诊断**串：只在测试里「某个 IPC 命令没被 stub」时 reject 出来，永不上屏' +
      '（真运行期由 Tauri 分派，demo 运行期由 `demo/backend.ts` 的 `ipc/unknown_command` 兜底）。' +
      '裁定：**保留原文**、在此登记，不改成词典键（测试替身不该依赖 i18n 初始化顺序）。',
  },
];

function exceptionsFor(hit: Residual): ResidualException[] {
  return RESIDUAL_EXCEPTIONS.filter(
    (entry) => entry.paths.includes(hit.path) && entry.line.test(hit.text),
  );
}

/** 扫描面里**没有任何语义类或例外能认领**的 CJK 残留（格式 `文件:行号: 原文`）。 */
function unexplainedResiduals(entries: ReadonlyArray<readonly [string, string]>): string[] {
  return entries
    .flatMap(([path, source]) => residualsOf(path, source))
    .filter((hit) => dataClassOf(hit.path) === null && exceptionsFor(hit).length === 0)
    .map((hit) => `${hit.path}:${hit.line}: ${hit.text.trim()}`);
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
    // 15b #51（15a 复审 N-1）：下界从 `>=38` 抬到 `>=60`。
    // `>=38` 与 BASE 逐字相同、太松 —— 实测真值是 **63**（复审席用独立 `os.walk` 复刻 glob 数出，
    // 我这里复核一致：`src/**` 的 `.ts`/`.tsx` 共 84 个，减 `locales/**` 20 个、减 `resources.ts` 1 个
    // = 63），掉 25 个文件都不会红。抬到 60 ⇒ 掉 4 个就红。
    // 🔴 **63 不是断言值**：这里刻意保留下界形状（扫描面只会长不会缩，写死成 `toHaveLength(63)`
    // 会让「新增一个生产文件」变成必须回来改数字的假红）。
    expect(paths.length, '扫描面掉了文件 ⇒ 残留判据的覆盖面缩了').toBeGreaterThanOrEqual(60);
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

describe('残留判据（Task 15a 第 6/7/8/15 条）：排除数据类之后的骨架无 CJK + 例外表', () => {
  /**
   * 主判据。扫描面是**整张 glob 扫描面**（63 个生产文件），不再只是抽取面那 26 个：
   * 台账 #02 #05 #12 #14 点名的是「残留」这件事本身，而 `src/api/`、`src/demo/`、`src/store/`、
   * `src/test/` 里的中文一样会上屏（`api/error-text.ts` 的诊断串只是恰好不上屏，那是**逐条认领**
   * 出来的结论，不是"这个目录不用扫"）。
   */
  it('整张 glob 扫描面：语义类与例外表之外，注释之外不含任何 CJK / 中文标点 / 全角形式', () => {
    const offenders = unexplainedResiduals(Object.entries(SOURCES));

    expect(
      offenders,
      '这些行在注释之外仍含中文（含 `、`/`，`/`：`/全角空格这些旧字符类看不见的形态）。' +
        '要么迁进词典，要么按语义类/例外表逐条认领并写明理由——🔴 不许靠放宽字符类让它变绿',
    ).toEqual([]);
  });

  /** 存量断言（Task 8/9 那两轮的原判据）原样保留：抽取面是整张扫描面的子集，强度只增不减。 */
  it('抽取面（components + pages + App.tsx + main.tsx）同样一条不剩', () => {
    expect(unexplainedResiduals(Object.entries(EXTRACTION_SOURCES))).toEqual([]);
  });

  it('防空跑：扫描面真的数得出残留（否则「0 条无法认领」又是永真断言）', () => {
    const all = Object.entries(SOURCES).flatMap(([path, source]) => residualsOf(path, source));
    const data = all.filter((hit) => dataClassOf(hit.path) !== null);
    const skeleton = all.filter((hit) => dataClassOf(hit.path) === null);

    // 实测 186 行 = 语义类 164（demo/seed 146 + test/fixtures.ts 18）+ 例外表 22。
    // 前两条用下界：新增一行中文种子数据不该把门禁打红；整张扫描面塌成 0 必须红。
    expect(all.length, '扫描面一行 CJK 都数不出来 ⇒ 判据已失效').toBeGreaterThanOrEqual(180);
    expect(data.length, '语义类一行都覆盖不到 ⇒ 前缀写错了').toBeGreaterThanOrEqual(160);
    // 这条**精确**：骨架里被认领的残留就是例外表那 22 行。多一处 ⇒ 必须回来改例外表并补理由。
    expect(skeleton.length, '骨架里的 CJK 残留数变了 ⇒ 例外表已过期（逐条重新认领）').toBe(22);
  });

  it('语义类形状钉死（第 7 条）：「演示种子数据」恰好是 src/demo/seed/ 下这 6 个文件', () => {
    const inClass = Object.keys(SOURCES)
      .filter((path) => path.startsWith(DEMO_SEED_PREFIX))
      .sort();
    expect(inClass).toEqual([...DEMO_SEED_EXPECTED].sort());
    expect(DEMO_SEED_EXPECTED).toHaveLength(6);

    // 🔴 反向哨兵：形状**不许**被放宽成 `src/demo/`（台账 #14 原话）。
    // 这些是 demo 的骨架文件，必须留在扫描面里、且不属于任何数据类。
    for (const skeleton of [
      '../demo/backend.ts',
      '../demo/db.ts',
      '../demo/latency.ts',
      '../demo/types.ts',
      '../demo/handlers/shared.ts',
      '../demo/handlers/settings.ts',
    ]) {
      expect(Object.keys(SOURCES), `${skeleton} 不在扫描面里` ).toContain(skeleton);
      expect(dataClassOf(skeleton), `${skeleton} 被误归进数据类了（形状被放宽成 src/demo/）`).toBe(null);
    }

    // 语义类 2 是**单文件**、不是目录前缀：`src/test/` 的其它文件照扫。
    expect(TEST_FIXTURE_DATA).toEqual(['../test/fixtures.ts']);
    expect(dataClassOf('../test/invoke-mock.ts')).toBe(null);
    expect(dataClassOf('../test/render.tsx')).toBe(null);
    expect(dataClassOf('../test/setup.ts')).toBe(null);
  });

  it('例外表不许悄悄长大或过期：逐条钉命中数，且每处骨架残留恰好被一条认领', () => {
    const skeleton = Object.entries(SOURCES)
      .flatMap(([path, source]) => residualsOf(path, source))
      .filter((hit) => dataClassOf(hit.path) === null);

    for (const entry of RESIDUAL_EXCEPTIONS) {
      const actual = skeleton.filter(
        (hit) => entry.paths.includes(hit.path) && entry.line.test(hit.text),
      );
      expect(
        actual.length,
        `例外 ${entry.line} 的命中数变了（今天应是 ${entry.hits}，实际 ${actual.length}）。` +
          `例外只许逐条认领、不许悄悄长大：${entry.reason}`,
      ).toBe(entry.hits);
      // 例外表里的每个路径都必须真在扫描面里，否则这条例外是空的（写了等于没写）
      for (const path of entry.paths) {
        expect(Object.keys(SOURCES), `例外表引用了扫描面之外的 ${path}`).toContain(path);
      }
    }

    const ambiguous = skeleton.filter((hit) => exceptionsFor(hit).length !== 1);
    expect(
      ambiguous.map((hit) => `${hit.path}:${hit.line}: ${hit.text.trim()}`),
      '有骨架残留没被认领、或被两条例外同时认领（例外表必须**互斥且穷尽**）',
    ).toEqual([]);
  });

  it('自证（对照组）：字符类真的看得见中文标点与全角形式（第 6 条的扩容非永真）', () => {
    /** 扩容前的旧字符类。它看不见下面每一个字符 ⇒ 证明「扩容」这件事本身可判别。 */
    const OLD = /[\u4e00-\u9fa5]/;
    for (const char of ['、', '。', '〈', '，', '：', '（', '　', '￥']) {
      expect(OLD.test(char), `对照组前提不成立：${char} 在旧字符类里居然可见`).toBe(false);
      expect(CJK.test(char), `${char} 扩容后仍看不见`).toBe(true);
      expect(cjkLines(`const sep = '${char}';`), `cjkLines 抓不到 ${char}`).toEqual([1]);
    }
    // 扩容不许以放宽汉字段为代价
    expect(CJK.test('中')).toBe(true);
    expect(cjkLines("const label = '中文';")).toEqual([1]);
    // 也不许把纯 ASCII 误判成残留（否则例外表会被假红淹掉）
    for (const ascii of ["const a = 1;", "join(', ')", 'https://example.com/a?b=c', "['(', ')']"]) {
      expect(cjkLines(ascii), `纯 ASCII 被误报：${ascii}`).toEqual([]);
    }
  });

  /**
   * 15b #52（15a 复审 N-2）**明确表态：不并入** `U+2026 …` / `U+2014 —` / `U+00B7 ·`。
   *
   * 复审席的关切是对的：这三个在中文文案里常见，且**都不在** `\u3000-\u303f` 与 `\uff00-\uffef`
   * 里，所以「只含这三个符号、不含汉字」的泄漏今天扫不出来。但实测之后裁定不并，理由是
   * **它们不是 CJK 专属字符，而是中英共用的排版符号**，并入会把合法英文判红：
   *
   * - `…`（U+2026）：`locales/en-US/common.ts:15` 的 `loading: 'Loading…'` —— **合法 en 文案**。
   * - `·`（U+00B7）：`locales/en-US/common.ts:19` 的 `tagline: 'Generative Engine Optimization · local-first'`
   *   —— **合法 en 文案**。
   * - `—`（U+2014）：`components/entity-fields.ts:67`/`:68`/`:71`、`components/SecretStatus.tsx:91`、
   *   `components/PromptTable.tsx:90` 用它做**语言中立的空值占位符**（en 下也照样是 `—`）；
   *   实测骨架里非注释的 `—` 共 **5** 行（下面那条断言取 `>= 4`）。
   *
   * 判据本身要判的是「**这段中文没翻**」。一个只含 `…`/`—`/`·` 的串不携带任何「没翻」的信号
   * （含汉字的串本来就由 `\u4e00-\u9fa5` 抓住，`'加载中…'` 这类靠汉字就已经红了），
   * 而并入的代价是**每写一条带省略号或间隔号的合法英文都要进例外表**——那是把判据做钝。
   *
   * 🔴 所以这条用例的作用是**把「排除」从静默变成明文裁定**：谁哪天顺手把它们并进来，
   * 这条立刻红，必须先读上面这段理由；而下面两组断言钉住了「并入会假红」的**真值源**，
   * 一旦那两处 en 文案改了，这里也会红，逼着重新裁一次。
   */
  it('刻意排除的三枚排版符号（15b #52 表态）：…/—/· 不在残留字符类里，并入会把合法 en 文案判红', () => {
    // ① 三枚符号**刻意**在类外
    for (const [name, glyph] of [
      ['U+2026 …', '\u2026'],
      ['U+2014 —', '\u2014'],
      ['U+00B7 ·', '\u00b7'],
    ] as const) {
      expect(CJK.test(glyph), `${name} 被并进了残留字符类 ⇒ 先读上面那段裁定理由`).toBe(false);
      expect(cjkLines(`const label = '${glyph}';`), `${name} 不该被判成残留`).toEqual([]);
    }

    // ② 假红证据 A（真值源逐字钉住）：合法 en 文案就在词典里
    expect(enUS.common.loading, '这条 en 文案变了 ⇒ #52 的裁定要重跑一次').toBe('Loading\u2026');
    expect(enUS.common.tagline).toBe('Generative Engine Optimization \u00b7 local-first');
    expect(CJK.test(enUS.common.loading as string)).toBe(false);
    expect(CJK.test(enUS.common.tagline as string)).toBe(false);

    // ③ 假红证据 B：语言中立的空值占位符真的在骨架里（非注释行）
    const emDashLines = Object.entries(SOURCES).flatMap(([path, source]) =>
      stripComments(source)
        .split('\n')
        .flatMap((line, index) => (line.includes('\u2014') ? [[path, index + 1]] : [])),
    );
    expect(emDashLines.length, '空值占位符 `—` 不见了 ⇒ #52 的裁定要重跑一次').toBeGreaterThanOrEqual(4);
    expect(emDashLines.map(([path]) => path)).toContain('../components/entity-fields.ts');
    // 反向哨兵：同一段代码里若真出现中文，照样抓得住（排除这三枚符号**没有**把判据弄瞎）
    expect(cjkLines("const label = '\u2014';")).toEqual([]);
    expect(cjkLines("const label = '空\u2014值';")).toEqual([1]);
  });

  it('自证（对照组）：往真实生产文件里塞一个 `、` 会被扫出来（复刻 Task 8 复审 #6 的漏网形态）', () => {
    const path = '../components/entity-fields.ts';
    const original = SOURCES[path];
    expect(typeof original, `${path} 不在扫描面里，这条对照组是空的`).toBe('string');
    // 原文今天必须干净：否则「注入才红」证明不了任何事
    expect(unexplainedResiduals([[path, original]])).toEqual([]);

    const injectedLine = original.split('\n').length + 1;
    // 当年漏网的就是这一句：数组固定用顿号连接。注回去，同一套判据必须报出**准确行号**。
    const withDunhao = `${original}\nexport const REGRESSION_PROBE = ['A', 'B'].join('、');\n`;
    expect(residualsOf(path, withDunhao).map((hit) => hit.line)).toContain(injectedLine);
    expect(unexplainedResiduals([[path, withDunhao]])).toEqual([
      `${path}:${injectedLine}: export const REGRESSION_PROBE = ['A', 'B'].join('、');`,
    ]);

    // 全角逗号同理（`tokenSeparators` 那 7 处之所以必须进例外表，靠的就是这条真的扫得出来）
    const withFullWidthComma = `${original}\nexport const PROBE2 = '，';\n`;
    expect(unexplainedResiduals([[path, withFullWidthComma]])).toHaveLength(1);
    // 全角空格（U+3000）也要看得见：它是最容易被当成"空白"而放过的那一个
    const withIdeographicSpace = `${original}\nexport const PROBE3 = '\u3000';\n`;
    expect(unexplainedResiduals([[path, withIdeographicSpace]])).toHaveLength(1);
  });

  it('自证（对照组）：语义类与例外表都不能把新塞进去的中文一并吞掉', () => {
    // ① 数据类目录之外的 demo 骨架文件塞中文 ⇒ 必须红（形状没被放宽成 src/demo/）
    const shared = '../demo/handlers/shared.ts';
    const sharedSource = SOURCES[shared];
    expect(typeof sharedSource, `${shared} 不在扫描面里`).toBe('string');
    expect(unexplainedResiduals([[shared, `${sharedSource}\nexport const PROBE = '中文';\n`]])).toHaveLength(1);

    // ② 例外表按**行内容**认领，不是按文件认领：同一个文件里换一行写中文 ⇒ 必须红
    const errorText = '../api/error-text.ts';
    const errorTextSource = SOURCES[errorText];
    expect(unexplainedResiduals([[errorText, errorTextSource]])).toEqual([]);
    expect(
      unexplainedResiduals([[errorText, `${errorTextSource}\nexport const PROBE = '中文';\n`]]),
    ).toHaveLength(1);

    // ③ 把 `tokenSeparators` 那条形例的形状改一改（换个属性名）⇒ 立刻不被认领
    const probe = "const x = <Select separators={[',', '，']} />;";
    expect(exceptionsFor({ path: '../components/WizardSteps.tsx', line: 1, text: probe })).toHaveLength(0);
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

  /**
   * regex 状态的对照组（第 6 条扩面的前置条件）。
   *
   * ①② 是一对：①证明「误报方向」修好了（含引号的正则不再让后面的注释被当代码），
   * ②是它的**对价**——证明这不是靠"把整段吃掉"换来的（正则之后真实代码里的中文照样抓到）。
   * 只有①没有②，把 `stripComments` 改成 `return ''` 也能绿。
   */
  it('自证（对照组）：regex 状态既不让含引号的正则跑偏，也不吃掉正则之后真实的中文', () => {
    // ① `demo/handlers/shared.ts:48` 的真形态
    expect(cjkLines('const MUST_QUOTE = /[",\\n\\r]/;\n/** 中文注释 */\nconst a = 1;')).toEqual([]);
    // ② 对价：同一个正则之后，**真实代码**里的中文必须抓到
    expect(cjkLines('const MUST_QUOTE = /[",\\n\\r]/;\nconst b = "中文";')).toEqual([2]);
    // ③ 除法不许被当成正则起点（否则 `total / count` 之后的中文会被吞）
    expect(cjkLines('const r = total / count; // 注释\nconst b = "中文";')).toEqual([2]);
    // ④ JSX 闭合标签不许被当成正则起点（`<` 刻意不在前导字符集里）
    expect(cjkLines('<div>裸文本</div>')).toEqual([1]);
    expect(cjkLines('<div>{a}</div> // 注释\nconst b = "中文";')).toEqual([2]);
    // ⑤ 字符类里的 `/` 不收尾（`demo/handlers/entity-card.ts:66` 的 `/[/?#]/` 要切得对）
    expect(cjkLines('const HOST = /[/?#]/;\nconst b = "中文";')).toEqual([2]);
    // ⑥ 正则正文**原样输出**⇒ 正则里的中文标点仍要被认领，不被悄悄吃掉
    expect(cjkLines('if (/[：:]$/.test(s)) return s;')).toEqual([1]);
    // ⑦ 关键字前导（`return /re/`）也要认出来：这条不过，①那个修复就只覆盖了 `=` 一种前导
    expect(cjkLines('function f(s: string) { return /[",]/.test(s); } // 注释')).toEqual([]);
    expect(cjkLines('function f(s: string) { return /[",]/.test(s); }\nconst b = "中文";')).toEqual([2]);
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
   * 实测（Task 15a 第 12 条重跑探针，脚本与逐行输出见 task-15a-report.md）：
   * glob 扫描面 **63** 个文件，其中 **21 个**抽出字面量 key，共 **279 个**
   * （`components/` 180 + `pages/` 99）。
   *
   * ⚠ 三个数字里**只有第一个是过期的**：Task 10 那次记的是「43 个文件」，Task 11–14 建 demo
   * 假后端时新增了 20 个生产文件（`demo/backend.ts`、`demo/db.ts`、`demo/latency.ts`、
   * `demo/types.ts`、`demo/handlers/**` 11 个、`demo/seed/**` 6 个）⇒ 43 + 20 = **63**。
   * 另外两个数（21 / 279，含 180 + 99 的拆分）**重跑后逐字未变**——新增的 demo 文件里
   * 一个 `t('字面量')` 都没有（假后端不渲染界面、不查词典）。
   *
   * ⚠ 另外更正一处指向：「扫描面精确计数」那 3 个 `toHaveLength` 在**上面**那个 describe 里
   * （`components/` 19 个文件、其中 17 个 `.tsx`、抽取面合计 26 个），**不在**本条用例下面；
   * 本条用例下面跟着的是两个 `>=` **下界**（总量 260 / 覆盖面 18）。
   * 那 3 个精确计数不是可以放着不动的常量：**新增或删除任何生产文件都必须同步改那里**
   * （Task 10 就是因为这句没写下来，让实现者以为它属禁改范围、只能停下来请裁）。
   * Task 15a 自己只新增了 `pages/en-us-page-residual.test.tsx` 一个 `.test.` 文件，
   * 被 glob 里「排除测试文件」那一条 pattern 挡在扫描面外 ⇒ 三个精确计数一个都没变，
   * 那条机制说明**仍然成立**（第 16 条复核结果）。
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

/**
 * #47（15a §8-3）+ #25 的占位提示那一半：**上屏的 `placeholder` 不许是硬编码字面量**。
 *
 * 为什么单独开一条判据：这类字面量**全 ASCII**（`https://www.example.com`、
 * `https://api.example.com/v1`），两遍 CJK 残留扫描结构上看不见它，而它确实会上屏
 * ⇒ 属本文件的口径（台账 #19 的定性：「硬编码界面文案，只是恰好不含中文」）。
 *
 * ⚠ 值搬进词典时**逐字不动**：加「例如：」这种前缀属**改文案**，按 AGENTS 规则 8 要先在 demo
 * 定稿并经产品负责人点头（15a §8-5 的裁定，`project.wizard.corePagesPlaceholder` 就是这么办的）。
 *
 * # 例外表（形状照 `RESIDUAL_EXCEPTIONS`）：**现在是空的**
 * 三处同性质的硬编码占位提示都已进词典：`WizardSteps.tsx` 的 `https://www.example.com`（#47）、
 * `ProviderSelect.tsx` 的 `https://api.example.com/v1`（#25）、`ProxyForm.tsx` 的
 * `http://127.0.0.1:7890`（#54，判据在 `components/ProxyForm.test.tsx`）。
 *
 * 🔴 表**刻意保留**（而不是把机制删掉）：将来谁要认领新例外，必须往表里加一条带理由的记录，
 * 而下面那条 `toEqual` 会立刻逼他对账——机制在，才不会有人图省事把判据写成「只扫某两个文件」。
 */
describe('#47/#25/#54 · 上屏 placeholder 不许硬编码（ASCII 也算）', () => {
  const PLACEHOLDER_EXCEPTIONS: ReadonlyArray<{ path: string; hits: number; reason: string }> = [];

  /**
   * 抽 `placeholder` 的**字面量**写法：`placeholder="…"` / `placeholder={'…'}` / `placeholder={ "…" }`。
   * `placeholder={t('…')}` 不命中（那正是要求的形状）。
   * ⚠ 不带 `g`：带 `g` 的正则 `.test()`/`.exec()` 有 `lastIndex` 状态，跨调用会漏。
   */
  const PLACEHOLDER_LITERAL =
    /placeholder\s*=\s*(?:"[^"]*"|'[^']*'|\{\s*(?:"[^"]*"|'[^']*')\s*\})/;

  function literalPlaceholders(
    entries: ReadonlyArray<readonly [string, string]>,
  ): Array<{ path: string; hits: number }> {
    const out: Array<{ path: string; hits: number }> = [];
    for (const [path, source] of entries) {
      const hits = source.split('\n').filter((line) => PLACEHOLDER_LITERAL.test(line)).length;
      if (hits > 0) out.push({ path, hits });
    }
    return out.sort((left, right) => left.path.localeCompare(right.path));
  }

  it('抽取面里 placeholder 一律走 t()：字面量一处不剩（例外表已清空）', () => {
    expect(literalPlaceholders(Object.entries(EXTRACTION_SOURCES))).toEqual(
      PLACEHOLDER_EXCEPTIONS.map(({ path, hits }) => ({ path, hits })),
    );
    // 🔴 比原先的 `.every(理由够长)` **更强**：空数组上 `.every()` 是永真的，对不上账；
    // 直接钉「表就是空的」⇒ 新增例外必须**同时**改这一条，改的人会看见自己在放宽判据。
    expect(PLACEHOLDER_EXCEPTIONS).toEqual([]);
    expect(PLACEHOLDER_EXCEPTIONS.every((row) => row.reason.trim().length > 10)).toBe(true);
  });

  it('自证（对照组）：塞一个字面量 placeholder 会被抓，走 t() 的写法不会', () => {
    expect(literalPlaceholders([['../planted.tsx', '<Input placeholder="https://x.example" />']])).toEqual([
      { path: '../planted.tsx', hits: 1 },
    ]);
    expect(
      literalPlaceholders([['../planted.tsx', "<Input placeholder={t('a.b')} />"]]),
    ).toEqual([]);
    // 防空跑：抽取面真的有 placeholder（否则「只剩例外那几处」可能是扫描面塌了的假绿）
    expect(
      Object.entries(EXTRACTION_SOURCES).filter(([, source]) => source.includes('placeholder')).length,
    ).toBeGreaterThanOrEqual(8);
  });
});

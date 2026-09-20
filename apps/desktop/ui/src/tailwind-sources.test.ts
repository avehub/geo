/**
 * 守卫：Tailwind 的扫描面是 **fail-closed 白名单**（Plan A Task 8b · 裁定 B-1 / B-2 / B-3）。
 *
 * # 钉住的是什么姿态
 *
 * Tailwind v4 默认自动探测源文件，范围是 vite root（`apps/desktop/ui`）下的**所有**文件
 * ——词典（`src/i18n/locales`）与数据 `.ts` 也在里面。英文散文单词只要长得像 class 名，
 * 就凭空生成一条死 CSS 规则，并改变 `dist/assets/index-*.css` 的文件名哈希；Vite/Rolldown
 * 又把关联 CSS 计进 JS chunk 的 content hash，于是「改一行词典」能让 JS 产物哈希跟着变
 * （Task 7 报告 §9-3 / §9-4 的实测事故）。Task 8 实测踩到：词典里 4 个 `table:` 对象键
 * 让产物 CSS 多出一条 `.table{display:table}`。
 *
 * 所以 `src/index.css` 现在用 `source(none)` **关掉**自动探测，只显式白名单扫 `.tsx`
 * （工具类只可能出现在标记文件里），再用一条 `@source not` 排掉测试 `.tsx`。
 * 本守卫断言这三条指令**真的被 Tailwind 解析成了预期的扫描面**，并带对照组证明每条断言可观测。
 *
 * # `loadStylesheet` 为什么加载真内容（裁定 B-2）
 *
 * 旧版把 `@import 'tailwindcss'` 换成**空内容**，理由是「不把守卫绑在包的内部文件布局上」。
 * 代价是 **`source(none)` 不可观测**。`tailwindcss@4.3.3` 公开 `compile()` 实测对照：
 *
 * | CSS                                   | loadStylesheet | `compiler.root` |
 * |---------------------------------------|----------------|-----------------|
 * | `@import 'tailwindcss' source(none);` | 空内容 stub    | `null` ← 看不见 |
 * | `@import 'tailwindcss' source(none);` | 真样式入口内容 | `"none"`        |
 *
 * ⇒ 旧版那条 `expect(compiler.root).toBeNull()`（注释自称「`root === 'none'` 意味着自动探测
 * 整个关掉」）在 stub 下是**永真**的，开与关都绿。这正是本分支记过两次的失败模式：
 * 「以『缺失』为判据的门禁必须自证非永真」。
 *
 * 真内容的位置**不硬编码 `node_modules` / `.pnpm` 路径**（会随 pnpm 布局漂），而是用包自己的
 * 导出解析：`createRequire(...).resolve('tailwindcss/package.json')` → `exports['.'].style`。
 * 解析失败**直接让测试失败并说明原因**，绝不静默回落成 stub（回落就等于把守卫重新变成永真）。
 *
 * # 做不到哪一层
 *
 * oxide 扫描器（`@tailwindcss/oxide` 的 `Scanner`）那一层的端到端排除不在这里：它只是
 * `@tailwindcss/vite` 的传递依赖，伸手进它的 `node_modules` 是一条未声明且随 pnpm 布局漂移的
 * 依赖，不值得为它把守卫做脆。那一层由 §D-9 的**真实构建**变异自证覆盖（M2：往词典里塞一个
 * 工具类形状的 token，重新 build，产物 CSS 不许出现对应规则），证据在 `task-8b-report.md`。
 */
/// <reference types="node" />
// `tsconfig.app.json` 的 `types` 不含 node ⇒ 直接 import `node:fs` 会报 TS2591，
// 用文件级 triple-slash reference 拉进来（同 `src/i18n/dictionary.test.ts` 的处理）。
import { existsSync, globSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';

const INDEX_CSS_REL = join('apps', 'desktop', 'ui', 'src', 'index.css');

/**
 * 从 `process.cwd()` 往上找 `src/index.css`。
 * 门禁命令 `pnpm --dir apps/desktop/ui run test` 的 cwd 是 `apps/desktop/ui`，
 * 但在仓库根直接跑 vitest 时 cwd 是仓库根，两种都要能过（同 `dictionary.test.ts` 的做法）。
 */
function findIndexCss(): string {
  let dir = resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, INDEX_CSS_REL);
    if (existsSync(candidate)) return candidate;
    const short = join(dir, 'src', 'index.css');
    if (existsSync(short)) return short;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`找不到 ${INDEX_CSS_REL}（从 ${process.cwd()} 往上 8 层都没有）`);
}

const INDEX_CSS = findIndexCss();
const SRC_DIR = dirname(INDEX_CSS);
const UI_ROOT = resolve(SRC_DIR, '..');

/**
 * 用包自己的导出定位 `tailwindcss` 的样式入口（裁定 B-2）。
 *
 * 不硬编码 `node_modules` / `.pnpm` 路径：那是随 pnpm 布局漂移的依赖。
 * 解析不出来就抛错让测试红，**不回落成空内容 stub**——回落就等于让 `source(none)` 重新不可观测。
 */
function tailwindStylesheet(): { path: string; content: string } {
  let pkgPath: string;
  try {
    pkgPath = createRequire(import.meta.url).resolve('tailwindcss/package.json');
  } catch (error) {
    throw new Error(
      `解析 tailwindcss/package.json 失败；守卫拒绝回落成空内容 stub（回落会让 source(none) 不可观测）：${String(error)}`,
    );
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    exports?: Record<string, { style?: unknown } | string>;
  };
  const entry = pkg.exports?.['.'];
  const style = typeof entry === 'object' && entry !== null ? entry.style : undefined;
  if (typeof style !== 'string') {
    throw new Error(
      `tailwindcss 的 exports['.'].style 不是字符串（实际：${JSON.stringify(style)}）；` +
        '请继续用包导出定位样式入口，不要硬编码 node_modules 路径',
    );
  }

  const path = join(dirname(pkgPath), style);
  return { path, content: readFileSync(path, 'utf8') };
}

const TAILWIND_STYLESHEET = tailwindStylesheet();

/**
 * 复刻 `@tailwindcss/vite` 的编译调用。
 *
 * `base` = CSS 文件所在目录（见其 `dist/index.mjs` 里的 `dirname(resolve(id))`）。
 * `loadStylesheet` 加载**真内容**，理由见文件头「裁定 B-2」那一节。
 */
function compileCss(css: string) {
  return compile(css, {
    base: SRC_DIR,
    loadStylesheet: async (id, from) => {
      if (id === 'tailwindcss') {
        return {
          path: TAILWIND_STYLESHEET.path,
          base: dirname(TAILWIND_STYLESHEET.path),
          content: TAILWIND_STYLESHEET.content,
        };
      }
      const path = join(from, id);
      return { path, base: from, content: readFileSync(path, 'utf8') };
    },
    loadModule: async (id) => {
      throw new Error(`index.css 不该有 @plugin / @custom-variant：${id}`);
    },
  });
}

/** 把一条 source 的 `base` + `pattern` 解析成绝对 glob 并展开成文件列表。 */
function expand(source: { base: string; pattern: string }): string[] {
  return globSync(resolve(source.base, source.pattern)).map((file) => resolve(file));
}

const cssText = () => readFileSync(INDEX_CSS, 'utf8');

/** 对照组 1：去掉 `source(none)`（自动探测重新打开）。 */
const stripSourceNone = (css: string) => css.replace(/\s*source\(none\)/, '');

/** 对照组 2 / 3：按整行文本删掉一条指令（删不掉时对照组自己会红，见调用处的 `not.toBe`）。 */
const stripLine = (css: string, line: string) =>
  css
    .split('\n')
    .filter((each) => each.trim() !== line)
    .join('\n');

/** B-1 规定的三条指令里，写在 `index.css` 中的两条 `@source` 的字面文本。 */
const POSITIVE_DIRECTIVE = '@source "./**/*.tsx";';
const NEGATED_DIRECTIVE = '@source not "./**/*.test.tsx";';

/**
 * 解析出「Tailwind 实际会扫的集合」= positive 展开 − negated 展开。
 *
 * 分两步是因为 `compiler.sources` 只给 glob，不给求差后的结果；而**只有求差后的集合**
 * 才是对照组 3 能翻转的东西（positive 的裸展开里永远含测试 `.tsx`，拿它做对照是永真的）。
 */
async function scanSurface(css: string = cssText()) {
  const compiler = await compileCss(css);
  const positive = compiler.sources.filter((source) => !source.negated);
  const negated = compiler.sources.filter((source) => source.negated);
  const positiveFiles = positive.flatMap((source) => expand(source));
  const negatedFiles = new Set(negated.flatMap((source) => expand(source)));
  const effective = new Set(positiveFiles.filter((file) => !negatedFiles.has(file)));
  return { compiler, positive, negated, positiveFiles, effective };
}

// 防空跑用的地面真值：glob 写窄时「每一个都被覆盖 / 每一个都合规」在空集上是永真的。
const NON_TEST_TSX = globSync(join(UI_ROOT, 'src', '**', '*.tsx'))
  .map((file) => resolve(file))
  .filter((file) => !file.endsWith('.test.tsx'));
const TEST_TSX = globSync(join(UI_ROOT, 'src', '**', '*.test.tsx')).map((file) => resolve(file));
/** Task 8 实测长出 `.table{display:table}` 的那个词典文件（点名断言用）。 */
const PROJECT_TS = join(SRC_DIR, 'i18n', 'locales', 'zh-CN', 'project.ts');
const LOCALES_SEG = join('src', 'i18n', 'locales');

describe('Task 8b · Tailwind 扫描面是 fail-closed 白名单', () => {
  it('自动探测关着（root === "none"），白名单恰 1 条、指向 .tsx、基准目录是 src', async () => {
    const { compiler, positive } = await scanSurface();

    // 裁定 B-3①。这条只有在 `loadStylesheet` 加载真内容时才可观测（文件头的对照表）；
    // 对照组 1 证明它不是永真的。
    expect(compiler.root, 'index.css 必须用 source(none) 关掉自动内容探测').toBe('none');

    // 裁定 B-3②：扫描面是显式白名单，不多不少一条。
    expect(positive.length, '扫描面必须是显式白名单：恰有 1 条非 negated source').toBe(1);
    expect(positive[0].pattern, '白名单只允许扫 .tsx（工具类只可能出现在标记文件里）').toBe(
      './**/*.tsx',
    );
    // 基准目录就是 CSS 文件所在目录（src/）：`@source` 的相对路径按它解析。
    // 钉住的是「基准目录搞错 ⇒ glob 匹配不到任何文件 ⇒ 守卫静默失效」。
    expect(positive[0].base, `白名单的基准目录不是 ${SRC_DIR}`).toBe(SRC_DIR);
  });

  it('白名单展开后全是 .tsx：词典与任何 .ts 数据文件都不在扫描面里', async () => {
    const { positiveFiles } = await scanSurface();

    // 防空跑（裁定 B-3 ⚠）：实测 src 下非测试 .tsx 共 25 个（含 src/test/render.tsx），下取整到 20。
    expect(NON_TEST_TSX.length, 'src 下非测试 .tsx 至少有 20 个，否则下面的「每一个」是永真的').toBeGreaterThanOrEqual(20);
    expect(positiveFiles.length, '白名单一个文件都没展开出来').toBeGreaterThan(0);

    expect(
      positiveFiles.filter((file) => !file.endsWith('.tsx')),
      '白名单展开出了非 .tsx 文件',
    ).toEqual([]);
    // 这条是删掉 `@source not "*.test.ts"` 的**补偿断言**：`.ts` 压根不在扫描面里，
    // 所以那条排除指令是死配置，「.ts 不被扫」改由这里正向钉住。
    expect(
      positiveFiles.filter((file) => file.endsWith('.ts')),
      '扫描面里出现了 .ts 文件，「白名单只到 .tsx」的前提就不成立了',
    ).toEqual([]);
    expect(
      positiveFiles.filter((file) => file.includes(LOCALES_SEG)),
      '词典文件仍在扫描面里——它们只装英文散文，扫进来只会生成死 CSS',
    ).toEqual([]);

    // 点名断言（裁定 B-3③）：Task 8 就是它长出 `.table{display:table}` 的。
    expect(existsSync(PROJECT_TS), `点名断言的前提没了：${PROJECT_TS} 不存在`).toBe(true);
    expect(positiveFiles, `${PROJECT_TS} 仍在扫描面里`).not.toContain(PROJECT_TS);

    // 反向防空跑：白名单也不许写窄到把组件漏掉——漏掉的组件里写工具类会**静默**不生效。
    const scanned = new Set(positiveFiles);
    expect(
      NON_TEST_TSX.filter((file) => !scanned.has(file)),
      '这些非测试 .tsx 不在白名单展开结果里，它们里面的工具类会静默失效',
    ).toEqual([]);
  });

  it('测试 .tsx 被 negated source 覆盖，不在有效扫描面里', async () => {
    const { negated, effective } = await scanSurface();

    // 裁定 B-3④。防空跑：实测 src 下测试 .tsx 共 10 个，下取整到 8。
    expect(TEST_TSX.length, 'src 下测试 .tsx 至少有 8 个，否则「每一个都被覆盖」是永真的').toBeGreaterThanOrEqual(8);

    expect(negated.length, 'index.css 里必须恰有 1 条用 `@source not` 写的测试排除指令').toBe(1);
    expect(negated[0].pattern).toBe('./**/*.test.tsx');
    expect(negated[0].base, `排除指令的基准目录不是 ${SRC_DIR}`).toBe(SRC_DIR);

    const excluded = new Set(negated.flatMap((source) => expand(source)));
    expect(
      TEST_TSX.filter((file) => !excluded.has(file)),
      '这些测试 .tsx 没被排除指令覆盖到（只排掉一半）',
    ).toEqual([]);
    expect(
      TEST_TSX.filter((file) => effective.has(file)),
      '这些测试 .tsx 仍在 Tailwind 的有效扫描面里',
    ).toEqual([]);
  });

  it('对照组 1：去掉 source(none)，root 就变回 null（证明「自动探测关着」可观测、非永真）', async () => {
    const css = cssText();
    const stripped = stripSourceNone(css);
    expect(stripped, '对照组必须真的删掉了 source(none)，否则这一条什么也没证明').not.toBe(css);

    const compiler = await compileCss(stripped);
    expect(compiler.root, '去掉 source(none) 后自动探测应当重新打开').toBeNull();
  });

  it('对照组 2：去掉白名单那条 @source，非 negated source 数就归 0（证明展开断言非永真）', async () => {
    const css = cssText();
    const stripped = stripLine(css, POSITIVE_DIRECTIVE);
    expect(stripped, '对照组必须真的删掉了白名单指令，否则这一条什么也没证明').not.toBe(css);

    const compiler = await compileCss(stripped);
    expect(compiler.root, '这一组只动白名单，不该影响 source(none)').toBe('none');
    expect(
      compiler.sources.filter((source) => !source.negated),
      '白名单指令删掉后不该还剩 positive source',
    ).toEqual([]);
  });

  it('对照组 3：去掉 @source not，测试 .tsx 就落回有效扫描面（证明覆盖断言非永真）', async () => {
    const css = cssText();
    const stripped = stripLine(css, NEGATED_DIRECTIVE);
    expect(stripped, '对照组必须真的删掉了测试排除指令，否则这一条什么也没证明').not.toBe(css);

    const { negated, effective } = await scanSurface(stripped);
    expect(negated, '排除指令删掉后不该还剩 negated source').toEqual([]);
    expect(
      TEST_TSX.filter((file) => effective.has(file)),
      '排除指令删掉后，测试 .tsx 必须重新落进有效扫描面（否则上面那条覆盖断言是永真的）',
    ).not.toEqual([]);
  });

  it('路径不带引号时 Tailwind 直接抛错——写错的指令不可能静默通过', async () => {
    // 裁定 B-1 的写法硬约束之一。实测 4.3.3 的报错原文是 "`@source` paths must be quoted."
    await expect(
      compileCss(`@import 'tailwindcss' source(none);\n@source ./**/*.tsx;\n`),
    ).rejects.toThrow(/quoted/);
  });
});

/**
 * 守卫：Tailwind 的自动内容探测**不许**扫测试文件（Plan A Task 7b · 裁定 B-5 / 复审 F-3c）。
 *
 * # 为什么要有这条守卫
 *
 * Tailwind v4 默认自动探测源文件，范围是 vite root（`apps/desktop/ui`）下的 `**\/*`
 * ——**包括 `src/**\/*.test.ts(x)`**。测试与注释里的散文单词只要长得像 class 名，
 * 就会生成一条死 CSS 规则，并因此改变 `dist/assets/index-*.css` 的文件名哈希；
 * Vite/Rolldown 又把关联 CSS 计进 JS chunk 的 content hash，于是**改一行测试注释**
 * 能让 JS 产物哈希跟着变（Task 7 报告 §9-3/§9-4 的实测事故）。
 *
 * # 这条守卫做到哪一层，做不到哪一层
 *
 * **做到**：直接调 `tailwindcss` 的公开 `compile()`，复刻 `@tailwindcss/vite` 的调用方式
 * （`base` = CSS 文件所在目录，见其 `dist/index.mjs` 里的 `dirname(resolve(id))`），
 * 断言 `src/index.css` 里的排除指令**真的被 Tailwind 解析成了 negated source**，
 * 且解析出的 glob **真的能匹配到仓库里每一个测试文件**。
 * 这比「grep 一下 CSS 文本里有没有 `@source not`」强得多：拼错的指令、Tailwind 不支持的
 * 写法、基准目录搞错导致 glob 匹配不到任何文件——这三种都会让守卫红，而 grep 全都绿。
 *
 * **做不到**：oxide 扫描器（`@tailwindcss/oxide` 的 `Scanner`）那一层的端到端排除。
 * 它不是本包的直接依赖（只作为 `@tailwindcss/vite` 的传递依赖存在），伸手进
 * `node_modules/@tailwindcss/vite/node_modules/` 是一条未声明且随 pnpm 布局漂移的依赖，
 * 不值得为它把守卫做脆。那一层由 §D-3 的手动实测（含**对照组**）覆盖，
 * 证据贴在 `task-7b-report.md`。
 */
/// <reference types="node" />
// `tsconfig.app.json` 的 `types` 不含 node ⇒ 直接 import `node:fs` 会报 TS2591，
// 用文件级 triple-slash reference 拉进来（同 `src/i18n/dictionary.test.ts` 的处理）。
import { existsSync, globSync, readFileSync } from 'node:fs';
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
 * 复刻 `@tailwindcss/vite` 的编译调用。
 *
 * `loadStylesheet` 把 `@import 'tailwindcss'` 换成**空表**：本守卫要看的是 `@source`
 * 的解析结果，与 Tailwind 自己的样式内容无关，读真文件反而会把守卫绑在
 * `tailwindcss` 包的内部文件布局上（升级即碎）。
 */
function compileCss(css: string) {
  return compile(css, {
    base: SRC_DIR,
    loadStylesheet: async (id, from) => ({ path: join(from, id), base: from, content: '' }),
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
const stripExclusions = (css: string) =>
  css
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('@source not'))
    .join('\n');

describe('B-5 · Tailwind 不扫测试文件', () => {
  it('index.css 里的排除指令被 Tailwind 解析成 negated source，且自动探测仍开着', async () => {
    const compiler = await compileCss(cssText());

    // `root === 'none'` 意味着 `@import 'tailwindcss' source(none)`——那时自动探测整个关掉，
    // 排除指令也就无从谈起；`root === null` 才是「自动探测开着，靠 negated source 打洞」。
    expect(compiler.root, '自动内容探测必须还开着，否则排除指令没有意义').toBeNull();

    const negated = compiler.sources.filter((source) => source.negated);
    expect(negated.length, 'index.css 里必须有用 `@source not` 写的排除指令').toBeGreaterThan(0);

    for (const source of negated) {
      // 基准目录就是 CSS 文件所在目录（`src/`）：`@source` 的相对路径按它解析。
      // 这一条钉住的是「基准目录搞错 ⇒ glob 匹配不到任何文件 ⇒ 守卫静默失效」。
      expect(source.base, `排除指令的基准目录不是 ${SRC_DIR}`).toBe(SRC_DIR);
      expect(expand(source), `排除指令 ${source.pattern} 一个测试文件都没匹配到`).not.toEqual([]);
    }
  });

  it('仓库里每一个测试文件都被排除指令覆盖到（不是只排掉一半）', async () => {
    const compiler = await compileCss(cssText());
    const excluded = new Set(
      compiler.sources.filter((source) => source.negated).flatMap((source) => expand(source)),
    );

    const testFiles = globSync(join(UI_ROOT, 'src', '**', '*.test.{ts,tsx}')).map((file) =>
      resolve(file),
    );
    // 防空跑：glob 写错时「0 个测试文件全都覆盖了」也是一条永真断言（§E）
    expect(testFiles.length, '仓库里今天至少有 13 个测试文件').toBeGreaterThanOrEqual(13);

    expect(
      testFiles.filter((file) => !excluded.has(file)),
      '这些测试文件仍在 Tailwind 的自动探测范围内',
    ).toEqual([]);
  });

  it('对照组：把排除指令删掉，negated source 就消失（证明上面两条不是永真）', async () => {
    const css = cssText();
    const stripped = stripExclusions(css);
    expect(stripped, '对照组必须真的删掉了东西，否则这一条什么也没证明').not.toBe(css);

    const compiler = await compileCss(stripped);

    expect(compiler.root).toBeNull();
    expect(compiler.sources.filter((source) => source.negated)).toEqual([]);
  });

  it('路径不带引号时 Tailwind 直接抛错——写错的指令不可能静默通过', async () => {
    // §A-9 的三条硬约束之一。实测 4.3.3 的报错原文是 "`@source` paths must be quoted."
    await expect(
      compileCss(`@import 'tailwindcss';\n@source not ./**/*.test.ts;\n`),
    ).rejects.toThrow(/quoted/);
  });
});

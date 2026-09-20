/**
 * 组件层文案抽取的三道扫描守卫（Plan A Task 8；计划正文步骤 1 + 裁定 B-1 / B-4）。
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
  ['../**/*.{ts,tsx}', '!../**/*.test.*', '!./locales/**', '!./resources.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** 本轮的抽取面：`src/components/` 下的 18 个文件（16 个 .tsx + 2 个数据模块）。 */
const COMPONENT_SOURCES = Object.fromEntries(
  Object.entries(SOURCES).filter(([path]) => path.includes('/components/')),
);

const CJK = /[\u4e00-\u9fa5]/;

/**
 * 去掉 JS/TS 源码里的注释，**保留字符串与模板串原样**（含其中的 `//`）。
 *
 * 为什么不用正则一把梭：`placeholder="http://127.0.0.1:7890"` 与
 * `extra="自动建档会抓取官网首页…"` 里的 `//` 会让「从 `//` 删到行尾」这种写法
 * 把真实代码一起吃掉，扫描就漏了。所以这里做一个 5 状态的线性扫描器。
 * 块注释里的换行**保留**，这样报出来的行号与原文件对齐。
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
  });

  it('components/ 下扫到了 18 个文件（16 个 .tsx + entity-fields.ts + wizard-steps.ts）', () => {
    const paths = Object.keys(COMPONENT_SOURCES);
    expect(paths).toHaveLength(18);
    expect(paths.filter((path) => path.endsWith('.tsx'))).toHaveLength(16);
  });
});

describe('Task 15 的残留判据提前到本轮：components/ 下只剩注释含中文', () => {
  it('组件层源码在注释之外不含任何 CJK 字符', () => {
    const offenders = Object.entries(COMPONENT_SOURCES)
      .map(([path, source]) => ({ path, lines: cjkLines(source) }))
      .filter((entry) => entry.lines.length > 0)
      .map((entry) => `${entry.path}: ${entry.lines.join(', ')}`);

    expect(offenders, '这些行在注释之外仍含中文，必须迁进词典').toEqual([]);
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

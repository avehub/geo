/**
 * M1 21 条命令的**入参键名 + 分派链**契约测试（Task 12 · 简报 §B-5，本轮的主要防线）。
 *
 * # 为什么必须有这一份
 * `DemoHandler` 收的是 `Record<string, unknown>` ⇒ handler 里 `args.project_id` 写错成 `args.projectId`
 * **不会有类型错误**，只会静默拿到 `undefined`，页面表现为「没数据」而不是报错。
 * 本文件用 `src/api/client.ts` 的**具名导出**（组件真正会走的那条路）逐条驱动 21 条命令，
 * 并在 handler 入口处**录下真的收到的 args 键集**，与 `client.*` 发出的键集逐字比对。
 *
 * # 走 demo 分派的配方（照抄 `src/api/client.demo-seam.test.ts`，顺序不许调换）
 * `delete window.__TAURI_INTERNALS__` → `vi.resetModules()` → **先** `import('../../api/runtime')`
 * → **再** `import('../../api/client')`。颠倒过来会让 invoke-mock 的模块级 shim 把全局装回去、
 * `runtime` 冻成 `'tauri'`，本文件就**静默变成 tauri 分支（空洞）**⇒ 所以首条用例先钉住
 * 「这条路真的检测成 demo」。
 *
 * # 非空洞
 * 除了「解析成功」，每条还断言 ① 真的收到了期望的 args 键集（不是 `{}`），
 * ② 返回值的**形状**对（数组 / 对象 / undefined，而不是随便什么 truthy），
 * ③ 21 条与 `IPC_COMMANDS` 里那四个前缀的集合**逐字相等**（不多不少，漏一条就红）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEED_ACTIVE_COMPETITOR_IDS, SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID, SEED_ASSETS } from '../seed/projects';
import { CSV_TAG_SEPARATOR } from './shared';
import { readRepoFile } from '../../test/repo-file';

const INTERNALS = '__TAURI_INTERNALS__';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** 导出格式版本，真值源 `apps/desktop/src-tauri/src/services/project_transfer.rs:19`。 */
const EXPORT_FORMAT_VERSION = 'geo-project-export-v1';

type WindowBag = Record<string, unknown>;

/** 进本文件时（setup 期）装着的那个 shim，afterEach 原样还回去。 */
const savedInternals = (window as unknown as WindowBag)[INTERNALS];

/** 配方见文件头注释：runtime 必须先于 client 求值。 */
async function loadSeam() {
  const { runtime } = await import('../../api/runtime');
  const client = await import('../../api/client');
  const backend = await import('../backend');
  const db = await import('../db');
  return { runtime, client, backend, db };
}

type Seam = Awaited<ReturnType<typeof loadSeam>>;

let seam: Seam;
/** 每条用例里 handler 真的收到的 args（用于钉键名）。 */
let seen: Record<string, unknown>[] = [];
/** 被打过桩的命令与它的原 handler，afterEach 还原。 */
let patched: { cmd: string; original: Seam['backend']['demoBackend'][keyof Seam['backend']['demoBackend']] } | null =
  null;

function asObject(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

function asString(value: unknown): string {
  expect(typeof value).toBe('string');
  return value as string;
}

interface Case {
  cmd: string;
  /** `client.*` 发出的 args 键集（逐字，顺序无关）。 */
  keys: string[];
  run: (seam: Seam) => Promise<unknown>;
  check: (result: unknown) => void;
}

const CASES: Case[] = [
  {
    cmd: 'project_create',
    keys: ['draft'],
    run: ({ client }) =>
      client.projectCreate({
        brand_name: 'Demo Brand',
        aliases: [],
        name: null,
        website: null,
        core_pages: [],
        products: [],
        service_scope: null,
        region: 'Jiangsu',
        language: 'zh_cn',
        industry: 'other',
        industry_label: null,
        tags: [],
        competitors: [],
      }),
    check: (result) => expect(asObject(result).id).toMatch(UUID_V4),
  },
  {
    cmd: 'project_list',
    keys: ['filter'],
    run: ({ client }) => client.projectList({}),
    check: (result) => expect(asArray(result).length).toBeGreaterThan(0),
  },
  {
    cmd: 'project_get',
    keys: ['id'],
    run: ({ client }) => client.projectGet(SEED_ACTIVE_PROJECT_ID),
    check: (result) =>
      expect(asObject(asObject(result).project).id).toBe(SEED_ACTIVE_PROJECT_ID),
  },
  {
    cmd: 'project_update',
    keys: ['project'],
    run: ({ client, db }) =>
      client.projectUpdate({ ...db.getDemoDb().projects[0], tags: ['contract'] }),
    check: (result) => {
      const project = asObject(result);
      expect(project.id).toBe(SEED_ACTIVE_PROJECT_ID);
      expect(project.tags).toEqual(['contract']);
    },
  },
  {
    cmd: 'project_archive',
    keys: ['id', 'archived'],
    run: ({ client }) => client.projectArchive(SEED_ACTIVE_PROJECT_ID, true),
    check: (result) => expect(asObject(result).status).toBe('archived'),
  },
  {
    cmd: 'project_delete',
    keys: ['id'],
    run: ({ client }) => client.projectDelete(SEED_ARCHIVED_PROJECT_ID),
    check: (result) => expect(result).toBeUndefined(),
  },
  {
    cmd: 'project_export',
    keys: ['id'],
    run: ({ client }) => client.projectExport(SEED_ACTIVE_PROJECT_ID),
    check: (result) =>
      expect(asObject(result).format_version).toBe(EXPORT_FORMAT_VERSION),
  },
  {
    cmd: 'project_import',
    keys: ['payload'],
    run: async ({ client }) => {
      const exported = await client.projectExport(SEED_ACTIVE_PROJECT_ID);
      return client.projectImport(JSON.stringify(exported));
    },
    check: (result) => expect(Object.keys(asObject(asObject(result).counts))).toHaveLength(7),
  },
  {
    cmd: 'project_export_competitors_csv',
    keys: ['id'],
    run: ({ client }) => client.projectExportCompetitorsCsv(SEED_ACTIVE_PROJECT_ID),
    check: (result) =>
      expect(asString(result).split('\n')[0]).toBe('name,aliases,website,note,position'),
  },
  {
    cmd: 'project_export_assets_csv',
    keys: ['id'],
    run: ({ client }) => client.projectExportAssetsCsv(SEED_ACTIVE_PROJECT_ID),
    check: (result) => expect(asString(result).split('\n')[0]).toBe('kind,url,title,note'),
  },
  {
    cmd: 'entity_card_autobuild',
    keys: ['project_id', 'domain'],
    run: ({ client }) =>
      client.entityCardAutobuild(SEED_ARCHIVED_PROJECT_ID, 'https://demo.example.com'),
    check: (result) => expect(asObject(result).project_id).toBe(SEED_ARCHIVED_PROJECT_ID),
  },
  {
    cmd: 'entity_card_get',
    keys: ['project_id'],
    run: ({ client }) => client.entityCardGet(SEED_ACTIVE_PROJECT_ID),
    check: (result) => expect(asObject(result).project_id).toBe(SEED_ACTIVE_PROJECT_ID),
  },
  {
    cmd: 'entity_card_update_field',
    keys: ['project_id', 'path', 'value', 'status', 'note'],
    run: ({ client }) =>
      client.entityCardUpdateField(SEED_ACTIVE_PROJECT_ID, 'price_range', 'POA', 'official', null),
    check: (result) => expect(asObject(result).field_path).toBe('price_range'),
  },
  {
    cmd: 'entity_card_revisions',
    keys: ['project_id'],
    run: ({ client }) => client.entityCardRevisions(SEED_ACTIVE_PROJECT_ID),
    check: (result) => expect(asArray(result).length).toBeGreaterThan(0),
  },
  {
    cmd: 'competitor_upsert',
    keys: ['project_id', 'draft', 'id'],
    run: ({ client }) =>
      client.competitorUpsert(
        SEED_ACTIVE_PROJECT_ID,
        { name: 'Rival A', aliases: [], website: null, note: null },
        null,
      ),
    check: (result) => expect(asObject(result).project_id).toBe(SEED_ACTIVE_PROJECT_ID),
  },
  {
    cmd: 'competitor_list',
    keys: ['project_id'],
    run: ({ client }) => client.competitorList(SEED_ACTIVE_PROJECT_ID),
    check: (result) => expect(asArray(result)).toHaveLength(SEED_ACTIVE_COMPETITOR_IDS.length),
  },
  {
    cmd: 'competitor_delete',
    keys: ['id'],
    run: ({ client }) => client.competitorDelete(SEED_ACTIVE_COMPETITOR_IDS[0]),
    check: (result) => expect(result).toBeUndefined(),
  },
  {
    cmd: 'competitor_reorder',
    keys: ['project_id', 'ids'],
    run: ({ client }) =>
      client.competitorReorder(SEED_ACTIVE_PROJECT_ID, [...SEED_ACTIVE_COMPETITOR_IDS].reverse()),
    check: (result) => expect(asArray(result)).toHaveLength(SEED_ACTIVE_COMPETITOR_IDS.length),
  },
  {
    cmd: 'asset_add',
    keys: ['project_id', 'kind', 'url', 'title', 'note'],
    run: ({ client }) =>
      client.assetAdd(SEED_ACTIVE_PROJECT_ID, 'other', 'https://x.example.com', null, null),
    check: (result) => expect(asObject(result).kind).toBe('other'),
  },
  {
    cmd: 'asset_list',
    keys: ['project_id'],
    run: ({ client }) => client.assetList(SEED_ACTIVE_PROJECT_ID),
    check: (result) =>
      expect(asArray(result)).toHaveLength(
        SEED_ASSETS.filter((asset) => asset.project_id === SEED_ACTIVE_PROJECT_ID).length,
      ),
  },
  {
    cmd: 'asset_delete',
    keys: ['id'],
    run: ({ client }) => client.assetDelete(SEED_ASSETS[0].id),
    check: (result) => expect(result).toBeUndefined(),
  },
];

beforeEach(async () => {
  delete (window as unknown as WindowBag)[INTERNALS];
  vi.resetModules();
  seen = [];
  patched = null;
  seam = await loadSeam();
  seam.db.resetDemoDb();
});

afterEach(() => {
  if (patched) {
    // 还原生产表：桩只活在一条用例里，绝不串到别的文件。
    seam.backend.demoBackend[patched.cmd as keyof Seam['backend']['demoBackend']] = patched.original;
    patched = null;
  }
  (window as unknown as WindowBag)[INTERNALS] = savedInternals;
  vi.resetModules();
  vi.restoreAllMocks();
});

/** 把 handler 换成「先录 args 键、再转发给原 handler」的探针（B-5：证明键名真的对上了）。 */
function instrument(cmd: string): void {
  const table = seam.backend.demoBackend;
  const key = cmd as keyof typeof table;
  const original = table[key];
  patched = { cmd, original };
  table[key] = (args) => {
    seen.push(args);
    return original(args);
  };
}

describe('demo/handlers · M1 入参键名与分派链（B-5）', () => {
  it('前置事实：这条路真的检测成 demo（否则整份文件都是空洞的）', () => {
    expect(seam.runtime).toBe('demo');
  });

  it('M1 的 21 条 = IPC_COMMANDS 里 project_/entity_card_/competitor_/asset_ 四个前缀的全集', () => {
    const m1 = seam.client.IPC_COMMANDS.filter((cmd) =>
      /^(project|entity_card|competitor|asset)_/.test(cmd),
    );

    expect(m1).toHaveLength(21);
    expect(CASES).toHaveLength(21);
    expect([...m1].sort()).toEqual([...CASES.map((testCase) => testCase.cmd)].sort());
  });

  it.each(CASES)('$cmd：经 client.* 具名导出走 demo 分派，args 键集与返回值形状都对', async (testCase) => {
    instrument(testCase.cmd);

    const result = await testCase.run(seam);

    // ① 真的到达了 handler，而且收到的就是 client.* 发出的那几个键（多一个少一个都算漂移）。
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0]).sort()).toEqual([...testCase.keys].sort());
    // ② 返回值形状对（不是「随便什么 truthy」）。
    testCase.check(result);
  });
});

/**
 * #20（台账 #31）：`';'` 这个**跨语言镜像常量**在 demo 侧只许有一份。
 *
 * 原先 `handlers/project-transfer.ts` 自己写了个未导出的 `const CELL_SEPARATOR = ';'`，
 * 与 `handlers/shared.ts` 导出的 `CSV_TAG_SEPARATOR` 是 Rust `crates/geo-domain/src/csv_io.rs`
 * 里同一个私有 `const TAG_SEPARATOR` 的两份本地镜像 ⇒ 一份改了另一份不会红，
 * 竞品别名列与题库标签列会各用各的分隔符（导入时就切不开）。
 *
 * 🔴 Rust 侧**只读**：`TAG_SEPARATOR` 是私有 const（没有 `pub`），要共享就得改 `crates/**`，
 * 那是越界；能做的是把「前端只有一份、且逐字等于真值源」钉成断言。
 */
const CSV_IO_RS = readRepoFile('crates', 'geo-domain', 'src', 'csv_io.rs');

/** handlers 下的生产源码（同目录、去掉测试文件）。 */
const HANDLER_SOURCES = import.meta.glob(['./*.ts', '!./*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * 「本地又声明了一份 `';'` 常量」的形状：`const X = ';'` / `export const X: string = ';'`。
 * ⚠ 刻意**不带 `g`**：带 `g` 的正则 `.test()` 有 `lastIndex` 状态，跨调用会漏命中。
 */
function separatorMirrors(entries: ReadonlyArray<readonly [string, string]>): string[] {
  const shape =
    /(?:^|\n)\s*(?:export\s+)?const\s+[A-Z][A-Z0-9_]*\s*(?::\s*[^=\n]+)?=\s*';'/;
  return entries
    .filter(([, source]) => shape.test(source))
    .map(([path]) => path)
    .sort();
}

describe('#20 · CSV 单元格分隔符：跨语言镜像常量在 demo 侧只有一份', () => {
  it('CSV_TAG_SEPARATOR 逐字等于 Rust csv_io.rs 的 TAG_SEPARATOR（解析真值源，不手抄）', () => {
    const parsed = /const TAG_SEPARATOR: char = '(.)';/.exec(CSV_IO_RS)?.[1];

    expect(parsed, 'Rust 真值源解析不出来 ⇒ 下面那条比对是空的').toBeDefined();
    expect(CSV_TAG_SEPARATOR).toBe(parsed);
  });

  it('handlers 里声明 `;` 常量的地方恰好一处，就是 shared.ts 导出的那份', () => {
    const paths = Object.keys(HANDLER_SOURCES);
    // 防空跑：glob 写错时「只有一处」会变成永真
    expect(paths.length, '扫描面塌了').toBeGreaterThanOrEqual(10);
    expect(paths).toContain('./shared.ts');
    expect(paths).toContain('./project-transfer.ts');

    expect(
      separatorMirrors(Object.entries(HANDLER_SOURCES)),
      '又出现第二份本地镜像 ⇒ 两份会各自漂；一律引 shared.ts 的 CSV_TAG_SEPARATOR',
    ).toEqual(['./shared.ts']);
  });

  it('自证（对照组）：塞一份本地 `;` 常量会被扫出来，引 shared.ts 的写法不会', () => {
    expect(separatorMirrors([['./planted.ts', "const CELL_SEPARATOR = ';';"]])).toEqual([
      './planted.ts',
    ]);
    expect(
      separatorMirrors([['./planted.ts', "import { CSV_TAG_SEPARATOR } from './shared';"]]),
    ).toEqual([]);
  });
});

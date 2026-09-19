/**
 * 词典完整性守卫（Plan A Task 7；裁定 B-1 / B-3 / B-5 / B-6 / B-11）。
 *
 * 一句话：**词典的键集不是人手维护的**，它被两份机器可读的真值源双向钉住——
 * `contracts/error-codes.json`（43 条 code + 各自 params，Task 1 起冻结）与
 * `crates/geo-domain/src/error.rs` 模块注释里的 reason key 目录表（B-1 要求运行时解析，
 * 不许手抄；Task 3 复审的 N-1 已实证人工同步会错）。
 *
 * 两类断言：
 * - **结构面**：每条 code / reason key 在 zh 与 en 都存在且非空、两侧键集相等、
 *   模板里的 `{{xxx}}` 都在该 code 的 params 清单内、空 params 的 code 不含占位符、
 *   合规两条泄漏面的模板不含 `{{terms}}` / `{{value}}`。
 * - **渲染面**（B-5）：把每条 code 与每条 reason key 分别用「契约声明的全部 params」与
 *   「后端实际保证发出的最小 params」各渲染一次，输出不得残留 `{{…}}`、不得出现
 *   字面 `undefined`/`null`、不得有连续空格或悬空标点。i18next 默认 `skipOnVariables: true`
 *   会把缺失变量**原样**留给用户，那是最坏的失败形态（门禁全绿、界面露花括号）。
 */
/// <reference types="node" />
// `tsconfig.app.json` 的 `types` 只有 `vitest/globals` 与 `@testing-library/jest-dom`，
// 不含 node ⇒ 直接 import `node:fs` 会报 TS2591。这里用文件级的 triple-slash reference
// 把 @types/node 拉进来（B-1 要求运行时解析 Rust 目录表，绕不开 fs），
// 而不是去改 tsconfig —— 那是全项目的编译面，不在本任务写集里。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// 清单在仓库根的 `contracts/`：从 `apps/desktop/ui/src/i18n/` 上去是 **5 层**（同 error-codes.test.ts）。
import catalogJson from '../../../../../contracts/error-codes.json';
import { IpcRequestError } from '../api/client';
import { describeIpcError } from '../api/errors';
import { i18n } from './index';
import enUS from './locales/en-US';
import zhCN from './locales/zh-CN';

interface ErrorCodeEntry {
  code: string;
  params: string[];
  note: string;
}

const catalog: { codes: ErrorCodeEntry[] } = catalogJson;
const UPSTREAM_PREFIX = 'upstream/';
const PLAIN = catalog.codes.filter((entry) => !entry.code.startsWith(UPSTREAM_PREFIX));
const UPSTREAM = catalog.codes.filter((entry) => entry.code.startsWith(UPSTREAM_PREFIX));
const paramsOf = (code: string) => catalog.codes.find((entry) => entry.code === code)?.params ?? [];

/** reason key 目录表的一行：`` //! | `key` | 语义 | 配套参数 | `` */
interface ReasonRow {
  key: string;
  companions: string[];
}

/** 目录表相对仓库根的位置（B-1 的真值源，只读）。 */
const REASON_DIRECTORY_FILE = join('crates', 'geo-domain', 'src', 'error.rs');

/**
 * 从 `process.cwd()` 往上找仓库根，再读目录表。
 *
 * 为什么不用另外两条更短的路（都实测过，证据在 task-7-report.md）：
 * - `new URL('…', import.meta.url)` + `fileURLToPath`：测试跑在 jsdom 环境里，
 *   `import.meta.url` 不是 `file://` URL，`fileURLToPath` 直接抛
 *   `TypeError: The URL must be of scheme file`。
 * - Vite 的 `?raw` 导入：`crates/**` 在 Vite root（`apps/desktop/ui`）之外，
 *   转换阶段报 `Denied ID …/crates/geo-domain/src/error.rs?raw`
 *   （同目录的 `contracts/*.json` 能导入，`.rs?raw` 不行）。
 *
 * 向上查找而不是写死 `../../..`：门禁命令 `pnpm --dir apps/desktop/ui run test`
 * 的 cwd 是 `apps/desktop/ui`，但在仓库根直接跑 vitest 时 cwd 是仓库根，两种都要能过。
 */
function readReasonDirectorySource(): string {
  let dir = resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, REASON_DIRECTORY_FILE);
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`找不到 ${REASON_DIRECTORY_FILE}（从 ${process.cwd()} 往上 8 层都没有）`);
}

/**
 * B-1：运行时解析 Rust 目录表，不手抄键集。
 *
 * 口径（裁定原文）：只取以 `//!` 开头、且第一个数据格是**反引号包裹的标识符**的行；
 * 表头行（第一格是裸 `key`）与分隔行（`---`）自然被排除。配套参数列里混着形态示例
 * （`` `1~5` / `<=5` / `0~9` ``），所以只收 snake_case 标识符。
 */
function parseReasonDirectory(): ReasonRow[] {
  const rows: ReasonRow[] = [];
  for (const line of readReasonDirectorySource().split('\n')) {
    if (!line.startsWith('//!')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    const keyCell = cells[1] ?? '';
    const key = /^`([a-z][a-z_0-9]*)`$/.exec(keyCell)?.[1];
    if (key === undefined) continue;
    const companionCell = cells[3] ?? '';
    const companions = [...companionCell.matchAll(/`([^`]+)`/g)]
      .map((match) => match[1])
      .filter((token) => /^[a-z][a-z_0-9]*$/.test(token));
    rows.push({ key, companions });
  }
  // 防空跑守卫（B-1）：表格格式一改就解析不出东西，那时「0 键全绿」比红更危险。
  if (rows.length < 20) {
    throw new Error(
      `reason 目录表只解析出 ${rows.length} 行（今天应为 23）——解析口径失效了，别让它静默全绿`,
    );
  }
  return rows;
}

const DIRECTORY = parseReasonDirectory();

/** 资源树的全部叶子：`['errors.reasons.too_long', '超过 {{limit}} 字上限']`。 */
function leaves(node: unknown, prefix = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[prefix, node]];
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out.push(...leaves(value, prefix === '' ? key : `${prefix}.${key}`));
  }
  return out;
}

const ENTRIES = {
  'zh-CN': leaves(zhCN.errors, 'errors'),
  'en-US': leaves(enUS.errors, 'errors'),
} as const;
const FIELD_ENTRIES = {
  'zh-CN': leaves(zhCN.fields, 'fields'),
  'en-US': leaves(enUS.fields, 'fields'),
} as const;
const TEMPLATES = {
  'zh-CN': new Map(ENTRIES['zh-CN']),
  'en-US': new Map(ENTRIES['en-US']),
} as const;
const SIDES = ['zh-CN', 'en-US'] as const;
type Side = (typeof SIDES)[number];

const template = (side: Side, path: string) => TEMPLATES[side].get(path);

/** 模板里的占位符名（容忍 i18next 的 `{{name, formatter}}` 写法）。 */
function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([^},]+?)\s*(?:,[^}]*)?\}\}/g)].map((match) => match[1]);
}

/** B-5 的「干净输出」判据：返回问题清单，空数组即合格。 */
function problemsOf(text: string): string[] {
  const problems: string[] = [];
  if (text === '') problems.push('渲染成空串');
  if (text.includes('{{') || text.includes('}}')) problems.push('残留 {{…}} 占位符');
  if (/\bundefined\b/.test(text)) problems.push('字面 undefined');
  if (/\bnull\b/.test(text)) problems.push('字面 null');
  if (text.includes('  ')) problems.push('连续两个空格');
  if (text !== text.trim()) problems.push('首尾空白');
  if (/[，、；：,;:（(【[]$/.test(text)) problems.push('结尾悬空标点');
  if (text.includes('（）') || text.includes('()') || text.includes('（ ）')) problems.push('空括号');
  return problems;
}

function render(code: string, params: Record<string, string>, side: Side): string {
  const error = new IpcRequestError({ code, params, message: `${code} fallback` });
  return describeIpcError(error, i18n.getFixedT(side));
}

/** 每个 param 名的现实取值：用于「契约声明的全部 params」那一轮渲染。 */
const PARAM_VALUES: Record<string, string> = {
  cmd: 'project_list',
  domain: 'https://www.hongyu-pump.example/',
  expected: '1~5',
  field: 'brand_name',
  id: 'p-hongyu',
  kind: 'project',
  limit: '60',
  reason: 'required',
  skipped: 'https://www.hongyu-pump.example/news total_timeout',
  status: '503',
  terms: '国家级',
  upstream: 'llm/server status=503',
  upstream_code: 'llm/server',
  url: 'https://www.hongyu-pump.example/news',
  value: '9',
};

const declaredParams = (code: string) =>
  Object.fromEntries(paramsOf(code).map((name) => [name, PARAM_VALUES[name] ?? name]));

/**
 * 每条 code「后端实际保证发出」的最小 params。
 * 出处：`task-5-report.md` §3.1–§3.4 + `task-5b-report.md` §9（§G 的终态口径）。
 * 与「声明的全部 params」的差别就是可选参数：`crawler/network` 的 `url`/`status`
 * （`CrawlerError::params()` 里是 `Option`，有值才插键）、`validation/failed` 的
 * `limit`/`expected`/`value`（按 reason 变）、`crawler/empty` 的 `skipped`（可为空串）。
 */
const MINIMAL_PARAMS: Record<string, Record<string, string>> = {
  'competitor/not_found': { kind: 'competitor', id: 'c-1' },
  'compliance/violation': { terms: '国家级' },
  'config/invalid': { reason: 'secret_unavailable', value: 'keyring_unavailable' },
  'crawler/blocked': {
    url: 'https://a.example/spec.pdf',
    reason: 'not_allowed',
    value: 'application/pdf',
  },
  'crawler/decode': { reason: 'invalid byte sequence' },
  'crawler/empty': { domain: 'https://a.example/', skipped: '' },
  'crawler/invalid_url': { url: 'ftp://a.example/x', reason: 'invalid_url' },
  'crawler/network': { reason: 'http_status' },
  'crawler/timeout': { url: 'https://a.example/news' },
  'crawler/too_large': { url: 'https://a.example/news', limit: '2097152' },
  'data/invalid': { reason: 'missing field `brand_name`' },
  'entity_card/not_found': { kind: 'entity_card', id: 'p-1' },
  'io/failed': { reason: 'Permission denied (os error 13)' },
  'ipc/internal': {},
  'ipc/invoke_failed': { cmd: 'project_list', reason: 'boom' },
  'ipc/unknown': { cmd: 'project_list', reason: 'boom' },
  'ipc/unknown_command': { cmd: 'project_list' },
  'llm/bad_response': { reason: 'missing_choices' },
  'llm/config': { reason: 'missing_model', value: 'custom' },
  'llm/deserialize': { reason: 'validation_failed' },
  'llm/missing_secret': {},
  'llm/rate_limited': {},
  'llm/server': { status: '429' },
  'llm/transport': { reason: 'network' },
  'project/not_found': { kind: 'project', id: 'p-1' },
  'prompt_item/not_found': { kind: 'prompt_item', id: 'i-1' },
  'prompt_set/empty_import': {},
  'prompt_set/not_found': { kind: 'prompt_set', id: 's-1' },
  'state/conflict': { reason: 'duplicate', value: 'UNIQUE constraint failed: prompt_items.text' },
  'validation/failed': { field: 'brand_name', reason: 'required' },
};

/**
 * 片段键登记表：可选参数**不进主模板**，改由独立片段键按需追加（B-5）。
 *
 * - `owner`：归属的 code，用来查「这个占位符是不是该 code 登记过的 param」。
 * - `params`：允许出现的**后端 param** 占位符。
 * - `derived`：由组合器**拆某个 param** 得到的内部槽位。`skipped_item` 的 `url` / `token`
 *   都是把 `crawler/empty` 的 `skipped`（扁平串 `"{url} {记号}"`）按最后一个空格拆出来的，
 *   不是后端 param（F-2），所以不能按 `owner.params` 判。
 *
 * 断言是**集合相等**而不是子集：声明了却没用的槽位同样算漂移。
 */
const FRAGMENTS: Record<
  string,
  { owner: string; params: string[]; derived?: { slots: string[]; from: string } }
> = {
  // reason 级的可选 value 片段（`out_of_range` 的 value 只有部分站点发，§F-2）；
  // owner 写 `validation/failed` 是因为它是登记了 `value` 的那个 code。
  'errors.fragments.param_value': { owner: 'validation/failed', params: ['value'] },
  'errors.fragments.crawler_network_status': { owner: 'crawler/network', params: ['status'] },
  'errors.fragments.crawler_network_url': { owner: 'crawler/network', params: ['url'] },
  'errors.fragments.crawler_empty_skipped': { owner: 'crawler/empty', params: ['skipped'] },
  'errors.fragments.skipped_item': {
    owner: 'crawler/empty',
    params: [],
    derived: { slots: ['url', 'token'], from: 'skipped' },
  },
  'errors.fragments.list_separator': { owner: 'crawler/empty', params: [] },
};

/** `{kind}/not_found` 的 kind 取值（壳侧 `error.rs` 的 `NOT_FOUND_KINDS`，5 个）。 */
const NOT_FOUND_KINDS = ['project', 'entity_card', 'prompt_set', 'prompt_item', 'competitor'];
/** `llm/transport` 的 reason 取值（`geo-llm/src/transport.rs` 的 `reason_key()`）。 */
const TRANSPORT_REASONS = ['network', 'timeout', 'other'];
/** `crawler/empty` 的 skipped 记号（`geo-crawler/src/site.rs` 的三个 `pub const`）。 */
const SKIP_TOKENS = ['total_timeout', 'robots_disallowed', 'fetch_failed'];

/**
 * 后端会发出的 `field` 值（出处：`task-5-report.md` §3.2 / §3.3 + geo-domain 的其余站点）。
 * 动态 field（`competitors[{index}].name` / `core_pages[{index}]`）由组合器先去下标再查表，
 * 所以这里登记的是**归一化之后**的键。
 */
const FIELD_VALUES = [
  'brand_name',
  'name',
  'aliases',
  'tags',
  'region',
  'website',
  'domain',
  'content',
  'csv_header',
  'payload',
  'format_version',
  'target_count',
  'repeat_count',
  'intents',
  'label',
  'items',
  'ids',
  'set_id',
  'text',
  'weight',
  'api_key',
  'language',
  'field_path',
  'standard_name',
  'founded_year',
  'qualifications',
  'products',
  'products.name',
  'price_range',
  'service_regions',
  'cases',
  'differentiators',
  'official_tone',
  'contact',
  'asset.url',
  'competitor.name',
  'competitor.website',
  'competitors',
  'competitors.name',
  'competitors.website',
  'core_pages',
  'model.provider',
  'model.model',
  'model.base_url',
  'model.temperature',
  'model.timeout_secs',
  'proxy.url',
  'concurrency.max_parallel',
  'concurrency.queue_size',
  'rate_limit.requests_per_minute',
  'rate_limit.min_interval_ms',
  'rate_limit.retry_max',
];

describe('B-1 · reason 目录运行时解析（不手抄键集）', () => {
  it('从 error.rs 的目录表解析出 >= 20 个 key，且含 Task 4 补进去的那几个', () => {
    const keys = DIRECTORY.map((row) => row.key);

    expect(keys.length).toBeGreaterThanOrEqual(20);
    expect(new Set(keys).size, '目录表里有重复 key').toBe(keys.length);
    for (const key of ['http_status', 'secret_unavailable', 'missing_choices', 'json_not_found', 'validation_failed']) {
      expect(keys, `目录表里应仍有 ${key}`).toContain(key);
    }
    // 配套参数列也被解析出来了（out_of_range 那一格混着形态示例，只收标识符）
    const outOfRange = DIRECTORY.find((row) => row.key === 'out_of_range');
    expect(outOfRange?.companions).toEqual(['expected', 'value']);
    expect(DIRECTORY.find((row) => row.key === 'required')?.companions).toEqual([]);
  });

  it('zh 与 en 的 errors.reasons.* 与目录**双向**相等，且值都非空', () => {
    const expected = DIRECTORY.map((row) => `errors.reasons.${row.key}`).sort();

    for (const side of SIDES) {
      const actual = ENTRIES[side]
        .map(([path]) => path)
        .filter((path) => path.startsWith('errors.reasons.'))
        .sort();

      expect({
        side,
        缺失: expected.filter((path) => !actual.includes(path)),
        多出: actual.filter((path) => !expected.includes(path)),
      }).toEqual({ side, 缺失: [], 多出: [] });

      for (const [path, value] of ENTRIES[side].filter(([p]) => p.startsWith('errors.reasons.'))) {
        expect(value.trim(), `${side} 的 ${path} 是空的`).not.toBe('');
      }
    }
  });
});

describe('B-11 · 每条 code 在两侧词典里都有条目', () => {
  it('30 条非 upstream code 在 zh 与 en 都有非空模板', () => {
    expect(PLAIN.length, '契约对账：43 = 30 非 upstream + 13 upstream').toBe(30);
    expect(UPSTREAM.length).toBe(13);

    const missing: string[] = [];
    for (const entry of PLAIN) {
      for (const side of SIDES) {
        const value = template(side, `errors.${entry.code}`);
        if (typeof value !== 'string' || value.trim() === '') missing.push(`${side} ${entry.code}`);
      }
    }
    expect(missing, '缺词条的 code').toEqual([]);
  });

  it('B-3 · upstream/* 共用一条包装键：里层 code 两侧都在，且没有 13 份复述', () => {
    const stray = SIDES.flatMap((side) =>
      ENTRIES[side].map(([path]) => path).filter((path) => path.includes(UPSTREAM_PREFIX)),
    );
    expect(stray, '不应该为 13 条 upstream/* 各写一份近似重复文案').toEqual([]);

    const missing: string[] = [];
    for (const entry of UPSTREAM) {
      const inner = entry.code.slice(UPSTREAM_PREFIX.length);
      for (const side of SIDES) {
        if (template(side, `errors.${inner}`) === undefined) missing.push(`${side} ${inner}`);
      }
    }
    expect(missing, 'upstream 的语义源（里层 code）漂移了').toEqual([]);

    for (const side of SIDES) {
      expect(template(side, 'errors.upstream.wrapper'), `${side} 缺 wrapper`).toContain('{{upstream}}');
    }
  });

  it('errors 与 fields 两个 namespace 的 zh/en 叶子键集双向相等', () => {
    for (const [label, entries] of [
      ['errors', ENTRIES],
      ['fields', FIELD_ENTRIES],
    ] as const) {
      const zh = entries['zh-CN'].map(([path]) => path).sort();
      const en = entries['en-US'].map(([path]) => path).sort();

      expect({
        namespace: label,
        en缺失: zh.filter((path) => !en.includes(path)),
        en多出: en.filter((path) => !zh.includes(path)),
      }).toEqual({ namespace: label, en缺失: [], en多出: [] });
    }
  });

  it('没有值等于 key 本身（漏翻标志），也没有空值', () => {
    const bad: string[] = [];
    for (const side of SIDES) {
      for (const [path, value] of [...ENTRIES[side], ...FIELD_ENTRIES[side]]) {
        const leaf = path.split('.').at(-1) ?? '';
        // i18next 未命中时返回的就是 key ⇒ 「值 == key」是漏翻的机器判据。
        // zh 侧再收紧一档：值等于叶子名（机器记号）也算漏翻。en 侧不能这么判——
        // `errors.kinds.project` 的英文本来就叫 'project'，与机器记号同形不是漏翻。
        const untranslated = value === path || (side === 'zh-CN' && value === leaf);
        if (value.trim() === '' || untranslated) bad.push(`${side} ${path}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('模板里的 {{xxx}} 都在该 code 的 params 清单内；片段键按登记表', () => {
    const offenders: string[] = [];
    for (const side of SIDES) {
      for (const entry of PLAIN) {
        const text = template(side, `errors.${entry.code}`) ?? '';
        for (const name of placeholdersOf(text)) {
          if (!entry.params.includes(name)) offenders.push(`${side} errors.${entry.code} → {{${name}}}`);
        }
      }
      for (const [path, spec] of Object.entries(FRAGMENTS)) {
        const text = template(side, path) ?? '';
        const allowed = [...spec.params, ...(spec.derived?.slots ?? [])].sort();
        const actual = placeholdersOf(text).sort();
        if (actual.join(',') !== allowed.join(',')) {
          offenders.push(`${side} ${path} → {{${actual.join('},{')}}} ≠ 登记的 [${allowed.join(',')}]`);
        }
      }
    }
    expect(offenders, 'placeholder 与登记的 params 不一致').toEqual([]);

    // 登记表本身也不能漂：片段必须归属一个真实 code，用的 param 必须是该 code 声明过的，
    // 内部槽位也必须指明它是从哪个 param 拆出来的。
    for (const [path, spec] of Object.entries(FRAGMENTS)) {
      const declared = paramsOf(spec.owner);
      expect(declared, `${path} 的 owner ${spec.owner} 不是清单里的 code`).not.toEqual([]);
      for (const name of spec.params) {
        expect(declared, `${path} 用了 ${spec.owner} 没登记的 param ${name}`).toContain(name);
      }
      if (spec.derived !== undefined) {
        expect(declared, `${path} 的内部槽位来源 ${spec.derived.from} 不是 ${spec.owner} 的 param`).toContain(
          spec.derived.from,
        );
      }
    }
  });

  it('params 为空数组的 code，模板里不得出现任何 {{…}}', () => {
    // 事实校准：简报 §A-1 写「只有 3 条」，实测契约里是 **4** 条（多了 `ipc/internal`）。
    // 断言直接以契约为准算出来，不写死条数——契约冻结的是内容，不是我的记忆。
    const emptyParamCodes = PLAIN.filter((entry) => entry.params.length === 0)
      .map((entry) => entry.code)
      .sort();
    expect(emptyParamCodes).toEqual(
      ['ipc/internal', 'llm/missing_secret', 'llm/rate_limited', 'prompt_set/empty_import'].sort(),
    );

    const offenders: string[] = [];
    for (const code of emptyParamCodes) {
      for (const side of SIDES) {
        if (placeholdersOf(template(side, `errors.${code}`) ?? '').length > 0) offenders.push(`${side} ${code}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('B-6 · compliance/violation 不含 {{terms}}，任何 reason 模板都不含 {{value}}', () => {
    for (const side of SIDES) {
      expect(placeholdersOf(template(side, 'errors.compliance/violation') ?? ''), `${side} 的合规模板不得复述红线词`).not.toContain('terms');
      for (const row of DIRECTORY) {
        const path = `errors.reasons.${row.key}`;
        expect(placeholdersOf(template(side, path) ?? ''), `${side} 的 ${path} 不得直接插 value`).not.toContain('value');
      }
      // value 只能经「可选片段键」出现，且 not_allowed 永不追加（红线词）
      expect(placeholdersOf(template(side, 'errors.fragments.param_value') ?? '')).toEqual(['value']);
    }
  });

  it('结构闭合：errors 下每个叶子都属于允许的六类，没有拼错的野键', () => {
    const codes = new Set(PLAIN.map((entry) => `errors.${entry.code}`));
    const reasons = new Set(DIRECTORY.map((row) => `errors.reasons.${row.key}`));
    const kinds = new Set(NOT_FOUND_KINDS.map((kind) => `errors.kinds.${kind}`));
    const transport = new Set(TRANSPORT_REASONS.map((reason) => `errors.transport.${reason}`));
    const skipTokens = new Set(SKIP_TOKENS.map((token) => `errors.skip_tokens.${token}`));
    const fragments = new Set(Object.keys(FRAGMENTS));
    const stray: string[] = [];

    for (const side of SIDES) {
      for (const [path] of ENTRIES[side]) {
        const known =
          codes.has(path) ||
          reasons.has(path) ||
          kinds.has(path) ||
          transport.has(path) ||
          skipTokens.has(path) ||
          fragments.has(path) ||
          path === 'errors.upstream.wrapper';
        if (!known) stray.push(`${side} ${path}`);
      }
    }
    expect(stray, '不属于任何一类的键（多半是拼错或忘了接线）').toEqual([]);

    // 反向：这六类在两侧都必须齐全（kinds / transport / skip_tokens 少一个就会在界面露出裸记号）
    const missing: string[] = [];
    for (const side of SIDES) {
      for (const path of [...kinds, ...transport, ...skipTokens, ...fragments]) {
        const value = template(side, path);
        if (typeof value !== 'string' || value.trim() === '') missing.push(`${side} ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('B-5 · 占位符纪律（渲染面）', () => {
  it('每条 code 用「契约声明的全部 params」渲染，zh/en 都干净', () => {
    const bad: string[] = [];
    for (const entry of catalog.codes) {
      const params = declaredParams(entry.code);
      for (const side of SIDES) {
        const text = render(entry.code, params, side);
        for (const problem of problemsOf(text)) bad.push(`${side} ${entry.code}：${problem} → ${text}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('每条 code 用「后端保证发出的最小 params」渲染，zh/en 都干净', () => {
    expect(Object.keys(MINIMAL_PARAMS).sort(), 'MINIMAL_PARAMS 必须覆盖全部非 upstream code').toEqual(
      PLAIN.map((entry) => entry.code).sort(),
    );

    const bad: string[] = [];
    for (const [code, params] of Object.entries(MINIMAL_PARAMS)) {
      for (const side of SIDES) {
        const text = render(code, params, side);
        for (const problem of problemsOf(text)) bad.push(`${side} ${code}：${problem} → ${text}`);
      }
    }
    // upstream/* 的最小保证 params：GeoError::Upstream 恒发 upstream_code + upstream 两个键
    for (const entry of UPSTREAM) {
      for (const side of SIDES) {
        const text = render(entry.code, { upstream_code: 'llm/server', upstream: 'llm/server status=503' }, side);
        for (const problem of problemsOf(text)) bad.push(`${side} ${entry.code}：${problem} → ${text}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('每条 reason key 用「目录配套参数」与「最小保证参数」各渲染一次，都干净', () => {
    const bad: string[] = [];
    for (const row of DIRECTORY) {
      const companions = Object.fromEntries(row.companions.map((name) => [name, PARAM_VALUES[name] ?? name]));
      // §F-2 / §G-1：唯一「声明了但不保证发出」的配套参数是 out_of_range 的 value
      const minimal = { ...companions };
      if (row.key === 'out_of_range') delete minimal.value;
      for (const params of [companions, minimal]) {
        for (const side of SIDES) {
          const text = render('validation/failed', { field: 'brand_name', reason: row.key, ...params }, side);
          for (const problem of problemsOf(text)) {
            bad.push(`${side} reason=${row.key}：${problem} → ${text}`);
          }
        }
      }
      // 顺带钉住「查到了词典」而不是 raw passthrough：中文输出里不该出现裸 key
      expect(render('validation/failed', { field: 'brand_name', reason: row.key, ...companions }, 'zh-CN')).not.toContain(row.key);
    }
    expect(bad).toEqual([]);
  });

  it('fields 归一化后的动态 field 也能渲染成人类可读字段名', () => {
    const bad: string[] = [];
    for (const field of ['competitors[0].name', 'competitors[7].website', 'core_pages[1]', 'products[2].name']) {
      for (const side of SIDES) {
        const text = render('validation/failed', { field, reason: 'required' }, side);
        for (const problem of problemsOf(text)) bad.push(`${side} ${field}：${problem} → ${text}`);
        if (text.includes('[') || text.includes(']')) bad.push(`${side} ${field}：残留方括号 → ${text}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('AGENTS 规则 6 · 文案合规', () => {
  it('errors / fields 两侧的文案都没有绝对化用语', () => {
    const bannedZh = ['保证', '霸屏', '第一', '最好', '最强', '最优', '最先进', '国家级', '世界级', '独家'];
    const bannedEn = [/guaranteed/i, /#1/, /\bbest\b/i, /100%/, /number one/i];
    const offenders: string[] = [];

    for (const side of SIDES) {
      for (const [path, value] of [...ENTRIES[side], ...FIELD_ENTRIES[side]]) {
        for (const word of bannedZh) if (value.includes(word)) offenders.push(`${side} ${path} → ${word}`);
        for (const pattern of bannedEn) if (pattern.test(value)) offenders.push(`${side} ${path} → ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('fields · 后端会发出的 field 值都有词条', () => {
  it('§3.2 的 field 清单在 zh 与 en 都非空', () => {
    const missing: string[] = [];
    for (const side of SIDES) {
      const map = new Map(FIELD_ENTRIES[side]);
      for (const field of FIELD_VALUES) {
        const value = map.get(`fields.${field}`);
        if (typeof value !== 'string' || value.trim() === '') missing.push(`${side} fields.${field}`);
      }
    }
    expect(missing).toEqual([]);
    expect(FIELD_VALUES.length).toBeGreaterThanOrEqual(50);
  });
});

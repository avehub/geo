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
 *
 * Task 7b（裁定 B-1）补的两件事：
 * - 判据**不再住在本文件里**，而是从 `src/api/error-text.ts` 导入——生产码的兜底与门禁
 *   共用同一份实现，两份判定不可能漂移（B-1③）。
 * - 加**第三轮**「空 params / 缺配套参数」渲染。前两轮喂的都是后端保证发出的形状，
 *   这一轮喂的是退化形状，钉的是**兜底**：渲染结果不合格 ⇒ 生产码必须回落
 *   `common.unknownError`，端给用户的输出因此永远合格。
 */
/// <reference types="node" />
// `tsconfig.app.json` 的 `types` 只有 `vitest/globals` 与 `@testing-library/jest-dom`，
// 不含 node ⇒ 直接 import `node:fs` 会报 TS2591。这里用文件级的 triple-slash reference
// 把 @types/node 拉进来（B-1 要求运行时解析 Rust 目录表，绕不开 fs），
// 而不是去改 tsconfig —— 那是全项目的编译面，不在本任务写集里。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

// 清单在仓库根的 `contracts/`：从 `apps/desktop/ui/src/i18n/` 上去是 **5 层**（同 error-codes.test.ts）。
import catalogJson from '../../../../../contracts/error-codes.json';
import { IpcRequestError } from '../api/client';
import { MIN_INFO_CHARS, problemsOf } from '../api/error-text';
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

/**
 * B-5 的「干净输出」判据现在住在 `src/api/error-text.ts`（裁定 B-1③）：
 * 生产码的兜底与本文件的门禁**共用同一个函数**，所以不会再出现「门禁绿、界面露洞」。
 * 这里只留两个读起来顺手的包装。
 */
const hasProblem = (text: string, token: string) => problemsOf(text).some((p) => p.startsWith(token));

function render(code: string, params: Record<string, string>, side: Side): string {
  const error = new IpcRequestError({ code, params, message: `${code} fallback` });
  return describeIpcError(error, i18n.getFixedT(side));
}

/** 通用兜底句：渲染结果等于它，就说明生产码的质量闸门落下来了（B-1③）。 */
const unknownText = (side: Side) => i18n.getFixedT(side)('common.unknownError');

/** 结构化捕获 `console.warn`（§D-8：不许拿「输出里没有某行」当判据，vitest 会吞掉 console）。 */
const captureWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

afterEach(() => {
  vi.restoreAllMocks();
});

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

/**
 * 下面三份都是**手抄清单**（F-2e 要求把真值源写在脸上，免得它们像 Task 3 复审 N-1
 * 那样悄悄漂移）。改后端时请同步改这里；`结构闭合` 那条用例会拿它们做双向对账。
 */

/**
 * `{kind}/not_found` 的 kind 取值，5 个。
 * 真值源：`apps/desktop/src-tauri/src/error.rs:401` 的 `const NOT_FOUND_KINDS: [&str; 5]`。
 * 机器守卫：`crates/geo-domain/tests/reason_key_sites.rs` 与壳侧 `error.rs:678`/`:1162`
 * 都会遍历它；前端这一份只对词典负责。
 */
const NOT_FOUND_KINDS = ['project', 'entity_card', 'prompt_set', 'prompt_item', 'competitor'];
/**
 * `llm/transport` 的 reason 取值，3 个（**不在** `error.rs` 的 reason 目录表里，
 * 所以走 `errors.transport.*` 而不是 `errors.reasons.*`）。
 * 真值源：`crates/geo-llm/src/transport.rs:120`-`:126` 的 `reason_key()`；
 * 它自己也被 `transport.rs:508` 的 `reason_key_is_one_of_the_three_catalog_keys` 钉住。
 */
const TRANSPORT_REASONS = ['network', 'timeout', 'other'];
/**
 * `crawler/empty` 的 `skipped` 记号，3 个。
 * 真值源：`crates/geo-crawler/src/site.rs:66`/`:68`/`:70` 的三个 `pub const`
 * （`SKIP_TOTAL_TIMEOUT` / `SKIP_ROBOTS_DISALLOWED` / `SKIP_FETCH_FAILED`）。
 */
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
  // M3–M7：假后端新发的 field 值（Rust 真值源上还没有，理由见 `locales/zh-CN/fields.ts`）
  'round_id',
  'task_id',
  'record_id',
  'insight_id',
  'issue_id',
  'self_rank',
  'alert_id',
  'action_id',
  'template_id',
  'content_id',
  'variant',
  'engine_scope',
  'status',
  // M6.5 站点接入与补丁工作台：假后端新发的 field 值（同样只在 demo 侧，理由见
  // `locales/zh-CN/fields.ts` 那一节的头注释）
  'patch_id',
  'patch_title',
  'patch_target_url',
  'patch_body',
  'channel_kind',
  'kinds',
  'review_status',
  'transition',
  // M1.2 知识库：假后端新发的 field 值（spec 2026-10-01 · DR-65）
  'kb_entry_id',
  'kb_block_id',
  'kb_title',
  'kb_modules',
  // M1.5 关键词库（Plan C 第一个纵向切片）：Rust 侧已真实发射这些 field 值
  'keyword_id',
  'drafts',
  'kind',
  'intent',
  'priority',
  'monthly_volume',
  'difficulty',
  'note',
  // M1.5 FAQ 库（Plan C 第二个纵向切片）
  'faq_id',
  'question',
  'answer_markdown',
  'category',
  // M5.5 站长数据（Plan C 第五切片）
  'source_kind',
  'opportunity_id',
  'opportunity_status',
  'binding',
  'period_start',
  'period_end',
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

describe('B-1① · 判据本身（共享模块 `src/api/error-text.ts`）', () => {
  // 这两条判据是 Task 7b 补的（复审 M-1）。§E 要求「以缺席为判据的门禁必须先证明它非永真」，
  // 所以下面每条都先喂**该被抓到**的形态，再喂**不该被抓到**的形态。
  it('HOLLOW_BRACKETS 抓到「括号里只剩标签或空白」', () => {
    // 前 5 个就是复审 §A-2 数出来、旧判据静默放过的真空洞形态
    const hollow = [
      '不存在（ID：）', // zh `{kind}/not_found` + 空 params（5 条 code 同形）
      'The project was not found (ID: nope)'.replace('nope', ''), // en 同族
      '未知错误（命令 ）：', // 占位符被填空后括号内留下内边距
      '已拒收该页面（）：内容类型 不在允许范围内',
      '（  ）',
    ];
    for (const text of hollow) expect(hasProblem(text, 'HOLLOW_BRACKETS'), text).toBe(true);
  });

  it('HOLLOW_BRACKETS 不误伤「括号里真有值」的合格文案', () => {
    const fine = [
      '项目不存在（ID：nope）',
      'The project was not found (ID: nope)',
      '抓取网页失败：上游返回了非 2xx 状态码（HTTP 503），页面 https://a.example/news',
      '模型服务配置有问题：缺少模型名（custom）', // 复审建议的简化正则会在这里误伤
      '配置无效：系统钥匙串读写失败（keyring_unavailable）',
      '数据状态冲突：存在重复项（UNIQUE constraint failed: prompt_items.text）',
      '抓取 https://a.example/ 后没有得到任何可用页面；跳过的页面：https://a.example/news（总时长预算用尽）',
      '还没有配置 API Key，请先在「设置」里填写并保存', // 引号括号里是真词
      '标签超出允许范围（<=20）（5）',
      '文件或数据库读写失败：Permission denied (os error 13)',
    ];
    for (const text of fine) expect(problemsOf(text), text).toEqual([]);
  });

  it('TOO_SHORT 抓到「短到不承载信息」的渲染结果', () => {
    // `链接` 是复审 §A-2 的第 6 个真空洞：zh `crawler/invalid_url` + 空 params
    expect(hasProblem('链接', 'TOO_SHORT')).toBe(true);
    expect(hasProblem('不能为空', 'TOO_SHORT')).toBe(true); // field 为空串时的退化形态
    expect(hasProblem('', 'TOO_SHORT')).toBe(true);
  });

  it('TOO_SHORT 的阈值留了余量：合格渲染里最短的也比它长', () => {
    // 实测口径：现有四轮共 272 次合格渲染中，信息字符（字母+数字，含 CJK）最少的是 **7**
    // （zh「品牌名不能为空」）。阈值取 5 ⇒ 真空洞 `链接`(2) 被抓，合格文案一条不误伤。
    // **更正**（本轮第 4 个 commit · 报告 §9.3 / N-3）：原先记的是 6（zh「链接不能为空」）——
    // F-2g 把 `crawler/invalid_url` 的 zh 模板改成 `链接{{reason}}：{{url}}` 之后那条渲染变长，
    // 最短值升到 7。下面样本里仍保留「链接不能为空」(6)：它是个**更紧的**下界样本，
    // `6 >= 5` 依然成立，留着无害（本断言判的是「样本 >= MIN_INFO_CHARS」，不是「样本 == 最短值」）。
    const shortest = ['链接不能为空', '品牌名不能为空', '抓取超时：https://a.example/news'];
    for (const text of shortest) {
      const infoChars = text.replace(/[^\p{L}\p{N}]/gu, '').length;
      expect(infoChars, text).toBeGreaterThanOrEqual(MIN_INFO_CHARS);
      expect(hasProblem(text, 'TOO_SHORT'), text).toBe(false);
    }
  });
});

describe('B-5 · 占位符纪律（渲染面）', () => {
  it('每条 code 用「契约声明的全部 params」渲染，zh/en 都干净', () => {
    const warn = captureWarn();
    const bad: string[] = [];
    let shortest = Number.MAX_SAFE_INTEGER;
    for (const entry of catalog.codes) {
      const params = declaredParams(entry.code);
      for (const side of SIDES) {
        const text = render(entry.code, params, side);
        for (const problem of problemsOf(text)) bad.push(`${side} ${entry.code}：${problem} → ${text}`);
        shortest = Math.min(shortest, text.replace(/[^\p{L}\p{N}]/gu, '').length);
      }
    }
    expect(bad).toEqual([]);
    // 反向：合格渲染**不许**被 B-1③ 的兜底顶掉——否则「模板退化」会被兜底句掩盖成一片绿
    expect(warn, '合格渲染不该触发兜底 warn').not.toHaveBeenCalled();
    // TOO_SHORT 的阈值必须比最短的合格渲染还小，否则这一轮自己就会误伤
    expect(shortest).toBeGreaterThanOrEqual(MIN_INFO_CHARS);
  });

  it('每条 code 用「后端保证发出的最小 params」渲染，zh/en 都干净', () => {
    const warn = captureWarn();
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
    expect(warn, '合格渲染不该触发兜底 warn').not.toHaveBeenCalled();
  });

  it('每条 reason key 用「目录配套参数」与「最小保证参数」各渲染一次，都干净', () => {
    const warn = captureWarn();
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
    expect(warn, '合格渲染不该触发兜底 warn').not.toHaveBeenCalled();
  });

  it('fields 归一化后的动态 field 也能渲染成人类可读字段名', () => {
    const warn = captureWarn();
    const bad: string[] = [];
    for (const field of ['competitors[0].name', 'competitors[7].website', 'core_pages[1]', 'products[2].name']) {
      for (const side of SIDES) {
        const text = render('validation/failed', { field, reason: 'required' }, side);
        for (const problem of problemsOf(text)) bad.push(`${side} ${field}：${problem} → ${text}`);
        if (text.includes('[') || text.includes(']')) bad.push(`${side} ${field}：残留方括号 → ${text}`);
      }
    }
    expect(bad).toEqual([]);
    expect(warn, '合格渲染不该触发兜底 warn').not.toHaveBeenCalled();
  });
});

describe('B-1② · 第三轮：退化 params 一律被兜底挡住（裁定 B-1）', () => {
  /**
   * 「空 params 是不是正常输入」用**输出口径**分开，不看契约里 params 有几条：
   *
   * - 模板里**没有**占位符 ⇒ 空 params 是正常输入，渲染本来就合格，**不该**兜底。
   *   今天有 5 条：契约 params 为空的 4 条（`ipc/internal` / `llm/missing_secret` /
   *   `llm/rate_limited` / `prompt_set/empty_import`），加上 `compliance/violation`
   *   ——它契约里登记了 `terms`，但模板**刻意不复述**红线词（B-6），所以也不含占位符。
   * - 模板里**有**占位符 ⇒ 空 params 必然挖出洞 ⇒ 必须兜底成 `common.unknownError`。
   *
   * 这条一一对应是**防漂移**的关键：判据一旦放松到放过某个空洞，`fellBack` 就与
   * `hasPlaceholder` 不再相等，测试立刻红——不会因为兜底句本身「合格」而静默变绿。
   */
  it('每条非 upstream code 喂 `params: {}`：输出合格，且兜底触发条件与「模板有占位符」一一对应', () => {
    const warn = captureWarn();
    const bad: string[] = [];
    const drift: string[] = [];
    let fallbacks = 0;

    for (const entry of PLAIN) {
      for (const side of SIDES) {
        const text = render(entry.code, {}, side);
        for (const problem of problemsOf(text)) bad.push(`${side} ${entry.code}：${problem} → ${text}`);

        const fellBack = text === unknownText(side);
        if (fellBack) fallbacks += 1;
        const hasPlaceholder = placeholdersOf(template(side, `errors.${entry.code}`) ?? '').length > 0;
        if (fellBack !== hasPlaceholder) {
          drift.push(`${side} ${entry.code}：兜底=${String(fellBack)} 模板有占位符=${String(hasPlaceholder)} → ${text}`);
        }
      }
    }

    expect(bad, '端给用户的输出必须合格').toEqual([]);
    expect(drift, '兜底触发条件与「模板有占位符」不再一一对应').toEqual([]);
    // 非永真（§E）：兜底必须真的落下来过，且每次恰好 warn 一声
    expect(fallbacks).toBe(
      PLAIN.filter((entry) => placeholdersOf(template('zh-CN', `errors.${entry.code}`) ?? '').length > 0).length *
        SIDES.length,
    );
    expect(fallbacks).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledTimes(fallbacks);
  });

  it('模板不含占位符的那 5 条 code，空 params 属正常输入，不许兜底', () => {
    const noPlaceholder = PLAIN.filter((entry) =>
      SIDES.every((side) => placeholdersOf(template(side, `errors.${entry.code}`) ?? '').length === 0),
    )
      .map((entry) => entry.code)
      .sort();

    expect(noPlaceholder).toEqual(
      [
        'compliance/violation',
        'ipc/internal',
        'llm/missing_secret',
        'llm/rate_limited',
        'prompt_set/empty_import',
      ].sort(),
    );

    const warn = captureWarn();
    for (const code of noPlaceholder) {
      for (const side of SIDES) {
        const text = render(code, {}, side);
        expect(text, `${side} ${code}`).not.toBe(unknownText(side));
        expect(problemsOf(text), `${side} ${code}`).toEqual([]);
      }
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('每条 reason 只带 `{field, reason}`（配套参数全缺）：输出合格，缺值的那几条被兜底', () => {
    const warn = captureWarn();
    const bad: string[] = [];
    const fellBack: string[] = [];

    for (const row of DIRECTORY) {
      for (const side of SIDES) {
        const text = render('validation/failed', { field: 'brand_name', reason: row.key }, side);
        for (const problem of problemsOf(text)) bad.push(`${side} reason=${row.key}：${problem} → ${text}`);
        if (text === unknownText(side)) fellBack.push(`${side} reason=${row.key}`);
      }
    }

    expect(bad).toEqual([]);
    // 非永真：zh 的 too_long / too_short / out_of_range 与 en 的 out_of_range 确实会被兜底
    expect(fellBack.length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledTimes(fellBack.length);
  });
});

describe('AGENTS 规则 6 · 文案合规', () => {
  /**
   * zh 侧绝对化用语。一律用 `RegExp`（原先是裸子串 + `includes`），因为 `第一` 必须带**负向前瞻**。
   *
   * Task 15a 第 10 条（台账 #42）：裸 `'第一'` 会把**序数**用法一起判红——
   * 「第一条」是 CSV 的行序、「第一列」是表头列序、「第一步」是向导步骤，都是合法文案
   * （Task 12 / Task 13 复审各撞过一次这个假阳性）。广告法语境下要禁的是**名次断言**
   * （「排名第一」「全网第一」，或句末光杆的「第一」），后面紧跟量词的一律不是。
   *
   * 前瞻词表取本仓已收敛的那一份：`task-13-brief.md` §6 的合规红线正则
   * `第一(?!次|天|步|轮|批|版|层|手|线|季度)`，再加 `task-13-review.md` §12 建议补的 `条|列|行`。
   *
   * ⚠ 这**不是**放宽判据。裸 `第一` 在今天词典面上的命中数是 **0**，加前瞻之后仍然是 **0**
   * （下面那条主断言逐字未变）；变的只是「以后写一条合法序数文案不会被误判」。
   * 反过来说，前瞻词表里每多一个词都是**放过一类文案**，所以词表本身被对照组逐条钉住。
   */
  /**
   * `第一` 后面跟这些字时**只可能是序数**，不是名次断言 ⇒ 放行（15b #53 扩容）。
   *
   * 15a 那 13 支是「本仓已经撞过的」；#53 复审指出**常见量词没补齐**：`第一个` / `第一张` /
   * `第一份` / `第一项` 这些今天都会**假红**（方向安全但会误伤，写一条合法的向导文案就得回来改词表）。
   * 补的 20 支全是**量词 / 结构单位 / 时间单位**，语义上不可能构成「我们是第一」这种名次断言。
   *
   * 🔴 判据方向：假红可以修（补词），**假绿修不回来**（文案已经进仓、已经上屏）。
   * 所以宁可在 `FIRST_RANKING_SUFFIXES` 那一侧保守，也不往这里塞有歧义的字。
   */
  const FIRST_ORDINAL_BRANCHES = [
    // 15a（第 10 条）原有的 13 支
    '次', '天', '步', '轮', '批', '版', '层', '手', '线', '季度', '条', '列', '行',
    // 15b #53 补的 20 支
    '个', '张', '份', '项', '页', '组', '遍', '章', '节', '段', '周', '年', '集',
    '期', '课', '题', '点', '种', '类', '代',
  ] as const;

  /**
   * 🔴 **刻意不放行**的后缀（15b #53）：跟在「第一」后面时**仍然可能是名次断言**，
   * 放进白名单就是假绿。复审席已核过最危险的 `第一名` 确实被抓（`名` 不在白名单）；
   * 这里把同风险的另外几支也一并钉住，并在对照组里逐支验「必须判红」。
   *
   * - `名`：第一名 = 名次
   * - `位`：「行业第一位」「首位」同族，是名次
   * - `号`：第一号 = No.1，是名次
   * - `军` / `档` / `梯队` / `流` / `品牌`：同理（「第一梯队」「第一品牌」都是广告法红线）
   */
  const FIRST_RANKING_SUFFIXES = ['名', '位', '号', '军', '档', '梯队', '流', '品牌'] as const;

  const bannedZh: readonly RegExp[] = [
    /保证/,
    /霸屏/,
    // 由白名单**生成**（不手写第二份），下面对照组再把 `source` 逐字钉死 ⇒ 两边不许漂移。
    new RegExp(`第一(?!${FIRST_ORDINAL_BRANCHES.join('|')})`),
    /最好/,
    /最强/,
    /最优/,
    /最先进/,
    /国家级/,
    /世界级/,
    /独家/,
  ];

  /** en 侧同理（AGENTS 规则 6：禁 `guaranteed ranking` / `#1` / `best` / `100%`）。 */
  const bannedEn: readonly RegExp[] = [/guaranteed/i, /#1/, /\bbest\b/i, /100%/, /number one/i];

  type ComplianceEntry = readonly [side: string, path: string, value: string];

  /** 判据本体抽成函数，好让对照组能拿**探针数据**喂它（否则「0 条违规」是永真断言）。 */
  function scanCompliance(probe: readonly ComplianceEntry[]): string[] {
    const offenders: string[] = [];
    for (const [side, path, value] of probe) {
      for (const pattern of bannedZh) if (pattern.test(value)) offenders.push(`${side} ${path} → ${pattern}`);
      for (const pattern of bannedEn) if (pattern.test(value)) offenders.push(`${side} ${path} → ${pattern}`);
    }
    return offenders;
  }

  /**
   * 合规扫描面覆盖的 namespace（15b #49 / 15a 复审 M-2）。
   *
   * 🔴 **M-2 是存量缺口**：AGENTS 规则 6 的扫描原先只覆盖 `errors` + `fields` 两个 namespace，
   * 而 `locales/zh-CN/` 有 **9** 个 ⇒ 其余七个（`common` / `nav` / `project` / `prompt` /
   * `entity` / `settings` / `demo`）的**用户可见文案根本不过合规扫描**。15c 的 #22（改
   * `deleteConfirmContent`）与 #23（钥匙串文案）正要往未覆盖区加文案 ⇒ 必须先扩面。
   *
   * M3–M7 那轮又长了 5 个（`collection` / `insight` / `diagnosis` / `action` / `report`），
   * M5.5 再加 1 个（`webmasterData`），今天一共 **19** 个：报告与处方的文案是要发给老板和客户的，
   * 合规扫描更不能漏；
   * M1.5 的 `library`（关键词库 / FAQ 库）同样要发给客户看——它直接导出成官网的 FAQPage
   * 结构化数据，是**对外**文案，所以一并进扫描面。
   * M6.5 的 `site`（补丁正文要下发到客户官网）与 M1.2 的 `kb`（知识册要交给内容团队与
   * 代运营，也是**对外**文案）同理由，一并进扫描面。
   * M6 的 `article`（文章正文要发出去当官网内容，模板提示词还直接约束撰稿模型的口径）
   * 同理由，一并进扫描面。
   * M5.5 的 `webmasterData`（站长数据）进扫描面的理由更硬：机会文案与 CTR 基准都要拿给客户
   * 或客户的老板看，而这一页天生要谈"排名与点击率"⇒ 正是绝对化用语最容易溜进来的地方
   * （spec 2026-10-12 · DR-99 / DR-105 / DR-115 都点名了规则 6）。
   *
   * 顺序照 `locales/zh-CN/index.ts` 的资源树（计划正文固定的那个顺序）。
   */
  const COMPLIANCE_NAMESPACES = [
    'common',
    'nav',
    'errors',
    'fields',
    'project',
    'prompt',
    'entity',
    'settings',
    'demo',
    // M3–M7 的 5 个（顺序照 `locales/zh-CN/index.ts` 的资源树 = 里程碑顺序）
    'collection',
    'insight',
    'diagnosis',
    'action',
    'report',
    // M1.5 素材层的 1 个（关键词库与 FAQ 库共用，见 `locales/zh-CN/library.ts` 的文件头）
    'library',
    // M6.5 站点接入的 1 个（补丁工作台；正文要下发到客户官网 ⇒ 对外文案）
    'site',
    // M1.2 知识层的 1 个（知识库；导出的知识册要给内容团队与代运营 ⇒ 对外文案）
    'kb',
    // M6 文章管理的 1 个（文章管理；生成的稿子要发出去当内容 ⇒ 对外文案）
    'article',
    // M5.5 站长数据的 1 个（多平台汇总与优化机会；要拿给客户或客户的老板看 ⇒ 对外文案）
    'webmasterData',
    // 2026-10-29 项目概览（首页）：KPI / 风险 / 行动入口都要给客户看 ⇒ 对外文案
    'overview',
    // M9 组合总览：跨项目分布与项目清单同样要给客户/老板看 ⇒ 对外文案
    'portfolio',
    // 2026-10-30 设计样张（dev-only）：虽然不上生产，但它在 `pages/**` 的源码扫描面里，
    // 文案同样走词典 ⇒ 一并进合规面，避免「dev-only 就可以乱写」的缺口。
    'design',
  ] as const;

  /**
   * 今天的词典面：**全部 22 个 namespace**、两侧全部叶子（15b #49 扩面，原先只有 errors + fields）。
   *
   * 从资源树**现算**（`leaves(zhCN[ns], ns)`），不手抄键名：`ENTRIES` / `FIELD_ENTRIES` 那两个
   * 预算好的常量继续留给「errors 与 fields 的键集双向相等」那组用（它们的判据是**键集**，
   * 不是合规），本函数不再复用它们，免得「合规面 = 那两个常量」这个隐含等式再回来。
   *
   * path 一律带 namespace 前缀（`common.loading`），所以 offenders 能直接指到键。
   */
  function dictionaryProbe(): ComplianceEntry[] {
    const probe: ComplianceEntry[] = [];
    for (const side of SIDES) {
      const tree: Record<string, unknown> = side === 'zh-CN' ? zhCN : enUS;
      for (const namespace of COMPLIANCE_NAMESPACES) {
        for (const [path, value] of leaves(tree[namespace], namespace)) {
          probe.push([side, path, value]);
        }
      }
    }
    return probe;
  }


  it('全部 22 个 namespace、两侧的文案都没有绝对化用语', () => {
    const probe = dictionaryProbe();
    // 防空跑：词典面塌成空集时「0 条违规」是永真的。920 = 9 个 namespace × 两侧各 460 个叶子
    // （15c-1 的 #23/#47/#25 与 15c-2 的 #54 两侧同批各加 4 键）；M3–M7 又加了 5 个 namespace
    // 与 13 个 field 标签，所以今天的下界抬到 1800（写**下界**而不是精确值：新增一条文案不该打红门禁）。
    expect(probe.length, '合规扫描面塌了 ⇒ 判据已失效').toBeGreaterThanOrEqual(1800);
    // 🔴 覆盖面自查（15b #49 的本体）：probe 里出现的 namespace 必须**恰好**是词典的全部 21 个。
    // 少了 ⇒ 又回到 M-2 那个缺口；多了 ⇒ 说明 path 前缀被谁改坏了。
    expect(
      [...new Set(probe.map(([, path]) => path.split('.')[0]))].sort(),
      '合规扫描没覆盖全部 namespace ⇒ 那片文案不过 AGENTS 规则 6（15a 复审 M-2）',
    ).toEqual([...COMPLIANCE_NAMESPACES].sort());
    // 词典再长出一个 namespace 时，上面那条会**静默绿**（新 ns 不在 probe 里，两边都不提它）
    // ⇒ 再钉一条：清单必须与资源树的键集逐字相等。
    expect(Object.keys(zhCN).sort(), '词典新增了 namespace，合规扫描面必须同步扩').toEqual(
      [...COMPLIANCE_NAMESPACES].sort(),
    );
    expect(scanCompliance(probe)).toEqual([]);
  });

  /**
   * 对照组（第 10 条的硬要求）：证明加了负向前瞻之后判据**既不是永真也不是永假**。
   * 名次断言必须红、序数必须过，两个方向各钉一组；再端到端验一次 `scanCompliance`。
   */
  it('自证（对照组）：`第一` 的负向前瞻只放过序数，名次断言照旧判红', () => {
    const first = bannedZh.find((pattern) => pattern.source.startsWith('第一'));
    if (first === undefined) throw new Error('bannedZh 里必须有「第一」那一条');
    // 前瞻词表**逐字**钉死：多一支（放过一类名次断言）或少一支（误伤一类序数）都红。
    expect(first.source).toBe(
      '第一(?!次|天|步|轮|批|版|层|手|线|季度|条|列|行' +
        '|个|张|份|项|页|组|遍|章|节|段|周|年|集|期|课|题|点|种|类|代)',
    );
    // 词表本体也逐字钉住（正则由它生成 ⇒ 两边不许漂移）
    expect([...FIRST_ORDINAL_BRANCHES]).toEqual([
      '次', '天', '步', '轮', '批', '版', '层', '手', '线', '季度', '条', '列', '行',
      '个', '张', '份', '项', '页', '组', '遍', '章', '节', '段', '周', '年', '集',
      '期', '课', '题', '点', '种', '类', '代',
    ]);
    expect(first.source).toBe(`第一(?!${FIRST_ORDINAL_BRANCHES.join('|')})`);

    // ① 名次断言：必须命中（含句末光杆的「第一」，以及 15b #53 明令**不放行**的那几支）
    for (const claim of [
      '第一', '排名第一', '全网第一', '行业第一', '第一品牌', '销量第一',
      '第一名', '第一位', '第一号', '第一军', '第一档', '第一梯队', '第一流',
    ]) {
      expect(first.test(claim), `名次断言「${claim}」漏判了`).toBe(true);
    }
    // ② 序数用法：必须放过。**逐支**验（不是抽样），少一支就红
    for (const branch of FIRST_ORDINAL_BRANCHES) {
      expect(first.test(`第一${branch}`), `序数「第一${branch}」被误判成绝对化用语了`).toBe(false);
    }
    // ③ 白名单与「刻意不放行」那份不许重叠（有人往白名单里塞 `名` ⇒ 这条红）
    for (const ranking of FIRST_RANKING_SUFFIXES) {
      expect(FIRST_ORDINAL_BRANCHES, `「${ranking}」是名次断言后缀，不许进序数白名单`).not.toContain(
        ranking,
      );
      expect(first.test(`第一${ranking}`), `「第一${ranking}」必须判红`).toBe(true);
    }

    // ④ 端到端：把一条名次断言塞进扫描面 ⇒ offenders 必须点名它
    expect(scanCompliance([['zh-CN', 'errors.reasons.probe', '排名第一']])).toEqual([
      `zh-CN errors.reasons.probe → ${first}`,
    ]);
    // 同一条判据喂序数 ⇒ 干净
    expect(scanCompliance([['zh-CN', 'errors.reasons.probe', '第一条记录不合法']])).toEqual([]);

    // ⑤ 其余 zh 词与 en 词也各验一条（证明换成 RegExp 之后整张表还在工作，不是只剩 `第一`）
    expect(scanCompliance([['zh-CN', 'errors.reasons.probe', '保证排名']])).toHaveLength(1);
    expect(scanCompliance([['zh-CN', 'errors.reasons.probe', '业内最先进']])).toHaveLength(1);
    expect(scanCompliance([['en-US', 'errors.reasons.probe', 'Guaranteed ranking']])).toHaveLength(1);
    expect(scanCompliance([['en-US', 'errors.reasons.probe', 'The #1 choice']])).toHaveLength(1);
    expect(scanCompliance([['en-US', 'errors.reasons.probe', '100% accurate']])).toHaveLength(1);
    expect(scanCompliance([['en-US', 'errors.reasons.probe', 'the best provider']])).toHaveLength(1);
  });
});

describe('fields · 词典与手抄清单**双向**相等（F-2e）', () => {
  /**
   * `FIELD_VALUES` 是**手抄快照**：field 不可穷举（后端 `set_field` 家族一律用动态
   * `field_path`，见简报 §A-6），所以这一组守的**不是**「后端发的每个 field 都有词条」
   * ——那一条由 raw passthrough（裁定 B-4）兜底、由 Task 8/9 的页面测试兜底。
   *
   * 它守的是**反向**：词典不许悄悄长出没人认领的键（拼错一个 field 名、或建一条永远
   * 用不到的词条）。复审 M-4 实测过：往 zh 与 en 的 `fields.ts` 同时塞一个野键，
   * test / build / lint 三道门**全绿**——缺的就是下面这条反向断言。
   * 真值源：`task-5-report.md` §3.2 / §3.3 + geo-domain 的其余 `validation()` 站点。
   */
  it('FIELD_VALUES 与两侧词典的 fields.* 叶子集合相等，且值都非空', () => {
    for (const side of SIDES) {
      const map = new Map(FIELD_ENTRIES[side]);
      const dictFields = [...map.keys()].map((path) => path.slice('fields.'.length));

      expect({
        side,
        词典缺失: FIELD_VALUES.filter((field) => !dictFields.includes(field)),
        词典多出: dictFields.filter((field) => !FIELD_VALUES.includes(field)),
        空值: [...map].filter(([, value]) => value.trim() === '').map(([path]) => path),
      }).toEqual({ side, 词典缺失: [], 词典多出: [], 空值: [] });
    }
    expect(FIELD_VALUES.length).toBeGreaterThanOrEqual(50);
  });
});

describe('F-2d · en 字段标签一律单数头名词（主谓一致）', () => {
  /**
   * **为什么这一组住在 `dictionary.test.ts`**（控制器要求说明选择理由）：
   * 它守的是**词典内容的词形**，不是 `describeIpcError` 的行为。同族的 F-2e
   * 「`FIELD_VALUES` 与词典双向相等」也在这里（`:804`），两条守卫共用 `FIELD_ENTRIES`，
   * 而且本组还要用 `DIRECTORY` / `template()` / `render()`——这三样都是本文件的模块级私有。
   * `errors.test.ts:261`/`:275` 钉的是 `tags` / `ids` 出现在**句子**里的形态（行为面），保留不动、不重复。
   */
  const EN_FIELDS = new Map(FIELD_ENTRIES['en-US']);

  /**
   * F-2d 逐条改过的 **8** 个标签：复审 M-2 实测可达的 2 条（`aliases` / `ids`）+ 今天不可达的 6 条。
   * 真值源：`task-7-review.md` §6 的 F-2d 行 + `en-US/fields.ts`。
   *
   * 这一份存在的原因是**变异自证抓到的缺口**（`task-7b-report.md` §8.3 的 M13 / M13d）：
   * 把 `aliases` 改回 `'Brand aliases'`、或 `qualifications` 改回 `'Qualifications'`，
   * 原先全量 161 条用例**全绿**——8 个标签里只有 `tags` / `ids` 被 `errors.test.ts` 顺带钉住。
   */
  const F2D_LABELS: ReadonlyArray<readonly [field: string, en: string]> = [
    ['aliases', 'Brand alias list'],
    ['tags', 'Tag list'],
    ['ids', 'Selected item list'],
    ['qualifications', 'Qualification list'],
    ['products', 'Product and spec list'],
    ['service_regions', 'Service region list'],
    ['cases', 'Customer case list'],
    ['differentiators', 'Differentiator list'],
  ];

  /**
   * en 的 reason 文案以**单数谓语**开头的那一批：只有跟它们组合，复数标签才真的产生主谓不一致
   * （`row_invalid` 的 `this row…`、`http_status` 的 `the upstream…`、`secret_unavailable` 的
   * `the system…` 这类不以动词开头，不参与对账）。
   * **从词典现算，不手抄**——真值源就是 `en-US/errors.ts` 的 `reasons`（今天 23 条里 18 条命中）。
   */
  const SINGULAR_VERB = /^(?:is|has|was|does|exceeds|contains|points|could|must|failed)\b/i;
  const singularVerbReasons = DIRECTORY.map((row) => row.key).filter((key) =>
    SINGULAR_VERB.test(template('en-US', `errors.reasons.${key}`) ?? ''),
  );

  /** 句子里「复数名词 + 单数动词」的撞击形态：词尾 s、空白、单数谓语。 */
  const CLASH = /\bs\s+(?:is|has|was|does|exceeds|contains|points|could|must|failed)\b/i;

  /**
   * 头名词**合法**为复数的 en 标签（例外表，逐条有据）。
   *
   * 这一份是**假阳性对账**的产物：52 个 en 标签里，首词或末词以 `s` 结尾的原先有 5 个。
   * 新增条目需要控制器签字，且 `expect(PLURAL_HEAD_KNOWN.size).toBe(1)` 与「反向哨兵」那条会立刻红。
   *
   * # 5 → 1：残留 N-5 已在 Task 15a 第 11 条清掉（台账 #03）
   *
   * 原先记在 `task-7b-report.md` §11 的 **N-5** 是 4 条**真缺陷**（不是假阳性）：
   * `repeat_count` = `'Rewrite rounds'`、`concurrency.max_parallel` = `'Max parallel requests'`、
   * `rate_limit.requests_per_minute` = `'Requests per minute'`、`rate_limit.retry_max` = `'Max retries'`，
   * 与单数谓语组合后确实渲染出 `"Rewrite rounds is outside the allowed range (…)"` 这种主谓不一致句，
   * 而且**可达**：`repeat_count` 走 `crates/geo-domain/src/prompt.rs:239` 与
   * `services/prompt_service.rs:171` 的 `out_of_range`；另外 3 个走
   * `services/settings_service.rs:302`-`:327` 的 `in_range()`（同样发 `out_of_range`）。
   * 当时因为「控制器明令不许碰词典文件」只记账不改。
   *
   * Task 15a 改了 `en-US/fields.ts` 那 4 行（`'Rewrite round count'` / `'Parallel request limit'` /
   * `'Per-minute request limit'` / `'Max retry count'`），4 条真缺陷关闭 ⇒ 例外表只剩下面这 1 条**假阳性**。
   *
   * 判据强度：`size` 从 5 收到 1 **不是**放宽。反向哨兵那条断言的是「带复数头名词的标签集合
   * == 例外表」，两边同时缩小 ⇒ 结构性守卫的**被判定面从 47 个标签扩到 51 个**。
   * 对价另有一条：下面新增的 `N5_LABELS` 把这 4 个标签**逐字钉住**并走真实渲染路径验整句主谓一致
   * （与 `F2D_LABELS` 同形），也就是从「登记在例外表里、不参与判定」升级成「逐字钉住 + 端到端判定」
   * （简报 §D：退休/替换必须同时扩强别处）。
   */
  const PLURAL_HEAD_KNOWN: ReadonlyMap<string, string> = new Map([
    ['competitors', '"Number of competitors" 的头名词是 Number（单数），"Number of competitors is outside…" 语法正确——**不是**缺陷'],
  ]);

  /**
   * 首词或末词以 `s` 结尾 ⇒ 头名词**可能**是复数。刻意保守（宁多进例外表，不漏判）：
   * 只看首末两个词，所以 `Brand alias list` 中间的 `alias` 不会被误伤。
   * 已知局限：头名词本身以 s 结尾的**单数**词（`Business` / `Status` / `Address`）会被误判，
   * 那时把它加进 `PLURAL_HEAD_KNOWN` 并写明理由（今天 52 个标签里一个都没有）。
   */
  function pluralHead(label: string): string | null {
    const words = label.trim().split(/\s+/);
    for (const word of [words[0], words[words.length - 1]]) {
      if (word !== undefined && /s$/i.test(word)) return word;
    }
    return null;
  }

  it('F-2d 改过的 8 个 en 标签逐字钉住，且与单数谓语组合后整句主谓一致', () => {
    // 非永真：8 条一条不许漏钉
    expect(F2D_LABELS.length, 'F-2d 改了 8 个 en 标签，这里必须钉满 8 条').toBe(8);

    const drifted: string[] = [];
    for (const [field, expected] of F2D_LABELS) {
      const actual = EN_FIELDS.get(`fields.${field}`);
      if (actual !== expected) {
        drifted.push(`${field}: 期望 "${expected}"，实际 "${actual ?? '(词典里没有这个键)'}"`);
      }
    }
    expect(drifted, 'en 标签被改回了复数形态（F-2d 回退）').toEqual([]);

    // 端到端：走真实渲染路径（不只是词典取值），整句必须与单数谓语一致
    for (const [field, expected] of F2D_LABELS) {
      expect(render('validation/failed', { field, reason: 'required' }, 'en-US'), field).toBe(
        `${expected} is required`,
      );
    }

    // 8 个标签 × 18 条单数谓语 reason = 144 句，一句都不许出现「复数名词 + 单数动词」
    const clashes: string[] = [];
    for (const [field] of F2D_LABELS) {
      const label = EN_FIELDS.get(`fields.${field}`) ?? '';
      for (const key of singularVerbReasons) {
        const sentence = `${label} ${template('en-US', `errors.reasons.${key}`) ?? ''}`;
        if (CLASH.test(sentence)) clashes.push(`${field} × ${key} → ${sentence}`);
      }
    }
    expect(singularVerbReasons.length, '单数谓语 reason 今天应有 18 条，塌成空集就是判据失效').toBe(18);
    expect(clashes).toEqual([]);
  });

  /**
   * Task 15a 第 11 条（残留 **N-5** 清账 · 台账 #03）逐条改过的 **4** 个 en 标签。
   *
   * 与 `F2D_LABELS` 同形：先逐字钉住（把任何一个改回复数形态就红），再走真实渲染路径
   * 验整句主谓一致。真值源：`en-US/fields.ts` + 上面 `PLURAL_HEAD_KNOWN` 那段 N-5 的可达性论证
   * （`repeat_count` 走 `prompt.rs:239` / `prompt_service.rs:171`，另 3 个走
   * `settings_service.rs:302`-`:327` 的 `in_range()`，全都发 `out_of_range`）。
   */
  const N5_LABELS: ReadonlyArray<readonly [field: string, en: string]> = [
    ['repeat_count', 'Rewrite round count'],
    ['concurrency.max_parallel', 'Parallel request limit'],
    ['rate_limit.requests_per_minute', 'Per-minute request limit'],
    ['rate_limit.retry_max', 'Max retry count'],
  ];

  it('N-5 清账：4 个 en 标签逐字钉住，且与单数谓语组合后整句主谓一致', () => {
    // 非永真：4 条一条不许漏钉
    expect(N5_LABELS.length, 'N-5 是 4 条残留，这里必须钉满 4 条').toBe(4);

    const drifted: string[] = [];
    for (const [field, expected] of N5_LABELS) {
      const actual = EN_FIELDS.get(`fields.${field}`);
      if (actual !== expected) {
        drifted.push(`${field}: 期望 "${expected}"，实际 "${actual ?? '(词典里没有这个键)'}"`);
      }
    }
    expect(drifted, 'en 标签被改回了复数形态（N-5 回退）').toEqual([]);

    // 端到端：走真实渲染路径（不只是词典取值），整句必须与单数谓语一致
    for (const [field, expected] of N5_LABELS) {
      expect(render('validation/failed', { field, reason: 'required' }, 'en-US'), field).toBe(
        `${expected} is required`,
      );
    }

    // 4 个标签 × 18 条单数谓语 reason = 72 句，一句都不许出现「复数名词 + 单数动词」
    const clashes: string[] = [];
    for (const [field] of N5_LABELS) {
      const label = EN_FIELDS.get(`fields.${field}`) ?? '';
      for (const key of singularVerbReasons) {
        const sentence = `${label} ${template('en-US', `errors.reasons.${key}`) ?? ''}`;
        if (CLASH.test(sentence)) clashes.push(`${field} × ${key} → ${sentence}`);
      }
    }
    expect(singularVerbReasons.length, '单数谓语 reason 今天应有 18 条，塌成空集就是判据失效').toBe(18);
    expect(clashes).toEqual([]);
  });

  it('全部 en 标签的头名词都是单数（结构性守卫；例外表逐条有据且不许悄悄长大）', () => {
    // 防空跑：例外表与词典都不许塌成空集
    expect(PLURAL_HEAD_KNOWN.size).toBe(1);
    expect(EN_FIELDS.size).toBeGreaterThanOrEqual(50);

    const bad: string[] = [];
    for (const [path, label] of EN_FIELDS) {
      const head = pluralHead(label);
      if (head === null) continue;
      const field = path.slice('fields.'.length);
      if (PLURAL_HEAD_KNOWN.has(field)) continue;
      const reason = template('en-US', `errors.reasons.${singularVerbReasons[0]}`) ?? '';
      bad.push(`${field}: "${label}"（头名词 "${head}"）→ "${label} ${reason}"`);
    }
    expect(bad, '新的 en 标签用了复数头名词，会渲染出主谓不一致的句子').toEqual([]);

    // 反向哨兵（§E）：守卫**确实**数得出东西——今天带复数头名词的标签集合，
    // 恰好等于例外表。这条同时挡住两种劣化：例外表被随手加胖、以及 `pluralHead()` 退化成永假。
    const seen = [...EN_FIELDS]
      .filter(([, label]) => pluralHead(label) !== null)
      .map(([path]) => path.slice('fields.'.length))
      .sort();
    expect(seen).toEqual([...PLURAL_HEAD_KNOWN.keys()].sort());
  });
});

/**
 * #22（台账 #43 #41 #36 同一根因，一并处置）：**上屏文案不许承诺 demo 不会做的重算**。
 *
 * 出事的那句是 `prompt.promptSet.deleteConfirmContent`：它写着「内容哈希与样本量分级**会重算**」，
 * 而 demo 按 AGENTS 规则 9 **不重算** `sample_size_grade`（分级阈值是领域算法；导入、增删条目
 * 都只继承静态值，见 `demo/handlers/prompt.ts:21` 与 `demo/handlers/project-transfer.ts`）。
 * 这是**会上屏的过度承诺**——产品负责人在 demo 里删一条题库就会看见界面撒谎。
 *
 * 裁定是「改文案，不承诺重算」，并且**不加**每页可见提示（`components/DemoBanner.tsx` 的常驻 demo 横幅已经兜底）。
 * 这里把它落成常驻判据：词典任何叶子都不许同时出现「分级/档位」与「重算/重新计算」
 * （en 侧同理）。**只禁分级那一维**：`content_hash` 在 demo 里确实每次写都重算
 * （`prompt.ts:108` 的占位算法），承诺它不算撒谎，所以不一并禁掉——禁宽了判据就会逼出假例外。
 *
 * ⚠ 判据本身要有对照组（下面最后一条）：没有它，「0 条承诺」在词典面塌掉时同样是永真。
 */
describe('#22 · 上屏文案不许承诺「样本量分级会重算」', () => {
  /** zh 侧的两个词族：同一句里都出现才算承诺。 */
  const GRADE_ZH = /(样本量分级|样本量档位|分级|档位)/;
  const RECOMPUTE_ZH = /(重算|重新计算)/;
  /** en 侧同理（`sample-size grade` / `tier` × `recomputed` / `recalculated`）。 */
  const GRADE_EN = /(grade|tier)/i;
  const RECOMPUTE_EN = /(recomput|recalculat)/i;

  type Leaf = [side: string, path: string, value: string];

  /** 两侧 × 全部 namespace 的叶子（从资源树现算，不手抄键名）。 */
  function allLeaves(): Leaf[] {
    const out: Leaf[] = [];
    for (const side of SIDES) {
      const tree: unknown = side === 'zh-CN' ? zhCN : enUS;
      for (const [leafPath, value] of leaves(tree)) out.push([side, leafPath, value]);
    }
    return out;
  }

  function gradePromises(probe: readonly Leaf[]): string[] {
    return probe
      .filter(([, , value]) =>
        GRADE_ZH.test(value)
          ? RECOMPUTE_ZH.test(value)
          : GRADE_EN.test(value) && RECOMPUTE_EN.test(value),
      )
      .map(([side, leafPath, value]) => `${side} ${leafPath} = ${value}`);
  }

  it('两侧词典的任何叶子都不承诺「样本量分级会重算」', () => {
    const probe = allLeaves();

    // 防空跑：词典面塌成空集时「0 条承诺」是永真的（与规则 6 那条同一个下界口径）
    expect(probe.length, '词典扫描面塌了 ⇒ 判据已失效').toBeGreaterThanOrEqual(900);
    expect(
      gradePromises(probe),
      '这些文案在承诺 demo 不会做的重算（规则 9：sample_size_grade 是静态继承）⇒ 改文案，别改判据',
    ).toEqual([]);
  });

  it('自证（对照组）：把「分级会重算」塞回去，zh 与 en 两侧都会被这套判据抓到', () => {
    expect(
      gradePromises([
        ['zh-CN', 'probe.a', '删除后内容哈希与样本量分级会重算，且不可恢复。'],
        ['en-US', 'probe.b', 'The sample-size grade is recomputed after deletion.'],
      ]),
    ).toHaveLength(2);
    // 反向对照：只提哈希、不提分级 ⇒ 放行（判据不是「见到重算就红」，那样会逼出假例外）
    expect(gradePromises([['zh-CN', 'probe.c', '删除后内容哈希会重算。']])).toEqual([]);
    expect(gradePromises([['en-US', 'probe.d', 'The content hash is recomputed.']])).toEqual([]);
  });

  it('改后强度不减：删除确认文案两侧仍警告不可恢复，且仍指向 CSV 备份', () => {
    const zh = zhCN.prompt.promptSet.deleteConfirmContent;
    const en = enUS.prompt.promptSet.deleteConfirmContent;

    expect(zh).toContain('不可恢复');
    expect(zh).toContain('CSV');
    expect(en.toLowerCase()).toContain('cannot be undone');
    expect(en).toContain('CSV');
    // 两侧都不是空壳（改文案时最容易把一侧漏成占位串）
    expect(zh.trim().length).toBeGreaterThanOrEqual(10);
    expect(en.trim().length).toBeGreaterThanOrEqual(20);
  });
});

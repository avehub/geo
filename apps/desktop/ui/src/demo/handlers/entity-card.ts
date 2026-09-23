/**
 * M1 `entity_card_*` 4 条命令的内存实现（Task 12 · 简报 §B-1 / §B-2 / §B-4 / §B-6）。
 * 真值源 `apps/desktop/src-tauri/src/services/entity_card_service.rs`（下称 service）
 * 与 `crates/geo-domain/src/entity_card.rs`（下称 domain）。
 *
 * # 🔴 demo 下**不抓网页、不调模型**（AGENTS 规则 9）
 * `entity_card_autobuild` 的真实实现是「爬官网 → LLM 抽取 → 合并 baseline」；demo 一律不做，
 * 而是按计划正文行 332 的口径：**延迟约 800ms 后返回种子里预置的那张实体卡**。
 * 因此 `source` 里的 `crawled_pages` / `llm_provider` / `llm_model` 一律留空——
 * demo 没爬过任何页面也没调过任何模型，谎报一个 provider 就是假数据。
 *
 * # 🔴 两处刻意不移植的领域逻辑（简报 §B-2）
 * - `completeness`（字段完整率）：**只读种子里预置的静态值**，改字段之后**不重算**
 *   （真实后端 `set_field` 会重算，domain:328）。界面要变就把它当种子的一部分静态给出；
 * - `normalize_url` / `parse_path`：下面两个 `assert*` 是**刻意收窄的近似**，
 *   只覆盖简报 A-4 / A-6 真值表里列出的那几种契约情形，表外一律放行。
 *
 * # 修订留痕（§B-6，Plan B 的修订时间线要靠 demo 走查）
 * 每次 `entity_card_update_field` 都**真的**往 `db.revisions` 追加一条，`entity_card_revisions`
 * 读得回来；`old_value` 是改之前的值（第一次改种子字段时就是种子里那个值），不写 `null` 糊弄。
 */
import type { EntityCard, EntityCardRevision } from '../../api/types';
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import { withLatency } from '../latency';
import { entityCardOf, getDemoDb, revisionsOf } from '../db';
import { SEED_ENTITY_CARDS } from '../seed/entity-cards';
import {
  asFieldStatus,
  asString,
  cleanOptional,
  newId,
  nowIso,
  requireProject,
} from './shared';

/**
 * 自动建档在 `demoInvoke` 那 120ms 之外**再**等的时长（简报 §B-4）。
 * 浏览器里的总时长 ≈ 120 + 680 = 800ms（计划正文行 332 的口径）；
 * 测试环境两层都归零（`demoLatencyMs()` 在 `MODE === 'test'` 时返回 0，`withLatency` 不排 setTimeout）。
 */
export const AUTOBUILD_EXTRA_MS = 680;

/**
 * 合法的根字段名 = `domain:27` 的 `ALL_FIELDS`（11 项）的镜像。
 * 跨语言无法 import ⇒ 这里独立写死一份；漂移由 `entity-card.test.ts` 那条
 * 「与 `EntityFields` 的键逐字相等」的断言钉住（`EntityFields` 是 DTO 唯一真值源）。
 */
export const ENTITY_ROOT_FIELDS: readonly string[] = [
  'standard_name',
  'aliases',
  'founded_year',
  'qualifications',
  'products',
  'price_range',
  'service_regions',
  'cases',
  'differentiators',
  'official_tone',
  'contact',
];

/** 允许的协议（真值源 `crates/geo-domain/src/asset.rs:109`）。 */
const ALLOWED_SCHEMES: readonly string[] = ['http', 'https'];
/** 从 host 之后截断的字符：路径 / 查询 / 片段。 */
const HOST_TERMINATORS = /[/?#]/;
/** IPv4 形状（点号与数字）。 */
const IPV4_SHAPED = /^[\d.]+$/;
/** `trim_end_matches(']')` 的等价物：去掉 chunk 尾部**连续**的 `]`（`entity_card.rs:415`）。 */
const TRAILING_BRACKETS = /\]+$/;
/** 纯数字下标。 */
const DIGITS_ONLY = /^\d+$/;

/**
 * `entity_card_autobuild`：先校项目、再校域名（与 service:91-92 的顺序一致），
 * 然后等一段假延迟、返回种子那张预置卡。
 */
export const entityCardAutobuild: DemoHandler = async (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));
  assertDemoDomain(asString(args.domain));
  await withLatency(AUTOBUILD_EXTRA_MS);

  const now = nowIso();
  const existing = entityCardOf(db, project.id);
  if (existing) {
    // demo 没有任何新信息可合并（没爬、没调模型）⇒ 字段 / 状态 / 静态完整率 / 来源全部原样保留，
    // 只把 updated_at 前推。真实后端会重建卡并把未确认字段刷成 pending（service:213 的
    // confirmed_fields 那一套），那是领域逻辑，不移植。
    existing.updated_at = now;
    return structuredClone(existing);
  }

  const card: EntityCard = {
    ...structuredClone(SEED_ENTITY_CARDS[0]),
    project_id: project.id,
    source: { crawled_pages: [], llm_provider: null, llm_model: null, generated_at: null },
    created_at: now,
    updated_at: now,
  };
  db.entityCards.push(card);
  return structuredClone(card);
};

/** `entity_card_get`：没有卡就是 `null`（真值源 service:177 的 `Option`，**不是** not_found）。 */
export const entityCardGet: DemoHandler = (args) => {
  const db = getDemoDb();
  const card = entityCardOf(db, asString(args.project_id));
  return card ? structuredClone(card) : null;
};

/**
 * `entity_card_update_field`：改值 + 改可信状态 + 写修订，**返回新那条 revision**（不是整张卡）。
 * 真值源 service:182（签名逐字：`-> Result<EntityCardRevision, IpcError>`）。
 */
export const entityCardUpdateField: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  const card = entityCardOf(db, projectId);
  if (!card) {
    // 🔴 A-11：这条的 `params.id` 传的是 **project_id**（契约 note 明写），不是卡自己的 id。
    throw demoError('entity_card/not_found', { kind: 'entity_card', id: projectId });
  }

  const path = asString(args.path);
  const root = inspectFieldPath(path);
  const status = asFieldStatus(args.status);
  const note = cleanOptional(args.note);
  const now = nowIso();
  const value = args.value ?? null;
  const fields = fieldsView(card);
  // 顶层字段才写回卡内：界面那 11 行 `ENTITY_FIELD_ROWS` 全是顶层路径。
  // 带下标 / 嵌套的路径按 §B-2③ 放行校验、留痕照写，但 demo 不改卡里的嵌套结构——
  // domain 的 `get_at` / `set_at`（含 serde 回写与 validate_field）是领域实现，不移植。
  const isFlatPath = root === path.trim();
  const oldValue = isFlatPath ? (fields[root] ?? null) : null;
  if (isFlatPath) fields[root] = value;
  card.field_status[root] = status;
  // ⚠ 这里刻意**不**重算 completeness（§B-2 / 规则 9）：它是种子里的静态演示值。
  card.updated_at = now;

  const revision: EntityCardRevision = {
    id: newId(),
    project_id: projectId,
    // 真值源 domain:334：留痕里的 field_path 是**原样**的入参（不 trim）。
    field_path: path,
    old_value: oldValue,
    new_value: value,
    status,
    note,
    edited_at: now,
  };
  db.revisions.push(revision);
  return structuredClone(revision);
};

/** `entity_card_revisions`：新的在前（真值源 `repo/entity_card.rs:139` 的 `edited_at DESC, rowid DESC`）。 */
export const entityCardRevisions: DemoHandler = (args) => {
  const db = getDemoDb();
  return structuredClone(revisionsOf(db, asString(args.project_id)));
};

/**
 * 🔴 **demo 近似，不是 `normalize_url` 的端口，也不主张等价**（简报 §B-2）。
 * 真值源 `crates/geo-domain/src/asset.rs:97` 的 `normalize_url`，判定经
 * `service:293` 的 `origin_from_domain` 委托给它；契约测试
 * `origin_from_domain_reports_directory_keys_for_bad_input`（service:431-474）
 * 用 `assert_eq!(error.params, expected)` **精确比对整个 params 键值集**。
 *
 * 这里只覆盖简报 A-4 真值表的三种情形（`field` 恒为 `domain`）：
 * | 输入 | reason | params 键集 |
 * | --- | --- | --- |
 * | 空白 | `required` | 2 键（**没有** `value`） |
 * | 不是域名 | `invalid_url` | 3 键，`value` = trim 后的输入 |
 * | 协议不允许 | `not_allowed` | 3 键，`value` **只是协议名** |
 *
 * 表外的输入一律**放行**（§B-2③）：demo 要演的是错误契约与前端按语言渲染，不是 URL 解析器。
 */
function assertDemoDomain(domain: string): void {
  const trimmed = domain.trim();
  if (trimmed === '') {
    throw demoError('validation/failed', { field: 'domain', reason: 'required' });
  }

  const separator = trimmed.indexOf('://');
  // 缺协议时后端补 https:// 再解析（asset.rs:102-106）⇒ demo 也按 https 走。
  const scheme = separator === -1 ? 'https' : trimmed.slice(0, separator).toLowerCase();
  if (!ALLOWED_SCHEMES.includes(scheme)) {
    throw demoError('validation/failed', {
      field: 'domain',
      reason: 'not_allowed',
      value: scheme,
    });
  }

  const authority = separator === -1 ? trimmed : trimmed.slice(separator + 3);
  const host = authority.split(HOST_TERMINATORS)[0];
  if (!isAcceptedHost(host)) {
    throw demoError('validation/failed', {
      field: 'domain',
      reason: 'invalid_url',
      value: trimmed,
    });
  }
}

/**
 * 后端只放行三种 host（asset.rs:114-118）：IPv4、IPv6、**含点号**的域名。
 * 于是 `localhost` 这类没有点号的主机名会被拒（与后端一致，也正是 A-4 第二行的情形），
 * 其余形状一律放行。
 */
function isAcceptedHost(host: string): boolean {
  if (host === '') return false;
  if (host.startsWith('[')) return true;
  if (IPV4_SHAPED.test(host)) return true;
  return host.includes('.');
}

/** `parse_path` 解析出来的一段（`entity_card.rs:394-397` 的 `Segment`）。 */
type PathSegment = { kind: 'key'; name: string } | { kind: 'index' };

/**
 * `parse_path` + `root_field` 的**端口**（真值源 `domain:399-433` 与 `domain:435-447`）。
 *
 * 🔴 #30① 之前这里是「只覆盖 A-6 真值表四种情形」的**近似**，于是表外输入会分岐：整条 path
 * 一个段都解析不出来时（`"..."` / `"[]"`），后端在 `domain:426-427` 发 `required` 且**只有 2 个
 * params 键**，近似版发的却是 `unknown_field` + `value:''`（`"..."`）或 `invalid_format` +
 * `value:path`（`"[]"`）——**3 键**。`params` 的键集是会上屏的（多一个 `value` 就多一段括号文案）
 * ⇒ 现在照后端的分段算法抄，判定顺序逐字一致：
 * ① 下标非数字 → `invalid_format` + `value`=那个 chunk（`domain:419-421`）；
 * ② 段集为空 → `required`（`domain:426-427`，**2 键**）；
 * ③ 首段不是 Key → `invalid_format` + `value`=整个 path（`domain:429-431`）；
 * ④ 根字段名不在白名单 → `unknown_field` + `value`=根字段名（`domain:440-442`）。
 *
 * ⚠ 已知残留分岐（**不是**台账点名的那两条，本轮**未改**，已写进 15c-2 报告交底）：
 * Rust 的 `chunk.parse::<usize>()` 还接受前导 `+`（`[+1]` 后端算合法下标，这里算非法），
 * 且超出 `usize` 会解析失败（`[99999999999999999999]` 后端报 `invalid_format`，这里放行）。
 *
 * @returns 根字段名（顶层字段），调用方用它更新 `field_status`。
 */
function inspectFieldPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '') {
    throw demoError('validation/failed', { field: 'field_path', reason: 'required' });
  }

  // domain:404-425 的分段：每个 '.' 段里，'[' 之前**非空**才算一个 Key（domain:410-412，
  // 注意后端只判 `is_empty()`，一个空格也算 Key）；'[' 之间的内容去掉尾部连续 ']' 之后必须是数字，
  // 空 chunk 跳过（domain:416-418 的 `continue`，`products[]` 因此合法）。
  const segments: PathSegment[] = [];
  for (const part of trimmed.split('.')) {
    const bracket = part.indexOf('[');
    const key = bracket === -1 ? part : part.slice(0, bracket);
    if (key !== '') segments.push({ kind: 'key', name: key });
    if (bracket === -1) continue;
    for (const raw of part.slice(bracket).split('[')) {
      const chunk = raw.replace(TRAILING_BRACKETS, '');
      if (chunk === '') continue;
      if (!DIGITS_ONLY.test(chunk)) {
        throw demoError('validation/failed', {
          field: 'field_path',
          reason: 'invalid_format',
          value: chunk,
        });
      }
      segments.push({ kind: 'index' });
    }
  }

  // ② domain:426-427：一个段都没解析出来 ⇒ `required`，**没有 `value` 键**。
  if (segments.length === 0) {
    throw demoError('validation/failed', { field: 'field_path', reason: 'required' });
  }

  // ③ domain:429-431：首段必须是 Key 不能是 Index，`value` 是**整个 path**（原样，不 trim）。
  const first: PathSegment | undefined = segments[0];
  if (first === undefined || first.kind !== 'key') {
    throw demoError('validation/failed', {
      field: 'field_path',
      reason: 'invalid_format',
      value: path,
    });
  }

  // ④ domain:435-442：根字段名必须在白名单里，`value` 是**那个名字**。
  if (!ENTITY_ROOT_FIELDS.includes(first.name)) {
    throw demoError('validation/failed', {
      field: 'field_path',
      reason: 'unknown_field',
      value: first.name,
    });
  }
  return first.name;
}

/**
 * 顶层字段的读写视图。`EntityFields` 的 11 个键类型各不相同，而 demo 收到的 `value` 是 `unknown`
 * ⇒ 经 `Record<string, unknown>` 视图读写；键的合法性由 `inspectFieldPath` 的
 * `ENTITY_ROOT_FIELDS` 白名单保证（写不到契约外的键），所以这一次断言是**被检查过的**。
 */
function fieldsView(card: EntityCard): Record<string, unknown> {
  return card.fields as unknown as Record<string, unknown>;
}

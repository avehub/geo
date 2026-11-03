/**
 * M1.2b 知识库的 6 条命令（`kb_board` / `kb_entry_add` / `_update` / `_delete` / `_verify` /
 * `kb_generate`）。
 * 设计规格 `docs/superpowers/specs/2026-10-10-kb-redesign-and-article-studio-design.md`
 * （DR-73 … DR-82）。
 *
 * 🔴 **Rust 侧没有对应实现**：这 6 条与 M3–M7 的 20 条、Plan B 的 2 条、M1.5 的 10 条、
 * 站点接入的 11 条、文章管理的 10 条同族——只有 demo 侧接线，桌面端点进来会报
 * `ipc/unknown_command`（差异台账 §4f E-60 起、§4g E-63）。
 *
 * # 🔴 与上一轮的最大差异：投影退役（DR-73）
 * `kb_entry_detach` 与「不落库的同步块」整体删除：用户指示不要与实体卡重复的内容卡片。
 * 知识库现在**只有落库行**；"结合项目录入的信息"改由**一次性显式导入**承担
 * （DR-81：前端组装草稿、`kb_entry_add` 收 `source: 'imported'`），导入后源头再改不跟随。
 *
 * # 四种照抄 M1/M1.5/M2 的后端语义
 * - **返回形状不一致是刻意的**：`board` 回聚合、`add`/`generate` 回**新增那几条**、
 *   `update` 回**单条**、`delete`/`verify` 回**剩余快照**；
 * - **`position` 是 0 基**，删除后重排成 `0..n-1`（照 `keyword.ts` 的 `reindex`）；
 * - **删除幂等**：认不出的 id 直接忽略；
 * - **`source` / `status` / `verified_at` 由后端定**：`kb_entry_add` 默认 `manual` + `approved`
 *   + 未核实；`source: 'imported'` 是唯一被尊重的覆盖值（DR-81），其 `status` 只认
 *   `approved` / `pending_review`（导入副本继承源头字段的可信状态）；
 *   `kb_generate` 一律 `generated` + `pending_review`（规则 6）；
 *   `kb_entry_update` **不许**改 `verified_at`（否则"改个错别字"就能伪造一次核实）。
 *
 * # 🔴 场景维度的后端规则（DR-75）
 * `scenario` 只在 `sales_script` / `support_script` 两个模块保留；其余模块**强制置 null**
 * （不报错：把一条品牌定义句误挂了场景，落库时悄悄摘掉比拒整批更贴合"编辑别丢内容"）。
 *
 * # 修订留痕（DR-119，照 `entity-card.ts` 的 `entity_card_update_field` 姿态）
 * `kb_entry_update` **每改一个字段记一条**（改两个字段 ⇒ 两条，old/new 并排）；
 * `kb_entry_verify` 每条记一条 `field_path: 'verified_at'`（旧值是上一次的核实时间，第一次是 `null`）；
 * 🔴 `kb_entry_add` / `kb_entry_delete` / `kb_generate` **一律不留痕**——创建与删除不是"修订"，
 * 生成物的待审状态由 `status: 'pending_review'` 表达（与 E-66 同族），
 * 留痕只回答"谁把哪个字段从什么改成了什么"。
 * 读出口**寄生** `kb_board` 的 `revisions`（新的在前），**命令面不加**（`IPC_COMMANDS` 不变）。
 * 🔴 `body_markdown` 的新旧值截断到 `KB_REVISION_BODY_LIMIT`（120）字符再留痕；
 * **库里的正文不截断**（截断只是呈现口径，改一次正文就丢内容是不可接受的）。
 * 🔴 留痕的**写路径零件**（截断上限、被比对的字段表、审核态 → 可信态的投影、逐字段 diff）
 * 住在同族的 `handlers/kb-revision.ts`：本文件带上那半会越过 400 行软线（AGENTS「代码风格」），
 * 拆分姿态照 `site.ts` / `site-patch.ts` 与 `article.ts` / `article-schedule.ts`。
 *
 * # 🔴 demo 不做的四件事（规则 9 / 规则 2 / 规则 6）
 * ① **不成文、不调模型**：`kb_generate` 从 `seed/kb.ts` 的预置池里按 `modules` 挑，逐字端出；
 * ② **不做检索**：全文搜索是界面侧的 `includes`，不进命令契约；
 * ③ **不碰媒体文件**：`url` / `mime` 只是字面量，不下载、不探测、不生成缩略图；
 * ④ **不算覆盖率 / 可信度评分**：`KbStats` 只是**数数**。
 *
 * # 语言约束（门禁 7 / §B-11）
 * 本文件非注释 CJK 必须为 0 ⇒ 字符串常量全是 ASCII；中文词面只出现在 `seed/kb.ts`。
 */
import type { DemoDb, DemoHandler } from '../types';
import { demoError } from '../types';
import { getDemoDb, kbEntriesOf, kbRevisionsOf } from '../db';
import { SEED_KB_GENERATED_POOL } from '../seed/kb';
import type {
  KbBoard,
  KbEntry,
  KbEntryKind,
  KbModule,
  KbScenario,
  KbStats,
} from '../../api/types';
import {
  KB_MODULE_VALUES,
  KB_SCRIPT_MODULES,
  LIBRARY_GENERATE_MAX,
  LIBRARY_GENERATE_MIN,
} from '../../api/types';
import {
  asContentStatus,
  asKbEntryKind,
  asKbModule,
  asKbScenario,
  asRecord,
  asRecordList,
  asString,
  asStringList,
  cleanOptional,
  clampInt,
  newId,
  nowIso,
  requireProject,
} from './shared';
import { diffKbRevisions, verifyRevision } from './kb-revision';

/** 多媒体三档（`KbStats.media` 数的是这三种形式）。 */
const MEDIA_KINDS: readonly KbEntryKind[] = ['image', 'video', 'file'];

/** 话术两模块（DR-75）：只有它们的 `scenario` 能非 null。 */
function scenarioFor(module: KbModule, value: unknown): KbScenario | null {
  if (!KB_SCRIPT_MODULES.includes(module)) return null;
  return asKbScenario(value);
}

function nextPosition(projectId: string): number {
  return kbEntriesOf(getDemoDb(), projectId).length;
}

function reindex(db: DemoDb, projectId: string): void {
  kbEntriesOf(db, projectId)
    .slice()
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .forEach((row, index) => {
      row.position = index;
    });
}

/** `KbStats`：纯数数（DR-80），不算任何领域评分（规则 9）。 */
function computeStats(entries: KbEntry[]): KbStats {
  return {
    modules: new Set(entries.map((entry) => entry.module)).size,
    entries: entries.length,
    scripts: entries.filter((entry) => KB_SCRIPT_MODULES.includes(entry.module)).length,
    pending_review: entries.filter((entry) => entry.status === 'pending_review').length,
    unverified: entries.filter((entry) => entry.verified_at === null).length,
    media: entries.filter((entry) => MEDIA_KINDS.includes(entry.kind)).length,
  };
}

/**
 * `kb_board`：一次拿全（条目 + 统计）。同步块退役后这里**没有任何投影**（DR-73）。
 *
 * 🔴 DR-119 之后多带一份**全项目**的修订留痕（新的在前）：读出口寄生在这里，
 * 命令面不加（不新增 `kb_entry_revisions`）。界面按 `entry_id` 自己筛出当前编辑那条的历史。
 */
export const kbBoard: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));
  const entries = kbEntriesOf(db, project.id)
    .slice()
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  const board: KbBoard = {
    project_id: project.id,
    entries: structuredClone(entries),
    stats: computeStats(entries),
    project_updated_at: project.updated_at,
    revisions: structuredClone(kbRevisionsOf(db, project.id)),
  };
  return structuredClone(board);
};

/**
 * `kb_entry_add`：手动录入 / **导入**（可批量）。
 *
 * 🔴 **全有或全无**（照 `keyword_add`）：先把全部草稿校验完再落库，任一条标题为空白就整批拒。
 * 🔴 `source` 只认 `'imported'` 这一个覆盖值（DR-81）；`status` 只在导入时被尊重，
 * 且只认 `approved` / `pending_review`——人工录入恒 `approved`、生成恒 `pending_review`。
 */
export const kbEntryAdd: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));
  const drafts = asRecordList(args.drafts);

  for (const draft of drafts) {
    if (asString(draft.title).trim() === '') {
      throw demoError('validation/failed', { field: 'kb_title', reason: 'required' });
    }
  }

  const stamp = nowIso();
  const firstPosition = nextPosition(project.id);
  const added: KbEntry[] = drafts.map((draft, index) => {
    const module = asKbModule(draft.module);
    const imported = asString(draft.source) === 'imported';
    const status = imported
      ? asString(draft.status) === 'approved'
        ? 'approved'
        : 'pending_review'
      : 'approved';
    return {
      id: newId(),
      project_id: project.id,
      module,
      kind: asKbEntryKind(draft.kind),
      title: asString(draft.title).trim(),
      body_markdown: asString(draft.body_markdown),
      url: cleanOptional(draft.url),
      mime: cleanOptional(draft.mime),
      tags: asStringList(draft.tags).map((tag) => tag.trim()).filter((tag) => tag !== ''),
      status,
      source: imported ? 'imported' : 'manual',
      scenario: scenarioFor(module, draft.scenario),
      // 「录进来」不等于「核实过」：核实是一次显式动作（`kb_entry_verify`）。
      verified_at: null,
      position: firstPosition + index,
      created_at: stamp,
      updated_at: stamp,
    };
  });

  db.kbEntries.push(...structuredClone(added));
  return added;
};

/**
 * `kb_entry_update`：整行进整行出（照 `keyword_update`）。
 *
 * 🔴 **五个字段前端改不动**：`project_id` / `position` / `created_at` / `source` /
 * `verified_at` 一律取库里那份。（`id` 是**定位符**不是可改字段：认不出就 `validation/failed`。）
 * `verified_at` 的理由：核实是一次显式动作（`kb_entry_verify`），能从编辑接口顺手写进去的话，
 * "改个错别字"就伪造了一次核实。
 */
export const kbEntryUpdate: DemoHandler = (args) => {
  const db = getDemoDb();
  const entry = asRecord(args.entry);
  const id = asString(entry.id);
  const found = db.kbEntries.find((row) => row.id === id);
  if (!found) {
    throw demoError('validation/failed', { field: 'kb_entry_id', reason: 'invalid_id', value: id });
  }
  const title = asString(entry.title).trim();
  if (title === '') {
    throw demoError('validation/failed', { field: 'kb_title', reason: 'required' });
  }

  const stamp = nowIso();
  const module = asKbModule(entry.module);
  // 🔴 先把"改之后的整行"算出来，再逐字段与库里那份比对（DR-119）：
  // 边赋值边记的话，`old_value` 会被自己刚写进去的新值覆盖（实体卡那侧是先读 `oldValue` 再写）。
  const next: KbEntry = {
    ...structuredClone(found),
    module,
    kind: asKbEntryKind(entry.kind),
    title,
    body_markdown: asString(entry.body_markdown),
    url: cleanOptional(entry.url),
    mime: cleanOptional(entry.mime),
    tags: asStringList(entry.tags).map((tag) => tag.trim()).filter((tag) => tag !== ''),
    status: asContentStatus(entry.status),
    scenario: scenarioFor(module, entry.scenario),
    updated_at: stamp,
  };

  db.kbRevisions.push(...diffKbRevisions(found, next, stamp));
  Object.assign(found, next);

  return structuredClone(found);
};

/** `kb_entry_delete`：批量删除，回**剩余快照**（照 `keyword_delete`）；认不出的 id 忽略。 */
export const kbEntryDelete: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));
  const ids = new Set(asStringList(args.ids));
  db.kbEntries = db.kbEntries.filter(
    (row) => !(row.project_id === project.id && ids.has(row.id)),
  );
  reindex(db, project.id);
  return structuredClone(kbEntriesOf(db, project.id));
};

/**
 * `kb_entry_verify`：批量核实（Guru 的 verification），回**剩余快照**。
 * 只做两件事：`status → approved` + `verified_at → now`（顺带 `updated_at` 前推）。
 * 🔴 认不出的 id 忽略；一条都没命中就原样回快照，不报错。
 */
export const kbEntryVerify: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));

  const ids = new Set(asStringList(args.ids));
  const stamp = nowIso();
  for (const row of db.kbEntries) {
    if (row.project_id !== project.id || !ids.has(row.id)) continue;
    // 🔴 核实也是一次要留痕的改动（DR-119）：旧值是上一次的核实时间，第一次核实是 `null`。
    const previous = row.verified_at;
    row.status = 'approved';
    row.verified_at = stamp;
    row.updated_at = stamp;
    db.kbRevisions.push(verifyRevision(row, previous, stamp));
  }

  return structuredClone(kbEntriesOf(db, project.id));
};

/**
 * 生成入参里的模块清单：**只保留契约内的值**，契约外的直接丢掉（不收敛成 `brand`）。
 * 全部丢掉之后清单为空 ⇒ 发 `validation/failed`（照 `keyword.ts` 的 `requestedKinds`）。
 */
function requestedModules(value: unknown): KbModule[] {
  const allowed = KB_MODULE_VALUES as readonly string[];
  const picked = asStringList(value).filter((module) => allowed.includes(module));
  return [...new Set(picked)] as KbModule[];
}

/**
 * `kb_generate`：🔴 **不调模型**，从预置池里按 `modules` 挑一批（差异台账 §4f E-62）。
 *
 * 挑选规则只有三条：① 只挑 modules 命中的行；② 跳过库里**标题完全相同**的；
 * ③ 按池子里的顺序取前 `target_count` 条（夹在 `LIBRARY_GENERATE_MIN..MAX`）。
 * 挑不出来就回**空数组**（不是错误）。产物一律 `generated` + `pending_review` + 未核实。
 */
export const kbGenerate: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));

  const options = asRecord(args.options);
  const modules = requestedModules(options.modules);
  if (modules.length === 0) {
    throw demoError('validation/failed', { field: 'kb_modules', reason: 'required' });
  }
  const target = clampInt(options.target_count, LIBRARY_GENERATE_MIN, LIBRARY_GENERATE_MAX);

  const existing = new Set(kbEntriesOf(db, project.id).map((row) => row.title));
  const picked = SEED_KB_GENERATED_POOL.filter(
    (row) => modules.includes(row.module) && !existing.has(row.title),
  ).slice(0, target);

  const stamp = nowIso();
  const firstPosition = nextPosition(project.id);
  const added: KbEntry[] = picked.map((row, index) => ({
    id: newId(),
    project_id: project.id,
    module: row.module,
    kind: row.kind,
    title: row.title,
    body_markdown: row.body_markdown,
    url: row.url,
    mime: row.mime,
    tags: [...row.tags],
    status: 'pending_review',
    source: 'generated',
    scenario: scenarioFor(row.module, row.scenario),
    verified_at: null,
    position: firstPosition + index,
    created_at: stamp,
    updated_at: stamp,
  }));

  db.kbEntries.push(...structuredClone(added));
  return added;
};

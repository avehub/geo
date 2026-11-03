/**
 * M1.5 关键词库的 5 条命令（`keyword_list` / `_add` / `_update` / `_delete` / `_generate`）。
 * 设计规格 `docs/superpowers/specs/2026-09-30-keyword-faq-library-design.md`（DR-41 / DR-42）。
 *
 * 🔴 **Rust 侧没有对应实现**：这 5 条与 M3–M7 那 20 条、Plan B 那 2 条同族——只有 demo 侧接线，
 * 桌面端点进来会报 `ipc/unknown_command`（差异台账 §4d E-52 起）。
 *
 * # 四种照抄 M1/M2 的后端语义
 * - **返回形状三种不一致**（刻意不"统一"）：`list` 回数组、`add`/`generate` 回**新增那几条**、
 *   `update` 回**单条**、`delete` 回**剩余快照**；
 * - **`position` 是 0 基**，删除后重排成 `0..n-1`（照 `prompt_service.rs` 的 `reindex`）；
 * - **删除幂等**：认不出的 id 直接忽略，不发 `not_found`（照 `competitor_delete`）；
 * - **`source` 由后端固定**：`keyword_add` 一律 `manual`，前端自称 `generated` 不算数
 *   （照 `prompt_item_add`，理由见 `shared.ts` 的 `asPromptSource`）。
 *
 * # 🔴 demo 不做的四件事（AGENTS 规则 9 / 规则 6）
 * ① **不挖词、不调模型**：`keyword_generate` 从 `seed/keywords.ts` 的预置池里挑，逐字端出；
 * ② **不重算指标**：`monthly_volume` / `difficulty` 是种子写死的静态值（真后端要调第三方接口）；
 * ③ **不做相似度去重**：重复生成只跳过**文本完全相同**的条目（等值判断，不是 3-gram Jaccard）；
 * ④ **不扫红线词**：广告法词库在 Rust 侧、前端不镜像（与差异台账 E-1 同一条取舍）。
 *
 * # 与 M1 `competitor_list` 的一处**有意不同**
 * `list` / `delete` 都先 `requireProject`（照 M3–M7 的 `action_board` / `collection_board`），
 * 而不是照 `competitor_list` 那样"项目不存在也回空数组"：素材页是左侧导航直达的落点，
 * 项目 id 认不出时给一句「项目不存在」比给一个空列表更能排障。
 *
 * # 语言约束（门禁 7 / §B-11）
 * 本目录非注释 CJK 必须为 0 ⇒ 下面的字符串常量全是 ASCII；中文词面只出现在 `seed/keywords.ts`。
 */
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import { getDemoDb, keywordsOf } from '../db';
import { SEED_KEYWORD_GENERATED_POOL } from '../seed/keywords';
import type { KeywordItem, KeywordKind } from '../../api/types';
import { KEYWORD_KIND_VALUES, LIBRARY_GENERATE_MAX, LIBRARY_GENERATE_MIN } from '../../api/types';
import {
  asContentStatus,
  asIntent,
  asKeywordKind,
  asNullableNumber,
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

/** 优先级的中位默认值（1~5 的中间档，与 `PromptDraft` 的 `default_weight` 同族口径）。 */
const DEFAULT_PRIORITY = 3;
/** 优先级区间（`KeywordItem.priority` 的契约口径）。 */
const PRIORITY_MIN = 1;
const PRIORITY_MAX = 5;

/**
 * 生成入参里的种类清单：**只保留契约内的值**，契约外的直接丢掉（不收敛成 `core`）。
 *
 * 🔴 与数据字段的 `asKeywordKind`（收敛到中立成员）刻意不同：那边是"一条已存在的素材总得有个类型"，
 * 这边是"用户要生成哪几类"——把认不出的种类悄悄换成核心词，会生成出用户没点过的东西。
 * 全部丢掉之后清单为空 ⇒ 发 `validation/failed`（与空入参同一条路径）。
 */
function requestedKinds(value: unknown): KeywordKind[] {
  const allowed = KEYWORD_KIND_VALUES as readonly string[];
  const picked = asStringList(value).filter((kind) => allowed.includes(kind));
  return [...new Set(picked)] as KeywordKind[];
}

/** 把 position 重排成 `0..n-1`（就地改库里的行；`keywordsOf` 回的是同一批对象引用）。 */
function reindex(projectId: string): void {
  keywordsOf(getDemoDb(), projectId).forEach((row, position) => {
    row.position = position;
  });
}

/** 下一个 position（本项目内最大值 + 1，空表时是 0）。 */
function nextPosition(projectId: string): number {
  return keywordsOf(getDemoDb(), projectId).reduce((max, row) => Math.max(max, row.position), -1) + 1;
}

/** `keyword_list`：`position ASC, id ASC`（排序口径在 `db.ts` 的 `keywordsOf`）。 */
export const keywordList: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);
  return structuredClone(keywordsOf(db, projectId));
};

/**
 * `keyword_add`：手动录入（可批量）。
 *
 * 🔴 **全有或全无**：先把全部草稿校验完再落库，任一条文本为空白就整批拒——
 * 半批入库会让界面上"我录了 5 条怎么只进来 3 条"变成一个走查不出来的空洞。
 */
export const keywordAdd: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const drafts = asRecordList(args.drafts);
  if (drafts.length === 0) {
    throw demoError('validation/failed', { field: 'drafts', reason: 'required' });
  }
  const texts = drafts.map((draft) => asString(draft.text).trim());
  if (texts.some((text) => text === '')) {
    throw demoError('validation/failed', { field: 'text', reason: 'required' });
  }

  const stamp = nowIso();
  const firstPosition = nextPosition(projectId);
  const added: KeywordItem[] = texts.map((text, index) => {
    const draft = drafts[index];
    return {
      id: newId(),
      project_id: projectId,
      text,
      kind: asKeywordKind(draft.kind),
      intent: asIntent(draft.intent),
      monthly_volume: asNullableNumber(draft.monthly_volume),
      difficulty: asNullableNumber(draft.difficulty),
      priority:
        draft.priority === undefined
          ? DEFAULT_PRIORITY
          : clampInt(draft.priority, PRIORITY_MIN, PRIORITY_MAX),
      // 人工录入 = 人工已经看过 ⇒ `approved`；AI 生成才默认 `pending_review`（规则 6）。
      status: 'approved',
      note: cleanOptional(draft.note),
      // 🔴 固定 `manual`：前端在草稿里自称 `generated` 不算数（照 `prompt_item_add`）。
      source: 'manual',
      position: firstPosition + index,
      created_at: stamp,
      updated_at: stamp,
    };
  });

  db.keywords.push(...structuredClone(added));
  return added;
};

/**
 * `keyword_update`：整行进整行出（照 `prompt_item_update` 的形状）。
 *
 * 🔴 **五个字段前端改不动**：`id` / `project_id` / `position` / `created_at` / `source`
 * 一律取库里那份——否则"改个备注"就能把一条人工录入的素材改标成 AI 生成，
 * 或者把它挪到别的项目下。`updated_at` 每次写都刷新。
 */
export const keywordUpdate: DemoHandler = (args) => {
  const db = getDemoDb();
  const item = asRecord(args.item);
  const id = asString(item.id);
  const found = db.keywords.find((row) => row.id === id);
  if (!found) {
    throw demoError('validation/failed', { field: 'keyword_id', reason: 'invalid_id', value: id });
  }

  const text = asString(item.text).trim();
  // 与 `keyword_add` 同构：更新路径也必须拒空白文本（绕过弹窗直接调 IPC 的入口同样要守）。
  if (text === '') {
    throw demoError('validation/failed', { field: 'text', reason: 'required' });
  }

  found.text = text;
  found.kind = asKeywordKind(item.kind);
  found.intent = asIntent(item.intent);
  found.monthly_volume = asNullableNumber(item.monthly_volume);
  found.difficulty = asNullableNumber(item.difficulty);
  found.priority = clampInt(item.priority, PRIORITY_MIN, PRIORITY_MAX);
  found.status = asContentStatus(item.status);
  found.note = cleanOptional(item.note);
  found.updated_at = nowIso();

  return structuredClone(found);
};

/**
 * `keyword_delete`：批量删除，回**剩余快照**（照 `prompt_item_delete`）。
 *
 * 与 M2 那条「不许把题库删空」的约束**刻意不同**：素材库没有"空库就失去意义"的语义，
 * 删空是合法操作（界面会给空态与"手动录入 / AI 生成"两个出口）。
 */
export const keywordDelete: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const ids = new Set(asStringList(args.ids));
  // 只删本项目的行：别的项目里同 id 的行（不该存在，但库是内存的）不受影响。
  db.keywords = db.keywords.filter(
    (row) => !(row.project_id === projectId && ids.has(row.id)),
  );
  reindex(projectId);

  return structuredClone(keywordsOf(db, projectId));
};

/**
 * `keyword_generate`：🔴 **不调模型**，从预置池里按 `kinds` 挑一批（差异台账 E-52 / E-54）。
 *
 * 挑选规则只有三条，全是展示层能一眼看懂的口径：
 * ① 只挑 kinds 命中的行；② 跳过库里**文本完全相同**的（等值判断，连点两次不会出两份）；
 * ③ 按池子里的顺序取前 `target_count` 条（夹在 `LIBRARY_GENERATE_MIN..MAX`）。
 * 挑不出来就回**空数组**（不是错误）：界面据此提示"换个类型，或手动录入"。
 */
export const keywordGenerate: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const options = asRecord(args.options);
  const kinds = requestedKinds(options.kinds);
  if (kinds.length === 0) {
    throw demoError('validation/failed', { field: 'kinds', reason: 'required' });
  }
  const target = clampInt(options.target_count, LIBRARY_GENERATE_MIN, LIBRARY_GENERATE_MAX);

  const existing = new Set(keywordsOf(db, projectId).map((row) => row.text));
  const picked = SEED_KEYWORD_GENERATED_POOL.filter(
    (row) => kinds.includes(row.kind) && !existing.has(row.text),
  ).slice(0, target);

  const stamp = nowIso();
  const firstPosition = nextPosition(projectId);
  const added: KeywordItem[] = picked.map((row, index) => ({
    id: newId(),
    project_id: projectId,
    text: row.text,
    kind: row.kind,
    intent: row.intent,
    monthly_volume: row.monthly_volume,
    difficulty: row.difficulty,
    priority: row.priority,
    // 规则 6：生成内容默认待人工审核。demo 没有合规扫描器 ⇒ 绝不写 `approved`。
    status: 'pending_review',
    note: row.note,
    source: 'generated',
    position: firstPosition + index,
    created_at: stamp,
    updated_at: stamp,
  }));

  db.keywords.push(...structuredClone(added));
  return added;
};

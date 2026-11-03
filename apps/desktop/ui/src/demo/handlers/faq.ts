/**
 * M1.5 FAQ 常见问题库的 5 条命令（`faq_list` / `_add` / `_update` / `_delete` / `_generate`）。
 * 设计规格 `docs/superpowers/specs/2026-09-30-keyword-faq-library-design.md`（DR-41 / DR-42 / DR-44）。
 *
 * 🔴 **Rust 侧没有对应实现**（与 `keyword_*` 同族，差异台账 §4d）。
 *
 * # 与 `keyword.ts` 逐字同族的部分
 * 返回形状（list 数组 / add·generate 新增那几条 / update 单条 / delete 剩余快照）、
 * `position` 0 基并在删除后重排、删除幂等、`source` 由后端固定、生成不调模型、
 * 生成产物恒 `pending_review`、`list` 与 `delete` 先 `requireProject`——理由都写在
 * `keyword.ts` 的头注释里，这里**不抄第二份**（只有一份的纪律同 `enumLabel`）。
 *
 * # FAQ 特有的三条口径
 * - **答案是 Markdown 原文**：不解析、不渲染、不截断（规则 9；导出 JSON-LD 时也按原文塞进
 *   `acceptedAnswer.text`，见 `api/library-compose.ts`）；
 * - **`category` 是自由文本**（数据，不是枚举）：空白收成 `null`，不做归类、不查词典；
 * - **`intent` 复用 M2 的 7 类**（DR-39）：这是"引用到 Prompt 题库"能一对一映射的前提。
 */
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import { faqsOf, getDemoDb } from '../db';
import { SEED_FAQ_GENERATED_POOL } from '../seed/faqs';
import type { FaqItem, IntentCategory } from '../../api/types';
import { INTENT_VALUES, LIBRARY_GENERATE_MAX, LIBRARY_GENERATE_MIN } from '../../api/types';
import {
  asContentStatus,
  asIntent,
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

/**
 * 生成入参里的意图清单：**只保留契约内的值**，契约外的直接丢掉。
 * 口径与 `keyword.ts` 的 `requestedKinds` 逐字同族（那边有完整理由）。
 */
function requestedIntents(value: unknown): IntentCategory[] {
  const allowed = INTENT_VALUES as readonly string[];
  const picked = asStringList(value).filter((intent) => allowed.includes(intent));
  return [...new Set(picked)] as IntentCategory[];
}

/** 把 position 重排成 `0..n-1`（就地改库里的行）。 */
function reindex(projectId: string): void {
  faqsOf(getDemoDb(), projectId).forEach((row, position) => {
    row.position = position;
  });
}

/** 下一个 position（本项目内最大值 + 1，空表时是 0）。 */
function nextPosition(projectId: string): number {
  return faqsOf(getDemoDb(), projectId).reduce((max, row) => Math.max(max, row.position), -1) + 1;
}

/** `faq_list`：`position ASC, id ASC`（排序口径在 `db.ts` 的 `faqsOf`）。 */
export const faqList: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);
  return structuredClone(faqsOf(db, projectId));
};

/** `faq_add`：手动录入（可批量），🔴 全有或全无（问题与答案都必填）。 */
export const faqAdd: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const drafts = asRecordList(args.drafts);
  if (drafts.length === 0) {
    throw demoError('validation/failed', { field: 'drafts', reason: 'required' });
  }
  const questions = drafts.map((draft) => asString(draft.question).trim());
  if (questions.some((question) => question === '')) {
    throw demoError('validation/failed', { field: 'question', reason: 'required' });
  }
  const answers = drafts.map((draft) => asString(draft.answer_markdown).trim());
  if (answers.some((answer) => answer === '')) {
    throw demoError('validation/failed', { field: 'answer_markdown', reason: 'required' });
  }

  const stamp = nowIso();
  const firstPosition = nextPosition(projectId);
  const added: FaqItem[] = drafts.map((draft, index) => ({
    id: newId(),
    project_id: projectId,
    question: questions[index],
    answer_markdown: asString(draft.answer_markdown),
    category: cleanOptional(draft.category),
    intent: asIntent(draft.intent),
    status: 'approved',
    source: 'manual',
    position: firstPosition + index,
    created_at: stamp,
    updated_at: stamp,
  }));

  db.faqs.push(...structuredClone(added));
  return added;
};

/**
 * `faq_update`：整行进整行出。
 * 🔴 `id` / `project_id` / `position` / `created_at` / `source` 五个字段前端改不动（理由见 `keyword.ts`）。
 */
export const faqUpdate: DemoHandler = (args) => {
  const db = getDemoDb();
  const item = asRecord(args.item);
  const id = asString(item.id);
  const found = db.faqs.find((row) => row.id === id);
  if (!found) {
    throw demoError('validation/failed', { field: 'faq_id', reason: 'invalid_id', value: id });
  }

  const question = asString(item.question).trim();
  if (question === '') {
    throw demoError('validation/failed', { field: 'question', reason: 'required' });
  }
  const answer = asString(item.answer_markdown);
  if (answer.trim() === '') {
    throw demoError('validation/failed', { field: 'answer_markdown', reason: 'required' });
  }

  found.question = question;
  found.answer_markdown = answer;
  found.category = cleanOptional(item.category);
  found.intent = asIntent(item.intent);
  found.status = asContentStatus(item.status);
  found.updated_at = nowIso();

  return structuredClone(found);
};

/** `faq_delete`：批量删除，回剩余快照并重排 position（幂等；允许删空）。 */
export const faqDelete: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const ids = new Set(asStringList(args.ids));
  db.faqs = db.faqs.filter((row) => !(row.project_id === projectId && ids.has(row.id)));
  reindex(projectId);

  return structuredClone(faqsOf(db, projectId));
};

/**
 * `faq_generate`：🔴 **不调模型、不成文**，从预置池里按 `intents` 挑一批（差异台账 E-53）。
 * 挑不出来回空数组；重复生成只跳过**问题完全相同**的条目（等值判断，不是相似度去重）。
 */
export const faqGenerate: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const options = asRecord(args.options);
  const intents = requestedIntents(options.intents);
  if (intents.length === 0) {
    throw demoError('validation/failed', { field: 'intents', reason: 'required' });
  }
  const target = clampInt(options.target_count, LIBRARY_GENERATE_MIN, LIBRARY_GENERATE_MAX);

  const existing = new Set(faqsOf(db, projectId).map((row) => row.question));
  const picked = SEED_FAQ_GENERATED_POOL.filter(
    (row) => intents.includes(row.intent) && !existing.has(row.question),
  ).slice(0, target);

  const stamp = nowIso();
  const firstPosition = nextPosition(projectId);
  const added: FaqItem[] = picked.map((row, index) => ({
    id: newId(),
    project_id: projectId,
    question: row.question,
    answer_markdown: row.answer_markdown,
    category: row.category,
    intent: row.intent,
    // 规则 6：生成内容默认待人工审核；界面上另挂「演示模式未执行合规扫描」。
    status: 'pending_review',
    source: 'generated',
    position: firstPosition + index,
    created_at: stamp,
    updated_at: stamp,
  }));

  db.faqs.push(...structuredClone(added));
  return added;
};

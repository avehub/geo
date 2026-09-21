/**
 * M1 `competitor_*`（4 条）与 `asset_*`（3 条）的内存实现（Task 12 · 简报 §B-1）。
 * 真值源 `apps/desktop/src-tauri/src/services/project_service.rs`（下称 service）
 * 与 `crates/geo-store/src/repo/{competitor,asset}.rs`（下称 repo）。
 *
 * # 三条照抄的后端语义
 * - **顺序**：竞品 `position ASC, id ASC`（repo/competitor.rs:88）、资产 `created_at ASC, id ASC`
 *   （repo/asset.rs:80）⇒ 一律经 `db.ts` 的 helper 排，不在这里各写各的；
 * - **删除幂等**：两条 `delete` 在真后端都是裸 `DELETE … WHERE id = ?`，行不存在也返回 `Ok`
 *   ⇒ demo 也**不**发 `*_not_found`（契约里本来就没有 `asset/not_found` 这条码）；
 * - **reorder 全有或全无**：真后端是单事务，任一 id 不属于该项目就整体回滚
 *   （repo/competitor.rs:116-130）⇒ demo 先把全部 id 找齐再写 position。
 *
 * # 🔴 刻意不移植的校验（简报 §B-2③）
 * 竞品名非空 / 长度上限、`MAX_COMPETITORS` 上限、`normalize_url("competitor.website" | "asset.url")`
 * 都是领域校验，且**不在** A-4 / A-6 的真值表里 ⇒ demo 一律放行。
 * demo 要演的是错误契约与前端按语言渲染，不是校验器。
 */
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import { assetsOf, competitorsOf, getDemoDb } from '../db';
import {
  asRecord,
  asString,
  asStringList,
  cleanOptional,
  makeAsset,
  makeCompetitor,
  nowIso,
  requireProject,
} from './shared';

/**
 * `competitor_upsert`：`id` 为 null 时新增（position 接在最大值之后），带 id 时就地更新
 * （真值源 service:169-230）。项目必须存在——竞品挂在 `project_id` 上，真后端靠外键拒孤儿行。
 */
export const competitorUpsert: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const draft = asRecord(args.draft);
  const current = competitorsOf(db, projectId);
  const requestedId = typeof args.id === 'string' ? args.id : null;

  if (requestedId === null) {
    // service:209-213：position = 现有最大值 + 1，空表时是 0。
    const position = current.reduce((max, row) => Math.max(max, row.position), -1) + 1;
    const row = makeCompetitor(projectId, draft, position, nowIso());
    db.competitors.push(row);
    return structuredClone(row);
  }

  const found = current.find((row) => row.id === requestedId);
  if (!found) {
    // A-11：`competitor/not_found` 的 params 是 `{kind:'competitor', id:<competitor_id>}`。
    throw demoError('competitor/not_found', { kind: 'competitor', id: requestedId });
  }
  // 就地更新：id / position / created_at 一律保留（service:196-201）。
  found.name = asString(draft.name).trim();
  found.aliases = asStringList(draft.aliases);
  found.website = cleanOptional(draft.website);
  found.note = cleanOptional(draft.note);
  return structuredClone(found);
};

/** `competitor_list`：真后端不校项目存在性（service:232），没有竞品就是空数组。 */
export const competitorList: DemoHandler = (args) => {
  const db = getDemoDb();
  return structuredClone(competitorsOf(db, asString(args.project_id)));
};

/** `competitor_delete`：幂等（repo/competitor.rs:99）。 */
export const competitorDelete: DemoHandler = (args) => {
  const db = getDemoDb();
  const id = asString(args.id);
  db.competitors = db.competitors.filter((row) => row.id !== id);
  return undefined;
};

/**
 * `competitor_reorder`：按传入顺序把 position 重写成 `0..n`，回整份新顺序（service:243-250）。
 * 🔴 任一 id 不属于该项目 ⇒ `competitor/not_found` 且**一条位置都不写**（真后端单事务整体回滚）。
 */
export const competitorReorder: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  const current = competitorsOf(db, projectId);

  // 先全部找齐（这一步会抛），再统一写：失败时库里的 position 一个都没动过。
  const ordered = asStringList(args.ids).map((id) => {
    const found = current.find((row) => row.id === id);
    if (!found) {
      throw demoError('competitor/not_found', { kind: 'competitor', id });
    }
    return found;
  });
  ordered.forEach((row, position) => {
    row.position = position;
  });

  return structuredClone(competitorsOf(db, projectId));
};

/** `asset_add`：项目必须存在（service:256 先 `projects().get()`），资产本身不校验 URL（见文件头）。 */
export const assetAdd: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const row = makeAsset(projectId, args.kind, args.url, args.title, args.note, nowIso());
  db.assets.push(row);
  return structuredClone(row);
};

/** `asset_list`：`created_at ASC, id ASC`（repo/asset.rs:80）。 */
export const assetList: DemoHandler = (args) => {
  const db = getDemoDb();
  return structuredClone(assetsOf(db, asString(args.project_id)));
};

/** `asset_delete`：幂等（repo/asset.rs:89）。 */
export const assetDelete: DemoHandler = (args) => {
  const db = getDemoDb();
  const id = asString(args.id);
  db.assets = db.assets.filter((row) => row.id !== id);
  return undefined;
};

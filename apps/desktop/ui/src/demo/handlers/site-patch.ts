/**
 * M6.5 站点接入：**补丁台账**那 6 条命令
 * （`site_patch_add` / `_generate` / `_save` / `_transition` / `_history` / `_delete`）。
 * 档案与下发通道那 5 条在 `handlers/site.ts`（单文件约 400 行的软线，AGENTS「代码风格」）。
 * 设计规格 `docs/superpowers/specs/2026-09-30-site-connect-patch-bench-design.md`（DR-47 / DR-51 / DR-56）。
 *
 * 🔴 **Rust 侧没有对应实现**（差异台账 §4e E-55）。
 *
 * # 🔴 demo 不做的三件事
 * ① **不真下发**：`publish` 只翻状态 + 写快照 + 记事件，线上站点一个字节都不会变；
 * ② **不生成正文**：`site_patch_generate` 从「按处方预置」的池子里挑，不调模型（规则 9）；
 * ③ **不算收益**：补丁不承诺提及率变化（规则 6）。
 *
 * # 🔴 `site_patch_save` **不收** `status`
 * 状态只能经 `site_patch_transition` 改：那一条会写快照并追加历史事件，
 * 从 `save` 改状态就等于绕过账本（"谁在什么时候把它发上线的"就查不到了）。
 * `review_status`（人工审核态）**可以**从 `save` 改——照 `keyword_update` 的既有口径，
 * 审核是就地编辑的一部分，而且它是 `publish` 的前置闸门（见下）。
 *
 * # 🔴 `publish` 的前置闸门：`review_status` 必须是 `approved`（规则 6）
 * AI 生成的补丁草案默认 `pending_review`；把没人看过的草案"发布到官网"正是 GEO 场景里
 * 最容易翻车的一类错误（同 `library-compose.ts` 的 JSON-LD 只收 `approved`）。
 * ⇒ 这一支发 `validation/failed {field:'review_status', reason:'not_allowed'}`，
 * 界面上给一句「先人工审核通过，再发布」。
 *
 * # 🔴 三个 transition 都是**全函数**（不存在"非法跃迁"这一支）
 * - `publish`：任何时候都可发（重复发布 = 重新盖一次快照 + 再记一条事件，对齐 Ahrefs 的历史）；
 * - `unpublish`：已经是 `unpublished` 就**原样返回、不记事件**（幂等，照删除那一支的口径）；
 * - `rollback`：没有可回的落点（从没发布过，或草案与快照逐字相同）就**原样返回、不记事件**。
 * 理由：这三个动作在界面上本来就有禁用态，后端再造一套"非法跃迁"错误码只会让两侧各判一遍
 * （而 demo 不许自造校验规则，§B-2③）。
 *
 * # 🔴 `exported` 这一类事件 demo **不追加**
 * 落地包 / `patches.json` 的导出走前端组装 + 既有 `export_write_file`（spec DR-53），
 * 假后端不知道那次落盘成功了没有 ⇒ 不替它记账（种子事件里有 `exported`，是为了让历史抽屉
 * 把这套词汇展示全）。真后端在 service 层写盘成功后追加，已登记进差异台账 §4e。
 *
 * # 语言约束（门禁 7 / §B-11）
 * 本目录非注释 CJK 必须为 0 ⇒ 字符串常量全是 ASCII；handler 追加的事件 `note` **恒 `null`**，
 * 中文备注只出现在 `seed/site.ts` 的事件里（那是"后端数据"的替身）。
 */
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import {
  actionById,
  getDemoDb,
  roundsOf,
  sitePatchById,
  sitePatchEventsOf,
  sitePatchesOf,
} from '../db';
import { SEED_SITE_PATCH_POOL } from '../seed/site';
import type {
  SiteChannelKind,
  SitePatch,
  SitePatchEvent,
  SitePatchEventKind,
  SitePatchKind,
  SitePatchTransition,
} from '../../api/types';
import { SITE_PATCH_KIND_VALUES, SITE_PATCH_TRANSITION_VALUES } from '../../api/types';
import {
  asContentStatus,
  asRecord,
  asSiteChannelKind,
  asSitePatchKind,
  asString,
  asStringList,
  cleanOptional,
  newId,
  nowIso,
  requireProject,
} from './shared';

/** 生成入参里的类型清单：**只保留契约内的值**（口径照 `handlers/keyword.ts` 的 `requestedKinds`）。 */
function requestedKinds(value: unknown): SitePatchKind[] {
  const allowed = SITE_PATCH_KIND_VALUES as readonly string[];
  const picked = asStringList(value).filter((kind) => allowed.includes(kind));
  return [...new Set(picked)] as SitePatchKind[];
}

/**
 * `transition` 是**命令动词**，不是数据字段 ⇒ 契约外的值**报错而不是收敛**。
 * 🔴 与 `shared.ts` 的 `asSitePatchKind` 那批刻意不同：猜错一个类型只是显示错一格，
 * 猜错一个动词就等于替用户执行了一次发布（有真实后果的那一种）。
 */
function asTransition(value: unknown): SitePatchTransition {
  const raw = asString(value);
  if (!(SITE_PATCH_TRANSITION_VALUES as readonly string[]).includes(raw)) {
    throw demoError('validation/failed', {
      field: 'transition',
      reason: 'not_allowed',
      value: raw,
    });
  }
  return raw as SitePatchTransition;
}

/** 把 position 重排成 `0..n-1`（就地改库里的行；`sitePatchesOf` 回的是同一批对象引用）。 */
function reindex(projectId: string): void {
  sitePatchesOf(getDemoDb(), projectId).forEach((row, position) => {
    row.position = position;
  });
}

/** 下一个 position（本项目内最大值 + 1，空表时是 0）。 */
function nextPosition(projectId: string): number {
  return (
    sitePatchesOf(getDemoDb(), projectId).reduce((max, row) => Math.max(max, row.position), -1) + 1
  );
}

/**
 * 追加一条历史事件。
 *
 * 🔴 `created_at` 由**调用方**传（那一次写操作的同一个时间戳）：补丁的 `updated_at` 与
 * 事件的 `created_at` 语义上是同一刻，分两次 `nowIso()` 跨毫秒就会自相矛盾
 * （与 `handlers/action.ts` 的「一次写操作只取一个时间戳」同一条纪律）。
 * 🔴 handler 生成的事件 `note` 恒 `null`（门禁 7）；中文备注只在种子里。
 */
function pushEvent(
  patchId: string,
  kind: SitePatchEventKind,
  channelKind: SiteChannelKind | null,
  stamp: string,
): void {
  const event: SitePatchEvent = {
    id: newId(),
    patch_id: patchId,
    kind,
    channel_kind: channelKind,
    note: null,
    created_at: stamp,
  };
  getDemoDb().sitePatchEvents.push(event);
}

/**
 * `site_patch_add`：手动新建一条补丁。
 *
 * - `source` 由后端固定成 `manual`、`review_status` 固定成 `approved`
 *   （人工录入的东西不需要再审一遍自己，照 `keyword_add` 的口径）；
 * - `status` 恒 `draft`：新建的补丁不可能已经在线上；
 * - `round_id` 继承关联处方的那一轮；没关联处方时取**最近一轮**
 *   （归因时"这处改动算在哪一轮之后"总得有个落点）。
 */
export const sitePatchAdd: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const draft = asRecord(args.draft);
  const title = asString(draft.title).trim();
  if (title === '') {
    throw demoError('validation/failed', { field: 'patch_title', reason: 'required' });
  }
  const targetUrl = asString(draft.target_url).trim();
  if (targetUrl === '') {
    throw demoError('validation/failed', { field: 'patch_target_url', reason: 'required' });
  }
  const body = asString(draft.body);
  if (body.trim() === '') {
    throw demoError('validation/failed', { field: 'patch_body', reason: 'required' });
  }
  const actionId = cleanOptional(draft.action_id);
  const action = actionId === null ? undefined : actionById(db, actionId);
  // 🔴 关联对象必须同时属于本项目：只查"存在"会把 A 的处方挂到 B 的补丁上，
  // 台账里的「来自处方」链接随后指向另一个项目的行动中心（同 `site_patch_generate` 的口径）。
  if (actionId !== null && (action === undefined || action.project_id !== projectId)) {
    throw demoError('validation/failed', {
      field: 'action_id',
      reason: 'invalid_id',
      value: actionId,
    });
  }
  const rounds = roundsOf(db, projectId);
  const roundId = action?.round_id ?? rounds[rounds.length - 1]?.id ?? '';

  const stamp = nowIso();
  const patch: SitePatch = {
    id: newId(),
    project_id: projectId,
    action_id: actionId,
    round_id: roundId,
    kind: asSitePatchKind(draft.kind),
    title,
    target_url: targetUrl,
    target_hint: cleanOptional(draft.target_hint),
    body,
    published_body: null,
    status: 'draft',
    review_status: 'approved',
    channel_kind: asSiteChannelKind(draft.channel_kind),
    source: 'manual',
    position: nextPosition(projectId),
    published_at: null,
    created_at: stamp,
    updated_at: stamp,
  };

  db.sitePatches.push(patch);
  pushEvent(patch.id, 'created', null, stamp);
  return structuredClone(patch);
};

/**
 * `site_patch_generate`：从一条处方生成补丁草案，回**新增那几条**。
 *
 * 🔴 **不调模型**（规则 9）：从 `SEED_SITE_PATCH_POOL[action_id]` 里按 `kinds` 挑，逐字端出。
 * 🔴 **等值去重**：同一个 `(action_id, kind, target_url)` 已经在台账里就跳过
 * （照 `keyword_generate` 的"只跳过文本完全相同"，不是相似度判断）。
 * 全都跳过 ⇒ 回**空数组**而不是错误，界面据此提示"这条处方的补丁已经都在台账里了"。
 * 🔴 `source_layout` 类处方在池子里**没有条目** ⇒ 回空数组；界面上那个按钮本来就置灰（DR-46）。
 */
export const sitePatchGenerate: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const actionId = asString(args.action_id);
  const action = actionById(db, actionId);
  if (action === undefined || action.project_id !== projectId) {
    throw demoError('validation/failed', {
      field: 'action_id',
      reason: 'invalid_id',
      value: actionId,
    });
  }
  const kinds = requestedKinds(args.kinds);
  if (kinds.length === 0) {
    throw demoError('validation/failed', { field: 'kinds', reason: 'empty' });
  }

  const stamp = nowIso();
  const rows = (SEED_SITE_PATCH_POOL[actionId] ?? []).filter((row) => kinds.includes(row.kind));
  const created: SitePatch[] = [];
  let position = nextPosition(projectId);

  for (const row of rows) {
    const duplicated = sitePatchesOf(db, projectId).some(
      (patch) =>
        patch.action_id === actionId &&
        patch.kind === row.kind &&
        patch.target_url === row.target_url,
    );
    if (duplicated) continue;

    const patch: SitePatch = {
      id: newId(),
      project_id: projectId,
      action_id: actionId,
      round_id: action.round_id,
      kind: row.kind,
      title: row.title,
      target_url: row.target_url,
      target_hint: row.target_hint,
      body: row.body,
      published_body: null,
      status: 'draft',
      // 🔴 规则 6：AI 生成的补丁在人工采用前恒为待审，`publish` 那一支会拦住它。
      review_status: 'pending_review',
      channel_kind: row.channel_kind,
      source: 'generated',
      position,
      published_at: null,
      created_at: stamp,
      updated_at: stamp,
    };
    db.sitePatches.push(patch);
    pushEvent(patch.id, 'created', null, stamp);
    created.push(patch);
    position += 1;
  }

  return structuredClone(created);
};

/**
 * `site_patch_save`：就地改草案（整行进整行出）。
 *
 * 🔴 可改：`kind` / `title` / `target_url` / `target_hint` / `body` / `channel_kind` /
 * `review_status`。🔴 **不可改**：`status`（只能经 `transition`，见文件头）、`published_body`
 * （它是上次发布的快照，改了就没有回滚落点了）、`source`（"这条补丁怎么来的"是账）、
 * `position`（由 `delete` 重排）、`action_id` / `round_id`（归因链，改了就对不上处方）。
 * 传进来也**静默忽略**（demo 不自造校验规则，§B-2③）。
 *
 * 🔴 改一条**已发布**的补丁不会自动撤回它：线上还是 `published_body` 那一版，
 * 界面上据 `body !== published_body` 显示"有未发布的修改"（DR-47）。
 */
export const sitePatchSave: DemoHandler = (args) => {
  const db = getDemoDb();
  const patch = asRecord(args.patch);
  const patchId = asString(patch.id);
  const existing = sitePatchById(db, patchId);
  if (existing === undefined) {
    throw demoError('validation/failed', {
      field: 'patch_id',
      reason: 'invalid_id',
      value: patchId,
    });
  }

  const title = asString(patch.title).trim();
  if (title === '') {
    throw demoError('validation/failed', { field: 'patch_title', reason: 'required' });
  }
  const targetUrl = asString(patch.target_url).trim();
  if (targetUrl === '') {
    throw demoError('validation/failed', { field: 'patch_target_url', reason: 'required' });
  }
  // 🔴 与 `site_patch_add` 同一条判据：正文空白 ⇒ 报错。
  // 只在新建时校验的话，"建一条有正文的补丁、再把它改成空的"就能绕过——而一条空正文的补丁
  // 在交接单里会渲染出一个空的代码围栏，在 `patches.json` 里会让边缘函数插一段空白，
  // 两个出口都产出**看起来成功、实际上什么都没改**的东西。
  const body = asString(patch.body);
  if (body.trim() === '') {
    throw demoError('validation/failed', { field: 'patch_body', reason: 'required' });
  }

  const stamp = nowIso();
  existing.kind = asSitePatchKind(patch.kind);
  existing.title = title;
  existing.target_url = targetUrl;
  existing.target_hint = cleanOptional(patch.target_hint);
  existing.body = body;
  existing.channel_kind = asSiteChannelKind(patch.channel_kind);
  existing.review_status = asContentStatus(patch.review_status);
  existing.updated_at = stamp;

  pushEvent(existing.id, 'saved', null, stamp);
  return structuredClone(existing);
};

/**
 * `site_patch_transition`：发布 / 撤回 / 回滚（三个动作共用一条命令，DR-47）。
 *
 * - `publish`：`review_status` 必须 `approved`（规则 6 的闸门）⇒ 盖 `published_body` 快照与
 *   `published_at`，记一条 `published` 事件（带上通道，因为"从哪条路发出去的"是账的一部分）；
 * - `unpublish`：状态回 `unpublished`、`published_at` 清空（线上没有生效版本了），
 *   🔴 `published_body` **保留**——它是之后 `rollback` 的落点；已经撤回过就原样返回、不记事件；
 * - `rollback`：把 `body` 恢复成 `published_body`（**不动** `status`：回滚的是草案，
 *   不是替用户撤回线上版本）；没有可回的落点就原样返回、不记事件。
 */
export const sitePatchTransition: DemoHandler = (args) => {
  const db = getDemoDb();
  const patchId = asString(args.patch_id);
  const patch = sitePatchById(db, patchId);
  if (patch === undefined) {
    throw demoError('validation/failed', {
      field: 'patch_id',
      reason: 'invalid_id',
      value: patchId,
    });
  }

  const transition = asTransition(args.transition);
  const stamp = nowIso();

  if (transition === 'publish') {
    if (patch.review_status !== 'approved') {
      throw demoError('validation/failed', {
        field: 'review_status',
        reason: 'not_allowed',
        value: patch.review_status,
      });
    }
    patch.status = 'published';
    patch.published_body = patch.body;
    patch.published_kind = patch.kind;
    patch.published_target_url = patch.target_url;
    patch.published_channel_kind = patch.channel_kind;
    patch.published_at = stamp;
    patch.updated_at = stamp;
    pushEvent(patch.id, 'published', patch.channel_kind, stamp);
    return structuredClone(patch);
  }

  if (transition === 'unpublish') {
    if (patch.status === 'unpublished') return structuredClone(patch);
    patch.status = 'unpublished';
    patch.published_at = null;
    patch.updated_at = stamp;
    pushEvent(patch.id, 'unpublished', patch.channel_kind, stamp);
    return structuredClone(patch);
  }

  // rollback：草案恢复成上一次发布的快照；没有落点就什么都不做（也不记事件）。
  if (patch.published_body === null || patch.body === patch.published_body) {
    return structuredClone(patch);
  }
  patch.body = patch.published_body;
  if (patch.published_kind != null) patch.kind = patch.published_kind;
  if (patch.published_target_url != null) patch.target_url = patch.published_target_url;
  if (patch.published_channel_kind != null) patch.channel_kind = patch.published_channel_kind;
  patch.updated_at = stamp;
  pushEvent(patch.id, 'rolled_back', null, stamp);
  return structuredClone(patch);
};

/** `site_patch_history`：一条补丁的历史事件（**时间正序**，口径在 `db.ts` 的 `sitePatchEventsOf`）。 */
export const sitePatchHistory: DemoHandler = (args) => {
  const db = getDemoDb();
  const patchId = asString(args.patch_id);
  if (sitePatchById(db, patchId) === undefined) {
    throw demoError('validation/failed', {
      field: 'patch_id',
      reason: 'invalid_id',
      value: patchId,
    });
  }
  return structuredClone(sitePatchEventsOf(db, patchId));
};

/**
 * `site_patch_delete`：批量删除，回**剩余快照**（position 已重排）。
 *
 * 🔴 **已发布的补丁拒删**（`state/conflict {reason:'not_allowed', value:'published'}`）：
 * 直接删掉等于一次没有 `unpublished` 事件的隐式撤回，"谁在什么时候把什么改上线了"这本账
 * 会断掉。要求先 `site_patch_transition(unpublish)` 再删；整批原子（混入一条已发布的，
 * 同批里可删的也不动）。
 *
 * 🔴 **级联删事件**：补丁没了，它的历史也就不该留（留着就是一批指向不存在补丁的孤儿行）。
 * 真后端用外键 `ON DELETE CASCADE`；demo 在这里显式过滤一遍，语义相同。
 * 🔴 只按**本项目实际命中**的补丁 id 级联：入参里混进别的项目的 id 时，
 * 那个 id 不该把 B 的历史一起删掉（B 的补丁还在，历史却没了）。
 * 幂等：认不出的 id 直接忽略（照 `keyword_delete`）。
 */
export const sitePatchDelete: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);
  const ids = new Set(asStringList(args.ids));

  // 🔴 先算**本项目实际命中**的补丁：入参里混进别的项目的 id 时，
  // 那个 id 不该被当成"级联删事件"的依据（否则 B 的补丁还在、历史却没了）。
  const doomedRows = sitePatchesOf(db, projectId).filter((patch) => ids.has(patch.id));
  const doomed = new Set(doomedRows.map((patch) => patch.id));

  // 🔴 已发布的补丁不能硬删：删掉等于一次没有 `unpublished` 事件的隐式撤回，
  // 审计链（谁在什么时候把什么改上线了）会直接断掉。要求先 `unpublish` 再删。
  // 整批拒绝（原子）：混入一条已发布的，同批里可删的也不动，避免"删了一半"。
  if (doomedRows.some((patch) => patch.status === 'published')) {
    throw demoError('state/conflict', { reason: 'not_allowed', value: 'published' });
  }

  db.sitePatches = db.sitePatches.filter(
    (patch) => !(patch.project_id === projectId && doomed.has(patch.id)),
  );
  db.sitePatchEvents = db.sitePatchEvents.filter((event) => !doomed.has(event.patch_id));
  reindex(projectId);

  return structuredClone(sitePatchesOf(db, projectId));
};

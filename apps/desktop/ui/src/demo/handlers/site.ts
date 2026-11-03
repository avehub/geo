/**
 * M6.5 站点接入：**档案 + 下发通道**那 5 条命令
 * （`site_board` / `site_profile_save` / `site_channel_upsert` / `_remove` / `_test`）。
 * 补丁台账那 6 条在 `handlers/site-patch.ts`（单文件约 400 行的软线，AGENTS「代码风格」）。
 * 设计规格 `docs/superpowers/specs/2026-09-30-site-connect-patch-bench-design.md`（DR-45 … DR-56）。
 *
 * 🔴 **Rust 侧没有对应实现**：这 5 条与 M3–M7 那 20 条、Plan B 那 2 条、M1.5 那 10 条同族
 * ——只有 demo 侧接线，桌面端点进来会报 `ipc/unknown_command`（差异台账 §4e E-55）。
 *
 * # 🔴 demo 不做的四件事（spec DR-56，界面上都有常驻说明）
 * ① **不联网自检**：`site_channel_test` 逐字端出 `SEED_SITE_CHANNEL_PROBES` 的预置结论
 *   （规则 2「测试禁止联网」的同族纪律）；
 * ② **不发现页面**：`SEED_SITE_PAGES` 是静态表，真后端由爬虫发现（规则 9）；
 * ③ **不收凭据**：任何密码 / token 都不进内存、不进库、不进错误 params（DR-48 / 规则 3）；
 * ④ **不真下发**：通道只是"打算怎么改"的账，线上站点一个字节都不会变。
 *
 * # 三种照抄既有 handler 的后端语义
 * - **返回形状不统一**（刻意）：`board` 回一个对象、`profile_save` / `channel_upsert` / `test`
 *   回**单条**、`channel_remove` 回**剩余快照**；
 * - **删除幂等**：认不出的 kind 直接忽略（照 `competitor_delete`）；
 * - **一次写操作只取一个时间戳**（照 `handlers/action.ts`）。
 *
 * # 语言约束（门禁 7 / §B-11）
 * 本目录非注释 CJK 必须为 0 ⇒ 字符串常量全是 ASCII；自检结论的中文逐字来自 `seed/site.ts`。
 */
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import {
  actionById,
  demoSiteSecretRef,
  getDemoDb,
  siteChannelOf,
  siteChannelsOf,
  sitePatchesOf,
  siteProfileOf,
} from '../db';
import { SEED_SITE_CHANNEL_PROBES, SEED_SITE_PAGES, SEED_SITE_PATCH_POOL } from '../seed/site';
import type {
  SiteBoard,
  SiteChannel,
  SiteChannelKind,
  SiteCredentialsState,
  SitePatchPoolEntry,
  SiteProfile,
} from '../../api/types';
import { SITE_CHANNEL_KIND_VALUES } from '../../api/types';
import {
  asSiteOwnership,
  asSitePlatform,
  asString,
  cleanOptional,
  newId,
  nowIso,
  requireProject,
} from './shared';

/**
 * 哪几条通道需要凭据（spec DR-48）。
 * 🔴 demo 里 `stored` **永远不会出现**：演示模式不收任何密码与 token，
 * 所以只有"不需要"与"缺"两档（比真后端更强，照 `handlers/secret.ts` 的口径）。
 */
const CREDENTIALS_BY_KIND: Record<SiteChannelKind, SiteCredentialsState> = {
  bundle: 'not_required',
  cms: 'missing',
  edge: 'missing',
  repo: 'not_required',
};

/** `bundle` 是唯一零配置就能用的通道 ⇒ 建档即 `ready`（其余三条要填落点或部署完才算）。 */
const READY_WITHOUT_CONFIG: readonly SiteChannelKind[] = ['bundle'];

/**
 * 通道 kind 入参：它决定**改哪一行** ⇒ 认不出就报错，不收敛。
 * 🔴 与 `shared.ts` 的 `asSiteChannelKind`（数据字段的收敛）刻意不同：那边是
 * "一条已存在的记录总得有个合法类型"，这边是"用户点名要操作哪条通道"——
 * 把认不出的 kind 悄悄换成 `bundle`，就会把一条 CMS 配置写进落地包那一行。
 */
function requireChannelKind(value: unknown): SiteChannelKind {
  const raw = asString(value);
  if (!(SITE_CHANNEL_KIND_VALUES as readonly string[]).includes(raw)) {
    throw demoError('validation/failed', {
      field: 'channel_kind',
      reason: 'not_allowed',
      value: raw,
    });
  }
  return raw as SiteChannelKind;
}

/** 生成池的**目录**（只有 action_id / kind / title，正文留在种子里）。 */
function poolEntries(): SitePatchPoolEntry[] {
  return Object.entries(SEED_SITE_PATCH_POOL).flatMap(([actionId, rows]) =>
    rows.map((row) => ({ action_id: actionId, kind: row.kind, title: row.title })),
  );
}

/**
 * `site_board`：站点接入页首屏（档案 + 页面清单 + 通道 + 补丁 + 生成池目录）。
 *
 * 一次往返拿全五块，避免五个 loading 打架——与 `action_board` / `collection_board` 同一个取舍。
 * 🔴 `profile` 可以是 `null`（还没建档），这不是错误：站点页是左侧导航直达的落点，
 * "这个项目还没建档"是正常状态（spec DR-51）。
 */
export const siteBoard: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const board: SiteBoard = {
    profile: structuredClone(siteProfileOf(db, projectId) ?? null),
    // 页面清单是**静态表**（规则 9：真后端由爬虫发现），只按项目过滤，不进可变库。
    pages: structuredClone(SEED_SITE_PAGES.filter((page) => page.project_id === projectId)),
    channels: structuredClone(siteChannelsOf(db, projectId)),
    patches: structuredClone(sitePatchesOf(db, projectId)),
    // 池子的键是**处方 id** ⇒ 按处方的归属项目过滤，归档项目自然一条都没有。
    pool: poolEntries().filter(
      (entry) => actionById(db, entry.action_id)?.project_id === projectId,
    ),
  };
  return board;
};

/**
 * `site_profile_save`：保存站点档案（**upsert**：没建档就建一份）。
 *
 * 🔴 `domain` 不在入参里：它逐字来自 `Project.website`（站点根域名是项目的事实，
 * 不该在两个地方各存一份、各自漂）。项目没填官网 ⇒ 空串，界面上提示"先在项目里补官网地址"。
 */
export const siteProfileSave: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  const project = requireProject(db, projectId);

  const platform = asSitePlatform(args.platform);
  const ownership = asSiteOwnership(args.ownership);
  const note = cleanOptional(args.note);
  const stamp = nowIso();

  const existing = siteProfileOf(db, projectId);
  if (existing !== undefined) {
    existing.platform = platform;
    existing.ownership = ownership;
    existing.note = note;
    existing.updated_at = stamp;
    return structuredClone(existing);
  }

  const profile: SiteProfile = {
    id: newId(),
    project_id: projectId,
    domain: project.website ?? '',
    platform,
    ownership,
    note,
    created_at: stamp,
    updated_at: stamp,
  };
  db.siteProfiles.push(profile);
  return structuredClone(profile);
};

/**
 * `site_channel_upsert`：增改一条下发通道（同 `kind` 覆盖 ⇒ 一个项目每条通道至多一行）。
 *
 * 🔴 **不收凭据**（DR-48 / 规则 3）：入参只有 `endpoint`（站点 URL / Worker 路由 / 仓库地址）
 * 与 `username`（WP 用户名）两个**非敏感**字段；`credentials_state` 由 kind 推导，
 * demo 里只会是 `not_required` 或 `missing`，`secret_ref` 只是一个引用串。
 * 🔴 改配置 ⇒ 上一次的自检结论**作废**（`checked_at` / `check_detail` 清空、状态回
 * `pending_verify`）：留着一条针对旧配置的"自检通过"是最容易骗人的那种界面。
 */
export const siteChannelUpsert: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);
  const kind = requireChannelKind(args.kind);

  const endpoint = kind === 'bundle' ? null : cleanOptional(args.endpoint);
  const username = kind === 'bundle' ? null : cleanOptional(args.username);
  const note = cleanOptional(args.note);
  const credentials = CREDENTIALS_BY_KIND[kind];
  const secretRef = credentials === 'not_required' ? null : demoSiteSecretRef(kind, projectId);
  const status: SiteChannel['status'] = READY_WITHOUT_CONFIG.includes(kind)
    ? 'ready'
    : endpoint === null
      ? 'not_configured'
      : 'pending_verify';
  const stamp = nowIso();

  const existing = siteChannelOf(db, projectId, kind);
  if (existing !== undefined) {
    existing.status = status;
    existing.endpoint = endpoint;
    existing.username = username;
    existing.note = note;
    existing.credentials_state = credentials;
    existing.secret_ref = secretRef;
    existing.checked_at = null;
    existing.check_detail = null;
    existing.updated_at = stamp;
    return structuredClone(existing);
  }

  const channel: SiteChannel = {
    id: newId(),
    project_id: projectId,
    kind,
    status,
    endpoint,
    username,
    note,
    credentials_state: credentials,
    secret_ref: secretRef,
    checked_at: null,
    check_detail: null,
    updated_at: stamp,
  };
  db.siteChannels.push(channel);
  return structuredClone(channel);
};

/**
 * `site_channel_remove`：删一条通道配置，回**剩余快照**（幂等：认不出的 kind 直接忽略）。
 *
 * 🔴 删的是**配置**，不是补丁：已经挂在 `bundle` / `edge` 上的补丁原样留着
 * （它们的 `channel_kind` 只是"打算走哪条路"的标记，不是一条外键）。
 */
export const siteChannelRemove: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);
  const kind = requireChannelKind(args.kind);

  db.siteChannels = db.siteChannels.filter(
    (channel) => !(channel.project_id === projectId && channel.kind === kind),
  );
  return structuredClone(siteChannelsOf(db, projectId));
};

/**
 * `site_channel_test`：跑一次连通性自检。
 *
 * 🔴 **不联网**（规则 2 / 规则 9）：结论逐字来自 `SEED_SITE_CHANNEL_PROBES`。
 * 真后端这一支要真发一次探测（HEAD 请求 / WP REST 认证 / Worker 拉 `patches.json`），
 * 并带上真实延迟与失败原因；界面上有常驻说明，不让人把预置结论当探测结果。
 *
 * 🔴 **自检即建档**：这个项目还没有该 kind 的通道行时，先按默认值补一行再写探测结论
 * ——与 `handlers/secret.ts` 里"表里没有那一行就补一条"同一个先例：
 * 探测结论必须落在某一行上，而"没配过"本身也是一个合法起点。
 */
export const siteChannelTest: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);
  const kind = requireChannelKind(args.kind);

  const probe = SEED_SITE_CHANNEL_PROBES[kind];
  const stamp = nowIso();
  const credentials = CREDENTIALS_BY_KIND[kind];

  let channel = siteChannelOf(db, projectId, kind);
  if (channel === undefined) {
    channel = {
      id: newId(),
      project_id: projectId,
      kind,
      status: 'not_configured',
      endpoint: null,
      username: null,
      note: null,
      credentials_state: credentials,
      secret_ref: credentials === 'not_required' ? null : demoSiteSecretRef(kind, projectId),
      checked_at: null,
      check_detail: null,
      updated_at: stamp,
    };
    db.siteChannels.push(channel);
  }

  channel.status = probe.status;
  channel.check_detail = probe.check_detail;
  channel.checked_at = stamp;
  channel.updated_at = stamp;
  return structuredClone(channel);
};

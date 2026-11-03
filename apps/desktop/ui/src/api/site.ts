/**
 * M6.5 站点接入与补丁工作台的 IPC wrapper（11 条命令）。
 * 拆分理由与依赖方向见 `api/collection.ts` 的头注释：`client.ts` 已经接近
 * 「单文件约 400 行就拆分」的软线，同族 wrapper 一律**只 import `client.ts`**，
 * 反向不 import ⇒ 依赖图单向，没有运行期循环依赖。
 *
 * 🔴 这 11 条**只有 demo 侧实现**（Rust 侧本轮零改动）：桌面端点进来会报
 * `ipc/unknown_command`，差异台账 §4e E-55 起。
 *
 * ⚠ 组件**不许**直接调 `call`，更不许直接 `invoke`（AGENTS 代码风格：IPC 调用集中在 `src/api/`）。
 */
import { call } from './client';
import type {
  SiteBoard,
  SiteChannel,
  SiteChannelKind,
  SiteOwnership,
  SitePatch,
  SitePatchDraft,
  SitePatchEvent,
  SitePatchKind,
  SitePatchTransition,
  SitePlatform,
  SiteProfile,
} from './types';

// ---------------------------------------------------------------------------
// 首屏与站点档案
// ---------------------------------------------------------------------------

/** 站点接入页首屏：档案 + 页面清单 + 通道 + 补丁 + 生成池目录（一次往返）。 */
export const siteBoard = (projectId: string) =>
  call<SiteBoard>('site_board', { project_id: projectId });

/**
 * 保存站点档案（**upsert**：没建档就建一份）。
 * 🔴 不收 `domain`：站点根域名逐字来自 `Project.website`，不在两处各存一份。
 */
export const siteProfileSave = (
  projectId: string,
  platform: SitePlatform,
  ownership: SiteOwnership,
  note: string | null,
) =>
  call<SiteProfile>('site_profile_save', {
    project_id: projectId,
    platform,
    ownership,
    note,
  });

// ---------------------------------------------------------------------------
// 下发通道
// ---------------------------------------------------------------------------

/**
 * 增改一条通道配置（同 `kind` 覆盖）。
 * 🔴 **不收凭据**（spec DR-48 / AGENTS 规则 3）：`endpoint` 与 `username` 都是非敏感配置，
 * 密码与 token 在真后端才进系统钥匙串，demo 一个字符都不收。
 */
export const siteChannelUpsert = (
  projectId: string,
  kind: SiteChannelKind,
  endpoint: string | null,
  username: string | null,
  note: string | null,
) =>
  call<SiteChannel>('site_channel_upsert', {
    project_id: projectId,
    kind,
    endpoint,
    username,
    note,
  });

/** 删一条通道配置，回**剩余快照**（幂等）。删的是配置，不动挂在它上面的补丁。 */
export const siteChannelRemove = (projectId: string, kind: SiteChannelKind) =>
  call<SiteChannel[]>('site_channel_remove', { project_id: projectId, kind });

/**
 * 跑一次连通性自检，回**那条通道**（带 `checked_at` 与结论）。
 * 🔴 demo 不联网：结论逐字来自预置表（AGENTS 规则 9），界面上有常驻说明。
 */
export const siteChannelTest = (projectId: string, kind: SiteChannelKind) =>
  call<SiteChannel>('site_channel_test', { project_id: projectId, kind });

// ---------------------------------------------------------------------------
// 补丁台账
// ---------------------------------------------------------------------------

/** 手动新建一条补丁。`source` 由后端固定成 `manual`、审核态固定成 `approved`。 */
export const sitePatchAdd = (projectId: string, draft: SitePatchDraft) =>
  call<SitePatch>('site_patch_add', { project_id: projectId, draft });

/**
 * 从一条处方生成补丁草案，回**新增那几条**。
 * 🔴 demo 不调模型：从「按处方预置」的池子里挑；已存在的 `(处方, 类型, 落点)` 会跳过，
 * 全都跳过就回**空数组**（不是错误）。`source_layout` 类处方没有候选 ⇒ 恒回空数组。
 */
export const sitePatchGenerate = (projectId: string, actionId: string, kinds: SitePatchKind[]) =>
  call<SitePatch[]>('site_patch_generate', {
    project_id: projectId,
    action_id: actionId,
    kinds,
  });

/**
 * 就地改草案（整行进整行出）。
 * 🔴 只改草案：`status` 只能经 `sitePatchTransition` 改（那一条才写快照与历史）。
 */
export const sitePatchSave = (patch: SitePatch) =>
  call<SitePatch>('site_patch_save', { patch });

/**
 * 发布 / 撤回 / 回滚（三个动作共用一条命令，spec DR-47）。
 * 🔴 `publish` 要求 `review_status === 'approved'`（AGENTS 规则 6），否则 reject
 * `validation/failed`；`unpublish` 与 `rollback` 在没有可做的事时**原样返回**（不记事件）。
 */
export const sitePatchTransition = (patchId: string, transition: SitePatchTransition) =>
  call<SitePatch>('site_patch_transition', { patch_id: patchId, transition });

/** 一条补丁的历史事件（**时间正序**）。 */
export const sitePatchHistory = (patchId: string) =>
  call<SitePatchEvent[]>('site_patch_history', { patch_id: patchId });

/** 批量删除，回**剩余快照**（position 已重排；历史事件级联删）。 */
export const sitePatchDelete = (projectId: string, ids: string[]) =>
  call<SitePatch[]>('site_patch_delete', { project_id: projectId, ids });

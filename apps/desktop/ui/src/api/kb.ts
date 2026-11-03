/**
 * 知识库（M1.2b 知识层）的 IPC wrapper（6 条命令）。
 * 拆分理由与依赖方向见 `api/library.ts` 的头注释：`client.ts` 已经过了「单文件约 400 行就拆分」
 * 的软线，同族 wrapper 一律**只 import `client.ts`**，反向不 import ⇒ 依赖图单向。
 *
 * 🔴 这 6 条**只有 demo 侧实现**（Rust 侧本轮零改动）：桌面端点进来会报 `ipc/unknown_command`，
 * 差异台账 §4f E-60 起、§4g E-63（`kb_entry_detach` 随同步块退役删除）。
 *
 * ⚠ 组件**不许**直接调 `call`，更不许直接 `invoke`（AGENTS 代码风格：IPC 调用集中在 `src/api/`）。
 */
import { call } from './client';
import type {
  KbBoard,
  KbEntry,
  KbEntryDraft,
  KbGenerateOptions,
} from './types';

/**
 * 一次拿全整个知识库：落库条目 + **现场投影**的同步块 + 过期副本清单 + 统计。
 *
 * 🔴 同步块已退役（DR-73）：知识库只有落库行；「从实体卡导入」是一次性复制（DR-81），
 * 走 `kb_entry_add` 的 `source: 'imported'`，不新增命令。
 */
export const kbBoard = (projectId: string) =>
  call<KbBoard>('kb_board', { project_id: projectId });

/** 手动录入（可批量），回**新增那几条**。`source` 由后端固定 `manual`、`status` 固定 `approved`。 */
export const kbEntryAdd = (projectId: string, drafts: KbEntryDraft[]) =>
  call<KbEntry[]>('kb_entry_add', { project_id: projectId, drafts });

/** 就地编辑 / 人工审核改状态，整行进整行出。`verified_at` 后端不改（核实走 `kb_entry_verify`）。 */
export const kbEntryUpdate = (entry: KbEntry) => call<KbEntry>('kb_entry_update', { entry });

/**
 * 批量删除，回**剩余快照**（position 已重排）。
 * 🔴 同步块的 id 不是落库行 ⇒ 传进去会被**忽略**（幂等，不报 `not_found`）：
 * 投影删不掉，要让它消失得去源头改（删掉实体卡那个字段的值）。
 */
export const kbEntryDelete = (projectId: string, ids: string[]) =>
  call<KbEntry[]>('kb_entry_delete', { project_id: projectId, ids });

/** 批量核实（Guru 的 verification）：`status → approved` + `verified_at → now`，回**快照**。 */
export const kbEntryVerify = (projectId: string, ids: string[]) =>
  call<KbEntry[]>('kb_entry_verify', { project_id: projectId, ids });

/**
 * AI 生成一批知识条目。
 * 🔴 demo 不调模型：从 `demo/seed/kb.ts` 的预置池里按 `modules` 挑（AGENTS 规则 9），
 * 产物一律 `source: 'generated'` + `status: 'pending_review'`（规则 6）。
 * 挑不出来时回**空数组**而不是错误，界面据此提示"换个模块，或手动录入"。
 */
export const kbGenerate = (projectId: string, options: KbGenerateOptions) =>
  call<KbEntry[]>('kb_generate', { project_id: projectId, options });

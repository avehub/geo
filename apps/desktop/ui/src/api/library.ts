/**
 * M1.5 素材层（关键词库 / FAQ 常见问题库）的 IPC wrapper（10 条命令）。
 * 拆分理由与依赖方向见 `api/collection.ts` 的头注释：`client.ts` 已经接近
 * 「单文件约 400 行就拆分」的软线，同族 wrapper 一律**只 import `client.ts`**，
 * 反向不 import ⇒ 依赖图单向，没有运行期循环依赖。
 *
 * 🔴 这 10 条**只有 demo 侧实现**（Rust 侧本轮零改动）：桌面端点进来会报
 * `ipc/unknown_command`，差异台账 §4d E-52 起。
 *
 * ⚠ 组件**不许**直接调 `call`，更不许直接 `invoke`（AGENTS 代码风格：IPC 调用集中在 `src/api/`）。
 */
import { call } from './client';
import type {
  FaqDraft,
  FaqGenerateOptions,
  FaqItem,
  KeywordDraft,
  KeywordGenerateOptions,
  KeywordItem,
} from './types';

// ---------------------------------------------------------------------------
// 关键词库
// ---------------------------------------------------------------------------

/** 该项目全部关键词素材（`position ASC, id ASC`）。 */
export const keywordList = (projectId: string) =>
  call<KeywordItem[]>('keyword_list', { project_id: projectId });

/** 手动录入（可批量），回**新增那几条**。`source` 由后端固定成 `manual`。 */
export const keywordAdd = (projectId: string, drafts: KeywordDraft[]) =>
  call<KeywordItem[]>('keyword_add', { project_id: projectId, drafts });

/** 就地编辑 / 人工审核，整行进整行出。 */
export const keywordUpdate = (item: KeywordItem) =>
  call<KeywordItem>('keyword_update', { item });

/** 批量删除，回**剩余快照**（position 已重排）。 */
export const keywordDelete = (projectId: string, ids: string[]) =>
  call<KeywordItem[]>('keyword_delete', { project_id: projectId, ids });

/**
 * AI 生成一批关键词。
 * 🔴 demo 不调模型：从预置语料池里按 `kinds` 挑（AGENTS 规则 9），产物一律 `pending_review`。
 * 挑不出来时回**空数组**而不是错误，界面据此提示"换个类型，或手动录入"。
 */
export const keywordGenerate = (projectId: string, options: KeywordGenerateOptions) =>
  call<KeywordItem[]>('keyword_generate', { project_id: projectId, options });

// ---------------------------------------------------------------------------
// FAQ 常见问题库
// ---------------------------------------------------------------------------

/** 该项目全部问答（`position ASC, id ASC`）。 */
export const faqList = (projectId: string) => call<FaqItem[]>('faq_list', { project_id: projectId });

/** 手动录入（可批量），回**新增那几条**。 */
export const faqAdd = (projectId: string, drafts: FaqDraft[]) =>
  call<FaqItem[]>('faq_add', { project_id: projectId, drafts });

/** 就地编辑 / 人工审核，整行进整行出。 */
export const faqUpdate = (item: FaqItem) => call<FaqItem>('faq_update', { item });

/** 批量删除，回**剩余快照**。 */
export const faqDelete = (projectId: string, ids: string[]) =>
  call<FaqItem[]>('faq_delete', { project_id: projectId, ids });

/** AI 生成一批问答（口径同 `keywordGenerate`）。 */
export const faqGenerate = (projectId: string, options: FaqGenerateOptions) =>
  call<FaqItem[]>('faq_generate', { project_id: projectId, options });

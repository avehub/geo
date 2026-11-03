/**
 * 关键词库 / FAQ 常见问题库（M1.5 素材层）的 IPC 契约类型。
 * 设计规格 `docs/superpowers/specs/2026-09-30-keyword-faq-library-design.md`（DR-38 / DR-39）。
 *
 * # 口径来自哪里
 * 产品负责人 2026-09-30 的需求：素材支持**手动录入**与 **AI 生成**，并且要能被**直接引用**
 * ——一是导出成官网可用的素材（关键词 CSV / FAQ 的 `FAQPage` JSON-LD），二是引用进 M2 的 Prompt 题库。
 *
 * # 🔴 demo 的边界（AGENTS 规则 9）
 * - `monthly_volume` / `difficulty` 是**预置静态值**：真后端要调模型与第三方关键词接口，demo 一个都不调；
 * - `*_generate` **不跑模型**：从种子的预置池里按种类/意图挑一批，产物一律 `pending_review`；
 * - **不做相似度去重**：生成时只跳过文本完全相同的条目（等值判断，不是 3-gram Jaccard 那套）。
 *
 * # 合规（AGENTS 规则 6）
 * `status` 复用 `ContentStatus`：AI 生成的素材在人工采用前恒为 `pending_review`，
 * 界面上不得把它当成已核实的事实呈现；FAQ 的 JSON-LD 导出**只收 `approved`**（DR-44）。
 */
import type { AssertComplete, ValuesAreComplete } from './completeness';
import type { ContentStatus, IntentCategory } from './types';

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/**
 * 关键词类型（5 类）。`question` 是"问题型关键词"，它与 FAQ 库天然接壤：
 * 同一个问法既可以是长尾关键词，也可以升级成一条 FAQ。
 */
export type KeywordKind = 'core' | 'long_tail' | 'brand' | 'competitor' | 'question';

export const KEYWORD_KIND_VALUES = [
  'core',
  'long_tail',
  'brand',
  'competitor',
  'question',
] as const satisfies readonly KeywordKind[];

/**
 * 素材来源（3 档）。
 *
 * 🔴 **刻意不复用** `PromptSource`：那边的 `template` / `rewritten` 两档来自 M2 的
 * 「模板展开 → 口语化改写」管线，素材库没有这两条链路；借用会让界面显示一条并不存在的生成链
 * （与 `handlers/shared.ts` 的 `asPromptSource` 回落 `manual` 同一条理由）。
 */
export type LibrarySource = 'manual' | 'generated' | 'imported';

export const LIBRARY_SOURCE_VALUES = [
  'manual',
  'generated',
  'imported',
] as const satisfies readonly LibrarySource[];

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/** 一条关键词素材。 */
export interface KeywordItem {
  id: string;
  project_id: string;
  /** 关键词文本（用户可见的**数据**，中文照实存）。 */
  text: string;
  kind: KeywordKind;
  /** 复用 M2 的 7 类意图（DR-39）：这是"引用到 Prompt 题库"能一对一映射的前提。 */
  intent: IntentCategory;
  /**
   * 月搜索量。🔴 demo 里是种子写死的静态值；`null` = 该来源没有这个指标
   * （人工录入的条目通常没有），界面显示空值占位符而不是 0。
   */
  monthly_volume: number | null;
  /** 竞争难度 0~100，同上（静态值，不是算出来的）。 */
  difficulty: number | null;
  /** 优先级 1~5；引用成 Prompt 条目时当 `weight` 用（DR-43）。 */
  priority: number;
  /** 审核态：AI 生成默认 `pending_review`，人工录入默认 `approved`。 */
  status: ContentStatus;
  note: string | null;
  source: LibrarySource;
  /** 0 基，照 `prompt_item` 的 `position` 口径。 */
  position: number;
  created_at: string;
  updated_at: string;
}

/** 手动录入一条关键词的入参。`source` 由后端固定成 `manual`，前端不能自称 AI 生成。 */
export interface KeywordDraft {
  text: string;
  kind: KeywordKind;
  intent: IntentCategory;
  priority?: number;
  note?: string | null;
}

/** 一条 FAQ 素材（问题 + 答案）。 */
export interface FaqItem {
  id: string;
  project_id: string;
  question: string;
  /**
   * 答案正文（Markdown 原文）。🔴 导出 JSON-LD 时按**原文**塞进 `acceptedAnswer.text`，
   * demo 不做 Markdown → HTML 渲染（与 `api/content-compose.ts` 的 `html` 那一支同族取舍）。
   */
  answer_markdown: string;
  /** 自由文本分类（如「选型」「售后」）；它是**数据**，不是枚举，所以不进词典。 */
  category: string | null;
  intent: IntentCategory;
  status: ContentStatus;
  source: LibrarySource;
  position: number;
  created_at: string;
  updated_at: string;
}

/** 手动录入一条 FAQ 的入参。 */
export interface FaqDraft {
  question: string;
  answer_markdown: string;
  category?: string | null;
  intent: IntentCategory;
}

/** `keyword_generate` 的入参。 */
export interface KeywordGenerateOptions {
  /** 要生成哪几类；空数组 ⇒ `validation/failed`。 */
  kinds: KeywordKind[];
  /** 期望条数，后端夹在 `KEYWORD_GENERATE_MIN..MAX` 内。 */
  target_count: number;
}

/** `faq_generate` 的入参。 */
export interface FaqGenerateOptions {
  /** 要覆盖哪几类意图；空数组 ⇒ `validation/failed`。 */
  intents: IntentCategory[];
  target_count: number;
}

/** 一次生成的条数上限（两侧共用：demo 夹取，Plan C 的真后端照这个口径实现）。 */
export const LIBRARY_GENERATE_MAX = 20;
/** 一次生成的条数下限。 */
export const LIBRARY_GENERATE_MIN = 1;

// ---------------------------------------------------------------------------
// 编译期完整性网
// ---------------------------------------------------------------------------

export type KeywordKindValuesComplete = AssertComplete<
  ValuesAreComplete<KeywordKind, typeof KEYWORD_KIND_VALUES>
>;
export type LibrarySourceValuesComplete = AssertComplete<
  ValuesAreComplete<LibrarySource, typeof LIBRARY_SOURCE_VALUES>
>;

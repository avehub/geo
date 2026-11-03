/**
 * 文章管理 Article Studio（M6 内容生产）的 IPC 契约类型。
 * 设计规格 `docs/superpowers/specs/2026-10-10-kb-redesign-and-article-studio-design.md`（DR-83 … DR-89）。
 *
 * # 口径来自哪里
 * 产品负责人 2026-10-10 的指示②：项目下新增「文章管理」二级菜单——方向/策略 → 提示词模板 →
 * 定时任务生成文章。四个对象因此是一条链：`方向`（写什么、写给谁）→ `模板`（怎么问模型）
 * → `排期`（什么时候自动问）→ `文章`（问出来的东西，进人工评审队列）。
 * 形态照 Jasper / Copy.ai 的 workflows 与 HubSpot campaigns（spec §2 那张采纳表）。
 *
 * # 🔴 demo 的边界（AGENTS 规则 9 / 规则 2 / 规则 6，spec DR-85）
 * - **没有真 cron**：`next_run_at` 是按 freq + time 算出来的**显示值**，到点不会自己跑；
 *   界面上那句「演示模式不跑真实定时任务」常驻；
 * - **不调模型**：`article_schedule_run` 与模板「立即生成」都从 `demo/seed/articles.ts` 的
 *   预置文章池里取，按标题去重，池子用完回空数组；
 * - **不做合规扫描**：生成物一律 `pending_review`，界面上另挂「演示模式未执行合规扫描」标签；
 * - **不做真拼接注入**（DR-89）：`bindings` 与 `kb_modules` 只是**记录**"这条模板引用了什么"，
 *   demo 不把它们塞进 prompt 发给模型；预览里的替换发生在**前端**（`components/article-slots.ts`）。
 *
 * # 合规（AGENTS 规则 6）
 * `ArticleStatus` 三档与 `ContentStatus` 逐字同形，但**自带一张标签表**（`article.statuses`，
 * DR-88 点名的四个 `enumLabel` 命名空间之一）⇒ 这里给它自己的名字与运行时清单，
 * 不借用 `CONTENT_STATUS_VALUES`：借了就会让人以为标签也复用 `action.contentStatuses`，
 * 而本轮的裁定是文章评审队列自己一张表。导出物只收 `approved`（`api/article-compose.ts`）。
 *
 * # 🔴 两处「一条命令两件事」（DR-87 把命令面冻在 10 条，DR-86 又要这两个动作）
 * - **方向归档**搭在 `article_direction_add` 上：`ArticleDirectionDraft.id` 有值即就地改
 *   （形状照 `competitor_upsert`：同一条命令兼新增与就地更新）；
 * - **文章评审**搭在 `article_list` 上：`ArticleListQuery.review` 有值即先改后回快照
 *   （形状照 `kb_entry_verify`）。
 * 两处都在 `demo/handlers/article.ts` 的头注释与本文件的 draft 类型上点名，Rust 侧落地时
 * 应当拆成 `article_direction_update` / `article_review`（差异台账 §4g E-64 起）。
 */
import type { AssertComplete, ValuesAreComplete } from './completeness';
import type { KbModule } from './types-kb';

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/**
 * 提示词模板的槽位（6 个，DR-84）。模板正文里写成 `{{brand}}` 这种双花括号记号，
 * 编辑器点 chips 插入（DR-86②），实时预览用**项目真实值**替换。
 *
 * 🔴 每个槽位的取值来源（`components/article-slots.ts` 是唯一裁定点）：
 * `brand` → `Project.brand_name`；`product` / `keyword` / `audience` → 模板自己的 `bindings`；
 * `scenario` → 所属**方向的摘要**（方向本身就是"写给谁、在什么场景下写"那一句话）；
 * `competitor` → 项目竞品清单（`competitor_list`）。取不到值时预览**保留** `{{slot}}` 记号，
 * 让人看见"这一槽还没绑东西"，而不是悄悄替换成空串。
 */
export type ArticleSlot = 'brand' | 'product' | 'keyword' | 'audience' | 'scenario' | 'competitor';

export const ARTICLE_SLOT_VALUES = [
  'brand',
  'product',
  'keyword',
  'audience',
  'scenario',
  'competitor',
] as const satisfies readonly ArticleSlot[];

/** 方向的来源（2 档）：手动新增 / AI 生成（预置池）。 */
export type ArticleDirectionSource = 'manual' | 'generated';

export const ARTICLE_DIRECTION_SOURCE_VALUES = [
  'manual',
  'generated',
] as const satisfies readonly ArticleDirectionSource[];

/** 方向的状态（2 档）：在用 / 已归档（DR-86① 的「归档」动作）。 */
export type ArticleDirectionStatus = 'active' | 'archived';

export const ARTICLE_DIRECTION_STATUS_VALUES = [
  'active',
  'archived',
] as const satisfies readonly ArticleDirectionStatus[];

/**
 * 排期频率（2 档，DR-84）。
 * 🔴 **没有** `monthly` 与 `once`：MVP 只要"每天写一篇 / 每周写一篇"这两档，
 * 多一档就多一张 next_run 的算错面（真后端接 cron 时再议）。
 */
export type ArticleFreq = 'daily' | 'weekly';

export const ARTICLE_FREQ_VALUES = [
  'daily',
  'weekly',
] as const satisfies readonly ArticleFreq[];

/** 文章的来源（2 档，DR-84）：排期跑出来的 / 人在界面上点「立即生成」出来的。 */
export type ArticleSource = 'scheduled' | 'manual';

export const ARTICLE_SOURCE_VALUES = [
  'scheduled',
  'manual',
] as const satisfies readonly ArticleSource[];

/** 文章的评审态（3 档，见文件头「合规」那段为什么不复用 `ContentStatus`）。 */
export type ArticleStatus = 'pending_review' | 'approved' | 'rejected';

export const ARTICLE_STATUS_VALUES = [
  'pending_review',
  'approved',
  'rejected',
] as const satisfies readonly ArticleStatus[];

/** 目标字数下限（模板那一栏；短于一篇能讲清一件事的下限就没有意义）。 */
export const ARTICLE_LENGTH_MIN = 200;
/** 目标字数上限（长于这个量级，模型输出与人工评审都撑不住）。 */
export const ARTICLE_LENGTH_MAX = 5000;
/** `weekday` 的下界（ISO 8601：1 = 周一）。 */
export const ARTICLE_WEEKDAY_MIN = 1;
/** `weekday` 的上界（7 = 周日）。 */
export const ARTICLE_WEEKDAY_MAX = 7;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/** 一个内容方向（"写什么、写给谁"）。 */
export interface ArticleDirection {
  id: string;
  project_id: string;
  title: string;
  /** 一句场景摘要：它同时是模板预览里 `{{scenario}}` 槽位的取值来源。 */
  summary: string;
  source: ArticleDirectionSource;
  status: ArticleDirectionStatus;
  created_at: string;
}

/**
 * `article_direction_add` 的入参（DR-87 只有 10 条命令 ⇒ 这一条兼新增与就地改）。
 * - `id` 为空 ⇒ **新增**：`title` 必填，`source` 由后端固定 `manual`、`status` 固定 `active`；
 * - `id` 有值 ⇒ **就地改**：只改传进来的那几项（归档就是 `{ id, status: 'archived' }`）。
 */
export interface ArticleDirectionDraft {
  id?: string | null;
  title?: string;
  summary?: string | null;
  status?: ArticleDirectionStatus;
}

/** 模板引用的素材（DR-89：只**记录**绑定，demo 不做真拼接注入）。 */
export interface ArticleTemplateBindings {
  /** 引用的产品名（关键词库 / 实体卡里挑出来的字面量）。 */
  product_names: string[];
  /** 引用的关键词（`keyword_list` 里挑出来的字面量）。 */
  keyword_texts: string[];
  /** 目标人群一句话；没填是 `null`。 */
  audience: string | null;
}

/** 一份提示词模板。 */
export interface ArticleTemplate {
  id: string;
  project_id: string;
  direction_id: string;
  name: string;
  /** 提示词正文，含 `{{slot}}` 记号。 */
  prompt_template: string;
  /** 正文里出现过的槽位（去重、按 `ARTICLE_SLOT_VALUES` 的清单序）。 */
  slots: ArticleSlot[];
  bindings: ArticleTemplateBindings;
  /** 引用了哪几个知识库模块（🔴 只记录不拼接，DR-89）。 */
  kb_modules: KbModule[];
  /** 文风（自由文本，是**数据**不是枚举 ⇒ 不进词典）。 */
  style: string;
  /** 目标字数，夹在 `ARTICLE_LENGTH_MIN..MAX`。 */
  length: number;
  created_at: string;
  updated_at: string;
}

/** `article_template_save` 的入参：`id` 为空即新建（照 `SitePatchDraft` 的口径）。 */
export interface ArticleTemplateDraft {
  id?: string | null;
  direction_id: string;
  name: string;
  prompt_template: string;
  slots: ArticleSlot[];
  bindings: ArticleTemplateBindings;
  kb_modules: KbModule[];
  style: string;
  length: number;
}

/** 一条生成排期。 */
export interface ArticleSchedule {
  id: string;
  project_id: string;
  template_id: string;
  freq: ArticleFreq;
  /** `HH:mm`（24 小时制，站点/模型那一族配置同样是字面量时间，不做时区换算）。 */
  time: string;
  /** 1~7（ISO 8601，1 = 周一）；`weekly` 必填，`daily` 恒 `null`（handler 强制）。 */
  weekday: number | null;
  enabled: boolean;
  /** 🔴 demo 里是按 freq + time 算出来的**显示值**，没有定时器真的会到点跑（DR-85）。 */
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number;
}

/** `article_schedule_save` 的入参：`id` 为空即新建。 */
export interface ArticleScheduleDraft {
  id?: string | null;
  template_id: string;
  freq: ArticleFreq;
  time: string;
  weekday?: number | null;
  enabled: boolean;
}

/** 一篇生成出来的文章（进人工评审队列，DR-85 / 规则 6）。 */
export interface Article {
  id: string;
  project_id: string;
  direction_id: string;
  template_id: string;
  /** 由哪条排期跑出来的；界面上点「立即生成」时是 `null`。 */
  schedule_id: string | null;
  source: ArticleSource;
  title: string;
  /** Markdown 原文。🔴 界面按**原文**展示，不渲染成 HTML（数据不是标记，同 FAQ 答案的口径）。 */
  body_markdown: string;
  status: ArticleStatus;
  /** 🔴 demo 里是预置池写死的静态值（规则 9：真后端要数生成物的字数）。 */
  word_count: number;
  generated_at: string;
}

/** 批量评审的请求（搭在 `article_list` 上，见文件头）。 */
export interface ArticleReviewRequest {
  ids: string[];
  status: ArticleStatus;
}

/**
 * `article_list` 的入参。
 * - `status`：状态筛选；契约外的值当**没传**（不误伤成空清单，照 `site_patch` 筛选的口径）；
 * - `review`：有值即先批量改状态、再回**快照**（🔴 这是写操作，见文件头那两处取舍）。
 */
export interface ArticleListQuery {
  status?: ArticleStatus | 'all';
  review?: ArticleReviewRequest | null;
}

// ---------------------------------------------------------------------------
// 编译期完整性网
// ---------------------------------------------------------------------------

export type ArticleSlotValuesComplete = AssertComplete<
  ValuesAreComplete<ArticleSlot, typeof ARTICLE_SLOT_VALUES>
>;
export type ArticleDirectionSourceValuesComplete = AssertComplete<
  ValuesAreComplete<ArticleDirectionSource, typeof ARTICLE_DIRECTION_SOURCE_VALUES>
>;
export type ArticleDirectionStatusValuesComplete = AssertComplete<
  ValuesAreComplete<ArticleDirectionStatus, typeof ARTICLE_DIRECTION_STATUS_VALUES>
>;
export type ArticleFreqValuesComplete = AssertComplete<
  ValuesAreComplete<ArticleFreq, typeof ARTICLE_FREQ_VALUES>
>;
export type ArticleSourceValuesComplete = AssertComplete<
  ValuesAreComplete<ArticleSource, typeof ARTICLE_SOURCE_VALUES>
>;
export type ArticleStatusValuesComplete = AssertComplete<
  ValuesAreComplete<ArticleStatus, typeof ARTICLE_STATUS_VALUES>
>;

/**
 * 文章管理 Article Studio（M6 内容生产）的 IPC wrapper（10 条命令，DR-87）。
 * 拆分理由与依赖方向见 `api/library.ts` 的头注释：`client.ts` 已经过了「单文件约 400 行就拆分」
 * 的软线，同族 wrapper 一律**只 import `client.ts`**，反向不 import ⇒ 依赖图单向。
 *
 * 🔴 这 10 条**只有 demo 侧实现**（Rust 侧本轮零改动）：桌面端点进来会报 `ipc/unknown_command`，
 * 差异台账 §4g E-64 起。
 *
 * ⚠ 组件**不许**直接调 `call`，更不许直接 `invoke`（AGENTS 代码风格：IPC 调用集中在 `src/api/`）。
 */
import { call } from './client';
import type {
  Article,
  ArticleDirection,
  ArticleDirectionDraft,
  ArticleListQuery,
  ArticleSchedule,
  ArticleScheduleDraft,
  ArticleTemplate,
  ArticleTemplateDraft,
} from './types';

// ---------------------------------------------------------------------------
// ① 方向与策略（DR-86①）
// ---------------------------------------------------------------------------

/** 方向清单（含已归档的，界面上按状态标签区分）。 */
export const articleDirectionList = (projectId: string) =>
  call<ArticleDirection[]>('article_direction_list', { project_id: projectId });

/**
 * 新增方向；🔴 带上 `draft.id` 就是**就地改**（DR-86① 的「归档」走这一支）。
 * DR-87 把命令面冻在 10 条、没有 `article_direction_update` ⇒ 写路径搭在既有的写命令上，
 * 形状照 `competitor_upsert`（同一条命令兼新增与就地更新）。`source` 由后端固定 `manual`。
 */
export const articleDirectionAdd = (projectId: string, draft: ArticleDirectionDraft) =>
  call<ArticleDirection>('article_direction_add', { project_id: projectId, ...draft });

/**
 * AI 生成方向。
 * 🔴 demo 不调模型：从 `demo/seed/articles.ts` 的预置池里按标题去重挑一批（AGENTS 规则 9），
 * 产物一律 `source: 'generated'`。挑不出来时回**空数组**而不是错误（照 `kbGenerate`）。
 */
export const articleDirectionGenerate = (projectId: string, targetCount: number) =>
  call<ArticleDirection[]>('article_direction_generate', {
    project_id: projectId,
    target_count: targetCount,
  });

// ---------------------------------------------------------------------------
// ② 提示词模板（DR-86②）
// ---------------------------------------------------------------------------

/** 模板清单（含各自的槽位、绑定与目标字数）。 */
export const articleTemplateList = (projectId: string) =>
  call<ArticleTemplate[]>('article_template_list', { project_id: projectId });

/** 新建或就地改一份模板（`draft.id` 为空即新建），回**那一条**。 */
export const articleTemplateSave = (projectId: string, draft: ArticleTemplateDraft) =>
  call<ArticleTemplate>('article_template_save', { project_id: projectId, template: draft });

/**
 * 批量删模板，回**剩余快照**（认不出的 id 忽略，幂等）。
 * 🔴 连带删掉挂在这些模板上的排期（否则排期表里留一条指向不存在模板的行）；
 * 已生成的文章保留，`template_id` 只是历史引用。
 */
export const articleTemplateDelete = (projectId: string, ids: string[]) =>
  call<ArticleTemplate[]>('article_template_delete', { project_id: projectId, ids });

// ---------------------------------------------------------------------------
// ③ 排期与文章评审队列（DR-86③）
// ---------------------------------------------------------------------------

/** 排期清单（启用的排在前，按 `next_run_at`）。 */
export const articleScheduleList = (projectId: string) =>
  call<ArticleSchedule[]>('article_schedule_list', { project_id: projectId });

/**
 * 新建或就地改一条排期（`draft.id` 为空即新建），回**那一条**。
 * 🔴 demo 没有定时器（DR-85）：`enabled` 只决定 `next_run_at` 算不算得出来，到点不会自己跑。
 */
export const articleScheduleSave = (projectId: string, draft: ArticleScheduleDraft) =>
  call<ArticleSchedule>('article_schedule_save', { project_id: projectId, schedule: draft });

/**
 * 立即跑一次：给 `scheduleId` 是**按排期跑**（记 `last_run_at` / `run_count`，产物 `source: 'scheduled'`），
 * 给 `templateId` 是模板上的**「立即生成」**（不动排期的账，产物 `source: 'manual'`）。
 *
 * 🔴 两者都不调模型：从预置文章池里按标题去重取一篇，产物恒 `pending_review`（规则 6）。
 * 池子用完回**空数组**（不是错误），界面据此提示「预置语料已经用完了」。
 */
export const articleScheduleRun = (
  projectId: string,
  target: { scheduleId?: string; templateId?: string },
) =>
  call<Article[]>('article_schedule_run', {
    project_id: projectId,
    schedule_id: target.scheduleId ?? null,
    template_id: target.templateId ?? null,
  });

/**
 * 文章评审队列。
 *
 * 🔴 `query.review` 有值时这是一次**写操作**：先批量改状态、再回**快照**
 * （形状照 `kbEntryVerify`）。DR-87 的 10 条命令里没有 `article_review` / `article_update_status`，
 * 而 DR-86③ 要求「批量通过」⇒ 写路径搭在这条唯一的文章级命令上；Rust 侧落地时应当拆开
 * （差异台账 §4g E-64）。不传 `review` 时它就是纯读。
 */
export const articleList = (projectId: string, query: ArticleListQuery = {}) =>
  call<Article[]>('article_list', {
    project_id: projectId,
    status: query.status ?? 'all',
    review: query.review ?? null,
  });

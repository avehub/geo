/**
 * M6 GEO 行动中心的 4 条命令（`action_*` / `content_*`）的内存实现。
 *
 * # 🔴 处方是写死的，文稿是预置的（AGENTS 规则 9）
 * - Top-N 处方在真后端由诊断结果排序生成；demo 只端出 `seed/actions.ts` 那 10 条，
 *   **不重排、不新增**（`action_update_status` 只翻状态）；
 * - `content_generate` **不调模型**：它按模板种类从 `seed/contents.ts` 取一份预置演示文稿。
 *   走查的是**产物形态**（章节结构、Markdown 排版、审核态、导出格式），不是文笔。
 *
 * # 归因卡片是静态的
 * `AttributionCard` 的四个 before/after 数字与两轮 `DiagnosisOverview` 逐一对齐（判据在
 * `demo/seed.test.ts`）。demo 里翻一条处方状态**不会**让归因数字变化——真后端的归因要靠
 * 复测轮的数据，而 demo 的复测轮是种子。
 *
 * # 合规（AGENTS 规则 6）
 * 新生成的文稿一律 `pending_review`，且 `compliance_checked: false`：demo 没有合规扫描器，
 * 把它写成 `true` 就是假声明。界面上因此显示「演示模式未执行合规扫描」（词典
 * `action.contents.complianceUnchecked`）。种子里那两份"已经生成过"的文稿是 `true`
 * ——它们是演示数据，代表真后端扫过之后的样子。
 */
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import { actionById, actionsOf, contentById, contentsOf, getDemoDb } from '../db';
import type {
  ActionBoard,
  ActionStatus,
  AttributionCard,
  GeneratedContent,
} from '../../api/types';
import { ACTION_STATUS_VALUES } from '../../api/types';
import { SEED_ATTRIBUTION_CARDS, SEED_CONTENT_TEMPLATES } from '../seed/actions';
import { SEED_CONTENT_BODIES, SEED_CONTENT_TITLES } from '../seed/contents';
import { asContentStatus, asString, cleanOptional, newId, nowIso, requireProject } from './shared';

/** 处方状态：契约外的值收敛成 `todo`（最保守：不声称已经做完）。 */
function asActionStatus(value: unknown): ActionStatus {
  const values = ACTION_STATUS_VALUES as readonly string[];
  return values.includes(asString(value)) ? (value as ActionStatus) : 'todo';
}

/**
 * `action_board`：行动中心首屏（处方 + 归因卡片 + 已生成文稿 + 模板目录）。
 *
 * 一次往返拿全四块，避免四个 loading 打架——与 `collection_board` / `fact_check_list` 同一个取舍。
 */
export const actionBoard: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const attribution: AttributionCard[] = structuredClone(
    SEED_ATTRIBUTION_CARDS.filter((card) => card.project_id === projectId),
  );
  const board: ActionBoard = {
    actions: structuredClone(actionsOf(db, projectId)),
    attribution,
    contents: structuredClone(contentsOf(db, projectId)),
    templates: structuredClone(SEED_CONTENT_TEMPLATES),
  };
  return board;
};

/**
 * `action_update_status`：翻一条处方的执行状态（M6 验收点名的「执行跟踪」）。
 *
 * - 翻成 `done` 时盖 `completed_at`（已经盖过的**不覆盖**：重复点击不该把完成时间推后）；
 * - 翻回 `todo` / `in_progress` 时清掉 `completed_at`；
 * - `updated_at` 每次都刷新（界面上显示"最后更新"）。
 */
export const actionUpdateStatus: DemoHandler = (args) => {
  const db = getDemoDb();
  const actionId = asString(args.action_id);
  const action = actionById(db, actionId);
  if (!action) {
    throw demoError('validation/failed', {
      field: 'action_id',
      reason: 'invalid_id',
      value: actionId,
    });
  }

  const status = asActionStatus(args.status);
  // 🔴 一次写操作只取**一个**时间戳：`completed_at` 与 `updated_at` 语义上是同一刻
  // （同一次点击之后，界面上的「完成时间」与「最后更新」必须一致）。分两次 `nowIso()`
  // 跨毫秒就会自相矛盾——判据 `handlers/action.test.ts` 的「翻成 done ⇒ 盖 completed_at
  // 并刷新 updated_at」会**偶发**红。与 `handlers/project.ts`、`handlers/entity-card.ts` 同口径。
  const stamp = nowIso();
  action.status = status;
  if (status === 'done') {
    action.completed_at ??= stamp;
  } else {
    action.completed_at = null;
  }
  action.updated_at = stamp;

  return structuredClone(action);
};

/**
 * `content_generate`：按模板生成一份 GEO 友好文稿（demo 取预置演示文稿，见文件头）。
 *
 * `action_id` 可选：从某条处方的「生成可交付物」入口进来时带上，界面上据此把文稿挂回处方。
 * 带了一个认不出的 id ⇒ `validation/failed`（不静默丢弃：那会让"挂到哪条处方"变成猜）。
 */
export const contentGenerate: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const templateId = asString(args.template_id);
  const template = SEED_CONTENT_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template) {
    throw demoError('validation/failed', {
      field: 'template_id',
      reason: 'invalid_id',
      value: templateId,
    });
  }

  const actionId = cleanOptional(args.action_id);
  // 🔴 关联对象必须同时属于本项目：只查"存在"会把 A 的处方挂到 B 的文稿上，
  // 行动中心随后会显示一个不属于本项目的裸 id（同 `site_patch_generate` 的口径）。
  const action = actionId === null ? undefined : actionById(db, actionId);
  if (actionId !== null && (action === undefined || action.project_id !== projectId)) {
    throw demoError('validation/failed', {
      field: 'action_id',
      reason: 'invalid_id',
      value: actionId,
    });
  }

  const stamp = nowIso();
  const content: GeneratedContent = {
    id: newId(),
    project_id: projectId,
    action_id: actionId,
    template_id: template.id,
    title: SEED_CONTENT_TITLES[template.kind],
    body_markdown: SEED_CONTENT_BODIES[template.kind],
    status: 'pending_review',
    compliance_checked: false,
    export_formats: [...template.export_formats],
    created_at: stamp,
    updated_at: stamp,
  };

  db.contents.push(content);
  return structuredClone(content);
};

/**
 * `content_update_status`：人工审核（通过 / 退回 / 打回待审）。
 *
 * 只翻状态与 `updated_at`：文稿正文在 demo 里不可编辑（真后端的编辑器是 M6 之后的事）。
 * `note` 收下来但**不进 DTO**——`GeneratedContent` 没有备注字段，凭空加一个就是造契约。
 */
export const contentUpdateStatus: DemoHandler = (args) => {
  const db = getDemoDb();
  const contentId = asString(args.content_id);
  const content = contentById(db, contentId);
  if (!content) {
    throw demoError('validation/failed', {
      field: 'content_id',
      reason: 'invalid_id',
      value: contentId,
    });
  }

  content.status = asContentStatus(args.status);
  content.updated_at = nowIso();

  return structuredClone(content);
};

/**
 * M6 文章管理 Article Studio：**方向 + 提示词模板**那 6 条命令
 * （`article_direction_list` / `_add` / `_generate` / `article_template_list` / `_save` / `_delete`）。
 * 排期与评审队列那 4 条在 `handlers/article-schedule.ts`（单文件约 400 行的软线，AGENTS「代码风格」，
 * 拆分口径照 `handlers/site.ts` / `site-patch.ts`）。
 * 设计规格 `docs/superpowers/specs/2026-10-10-kb-redesign-and-article-studio-design.md`（DR-83 … DR-89）。
 *
 * 🔴 **Rust 侧没有对应实现**：这 10 条与 M3–M7 那 20 条、Plan B 那 2 条、M1.5 那 10 条、
 * 站点接入那 11 条、知识库那 6 条同族——只有 demo 侧接线，桌面端点进来会报
 * `ipc/unknown_command`（差异台账 §4g E-64 起）。
 *
 * # 🔴 demo 不做的事（本文件这一半）
 * ① **不调模型**：`article_direction_generate` 逐字端出 `seed/articles.ts` 的
 *   `SEED_ARTICLE_DIRECTION_POOL`，按标题去重，池子用完回**空数组**而不是错误；
 * ② **不做真拼接注入**（DR-89）：`bindings` / `kb_modules` 只**记录**这份模板引用了什么，
 *   预览里的槽位替换发生在**前端**（`components/article-slots.ts`）。
 *
 * # 🔴 一处「一条命令两件事」（DR-87 把命令面冻在 10 条，DR-86① 又要「归档」这个动作）
 * **方向归档**搭在 `article_direction_add` 上：`id` 有值即就地改（形状照 `competitor_upsert`）。
 * 真后端落地时应当拆成 `article_direction_update`（差异台账 §4g E-64）。
 * 另一半取舍（**文章评审**搭在 `article_list` 上）见 `article-schedule.ts` 的头注释。
 *
 * # 三种照抄既有 handler 的后端语义
 * - **返回形状不统一**（刻意）：`*_list` 回清单、`*_add` / `*_save` 回**新增或那一条**、
 *   `_delete` 回**剩余快照**；删除幂等（认不出的 id 忽略，照 `keyword_delete`）；
 * - **"点名"字段认不出就报错、不收敛**：`direction_id` 决定"这份模板挂在哪个方向下"，
 *   悄悄换成合法值等于替用户改了归属（照 `site.ts` 的 `requireChannelKind`）；
 * - **数据字段一律收敛或夹回区间**：`slots` / `kb_modules` 只留契约内的值（照 `requestedModules`），
 *   `length` 夹进 `ARTICLE_LENGTH_MIN..MAX`（照素材库 `priority`：意向值越界夹回来比拒存更贴合编辑）。
 *
 * # 语言约束（门禁 7 / §B-11）
 * 本目录非注释 CJK 必须为 0 ⇒ 字符串常量全是 ASCII；方向与模板的中文逐字来自 `seed/articles.ts`。
 */
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import {
  articleDirectionById,
  articleDirectionsOf,
  articleTemplateById,
  articleTemplatesOf,
  getDemoDb,
} from '../db';
import { SEED_ARTICLE_DIRECTION_POOL } from '../seed/articles';
import type {
  ArticleDirection,
  ArticleSlot,
  ArticleTemplate,
  ArticleTemplateBindings,
  KbModule,
} from '../../api/types';
import {
  ARTICLE_DIRECTION_STATUS_VALUES,
  ARTICLE_LENGTH_MAX,
  ARTICLE_LENGTH_MIN,
  ARTICLE_SLOT_VALUES,
  KB_MODULE_VALUES,
  LIBRARY_GENERATE_MAX,
  LIBRARY_GENERATE_MIN,
} from '../../api/types';
import {
  asRecord,
  asString,
  asStringList,
  clampInt,
  cleanOptional,
  newId,
  nowIso,
  requireProject,
} from './shared';

/** 槽位入参：只留契约内的值，去重后按 `ARTICLE_SLOT_VALUES` 的**清单序**排（DR-84）。 */
function slotsOf(value: unknown): ArticleSlot[] {
  const allowed = ARTICLE_SLOT_VALUES as readonly string[];
  const picked = new Set(asStringList(value).filter((slot) => allowed.includes(slot)));
  return ARTICLE_SLOT_VALUES.filter((slot) => picked.has(slot));
}

/** 知识库模块入参：只留契约内的值、去重，**保持勾选顺序**（顺序在这里没有语义）。 */
function kbModulesOf(value: unknown): KbModule[] {
  const allowed = KB_MODULE_VALUES as readonly string[];
  return [...new Set(asStringList(value).filter((module) => allowed.includes(module)))] as KbModule[];
}

/** 绑定入参：三段各自 trim + 去空；`audience` 空串落 `null`（DR-84）。 */
function bindingsOf(value: unknown): ArticleTemplateBindings {
  const draft = asRecord(value);
  const texts = (raw: unknown) =>
    asStringList(raw)
      .map((item) => item.trim())
      .filter((item) => item !== '');
  return {
    product_names: texts(draft.product_names),
    keyword_texts: texts(draft.keyword_texts),
    audience: cleanOptional(draft.audience),
  };
}

// ---------------------------------------------------------------------------
// ① 方向与策略（DR-86①）
// ---------------------------------------------------------------------------

/** `article_direction_list`：方向清单（含已归档的，界面上按状态标签区分）。 */
export const articleDirectionList: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));
  return structuredClone(articleDirectionsOf(db, project.id));
};

/**
 * `article_direction_add`：新增方向；🔴 带 `id` 就是**就地改**（DR-86① 的「归档 / 恢复」走这一支）。
 *
 * 新增时 `source` 固定 `manual`、`status` 固定 `active`：前端自称"AI 生成"或"已归档"都不算数
 * （照 `keyword_add` 的 source 口径——"这条怎么来的"是后端的账，不是入参）。
 * 就地改时**没传的字段保持原值**（归档只翻 `status`，不该把标题抹掉）。
 */
export const articleDirectionAdd: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));
  const id = asString(args.id).trim();

  if (id !== '') {
    const found = articleDirectionById(db, id);
    if (found === undefined || found.project_id !== project.id) {
      throw demoError('validation/failed', { field: 'direction_id', reason: 'invalid_id', value: id });
    }
    const title = asString(args.title).trim();
    if (title !== '') found.title = title;
    if (typeof args.summary === 'string') found.summary = asString(args.summary).trim();
    const status = asString(args.status);
    if ((ARTICLE_DIRECTION_STATUS_VALUES as readonly string[]).includes(status)) {
      found.status = status as ArticleDirection['status'];
    }
    return structuredClone(found);
  }

  const title = asString(args.title).trim();
  if (title === '') {
    throw demoError('validation/failed', { field: 'direction_title', reason: 'required' });
  }
  const created: ArticleDirection = {
    id: newId(),
    project_id: project.id,
    title,
    summary: asString(args.summary).trim(),
    source: 'manual',
    status: 'active',
    created_at: nowIso(),
  };
  db.articleDirections.push(structuredClone(created));
  return created;
};

/**
 * `article_direction_generate`：🔴 **不调模型**，从预置池里按标题去重挑一批（差异台账 §4g E-66）。
 *
 * 挑选规则只有两条：① 跳过库里**标题完全相同**的；② 按池子里的顺序取前 `target_count` 条
 * （夹在 `LIBRARY_GENERATE_MIN..MAX`，复用素材库那一档，不新造常量）。
 * 挑不出来就回**空数组**（不是错误，照 `kb_generate`）。产物一律 `generated` + `active`。
 */
export const articleDirectionGenerate: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));

  const target = clampInt(args.target_count, LIBRARY_GENERATE_MIN, LIBRARY_GENERATE_MAX);
  const existing = new Set(articleDirectionsOf(db, project.id).map((row) => row.title));
  const picked = SEED_ARTICLE_DIRECTION_POOL.filter((row) => !existing.has(row.title)).slice(0, target);

  const stamp = nowIso();
  const added: ArticleDirection[] = picked.map((row) => ({
    id: newId(),
    project_id: project.id,
    title: row.title,
    summary: row.summary,
    source: 'generated',
    status: 'active',
    created_at: stamp,
  }));

  db.articleDirections.push(...structuredClone(added));
  return added;
};

// ---------------------------------------------------------------------------
// ② 提示词模板（DR-86②）
// ---------------------------------------------------------------------------

/** `article_template_list`：模板清单（含各自的槽位、绑定与目标字数）。 */
export const articleTemplateList: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));
  return structuredClone(articleTemplatesOf(db, project.id));
};

/**
 * `article_template_save`：新建或就地改一份模板，回**那一条**（照 `site_patch_save`）。
 *
 * 🔴 `direction_id` 认不出就报错、不收敛（见文件头）。
 * 🔴 就地改时 `id` / `project_id` / `created_at` 取库里那份（`id` 是定位符不是可改字段）。
 */
export const articleTemplateSave: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));
  const draft = asRecord(args.template);

  const name = asString(draft.name).trim();
  if (name === '') {
    throw demoError('validation/failed', { field: 'template_name', reason: 'required' });
  }
  const prompt = asString(draft.prompt_template).trim();
  if (prompt === '') {
    throw demoError('validation/failed', { field: 'prompt_template', reason: 'required' });
  }
  const directionId = asString(draft.direction_id).trim();
  const direction = articleDirectionById(db, directionId);
  if (direction === undefined || direction.project_id !== project.id) {
    throw demoError('validation/failed', {
      field: 'direction_id',
      reason: 'invalid_id',
      value: directionId,
    });
  }

  const stamp = nowIso();
  const shared = {
    project_id: project.id,
    direction_id: directionId,
    name,
    prompt_template: prompt,
    slots: slotsOf(draft.slots),
    bindings: bindingsOf(draft.bindings),
    kb_modules: kbModulesOf(draft.kb_modules),
    style: asString(draft.style).trim(),
    length: clampInt(draft.length, ARTICLE_LENGTH_MIN, ARTICLE_LENGTH_MAX),
  };

  const existing = articleTemplateById(db, asString(draft.id).trim());
  if (existing !== undefined && existing.project_id === project.id) {
    Object.assign(existing, shared, { updated_at: stamp });
    return structuredClone(existing);
  }

  const created: ArticleTemplate = { id: newId(), ...shared, created_at: stamp, updated_at: stamp };
  db.articleTemplates.push(structuredClone(created));
  return created;
};

/**
 * `article_template_delete`：批量删模板，回**剩余快照**（照 `keyword_delete`）；认不出的 id 忽略。
 *
 * 🔴 **连带删掉挂在这些模板上的排期**：留着就会在排期表里出现一条指向不存在模板的行
 * （界面上只能显示裸 id）。🔴 已生成的文章**保留**：`template_id` 只是历史引用，
 * 删模板不该把评审队列里的稿子一起抹掉。
 */
export const articleTemplateDelete: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.project_id));
  const ids = new Set(asStringList(args.ids));

  const doomed = new Set(
    db.articleTemplates
      .filter((row) => row.project_id === project.id && ids.has(row.id))
      .map((row) => row.id),
  );
  db.articleTemplates = db.articleTemplates.filter((row) => !doomed.has(row.id));
  db.articleSchedules = db.articleSchedules.filter(
    (row) => !(row.project_id === project.id && doomed.has(row.template_id)),
  );

  return structuredClone(articleTemplatesOf(db, project.id));
};

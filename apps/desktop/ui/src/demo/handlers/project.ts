/**
 * M1 `project_*` 里**项目自身**那 6 条命令的内存实现（Task 12 · 简报 §B-1）。
 * 导入导出与两条 CSV 在 `./project-transfer.ts`（B-1 的 400 行线：拆开后两份都在 250 行以内）。
 *
 * # 与真实后端的关系
 * 每条 handler 的注释都指向它的 Rust 真值源（`apps/desktop/src-tauri/src/services/project_service.rs`、
 * `crates/geo-store/src/repo/project.rs`）：**行为同构、实现不同**——真后端走 SQLite 仓储，
 * 这里走 `getDemoDb()` 的内存数组，排序与幂等性一律照仓储层的 `ORDER BY` / `DELETE` 语义。
 *
 * # 🔴 刻意不移植的东西（AGENTS 规则 9 / 简报 §B-2）
 * - `ProjectDraft::validate` / `validate_project`：品牌名长度、别名条数、竞品上限那套**领域校验**
 *   demo 一律不判（§B-2③：A-4 / A-6 真值表之外的输入全部放行）；
 * - `fields_from_draft`：真后端建项时会从草稿推出**初始实体卡**，demo 不造卡
 *   （`entity_card_get` 回 `null`）——实体卡这条路交给种子卡与 `entity_card_autobuild` 演。
 *
 * # 返回一律是**副本**
 * handler 交出去的对象都经 `structuredClone`：真后端跨 IPC 本来就是序列化副本，
 * 而直接把库里的引用交出去会让界面的一次误改**静默改掉库**（「刷新即重置」也会被打破）。
 */
import type { Project, ProjectDetail } from '../../api/types';
import type { DemoHandler } from '../types';
import {
  assetsOf,
  competitorsOf,
  entityCardOf,
  getDemoDb,
  promptSetCountOf,
  promptSetsOf,
} from '../db';
import {
  asBoolean,
  asIndustry,
  asLanguage,
  asRecord,
  asRecordList,
  asString,
  asStringList,
  cleanOptional,
  makeAsset,
  makeCompetitor,
  matchesTagsLike,
  newId,
  nowIso,
  requireProject,
} from './shared';

/** 建项时自有页面资产的 kind（真值源 `crates/geo-domain/src/project.rs:302`-`323`）。 */
const OWNED_PAGE = 'owned_page';

/** `project_create`：草稿 → 项目 + 竞品 + 自有页面资产（真值源 project_service.rs:66 的 create_draft）。 */
export const projectCreate: DemoHandler = (args) => {
  const db = getDemoDb();
  const draft = asRecord(args.draft);
  const now = nowIso();
  const brandName = asString(draft.brand_name).trim();
  const project: Project = {
    id: newId(),
    // 真值源 project.rs:269：name 留空时回落成品牌名。
    name: cleanOptional(draft.name) ?? brandName,
    brand_name: brandName,
    aliases: asStringList(draft.aliases),
    website: cleanOptional(draft.website),
    // ⚠ 有据偏离：真后端 region 为空时回落中文常量「全国」（project.rs:275），
    // 而本目录非注释 CJK 必须为 0（门禁 7）⇒ demo 不做这个回落，留空。
    region: asString(draft.region).trim(),
    language: asLanguage(draft.language),
    industry: asIndustry(draft.industry),
    industry_label: cleanOptional(draft.industry_label),
    tags: asStringList(draft.tags),
    status: 'active',
    archived_at: null,
    created_at: now,
    updated_at: now,
  };
  db.projects.push(project);

  // 竞品：position 就是草稿里的顺序（project.rs:285-299）。
  asRecordList(draft.competitors).forEach((item, index) => {
    db.competitors.push(makeCompetitor(project.id, item, index, now));
  });
  // 自有页面资产：官网首页 1 条 + 每个非空 core_page 1 条（project.rs:300-324）。
  if (project.website) {
    // ⚠ 有据偏离：真后端给这条资产一个中文标题（project.rs:306），门禁 7 不许 ⇒ 标题留空。
    db.assets.push(makeAsset(project.id, OWNED_PAGE, project.website, null, null, now));
  }
  for (const page of asStringList(draft.core_pages)) {
    if (page.trim() === '') continue;
    db.assets.push(makeAsset(project.id, OWNED_PAGE, page, null, null, now));
  }
  return structuredClone(project);
};

/**
 * `project_list`：过滤 + 排序（真值源 repo/project.rs:125 的 list）。
 *
 * - `include_archived` 缺省 false ⇒ 默认只看未归档（界面上的「显示已归档」复选框）；
 * - `query` 同时模糊匹配项目名与品牌名；SQLite 的 `LIKE` 对 ASCII 大小写不敏感、
 *   中文按原样匹配 ⇒ 这里用 `toLowerCase()` 复现同一口径；
 * - `tags` 是 **AND** 语义（需同时含全部给定标签），且每个标签的匹配是 `repo/project.rs:146-153`
 *   那条 `tags LIKE '%"<json(tag)>"%' ESCAPE '\'` 的镜像（ASCII 大小写不敏感的**子串**匹配，
 *   不是成员判定）⇒ 走 `shared.matchesTagsLike`，判据在 `project.test.ts` 的 #30②；
 * - 排序 `updated_at DESC, id ASC`。
 */
export const projectList: DemoHandler = (args) => {
  const db = getDemoDb();
  const filter = asRecord(args.filter);
  const includeArchived = asBoolean(filter.include_archived);
  const query = asString(filter.query).trim().toLowerCase();
  const tags = asStringList(filter.tags);

  return structuredClone(
    db.projects
      .filter((project) => includeArchived || project.status !== 'archived')
      .filter(
        (project) =>
          query === '' ||
          project.name.toLowerCase().includes(query) ||
          project.brand_name.toLowerCase().includes(query),
      )
      .filter((project) => tags.every((tag) => matchesTagsLike(project.tags, tag)))
      .sort(
        (left, right) =>
          Date.parse(right.updated_at) - Date.parse(left.updated_at) ||
          left.id.localeCompare(right.id),
      ),
  );
};

/** `project_get`：一次拿全详情页要的东西（真值源 project_service.rs:104 的 detail）。 */
export const projectGet: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.id));
  const card = entityCardOf(db, project.id);
  const detail: ProjectDetail = {
    project: structuredClone(project),
    entity_card: card ? structuredClone(card) : null,
    competitors: structuredClone(competitorsOf(db, project.id)),
    assets: structuredClone(assetsOf(db, project.id)),
    // 题库只**读**，且经 §B-12 的 helper（set 级真值 = db.promptSets）。
    prompt_set_count: promptSetCountOf(db, project.id),
  };
  return detail;
};

/**
 * `project_update`：只覆盖**可编辑字段**（真值源 project_service.rs:119-143）。
 * `id` / `status` / `archived_at` / `created_at` 一律以库里那行为准——
 * 更新不是归档的旁门，界面上改标签也不可能顺手把项目改成未归档。
 */
export const projectUpdate: DemoHandler = (args) => {
  const db = getDemoDb();
  const input = asRecord(args.project);
  const project = requireProject(db, asString(input.id));

  project.name = asString(input.name).trim();
  project.brand_name = asString(input.brand_name).trim();
  project.aliases = asStringList(input.aliases);
  project.website = cleanOptional(input.website);
  project.region = asString(input.region).trim();
  project.language = asLanguage(input.language);
  project.industry = asIndustry(input.industry);
  project.industry_label = cleanOptional(input.industry_label);
  project.tags = asStringList(input.tags);
  project.updated_at = nowIso();
  return structuredClone(project);
};

/**
 * `project_archive`：归档 / 取消归档（真值源 repo/project.rs:208 的 set_status）。
 * `set_status` 同时也写 `updated_at`，所以归档会把项目顶到列表最前——这是后端既有行为，照抄。
 */
export const projectArchive: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.id));
  const archived = asBoolean(args.archived);
  const now = nowIso();

  project.status = archived ? 'archived' : 'active';
  project.archived_at = archived ? now : null;
  project.updated_at = now;
  return structuredClone(project);
};

/**
 * `project_delete`：删项目 + **六表级联**（简报 §B-12）。
 *
 * 真后端靠 SQLite 外键的 `ON DELETE CASCADE`（`geo-store` 迁移），demo 是内存数组 ⇒ 显式清：
 * `projects` / `competitors` / `assets` / `entityCards` / `revisions` / 题库
 * （`promptSets` **与**归一化的 `promptItems` 都要清，否则留下 `set_id` 指向不存在题库的孤儿行）。
 * **幂等**：行不存在也返回 `Ok`（真值源 repo/project.rs:199）。
 */
export const projectDelete: DemoHandler = (args) => {
  const db = getDemoDb();
  const id = asString(args.id);
  // 先记住题库 id：归一化视图 `promptItems` 只有 `set_id`，没有 `project_id`。
  const setIds = new Set(promptSetsOf(db, id).map((set) => set.id));

  db.projects = db.projects.filter((row) => row.id !== id);
  db.competitors = db.competitors.filter((row) => row.project_id !== id);
  db.assets = db.assets.filter((row) => row.project_id !== id);
  db.entityCards = db.entityCards.filter((row) => row.project_id !== id);
  db.revisions = db.revisions.filter((row) => row.project_id !== id);
  db.promptSets = db.promptSets.filter((row) => row.project_id !== id);
  db.promptItems = db.promptItems.filter((item) => !setIds.has(item.set_id));
  return undefined;
};

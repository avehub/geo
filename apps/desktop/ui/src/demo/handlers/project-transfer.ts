/**
 * M1 的**导入导出** 4 条命令（Task 12 · 简报 §B-1 的再拆：`project.ts` 会顶到 400 行线）。
 * 真值源 `apps/desktop/src-tauri/src/services/project_transfer.rs`（下称 transfer）。
 *
 * # 🔴 两条必须逐字同构的契约（简报 A-5）
 * ① `EXPORT_FORMAT_VERSION`：demo 必须用同一个字面量，但**不许 import 后端**（跨语言）
 *   ⇒ 这里独立写死一份，注释指向 transfer:19；漂了 `project.test.ts` 与 `m1-contract.test.ts` 会红。
 *   （跨语言镜像常量的收口口径：`;` 那一支已经收成一份——全仓只有 `handlers/shared.ts` 的
 *   `CSV_TAG_SEPARATOR`，「不许再长出第二份本地镜像」的判据在 `m1-contract.test.ts`。）
 * ② `counts` **恰好 7 个键**（transfer:207-214），且导入**绝不覆盖已有项目**（transfer 头注释第 4 行）
 *   ⇒ 一律新 id，同一份导出可以反复导入成多个副本。
 *
 * # 🔴 刻意不移植的东西（AGENTS 规则 9 / 简报 §B-2）
 * - `validate_project`：导入路径上的项目字段校验属领域规则，demo 不判；
 * - `PromptSet::refresh()` 里的**分级重算**（`sample_size_grade`）⇒ 分级阈值是领域算法，
 *   demo 一律继承载荷里的静态值（异常表 E-7），只重排 `set_id` / `position` 这类**归属信息**。
 * - ⚠ `content_hash` 是**另一半，口径相反**：它不算领域算法（demo 侧是 `demoContentHash` 那个
 *   占位派生值），所以导入不再自带一份写逻辑，而是走**唯一**的 item 级写入口 `writePromptItems`
 *   由它定稿——与 transfer:182-183 的 `reindex()` + `refresh()` 同形，也堵掉了「内嵌副本与
 *   归一化清单各是一份克隆、可以各漂一边」那个洞。
 *
 * # `exported_at` 与 `created_at`
 * `exported_at = now`（transfer:66）：这是**运行时产物**，行为正确而不是不确定性漏洞；
 * 测试只断言它是合法 RFC3339、不断言具体值（简报 §B-7）。
 */
import type {
  EntityCard,
  EntityCardRevision,
  FieldStatus,
  ImportReport,
  Project,
  ProjectExport,
  PromptItem,
  PromptSet,
} from '../../api/types';
import { ASSET_CSV_HEADER, COMPETITOR_CSV_HEADER } from '../../api/constants';
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import {
  assetsOf,
  competitorsOf,
  entityCardOf,
  getDemoDb,
  promptSetsOf,
  promptSetWithItems,
  revisionsOf,
} from '../db';
import { reindexed, writePromptItems } from './prompt';
import {
  CSV_TAG_SEPARATOR,
  asEnumValue,
  asFieldStatus,
  asIndustry,
  asLanguage,
  asNumber,
  asRecord,
  asRecordList,
  asString,
  asStringList,
  cleanOptional,
  makeAsset,
  makeCompetitor,
  newId,
  nowIso,
  requireProject,
  toCsv,
} from './shared';

/** 真值源 transfer:19。跨语言无法 import ⇒ 第二份副本，注释即钉子（见文件头 ①）。 */
/**
 * 🔴 demo 侧**只许有这一份**副本（#28）：跨语言 import 不可能，但份数可以收、漂移可以钉。
 * 判据在 `handlers/m1-contract.test.ts` 的 #28（生产源码里这个字面量恰好一处，且逐字等于
 * 运行时从 `project_transfer.rs:19` 解析出来的真值源）；测试侧一律走 `test/truth-source.ts`，
 * 不再各自手抄。
 */
export const EXPORT_FORMAT_VERSION = 'geo-project-export-v1';
/** `project_export`：项目全量导出（JSON）。竞品、资产、实体卡、修订与题库快照一起走。 */
export const projectExport: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.id));
  const card = entityCardOf(db, project.id);
  const exported: ProjectExport = {
    format_version: EXPORT_FORMAT_VERSION,
    project: structuredClone(project),
    entity_card: card ? structuredClone(card) : null,
    revisions: structuredClone(revisionsOf(db, project.id)),
    competitors: structuredClone(competitorsOf(db, project.id)),
    assets: structuredClone(assetsOf(db, project.id)),
    // 题库经 §B-12 的 helper 读：set 级取 `promptSets`、items 取归一化的 `promptItems`，
    // 所以导出**永远**不会带上过期的内嵌副本。
    prompt_sets: promptSetsOf(db, project.id).map((set) =>
      structuredClone(promptSetWithItems(db, set)),
    ),
    exported_at: nowIso(),
  };
  return exported;
};

/** `project_import`：所有 ID 重新生成 ⇒ 绝不覆盖已有项目（transfer:72）。 */
export const projectImport: DemoHandler = (args) => {
  const db = getDemoDb();
  const payload = parsePayload(asString(args.payload));
  const receivedVersion = asString(payload.format_version);
  if (receivedVersion !== EXPORT_FORMAT_VERSION) {
    // A-5：真值源 transfer:83-85，params 三键，value 是**收到的**版本号。
    throw demoError('validation/failed', {
      field: 'format_version',
      reason: 'invalid_format',
      value: receivedVersion,
    });
  }

  const now = nowIso();
  const projectId = newId();
  const source = asRecord(payload.project);
  const project: Project = {
    id: projectId,
    name: asString(source.name),
    brand_name: asString(source.brand_name),
    aliases: asStringList(source.aliases),
    website: cleanOptional(source.website),
    region: asString(source.region),
    language: asLanguage(source.language),
    industry: asIndustry(source.industry),
    industry_label: cleanOptional(source.industry_label),
    tags: asStringList(source.tags),
    status: source.status === 'archived' ? 'archived' : 'active',
    archived_at: cleanOptional(source.archived_at),
    // created_at 沿用导出里的那个（transfer:117），只有 updated_at 换成 now。
    created_at: asString(source.created_at) || now,
    updated_at: now,
  };

  // 竞品：position 重排成 0..n，并留下 旧 id → 新 id 的映射给题库的 competitor_ids 用（transfer:122-134）。
  const competitorIds = new Map<string, string>();
  const competitors = asRecordList(payload.competitors).map((raw, position) => {
    const row = makeCompetitor(projectId, raw, position, now);
    competitorIds.set(asString(raw.id), row.id);
    return row;
  });
  const assets = asRecordList(payload.assets).map((raw) =>
    makeAsset(projectId, raw.kind, raw.url, raw.title, raw.note, now),
  );
  const card =
    typeof payload.entity_card === 'object' && payload.entity_card !== null
      ? importEntityCard(
          asRecord(payload.entity_card),
          projectId,
          earlierOf(project.created_at, now),
          now,
        )
      : null;
  const revisions: EntityCardRevision[] = asRecordList(payload.revisions).map((raw) => ({
    id: newId(),
    project_id: projectId,
    field_path: asString(raw.field_path),
    old_value: raw.old_value ?? null,
    new_value: raw.new_value ?? null,
    status: asFieldStatus(raw.status),
    note: cleanOptional(raw.note),
    edited_at: asString(raw.edited_at) || now,
  }));

  // 题库：换 set id / item id，并把条目的 competitor_ids 跟着竞品一起换（映射不到的直接丢弃，
  // 真值源 transfer:151-161 —— 不重映射就会留下指向旧项目竞品的悬挂 id）。
  const importedSets: PromptSet[] = [];
  /** 每个 set 构造好的条目，写库阶段交给 `writePromptItems`（构造阶段一律不动库）。 */
  const pendingItems: PromptItem[][] = [];
  for (const raw of asRecordList(payload.prompt_sets)) {
    const setId = newId();
    const items = asRecordList(raw.items).map((item, position) => ({
      id: newId(),
      set_id: setId,
      text: asString(item.text),
      intent: asEnumValue<PromptItem['intent']>(item.intent),
      weight: asNumber(item.weight),
      group_name: cleanOptional(item.group_name),
      tags: asStringList(item.tags),
      source: asEnumValue<PromptItem['source']>(item.source),
      competitor_ids: asStringList(item.competitor_ids)
        .map((oldId) => competitorIds.get(oldId))
        .filter((mapped): mapped is string => mapped !== undefined),
      repeat_count: asNumber(item.repeat_count),
      position,
    }));
    importedSets.push({
      id: setId,
      project_id: projectId,
      version: asNumber(raw.version),
      label: asString(raw.label),
      // 🔴 内嵌视图这里**先留空**：两份视图（内嵌副本给 DTO、归一化清单给 item 级真值）
      // 一律由写库阶段的 `writePromptItems` 同时填 ⇒ 存的是同一批对象引用，不可能各漂一边。
      items: [],
      // `content_hash` 的初值取载荷里那份，只为构造阶段不留空串；定稿值由写入口按 demo 的
      // 占位算法算出（真值源 transfer:182-183 的 `reindex()` + `refresh()` 同样重算它）。
      content_hash: asString(raw.content_hash),
      engine_scope: asStringList(raw.engine_scope),
      metric_spec_version: asString(raw.metric_spec_version),
      // 🔴 分级**原样继承**：阈值属领域算法（规则 9 / E-7），写入口也不碰它。
      sample_size_grade: asEnumValue<PromptSet['sample_size_grade']>(raw.sample_size_grade),
      created_at: now,
      notes: cleanOptional(raw.notes),
    });
    pendingItems.push(items);
  }

  // ---- 全部构造完再写库（transfer:189 的同一顺序），失败窗口只剩「构造阶段抛错」----
  db.projects.push(project);
  db.competitors.push(...competitors);
  db.assets.push(...assets);
  if (card) db.entityCards.push(card);
  db.revisions.push(...revisions);
  db.promptSets.push(...importedSets);
  // 条目走**唯一**的 item 级写入口（`handlers/prompt.ts`）：它要求 set 已在库里，所以排在
  // `promptSets.push` 之后。构造阶段（解析 + 校验）仍然整体前置于任何写入
  // ⇒ 「构造抛错时库一动不动」这个性质没变，变的只是条目落库那一步不再各写各的。
  // `reindexed` 与 transfer:182 的 `set.reindex()` 同形（position 0 基连续、set_id 对齐）。
  importedSets.forEach((set, index) => {
    writePromptItems(db, set.id, reindexed(pendingItems[index]));
  });

  // 🔴 `counts` **恰好 7 个键**（transfer:207-214，简报 A-5）：`projects` 恒为 1、
  // `entity_cards` 是 0 或 1，其余是各自落库的条数。键集由 `project.test.ts` 与
  // §D-9③ 的变异自证钉住（改 6 个就红）。
  const counts: Record<string, number> = {
    projects: 1,
    competitors: competitors.length,
    assets: assets.length,
    entity_cards: card ? 1 : 0,
    revisions: revisions.length,
    prompt_sets: importedSets.length,
    prompt_items: importedSets.reduce((total, set) => total + set.items.length, 0),
  };
  const report: ImportReport = { project_id: projectId, counts };
  return report;
};

/**
 * 竞品 CSV（spec FR-M1-6）。表头一律 import `api/constants.ts` 的共享常量（简报 A-8：不许另造）。
 * 🔴 **不带 BOM**：真值源 transfer:235 的 `without_bom()`，BOM 由前端下载时补
 * （`api/client.ts` 的 `exportWriteFile(defaultName, content, withBom)`）。
 */
export const projectExportCompetitorsCsv: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.id));

  return toCsv(
    COMPETITOR_CSV_HEADER,
    competitorsOf(db, project.id).map((row) => [
      row.name,
      row.aliases.join(CSV_TAG_SEPARATOR),
      row.website ?? '',
      row.note ?? '',
      String(row.position),
    ]),
  );
};

/** 资产 CSV：`kind` 用 snake_case，便于人工编辑后回读（真值源 transfer:227）。 */
export const projectExportAssetsCsv: DemoHandler = (args) => {
  const db = getDemoDb();
  const project = requireProject(db, asString(args.id));

  return toCsv(
    ASSET_CSV_HEADER,
    assetsOf(db, project.id).map((row) => [row.kind, row.url, row.title ?? '', row.note ?? '']),
  );
};

/**
 * 解析导入载荷。失败一律 `validation/failed` + `{field:'payload', reason:'parse_failed', value:<固定 ASCII 诊断>}`。
 *
 * 🔴 `value` **绝不回显用户输入**（#29，AGENTS 规则 3 的同族纪律）：`params.value` 会被前端渲染出来
 * （`errors.reasons.*` 的括号文案），是**会上屏**的。真值源 transfer:80-82 装的是 serde_json 的
 * `Display`——它只说「第几行第几列期望什么」，**不含**载荷片段；而 V8 的 `JSON.parse` 报错
 * **会**把出错位置附近的原文抄进 message（`Unexpected token 'x', "{not json"… is not valid JSON`）
 * ⇒ 直接转发它就是回显用户数据。所以两支都用**固定 ASCII 串**，与兄弟分支同形。
 *
 * ⚠ 代价：`value` 不再逐字等于后端的 serde_json 原文（demo 拿不到那份位置信息，硬凑一份就是新的漂移面）。
 * 契约只要求 `value` 是语言中立的诊断串，两侧都满足；这一点已写进 15c-2 报告交底。
 */
function parsePayload(payload: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    // 刻意**不接** error 对象：接了就有人会顺手把 `error.message` 塞进 `value`（那正是 #29 的回显）。
    throw demoError('validation/failed', {
      field: 'payload',
      reason: 'parse_failed',
      value: 'expected valid JSON',
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    // serde 对「不是对象」同样报 invalid type ⇒ 归到同一个 parse_failed 发射点。
    throw demoError('validation/failed', {
      field: 'payload',
      reason: 'parse_failed',
      value: 'expected a JSON object',
    });
  }
  return asRecord(parsed);
}

/** 把导出里的实体卡搬到新项目下：换 project_id、两个时间戳，**completeness 原样保留**（§B-2）。 */
function importEntityCard(
  raw: Record<string, unknown>,
  projectId: string,
  createdAt: string,
  now: string,
): EntityCard {
  const fields = asRecord(raw.fields);
  const contact =
    typeof fields.contact === 'object' && fields.contact !== null ? asRecord(fields.contact) : null;
  const statusSource = asRecord(raw.field_status);
  const fieldStatus: Record<string, FieldStatus> = {};
  for (const [field, value] of Object.entries(statusSource)) {
    fieldStatus[field] = asFieldStatus(value);
  }
  const source = asRecord(raw.source);

  return {
    project_id: projectId,
    fields: {
      standard_name: asString(fields.standard_name),
      aliases: asStringList(fields.aliases),
      founded_year: typeof fields.founded_year === 'number' ? fields.founded_year : null,
      qualifications: asStringList(fields.qualifications),
      products: asRecordList(fields.products).map((product) => ({
        name: asString(product.name),
        params: asStringList(product.params),
        note: cleanOptional(product.note),
      })),
      price_range: cleanOptional(fields.price_range),
      service_regions: asStringList(fields.service_regions),
      cases: asStringList(fields.cases),
      differentiators: asStringList(fields.differentiators),
      official_tone: cleanOptional(fields.official_tone),
      contact: contact
        ? {
            phone: cleanOptional(contact.phone),
            email: cleanOptional(contact.email),
            address: cleanOptional(contact.address),
          }
        : null,
    },
    field_status: fieldStatus,
    source: {
      crawled_pages: asStringList(source.crawled_pages),
      llm_provider: cleanOptional(source.llm_provider),
      llm_model: cleanOptional(source.llm_model),
      generated_at: cleanOptional(source.generated_at),
    },
    // 静态演示值，不重算（规则 9 / §B-2）。
    completeness: asNumber(raw.completeness),
    created_at: createdAt,
    updated_at: now,
  };
}

/** 两个 RFC3339 里较早的那个；左边解析不出来（空串）时回落右边。 */
function earlierOf(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

/**
 * M1 的**导入导出** 4 条命令（Task 12 · 简报 §B-1 的再拆：`project.ts` 会顶到 400 行线）。
 * 真值源 `apps/desktop/src-tauri/src/services/project_transfer.rs`（下称 transfer）。
 *
 * # 🔴 两条必须逐字同构的契约（简报 A-5）
 * ① `EXPORT_FORMAT_VERSION`：demo 必须用同一个字面量，但**不许 import 后端**（跨语言）
 *   ⇒ 这里独立写死一份，注释指向 transfer:19；漂了 `project.test.ts` 与 `m1-contract.test.ts` 会红。
 *   （这类「跨语言镜像常量」的正式收口归 Task 15，见 `downstream-obligations.md`。）
 * ② `counts` **恰好 7 个键**（transfer:207-214），且导入**绝不覆盖已有项目**（transfer 头注释第 4 行）
 *   ⇒ 一律新 id，同一份导出可以反复导入成多个副本。
 *
 * # 🔴 刻意不移植的东西（AGENTS 规则 9 / 简报 §B-2）
 * - `validate_project`：导入路径上的项目字段校验属领域规则，demo 不判；
 * - `PromptSet::refresh()` / `reindex()` 里的**重算**部分（`content_hash`、`sample_size_grade`）
 *   ⇒ demo 原样保留载荷里的静态值，只重排 `set_id` / `position` 这类**归属信息**。
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
import {
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
const EXPORT_FORMAT_VERSION = 'geo-project-export-v1';
/** 多值单元格里的分隔符（真值源 `crates/geo-domain/src/csv_io.rs:32`），避免与 CSV 逗号混淆。 */
const CELL_SEPARATOR = ';';

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
  const importedItems: PromptItem[] = [];
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
      // 🔴 两份视图都要写（§B-12）：内嵌副本给 DTO，归一化清单给 item 级真值。
      items: structuredClone(items),
      // content_hash / sample_size_grade 原样保留：重算它们是领域算法（规则 9）。
      content_hash: asString(raw.content_hash),
      engine_scope: asStringList(raw.engine_scope),
      metric_spec_version: asString(raw.metric_spec_version),
      sample_size_grade: asEnumValue<PromptSet['sample_size_grade']>(raw.sample_size_grade),
      created_at: now,
      notes: cleanOptional(raw.notes),
    });
    importedItems.push(...items);
  }

  // ---- 全部构造完再写库（transfer:189 的同一顺序），失败窗口只剩「构造阶段抛错」----
  db.projects.push(project);
  db.competitors.push(...competitors);
  db.assets.push(...assets);
  if (card) db.entityCards.push(card);
  db.revisions.push(...revisions);
  db.promptSets.push(...importedSets);
  db.promptItems.push(...importedItems);

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
    prompt_items: importedItems.length,
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
      row.aliases.join(CELL_SEPARATOR),
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
 * 解析导入载荷。失败一律 `validation/failed` + `{field:'payload', reason:'parse_failed', value:<原文>}`
 * （A-5 / transfer:80-82：`value` 装**序列化库原文**，不自己拼句子）。
 * ⚠ 规则 3：`value` 里装的是解析器的报错文本，不是载荷本身——绝不把用户数据整段回显。
 */
function parsePayload(payload: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw demoError('validation/failed', {
      field: 'payload',
      reason: 'parse_failed',
      value: error instanceof Error ? error.message : String(error),
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

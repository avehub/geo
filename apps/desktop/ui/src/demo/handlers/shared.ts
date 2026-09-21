/**
 * M1 三个 handler 文件共用的**原语**（Task 12 · 简报 §B-1「多出的文件」，行数见报告）。
 *
 * # 为什么单独一个叶子模块
 * `project.ts` / `entity-card.ts` / `relations.ts` 都要用到同一批原语（新 id、当前时间、
 * 从 `Record<string, unknown>` 里安全取值、`project/not_found` 守卫、CSV 写盘）。
 * 三份各抄一遍就是六个函数 × 三处的漂移面；放进 `project.ts` 再让另外两个 import
 * 又会造成「relations 依赖 project」这种假关系。所以抽一个**叶子**模块：
 * 它只 import `../types`（错误构造）与 `../db`（只读派生），谁都能安全 import。
 *
 * # 🔴 确定性口径（简报 §B-7）
 * `newId()` / `nowIso()` 服务的是**运行时新建的对象**（新项目、新竞品、新修订、导入产生的新 id）。
 * 这里**必须**用真 UUID 与真时间——「两次创建得到同一个 id」是行为错误。
 * 与之相对，`src/demo/seed/**` 的种子数据仍然绝对确定（那边一个 `Date.now()` 都不许有）。
 * 约束是：测试只断言**形状**（UUID v4 / 合法 RFC3339），不断言具体值；`resetDemoDb()` 之后一切回种子。
 *
 * # 语言约束（门禁 7）
 * 本目录非注释 CJK 必须为 0 ⇒ 这里的字符串常量全是 ASCII。
 * ⚠ 一个因此产生的**有据偏离**：真后端 `ProjectDraft::build` 在 `region` 为空时回落中文常量
 * `"全国"`（`crates/geo-domain/src/project.rs:275`），demo 不做这个回落（留空），
 * 因为把中文字面量写进 handler 会直接踩门禁 7。见 `project.ts` 的 `project_create`。
 */
import type { DemoDb } from '../types';
import { demoError } from '../types';
import { projectById } from '../db';
import type {
  Competitor,
  IntentCategory,
  Project,
  ProjectAsset,
  PromptSource,
  SampleSizeGrade,
} from '../../api/types';
import {
  FIELD_STATUS_VALUES,
  INDUSTRY_VALUES,
  INTENT_VALUES,
  PROMPT_SOURCE_VALUES,
  SAMPLE_SIZE_GRADE_VALUES,
} from '../../api/types';
import type { FieldStatus, Industry, Language } from '../../api/types';

/** CSV 字段分隔符（真值源 `crates/geo-domain/src/csv_io.rs` 用的 csv crate 默认值）。 */
const FIELD_SEPARATOR = ',';
/** CSV 行分隔符（csv crate 默认 `\n`，不是 `\r\n`）。 */
const RECORD_SEPARATOR = '\n';
/** 需要加引号的字符：分隔符、引号本身、两种换行。 */
const MUST_QUOTE = /[",\n\r]/;

/**
 * **单元格内**多值的分隔符（标签列、竞品别名列）：镜像 Rust `crates/geo-domain/src/csv_io.rs:32`
 * 的 `const TAG_SEPARATOR: char = ';'`。
 *
 * ⚠ 为什么不能放 `api/constants.ts`：那个文件是两侧共享且本轮禁改，而 Rust 的 `TAG_SEPARATOR`
 * 是**私有** `const`（没有 `pub`）⇒ 要共享就得改 `crates/**`，那是越界。
 * ⚠ 仓内已有第二份本地镜像：`handlers/project-transfer.ts:65` 的 `const CELL_SEPARATOR = ';'`
 * （同一个 Rust 常量，用于竞品别名列），它未导出且该文件本轮禁改。「两份本地镜像应合并」
 * 已列入 Task 15 的收口项。
 */
export const CSV_TAG_SEPARATOR = ';';

/** 运行时新建对象的 id：uuid v4（仓库口径，AGENTS「ID 统一 uuid::Uuid（v4）」）。 */
export function newId(): string {
  return crypto.randomUUID();
}

/** 运行时产物的时间戳：RFC3339（`chrono::DateTime<Utc>` 的存库口径）。 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** `args` 没有类型保护（`DemoHandler` 收 `Record<string, unknown>`）⇒ 取值一律经这几个收窄函数。 */
export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 布尔入参：`project_archive` 的 `archived`。缺省按 `false`（与 Rust `#[serde(default)]` 同族口径）。 */
export function asBoolean(value: unknown): boolean {
  return value === true;
}

/** 字符串数组入参（`aliases` / `tags` / `core_pages` / `ids`）：非数组一律当空数组。 */
export function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** 对象入参（`draft` / `filter` / `project`）：非对象一律当空对象，绝不让 handler 炸在 `undefined.x`。 */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** 对象数组入参（`draft.competitors`、导出载荷里的 `revisions` / `prompt_sets` …）。 */
export function asRecordList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asRecord(item));
}

/**
 * 可选文本的归一化：trim 后为空 ⇒ `null`。
 * 与 `crates/geo-domain/src/asset.rs` 的 `clean_optional` 同口径（不是领域算法，只是数据清洗）。
 */
export function cleanOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 取项目行，取不到就发 `project/not_found`。
 *
 * 🔴 params **两个键都要**（简报 A-11）：契约登记的词表是 `['kind','id']`，
 * 且 `kind` 恒为 `'project'`——词典插值要用它，漏掉就是「少一个已登记的必需键」。
 */
export function requireProject(db: DemoDb, id: string): Project {
  const project = projectById(db, id);
  if (!project) {
    throw demoError('project/not_found', { kind: 'project', id });
  }
  return project;
}

/**
 * 极简 CSV 写盘：与 csv crate 的默认行为同形（按需加引号、引号内 `"` 翻倍、`\n` 结尾）。
 *
 * 🔴 **不带 BOM**：真值源 `apps/desktop/src-tauri/src/services/project_transfer.rs:235` 的
 * `without_bom()`——BOM 由前端下载时补（`api/client.ts` 的 `exportWriteFile(withBom)`）。
 * 这不是领域算法（AGENTS 规则 9 管的是去重率/完整率/样本量分级），只是序列化；
 * 表头一律 import `api/constants.ts` 的共享常量，**不许**在这里另造一份。
 */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header, ...rows].map((cells) => cells.map(quoteCell).join(FIELD_SEPARATOR));
  return `${lines.join(RECORD_SEPARATOR)}${RECORD_SEPARATOR}`;
}

function quoteCell(cell: string): string {
  if (!MUST_QUOTE.test(cell)) return cell;
  return `"${cell.replaceAll('"', '""')}"`;
}

// ---------------------------------------------------------------------------
// 枚举入参的收窄
// ---------------------------------------------------------------------------

/**
 * `Language` 在 `api/types.ts` 里**刻意没有**运行时清单（只有 Industry / Intent / Source /
 * FieldStatus / SampleSizeGrade 有），所以这里写一份两行的本地清单，用 `satisfies` 钉住成员。
 * 回落值 `zh_cn` 不是我编的：它就是 Rust `Language` 的 `#[default]`（`crates/geo-domain/src/project.rs`）。
 */
const LANGUAGES = ['zh_cn', 'en_us'] as const satisfies readonly Language[];

/** 枚举入参：契约内的值原样收下，契约外的一律回落到该枚举的中立成员（§B-2③：不自造校验规则）。 */
export function asLanguage(value: unknown): Language {
  return (LANGUAGES as readonly string[]).includes(asString(value))
    ? (value as Language)
    : 'zh_cn';
}

/** 行业维度：清单直接消费 `api/types.ts` 的 `INDUSTRY_VALUES`（不另造镜像）。 */
export function asIndustry(value: unknown): Industry {
  return (INDUSTRY_VALUES as readonly string[]).includes(asString(value))
    ? (value as Industry)
    // `other` 是行业维度里唯一不带模板语义的成员，回落它不会凭空给项目套上一个行业模板。
    : 'other';
}

/** 字段可信状态：清单消费 `FIELD_STATUS_VALUES`；回落 `pending`（待确认）是最保守的那一档。 */
export function asFieldStatus(value: unknown): FieldStatus {
  return (FIELD_STATUS_VALUES as readonly string[]).includes(asString(value))
    ? (value as FieldStatus)
    : 'pending';
}

/**
 * 意图维度（M2 的 7 类意图）：清单消费 `INTENT_VALUES`，顺序即界面选项顺序。
 *
 * 回落 `category_awareness`（清单第 0 项 = 品类认知）：`IntentCategory` 在 Rust 侧**没有**
 * `#[default]`，所以这里不能声称"照抄后端默认值"；选它是因为它是意图漏斗**最上游**那一档，
 * 回落过去不会凭空给条目套上"比价/本地服务"这类带业务后果的语义。
 */
export function asIntent(value: unknown): IntentCategory {
  return (INTENT_VALUES as readonly string[]).includes(asString(value))
    ? (value as IntentCategory)
    : INTENT_VALUES[0];
}

/**
 * 条目来源：清单消费 `PROMPT_SOURCE_VALUES`。
 *
 * 🔴 回落 `manual`（**不是** Rust 的 `PromptSource::default()` = `Template`）：来源是指标口径的
 * 一部分，契约外的值宁可认成"人工录入"，也绝不凭空给条目盖上 template / generated 的戳——
 * 那会让界面显示一条并不存在的生成链路。与 `prompt_item_add` 强制 `manual` 同一条理由。
 */
export function asPromptSource(value: unknown): PromptSource {
  return (PROMPT_SOURCE_VALUES as readonly string[]).includes(asString(value))
    ? (value as PromptSource)
    : 'manual';
}

/**
 * 样本量分级：清单消费 `SAMPLE_SIZE_GRADE_VALUES`。
 *
 * 回落 `insufficient`（三档里最保守的一档）：分级决定界面是否展示精确分数，
 * 回落错了会**多**给结论；回落到最保守那档只会少给，与「不足时给补齐建议而非静默通过」
 * 的产品纪律同向。
 */
export function asSampleSizeGrade(value: unknown): SampleSizeGrade {
  return (SAMPLE_SIZE_GRADE_VALUES as readonly string[]).includes(asString(value))
    ? (value as SampleSizeGrade)
    : 'insufficient';
}

/**
 * 数值入参：非有限数一律 0。用于 `weight` / `repeat_count` / `version` 这类导入路径上的计数。
 */
export function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * 原样收下并断言成 DTO 的联合类型。**只用于两种入参**：
 * ① 机器生成的载荷（`project_import` 读的就是 `project_export` 自己写出来的 JSON）；
 * ② `api/types.ts` **刻意没有**运行时清单的枚举（目前只有 `AssetKind` 一个）——
 *    想校验就得凭空造一份镜像常量，那是新的漂移面（归 Task 15）。
 *
 * 🔴 有运行时清单的枚举**一律走 `asXxx`**（`asLanguage` / `asIndustry` / `asFieldStatus` /
 * `asIntent` / `asPromptSource` / `asSampleSizeGrade`）：它们消费 `api/types.ts` 的值表，
 * 契约内的值原样收下、契约外的回落到该枚举的中立成员。真后端由 serde 在 IPC 边界**拒绝**
 * 契约外的值；demo 不复制那套拒绝逻辑（§B-2③：不自造校验规则），但必须**收敛**到一个合法成员，
 * 否则非法值会一路流进渲染层，而界面并没有能力把它显示成"非法"。
 */
export function asEnumValue<T>(value: unknown): T {
  return value as T;
}

// ---------------------------------------------------------------------------
// 行构造（`project_create` 与 `competitor_upsert` / `asset_add` 共用，免得两处各写一份字段映射）
// ---------------------------------------------------------------------------

/**
 * 造一行竞品。`position` 与 `created_at` 由调用方给：新增时 position 接在最大值之后，
 * 就地更新时必须保留原值（真值源 `services/project_service.rs:194`-`216`）。
 */
export function makeCompetitor(
  projectId: string,
  draft: Record<string, unknown>,
  position: number,
  createdAt: string,
): Competitor {
  return {
    id: newId(),
    project_id: projectId,
    name: asString(draft.name).trim(),
    aliases: asStringList(draft.aliases),
    website: cleanOptional(draft.website),
    note: cleanOptional(draft.note),
    position,
    created_at: createdAt,
  };
}

/** 造一行资产。`kind` 见 `asEnumValue` 的口径。 */
export function makeAsset(
  projectId: string,
  kind: unknown,
  url: unknown,
  title: unknown,
  note: unknown,
  createdAt: string,
): ProjectAsset {
  return {
    id: newId(),
    project_id: projectId,
    kind: asEnumValue<ProjectAsset['kind']>(kind),
    url: asString(url).trim(),
    title: cleanOptional(title),
    note: cleanOptional(note),
    created_at: createdAt,
  };
}

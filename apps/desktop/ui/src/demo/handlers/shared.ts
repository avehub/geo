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
import type { Competitor, ContentStatus, IntentCategory, KbEntryKind, KbModule, KbScenario, KeywordKind, LibrarySource, Project, ProjectAsset, PromptSource, SampleSizeGrade, SiteChannelKind, SiteOwnership, SitePatchKind, SitePlatform } from '../../api/types';
import { CONTENT_STATUS_VALUES, FIELD_STATUS_VALUES, INDUSTRY_VALUES, INTENT_VALUES, KB_ENTRY_KIND_VALUES, KB_MODULE_VALUES, KB_SCENARIO_VALUES, KEYWORD_KIND_VALUES, LIBRARY_SOURCE_VALUES, MODEL_PROTOCOL_VALUES, PROMPT_SOURCE_VALUES, SAMPLE_SIZE_GRADE_VALUES, SITE_CHANNEL_KIND_VALUES, SITE_OWNERSHIP_VALUES, SITE_PATCH_KIND_VALUES, SITE_PLATFORM_VALUES } from '../../api/types';
import type { FieldStatus, Industry, Language, ModelProtocol } from '../../api/types';

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
 * ⚠ 为什么不能放 `api/constants.ts`：那个文件装的是两侧共享的**契约常量**，而 Rust 的
 * `TAG_SEPARATOR` 是**私有** `const`（没有 `pub`）⇒ 要真共享就得改 `crates/**`，那是越界。
 * 🔴 全仓**只许有这一份**本地镜像：竞品别名列（`handlers/project-transfer.ts`）与题库标签列
 * （`handlers/prompt-csv.ts`）都从这里引。曾经存在过第二份未导出的 `CELL_SEPARATOR`
 * （同一个 Rust 常量、各漂各的风险），现已收掉；「不许再长出第二份」的判据在
 * `handlers/m1-contract.test.ts`（命中清单必须恰好是本文件这一处）。
 */
export const CSV_TAG_SEPARATOR = ';';

/** ASCII 大写字母。只折这一段：SQLite 的 `LIKE` 只对 ASCII 大小写不敏感。 */
const ASCII_UPPER = /[A-Z]/g;

/**
 * SQLite `LIKE` 的 ASCII 大小写折叠（真值源 `crates/geo-store/src/repo/project.rs:138` 的注释：
 * 「LIKE 对 ASCII 大小写不敏感，中文按原样匹配」）。
 *
 * ⚠ 不用 `String.prototype.toLowerCase()`：它连非 ASCII 一起折（`'İ'.toLowerCase()` 是两个字符），
 * 那就比后端**宽**了，反而造出新的分岐。
 */
export function foldAsciiCase(value: string): string {
  return value.replace(ASCII_UPPER, (char) => char.toLowerCase());
}

/**
 * `tags LIKE '%"<json(tag)>"%' ESCAPE '\'` 的镜像（真值源 `repo/project.rs:146-153`：`tags` 列存的
 * 是 JSON 数组文本，形如 `["SaaS","GEO"]`）。
 *
 * 🔴 语义是**对序列化文本做 ASCII 大小写不敏感的子串匹配**，不是成员判定（#30②）。两条可观测后果：
 * - 引号让部分匹配失效（`"Saa"` 不命中 `"SaaS"`——后端注释点名的就是这件事）；
 * - 但两个元素之间的 `","` 会被标签 `,` 命中。这不是我们**想要**的语义，是后端 SQL 的**既有**语义；
 *   demo 的职责是与后端**不可区分**，不是替后端修正（Rust 只读）。这条怪癖已写进 15c-2 报告交底，
 *   建议后端改用 `json_each` 做精确成员匹配。
 *
 * `ESCAPE '\'` 让 `%` / `_` / `\` 按字面匹配，而 JS 的 `includes` 本来就是字面 ⇒ 不需要再转义一次。
 * 更准确地说，真值源那侧是**两次转义互相抵消**：`repo/project.rs:146-153`（pattern 那行是 `:149`）把
 * `escape_like`（`:229-238`）套在 `codec::encode_json`（`codec.rs:64-66` = `serde_json::to_string`）外面，
 * 而 `escape_like` 给 `%` `_` `\` 各再加一个 `\`、`ESCAPE '\'` 又把它解回来 ⇒ 净语义就是
 * 「**json 编码后的 tag** 作为字面子串，去匹配 **json 编码后的 tags 列文本**」，正是下面这一行。
 *
 * ⚠ 所以这条镜像的正确性**只**取决于 `JSON.stringify` 与 serde_json 的编码是否同形（都无空格分隔，
 * `"` `\` 与 C0 控制字符的转义规则一致，非 ASCII 都不转义）。这一点在 15c-2 里只是**假设**（报告 §10-3
 * 自陈未逐一实测），现由 `project.test.ts` 的「#30② 转义同形」用例按手算期望值逐条钉住
 * （含双引号、反斜杠、制表符、C0 控制字符、DEL）。唯一已知的编码分岐面是**孤立代理项**
 * （JS 会输出 `\ud800` 形式），而它在 Rust `String` 里根本不可表示 ⇒ 对**可达输入**同形成立。
 */
export function matchesTagsLike(tags: readonly string[], tag: string): boolean {
  return foldAsciiCase(JSON.stringify(tags)).includes(foldAsciiCase(JSON.stringify(tag)));
}

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

/**
 * 模型协议（Plan B Task 4 · DR-34）：清单消费 `api/types.ts` 的 `MODEL_PROTOCOL_VALUES`。
 *
 * 回落 `openai_compat`（两档里今天所有预设厂商实际在走的那一档）：协议决定请求体形状，
 * 回落错了会**发不出请求**；回落到主流那一档至少与"用户没选"的语义一致。
 */
export function asModelProtocol(value: unknown): ModelProtocol {
  return (MODEL_PROTOCOL_VALUES as readonly string[]).includes(asString(value))
    ? (value as ModelProtocol)
    : 'openai_compat';
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
 * 内容审核态（`ContentStatus`）：清单消费 `CONTENT_STATUS_VALUES`。
 *
 * 回落 `pending_review`（AGENTS 规则 6：生成内容默认待人工审核）——契约外的值宁可认成
 * "还没审"，也绝不凭空盖一个 `approved` 的戳。
 *
 * 🔴 原先是 `handlers/action.ts` 的模块私有函数，M1.5 素材层（关键词 / FAQ）也要用同一套
 * 收敛口径 ⇒ 搬到本叶子模块，全仓只留这一份（与 `enumLabel` 的"只有一份"同一条纪律）。
 */
export function asContentStatus(value: unknown): ContentStatus {
  return (CONTENT_STATUS_VALUES as readonly string[]).includes(asString(value))
    ? (value as ContentStatus)
    : 'pending_review';
}

/**
 * 关键词类型（M1.5 素材层）：清单消费 `KEYWORD_KIND_VALUES`。
 *
 * 回落 `core`（清单第 0 项）：与 `asIntent` 同一条理由——回落到维度里最中性的一档，
 * 不凭空给一条素材套上"竞品词 / 问题词"这种带业务后果的语义。
 */
export function asKeywordKind(value: unknown): KeywordKind {
  return (KEYWORD_KIND_VALUES as readonly string[]).includes(asString(value))
    ? (value as KeywordKind)
    : KEYWORD_KIND_VALUES[0];
}

/**
 * 素材来源（`LibrarySource`）：清单消费 `LIBRARY_SOURCE_VALUES`。
 *
 * 🔴 回落 `manual`（与 `asPromptSource` 同一条理由）：来源是"这条素材怎么来的"的账，
 * 契约外的值宁可认成人工录入，也绝不凭空盖上 `generated` 的戳——那会让界面显示
 * 一条并不存在的 AI 生成链路。
 */
export function asLibrarySource(value: unknown): LibrarySource {
  return (LIBRARY_SOURCE_VALUES as readonly string[]).includes(asString(value))
    ? (value as LibrarySource)
    : 'manual';
}

/**
 * 可空数值入参（`monthly_volume` / `difficulty`）：非有限数与 `null` / 缺省一律收成 `null`。
 *
 * 🔴 不回落 0：0 是"这个指标真的是 0"，`null` 是"没有这个指标"，两者在界面上分别显示成
 * `0` 与空值占位符。把缺省收成 0 等于凭空造一个数据点。
 */
export function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// M6.5 站点接入（spec 2026-09-30 · DR-51）：**数据字段**的收敛口径
// ---------------------------------------------------------------------------
//
// 🔴 这四个都是「一条已存在的记录总得有个合法取值」⇒ 契约外的值回落到**最中性的一档**，
// 与 `asKeywordKind` / `asLibrarySource` 同一条纪律。
// ⚠ 与之相对，`site_patch_transition` 的 `transition` 是**命令动词**而不是数据字段：
// 猜错一个动词就等于替用户执行了一次发布 ⇒ 那一支**不收敛、直接报错**，
// 判据与理由都写在 `handlers/site.ts`。

/** 建站形态：回落 `unknown`（"不知道"比猜一个形态诚实，界面据此只显示 `bundle` 通道可行）。 */
export function asSitePlatform(value: unknown): SitePlatform {
  return (SITE_PLATFORM_VALUES as readonly string[]).includes(asString(value))
    ? (value as SitePlatform)
    : 'unknown';
}

/** 谁在管这个站：回落 `unknown`（同上，不替用户断言"你有权限"）。 */
export function asSiteOwnership(value: unknown): SiteOwnership {
  return (SITE_OWNERSHIP_VALUES as readonly string[]).includes(asString(value))
    ? (value as SiteOwnership)
    : 'unknown';
}

/**
 * 下发通道：回落 `bundle`。
 * 🔴 这是四个里唯一**不回落清单第 0 项之外**的选择理由：`bundle` 恰好就是第 0 项，
 * 而它同时是唯一**不需要凭据**的通道 ⇒ 回落它既中性又不会凭空声称"你配了 CMS / 边缘函数"。
 */
export function asSiteChannelKind(value: unknown): SiteChannelKind {
  return (SITE_CHANNEL_KIND_VALUES as readonly string[]).includes(asString(value))
    ? (value as SiteChannelKind)
    : SITE_CHANNEL_KIND_VALUES[0];
}

/**
 * 补丁类型：回落 `html_fragment`（**不是**清单第 0 项 `llms_txt`）。
 * 🔴 `llms_txt` / `robots_txt` 的落点是站点根目录的**文件**，把一个认不出的类型收敛成它，
 * 界面上就会显示一条"要改根目录文件"的补丁——那是有运维后果的断言。
 * `html_fragment`（一段贴进页面的 HTML）是十个类型里后果最轻、语义最中性的一个。
 */
export function asSitePatchKind(value: unknown): SitePatchKind {
  return (SITE_PATCH_KIND_VALUES as readonly string[]).includes(asString(value))
    ? (value as SitePatchKind)
    : 'html_fragment';
}

/**
 * 数值入参：非有限数一律 0。用于 `weight` / `repeat_count` / `version` 这类导入路径上的计数。
 */
export function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * 把整数夹进 `[min, max]`：素材优先级（1~5）与生成条数（`LIBRARY_GENERATE_MIN..MAX`）共用。
 * 非有限数先经 `asNumber` 收成 0，再被夹到下界——所以"没传"与"传了个 0"结果相同。
 */
export function clampInt(value: unknown, min: number, max: number): number {
  const rounded = Math.round(asNumber(value));
  return Math.min(max, Math.max(min, rounded));
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

// ---------------------------------------------------------------------------
// M1.2 知识库（spec 2026-10-01 · DR-63 … DR-65）：**数据字段**的收敛口径
// ---------------------------------------------------------------------------
//
// 🔴 与上面那几批同一条纪律：这些都是「一条已存在的记录总得有个合法取值」⇒ 契约外的值
// 回落到**最中性的一档**，不凭空猜一个带业务后果的语义。
//
// ⚠ 这一族**只有两个成员**（`asKbModule` / `asKbEntryKind`），刻意没有 `asKbSource` 与
// `asNullableKbOrigin`：`source` 与 `origin` 是"这条知识怎么来的"的**账**，由后端在三条写入
// 命令里各自定死（`kb_entry_add` → `manual` + `null`、`kb_generate` → `generated` + `null`、
// `kb_entry_detach` → `detached` + 源块的 origin），`kb_entry_update` 则一律取库里那份。
// 既然没有任何一处需要"把线上来的值收敛成合法来源"，写出这两个收敛器就等于给
// "前端自称 AI 生成 / 自称同步自实体卡"留了一条本来不存在的路（同 `asNullableKbOrigin`
// 那句"宁可为空也不许猜"的反面：这里连猜的机会都不给）。

/** 知识模块：回落 `KB_MODULE_VALUES[0]`（`brand`，清单第 0 项 = 最中性的"品牌概况"）。 */
export function asKbModule(value: unknown): KbModule {
  return (KB_MODULE_VALUES as readonly string[]).includes(asString(value))
    ? (value as KbModule)
    : KB_MODULE_VALUES[0];
}

/**
 * 话术场景（DR-75）：认不出 / 缺省 ⇒ `null`（**不**回落某个具体场景）。
 *
 * 🔴 与 `asKbModule` 刻意不同：场景是**可选维度**，把认不出的值盖成"首次触达"会凭空
 * 给一条知识安一个它没有的适用场景；`null` 在界面上就是"不挂场景标签"。
 */
export function asKbScenario(value: unknown): KbScenario | null {
  return (KB_SCENARIO_VALUES as readonly string[]).includes(asString(value))
    ? (value as KbScenario)
    : null;
}

/**
 * 素材形式：回落 `text`（**不是**清单第 0 项 `statement`）。
 *
 * 🔴 这里刻意不照 `asKeywordKind` 那样取 `[0]`：`statement` 是"一句可被 AI 整段引用的定义句"，
 * 把认不出的形式盖成定义句，会让它进导出物的引用块、也被统计进"定义句"那一格 ⇒ 回落 `text`
 * （最普通的一档，不带额外语义）。
 */
export function asKbEntryKind(value: unknown): KbEntryKind {
  return (KB_ENTRY_KIND_VALUES as readonly string[]).includes(asString(value)) ? (value as KbEntryKind) : 'text';
}

/**
 * IPC 契约类型：与 Rust 侧 DTO 一一对应。
 *
 * 约定（见 `AGENTS.md`）：所有字段名与枚举值在 JSON 上一律 **snake_case**，
 * Tauri 命令统一用 `#[tauri::command(rename_all = "snake_case")]`，
 * 因此前端发送参数也用 snake_case，避免任何隐式改名。
 *
 * # 分模块（M3–M7）
 * M1/M2 与设置族的 DTO 住在本文件；采集、解析、诊断、行动、报告五个模块的 DTO 各自一个
 * `types-*.ts`（单文件超过约 400 行就拆分，AGENTS「代码风格」），并在本文件末尾 `export *`
 * 汇总 ⇒ 调用方照旧只 `import … from '../api/types'`，不必知道拆分细节。
 */

import type { AssertComplete, ValuesAreComplete } from './completeness';
import type { ModelProtocol } from './types-llm';

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/** 后端 `IpcError` 的 JSON 形状。 */
export interface IpcErrorPayload {
  code: string;
  /**
   * 语言中立参数：键由 `contracts/error-codes.json` 冻结，值是稳定标识符或原始值，
   * 供词典按当前语言插值（spec §4.2）。旧后端不带此字段，因此可选。
   */
  params?: Record<string, string>;
  message: string;
  detail?: unknown | null;
}

export function isIpcErrorPayload(value: unknown): value is IpcErrorPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as IpcErrorPayload).code === 'string' &&
    typeof (value as IpcErrorPayload).message === 'string'
  );
}

// ---------------------------------------------------------------------------
// 枚举（字面量联合即数据库存储值）
// ---------------------------------------------------------------------------

export type ProjectStatus = 'active' | 'archived';
export type Language = 'zh_cn' | 'en_us';
export type Industry =
  | 'b2b_manufacturing'
  | 'enterprise_saas'
  | 'local_service'
  | 'cross_border_ecommerce'
  | 'franchise'
  | 'other';
export type AssetKind =
  | 'owned_page'
  | 'baike'
  | 'zhihu'
  | 'xiaohongshu'
  | 'baijiahao'
  | 'industry_media'
  | 'ecommerce'
  | 'social_account'
  | 'other';
export type FieldStatus = 'official' | 'pending' | 'disputed';
export type ContentStatus = 'pending_review' | 'approved' | 'rejected';
export type IntentCategory =
  | 'category_awareness'
  | 'purchase_recommendation'
  | 'brand_comparison'
  | 'pricing_plan'
  | 'local_service'
  | 'after_sales_reputation'
  | 'professional_long_tail';
export type PromptSource = 'template' | 'generated' | 'rewritten' | 'manual' | 'imported';
export type SampleSizeGrade = 'sufficient' | 'directional' | 'insufficient';

// ---------------------------------------------------------------------------
// 枚举的**语言中立**运行时清单（Task 9b §B-2）
// ---------------------------------------------------------------------------

/**
 * 字面量联合在运行时不存在，而 6 处 `Select` / `Radio` / `Checkbox` 的选项要靠遍历拿到
 * 全部枚举值。原先这个「运行时清单」职责由 5 张 zh 标签映射兼任
 * （`Object.keys(INTENT_LABELS)` 这种写法）；标签迁进词典之后必须把它单独拆出来，
 * 否则组件没有选项可渲染。
 *
 * 约定：
 * - `as const` 保住窄元组类型，`satisfies` 保证每个元素都是合法成员（写错一个 id 当场红）；
 * - **顺序即界面选项顺序**，逐字沿用被删掉的那几张映射的键顺序（`Object.keys` 的既有顺序
 *   就是它），免得界面选项顺序悄悄变了；
 * - 值是**稳定 id**——线上传的就是它（后端一律发 snake_case id、不发标签），展示文案一律查
 *   词典（`src/i18n/enum-label.ts` 的 `enumLabel`），查不到回退 id 本身、绝不回退中文；
 * - 每张清单各有一条**编译期完整性网**（见本段末尾），漏一个联合成员 `tsc -b` 就红。
 *
 * ⚠ `AssetKind` 刻意**没有**值清单：`ASSET_KIND_LABELS` 实测零消费者、资产 UI 还不存在，
 * 加清单就是新的死代码（§B-3）。将来做资产 UI 的人按同一形状补 `ASSET_KIND_VALUES` +
 * `entity.assetKinds.<id>`（两侧）+ 哨兵，zh 真值源是 `crates/geo-domain/src/asset.rs` 的
 * `AssetKind::label_zh()`。
 */
export const INTENT_VALUES = [
  'category_awareness',
  'purchase_recommendation',
  'brand_comparison',
  'pricing_plan',
  'local_service',
  'after_sales_reputation',
  'professional_long_tail',
] as const satisfies readonly IntentCategory[];

export const PROMPT_SOURCE_VALUES = [
  'template',
  'generated',
  'rewritten',
  'manual',
  'imported',
] as const satisfies readonly PromptSource[];

export const INDUSTRY_VALUES = [
  'b2b_manufacturing',
  'enterprise_saas',
  'local_service',
  'cross_border_ecommerce',
  'franchise',
  'other',
] as const satisfies readonly Industry[];

export const FIELD_STATUS_VALUES = [
  'official',
  'pending',
  'disputed',
] as const satisfies readonly FieldStatus[];

export const SAMPLE_SIZE_GRADE_VALUES = [
  'sufficient',
  'directional',
  'insufficient',
] as const satisfies readonly SampleSizeGrade[];

/**
 * 生成文稿的审核态（M6 内容生产）。
 *
 * 原先刻意没有清单（`GeneratedContent` 只在 M2 的 DTO 里出现、没有 UI 消费）；M6 的
 * `content_update_status` 要在界面上给出「通过 / 退回」两个动作，选项得从清单遍历出来，
 * 所以按上面那五张的同一形状补上（`as const` + `satisfies` + 编译期完整性网）。
 * 顺序即界面按钮顺序：待审核在前，与 `FieldStatus` 把 `pending` 放中间的取舍不同——
 * 那边是可信度光谱，这边是审核流程的三态。
 */
export const CONTENT_STATUS_VALUES = [
  'pending_review',
  'approved',
  'rejected',
] as const satisfies readonly ContentStatus[];

/**
 * 编译期完整性网（§B-2）：往联合里加一个成员而忘了加进值清单 ⇒ `tsc -b` 红。
 * 两个 helper 住在 `./completeness`（M3–M7 的 DTO 模块也要用，抽出去免得各抄一份）。
 */
export type IntentValuesComplete = AssertComplete<
  ValuesAreComplete<IntentCategory, typeof INTENT_VALUES>
>;
export type PromptSourceValuesComplete = AssertComplete<
  ValuesAreComplete<PromptSource, typeof PROMPT_SOURCE_VALUES>
>;
export type IndustryValuesComplete = AssertComplete<
  ValuesAreComplete<Industry, typeof INDUSTRY_VALUES>
>;
export type FieldStatusValuesComplete = AssertComplete<
  ValuesAreComplete<FieldStatus, typeof FIELD_STATUS_VALUES>
>;
export type SampleSizeGradeValuesComplete = AssertComplete<
  ValuesAreComplete<SampleSizeGrade, typeof SAMPLE_SIZE_GRADE_VALUES>
>;
export type ContentStatusValuesComplete = AssertComplete<
  ValuesAreComplete<ContentStatus, typeof CONTENT_STATUS_VALUES>
>;

// ---------------------------------------------------------------------------
// M1 项目 / 竞品 / 资产
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  brand_name: string;
  aliases: string[];
  website: string | null;
  region: string;
  language: Language;
  industry: Industry;
  industry_label: string | null;
  tags: string[];
  status: ProjectStatus;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompetitorDraft {
  name: string;
  aliases: string[];
  website: string | null;
  note: string | null;
}

export interface Competitor extends CompetitorDraft {
  id: string;
  project_id: string;
  position: number;
  created_at: string;
}

export interface ProjectAsset {
  id: string;
  project_id: string;
  kind: AssetKind;
  url: string;
  title: string | null;
  note: string | null;
  created_at: string;
}

/**
 * 后端 `EntityFields`（`crates/geo-domain/src/entity_card.rs`）用 `deny_unknown_fields`，
 * 多一个键就反序列化失败，勿加字段。🔴 `ProductSpec` **没有**这个属性（同一个文件里逐字核过），
 * 所以它多出来的键是**静默丢掉**——不报错，正是下面 `price` 的失败形态。
 *
 * 🔴 `price` 是**唯一一处有据偏离**（spec `2026-10-01-entity-card-slim-and-knowledge-base-design.md`
 * DR-60）：产品负责人要求把「产品价格」那张独立字段卡取消、报价改成**每个产品自带一个字段**。
 * Rust 侧的 `ProductSpec` 今天只有 `name` / `params` / `note` ⇒ 这里声明成**可选**（后端不给也合法），
 * 并登记为差异 **E-59**：桌面端把带 `price` 的产品清单发给真后端，`price` 会被 serde 静默丢掉、
 * 界面上**一个错误都看不到**（比报错更坏：用户以为存上了）。Plan C 落桌面端时要同批改
 * domain 的结构体与迁移口径，然后把可选去掉。
 */
export interface ProductSpec {
  name: string;
  params: string[];
  /** 该产品的报价口径（如「单台 12 万~60 万元，按风量定制」）。见上面的偏离说明。 */
  price?: string | null;
  note: string | null;
}

export interface Contact {
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface ProjectDraft {
  brand_name: string;
  aliases: string[];
  name: string | null;
  website: string | null;
  core_pages: string[];
  products: ProductSpec[];
  service_scope: string | null;
  region: string | null;
  language: Language;
  industry: Industry;
  industry_label: string | null;
  tags: string[];
  competitors: CompetitorDraft[];
}

export interface ProjectFilter {
  query?: string | null;
  include_archived?: boolean;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// M1 实体卡
// ---------------------------------------------------------------------------

/**
 * 实体卡字段面：🔴 demo 侧由 11 键**收窄到 7 键**（spec 2026-10-01 · DR-59）。
 *
 * 退出的四个字段各有去处，不是删掉不管：`price_range` → `ProductSpec.price`（DR-60）；
 * `cases` / `differentiators` / `official_tone` → 知识库的 `case` / `differentiator` / `tone`
 * 三个模块（种子已迁，`demo/seed/kb.ts`）。实体卡因此回到它的本职——「我是谁」的
 * **结构化事实**；「我怎么讲自己」下沉到知识层。
 *
 * ⚠ Rust 侧的 `ALL_FIELDS`（11）/ `REQUIRED_FIELDS`（10）/ `completeness()` 分母**本轮一行未改**
 * ⇒ 桌面端接真后端时仍会收到那 4 个键（结构类型在运行期忽略多余键，不报错），
 * 而完整率两侧口径不同（demo 6/7=0.86，后端 6/10=0.6）。差异 **E-58**，Plan C 收口。
 * 迁出字段的**词典标签刻意保留**（DR-62）：历史修订留痕与事实核查记录里仍会出现这些 `field_path`。
 */
export interface EntityFields {
  standard_name: string;
  aliases: string[];
  founded_year: number | null;
  qualifications: string[];
  products: ProductSpec[];
  service_regions: string[];
  contact: Contact | null;
}

export interface EntityCardSource {
  crawled_pages: string[];
  llm_provider: string | null;
  llm_model: string | null;
  generated_at: string | null;
}

export interface EntityCard {
  project_id: string;
  fields: EntityFields;
  field_status: Record<string, FieldStatus>;
  source: EntityCardSource;
  completeness: number;
  created_at: string;
  updated_at: string;
}

export interface EntityCardRevision {
  id: string;
  project_id: string;
  field_path: string;
  old_value: unknown | null;
  new_value: unknown | null;
  status: FieldStatus;
  note: string | null;
  edited_at: string;
}

export interface ProjectDetail {
  project: Project;
  entity_card: EntityCard | null;
  competitors: Competitor[];
  assets: ProjectAsset[];
  prompt_set_count: number;
}

export interface ProjectExport {
  format_version: string;
  project: Project;
  entity_card: EntityCard | null;
  revisions: EntityCardRevision[];
  competitors: Competitor[];
  assets: ProjectAsset[];
  prompt_sets: PromptSet[];
  exported_at: string;
}

export interface ImportReport {
  project_id: string;
  counts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// M2 Prompt 题库
// ---------------------------------------------------------------------------

export interface PromptItem {
  id: string;
  set_id: string;
  text: string;
  intent: IntentCategory;
  weight: number;
  group_name: string | null;
  tags: string[];
  source: PromptSource;
  competitor_ids: string[];
  repeat_count: number;
  position: number;
}

/** 人工新增条目的入参；`source` 由后端固定为 `manual`，前端不能自称模板/AI 生成。 */
export interface PromptDraft {
  text: string;
  intent: IntentCategory;
  weight?: number;
  group_name?: string | null;
  repeat_count?: number;
  tags?: string[];
}

export interface PromptSet {
  id: string;
  project_id: string;
  version: number;
  label: string;
  items: PromptItem[];
  content_hash: string;
  engine_scope: string[];
  metric_spec_version: string;
  sample_size_grade: SampleSizeGrade;
  created_at: string;
  notes: string | null;
}

/** 列表接口不加载 items，只给摘要。 */
export interface PromptSetSummary {
  id: string;
  project_id: string;
  version: number;
  label: string;
  item_count: number;
  content_hash: string;
  sample_size_grade: SampleSizeGrade;
  created_at: string;
  notes: string | null;
}

export interface GenerateOptions {
  target_count: number;
  industry: Industry;
  intents?: IntentCategory[] | null;
  repeat_count?: number;
}

export interface DedupeReport {
  kept: PromptItem[];
  removed: { item: PromptItem; merged_into: string }[];
  duplicate_pairs: number;
}

/**
 * 一条 CSV 行错误（**线格式**）。与 Rust `geo_domain::csv_io::CsvRowError` 一一对应：
 * **行号 + 目录 reason key + 语言中立 params**，不含任何自然语言，
 * 由前端按当前语言渲染（`src/api/errors.ts` 的 `describeCsvRowError`）。
 *
 * `params` 写成**可选**（裁定 B-5），读取处 `?? {}` 兜底，与上面 `IpcErrorPayload.params`
 * 的口径一致：线上新载荷一定带 `params`（Rust 侧 `#[serde(default)]` 只影响反序列化，
 * 且 `CsvRowError` 实测从不落库），但"可选 + 兜底"比"假定一定有"稳。
 *
 * ⚠ 合规那一支（`RowFailure::from_geo`）**原样透传** `compliance::check()` 的 params，
 * 所以除该 reason 的配套参数外还会带 `field` 与 `reason` 两个基础键，
 * 且 `value` 装的是**命中的广告法红线词**——渲染侧必须容忍多出来的键，也绝不能回显 `value`。
 *
 * # 具名化（Task 9，裁定 B-6）
 *
 * 行错误抽成具名 `CsvRowError`，与 Rust 侧 `geo_domain::csv_io::CsvRowError` **同名同形**。
 * Task 8 因写权限只到「补 `params`」，把它留成内联匿名形状并在注释里写明留给 Task 9。
 *
 * ⚠ 与 `src/api/errors.ts` 的 `CsvRowErrorLike` **刻意不合并、也不互相 import**：
 * 那个是渲染函数的**入参契约**（刻意宽松，接受任何形状相同的对象，包括测试里手搓的），
 * 这个是**线格式**（字段集由后端 serde 决定）。同名不同责，两边注释互相点名。
 */
export interface CsvRowError {
  /** CSV 物理行号（表头为第 1 行）。对应 Rust `CsvRowError.row: usize`。 */
  row: number;
  /** `crates/geo-domain/src/error.rs` 目录表里的 reason key。 */
  reason: string;
  /** 该 reason 的配套参数；旧载荷可能整份缺失，读取处一律兜底成空对象。 */
  params?: Readonly<Record<string, string>>;
}

/** CSV 导入结果：成功的条目 + 逐行失败原因（不含任何自然语言，由前端按当前语言渲染）。 */
export interface CsvImportResult {
  items: PromptItem[];
  errors: CsvRowError[];
}

// ---------------------------------------------------------------------------
// 设置 / 密钥
// ---------------------------------------------------------------------------

export interface ProxyConfig {
  enabled: boolean;
  url: string | null;
}

export interface ConcurrencyConfig {
  max_parallel: number;
  queue_size: number;
}

export interface RateLimitConfig {
  requests_per_minute: number;
  min_interval_ms: number;
  retry_max: number;
}

export interface ModelConfig {
  provider: string;
  model: string | null;
  /**
   * 接口地址覆盖。`custom` 必填；预设服务商留空即用后端预设地址
   * （填了也会生效，用于企业内网网关，UI 只在「自定义」下开放）。
   */
  base_url: string | null;
  /**
   * 模型协议（Plan B Task 4 · DR-34）。🔴 **只有 `custom` 用得上**：预设厂商与中转站
   * 走哪种协议由后端固定，界面不给控件。Rust 的 `ModelConfig` 今天还没有这个字段
   * （差异 E-48），默认值 `openai_compat` 是 demo 先冻结的契约。
   */
  protocol: ModelProtocol;
  temperature: number;
  timeout_secs: number;
}

export interface NotifyConfig {
  on_finish: boolean;
  on_risk: boolean;
  sound: boolean;
}

/**
 * 数据外发隐私开关（Plan B · 2026-09-18 spec §4.7）。
 *
 * 四项都是"这类数据允不允许随诊断/改进上报"，默认值刻意保守：只有**诊断结果**默认关，
 * 因为它含竞品与归因语料，是四项里最敏感的。
 * 🔴 Rust 侧今天没有这一段（demo 先行），差异登记进 E-48。
 */
/** 与存储相关的**可写**偏好（只读事实走 `app_environment`，见 `types-app.ts`）。 */
export interface StorageConfig {
  /** 上次导出用的目录；从没导出过是 `null`。 */
  last_export_dir: string | null;
}

export interface AppSettings {
  proxy: ProxyConfig | null;
  concurrency: ConcurrencyConfig;
  rate_limit: RateLimitConfig;
  model: ModelConfig;
  language: string;
  notify: NotifyConfig;
  storage: StorageConfig;
}

export interface ProviderInfo {
  provider: string;
  label_zh: string;
  base_url: string;
  default_model: string;
  input_per_mtok: number;
  output_per_mtok: number;
}

export interface SecretStatus {
  provider: string;
  configured: boolean;
  secret_ref: string;
}

export interface LlmTestResult {
  ok: boolean;
  model: string;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_cny: number;
  message: string | null;
}

// ---------------------------------------------------------------------------
// M3–M7 的 DTO（各自一个模块，这里汇总，调用方照旧只 import 本文件）
// ---------------------------------------------------------------------------

export * from './types-collection';
export * from './types-insight';
export * from './types-diagnosis';
export * from './types-action';
export * from './types-report';
export * from './types-app';
export * from './types-llm';
export * from './types-library';
export * from './types-site';
export * from './types-kb';
export * from './types-article';
export * from './types-search';

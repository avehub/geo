/**
 * IPC 契约类型：与 Rust 侧 DTO 一一对应。
 *
 * 约定（见 `AGENTS.md`）：所有字段名与枚举值在 JSON 上一律 **snake_case**，
 * Tauri 命令统一用 `#[tauri::command(rename_all = "snake_case")]`，
 * 因此前端发送参数也用 snake_case，避免任何隐式改名。
 */

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
 * - 五张清单各有一条**编译期完整性网**（见本段末尾），漏一个联合成员 `tsc -b` 就红。
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
 * 编译期完整性网（§B-2）：往联合里加一个成员而忘了加进值清单 ⇒ `tsc -b` 红。
 *
 * 用**类型层**断言而不是「`const _check: T = true`」那种值层写法：`tsconfig.app.json` 开了
 * `noUnusedLocals`，值层的检查常量要么得导出（凭空多 5 个运行时噪音），要么就得指望下划线
 * 前缀被豁免——而 TS 的 `noUnusedLocals` 并不像本仓 ESLint 的 `varsIgnorePattern: '^_'`
 * 那样豁免 `_` 前缀。约束 `T extends true` 不成立时，错误就落在类型别名自身，不需要任何值。
 */
type ValuesAreComplete<Union extends string, Values extends readonly string[]> =
  Exclude<Union, Values[number]> extends never ? true : false;

type AssertComplete<T extends true> = T;

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

/** 后端 `EntityFields` 用 `deny_unknown_fields`，多一个键都会反序列化失败，勿加字段。 */
export interface ProductSpec {
  name: string;
  params: string[];
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

export interface EntityFields {
  standard_name: string;
  aliases: string[];
  founded_year: number | null;
  qualifications: string[];
  products: ProductSpec[];
  price_range: string | null;
  service_regions: string[];
  cases: string[];
  differentiators: string[];
  official_tone: string | null;
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
  temperature: number;
  timeout_secs: number;
}

export interface NotifyConfig {
  on_finish: boolean;
  on_risk: boolean;
  sound: boolean;
}

export interface AppSettings {
  proxy: ProxyConfig | null;
  concurrency: ConcurrencyConfig;
  rate_limit: RateLimitConfig;
  model: ModelConfig;
  language: string;
  notify: NotifyConfig;
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

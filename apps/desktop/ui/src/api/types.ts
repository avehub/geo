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

export const INTENT_LABELS: Record<IntentCategory, string> = {
  category_awareness: '品类认知',
  purchase_recommendation: '选购推荐',
  brand_comparison: '品牌对比',
  pricing_plan: '价格方案',
  local_service: '本地服务',
  after_sales_reputation: '售后口碑',
  professional_long_tail: '专业长尾',
};

export const PROMPT_SOURCE_LABELS: Record<PromptSource, string> = {
  template: '模板',
  generated: 'AI 生成',
  rewritten: '口语化改写',
  manual: '人工',
  imported: 'CSV 导入',
};

export const INDUSTRY_LABELS: Record<Industry, string> = {
  b2b_manufacturing: 'B2B 制造与工业品',
  enterprise_saas: '企业服务/SaaS',
  local_service: '本地生活与专业服务',
  cross_border_ecommerce: '跨境电商',
  franchise: '招商加盟',
  other: '其他行业',
};

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  owned_page: '自有页面',
  baike: '百科',
  zhihu: '知乎',
  xiaohongshu: '小红书',
  baijiahao: '百家号',
  industry_media: '行业媒体',
  ecommerce: '电商平台',
  social_account: '社媒账号',
  other: '其他',
};

export const FIELD_STATUS_LABELS: Record<FieldStatus, string> = {
  official: '官方口径',
  pending: '待确认',
  disputed: '存疑',
};

/** 与后端 `SampleSizeGrade::label_zh()` 一致。 */
export const SAMPLE_SIZE_LABELS: Record<SampleSizeGrade, string> = {
  sufficient: '样本充足',
  directional: '样本偏少',
  insufficient: '样本不足',
};

/** 与后端 `SampleSizeGrade::warning_zh()` 一致；`sufficient` 无警示文案。 */
export const SAMPLE_SIZE_WARNINGS: Partial<Record<SampleSizeGrade, string>> = {
  directional: '样本不足，仅供方向性参考：当前 prompt 数低于 60 条，波动区间较大。',
  insufficient: '样本不足（<30 条），不提供精确分数，仅供方向性参考。',
};

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

export interface CsvImportResult {
  items: PromptItem[];
  errors: { reason: string; row: number }[];
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

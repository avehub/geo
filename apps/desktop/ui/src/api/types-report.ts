/**
 * M7 报告与分享的 IPC 契约类型（demo 优先落地，AGENTS 规则 8）。
 *
 * # 为什么报告是**结构化块**而不是一段 HTML/Markdown
 * 三个理由，都来自既有裁定：
 * 1. **双语**（AGENTS 规则 7 / spec DR-2）：标题、指标名、表头、免责声明都是界面文案，
 *    必须走词典；后端只发**稳定记号 + 数据**。若后端直接回一段中文 HTML，英文界面就没法要。
 * 2. **不许 `dangerouslySetInnerHTML`**（`src/i18n/index.ts` 的 R-I 安全约束）：
 *    块结构由前端渲染成 React 节点，天然没有注入口。
 * 3. **导出格式是前端的活儿**：同一份 `ReportDocument` 可以拼成 Markdown / HTML / CSV，
 *    拼出来的文字随界面语言走（`src/api/report-compose.ts`）。
 *
 * # 🔴 数字与叙述的分工
 * `ReportMetricBlock` 发**数值 + 单位**，格式化（百分号、正负号、小数位）在前端；
 * `paragraph` / `list` 发的是**数据级中文叙述**（结论句、下一步建议），与题库题干同性质。
 * 两侧的口径说明（样本量、采集时间、引擎清单、指标版本）走 `methodology`，
 * 免责声明走词典 `report.disclaimer`——它是产品口径，不是数据。
 */
import type { AssertComplete, ValuesAreComplete } from './completeness';
import type { SampleSizeGrade } from './types';
import type { EngineId } from './types-collection';

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/** 三种报告版本（产品定义 §3.9）。 */
export type ReportVariant = 'executive' | 'detailed' | 'white_label';

export const REPORT_VARIANT_VALUES = [
  'executive',
  'detailed',
  'white_label',
] as const satisfies readonly ReportVariant[];

/** 导出格式。PDF / PNG 需要桌面端的原生渲染能力，Excel 明细在 demo 里用 CSV 承担。 */
export type ExportFormat = 'markdown' | 'html' | 'csv' | 'docx' | 'pdf' | 'png';

export const EXPORT_FORMAT_VALUES = [
  'markdown',
  'html',
  'csv',
  'docx',
  'pdf',
  'png',
] as const satisfies readonly ExportFormat[];

/**
 * demo 里**产不出**的格式：按钮照旧渲染（产品负责人要看到完整的导出面），但置灰并给提示。
 *
 * 理由：`docx` 需要文档库、`pdf` / `png` 需要原生渲染或 canvas，纯前端 demo 不引这些依赖
 * （AGENTS 规则 9 的同族取舍：不在 demo 里造一份注定要重写的能力）。
 * 已登记进 `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`。
 */
export const DESKTOP_ONLY_EXPORT_FORMATS: readonly ExportFormat[] = ['docx', 'pdf', 'png'];

/** 报告区块的种类。 */
export type ReportBlockKind = 'paragraph' | 'metric' | 'table' | 'list';

export const REPORT_BLOCK_KIND_VALUES = [
  'paragraph',
  'metric',
  'table',
  'list',
] as const satisfies readonly ReportBlockKind[];

/** 数值的单位：决定前端怎么格式化（比率 / 打分 / 条数）。 */
export type ReportMetricUnit = 'percent' | 'score' | 'count';

// ---------------------------------------------------------------------------
// 区块
// ---------------------------------------------------------------------------

/** 一段叙述（数据级中文）。 */
export interface ReportParagraphBlock {
  kind: 'paragraph';
  text: string;
}

/** 一个数字。`metric` 是稳定记号，查词典 `report.metrics.<metric>`。 */
export interface ReportMetricBlock {
  kind: 'metric';
  metric: string;
  value: number;
  unit: ReportMetricUnit;
  /**
   * 环比变化；无基准轮次时为 null。比率类的单位是**百分点**（`13` = +13 个百分点，
   * **不是** +1300%），条数类的单位是个。
   *
   * 🔴 与 `AlertItem.delta` **同一个口径**（裁定 3 / 差异台账 E-40）：两侧共用
   * `components/format.ts` 的 `metricDeltaText`，不许再出现"这里乘 100、那里不乘"的分支。
   */
  delta: number | null;
}

/** 一张表。`column_keys` 是稳定记号，查词典 `report.columns.<key>`；单元格是已排版的数据串。 */
export interface ReportTableBlock {
  kind: 'table';
  column_keys: string[];
  rows: string[][];
}

/** 一个清单（下一步建议、处方摘要等，数据级中文）。 */
export interface ReportListBlock {
  kind: 'list';
  items: string[];
}

export type ReportBlock =
  | ReportParagraphBlock
  | ReportMetricBlock
  | ReportTableBlock
  | ReportListBlock;

/**
 * 一节。`id` 是稳定记号，查词典 `report.sections.<id>` 得到标题。
 * 版本差异体现在**后端给哪些节**：老板版只有结论 + 数字 + 下一步，执行版带明细与证据附录。
 */
export interface ReportSection {
  id: string;
  blocks: ReportBlock[];
}

// ---------------------------------------------------------------------------
// 口径说明（产品定义 §3.9「报告口径说明页」，建立行业信任的关键设计）
// ---------------------------------------------------------------------------

export interface ReportMethodology {
  round_label: string;
  sample_size: number;
  sample_size_grade: SampleSizeGrade;
  collected_at: string;
  engines: EngineId[];
  /** 模型版本清单（数据，例如 `doubao-seed-1.8`）。 */
  model_versions: string[];
  prompt_set_label: string;
  prompt_set_version: number;
  metric_spec_version: string;
  /** 重复采样次数；>1 时界面要说明"关键指标是区间不是单点"。 */
  repeat_count: number;
}

/** 白标信息（服务商版能力，MVP 里作为报告的一种版本先走查界面）。 */
export interface WhiteLabelProfile {
  agency_name: string;
  contact: string;
  logo_url: string | null;
}

/** `report_render` 的入参。 */
export interface ReportRenderOptions {
  variant: ReportVariant;
  white_label?: WhiteLabelProfile | null;
  /** 证据附录：原始回答片段 + 引擎 + 时间戳（可独立导出，用于向老板/客户自证）。 */
  include_evidence?: boolean;
}

/** 一份可直接渲染 / 导出的报告。 */
export interface ReportDocument {
  project_id: string;
  round_id: string;
  variant: ReportVariant;
  /** 品牌名（数据）。标题由前端按 `report.title.<variant>` + 品牌名 + 轮次名组合。 */
  brand_name: string;
  round_label: string;
  generated_at: string;
  /** 老板版的那"3 个数字"；其余版本也用它做页首摘要。 */
  headline: ReportMetricBlock[];
  /** 下一步建议（数据级中文，来自行动中心的 Top 处方）。 */
  next_steps: string[];
  sections: ReportSection[];
  methodology: ReportMethodology;
  white_label: WhiteLabelProfile | null;
}

// ---------------------------------------------------------------------------
// 编译期完整性网
// ---------------------------------------------------------------------------

export type ReportVariantValuesComplete = AssertComplete<
  ValuesAreComplete<ReportVariant, typeof REPORT_VARIANT_VALUES>
>;
export type ExportFormatValuesComplete = AssertComplete<
  ValuesAreComplete<ExportFormat, typeof EXPORT_FORMAT_VALUES>
>;
export type ReportBlockKindValuesComplete = AssertComplete<
  ValuesAreComplete<ReportBlockKind, typeof REPORT_BLOCK_KIND_VALUES>
>;

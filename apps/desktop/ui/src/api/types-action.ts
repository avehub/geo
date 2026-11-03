/**
 * M6 GEO 行动中心的 IPC 契约类型（demo 优先落地，AGENTS 规则 8）。
 *
 * # 口径来自哪里
 * 产品定义 §3.8：自动处方 Top 10（影响范围 / 预期收益 + 依据 / 实施难度 / 负责人建议 /
 * 可交付物模板）、四类处方库（官网与内容结构化 / 信源布局 / 事实纠错 / 内容生产）、
 * 执行跟踪与**闭环归因**（"做完这 3 项 → 豆包提及率 +18%"）、合规红线（生成内容默认待人工审核）。
 *
 * # 🔴 demo 的边界（AGENTS 规则 9）
 * - 处方**不是算出来的**：真后端按诊断结果排序生成，demo 端出种子里写好的 10 条；
 * - `content_generate` **不调模型**：返回种子里预置的那份文稿（按模板种类挑），
 *   界面上明确标注"演示文稿"，绝不伪装成模型产物；
 * - 归因卡片是**静态对照**：两轮种子里的数字，不做差值计算以外的推断。
 *
 * # 合规（AGENTS 规则 6）
 * `GeneratedContent.status` 默认 `pending_review`；`compliance_checked` 只表示"跑过红线词扫描"，
 * 不代表内容可以直接发布。处方的 `impact` 用高/中/低三档 + 依据，不承诺任何排名结果。
 */
import type { AssertComplete, ValuesAreComplete } from './completeness';
import type { ContentStatus } from './types';
import type { EngineId } from './types-collection';
import type { ExportFormat } from './types-report';

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/** 四类处方库（产品定义 §3.8）。 */
export type ActionCategory =
  | 'site_structure'
  | 'source_layout'
  | 'fact_correction'
  | 'content_production';

export const ACTION_CATEGORY_VALUES = [
  'site_structure',
  'source_layout',
  'fact_correction',
  'content_production',
] as const satisfies readonly ActionCategory[];

/** 执行跟踪的三态。 */
export type ActionStatus = 'todo' | 'in_progress' | 'done';

export const ACTION_STATUS_VALUES = [
  'todo',
  'in_progress',
  'done',
] as const satisfies readonly ActionStatus[];

/** 预期收益与实施难度共用三档（界面分别查 `action.impact.*` / `action.difficulty.*`）。 */
export type ActionLevel = 'high' | 'medium' | 'low';

export const ACTION_LEVEL_VALUES = [
  'high',
  'medium',
  'low',
] as const satisfies readonly ActionLevel[];

/** 归因卡片里的指标记号（稳定 id，界面查词典 `action.attributionMetrics.<id>`）。 */
export type AttributionMetricKey =
  | 'brand_coverage'
  | 'top3_rate'
  | 'fact_error_count'
  | 'negative_rate';

export const ATTRIBUTION_METRIC_VALUES = [
  'brand_coverage',
  'top3_rate',
  'fact_error_count',
  'negative_rate',
] as const satisfies readonly AttributionMetricKey[];

/** 内容模板种类（M6 第 4 类处方：一键生成 GEO 友好内容）。 */
export type ContentTemplateKind =
  | 'qa_article'
  | 'comparison_table'
  | 'spec_card'
  | 'case_card'
  | 'faq_page'
  | 'glossary_page';

export const CONTENT_TEMPLATE_KIND_VALUES = [
  'qa_article',
  'comparison_table',
  'spec_card',
  'case_card',
  'faq_page',
  'glossary_page',
] as const satisfies readonly ContentTemplateKind[];

// ---------------------------------------------------------------------------
// 处方
// ---------------------------------------------------------------------------

/** 一条行动处方。 */
export interface ActionItem {
  id: string;
  project_id: string;
  /** 产出这条处方的那一轮（归因时要用它对齐复测轮次）。 */
  round_id: string;
  category: ActionCategory;
  /** Top-N 里的名次（1 起）。 */
  rank: number;
  /** 处方标题（数据级中文）。 */
  title: string;
  /** 依据：为什么开这条（数据级中文，须能回指到诊断证据）。 */
  rationale: string;
  impact: ActionLevel;
  difficulty: ActionLevel;
  /** 负责人建议（数据级中文，例如"市场负责人 + 前端外包"）。 */
  owner_hint: string;
  /** 可交付物模板说明（数据级中文）。 */
  deliverable: string;
  affected_prompt_count: number;
  affected_engines: EngineId[];
  /** 关联的事实核查问题 id（`FactCheckIssue.id`），界面用来跳到证据。 */
  evidence_issue_ids: string[];
  /** 预计 1 小时内可完成（产品定义 §3.8 验收：≥3 条）。 */
  quick_win: boolean;
  status: ActionStatus;
  completed_at: string | null;
  updated_at: string;
}

/** 归因卡片里的一个指标对照。 */
export interface AttributionMetric {
  metric: AttributionMetricKey;
  before: number;
  after: number;
  /** `percent` = 0~1 的比率（界面乘 100 显示百分点）；`count` = 条数。 */
  unit: 'percent' | 'count';
}

/**
 * 闭环归因卡片：基线轮 → 复测轮，中间完成了哪几条动作。
 *
 * 🔴 `summary` 是数据级中文（"完成 3 项后…"），但**数字来自 `metrics`**：
 * 界面渲染时以 `metrics` 为准，`summary` 只作叙述，避免"文案说 +18%、表里是 +12%"这种自相矛盾。
 */
export interface AttributionCard {
  id: string;
  project_id: string;
  baseline_round_id: string;
  baseline_label: string;
  retest_round_id: string;
  retest_label: string;
  action_ids: string[];
  summary: string;
  metrics: AttributionMetric[];
}

// ---------------------------------------------------------------------------
// 内容生产
// ---------------------------------------------------------------------------

/** 一个内容模板。`section_keys` 是稳定记号，界面查词典 `action.templateSections.<key>`。 */
export interface ContentTemplate {
  id: string;
  kind: ContentTemplateKind;
  section_keys: string[];
  export_formats: ExportFormat[];
  /** 适配哪几类处方（界面按当前动作过滤模板）。 */
  target_categories: ActionCategory[];
}

/** 一份生成好的文稿。demo 里 `body_markdown` 是种子预置的演示文稿。 */
export interface GeneratedContent {
  id: string;
  project_id: string;
  action_id: string | null;
  template_id: string;
  title: string;
  body_markdown: string;
  /** 默认 `pending_review`（AGENTS 规则 6 / 产品定义 §3.8 合规红线）。 */
  status: ContentStatus;
  compliance_checked: boolean;
  export_formats: ExportFormat[];
  created_at: string;
  updated_at: string;
}

/** 行动中心首屏：处方 + 归因 + 文稿 + 模板（一次往返，页面四个区块共用）。 */
export interface ActionBoard {
  actions: ActionItem[];
  attribution: AttributionCard[];
  contents: GeneratedContent[];
  templates: ContentTemplate[];
}

// ---------------------------------------------------------------------------
// 编译期完整性网
// ---------------------------------------------------------------------------

export type ActionCategoryValuesComplete = AssertComplete<
  ValuesAreComplete<ActionCategory, typeof ACTION_CATEGORY_VALUES>
>;
export type ActionStatusValuesComplete = AssertComplete<
  ValuesAreComplete<ActionStatus, typeof ACTION_STATUS_VALUES>
>;
export type ActionLevelValuesComplete = AssertComplete<
  ValuesAreComplete<ActionLevel, typeof ACTION_LEVEL_VALUES>
>;
export type AttributionMetricValuesComplete = AssertComplete<
  ValuesAreComplete<AttributionMetricKey, typeof ATTRIBUTION_METRIC_VALUES>
>;
export type ContentTemplateKindValuesComplete = AssertComplete<
  ValuesAreComplete<ContentTemplateKind, typeof CONTENT_TEMPLATE_KIND_VALUES>
>;

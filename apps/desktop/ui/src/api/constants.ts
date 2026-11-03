/**
 * 与后端共享的常量。改这里必须同步改 `crates/geo-domain/src/csv_io.rs`，
 * 否则导入会因表头校验失败而整批被拒。
 */

/** 对应 Rust `PROMPT_CSV_HEADER`。 */
export const PROMPT_CSV_HEADER = [
  'text',
  'intent',
  'weight',
  'group_name',
  'tags',
  'source',
  'repeat_count',
] as const;

/** 对应 Rust `COMPETITOR_CSV_HEADER`。 */
export const COMPETITOR_CSV_HEADER = ['name', 'aliases', 'website', 'note', 'position'] as const;

/** 对应 Rust `ASSET_CSV_HEADER`。 */
export const ASSET_CSV_HEADER = ['kind', 'url', 'title', 'note'] as const;

/** 对应 Rust `SUFFICIENT_SAMPLE_SIZE`。 */
export const SUFFICIENT_SAMPLE_SIZE = 60;
/** 对应 Rust `MINIMUM_SAMPLE_SIZE`。 */
export const MINIMUM_SAMPLE_SIZE = 30;

/**
 * M4 人工复核队列的置信度门槛：`AnswerInsight.confidence` 低于它的条目进复核队列。
 *
 * ⚠ 与上面两个常量不同，这个**在 Rust 侧还不存在**（M4 尚未落后端）：今天它是 demo 与
 * 界面共用的展示口径，`demo/seed/insights.ts` 的 `needs_review` 静态值按它编排，
 * `pages/InsightPage.tsx` 用它解释"为什么这几条进了复核队列"。真后端落地时以
 * `crates/geo-domain` 的抽取质量口径为准，若数值不同则改这里并在
 * `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md` 登记。
 *
 * 放在 `api/constants.ts`（而不是留在种子里）是因为**页面也要用**：页面 import 种子模块
 * 会让"界面文案依赖演示数据"这条反向依赖长出来，等真后端接上就得回来拆。
 */
export const REVIEW_CONFIDENCE_FLOOR = 0.75;

// ---------------------------------------------------------------------------
// M5.5 站长数据（spec `2026-10-12-webmaster-data-integration-design.md`，DR-98 / DR-105 / DR-116 / DR-118）
// ---------------------------------------------------------------------------

/**
 * 🔴 下面这一节**在 Rust 侧还不存在**（本轮 Rust 零改动，差异台账 §4h E-67 起），
 * 定位与上面的 `REVIEW_CONFIDENCE_FLOOR` 同族：demo 与界面共用的展示 / 判定口径。
 * Plan C 落后端时以 `crates/geo-domain` 为准，数值不同就改这里并在差异台账登记。
 *
 * ⚠ 表头常量与本文件上面那三张（`PROMPT_CSV_HEADER` 一族）的纪律**不同**：
 * 那三张逐字镜像 `csv_io.rs`，这三张是前端自己的模板（真后端要用 `calamine` 重写解析，E-72）。
 */

/** 数据截至日超过这个天数就挂"陈旧"告警（DR-105：覆盖"月度导出"节奏；**当天不算、次日算**）。 */
export const STALE_AFTER_DAYS = 35;

/** L1 自有抽样与 L3 控制台数字的差异率阈值，超过就出一条对账差异事件（DR-116，先拍后调）。 */
export const RECONCILE_DIVERGENCE = 0.3;

/** 站点自建索引快照的留存窗口（DR-118：400 天，覆盖同比）。 */
export const SELF_INDEX_RETENTION_DAYS = 400;

/**
 * 三张导入模板的表头（DR-98）。🔴 **按指标形状分，不按平台分**：
 * - `SEARCH_QUERY_CSV_HEADER`：**query 表**（关键词维度；GSC 导出与头条 / 百度传统面的关键词表
 *   都是这个形状，用户只需改列名——或者干脆不改，直接走粘贴解析按表头认列，DR-113）；
 * - `SEARCH_PAGE_CSV_HEADER`：**page 表**（页面维度；百度《AI 流量分析》的「热门页面」表就是这个形状）；
 * - `SEARCH_AI_SUMMARY_CSV_HEADER`：**ai 汇总表**（`SearchAiOverview` 的形状，没有 query 维度）。
 *
 * 🔴 列名 == `api/search-mapping.ts` 的**规范列名**（identity 兜底认得），所以模板本身就是
 * "映射表的一个视图"，不是第二套词表。🔴 比率列一律叫 `*_check`：平台给的点击率**只作交叉校验**，
 * 入库与展示按 A 类求和后的分子 ÷ 分母重算（DR-95 B 类 / DR-98）。
 *
 * 🔴 **刻意没有第四张"站内分析模板"**：百度统计的会话数是**站内量纲**（DR-95 C 类 + DR-110 护栏 2），
 * 给它一张与曝光并列的模板就等于暗示它能进合计。它走人工填报 / 粘贴，认不出的列进
 * `native_extras` 单独展示并标注平台；样本量口径复用上面的 `MINIMUM_SAMPLE_SIZE`
 * （DR-115：🔴 不新造第二个样本量常量）。
 *
 * 🔴 百度官方导出的表头原文（`关键词|AI引用量|AI曝光量|AI点击量|AI点击率` 与 `页面|…`）
 * **不是模板**，是目录表 `baidu_ziyuan_ai` 的 `alias_columns`（DR-108，一级出处见
 * `fixtures/search/README.md`）：我们不改客户的导出文件，我们认它的列名。
 */
export const SEARCH_QUERY_CSV_HEADER = [
  'query',
  'page_url',
  'impressions',
  'clicks',
  'ctr_check',
  'citations',
] as const;

/** page 表（页面维度）。 */
export const SEARCH_PAGE_CSV_HEADER = [
  'page_url',
  'impressions',
  'clicks',
  'ctr_check',
  'citations',
] as const;

/** ai 汇总表（`SearchAiOverview` 的形状：没有 query 维度，`ai_ctr` 的分母是**引用量**）。 */
export const SEARCH_AI_SUMMARY_CSV_HEADER = [
  'citations',
  'impressions',
  'ai_clicks',
  'ai_ctr_check',
  'cited_pages',
] as const;

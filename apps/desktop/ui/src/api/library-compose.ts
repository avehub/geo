/**
 * 素材库的**导出文本**组装（M1.5，spec `2026-09-30-keyword-faq-library-design.md` DR-44）。
 *
 * 与 `content-compose.ts` / `report-compose.ts` 同族：导出物在**前端**组装，落盘走既有的
 * `export_write_file`（🔴 不新增导出命令）。
 *
 * # 两个产物
 * - **关键词 CSV**：给运营贴进表格软件、或按列排期改官网页面用；
 * - **FAQ 的 `FAQPage` JSON-LD**（schema.org）：贴进官网页面的 `head`，
 *   搜索引擎与 AI 助手可以直接读到问答对——这是"引用素材去优化网站"最硬的一条出口。
 *
 * # 🔴 JSON-LD 只收 `status === 'approved'`
 * 待审与已退回的答案不该被贴到官网上（AGENTS 规则 6 的落点）：`pending_review` 意味着
 * "AI 生成、还没人看过"，把它当事实发布出去正是 GEO 场景里最容易翻车的一类错误。
 * 零条可用时返回 `null`，界面据此置灰按钮并说明原因（而不是导出一份空壳）。
 *
 * # 🔴 答案按 Markdown **原文**进 `text`
 * 不做 Markdown → HTML 渲染（与 `content-compose.ts` 对 `html` 那一支同一个取舍：不引解析器）。
 * schema.org 允许 `text` 是纯文本；Plan C 若要出富文本，在 Rust 侧渲染后再进 JSON-LD。
 *
 * # 关键词行上的站长数据汇总（M5.5 增量，DR-101）
 * 见文件末尾的 `withSearchAggregate`：把 `api/search-compose.ts` 算出来的跨平台汇总
 * 按**规范化词面**挂到关键词行上，🔴 拼不上就是 `null`（不显示空占位、不用 0 冒充）。
 *
 * # 关于 CSV 转义的第二份实现（工程债，Plan C 收口）
 * 这里的 `csvCell` 与 `demo/handlers/shared.ts` 的 CSV 写盘**刻意不共用**：那边镜像的是
 * csv crate 的写盘口径、服务 `*_export_csv` 那几条命令（真值源 `crates/geo-domain/src/csv_io.rs`），
 * 这边是前端把**素材**导成一张表。🔴 Plan C 把关键词导出落进 `csv_io.rs` 之后，
 * 本文件的 CSV 那一半应当整段退役（JSON-LD 那一半留在前端）。
 */
import { aggregateForKeywordRow } from './search-compose';
import type { KeywordSearchAggregate } from './search-compose';
import type { FaqItem, KeywordItem } from './types';
import type { SearchQueryMetric } from './types-search';

/**
 * 关键词 CSV 的表头。
 *
 * 🔴 **刻意不放进 `api/constants.ts`**：那个文件的口径是「与 Rust 的 `csv_io.rs` 逐字同步，
 * 改一处必须改另一处」，而这张表在 Rust 侧**还不存在**（差异台账 §4d）。放在这里，
 * 等 Plan C 决定要不要收进 `csv_io.rs` 时再搬家。
 */
export const KEYWORD_CSV_HEADER = [
  'text',
  'kind',
  'intent',
  'priority',
  'monthly_volume',
  'difficulty',
  'status',
  'note',
] as const;

/** 需要加引号的字符：分隔符、引号本身、两种换行（与 csv crate 的默认口径同形）。 */
const MUST_QUOTE = /[",\n\r]/;

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return MUST_QUOTE.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** 文件名：一律 ASCII（下载属性里出现中文会掉，`content-compose.ts` 同一条纪律）。 */
export function keywordCsvFileName(projectId: string): string {
  return `geo-keywords-${projectId}.csv`;
}

/** 关键词 CSV。`rows` 由调用方决定（导出全部还是只导出勾选的那些）。 */
export function composeKeywordCsv(rows: readonly KeywordItem[]): string {
  const lines = [KEYWORD_CSV_HEADER.join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.text),
        csvCell(row.kind),
        csvCell(row.intent),
        csvCell(row.priority),
        csvCell(row.monthly_volume),
        csvCell(row.difficulty),
        csvCell(row.status),
        csvCell(row.note),
      ].join(','),
    );
  }
  // 末行也带换行（csv crate 的默认行为，与 demo 侧写盘一致）。
  return `${lines.join('\n')}\n`;
}

/** `FAQPage` 结构化数据（schema.org）的形状；只用于 `JSON.stringify`，不上屏。 */
export interface FaqJsonLd {
  '@context': 'https://schema.org';
  '@type': 'FAQPage';
  mainEntity: {
    '@type': 'Question';
    name: string;
    acceptedAnswer: { '@type': 'Answer'; text: string };
  }[];
}

export function faqJsonLdFileName(projectId: string): string {
  return `geo-faq-${projectId}.jsonld`;
}

/**
 * 把**已采用**的问答组装成 `FAQPage` JSON-LD。
 *
 * @returns 缩进 2 空格的 JSON 文本；一条可用的都没有时回 `null`（界面置灰按钮，见文件头）。
 */
export function composeFaqJsonLd(rows: readonly FaqItem[]): string | null {
  const adopted = rows.filter((row) => row.status === 'approved');
  if (adopted.length === 0) return null;

  const payload: FaqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: adopted.map((row) => ({
      '@type': 'Question',
      name: row.question,
      acceptedAnswer: { '@type': 'Answer', text: row.answer_markdown },
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** 已采用的条数（界面的「收录 N 条」那句要用，与 `composeFaqJsonLd` 同一个筛选口径）。 */
export function adoptedFaqCount(rows: readonly FaqItem[]): number {
  return rows.filter((row) => row.status === 'approved').length;
}

// ---------------------------------------------------------------------------
// 站长数据汇总拼到关键词行上（M5.5，spec `2026-10-12-webmaster-data-integration-design.md` DR-101）
// ---------------------------------------------------------------------------

/**
 * 关键词行 + 它的站长数据汇总。
 *
 * 🔴 `searchAggregate` **可空**，而且空是常态：客户只接了一两个平台、或关键词库里有一批
 * 还没被任何平台记录过的词（DR-100 规则 2 的"有需求没内容"正是从这批词里长出来的）。
 * 界面据此**不渲染**那一格的空占位——"这个词零曝光"与"我们没接这个词的数据"是两个
 * 完全相反的结论，用 0 顶替就是把后者伪装成前者（同 `SearchQueryMetric` 指标可空那条裁定）。
 */
export interface KeywordRowWithSearch extends KeywordItem {
  searchAggregate: KeywordSearchAggregate | null;
}

/**
 * 给一批关键词行挂上站长数据汇总（DR-101 / 走查清单第 16 条）。
 *
 * 词面匹配走 `search-compose.ts` 的 `queryKeyOf`（大小写 / 全半角 / 空白全归一）：
 * 平台导出的「GEO 优化」要能拼到关键词库里的「geo优化」上，差一个空格就拼不上，
 * 界面上就成了一个静默的假阴性。
 *
 * 🔴 这里**不算任何数字**：求和、点击率重算、区间交集与完整性判定全在 `aggregateForKeywordRow`
 * 里（DR-97 ④：汇总不进命令面，demo 与桌面端共用同一份纯函数）。
 *
 * @param asOf "今天"（`YYYY-MM-DD`），用来判这组数字是否已陈旧（`STALE_AFTER_DAYS`）。
 */
export function withSearchAggregate(
  rows: readonly KeywordItem[],
  metrics: readonly SearchQueryMetric[],
  asOf: string,
): KeywordRowWithSearch[] {
  return rows.map((row) => ({
    ...row,
    searchAggregate: aggregateForKeywordRow(row.text, metrics, asOf),
  }));
}

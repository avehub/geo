/**
 * M5.5 站长数据的**唯一真算写路径**：`search_metric_import_csv`。
 * 源档案那 5 条在 `handlers/search.ts`（拆两个文件守 AGENTS「单文件约 400 行」那条软线，
 * 照 `site.ts` / `site-patch.ts` 与 `article.ts` / `article-schedule.ts`）。
 * 设计规格 `docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md`（DR-98 / DR-107 / DR-109 / DR-113）。
 *
 * # 🔴 一条命令吃三种"文本从哪来"（DR-113：粘贴是**一等**接入形态，不是 CSV 的替代）
 * `payload` 就是字符串（照 `prompt_set_import_csv` 的取舍）：
 * ① 后台复制出来的表格（TSV / HTML 表格 / 逗号）→ `api/search-paste.ts` 的 `parsePastedTable`；
 * ② 浏览器 `FileReader` 读出来的 xlsx（`data:...;base64,` 或裸 base64）→ 解码后走
 *   `api/search-xlsx.ts` 的 `parseXlsxTable`；
 * 🔴 两支**共用同一份认列与校验**（`parseTableGrid`）：映射表只有一处真值源（DR-107 ↔ DR-108），
 * 所以"粘贴能认的列，导入也一定能认"是结构性成立的，不是两份代码碰巧对齐。
 *
 * # 🔴 四件照 DR-98 做的事
 * ① **行级容错**，不是整批回滚（照 `demo/handlers/prompt-csv.ts`）：坏行进 `errors`、好行照样入库；
 *   **表头级**认不出才是整批被拒（`parseTableGrid` 回 `tableRejection`）⇒ 那一支由 handler 抛稳定错误码，
 *   逐行原因放进 `detail`（照 `prompt_set/empty_import` 的口径）；
 * ② `warnings` **不阻断**：平台自己给的点击率只作交叉校验，我们一律按重算值入库
 *   （灰度期平台口径本身可能在变，DR-95 B 类"只能重算不能平均"）；
 * ③ **0 数据行 = 成功**（判据钉在真实 fixture 上：百度官方导出的空表只有表头，
 *   `fixtures/search/README.md`）⇒ 不删旧行、不改合计，但**照样回写源的截至日**：
 *   "这个文件对应 9 月这一批"这件事本身就是用户确认过的信息；
 * ④ **同周期同源覆盖旧行** ⇒ 刻意没有 `search_metric_delete`（DR-97 ②：删除是导入的一个分支）。
 *
 * # 🔴 区间靠导入时确认（DR-98 实测：百度那份导出**没有日期列**）
 * `period_start` / `period_end` 是**必填**入参，入库一律记 `window_source: 'user_stated'`
 * ——文案写"区间由导入时确认"而不是"平台声明"。`data_through` 由目录表的 `resolveDataThrough`
 * 推（平台可用日与区间末日**取更早的那个**，DR-109），不是直接抄 `period_end`。
 *
 * # AI 汇总表
 * `SEARCH_AI_SUMMARY_CSV_HEADER`（`citations / impressions / ai_clicks / ai_ctr_check / cited_pages`）
 * 没有维度列，`parseTableGrid` 对 `citations` / `ai_clicks` 的汇总表走 `SearchAiOverview` 分支，
 * 不要求 query / page_url；`ai_impressions` 与 citations / clicks 一起从同一份全站汇总表入库。
 *
 * # 语言约束（门禁 7 / §B-11）
 * 本目录非注释 CJK 必须为 0 ⇒ 这里的字符串常量全是 ASCII；平台原文列名（`备注` 一类）是**数据**，
 * 由 `api/search-paste.ts` 从 payload 里读出来、原样进 `native_extras.label`（DR-107），不经过本文件。
 */
import type { DemoDb, DemoHandler } from '../types';
import { demoError } from '../types';
import { getDemoDb } from '../db';
import { resolveDataThrough } from '../../api/search-catalog';
import { MAPPING_VERSION } from '../../api/search-mapping';
import type { SearchTableParseResult, SearchTableRow } from '../../api/search-paste';
import { parsePastedTable } from '../../api/search-paste';
import { isXlsxBytes, parseXlsxTable } from '../../api/search-xlsx';
import type {
  SearchAiOverview,
  SearchMetricImportResult,
  SearchNativeExtra,
  SearchQueryMetric,
  SearchSourceKind,
  SearchSurface,
} from '../../api/types';
import { asString, newId, nowIso, requireProject } from './shared';
import { markSourceImported, requireSourceKind } from './search';

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** `.xlsx` 的官方 MIME（`data:` URI 那一支只认它；别的 MIME 一律拒，不猜）。 */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** `data:<mime>[;<param>]*;base64,<body>`（浏览器 `FileReader.readAsDataURL` 的产物）。 */
const DATA_URI = /^data:([^;,]*)(?:;[^,]*)?,([\s\S]*)$/;

/** 裸 base64 的字符集。🔴 逗号 / 制表符 / 非 ASCII 都不在里面 ⇒ 粘贴出来的表格永远不会误判成 xlsx。 */
const BASE64_SHAPE = /^[A-Za-z0-9+/\r\n]+=*$/;

/** 日期入参的形状（`YYYY-MM-DD`；`data_through` 是**日期**不是时间戳，DR-109）。 */
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 哪个源的导入落在 `ai_answer` 面上（DR-94：同一张指标表装两面而不混淆）。
 * 🔴 由**源**决定、不由列决定：百度传统面与 AI 面是目录表里**两个源**，
 * 而两者的导出列名高度重合（都有"关键词/曝光/点击"）⇒ 拿列去猜面一定会猜错。
 * 其余源（含 `manual` 兜底与海外两家）都是传统搜索面。
 */
const AI_ANSWER_SOURCES: readonly SearchSourceKind[] = ['baidu_ziyuan_ai'];

// ---------------------------------------------------------------------------
// 入参收窄
// ---------------------------------------------------------------------------

/** 区间入参：必填 + 必须是日期（🔴 不收时间戳——`period_*` 是**日**粒度，DR-109）。 */
function requireDate(value: unknown, field: string): string {
  const raw = asString(value).trim();
  if (raw === '') {
    throw demoError('validation/failed', { field, reason: 'required' });
  }
  if (!DATE_SHAPE.test(raw)) {
    throw demoError('validation/failed', { field, reason: 'invalid_format', value: raw });
  }
  return raw;
}

/** base64 → 字节；解不出来一律 `null`（**不猜**：认不出就当它不是 xlsx，走文本那一支）。 */
function decodeBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * payload → 与粘贴**同一份**解析结论。
 *
 * 🔴 判定顺序即语义：先看是不是 `data:` URI（是就按 MIME 认，认不出**直接拒**、不退回文本那一支
 * ——把一份 PDF 当表格解析，只会得到一句"表头认不出"，而客户真正需要知道的是"这个文件不是 xlsx"）；
 * 再看裸 base64 解出来是不是 zip（`isXlsxBytes` 验魔数）；都不是才当粘贴文本。
 */
function parsePayload(payload: string, kind: SearchSourceKind): SearchTableParseResult {
  const trimmed = payload.trim();
  if (trimmed === '') {
    throw demoError('validation/failed', { field: 'payload', reason: 'empty', value: '' });
  }

  if (trimmed.startsWith('data:')) {
    const matched = DATA_URI.exec(trimmed);
    const mime = (matched?.[1] ?? '').trim().toLowerCase();
    if (mime !== XLSX_MIME) {
      throw demoError('validation/failed', { field: 'payload', reason: 'not_allowed', value: mime });
    }
    const bytes = decodeBase64(matched?.[2] ?? '');
    // 声明是 xlsx 但魔数不对 ⇒ 交给 `parseXlsxTable` 出 `parse_failed` 结论（同一套 reason 词表）。
    return bytes === null
      ? parseXlsxTable(new Uint8Array(0), kind)
      : parseXlsxTable(bytes, kind);
  }

  if (trimmed.length >= 8 && BASE64_SHAPE.test(trimmed)) {
    const bytes = decodeBase64(trimmed);
    if (bytes !== null && isXlsxBytes(bytes)) return parseXlsxTable(bytes, kind);
  }

  // 🔴 传**原始** payload 而不是 `trimmed`：物理行号要与客户那份文件对得上（DR-113 ③），
  // 先 trim 掉的前导空行会让所有错误行号整体往上挪。
  return parsePastedTable(payload, kind);
}

// ---------------------------------------------------------------------------
// 解析结论 → 落库对象
// ---------------------------------------------------------------------------

/** 数字列取值：只有**真的是有限数**才算数，其余一律 `null`（🔴 不是 0，DR-94）。 */
function numberOf(value: string | number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 文本列取值（`query` 那一格另有口径：按页面汇总的行可以是空串）。 */
function textOf(value: string | number | null | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * B 类只能**重算**（DR-95 / DR-98）：`clicks ÷ impressions`。
 * 🔴 分母缺失或为 0 ⇒ `null`，**不回落 0**：一个"点击率 0%"的行会被读成"有曝光没人点"，
 * 而真相是"平台没给这两个数"（百度统计那三行就是这个形状）。
 */
function recalculatedCtr(clicks: number | null, impressions: number | null): number | null {
  if (clicks === null || impressions === null || impressions === 0) return null;
  return clicks / impressions;
}

/** 一行解析结论 → 一行 `SearchQueryMetric`。 */
function makeMetric(
  row: SearchTableRow,
  context: {
    projectId: string;
    kind: SearchSourceKind;
    surface: SearchSurface;
    periodStart: string;
    periodEnd: string;
    dataThrough: string;
    importedAt: string;
  },
): SearchQueryMetric {
  const cells = row.cells;
  const impressions = numberOf(cells.impressions);
  const clicks = numberOf(cells.clicks);
  return {
    id: newId(),
    project_id: context.projectId,
    source_kind: context.kind,
    surface: context.surface,
    // 🔴 `query` 是 `string` 不是 `string | null`（DR-94）：按页面汇总的行维度在 `page_url`，
    // 那种行的 `query` 是**空串**——空串是"这一行不按关键词分"，`null` 会让它变成"缺数据"。
    query: typeof cells.query === 'string' ? cells.query : '',
    page_url: textOf(cells.page_url),
    impressions,
    clicks,
    ctr: recalculatedCtr(clicks, impressions),
    citations: numberOf(cells.citations),
    // 🔴 行级 `ai_clicks` 今天恒为 `null`：它属于**项目级**汇总表（`SearchAiOverview`），
    // 百度那份热门关键词表里没有这一列 ⇒ 不拿 `clicks` 顶（顶了就是两个口径混在一个字段里）。
    ai_clicks: numberOf(cells.ai_clicks),
    period_start: context.periodStart,
    period_end: context.periodEnd,
    data_through: context.dataThrough,
    imported_at: context.importedAt,
    // 🔴 恒 `full`：用户交给我们一份表，我们无从判断平台有没有少给行。
    // 平台自陈不全（`partial`）与静默采样（`sampled`）都是**源**的属性，由种子/真后端标，
    // 不在导入这一支猜（DR-110）。
    completeness: 'full',
    // 区间由导入时确认（DR-98：百度那份导出没有日期列）⇒ 一律 `user_stated`，
    // 哪怕这个源的导出其实自带区间：一次导入只能确认一个区间，声称"平台声明"就要能逐行对账。
    window_source: 'user_stated',
    mapping_version: MAPPING_VERSION,
  };
}

/**
 * 映射不上的平台原生列 → C 类留档（DR-107：静默丢弃是最坏的失败形态）。
 * 🔴 `extras[j].values` 与 `rows` **同序**（`parseTableGrid` 只为通过校验的行 push），
 * 所以按下标配 `metric_id`；空单元格是 `null`，**原样**留档不做全半角归一
 * ——我们不知道这一列的口径，猜出来的数字比原文更难对账。
 */
function makeNativeExtras(
  parsed: SearchTableParseResult,
  metrics: readonly SearchQueryMetric[],
  projectId: string,
  kind: SearchSourceKind,
  observedAt: string,
): SearchNativeExtra[] {
  const extras: SearchNativeExtra[] = [];
  for (const column of parsed.extras) {
    column.values.forEach((value, index) => {
      const metric = metrics[index];
      if (metric === undefined) return;
      extras.push({
        id: newId(),
        project_id: projectId,
        source_kind: kind,
        label: column.header,
        value,
        metric_id: metric.id,
        observed_at: observedAt,
      });
    });
  }
  return extras;
}

/** 这次解析结论是不是 AI 汇总模板：没有维度列、但带 citations / ai_clicks。 */
function isAiSummaryParsed(parsed: SearchTableParseResult): boolean {
  const canonical = new Set(parsed.columns.map((column) => column.canonical).filter((value) => value !== null));
  return !canonical.has('query') && !canonical.has('page_url') && (canonical.has('citations') || canonical.has('ai_clicks'));
}

/** 从一行或多行 AI 汇总表构造项目级快照：A 类求和，B 类重算。 */
function makeAiOverview(
  parsed: SearchTableParseResult,
  context: {
    projectId: string;
    kind: SearchSourceKind;
    periodStart: string;
    periodEnd: string;
    dataThrough: string;
    importedAt: string;
  },
): SearchAiOverview {
  let citations: number | null = null;
  let aiImpressions: number | null = null;
  let aiClicks: number | null = null;
  let citedPages: number | null = null;
  for (const row of parsed.rows) {
    const rowCitations = numberOf(row.cells.citations);
    const rowImpressions = numberOf(row.cells.impressions);
    const rowClicks = numberOf(row.cells.ai_clicks);
    const rowPages = numberOf(row.cells.cited_pages);
    if (rowCitations !== null) citations = (citations ?? 0) + rowCitations;
    if (rowImpressions !== null) aiImpressions = (aiImpressions ?? 0) + rowImpressions;
    if (rowClicks !== null) aiClicks = (aiClicks ?? 0) + rowClicks;
    if (citedPages === null && rowPages !== null) citedPages = rowPages;
  }
  return {
    id: newId(),
    project_id: context.projectId,
    source_kind: context.kind,
    citations,
    ai_impressions: aiImpressions,
    ai_clicks: aiClicks,
    // B 类：分母是引用量，不是曝光量（DR-95 / DR-98）。
    ai_ctr: aiClicks !== null && citations !== null && citations > 0 ? aiClicks / citations : null,
    cited_pages: citedPages,
    period_start: context.periodStart,
    period_end: context.periodEnd,
    data_through: context.dataThrough,
    imported_at: context.importedAt,
    completeness: 'full',
    window_source: 'user_stated',
    mapping_version: MAPPING_VERSION,
  };
}

/** AI 汇总表的未知列没有 metric 行可挂 ⇒ 作为表级 C 类留档（`metric_id: null`）。 */
function makeSummaryExtras(
  parsed: SearchTableParseResult,
  projectId: string,
  kind: SearchSourceKind,
  observedAt: string,
): SearchNativeExtra[] {
  return parsed.extras.flatMap((column) =>
    column.values.map((value) => ({
      id: newId(),
      project_id: projectId,
      source_kind: kind,
      label: column.header,
      value,
      metric_id: null,
      observed_at: observedAt,
    })),
  );
}

/** 同周期同源的 AI 汇总整批覆盖（与指标行同一口径：重复导入不叠数）。 */
function replaceAiOverviewSlot(
  db: DemoDb,
  projectId: string,
  kind: SearchSourceKind,
  periodStart: string,
  periodEnd: string,
  overview: SearchAiOverview,
  nativeExtras: readonly SearchNativeExtra[],
): void {
  const inSlot = (row: SearchAiOverview): boolean =>
    row.project_id === projectId &&
    row.source_kind === kind &&
    row.period_start === periodStart &&
    row.period_end === periodEnd;
  const replacedStamps = new Set(db.searchAiOverviews.filter(inSlot).map((row) => row.imported_at));
  db.searchAiOverviews = db.searchAiOverviews.filter((row) => !inSlot(row));
  db.searchNativeExtras = db.searchNativeExtras.filter(
    (row) => !(row.source_kind === kind && row.metric_id === null && replacedStamps.has(row.observed_at)),
  );
  db.searchAiOverviews.push(overview);
  db.searchNativeExtras.push(...nativeExtras);
}

/**
 * 同周期同源**整批覆盖**（DR-97 ②）：先记下被替换掉的行 id，再连带清掉挂在它们上面的 C 类留档
 * ——留着就是"一个平台独有维度指着一条已经不存在的指标行"，界面上点不开出处。
 *
 * 🔴 `metrics.length === 0` 时**一次都不删**（0 数据行 = 成功，判据钉在真实空表 fixture 上）：
 * 一份只有表头的导出说明"这个月这个源没有量"，不等于"把这个源的历史都抹掉"。
 */
function replaceSlot(
  db: DemoDb,
  projectId: string,
  kind: SearchSourceKind,
  periodStart: string,
  periodEnd: string,
  metrics: readonly SearchQueryMetric[],
  nativeExtras: readonly SearchNativeExtra[],
): void {
  // 🔴 0 数据行 = 导入成功但**不清槽**（DR-98：真实客户的第一份导出往往就是空表）。
  // 一份空文件把上一批真数据抹掉，比留着旧数据难解释得多；要清就重新导一份带行的。
  if (metrics.length === 0) return;

  const inSlot = (row: SearchQueryMetric): boolean =>
    row.project_id === projectId &&
    row.source_kind === kind &&
    row.period_start === periodStart &&
    row.period_end === periodEnd;
  const replacedIds = new Set(db.searchMetrics.filter(inSlot).map((row) => row.id));

  db.searchMetrics = db.searchMetrics.filter((row) => !inSlot(row));
  db.searchNativeExtras = db.searchNativeExtras.filter(
    (row) => !(row.metric_id !== null && replacedIds.has(row.metric_id)),
  );
  db.searchMetrics.push(...metrics);
  db.searchNativeExtras.push(...nativeExtras);
}

// ---------------------------------------------------------------------------
// search_metric_import_csv
// ---------------------------------------------------------------------------

/**
 * `search_metric_import_csv`：导入一批指标（返回 `SearchMetricImportResult`，行级错误 + 行级警告）。
 *
 * 🔴 校验顺序即语义：**源 → 区间 → 载荷**。区间在载荷之前，因为"这份文件对应哪一段时间"
 * 是用户必须先确认的事（DR-98），而区间不合法时把一整份表解析一遍纯属浪费；
 * 载荷里的**表头级**问题最后才暴露，逐行原因进 `detail`（照 `prompt_set_import_csv`）。
 * 🔴 导入即建档：这个源还没配过也能导——数据真的进来了就说明源可用（`markSourceImported`）。
 */
export const searchMetricImportCsv: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);
  const kind = requireSourceKind(args.kind);

  const periodStart = requireDate(args.period_start, 'period_start');
  const periodEnd = requireDate(args.period_end, 'period_end');
  if (periodStart > periodEnd) {
    throw demoError('validation/failed', {
      field: 'period_start',
      reason: 'out_of_range',
      value: periodStart,
      expected: `<=${periodEnd}`,
    });
  }

  const parsed = parsePayload(asString(args.payload), kind);
  if (parsed.rows.length === 0 && parsed.errors.length > 0) {
    // 表头认不出 / 文件格式不对 ⇒ 一行都没进，整批被拒。`params` 只给三件套（语言中立），
    // **具体是哪一列、哪一行**走 `detail`（前端按 `webmasterData.import.*` 逐条渲染）。
    throw demoError(
      'validation/failed',
      { field: 'payload', reason: parsed.errors[0]?.reason ?? 'empty', value: '' },
      parsed.errors,
    );
  }

  // 🔴 一次写操作只取**一个**时间戳（照 `handlers/action.ts`）：`imported_at` 与源的
  // `updated_at` 语义上是同一刻，分两次 `nowIso()` 跨毫秒就会自相矛盾。
  const importedAt = nowIso();
  // 平台可用日（目录表 `lag_days` 推）与区间末日**取更早的那个**（DR-109）。
  const dataThrough = resolveDataThrough(kind, { period_end: periodEnd, imported_at: importedAt });
  const surface: SearchSurface = AI_ANSWER_SOURCES.includes(kind) ? 'ai_answer' : 'web_search';

  const aiSummary = isAiSummaryParsed(parsed);
  // 0 数据行 = 导入成功但不清槽（DR-98）：AI 汇总也不能用一份空表把旧 summary 抹掉。
  // 普通指标分支的 `replaceSlot` 已有同样的保护；这里必须在构造空 overview 之前分支。
  const emptyAiSummary = aiSummary && parsed.rows.length === 0;
  const metrics = aiSummary
    ? []
    : parsed.rows.map((row) =>
        makeMetric(row, {
          projectId,
          kind,
          surface,
          periodStart,
          periodEnd,
          dataThrough,
          importedAt,
        }),
      );
  const aiOverviews =
    aiSummary && !emptyAiSummary
      ? [makeAiOverview(parsed, { projectId, kind, periodStart, periodEnd, dataThrough, importedAt })]
      : [];
  const nativeExtras = aiSummary
    ? emptyAiSummary
      ? []
      : makeSummaryExtras(parsed, projectId, kind, importedAt)
    : makeNativeExtras(parsed, metrics, projectId, kind, importedAt);

  if (aiSummary && !emptyAiSummary) {
    replaceAiOverviewSlot(
      db,
      projectId,
      kind,
      periodStart,
      periodEnd,
      aiOverviews[0] as SearchAiOverview,
      nativeExtras,
    );
  } else {
    replaceSlot(db, projectId, kind, periodStart, periodEnd, metrics, nativeExtras);
  }
  markSourceImported(db, projectId, kind, dataThrough, importedAt);

  const result: SearchMetricImportResult = {
    metrics: structuredClone(metrics),
    ai_overviews: structuredClone(aiOverviews),
    native_extras: structuredClone(nativeExtras),
    errors: structuredClone(parsed.errors),
    warnings: structuredClone(parsed.warnings),
    data_through: dataThrough,
  };
  return result;
};

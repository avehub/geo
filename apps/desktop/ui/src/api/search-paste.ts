/**
 * 粘贴解析（DR-113：`paste_parse` 是**一等**接入形态，界面上是主按钮，CSV 导入降为次按钮）。
 * 设计规格 `docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md`。
 *
 * # 🔴 为什么这条路径存在（规则 11 / DR-114）
 * 最该接的那批源（百度《AI 流量分析》、GSC 生成式 AI 报告、Bing AI Performance、头条 / 搜狗 / 360）
 * **全都没有读数 API**，而我们**不做模拟登录**（不出借账号密码、三重授权缺"平台授权"、
 * 反法 2025 修订"数据专款"已有判例、风控会打到客户账号上）。⇒ 取数动作发生在**客户自己的浏览器**里：
 * 客户选中表格复制，我们解析文本。我们不持有凭据、不向平台发请求、不绕过任何技术措施。
 *
 * # 🔴 与文件导入共用同一套认列（DR-113："reader 只是文本从哪来的又一个答案"）
 * `parsePastedTable`（文本 → 网格）与 `api/search-xlsx.ts`（xlsx → 网格）最后都落到
 * **同一个** `parseTableGrid`：认列、数字归一、行级错误与必备列判据只有一份实现。
 * 命令面也因此仍是 6 条（`search_metric_import_csv` 同时吃文件与粘贴文本，同 `prompt_set_import_csv`）。
 *
 * # 五条解析纪律
 * ① 嗅探形态（TSV / HTML 表格 / 逗号）；② 按表头文字认列、**不要求列序**（取消"照模板重粘一遍"
 * 那个摩擦）；③ 认不出的列进 `extras` **不静默丢弃**（DR-107）；④ 数字归一（千分位、百分号、
 * 中文"万 / 亿"、全角数字）；⑤ 行级错误指到**粘贴内容的第几行**（表头是第 1 行，
 * 与 `demo/handlers/prompt-csv.ts` 的 `CsvRowError.row` 逐字同口径，DR-98）。
 *
 * # 🔴 表头判据"不猜"（E-72 ③）
 * 一列都认不出 ⇒ `unknown_field`；缺该源已知导出的必备列 ⇒ `missing_header`；两者都是**整批被拒**
 * （照 `csv_io.rs` 的"表头缺列 = 整批被拒"），不是行错误。平台改导出结构时必须**报错**，
 * 静默认错列会让客户在我们这儿看到一个"看起来对"的数字。
 * 反过来：🔴 **只有表头零数据行是成功**（真实客户的第一份导出往往就是空表，DR-98 / §7 变异 ⑧）。
 *
 * # 语言约束（规则 7）
 * `reason` 一律取 `crates/geo-domain/src/error.rs` 那张 reason key 目录里的键，`params` 语言中立
 * ⇒ 界面按当前语言渲染（词典键见下面 `REASON_TO_DICTIONARY_KEY` 的注释）。本文件不产出自然语言。
 */
import {
  SEARCH_CANONICAL_COLUMN_VALUES,
  canonicalColumnOf,
  aliasColumnsOf,
  isNumericColumn,
  requiredMetricColumnsOf,
  tierOf,
} from './search-mapping';
import type { SearchCanonicalColumn } from './search-mapping';
import type { SearchSourceKind } from './types-search';

// ---------------------------------------------------------------------------
// 形状
// ---------------------------------------------------------------------------

/** 文本 / 文件从哪来（`xlsx` 只有 `api/search-xlsx.ts` 会给出）。 */
export type SearchTableFormat = 'tsv' | 'html' | 'csv' | 'xlsx';

/** 一行原始网格：单元格原文 + 它在**粘贴内容 / 工作表**里的物理行号（1 基）。 */
export interface SearchTableRecord {
  cells: string[];
  line: number;
}

/** 一列的认领结论。`canonical === null` ⇒ 这一列进 `extras`（不静默丢弃）。 */
export interface SearchTableColumn {
  /** 表头原文（trim 后；中文照实存，它是数据不是文案）。 */
  header: string;
  /** 原表列序（0 基）。 */
  index: number;
  canonical: SearchCanonicalColumn | null;
}

/** 一行通过校验的数据：规范列 → 归一后的值（数字列是 `number`，文本列是 `string`，空是 `null`）。 */
export interface SearchTableRow {
  /** 物理行号（表头是第 1 行）。 */
  line: number;
  cells: Partial<Record<SearchCanonicalColumn, string | number | null>>;
}

/** 认不出的那一列（C 类"平台独有维度"的原料，DR-107）。`values` 与 `rows` **同序**。 */
export interface SearchTableExtraColumn {
  header: string;
  index: number;
  values: (string | number | null)[];
}

/**
 * 行级错误（三件套照 `CsvRowError`：行号 + reason key + 语言中立 params）。
 *
 * 🔴 `reason` 与词典键的对应（界面按这张表渲染，`webmasterData.import.*`）：
 * `empty` → `errEmptyPayload`；`unknown_field` → `errUnknownHeader`；
 * `missing_header` → `errMissingColumn`；`invalid_format` → `errInvalidNumber`；
 * `required` → `errRequiredCell`；`not_allowed` → `errUnsupportedFile`（文件格式那一支在调用方）。
 */
export interface SearchTableError {
  /** 物理行号（表头是第 1 行）；表头级错误就报表头那一行。 */
  row: number;
  reason: string;
  params?: Readonly<Record<string, string>>;
}

/**
 * 行级**警告**（不阻断导入）。今天只有一种：平台给的点击率与我们重算的值对不上（DR-98）。
 * 🔴 与 `SearchTableError` 刻意分开：警告的行**照样进 `rows`**，界面用
 * `webmasterData.import.warnCtrMismatch` 渲染，用 `doneWithWarnings` 报总数。
 */
export interface SearchTableWarning {
  row: number;
  kind: 'ctr_mismatch';
  params: Readonly<Record<string, string>>;
}

/** 解析结论（🔴 六个字段全是数据，没有一句自然语言）。 */
export interface SearchTableParseResult {
  format: SearchTableFormat;
  columns: SearchTableColumn[];
  rows: SearchTableRow[];
  extras: SearchTableExtraColumn[];
  errors: SearchTableError[];
  warnings: SearchTableWarning[];
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/**
 * 平台给的比率与重算值相差超过它就给行级 warning（DR-98）。
 * 🔴 不阻断：灰度期平台自己的口径也可能在变，而我们**一律按重算值入库**。
 */
export const CTR_CHECK_TOLERANCE = 0.005;

/** 平台用来表示"没有这个数"的占位符（🔴 归一成 `null`，绝不归一成 0，DR-94）。 */
const PLACEHOLDER_CELLS = new Set(['', '-', '--', '—', 'n/a', 'na', 'null', 'none']);

/** A 类可加指标（DR-95）：至少认出一列才允许入库，否则这张表根本不是指标表。 */
const TIER_A_COLUMNS: readonly SearchCanonicalColumn[] = SEARCH_CANONICAL_COLUMN_VALUES.filter(
  (column) => tierOf(column) === 'a',
);

/** 维度列：一行至少要有一个非空维度，否则它落不到任何 query / page 上。 */
const DIMENSION_COLUMNS: readonly SearchCanonicalColumn[] = ['query', 'page_url'];

/** AI 汇总模板的判据：没有维度列，但带 citations / ai_clicks 这类 A 类 AI 面指标。 */
function isAiSummaryHeader(recognized: readonly SearchCanonicalColumn[]): boolean {
  return (
    !recognized.includes('query') &&
    !recognized.includes('page_url') &&
    (recognized.includes('citations') || recognized.includes('ai_clicks'))
  );
}

/** 比率列 → (分子, 分母)：交叉校验按这张表重算（B 类只能重算，DR-95）。 */
const RATIO_CHECKS: readonly { column: SearchCanonicalColumn; numerator: SearchCanonicalColumn; denominator: SearchCanonicalColumn }[] = [
  { column: 'ctr_check', numerator: 'clicks', denominator: 'impressions' },
  { column: 'ai_ctr_check', numerator: 'ai_clicks', denominator: 'citations' },
];

// ---------------------------------------------------------------------------
// 数字归一
// ---------------------------------------------------------------------------

/** 全角数字与符号 → 半角（中文输入法粘出来的 `１２３`、`１２．５％` 都要认）。 */
function toHalfWidth(text: string): string {
  return text.replace(/[\uff01-\uff5e]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  ).replace(/\u00a0/g, ' ');
}

/** 一个单元格的数字解析结论：`ok:false` 时调用方出行级错误（**不许**静默当 0）。 */
export type NumericCell = { ok: true; value: number | null } | { ok: false; raw: string };

/**
 * 数字归一（DR-113 ④）：千分位逗号、百分号、中文"万 / 亿"、全角数字。
 * `1.2万` → `12000`；`12.5%` → `0.125`；空与占位符 → `null`（🔴 不是 0）。
 */
export function parseNumericCell(raw: string): NumericCell {
  const normalized = toHalfWidth(raw).trim();
  if (PLACEHOLDER_CELLS.has(normalized.toLowerCase())) return { ok: true, value: null };

  const withoutSeparators = normalized.replaceAll(',', '');
  const matched = /^([+-]?(?:\d+\.?\d*|\.\d+))(万|亿|%)?$/.exec(withoutSeparators);
  if (matched === null) return { ok: false, raw: normalized };

  const base = Number(matched[1]);
  if (!Number.isFinite(base)) return { ok: false, raw: normalized };
  const suffix = matched[2];
  const value = suffix === '万' ? base * 10_000 : suffix === '亿' ? base * 100_000_000 : suffix === '%' ? base / 100 : base;
  return { ok: true, value };
}

/** `params` 里的数字一律短表示（`0.03` 而不是 `0.030000000000000002`）。 */
function shortNumber(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
}

// ---------------------------------------------------------------------------
// 文本 → 网格
// ---------------------------------------------------------------------------

/** 嗅探形态（DR-113 ①）。单列粘贴没有分隔符可看 ⇒ 退回 `tsv`（一格一行）。 */
export function sniffTableFormat(text: string): SearchTableFormat {
  if (/<(table|td|th)[\s>]/i.test(text)) return 'html';
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.some((line) => line.includes('\t'))) return 'tsv';
  if (lines.some((line) => line.includes(','))) return 'csv';
  return 'tsv';
}

/**
 * 分隔文本 → 网格（带物理行号）。
 *
 * `quoted` 只对 CSV 打开：浏览器复制出来的 TSV **不加引号**（单元格里出现 `"` 就是内容本身），
 * 而 CSV 必须按引号规则读（引号里的逗号不是分隔符、`""` 是一个引号）。
 * 🔴 行号取**记录起始行**（与 csv 1.4.0 的 `record.position()` 同口径，见 `prompt-csv.ts` 头注释
 * 那条"两支同值"的实测结论）；引号里跨行的记录因此报它开始的那一行。
 */
export function splitDelimitedText(
  text: string,
  delimiter: string,
  quoted: boolean,
): SearchTableRecord[] {
  const records: SearchTableRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let line = 1;
  let recordLine = 1;
  let inQuotes = false;

  const endCell = (): void => {
    cells.push(cell);
    cell = '';
  };
  const endRecord = (): void => {
    endCell();
    if (cells.some((value) => value.trim() !== '')) records.push({ cells, line: recordLine });
    cells = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        // 引号里的换行也是物理行：后续记录的错误行号必须继续往后退，
        // 否则“第 N 行”会指回上一条记录的中间。
        if (char === '\n') line += 1;
        cell += char;
      }
      continue;
    }
    if (quoted && char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      endCell();
      continue;
    }
    if (char === '\n') {
      endRecord();
      line += 1;
      recordLine = line;
      continue;
    }
    if (char === '\r') continue;
    cell += char;
  }
  if (cell.trim() !== '' || cells.length > 0) endRecord();
  return records;
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return HTML_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/**
 * HTML 表格 → 网格。行号 = `<tr>` 在**粘贴内容**里的物理行（界面上"第 N 行"要指得回客户粘的那段文本）。
 * 🔴 不引 DOM 解析器：粘进来的片段常常没有 `<tbody>`、也常常是残缺的（只选了表格的一部分），
 * 正则扫 `<tr>` / `<td|th>` 反而更稳，且这一层只需要文本。
 */
export function htmlTableToRecords(text: string): SearchTableRecord[] {
  const records: SearchTableRecord[] = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  // 复制的 HTML 经常整张表在同一条物理行：此时“第几行”只能按表格行序推。
  // 物理行严格递增时保留原值；不递增（同一行 / 嵌套导致回退）就顺延一行。
  let lastLine = 0;
  for (const rowMatch of text.matchAll(rowPattern)) {
    const cells: string[] = [];
    const cellPattern = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
    for (const cellMatch of rowMatch[1].matchAll(cellPattern)) {
      const text_ = decodeEntities(cellMatch[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ');
      cells.push(text_.trim());
    }
    const physical = 1 + text.slice(0, rowMatch.index ?? 0).split('\n').length - 1;
    const line = physical > lastLine ? physical : lastLine + 1;
    lastLine = line;
    if (cells.some((value) => value !== '')) records.push({ cells, line });
  }
  return records;
}

/** 这个源认得哪些表头（`unknown_field` 时摊给用户看：别名 + 我们模板的规范列名）。 */
export function acceptableHeadersOf(kind: SearchSourceKind): readonly string[] {
  return [...Object.keys(aliasColumnsOf(kind)), ...SEARCH_CANONICAL_COLUMN_VALUES];
}

// ---------------------------------------------------------------------------
// 网格 → 数据（粘贴与 xlsx 共用）
// ---------------------------------------------------------------------------

/**
 * 一个"整批被拒"的空结论（表头级错误、文件格式错误都走这一条）。
 * 🔴 导出给 `api/search-xlsx.ts` 用：解析结论的形状只在这一处定义。
 */
export function tableRejection(
  format: SearchTableFormat,
  errors: SearchTableError[],
  columns: SearchTableColumn[] = [],
): SearchTableParseResult {
  return { format, columns, rows: [], extras: [], errors, warnings: [] };
}

/**
 * 认列 + 归一 + 校验（DR-113 ②③④⑤ 与"不猜"的表头判据都在这里，粘贴与 xlsx 共用）。
 *
 * @param records 网格（含物理行号）；第一行非空记录当表头。
 */
export function parseTableGrid(
  records: readonly SearchTableRecord[],
  kind: SearchSourceKind,
  format: SearchTableFormat,
): SearchTableParseResult {
  const nonEmpty = records.filter((record) => record.cells.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length === 0) {
    return tableRejection(format, [{ row: 1, reason: 'empty' }]);
  }

  const [header, ...body] = nonEmpty;
  const columns: SearchTableColumn[] = header.cells.map((cell, index) => ({
    header: cell.trim(),
    index,
    canonical: canonicalColumnOf(kind, cell),
  }));
  const recognized = columns.flatMap((column) => (column.canonical === null ? [] : [column.canonical]));

  if (recognized.length === 0) {
    return tableRejection(format, [
      {
        row: header.line,
        reason: 'unknown_field',
        params: { column: acceptableHeadersOf(kind).join(', ') },
      },
    ], columns);
  }

  // 必备列判据：先是"该源已知导出的必备指标列"，再是通用的"至少一个维度列 + 至少一个 A 类指标列"。
  // 🔴 AI 汇总模板（citations / ai_clicks / ...）没有维度列：它走 `SearchAiOverview`，
  // 不要求 query/page_url；但必须有 citations 或 ai_clicks，否则仍按缺维度拒。
  const aiSummary = isAiSummaryHeader(recognized);
  const missing = aiSummary
    ? []
    : requiredMetricColumnsOf(kind).filter((column) => !recognized.includes(column));
  const dimensions = DIMENSION_COLUMNS.filter((column) => recognized.includes(column));
  const metrics = TIER_A_COLUMNS.filter((column) => recognized.includes(column));
  if (missing.length > 0 || (!aiSummary && dimensions.length === 0) || metrics.length === 0) {
    const expected =
      missing.length > 0
        ? missing
        : dimensions.length === 0
          ? DIMENSION_COLUMNS
          : TIER_A_COLUMNS;
    return tableRejection(
      format,
      [{ row: header.line, reason: 'missing_header', params: { column: [...expected].join(', ') } }],
      columns,
    );
  }

  const extraColumns: SearchTableExtraColumn[] = columns
    .filter((column) => column.canonical === null && column.header !== '')
    .map((column) => ({ header: column.header, index: column.index, values: [] }));
  const rows: SearchTableRow[] = [];
  const errors: SearchTableError[] = [];
  const warnings: SearchTableWarning[] = [];

  for (const record of body) {
    const rawOf = (index: number): string => record.cells[index] ?? '';
    const cells: Partial<Record<SearchCanonicalColumn, string | number | null>> = {};
    const rowErrors: SearchTableError[] = [];

    for (const column of columns) {
      if (column.canonical === null) continue;
      const raw = rawOf(column.index);
      if (isNumericColumn(column.canonical)) {
        const parsed = parseNumericCell(raw);
        if (parsed.ok) cells[column.canonical] = parsed.value;
        else {
          cells[column.canonical] = null;
          rowErrors.push({
            row: record.line,
            reason: 'invalid_format',
            params: { column: column.canonical, value: parsed.raw },
          });
        }
      } else {
        const text = toHalfWidth(raw).trim();
        cells[column.canonical] = text === '' ? null : text;
      }
    }

    if (
      dimensions.length > 0 &&
      dimensions.every((column) => cells[column] === null || cells[column] === '')
    ) {
      rowErrors.push({
        row: record.line,
        reason: 'required',
        params: { column: dimensions.join(', ') },
      });
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    for (const check of RATIO_CHECKS) {
      const given = cells[check.column];
      const numerator = cells[check.numerator];
      const denominator = cells[check.denominator];
      if (
        typeof given !== 'number' ||
        typeof numerator !== 'number' ||
        typeof denominator !== 'number' ||
        denominator === 0
      ) {
        continue;
      }
      const recalculated = numerator / denominator;
      if (Math.abs(given - recalculated) > CTR_CHECK_TOLERANCE) {
        warnings.push({
          row: record.line,
          kind: 'ctr_mismatch',
          params: {
            column: check.column,
            given: shortNumber(given),
            recalculated: shortNumber(recalculated),
          },
        });
      }
    }

    rows.push({ line: record.line, cells });
    // 🔴 C 类留档**原样**（DR-107 的"原样留档"）：不猜它是不是数字、也不做全半角归一
    // ——我们不知道这一列的口径，猜出来的数字比原文更难对账。空单元格留 `null`。
    for (const extra of extraColumns) {
      const raw = rawOf(extra.index).trim();
      extra.values.push(raw === '' ? null : raw);
    }
  }

  return { format, columns, rows, extras: extraColumns, errors, warnings };
}

/**
 * 粘贴文本 → 数据（DR-113 的入口）。
 * 🔴 认不出 / 缺列一律**整批被拒**并给出表头级错误；0 数据行是**成功**（`rows` 与 `errors` 都空）。
 */
export function parsePastedTable(text: string, kind: SearchSourceKind): SearchTableParseResult {
  const format = sniffTableFormat(text);
  const records =
    format === 'html'
      ? htmlTableToRecords(text)
      : splitDelimitedText(text, format === 'csv' ? ',' : '\t', format === 'csv');
  return parseTableGrid(records, kind, format);
}

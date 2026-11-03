/**
 * 最小 xlsx reader（DR-98 / E-72）：`fflate` 解压 + 手写 XML 扫描 → 二维网格，
 * 然后交给 `api/search-paste.ts` 的**同一套**认列与校验（DR-113："reader 只是文本从哪来的又一个答案"）。
 *
 * # 🔴 为什么 demo 侧也要吃 xlsx
 * 百度《AI 流量分析》的官方导出**只有 xlsx**（2026-10-12 产品负责人本机 Chrome 登录实测，
 * 样本录在 `fixtures/search/`）：不接 xlsx，导入按钮对真实客户就是死的。
 * 真后端用 `calamine` 重写同一契约（E-72：两份解析器的漂移风险要判据钉住"同一 fixture 逐格相同"）。
 *
 * # 🔴 只承诺百度这一种导出形态（E-72 ②）
 * `Sheet1` + `inlineStr` / `sharedStrings` / 数字 / 日期序列值。GSC 与 Bing 的导出**不在其范围内**
 * （它们走 `api` 或 CSV）。因此：
 * - **未知 sheet 名报错**、**缺工作表部件报错**、**不是 zip 报错**——一律不猜（E-72 ③）；
 * - 🔴 **只有表头零数据行是成功**（`rows` 与 `errors` 都空）：真实客户的第一份导出往往就是空表
 *   （两份 fixture 正是这个样子，§7 变异 ⑧）。
 *
 * # 语言约束（规则 7）
 * 失败一律回**稳定 reason key + 语言中立 params**（`parse_failed` / `invalid_format` / `not_allowed`，
 * 词表见 `crates/geo-domain/src/error.rs` 的 reason 目录），不抛自然语言、也不抛裸 `TypeError` 给调用方。
 */
import { strFromU8, unzipSync } from 'fflate';

import type { SearchTableParseResult, SearchTableRecord } from './search-paste';
import { parseTableGrid, tableRejection } from './search-paste';
import type { SearchSourceKind } from './types-search';

/**
 * 已核实的工作表名。🔴 只认 `Sheet1`：这是百度官方导出实测的名字（`fixtures/search/README.md`）。
 * 平台改名时**报错**而不是"那就读第一个 sheet 吧"——静默读错表会让客户看到一个"看起来对"的数字
 * （DR-117 观察清单最后一行：表头 / 结构一变就是 `MAPPING_VERSION` 要 +1 的信号）。
 */
export const XLSX_KNOWN_SHEET_NAMES: readonly string[] = ['Sheet1'];

/** ZIP 本地文件头的魔数（`PK\x03\x04`）：靠它把"这不是 xlsx"判成稳定错误码，而不是解压时炸。 */
export function isXlsxBytes(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** 读表成功：sheet 名 + 二维网格（单元格一律字符串，日期已转成 `YYYY-MM-DD`）。 */
export interface XlsxGridOk {
  ok: true;
  sheet_name: string;
  grid: string[][];
}

/** 读表失败：稳定 reason + 语言中立 params（调用方按 reason 查词典渲染）。 */
export interface XlsxGridFailure {
  ok: false;
  reason: string;
  params: Readonly<Record<string, string>>;
}

export type XlsxReadOutcome = XlsxGridOk | XlsxGridFailure;

// ---------------------------------------------------------------------------
// XML 的最小扫描（不引 DOM：粘进来的部件可能残缺，且这一层只要文本）
// ---------------------------------------------------------------------------

const XML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return XML_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** 取一个属性值（单双引号都认）；没有就回 `null`。 */
function attributeOf(attrs: string, name: string): string | null {
  const matched = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  if (matched === null) return null;
  return decodeXmlEntities(matched[2] ?? matched[3] ?? '');
}

/** 一个元素里所有 `<t …>…</t>` 的文本拼起来（`inlineStr` 与 `sharedStrings` 都可能是富文本分 run 存）。 */
function textOf(fragment: string): string {
  const parts: string[] = [];
  for (const match of fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/gi)) {
    parts.push(match[1] === undefined ? '' : decodeXmlEntities(match[1]));
  }
  return parts.join('');
}

/** `B12` → 1（0 基列序）。 */
function columnIndexOf(cellRef: string): number | null {
  const matched = /^([A-Za-z]+)/.exec(cellRef);
  if (matched === null) return null;
  let index = 0;
  for (const char of matched[1].toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

// ---------------------------------------------------------------------------
// 日期序列值
// ---------------------------------------------------------------------------

/** 内置的日期类 numFmtId（ECMA-376 的那几张表；这里只收常见的日期与时刻格式）。 */
const BUILTIN_DATE_FORMAT_IDS = new Set([
  ...Array.from({ length: 9 }, (_, offset) => 14 + offset), // 14~22：日期与日期+时刻
  ...Array.from({ length: 3 }, (_, offset) => 45 + offset), // 45~47：时刻
]);

/**
 * 自定义 `numFmt` 里哪些是日期格式。
 * 🔴 先摘掉引号里的字面量与转义（`yyyy\-mm\-dd`、`"合计"`），再看还剩不剩 `y/m/d/h` 这几个记号：
 * 剩下的才是格式码。数字格式（`#,##0.00`）因此不会被误判成日期。
 */
function isDateFormatCode(code: string): boolean {
  const withoutLiterals = code.replace(/"[^"]*"|\\./g, '');
  return /[ymdh]/i.test(withoutLiterals) && !/^general$/i.test(withoutLiterals.trim());
}

/** `xl/styles.xml` 的日期样式索引集合（缺文件 / 缺 `cellXfs` ⇒ 空集，即"没有日期列"）。 */
function dateFormatStyleIndexes(stylesXml: string | null): Readonly<Set<number>> {
  const indexes = new Set<number>();
  if (stylesXml === null) return indexes;

  const customDateIds = new Set<number>();
  for (const match of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/gi)) {
    const id = Number(attributeOf(match[1], 'numFmtId'));
    const code = attributeOf(match[1], 'formatCode') ?? '';
    if (Number.isFinite(id) && isDateFormatCode(code)) customDateIds.add(id);
  }

  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i.exec(stylesXml)?.[1] ?? '';
  let index = 0;
  for (const match of cellXfs.matchAll(/<xf\b([^>]*?)\/?>|<xf\b([^>]*?)>/gi)) {
    const formatId = Number(attributeOf(match[1] ?? match[2] ?? '', 'numFmtId') ?? '0');
    if (BUILTIN_DATE_FORMAT_IDS.has(formatId) || customDateIds.has(formatId)) indexes.add(index);
    index += 1;
  }
  return indexes;
}

/**
 * Excel 的日期序列值 → `YYYY-MM-DD`。
 * 🔴 1900 日期系统：序列 1 = 1900-01-01，且 Excel 为了兼容 1983 年的 Lotus 1-2-3
 * **把 1900 年当闰年**（多出一个不存在的 1900-02-29）⇒ 基准取 1899-12-30 才对得上。
 * 带小数的序列值（日期 + 时刻）只取日期那一段：`data_through` 是**日期**，不是时间戳。
 */
function serialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const moment = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return moment.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 读表
// ---------------------------------------------------------------------------

function failure(reason: string, params: Readonly<Record<string, string>> = {}): XlsxGridFailure {
  return { ok: false, reason, params };
}

/** 从 `xl/_rels/workbook.xml.rels` 里按 `r:id` 找工作表部件路径。 */
function worksheetPathOf(relsXml: string, relationshipId: string): string | null {
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*\/?>/gi)) {
    if (attributeOf(match[0], 'Id') !== relationshipId) continue;
    const target = attributeOf(match[0], 'Target');
    if (target === null) return null;
    return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  return null;
}

/** 一个单元格的文本值（`inlineStr` / `sharedStrings` / 公式串 / 数字 / 日期序列值）。 */
function cellTextOf(
  attrs: string,
  inner: string,
  sharedStrings: readonly string[],
  dateStyles: Readonly<Set<number>>,
): string {
  const kind = attributeOf(attrs, 't') ?? 'n';
  if (kind === 'inlineStr') return textOf(inner);

  const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(inner)?.[1] ?? '';
  const value = decodeXmlEntities(raw).trim();
  if (kind === 's') {
    const at = Number(value);
    return Number.isInteger(at) ? (sharedStrings[at] ?? '') : '';
  }
  if (kind === 'str' || kind === 'e') return value; // 公式串 / 错误值（`#DIV/0!` 原样透出，让它去撞行级判据）
  if (kind === 'b') return value === '1' ? 'TRUE' : 'FALSE';

  const styleIndex = Number(attributeOf(attrs, 's') ?? '0');
  if (Number.isInteger(styleIndex) && dateStyles.has(styleIndex)) {
    return serialToDate(Number(value)) ?? value;
  }
  return value;
}

/**
 * 读第一个工作表 → 二维网格。
 *
 * 🔴 行号口径：网格的第 N 项就是工作表的第 N 行（缺行补空数组），
 * 所以 `parseTableGrid` 报出来的行号 == Excel 里看到的行号（错误能指回客户那份文件）。
 */
export function readXlsxGrid(bytes: Uint8Array): XlsxReadOutcome {
  if (!isXlsxBytes(bytes)) return failure('parse_failed', { value: 'zip_magic' });

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (cause) {
    // 库原文只进 params（ASCII 截断），不进词典、不上屏（同 `csv_io.rs` 的 `parse_failed` 口径）。
    return failure('parse_failed', { value: String(cause).slice(0, 160) });
  }

  const partOf = (path: string): string | null => {
    const part = files[path];
    return part === undefined ? null : strFromU8(part);
  };

  const workbookXml = partOf('xl/workbook.xml');
  if (workbookXml === null) return failure('invalid_format', { value: 'xl/workbook.xml' });

  const sheetTag = /<sheet\b[^>]*\/?>/i.exec(workbookXml);
  if (sheetTag === null) return failure('invalid_format', { value: 'sheets' });
  const sheetName = attributeOf(sheetTag[0], 'name') ?? '';
  if (!XLSX_KNOWN_SHEET_NAMES.includes(sheetName)) {
    return failure('not_allowed', { value: sheetName });
  }

  const relationshipId = attributeOf(sheetTag[0], 'r:id') ?? attributeOf(sheetTag[0], 'id');
  const relsXml = partOf('xl/_rels/workbook.xml.rels');
  if (relationshipId === null || relsXml === null) {
    return failure('invalid_format', { value: 'xl/_rels/workbook.xml.rels' });
  }
  const sheetPath = worksheetPathOf(relsXml, relationshipId);
  const sheetXml = sheetPath === null ? null : partOf(sheetPath);
  if (sheetXml === null) return failure('invalid_format', { value: sheetPath ?? 'worksheet' });

  const sharedStrings: string[] = [];
  const sharedXml = partOf('xl/sharedStrings.xml');
  if (sharedXml !== null) {
    for (const match of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
      sharedStrings.push(textOf(match[1]));
    }
  }
  const dateStyles = dateFormatStyleIndexes(partOf('xl/styles.xml'));

  const grid: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*?)>([\s\S]*?)<\/row>|<row\b([^>]*?)\/>/gi)) {
    const attrs = rowMatch[1] ?? rowMatch[3] ?? '';
    const declared = Number(attributeOf(attrs, 'r') ?? 'NaN');
    const rowIndex = Number.isInteger(declared) && declared > 0 ? declared - 1 : grid.length;
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const cellAttrs = cellMatch[1];
      const text = cellTextOf(cellAttrs, cellMatch[2] ?? '', sharedStrings, dateStyles);
      const at = columnIndexOf(attributeOf(cellAttrs, 'r') ?? '');
      const index = at === null ? cells.length : at;
      while (cells.length < index) cells.push(''); // 🔴 稀疏单元格按列号归位，缺的那格是空串（不是把后面的值左移）
      cells[index] = text;
    }
    while (grid.length < rowIndex) grid.push([]);
    grid[rowIndex] = cells;
  }

  return { ok: true, sheet_name: sheetName, grid };
}

/**
 * xlsx → 与粘贴**同一份**解析结论（认列、数字归一、行级错误、必备列判据都在 `parseTableGrid`）。
 * 🔴 读表失败也是**结论**而不是异常：界面按 `reason` 查词典渲染（`webmasterData.import.*`）。
 */
export function parseXlsxTable(bytes: Uint8Array, kind: SearchSourceKind): SearchTableParseResult {
  const outcome = readXlsxGrid(bytes);
  if (!outcome.ok) {
    return tableRejection('xlsx', [{ row: 1, reason: outcome.reason, params: outcome.params }]);
  }
  const records: SearchTableRecord[] = outcome.grid.map((cells, index) => ({
    cells,
    line: index + 1,
  }));
  return parseTableGrid(records, kind, 'xlsx');
}

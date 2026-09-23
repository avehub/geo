/**
 * M2 的两条 CSV 命令（`prompt_set_export_csv` / `prompt_set_import_csv`）的内存实现。
 * 真值源 `crates/geo-domain/src/csv_io.rs`（下称 csv_io）与
 * `apps/desktop/src-tauri/src/services/prompt_service.rs`（下称 service）。
 *
 * # 🔴 五件照抄的后端语义（全部有行号，别看代码就会写错）
 * - **导出不带 BOM**：csv_io:127 确实加了 BOM，但 service:668-673 **专门把它剥掉**；
 *   BOM 只在写盘层 `src-tauri/src/ipc/export.rs:16-22` 补（且幂等）。demo 这一层是
 *   **service 层的替身**（`export_write_file` 才对应写盘层）⇒ 这里不加，前端下载时再补。
 * - **导入要容忍 BOM**：csv_io:134 `strip_prefix('\u{FEFF}')`（Excel 存下来的 CSV 往往带）。
 * - **导入是整包替换**：service:699-700 `reindex` + `replace_items`，**不是追加**。
 * - **空导入要拒**：service:689-697，`params` 必须是 `{}`（契约给这个 code 登记的是**空数组**），
 *   逐行错误装进 **`detail`**（`demoError` 的第三个参）。
 * - **表头缺列 = 整批被拒**（不是行错误）：csv_io:147-154，列名逐个 trim、**顺序不敏感**、
 *   多出来的列容忍，缺一个就 `validation/failed {field:'csv_header', reason:'missing_header',
 *   value:'<缺失列名，逗号+空格连接>'}`。
 *
 * # ⚠ 三件**刻意不移植**的行判据（简报 §B-2③：demo 演错误契约，不当校验器）
 * csv_io:198-243 里还有 `too_long`（要 `MAX_PROMPT_CHARS`）、`out_of_range`（要 `MAX_WEIGHT` /
 * `MAX_REPEAT_COUNT`）、`not_allowed`（要整份广告法红线词库）三支。这三个常量/词库在
 * `api/constants.ts` 里**没有前端镜像**，凭空造一份就是新的漂移面 ⇒ demo 只实现
 * `required` / `invalid_format` / `row_invalid` 三种 reason。**已列入 Task 15 的例外表**。
 *
 * # `source` 从列里解析，不是一律 `imported`
 * csv_io:243-249：列**为空**才是 `imported`，非空就照列里的值落库（模板生成出来的题库导出再导回，
 * 来源不能被抹成 imported——它是指标口径的一部分）。
 *
 * # 语言约束（门禁 7）
 * 本目录非注释 CJK 必须为 0 ⇒ 解析器的诊断串一律 ASCII（它进 `params.value`，是给开发者看的
 * 原文，不进词典、不上屏；真值源那侧装的是 csv 库的 `err.to_string()`，同样是 ASCII）。
 */
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import { getDemoDb, promptItemsOf } from '../db';
import { PROMPT_CSV_HEADER } from '../../api/constants';
import type { CsvImportResult, CsvRowError, IntentCategory, PromptItem, PromptSource } from '../../api/types';
import { INTENT_VALUES, PROMPT_SOURCE_VALUES } from '../../api/types';
import { reindexed, requirePromptSet, writePromptItems } from './prompt';
import { CSV_TAG_SEPARATOR, asString, newId, toCsv } from './shared';

/** `weight` 列为空时的默认值（csv_io:214-216）。 */
const DEFAULT_WEIGHT = 3;
/** `repeat_count` 列为空时的默认值（csv_io:228-230）。 */
const DEFAULT_REPEAT_COUNT = 1;
/** `source` 列为空时的默认值（csv_io:243-245）。 */
const DEFAULT_SOURCE: PromptSource = 'imported';
/** `u8` 的上限：Rust 那侧是 `parse::<u8>()`，超出即解析失败（不是越界）。 */
const U8_MAX = 255;
/** Excel / 记事本存 CSV 时加的字节序标记。 */
const BOM = '\uFEFF';
/** 未加引号的裸 `\r` 直接跳过（CRLF 行尾由 `\n` 收口）。 */
const CARRIAGE_RETURN = '\r';

/**
 * 一条已解析的 CSV 记录。
 *
 * `line` 是**物理行号**（表头为第 1 行），口径 = 这条记录的**起始行**，而且**两支同值**（#31 R1 的 I-1）：
 * 真值源 `csv_io:168`（语法错误支，`err.position()`）与 `csv_io:175-178`（域错误支，`record.position()`）
 * 装的是**同一个**位置。理由是 csv 1.4.0 里**所有带位置的错误**装的都是**记录起始**位置：
 * - `error.rs:105-112` 的 `ErrorKind::position()` 只对 `Utf8` / `UnequalLengths` / `Deserialize` 返回内层
 *   `pos`，其余一律 `None` ⇒ csv 里**没有**「带位置的引号语法错误」这种东西；
 * - 而这三处取 `pos` 的时机都在**读记录之前**（`string_record.rs:636` 的 `let pos = rdr.position().clone();`
 *   在 `read_byte_record` 之前）或直接就是记录自己的 position（`reader.rs:1890-1891` 的
 *   `UnequalLengths { pos: record.position() }`、`reader.rs:1332-1333` 的表头 `Utf8`）；
 *   记录的 position 同样在读取之前就定住了（`reader.rs:1626` 的 `record.set_position(...)`）。
 * ⇒ 「语法错误报出错行、域错误报起始行」是**假的**；`row` 会上屏（前端渲染成「第 N 行」），口径必须一致。
 *
 * `error` 非空表示这一条在**语法层**就读不出来 ⇒ 走 `row_invalid`。
 * ⚠ 这一支 demo 比后端**严**：实测 csv 1.4.0（`has_headers(true).flexible(true)`，即 csv_io:135-138
 * 的配置）对「收口引号后还有数据」和「引号未闭合到 EOF」都**不报错**——前者把多余字符并进单元格
 * （`"closed"xx` → `closedxx`），后者把剩余全文当成一个单元格。demo 保留 `row_invalid` 这一支是为了
 * **演错误契约**（`contracts/error-codes.json` 登记了这个 reason，csv_io:163-172 也有那支防御分支）。
 * 这条「demo 更严」已由复审席复跑探针**证实成立**（15c-2 报告 E-8 的撤回被反转）；放宽 demo 还是后端加
 * 校验属**产品负责人决策**，已升级登记，代码侧本轮不动。
 */
interface CsvRecord {
  cells: string[];
  line: number;
  error: string | null;
}

/**
 * `prompt_set_export_csv`：列序逐字等于共享常量 `PROMPT_CSV_HEADER`，**不带 BOM**。
 *
 * 序列化复用 `shared.toCsv`（按需加引号、引号内 `"` 翻倍、`\n` 结尾），不自己拼串——
 * 与竞品/资产那两条导出共用同一份 csv crate 行为镜像，改一处三处跟着对。
 * `group_name` 为 null 时写空串（csv_io:112 的 `unwrap_or_default()`），tags 用 `;` 连接。
 */
export const promptSetExportCsv: DemoHandler = (args) => {
  const db = getDemoDb();
  const set = requirePromptSet(db, asString(args.id));
  const rows = promptItemsOf(db, set.id).map((item) => [
    item.text,
    item.intent,
    String(item.weight),
    item.group_name ?? '',
    item.tags.join(CSV_TAG_SEPARATOR),
    item.source,
    String(item.repeat_count),
  ]);
  return toCsv(PROMPT_CSV_HEADER, rows);
};

/**
 * `prompt_set_import_csv`：表头校验 → 逐行解析（错误行不中断）→ 空导入拒绝 → **整包替换**。
 *
 * 🔴 顺序即语义：表头缺列在**任何**写入之前就抛；行错误攒着继续（csv_io:158-181 的 `continue`）；
 * 只有「一条都没解析出来 **且** 现有题库非空」才拒（service:689-697 的两个条件缺一不可）。
 */
export const promptSetImportCsv: DemoHandler = (args) => {
  const db = getDemoDb();
  const setId = asString(args.id);
  // 题库不存在 ⇒ 先抛，一份 CSV 都不解析（整批不落库）。
  requirePromptSet(db, setId);

  // csv_io:134 的**镜像**。⚠ 在 JS 里这一行是**冗余**的：`String.prototype.trim()` 把 U+FEFF
  // 当空白吃掉，而 Rust 的 `str::trim()` 按 Unicode `White_Space` 判定（U+FEFF 的 `White_Space=No`）
  // ⇒ 真后端那行是**载荷性**的，demo 这行不是（表头本来就逐列 `.trim()`，不剥也不会整批被拒；
  // 把 `.replace(BOM, '')` 删掉，BOM 那条用例**仍然绿**）。保留它的理由只有两个：
  // 让「导入容忍 BOM」这条契约在代码里看得见，以及不把自己的正确性押在 trim 的空白集定义上。
  const records = parseCsv(asString(args.payload).replace(BOM, ''));
  const [header, ...dataRecords] = records as [CsvRecord | undefined, ...CsvRecord[]];

  const columns = (header?.cells ?? []).map((cell) => cell.trim());
  const missing = PROMPT_CSV_HEADER.filter((column) => !columns.includes(column));
  if (missing.length > 0) {
    throw demoError('validation/failed', {
      field: 'csv_header',
      reason: 'missing_header',
      value: missing.join(', '),
    });
  }

  const items: PromptItem[] = [];
  const errors: CsvRowError[] = [];
  for (const record of dataRecords) {
    if (record.error !== null) {
      errors.push({ row: record.line, reason: 'row_invalid', params: { value: record.error } });
      continue;
    }
    const outcome = parsePromptRow(record, columns, setId, items.length);
    if (outcome.item) {
      items.push(outcome.item);
    } else {
      errors.push({ row: record.line, reason: outcome.reason, params: outcome.params });
    }
  }

  const existing = promptItemsOf(db, setId);
  if (items.length === 0 && existing.length > 0) {
    // 契约给 `prompt_set/empty_import` 登记的 params 是**空数组** ⇒ 一个键都不能加；
    // 逐行原因走 `detail`（前端 `describeCsvRowError` 按当前语言渲染）。
    throw demoError('prompt_set/empty_import', {}, errors);
  }

  writePromptItems(db, setId, reindexed(items));
  const result: CsvImportResult = {
    items: structuredClone(promptItemsOf(db, setId)),
    errors,
  };
  return result;
};

// ---------------------------------------------------------------------------
// 逐行判据（csv_io:190-278 的 `parse_prompt_row`）
// ---------------------------------------------------------------------------

/** 一行的解析结果：要么出一条条目，要么出一个 reason + params（绝不出自然语言）。 */
type RowOutcome =
  | { item: PromptItem; reason?: undefined; params?: undefined }
  | { item?: undefined; reason: string; params: Record<string, string> };

function invalidFormat(value: string): RowOutcome {
  return { reason: 'invalid_format', params: { value } };
}

/**
 * 严格解析枚举列：契约内原样收下，契约外 `null`（⇒ `invalid_format`）。
 *
 * 🔴 与 `shared.asIntent` / `asPromptSource`（**宽松**回落到中立成员）刻意分成两套：
 * draft 那条路上后端由 serde 在 IPC 边界把关，demo 自己判就是「自作主张多判几种」；
 * 而 CSV 这条路真后端**自己就在判**（csv_io:207 / 246 的 `::parse(...).ok_or_else(...)`）⇒
 * demo 必须同样严格，否则「导入一行非法意图」这个错误路径在浏览器里根本演不出来。
 * 清单直接消费 `api/types.ts` 的运行时值表，**不硬编码字符串数组**。
 */
function parseIntent(raw: string): IntentCategory | null {
  return (INTENT_VALUES as readonly string[]).includes(raw) ? (raw as IntentCategory) : null;
}

function parsePromptSource(raw: string): PromptSource | null {
  return (PROMPT_SOURCE_VALUES as readonly string[]).includes(raw) ? (raw as PromptSource) : null;
}

/**
 * `parse::<u8>()` 的镜像：只认十进制非负整数且 ≤255。
 * `'abc'` / `'3.5'` / `'-1'` / `'999'` 一律 `null`（Rust 那侧同样是解析失败 ⇒ `invalid_format`，
 * 而不是 `out_of_range`——越界那支只在**解析成功**之后才跑，demo 未移植，见文件头）。
 */
function parseU8(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value <= U8_MAX ? value : null;
}

/**
 * 一行 → 一条条目。判据顺序逐字照 csv_io:196-262（顺序决定了同一行报哪个 reason）。
 *
 * ⚠ `group_name` 留空 ⇒ `null`；后端会回填 `intent.label_zh()`（csv_io:269-273，一张中文表），
 * demo 不镜像它（简报 H-8），前端有本地化的 `__ungrouped__` 路径。
 * ⚠ `position` = **已成功解析的条目数**（csv_io:174 传的 `result.items.len()`），
 * 错误行不占位；落库前还会经 `reindexed` 再排一次，两处口径一致。
 */
function parsePromptRow(
  record: CsvRecord,
  columns: readonly string[],
  setId: string,
  position: number,
): RowOutcome {
  const cell = (name: string): string => {
    const at = columns.indexOf(name);
    // `flexible(true)`：短行取不到该列就是空串（csv_io:173 的 `record.get(i).unwrap_or("")`）。
    return at < 0 ? '' : (record.cells[at] ?? '').trim();
  };

  const text = cell('text');
  if (text === '') return { reason: 'required', params: {} };

  const intentRaw = cell('intent');
  const intent = parseIntent(intentRaw);
  if (intent === null) return invalidFormat(intentRaw);

  const weightRaw = cell('weight');
  const weight = weightRaw === '' ? DEFAULT_WEIGHT : parseU8(weightRaw);
  if (weight === null) return invalidFormat(weightRaw);

  const repeatRaw = cell('repeat_count');
  const repeatCount = repeatRaw === '' ? DEFAULT_REPEAT_COUNT : parseU8(repeatRaw);
  if (repeatCount === null) return invalidFormat(repeatRaw);

  const sourceRaw = cell('source');
  const source = sourceRaw === '' ? DEFAULT_SOURCE : parsePromptSource(sourceRaw);
  if (source === null) return invalidFormat(sourceRaw);

  const groupName = cell('group_name');
  const tagsRaw = cell('tags');
  const tags =
    tagsRaw === ''
      ? []
      : tagsRaw
          .split(CSV_TAG_SEPARATOR)
          .map((tag) => tag.trim())
          .filter((tag) => tag !== '');

  return {
    item: {
      id: newId(),
      set_id: setId,
      text,
      intent,
      weight,
      group_name: groupName === '' ? null : groupName,
      tags,
      source,
      // CSV 没有竞品列 ⇒ 导入的条目一律不做品牌对比（真后端同样如此，列不在表头里）。
      competitor_ids: [],
      repeat_count: repeatCount,
      position,
    },
  };
}

// ---------------------------------------------------------------------------
// CSV 读取（csv crate 的行为镜像：RFC4180 引号规则 + `flexible(true)` 容忍长短行）
// ---------------------------------------------------------------------------

/**
 * 把整份 CSV 读成记录数组。语法错误**不抛**，而是就地变成一条 `error` 非空的记录，
 * 然后**跳到下一个换行继续扫**——csv_io:161-172 也是这个形状
 * （`Err(err) => { push row_invalid; continue }`），于是「第 3 行读不出来、其余行照样导入」
 * 这件事在 demo 里真的演得出来（`prompt-csv.test.ts` 有一条用例专门钉它）。
 *
 * 唯一没有"其余行"可继续的是**引号未闭合一直到 EOF**：那条记录本来就吃到文件尾。
 * ⚠ 错误恢复是**尽力而为**：跳过区间里的引号状态无法可靠重建，所以一律当普通字符扫到 `\n` 为止。
 *
 * 🔴 诊断串一律 **ASCII**，且**绝不**拼入单元格内容——那会把用户数据（可能是中文）塞进错误载荷。
 * ⚠ 它是 demo 自拟的 ASCII 替身，**不是** csv 库 `err.to_string()` 的原文
 * （真值源那一侧装的是库原文；两者形状同为「行号 + 一句英文诊断」，但字面不同）。
 */
function parseCsv(body: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let quoteClosed = false;
  let lineNumber = 1;
  let recordLine = 1;
  let touched = false;
  let index = 0;

  const endField = (): void => {
    cells.push(field);
    field = '';
    touched = true;
  };
  const endRecord = (): void => {
    endField();
    records.push({ cells, line: recordLine, error: null });
    cells = [];
    touched = false;
  };
  const endLine = (): void => {
    lineNumber += 1;
    recordLine = lineNumber;
  };
  const fail = (reason: string): void => {
    // 🔴 `row` 用**记录起始行**（`recordLine`），与域错误那支**同值**：csv 1.4.0 里所有带位置的错误装的
    // 都是记录起始位置（`error.rs:105-112` 只有 `Utf8`/`UnequalLengths`/`Deserialize` 有 `pos`；
    // `reader.rs:1890-1891`、`reader.rs:1332-1333`、`string_record.rs:636`），所以真值源 csv_io:168 与
    // :175-178 产出同一个行号，而 `row` 会上屏（#31 R1 的 I-1）。
    // ⚠ 诊断串是 demo 自拟的 ASCII 替身（E-8）：只报**起始行**，绝不声称自己是「出错那一行」。
    // ⚠ 后端那一支还带 `.unwrap_or(0)`（csv_io:168）：错误**不带位置**时 `row` = 0。demo 的词法器
    //   **总知道**行号 ⇒ 这里恒有 `row >= 1`，`unwrap_or(0)` 那一支在 demo 里**不可构造**
    //   （15c-2 复审 Minor-1：只注不改，已登记进交底清单）。
    records.push({
      cells: [],
      line: recordLine,
      error: `csv parse error: record starts at line ${recordLine}: ${reason}`,
    });
    // 错误恢复：跳到下一个换行、复位记录级状态，让后续行还能被读到（csv_io:172 的 `continue`）。
    while (index < body.length && body[index] !== '\n') index += 1;
    if (index < body.length) {
      index += 1;
      lineNumber += 1;
    }
    cells = [];
    field = '';
    inQuotes = false;
    quoteClosed = false;
    touched = false;
    recordLine = lineNumber;
  };

  while (index < body.length) {
    const char = body[index] as string;

    if (inQuotes) {
      if (char === '"') {
        if (body[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        quoteClosed = true;
        index += 1;
        continue;
      }
      if (char === '\n') lineNumber += 1;
      field += char;
      index += 1;
      continue;
    }

    if (quoteClosed) {
      // 收口引号之后只允许分隔符或行尾；其余情况 csv crate 报 "found data after closing quote"。
      if (char === ',') {
        endField();
        quoteClosed = false;
        index += 1;
        continue;
      }
      if (char === '\n') {
        endRecord();
        quoteClosed = false;
        endLine();
        index += 1;
        continue;
      }
      if (char === CARRIAGE_RETURN) {
        quoteClosed = false;
        index += 1;
        continue;
      }
      fail('found data after closing quote');
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      touched = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\n') {
      endRecord();
      endLine();
      index += 1;
      continue;
    }
    if (char === CARRIAGE_RETURN) {
      index += 1;
      continue;
    }
    field += char;
    touched = true;
    index += 1;
  }

  if (inQuotes) {
    fail('unterminated quoted field');
    return records;
  }
  // 末尾的换行不该再多出一条空记录；但「没有末尾换行的最后一行」必须收进来。
  if (touched || cells.length > 0) endRecord();
  return records;
}

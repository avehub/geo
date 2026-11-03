/// <reference types="node" />
/**
 * 最小 xlsx reader 的判据（DR-98 / E-72）。
 *
 * 🔴 判据钉在**真实 fixture** 上（`fixtures/search/`，2026-10-12 产品负责人本机 Chrome 登录导出，
 * 录制纪律见该目录的 README）：百度《AI 流量分析》的官方导出**只有 xlsx**，
 * 不接 xlsx 就等于导入按钮对真实客户是死的。两份样本都是**仅表头零数据行**
 * ⇒ 顺便钉住"0 数据行 = 成功"（§7 变异 ⑧：真实客户的第一份导出往往就是空表）。
 *
 * 另外钉三条"不猜"：未知 sheet 名报错、缺必备列报错、非 xlsx 字节给稳定 reason（不抛 TypeError）。
 * 测试**不联网**（AGENTS 规则 2）：手工构造的 xlsx 用 `fflate` 在内存里 zip 出来。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { XLSX_KNOWN_SHEET_NAMES, isXlsxBytes, parseXlsxTable, readXlsxGrid } from './search-xlsx';

/** 从 `process.cwd()` 往上最多找 8 层仓库根（口径照 `src/test/repo-file.ts`，只是这里要字节）。 */
function readRepoBytes(...segments: string[]): Uint8Array {
  const relative = join(...segments);
  let dir = resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return new Uint8Array(readFileSync(candidate));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`fixture not found: ${relative}`);
}

const KEYWORDS_FIXTURE = readRepoBytes(
  'fixtures',
  'search',
  'baidu_aiflow_hot_keywords_empty_2026-10-12.xlsx',
);
const PAGES_FIXTURE = readRepoBytes('fixtures', 'search', 'baidu_aiflow_hot_pages_empty_2026-10-12.xlsx');

/** 在内存里造一个最小 xlsx（`inlineStr` 或 `sharedStrings` 两种形态）。 */
function buildXlsx(options: {
  sheetName?: string;
  rows: readonly (readonly string[])[];
  shared?: boolean;
  /** 单元格样式索引（用来验日期序列值那一条）。 */
  dateCells?: readonly string[];
}): Uint8Array {
  const sheetName = options.sheetName ?? 'Sheet1';
  const sharedStrings: string[] = [];
  const columnIndex = (index: number): string => String.fromCharCode(65 + index);

  const body = options.rows
    .map((cells, rowIndex) => {
      const rendered = cells
        .map((value, cellIndex) => {
          const ref = `${columnIndex(cellIndex)}${rowIndex + 1}`;
          // 日期单元格按 Excel 真实的存法来：**数字**序列值 + 日期样式（`s="1"` ⇒ numFmtId 14）。
          if (options.dateCells?.includes(ref) === true) {
            return `<c r="${ref}" s="1"><v>${value}</v></c>`;
          }
          if (options.shared === true) {
            const at = sharedStrings.indexOf(value);
            const id = at >= 0 ? at : sharedStrings.push(value) - 1;
            return `<c r="${ref}" t="s"><v>${id}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowIndex + 1}">${rendered}</row>`;
    })
    .join('');

  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><workbook><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`,
    ),
    // numFmtId 14 = 内置的日期格式（m/d/yyyy）⇒ reader 要把序列值转成 YYYY-MM-DD。
    'xl/styles.xml': strToU8(
      '<?xml version="1.0"?><styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    ),
  };
  if (options.shared === true) {
    files['xl/sharedStrings.xml'] = strToU8(
      `<?xml version="1.0"?><sst count="${sharedStrings.length}">${sharedStrings
        .map((value) => `<si><t>${value}</t></si>`)
        .join('')}</sst>`,
    );
  }
  return zipSync(files);
}

describe('真实 fixture：百度《AI 流量分析》官方导出（仅表头零数据行）', () => {
  it('热门关键词表：认出五列、0 数据行、**成功**（errors 空）', () => {
    const result = parseXlsxTable(KEYWORDS_FIXTURE, 'baidu_ziyuan_ai');
    expect(result.format).toBe('xlsx');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.columns.map((column) => column.header)).toEqual([
      '关键词',
      'AI引用量',
      'AI曝光量',
      'AI点击量',
      'AI点击率',
    ]);
    expect(result.columns.map((column) => column.canonical)).toEqual([
      'query',
      'citations',
      'impressions',
      'clicks',
      'ctr_check',
    ]);
  });

  it('热门页面表：首列是「页面」⇒ 认成 page_url（第二份 fixture 修正了第一轮的观察）', () => {
    const result = parseXlsxTable(PAGES_FIXTURE, 'baidu_ziyuan_ai');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.columns.map((column) => column.canonical)).toEqual([
      'page_url',
      'citations',
      'impressions',
      'clicks',
      'ctr_check',
    ]);
  });

  it('网格读出来就是表头那一行（reader 与认列分层，各自可判）', () => {
    const outcome = readXlsxGrid(KEYWORDS_FIXTURE);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.sheet_name).toBe('Sheet1');
    expect(outcome.grid).toEqual([['关键词', 'AI引用量', 'AI曝光量', 'AI点击量', 'AI点击率']]);
    expect(XLSX_KNOWN_SHEET_NAMES).toContain(outcome.sheet_name);
  });

  it('魔数判得出来（调用方靠它给"只支持 .xlsx 与 .csv"那条稳定错误）', () => {
    expect(isXlsxBytes(KEYWORDS_FIXTURE)).toBe(true);
    expect(isXlsxBytes(strToU8('query,impressions\na,1'))).toBe(false);
  });
});

describe('带数据的 xlsx：列序打乱也认得（DR-113 ②）', () => {
  const header = ['AI点击率', '关键词', 'AI点击量', 'AI引用量', 'AI曝光量'];
  const row = ['3.00%', '工业除尘器', '30', '120', '1000'];

  it('inlineStr 形态', () => {
    const result = parseXlsxTable(buildXlsx({ rows: [header, row] }), 'baidu_ziyuan_ai');
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cells).toEqual({
      ctr_check: 0.03,
      query: '工业除尘器',
      clicks: 30,
      citations: 120,
      impressions: 1000,
    });
    expect(result.rows[0].line).toBe(2);
  });

  it('sharedStrings 形态（同一份数据，另一种存法）', () => {
    const result = parseXlsxTable(buildXlsx({ rows: [header, row], shared: true }), 'baidu_ziyuan_ai');
    expect(result.errors).toEqual([]);
    expect(result.rows[0].cells.query).toBe('工业除尘器');
    expect(result.rows[0].cells.impressions).toBe(1000);
  });

  it('纯数字单元格（没有 t 属性）与日期序列值都读得出来', () => {
    const bytes = buildXlsx({
      rows: [
        ['query', 'impressions', 'clicks', 'data_through'],
        ['工业除尘器', '1000', '30', '46295'],
      ],
      dateCells: ['D2'],
    });
    const outcome = readXlsxGrid(bytes);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 46295 = 2026-09-30（Excel 的 1900 日期系统：序列 1 = 1900-01-01，且背着那个不存在的 1900-02-29）。
    expect(outcome.grid[1]).toEqual(['工业除尘器', '1000', '30', '2026-09-30']);
  });

  it('稀疏单元格按列号归位（缺的那一格是空串，不是把后面的值往左挪）', () => {
    const bytes = zipSync({
      'xl/workbook.xml': strToU8(
        '<?xml version="1.0"?><workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<?xml version="1.0"?><worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="inlineStr"><is><t>关键词</t></is></c><c r="B1" t="inlineStr"><is><t>AI引用量</t></is></c><c r="C1" t="inlineStr"><is><t>AI曝光量</t></is></c><c r="D1" t="inlineStr"><is><t>AI点击量</t></is></c><c r="E1" t="inlineStr"><is><t>AI点击率</t></is></c></row>' +
          // 第 2 行少了 B 列（AI引用量）⇒ 空单元格是 null，🔴 不是 0（DR-94）。
          '<row r="2"><c r="A2" t="inlineStr"><is><t>工业除尘器</t></is></c><c r="C2"><v>1000</v></c><c r="D2"><v>30</v></c><c r="E2"><v>0.03</v></c></row>' +
          '</sheetData></worksheet>',
      ),
    });
    const result = parseXlsxTable(bytes, 'baidu_ziyuan_ai');
    expect(result.errors).toEqual([]);
    expect(result.rows[0].cells).toEqual({
      query: '工业除尘器',
      citations: null,
      impressions: 1000,
      clicks: 30,
      ctr_check: 0.03,
    });
  });
});

describe('🔴 不猜：三种情况必须报错（E-72 ③）', () => {
  it('未知 sheet 名 ⇒ not_allowed（平台改了导出结构，静默认错列比报错糟得多）', () => {
    const outcome = readXlsxGrid(buildXlsx({ sheetName: 'Data1', rows: [['query', 'impressions']] }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('not_allowed');
    expect(outcome.params.value).toBe('Data1');

    const result = parseXlsxTable(buildXlsx({ sheetName: 'Data1', rows: [['query', 'impressions']] }), 'manual');
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ row: 1, reason: 'not_allowed', params: { value: 'Data1' } }]);
  });

  it('缺该源已知导出的必备列 ⇒ missing_header，整批被拒', () => {
    const result = parseXlsxTable(
      buildXlsx({ rows: [['关键词', 'AI引用量', 'AI曝光量'], ['工业除尘器', '120', '1000']] }),
      'baidu_ziyuan_ai',
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ row: 1, reason: 'missing_header', params: { column: 'clicks, ctr_check' } }]);
  });

  it('不是 zip / 缺工作表部件 ⇒ 稳定 reason（不抛 TypeError 到调用方）', () => {
    const csvBytes = strToU8('query,impressions\na,1');
    const outcome = readXlsxGrid(csvBytes);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('parse_failed');

    const noSheet = zipSync({ 'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook><sheets/></workbook>') });
    const broken = readXlsxGrid(noSheet);
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.reason).toBe('invalid_format');
  });

  it('点击率与重算值对不上 ⇒ warning 不阻断（灰度期平台口径可能在变，DR-98）', () => {
    const result = parseXlsxTable(
      buildXlsx({
        rows: [
          ['关键词', 'AI引用量', 'AI曝光量', 'AI点击量', 'AI点击率'],
          ['工业除尘器', '120', '1000', '30', '0.5'],
        ],
      }),
      'baidu_ziyuan_ai',
    );
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].kind).toBe('ctr_mismatch');
  });
});

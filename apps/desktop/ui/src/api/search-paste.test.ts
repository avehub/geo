/**
 * 粘贴解析的判据（spec DR-113：粘贴是**一等**接入形态，界面上是主按钮）。
 *
 * 钉六件事：① 三种形态都嗅探得出来（TSV / HTML 表格 / 逗号）；② 按表头文字认列、
 * **不要求列序**（这是"照模板重粘一遍"那个摩擦被取消的地方）；③ 认不出的列进 `extras`
 * **不静默丢弃**（DR-107）；④ 数字归一（千分位、百分号、中文"万"、全角数字）；
 * ⑤ 行级错误指到**粘贴内容的第几行**（表头是第 1 行，与 `CsvRowError.row` 同口径）；
 * ⑥ 表头认不出 / 缺必备列 ⇒ **整批被拒**，而不是猜（E-72 ③）。
 */
import { describe, expect, it } from 'vitest';

import { CTR_CHECK_TOLERANCE, parsePastedTable, parseNumericCell, sniffTableFormat } from './search-paste';

/** 百度《AI 流量分析》「AI 引用热门关键词」表的表头原文（一级出处：fixtures/search/）。 */
const BAIDU_HEADER = ['关键词', 'AI引用量', 'AI曝光量', 'AI点击量', 'AI点击率'];

const tsv = (header: readonly string[], rows: readonly (readonly string[])[]) =>
  [header.join('\t'), ...rows.map((row) => row.join('\t'))].join('\n');

describe('形态嗅探', () => {
  it('制表符 / 逗号 / HTML 表格各归各，单列粘贴退回 tsv', () => {
    expect(sniffTableFormat(tsv(BAIDU_HEADER, []))).toBe('tsv');
    expect(sniffTableFormat('query,impressions\na,1')).toBe('csv');
    expect(sniffTableFormat('<table><tr><td>关键词</td></tr></table>')).toBe('html');
    expect(sniffTableFormat('关键词\n工业除尘器')).toBe('tsv');
  });
});

describe('认列不要求列序（DR-113 ②）', () => {
  it('把官方五列打乱顺序，照样逐列认对', () => {
    const shuffled = ['AI点击率', '关键词', 'AI点击量', 'AI引用量', 'AI曝光量'];
    const result = parsePastedTable(tsv(shuffled, [['12.50%', '工业除尘器', '30', '120', '1000']]), 'baidu_ziyuan_ai');

    expect(result.format).toBe('tsv');
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cells).toEqual({
      query: '工业除尘器',
      citations: 120,
      impressions: 1000,
      clicks: 30,
      ctr_check: 0.125,
    });
    // columns 按**原表列序**回，界面据此渲染"哪一列认成了什么"。
    expect(result.columns.map((column) => column.canonical)).toEqual([
      'ctr_check',
      'query',
      'clicks',
      'citations',
      'impressions',
    ]);
  });

  it('我们自己的模板列名也认得（identity 兜底），且大小写与首尾空白不敏感', () => {
    const result = parsePastedTable(' Impressions ,QUERY,clicks\n1000, industrial dust collector ,30', 'manual');
    expect(result.errors).toEqual([]);
    expect(result.rows[0].cells).toEqual({ impressions: 1000, query: 'industrial dust collector', clicks: 30 });
  });
});

describe('数字归一（DR-113 ④）', () => {
  it('千分位、百分号、中文"万"与"亿"、全角数字都归一', () => {
    expect(parseNumericCell('1,234')).toEqual({ ok: true, value: 1234 });
    expect(parseNumericCell('12.5%')).toEqual({ ok: true, value: 0.125 });
    expect(parseNumericCell('12.50％')).toEqual({ ok: true, value: 0.125 });
    expect(parseNumericCell('1.2万')).toEqual({ ok: true, value: 12000 });
    expect(parseNumericCell('1,234万')).toEqual({ ok: true, value: 12340000 });
    expect(parseNumericCell('1.5亿')).toEqual({ ok: true, value: 150000000 });
    expect(parseNumericCell('１２３')).toEqual({ ok: true, value: 123 });
    expect(parseNumericCell('0')).toEqual({ ok: true, value: 0 });
  });

  it('空单元格与平台的占位符是 null（🔴 不是 0：DR-94"没有这一列"与"这一列是 0"是两个结论）', () => {
    expect(parseNumericCell('')).toEqual({ ok: true, value: null });
    expect(parseNumericCell('   ')).toEqual({ ok: true, value: null });
    expect(parseNumericCell('-')).toEqual({ ok: true, value: null });
    expect(parseNumericCell('—')).toEqual({ ok: true, value: null });
  });

  it('认不出的数字回 ok:false 并带上原文（调用方出行级错误，不许静默当 0）', () => {
    expect(parseNumericCell('约 30')).toEqual({ ok: false, raw: '约 30' });
  });

  it('非法数字 ⇒ 行级错误指到那一行、那一列，且该行不进 rows', () => {
    const result = parsePastedTable(
      tsv(BAIDU_HEADER, [
        ['工业除尘器', '120', '1000', '30', '3.00%'],
        ['布袋除尘器', '约 80', '900', '20', '2.22%'],
      ]),
      'baidu_ziyuan_ai',
    );
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([
      { row: 3, reason: 'invalid_format', params: { column: 'citations', value: '约 80' } },
    ]);
  });
});

describe('行号口径（DR-113 ⑤：表头是第 1 行）', () => {
  it('第一行数据的错误报 2，CRLF 与前置空行都不改口径', () => {
    const result = parsePastedTable(
      tsv(BAIDU_HEADER, [['', '120', '1000', '30', '3.00%']]).replaceAll('\n', '\r\n'),
      'baidu_ziyuan_ai',
    );
    expect(result.errors).toEqual([{ row: 2, reason: 'required', params: { column: 'query' } }]);
  });

  it('HTML 表格的行号指到粘贴内容里 <tr> 所在的物理行', () => {
    const html = [
      '<table>',
      '  <tr><th>关键词</th><th>AI引用量</th><th>AI曝光量</th><th>AI点击量</th><th>AI点击率</th></tr>',
      '  <tr><td>工业除尘器</td><td>120</td><td>1,000</td><td>30</td><td>3.00%</td></tr>',
      '  <tr><td></td><td>80</td><td>900</td><td>20</td><td>2.22%</td></tr>',
      '</table>',
    ].join('\n');
    const result = parsePastedTable(html, 'baidu_ziyuan_ai');
    expect(result.format).toBe('html');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].line).toBe(3);
    expect(result.rows[0].cells.impressions).toBe(1000);
    expect(result.errors).toEqual([{ row: 4, reason: 'required', params: { column: 'query' } }]);
  });
});

describe('行号口径补充（DR-113 ⑤）', () => {
  it('CSV 引号内的换行也推进物理行号，后续错误不后移', () => {
    const csv = [
      BAIDU_HEADER.join(','),
      '"工业',
      '除尘器",120,1000,30,3.00%',
      ',80,900,20,2.22%',
    ].join('\n');
    const result = parsePastedTable(csv, 'baidu_ziyuan_ai');
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([{ row: 4, reason: 'required', params: { column: 'query' } }]);
  });

  it('单行 HTML 表格按表格行序报错，不是全部第 1 行', () => {
    const html =
      '<table><tr><th>关键词</th><th>AI引用量</th><th>AI曝光量</th><th>AI点击量</th><th>AI点击率</th></tr>' +
      '<tr><td>工业除尘器</td><td>120</td><td>1,000</td><td>30</td><td>3.00%</td></tr>' +
      '<tr><td></td><td>80</td><td>900</td><td>20</td><td>2.22%</td></tr></table>';
    const result = parsePastedTable(html, 'baidu_ziyuan_ai');
    expect(result.format).toBe('html');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].line).toBe(2);
    expect(result.errors).toEqual([{ row: 3, reason: 'required', params: { column: 'query' } }]);
  });
});

describe('认不出的列进 extras（DR-107：静默丢弃是最坏的失败形态）', () => {
  it('平台独有维度原样留档，值与 rows 同序', () => {
    const result = parsePastedTable(
      tsv(['关键词', '展现量', '点击量', '平均排名', '收录量'], [['工业除尘器', '1000', '30', '4.2', '18']]),
      'baidu_ziyuan',
    );
    expect(result.rows).toHaveLength(1);
    expect(result.extras.map((extra) => extra.header)).toEqual(['平均排名', '收录量']);
    expect(result.extras[0].values).toEqual(['4.2']);
    expect(result.extras[1].values).toEqual(['18']);
    expect(result.columns.filter((column) => column.canonical === null).map((column) => column.header)).toEqual([
      '平均排名',
      '收录量',
    ]);
  });

  it('extras 只收通过校验的行（与 rows 一一对得上，错位就是灾难）', () => {
    const result = parsePastedTable(
      tsv(['关键词', '展现量', '点击量', '平均排名'], [['', 'x', '30', '9'], ['b', '900', '20', '7.7']]),
      'baidu_ziyuan',
    );
    // 第 2 行同时踩两条判据（维度列空 + 展现量不是数字）⇒ 整行被拒，它的 extras 值也不许留下。
    expect(result.errors.map((error) => error.reason).sort()).toEqual(['invalid_format', 'required']);
    expect(result.errors.every((error) => error.row === 2)).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].line).toBe(3);
    expect(result.extras[0].values).toEqual(['7.7']);
  });
});

describe('表头判据（不猜：E-72 ③）', () => {
  it('一列都认不出 ⇒ unknown_field，并把可接受的列名摊在 params 里', () => {
    const result = parsePastedTable('名称,数量\n甲,1', 'baidu_ziyuan_ai');
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toBe('unknown_field');
    expect(result.errors[0].row).toBe(1);
    expect(result.errors[0].params?.column).toContain('impressions');
  });

  it('缺百度官方导出的必备列 ⇒ missing_header，整批被拒（不是行错误）', () => {
    const result = parsePastedTable(
      tsv(['关键词', 'AI引用量', 'AI曝光量'], [['工业除尘器', '120', '1000']]),
      'baidu_ziyuan_ai',
    );
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ row: 1, reason: 'missing_header', params: { column: 'clicks, ctr_check' } }]);
  });

  it('只有维度列、没有任何可加指标 ⇒ 同样整批被拒', () => {
    const result = parsePastedTable('query,page_url\na,https://example.com/a', 'manual');
    expect(result.rows).toEqual([]);
    expect(result.errors[0].reason).toBe('missing_header');
  });

  it('空粘贴 ⇒ empty（词典 webmasterData.import.errEmptyPayload）', () => {
    const result = parsePastedTable('   \n ', 'gsc');
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ row: 1, reason: 'empty' }]);
  });

  it('🔴 只有表头零数据行 = **成功**（真实客户的第一份导出往往就是空表，DR-98 / 变异 ⑧）', () => {
    const result = parsePastedTable(tsv(BAIDU_HEADER, []), 'baidu_ziyuan_ai');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.columns).toHaveLength(5);
  });
});

describe('点击率只作交叉校验（DR-98：偏差 > 0.005 给行级 warning，不阻断）', () => {
  it('偏差超阈值 ⇒ warning 带上文件值与重算值，行照样进 rows', () => {
    const result = parsePastedTable(
      tsv(BAIDU_HEADER, [['工业除尘器', '120', '1000', '30', '50.00%']]),
      'baidu_ziyuan_ai',
    );
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toEqual({
      row: 2,
      kind: 'ctr_mismatch',
      params: { column: 'ctr_check', given: '0.5', recalculated: '0.03' },
    });
    expect(CTR_CHECK_TOLERANCE).toBe(0.005);
  });

  it('偏差在阈值内 ⇒ 不出 warning（平台灰度期口径可能微调，不该天天报警）', () => {
    const result = parsePastedTable(
      tsv(BAIDU_HEADER, [['工业除尘器', '120', '1000', '30', '3.00%']]),
      'baidu_ziyuan_ai',
    );
    expect(result.warnings).toEqual([]);
  });

  it('分母缺失或为 0 ⇒ 不比对（重算不出来的比率不作交叉校验）', () => {
    const result = parsePastedTable(
      tsv(BAIDU_HEADER, [['工业除尘器', '120', '0', '0', '50.00%'], ['布袋除尘器', '', '1000', '30', '']]),
      'baidu_ziyuan_ai',
    );
    expect(result.warnings).toEqual([]);
    expect(result.rows).toHaveLength(2);
  });
});

describe('CSV 形态（带引号的单元格）', () => {
  it('引号里的逗号不当分隔符，两个引号当一个引号', () => {
    const result = parsePastedTable(
      'query,impressions,clicks\n"除尘器, 工业",1000,30\n"他说""好""",900,20',
      'manual',
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.cells.query)).toEqual(['除尘器, 工业', '他说"好"']);
  });
});

describe('AI 汇总模板（无维度列，走 SearchAiOverview）', () => {
  it('citations / impressions / ai_clicks / ai_ctr_check / cited_pages 可以直接解析成一行', () => {
    const result = parsePastedTable(
      'citations,impressions,ai_clicks,ai_ctr_check,cited_pages\n1200,6106,90,7.5%,18',
      'baidu_ziyuan_ai',
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.cells).toMatchObject({
      citations: 1200,
      impressions: 6106,
      ai_clicks: 90,
      ai_ctr_check: 0.075,
      cited_pages: 18,
    });
  });

  it('四列旧模板（没有 impressions）仍可解析，ai_impressions 由调用方落成 null', () => {
    const result = parsePastedTable(
      'citations,ai_clicks,ai_ctr_check,cited_pages\n1200,90,7.5%,18',
      'baidu_ziyuan_ai',
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.cells).not.toHaveProperty('impressions');
  });

  it('没有 citations / ai_clicks 的“无维度表”仍按缺维度整批拒绝', () => {
    const result = parsePastedTable('impressions,clicks\n1000,30', 'baidu_ziyuan_ai');
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0]?.reason).toBe('missing_header');
  });
});

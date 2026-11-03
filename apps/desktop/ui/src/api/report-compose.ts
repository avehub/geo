/**
 * 报告导出文本的**组装**（M7）：`ReportDocument` + 当前界面语言 → Markdown / HTML / CSV 字符串。
 *
 * # 为什么组装在前端、不在假后端
 * 报告标题、节标题、指标名、表头、免责声明都是**界面文案**，必须走词典（AGENTS 规则 7）。
 * 假后端只回稳定记号 + 数据（`seed/reports.ts` 的头注释讲的就是这个分工）；把记号翻成文字
 * 这一步只有前端知道当前语言 ⇒ 导出的文件因此**随界面语言走**：中文界面导出中文报告，
 * 切到英文再导出就是英文报告，同一份数据。
 *
 * # 🔴 这里不排版、不算数（AGENTS 规则 9）
 * 只做「记号 → 词条」与「数字 → 带单位的串」（后者走 `components/format.ts`，
 * 与界面上显示的完全同一份实现，所以导出文件里的数字与预览里的不可能不一致）。
 *
 * # `docx` / `pdf` / `png` 不在这里
 * 那三种要原生渲染或文档库（`DESKTOP_ONLY_EXPORT_FORMATS`），纯前端 demo 不引；
 * 界面上按钮照旧渲染但置灰，提示语在 `report.export.desktopOnly`。
 */
import type { TFunction } from 'i18next';
import dayjs from 'dayjs';

import type { ReportBlock, ReportDocument, ReportMetricBlock, ReportSection } from './types';
import {
  dateTimeText,
  metricDeltaText,
  metricValueText,
} from '../components/format';
import { enumLabel } from '../i18n/enum-label';

/** demo 里真能产出的三种导出格式（其余三种见 `DESKTOP_ONLY_EXPORT_FORMATS`）。 */
export type ReportExportKind = 'markdown' | 'html' | 'csv';

/** 文件扩展名（CSV 走 `.csv`，Excel 打开中文靠 `export_write_file` 的 BOM）。 */
const EXTENSIONS: Record<ReportExportKind, string> = {
  markdown: 'md',
  html: 'html',
  csv: 'csv',
};

/**
 * 导出文件名：`geo-report-<variant>-<时间戳>.<ext>`。
 *
 * 🔴 刻意**全 ASCII**：品牌名与轮次名都是中文数据，塞进文件名的话，
 * `export_write_file` 在桌面端要过一次系统「另存为」对话框、在 demo 里要过一次
 * `URL.createObjectURL` + `<a download>`，两条路对非 ASCII 文件名的处理并不一致
 * （后者在部分浏览器上会静默丢掉 `download` 属性里的中文）。
 * 报告里已经有标题与品牌名，文件名不需要再承担辨识度。
 */
export function reportFileName(doc: ReportDocument, kind: ReportExportKind): string {
  const stamp = dayjs(doc.generated_at).format('YYYYMMDD-HHmm');
  return `geo-report-${doc.variant}-${stamp}.${EXTENSIONS[kind]}`;
}

/** 指标行：`Brand Coverage: 55% (+13 pp)`。 */
function metricLine(t: TFunction, metric: ReportMetricBlock): string {
  const label = t(`report.metrics.${metric.metric}`, { nsSeparator: false });
  const value = metricValueText(metric.unit, metric.value);
  const delta = metric.delta === null ? '' : ` (${metricDeltaText(t, metric.unit, metric.delta)})`;
  return `${label}: ${value}${delta}`;
}

/**
 * 节标题。预览与导出共用这一个函数（查不到词条时回落到 id 本身，绝不回落到中文）。
 */
export function sectionTitle(t: TFunction, section: ReportSection): string {
  return enumLabel(t, 'report.sections', section.id);
}

/**
 * 当前界面语言（`zh-CN` / `en-US`）。
 *
 * `TFunction` 的类型声明没有 `lng`，但 i18next 的 `getFixedT` / `useTranslation` 返回的
 * 函数在运行期都带着它。取不到时回落到产品主语言，而不是写死某个语言。
 * 导出 HTML 的 `lang` 以此为准：同一份 `t` 渲染正文，也渲染文件头。
 */
export function htmlLang(t: TFunction): string {
  const lng = (t as TFunction & { lng?: string }).lng;
  return lng === undefined || lng === '' ? 'zh-CN' : lng;
}

/** 口径说明的一行：稳定键 + 已渲染标签 + 已渲染值。 */
export interface MethodologyRow {
  key:
    | 'round'
    | 'sampleSize'
    | 'collectedAt'
    | 'engines'
    | 'modelVersions'
    | 'promptSet'
    | 'metricSpec'
    | 'repeatCount';
  label: string;
  value: string;
}

/**
 * 口径说明的真值源：预览与三种导出都从这里取值。
 *
 * 🔴 这里只做「记号 → 词条」与「值 → 串」，不做额外排版；预览与导出若各写一份，
 * 迟早会出现「预览 60 · 样本充足 / 文件 60 (样本充足)」这种同源缺口。
 */
export function methodologyRows(t: TFunction, doc: ReportDocument): MethodologyRow[] {
  const m = doc.methodology;
  const row = (key: MethodologyRow['key'], label: string, value: string): MethodologyRow => ({
    key,
    label: t(`report.methodology.${label}`, { nsSeparator: false }),
    value,
  });
  return [
    row('round', 'round', m.round_label),
    row(
      'sampleSize',
      'sampleSize',
      `${m.sample_size} · ${enumLabel(t, 'common.sampleSizeGrades', m.sample_size_grade)}`,
    ),
    row('collectedAt', 'collectedAt', dateTimeText(m.collected_at)),
    row(
      'engines',
      'engines',
      m.engines.map((engine) => enumLabel(t, 'collection.engines', engine)).join(', '),
    ),
    row('modelVersions', 'modelVersions', m.model_versions.join(', ')),
    row(
      'promptSet',
      'promptSet',
      `${m.prompt_set_label} (v${m.prompt_set_version})`,
    ),
    row('metricSpec', 'metricSpec', m.metric_spec_version),
    row('repeatCount', 'repeatCount', String(m.repeat_count)),
  ];
}

/** 表头单元格：稳定记号 → 词条（同样回落到记号本身）。 */
function columnLabel(t: TFunction, key: string): string {
  const full = `report.columns.${key}`;
  const rendered = t(full, { nsSeparator: false });
  return rendered === full ? key : rendered;
}

/**
 * 表格单元格的展示值。
 *
 * 列名是稳定记号，绝大多数单元格是后端已排版好的**数据串**（题目、回答片段、数字）；
 * 只有三类是机器记号，前端必须换成界面同款：`engine`（引擎 id）、`mention`
 * （`mentioned` / `not_mentioned`）、`collected_at`（时间）。预览与三种导出都走这里，
 * 否则客户会在证据附录里看到 `doubao` / `mentioned` / ISO 原文。
 */
export function tableCellText(t: TFunction, columnKey: string, cell: string): string {
  if (cell === '') return cell;
  if (columnKey === 'engine') return enumLabel(t, 'collection.engines', cell);
  if (columnKey === 'collected_at') return dateTimeText(cell);
  if (columnKey === 'mention') {
    if (cell === 'mentioned') return t('common.yes');
    if (cell === 'not_mentioned') return t('common.no');
  }
  return cell;
}

/** 报告标题（三个版本各一条模板，插值品牌名与轮次名两个**数据**）。 */
export function reportTitle(t: TFunction, doc: ReportDocument): string {
  return t(`report.titleOf.${doc.variant}`, {
    nsSeparator: false,
    brand: doc.brand_name,
    round: doc.round_label,
  });
}

/** 口径说明页的行（`标签: 值`）——三个格式共用同一份，保证"导出与预览一致"。 */
function methodologyLines(t: TFunction, doc: ReportDocument): string[] {
  return methodologyRows(t, doc).map((row) => `${row.label}: ${row.value}`);
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function markdownBlock(t: TFunction, block: ReportBlock, out: string[]): void {
  if (block.kind === 'paragraph') {
    out.push(block.text, '');
    return;
  }
  if (block.kind === 'metric') {
    out.push(`- ${metricLine(t, block)}`);
    return;
  }
  if (block.kind === 'list') {
    for (const item of block.items) out.push(`- ${item}`);
    out.push('');
    return;
  }
  const header = block.column_keys.map((key) => columnLabel(t, key));
  out.push(`| ${header.join(' | ')} |`);
  out.push(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of block.rows) {
    out.push(`| ${block.column_keys.map((key, index) => tableCellText(t, key, row[index] ?? '')).join(' | ')} |`);
  }
  out.push('');
}

function composeMarkdown(t: TFunction, doc: ReportDocument): string {
  const out: string[] = [`# ${reportTitle(t, doc)}`, ''];
  if (doc.white_label) {
    if (doc.white_label.logo_url !== null) {
      out.push(`![${doc.white_label.agency_name}](${doc.white_label.logo_url})`, '');
    }
    out.push(`_${t('report.whiteLabel.preparedBy', { agency: doc.white_label.agency_name })}_`, '');
    out.push(`${doc.white_label.contact}`, '');
  }

  out.push(`## ${t('report.headline')}`);
  for (const metric of doc.headline) out.push(`- ${metricLine(t, metric)}`);
  out.push('');

  for (const section of doc.sections) {
    out.push(`## ${sectionTitle(t, section)}`);
    const blocks = [...section.blocks];
    // 连续的 metric 块合成一个列表；其余块之间留空行（markdownBlock 自己管）。
    blocks.forEach((block) => markdownBlock(t, block, out));
    // metric 块后面补一个空行，免得与下一节标题粘连。
    if (blocks.some((block) => block.kind === 'metric')) out.push('');
  }

  out.push(`## ${t('report.nextSteps')}`);
  doc.next_steps.forEach((step, index) => out.push(`${index + 1}. ${step}`));
  out.push('');

  out.push(`## ${t('report.methodology.title')}`);
  for (const line of methodologyLines(t, doc)) out.push(`- ${line}`);
  out.push('');

  out.push(`> ${t('report.disclaimer')}`, '');
  out.push(`${t('report.export.generatedAt')}: ${dateTimeText(doc.generated_at)}`, '');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

/** HTML 转义：报告里的叙述段与回答片段都是**数据**，绝不能当标记执行（XSS）。 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function htmlBlock(t: TFunction, block: ReportBlock): string {
  if (block.kind === 'paragraph') return `<p>${escapeHtml(block.text)}</p>`;
  if (block.kind === 'metric') return `<li>${escapeHtml(metricLine(t, block))}</li>`;
  if (block.kind === 'list') {
    return `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }
  const head = block.column_keys
    .map((key) => `<th>${escapeHtml(columnLabel(t, key))}</th>`)
    .join('');
  const body = block.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) => `<td>${escapeHtml(tableCellText(t, block.column_keys[index] ?? '', cell))}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function composeHtml(t: TFunction, doc: ReportDocument): string {
  const parts: string[] = [
    '<!doctype html>',
    `<html lang="${escapeHtml(htmlLang(t))}">`,
    '<head><meta charset="utf-8">',
    `<title>${escapeHtml(reportTitle(t, doc))}</title></head>`,
    '<body>',
    `<h1>${escapeHtml(reportTitle(t, doc))}</h1>`,
  ];

  if (doc.white_label) {
    const logo =
      doc.white_label.logo_url === null
        ? ''
        : `<img src="${escapeHtml(doc.white_label.logo_url)}" alt="${escapeHtml(
            doc.white_label.agency_name,
          )}" style="max-height:64px;max-width:240px">`;
    parts.push(
      `<p>${logo}${logo === '' ? '' : '<br>'}<em>${escapeHtml(
        t('report.whiteLabel.preparedBy', { agency: doc.white_label.agency_name }),
      )}</em><br>${escapeHtml(doc.white_label.contact)}</p>`,
    );
  }

  parts.push(`<h2>${escapeHtml(t('report.headline'))}</h2>`, '<ul>');
  for (const metric of doc.headline) parts.push(htmlBlock(t, metric));
  parts.push('</ul>');

  for (const section of doc.sections) {
    parts.push(`<h2>${escapeHtml(sectionTitle(t, section))}</h2>`);
    // 连续的 metric 块包进同一个 <ul>，其余块各自成段。
    let inMetrics = false;
    for (const block of section.blocks) {
      const isMetric = block.kind === 'metric';
      if (isMetric && !inMetrics) {
        parts.push('<ul>');
        inMetrics = true;
      } else if (!isMetric && inMetrics) {
        parts.push('</ul>');
        inMetrics = false;
      }
      parts.push(htmlBlock(t, block));
    }
    if (inMetrics) parts.push('</ul>');
  }

  parts.push(`<h2>${escapeHtml(t('report.nextSteps'))}</h2>`, '<ol>');
  for (const step of doc.next_steps) parts.push(`<li>${escapeHtml(step)}</li>`);
  parts.push('</ol>');

  parts.push(`<h2>${escapeHtml(t('report.methodology.title'))}</h2>`, '<ul>');
  for (const line of methodologyLines(t, doc)) parts.push(`<li>${escapeHtml(line)}</li>`);
  parts.push('</ul>');

  parts.push(
    `<p><small>${escapeHtml(t('report.disclaimer'))}</small></p>`,
    `<p><small>${escapeHtml(t('report.export.generatedAt'))}: ${escapeHtml(
      dateTimeText(doc.generated_at),
    )}</small></p>`,
    '</body>',
    '</html>',
  );
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// CSV（明细：只放表格与关键数字，叙述段进不了二维表）
// ---------------------------------------------------------------------------

/** CSV 单元格转义：含分隔符 / 引号 / 换行时加引号，内部引号翻倍。 */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function composeCsv(t: TFunction, doc: ReportDocument): string {
  const rows: string[][] = [[reportTitle(t, doc)], []];

  if (doc.white_label) {
    rows.push([t('report.whiteLabel.title')]);
    rows.push([
      t('report.whiteLabel.preparedBy', { agency: doc.white_label.agency_name }),
    ]);
    rows.push([doc.white_label.contact]);
    if (doc.white_label.logo_url !== null) {
      rows.push([t('report.whiteLabel.logoUrl'), doc.white_label.logo_url]);
    }
    rows.push([]);
  }

  rows.push([t('report.headline')]);
  rows.push([t('report.csvHeader.metric'), t('report.csvHeader.value'), t('report.csvHeader.delta')]);
  for (const metric of doc.headline) {
    rows.push([
      t(`report.metrics.${metric.metric}`, { nsSeparator: false }),
      metricValueText(metric.unit, metric.value),
      metric.delta === null ? '' : metricDeltaText(t, metric.unit, metric.delta),
    ]);
  }
  rows.push([]);

  for (const section of doc.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'table') continue;
      rows.push([sectionTitle(t, section)]);
      rows.push(block.column_keys.map((key) => columnLabel(t, key)));
      for (const row of block.rows) {
        rows.push(block.column_keys.map((key, index) => tableCellText(t, key, row[index] ?? '')));
      }
      rows.push([]);
    }
  }

  rows.push([t('report.nextSteps')]);
  for (const step of doc.next_steps) rows.push([step]);
  rows.push([]);

  rows.push([t('report.methodology.title')]);
  for (const line of methodologyLines(t, doc)) rows.push([line]);
  rows.push([]);
  rows.push([t('report.disclaimer')]);

  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

/** 按格式组装导出文本。 */
export function composeReport(
  doc: ReportDocument,
  t: TFunction,
  kind: ReportExportKind,
): string {
  if (kind === 'markdown') return composeMarkdown(t, doc);
  if (kind === 'html') return composeHtml(t, doc);
  return composeCsv(t, doc);
}

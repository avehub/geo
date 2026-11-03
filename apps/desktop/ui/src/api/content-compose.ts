/**
 * 生成文稿的**导出文本**组装（M6）。与 `report-compose.ts` 同族但小得多：
 * 文稿正文本来就是 Markdown（`GeneratedContent.body_markdown`），所以
 * - `markdown`：原样导出（这才是可交付物本体）；
 * - `html`：把正文当**预格式文本**塞进一个带 `<meta charset>` 的最小 HTML 壳里。
 *
 * 🔴 这里**不做 Markdown → HTML 渲染**：那要引一个解析器，而 demo 要的是把导出通路走查一遍
 * （AGENTS 规则 9 的同族取舍：不在 demo 里造一份桌面端注定要重写的排版能力）。
 * `csv` / `docx` / `pdf` / `png` 一律走「桌面端提供」的置灰提示（`DESKTOP_ONLY_EXPORT_FORMATS`
 * 之外的那两种在文稿这里同样产不出，判据在 `CONTENT_EXPORTABLE_FORMATS`）。
 *
 * 正文是**数据**（种子预置的演示文稿），HTML 那一支必须转义：文稿里出现 `<` 不该被当标记执行。
 */
import type { ExportFormat, GeneratedContent } from './types';
import { i18n } from '../i18n';

/** 文稿这里真能产出的格式。 */
export type ContentExportKind = 'markdown' | 'html';

export const CONTENT_EXPORTABLE_FORMATS: readonly ExportFormat[] = ['markdown', 'html'];

const EXTENSIONS: Record<ContentExportKind, string> = { markdown: 'md', html: 'html' };

/** 文件名：`geo-content-<id>.<ext>`。id 是 ASCII（种子的命名纪律），不含中文 ⇒ 下载属性不会掉。 */
export function contentFileName(content: GeneratedContent, kind: ContentExportKind): string {
  return `geo-content-${content.id}.${EXTENSIONS[kind]}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * 当前界面语言（HTML 的 `lang`）。
 *
 * 文稿导出没有 `t` 参数（调用方只传内容与格式），所以从 i18n 单例取当前语言；
 * 但保留显式 `lang` 入参，测试与将来的桌面端可以注入，不依赖全局状态。
 */
function currentLanguage(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN';
}

/** 按格式组装导出文本。 */
export function composeContent(
  content: GeneratedContent,
  kind: ContentExportKind,
  lang: string = currentLanguage(),
): string {
  if (kind === 'markdown') return content.body_markdown;
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(lang)}">`,
    '<head><meta charset="utf-8">',
    `<title>${escapeHtml(content.title)}</title></head>`,
    '<body>',
    `<h1>${escapeHtml(content.title)}</h1>`,
    `<pre>${escapeHtml(content.body_markdown)}</pre>`,
    '</body>',
    '</html>',
  ].join('\n');
}

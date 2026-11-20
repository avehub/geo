/**
 * 报告文件导出的窄封装。
 *
 * 本文件**不改** `api/client.ts` 的命令清单：只在既有 `export_write_file` 上多传一个
 * 可选 `format`（`text` / `pdf` / `xlsx`）。后端缺省按 `text` 处理，其他调用点（项目、
 * 题库、站点交接单）继续走 `client.exportWriteFile`，行为不变。
 */
import { call } from './client';

/** `export_write_file` 的落盘格式。缺省 `text` 与存量调用一致。 */
export type ExportFileFormat = 'text' | 'pdf' | 'xlsx';

/**
 * 导出报告文件，返回最终路径；用户在桌面端取消时返回 `null`。
 *
 * PDF 的 `content` 是 HTML，XLSX 的 `content` 是 CSV；两者都由 `api/report-compose.ts`
 * 按当前界面语言组装，二进制转换留给 Rust 侧。
 */
export function exportReportFile(
  defaultName: string,
  content: string,
  withBom: boolean,
  format: ExportFileFormat = 'text',
  title?: string,
): Promise<string | null> {
  return call<string | null>('export_write_file', {
    default_name: defaultName,
    content,
    with_bom: withBom,
    format,
    title,
  });
}

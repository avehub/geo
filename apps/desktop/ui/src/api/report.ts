/**
 * M7 报告与分享的 IPC wrapper（1 条命令）。
 *
 * 导出**不在这里**：`report_render` 只回结构化文档，Markdown / HTML / CSV 文本由
 * `api/report-compose.ts` 按当前界面语言拼出来，再交给既有的 `client.exportWriteFile`
 * 落盘（桌面端）或走 blob 下载（demo 浏览器）。这样导出的表头与节标题会随语言走，
 * 而不是把种子里的中文写死进文件。
 */
import { call } from './client';
import type { ReportDocument, ReportRenderOptions } from './types';

/** 按版本渲染一份报告（老板版 / 执行版 / 白标版）。 */
export const reportRender = (projectId: string, roundId: string, options: ReportRenderOptions) =>
  call<ReportDocument>('report_render', { project_id: projectId, round_id: roundId, options });

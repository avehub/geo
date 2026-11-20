import { useState } from 'react';
import { App, Button, Card, Space, Typography } from 'antd';
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import { describeIpcError } from '../api/errors';
import { exportReportFile } from '../api/export';
import {
  composeReport,
  reportBinaryFileName,
  reportFileName,
  type ReportBinaryExportKind,
  type ReportExportKind,
} from '../api/report-compose';
import { runtime } from '../api/runtime';
import { DESKTOP_ONLY_EXPORT_FORMATS, type ReportDocument } from '../api/types';
import { dateTimeText } from './format';
import { enumLabel } from '../i18n/enum-label';

/** demo 里真能产出的三种（`EXPORT_FORMAT_VALUES` 减去桌面端那几种）。 */
const DEMO_KINDS: readonly ReportExportKind[] = ['markdown', 'html', 'csv'];

/** 桌面端额外启用的二进制格式。 */
const BINARY_KINDS: readonly ReportBinaryExportKind[] = ['pdf', 'xlsx'];

/** 导出条展示的完整格式面：契约里的六种 + 报告页额外的 XLSX。 */
const REPORT_EXPORT_FORMATS = [
  'markdown',
  'html',
  'csv',
  'docx',
  'pdf',
  'xlsx',
  'png',
] as const;

type ReportExportFormat =
  | ReportExportKind
  | ReportBinaryExportKind
  | (typeof REPORT_EXPORT_FORMATS)[number];

function isTextKind(format: ReportExportFormat): format is ReportExportKind {
  return (DEMO_KINDS as readonly string[]).includes(format);
}

function isBinaryKind(format: ReportExportFormat): format is ReportBinaryExportKind {
  return (BINARY_KINDS as readonly string[]).includes(format);
}

function isExportable(format: ReportExportFormat): format is ReportExportKind | ReportBinaryExportKind {
  if (isTextKind(format)) return true;
  return isBinaryKind(format) && runtime === 'tauri';
}

/**
 * M7 导出与分享条。
 *
 * # demo 与桌面端的格式面
 * demo 只有纯前端的文本落盘能力 ⇒ Markdown / HTML / CSV 可点，其余置灰。
 * 桌面端走 Rust 的 `export_write_file`：PDF 由无头 Chrome 打印 HTML，XLSX 由 CSV 写入表格，
 * 所以 PDF / XLSX 在桌面端启用；Word / PNG 仍由后续版本提供。
 *
 * # 导出文本与预览同源
 * `composeReport(doc, t, kind)` 用的就是预览那批格式化函数与同一套词典 ⇒ 中文界面导出中文报告，
 * 切到英文再导出就是英文报告（AGENTS 规则 7）。CSV 走 `with_bom`，Excel 打开中文不乱码。
 */
export default function ReportExportBar({ doc }: { doc: ReportDocument }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [busy, setBusy] = useState<ReportExportFormat | null>(null);

  async function exportAs(format: ReportExportKind | ReportBinaryExportKind) {
    setBusy(format);
    try {
      const content =
        format === 'pdf'
          ? composeReport(doc, t, 'html')
          : format === 'xlsx'
            ? composeReport(doc, t, 'csv')
            : composeReport(doc, t, format);
      const name =
        format === 'pdf' || format === 'xlsx'
          ? reportBinaryFileName(doc, format)
          : reportFileName(doc, format);
      const path = await exportReportFile(
        name,
        content,
        format === 'csv',
        format === 'pdf' || format === 'xlsx' ? format : 'text',
        t('common.exportDialogTitle'),
      );
      if (path === null) {
        message.info(t('report.export.cancelled'));
        return;
      }
      message.success(t('report.export.done', { path }));
    } catch (error) {
      message.error(describeIpcError(error, t));
    } finally {
      setBusy(null);
    }
  }

  /** 复制正文（Markdown）：剪贴板在桌面 WebView 与浏览器里都可用，拿不到就报一句错。 */
  async function copyMarkdown() {
    const text = composeReport(doc, t, 'markdown');
    try {
      await navigator.clipboard.writeText(text);
      message.success(t('report.export.copied'));
    } catch {
      message.error(t('common.unknownError'));
    }
  }

  return (
    <Card size="small" title={t('report.export.title')} style={{ marginBottom: 12 }}>
      <Space size={8} wrap style={{ marginBottom: 8 }}>
        {REPORT_EXPORT_FORMATS.map((format) => (
          <Button
            key={format}
            size="small"
            icon={<DownloadOutlined />}
            disabled={!isExportable(format)}
            loading={busy === format}
            onClick={() => isExportable(format) && void exportAs(format)}
          >
            {enumLabel(t, 'common.exportFormats', format)}
          </Button>
        ))}
        <Button size="small" icon={<CopyOutlined />} onClick={() => void copyMarkdown()}>
          {t('report.export.copy')}
        </Button>
      </Space>

      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        {runtime === 'tauri'
          ? (
              <>
                {BINARY_KINDS.map((format) => (
                  <Typography.Text key={format} type="secondary" style={{ fontSize: 12 }}>
                    {t('report.export.desktopReady', {
                      format: enumLabel(t, 'common.exportFormats', format),
                    })}
                  </Typography.Text>
                ))}
                {DESKTOP_ONLY_EXPORT_FORMATS.filter((format) => format !== 'pdf').map(
                  (format) => (
                    <Typography.Text key={format} type="secondary" style={{ fontSize: 12 }}>
                      {t('report.export.desktopPending', {
                        format: enumLabel(t, 'common.exportFormats', format),
                      })}
                    </Typography.Text>
                  ),
                )}
              </>
            )
          : (
              <>
                {[...DESKTOP_ONLY_EXPORT_FORMATS, 'xlsx' as const].map((format) => (
                  <Typography.Text key={format} type="secondary" style={{ fontSize: 12 }}>
                    {t('report.export.desktopOnly', {
                      format: enumLabel(t, 'common.exportFormats', format),
                    })}
                  </Typography.Text>
                ))}
              </>
            )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {`${t('report.export.generatedAt')}: ${dateTimeText(doc.generated_at)}`}
        </Typography.Text>
      </Space>
    </Card>
  );
}

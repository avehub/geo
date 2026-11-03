import { useState } from 'react';
import { App, Button, Card, Space, Typography } from 'antd';
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import { describeIpcError } from '../api/errors';
import { composeReport, reportFileName, type ReportExportKind } from '../api/report-compose';
import { DESKTOP_ONLY_EXPORT_FORMATS, EXPORT_FORMAT_VALUES, type ExportFormat, type ReportDocument } from '../api/types';
import { dateTimeText } from './format';
import { enumLabel } from '../i18n/enum-label';

/** demo 里真能产出的三种（`EXPORT_FORMAT_VALUES` 减去桌面端那三种）。 */
const DEMO_KINDS: readonly ReportExportKind[] = ['markdown', 'html', 'csv'];

function isDemoExportable(format: ExportFormat): format is ReportExportKind {
  return (DEMO_KINDS as readonly ExportFormat[]).includes(format);
}

/**
 * M7 导出与分享条：Markdown / HTML / CSV 真出文件，Word / PDF / PNG 置灰。
 *
 * # 🔴 六个按钮都渲染，但只有三个能点
 * 产品负责人要看到**完整的导出面**（M7 的验收里写着这些格式），所以不能把产不出的三种藏起来；
 * 但也不许假装能出（`DESKTOP_ONLY_EXPORT_FORMATS`：docx 要文档库，pdf / png 要原生渲染或 canvas，
 * 纯前端 demo 不引这些依赖）。置灰 + 逐条说明"由桌面端提供"，差异登记在
 * `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`。
 *
 * # 导出文本与预览同源
 * `composeReport(doc, t, kind)` 用的就是预览那批格式化函数与同一套词典 ⇒ 中文界面导出中文报告，
 * 切到英文再导出就是英文报告（AGENTS 规则 7：导出文件是给用户看的产物，同样归双语管）。
 * CSV 走 `with_bom`，Excel 打开中文不乱码（与 `CsvToolbar` 同一个取舍）。
 */
export default function ReportExportBar({ doc }: { doc: ReportDocument }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [busy, setBusy] = useState<ReportExportKind | null>(null);

  async function exportAs(kind: ReportExportKind) {
    setBusy(kind);
    try {
      const path = await client.exportWriteFile(
        reportFileName(doc, kind),
        composeReport(doc, t, kind),
        kind === 'csv',
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
        {[...EXPORT_FORMAT_VALUES].map((format) => (
          <Button
            key={format}
            size="small"
            icon={<DownloadOutlined />}
            disabled={!isDemoExportable(format)}
            loading={busy === format}
            onClick={() => isDemoExportable(format) && void exportAs(format)}
          >
            {enumLabel(t, 'common.exportFormats', format)}
          </Button>
        ))}
        <Button size="small" icon={<CopyOutlined />} onClick={() => void copyMarkdown()}>
          {t('report.export.copy')}
        </Button>
      </Space>

      <Space direction="vertical" size={2} style={{ width: '100%' }}>
        {[...DESKTOP_ONLY_EXPORT_FORMATS].map((format) => (
          <Typography.Text key={format} type="secondary" style={{ fontSize: 12 }}>
            {t('report.export.desktopOnly', {
              format: enumLabel(t, 'common.exportFormats', format),
            })}
          </Typography.Text>
        ))}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {`${t('report.export.generatedAt')}: ${dateTimeText(doc.generated_at)}`}
        </Typography.Text>
      </Space>
    </Card>
  );
}

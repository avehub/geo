import { useState } from 'react';
import { App, Button, Input, Modal, Space, Typography } from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import type { CsvRowErrorLike } from '../api/errors';
import { describeCsvRowError, describeIpcError } from '../api/errors';
import { PROMPT_CSV_HEADER } from '../api/constants';

export interface CsvToolbarProps {
  setId: string;
  filenamePrefix: string;
  onChanged: () => void;
}

/** `IpcRequestError.detail` 里那串逐行原因（`prompt_set/empty_import` 的口径）。 */
function csvRowErrorsOf(error: unknown): CsvRowErrorLike[] {
  if (!(error instanceof client.IpcRequestError) || !Array.isArray(error.detail)) return [];
  return error.detail.filter(
    (entry): entry is CsvRowErrorLike =>
      typeof entry === 'object' &&
      entry !== null &&
      Number.isFinite((entry as CsvRowErrorLike).row) &&
      typeof (entry as CsvRowErrorLike).reason === 'string',
  );
}

/**
 * CSV 导出/导入。导出先预览再下载，导入把错误行报回给用户。
 *
 * # 两处文案渲染都**不在本组件里**实现
 *
 * - 命令级失败走 Task 7 的 `describeIpcError`（本地的 `describeError` 已删：它读
 *   `error.userMessage`，而那是 `{code} {k}={v}…` 的紧凑日志串；`'未知错误'` 那句兜底
 *   也是组件里的硬编码中文）。
 * - 行级失败走 Task 8 新增的 `describeCsvRowError`。裁定 B-5 / G-2 **明令禁止**在这里
 *   重写 reason 渲染：`CsvRowError` 不是 `IpcRequestError`（没有 `code`，喂进
 *   `describeIpcError` 只会得到 `common.unknownError`），而 `renderReason` /
 *   `REASON_SCOPES` / allowlist 都是 `errors.ts` 的模块私有。自己写一份就会造出
 *   **第二个、更弱的泄漏面**——`csv_io.rs` 的合规那一支会把命中的广告法红线词原样透传进
 *   `params.value`，这是 Task 7 那条红线泄漏面的第二次出现（复审 F-3a）。
 *
 * 「第 N 行」这个**外壳**同样在词典里（`prompt.csv.rowError`），组件不做字符串拼接：
 * zh 是「第 3 行：…」而 en 是 `Row 3: …`，语序不同，拼接在 en 下就是错的。
 */
export default function CsvToolbar({ setId, filenamePrefix, onChanged }: CsvToolbarProps) {
  const { message, modal } = App.useApp();
  const { t } = useTranslation();
  const [mode, setMode] = useState<'export' | 'import' | null>(null);
  const [csv, setCsv] = useState('');
  const [importText, setImportText] = useState('');

  // 没有 active 题库时 `setId` 是空串：按钮必须置灰，否则每次点击都稳定报 `prompt_set/not_found`。
  const disabled = setId.trim() === '';

  const exportMutation = useMutation({
    mutationFn: () => client.promptSetExportCsv(setId),
    onSuccess: (content) => {
      setCsv(content);
      setMode('export');
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const importMutation = useMutation({
    mutationFn: (payload: string) => client.promptSetImportCsv(setId, payload),
    onSuccess: (result) => {
      const summary = t('prompt.csv.importSummary', {
        imported: result.items.length,
        failed: result.errors.length,
      });
      if (result.errors.length > 0) {
        modal.warning({
          title: summary,
          width: 560,
          content: (
            <ul>
              {result.errors.slice(0, 20).map((error) => (
                <li key={error.row}>{describeCsvRowError(error, t)}</li>
              ))}
            </ul>
          ),
        });
      } else {
        message.success(summary);
      }
      setMode(null);
      setImportText('');
      onChanged();
    },
    onError: (error) => {
      const rows = csvRowErrorsOf(error);
      if (rows.length === 0) {
        message.error(describeIpcError(error, t));
        return;
      }
      // `prompt_set/empty_import` 把逐行原因放进 `detail`：主文案保持稳定 code 的词典句，
      // 行级原因复用 `describeCsvRowError`（与部分成功那条路同一个渲染器）。
      modal.error({
        title: describeIpcError(error, t),
        width: 560,
        content: (
          <ul>
            {rows.slice(0, 20).map((row) => (
              <li key={row.row}>{describeCsvRowError(row, t)}</li>
            ))}
          </ul>
        ),
      });
    },
  });

  /** 走系统「另存为」对话框写文件；用户取消则不提示成功。 */
  async function downloadCsv() {
    try {
      const path = await client.exportWriteFile(`${filenamePrefix}-prompts.csv`, csv, true);
      if (path === null) return;
      message.success(t('prompt.csv.exported', { path }));
      setMode(null);
    } catch (error) {
      message.error(describeIpcError(error, t));
    }
  }

  const lineCount = csv.trim() === '' ? 0 : csv.trim().split('\n').length;

  return (
    <>
      <Space>
        <Button
          icon={<DownloadOutlined />}
          disabled={disabled}
          loading={exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
        >
          {t('prompt.csv.export')}
        </Button>
        <Button
          icon={<UploadOutlined />}
          disabled={disabled}
          onClick={() => {
            setImportText('');
            setMode('import');
          }}
        >
          {t('prompt.csv.import')}
        </Button>
      </Space>

      <Modal
        open={mode === 'export'}
        title={t('prompt.csv.exportPreviewTitle')}
        width={760}
        onCancel={() => setMode(null)}
        okText={t('prompt.csv.download')}
        cancelText={t('common.close')}
        onOk={() => void downloadCsv()}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('prompt.csv.exportHint', { lines: lineCount, columns: PROMPT_CSV_HEADER.length })}
        </Typography.Paragraph>
        <Input.TextArea rows={12} readOnly value={csv} />
      </Modal>

      <Modal
        open={mode === 'import'}
        title={t('prompt.csv.import')}
        width={760}
        confirmLoading={importMutation.isPending}
        onCancel={() => setMode(null)}
        okText={t('prompt.csv.confirmImport')}
        cancelText={t('common.cancel')}
        onOk={() => {
          if (importText.trim() === '') {
            message.warning(t('prompt.csv.emptyWarning'));
            return;
          }
          importMutation.mutate(importText);
        }}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('prompt.csv.importHint', { header: PROMPT_CSV_HEADER.join(',') })}
        </Typography.Paragraph>
        <Input.TextArea
          rows={12}
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder={t('prompt.csv.importPlaceholder')}
        />
      </Modal>
    </>
  );
}

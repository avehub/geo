import { useState } from 'react';
import { App, Button, Input, Modal, Space, Typography } from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';

import * as client from '../api/client';
import { IpcRequestError } from '../api/client';
import { PROMPT_CSV_HEADER } from '../api/constants';

function describeError(error: unknown): string {
  if (error instanceof IpcRequestError) return error.userMessage;
  return error instanceof Error ? error.message : '未知错误';
}

function download(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([`\ufeff${content}`], { type: mime }); // BOM：Excel 打开中文不乱码
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface CsvToolbarProps {
  setId: string;
  filenamePrefix: string;
  onChanged: () => void;
}

/** CSV 导出/导入。导出先预览再下载，导入把错误行原样报回给用户。 */
export default function CsvToolbar({ setId, filenamePrefix, onChanged }: CsvToolbarProps) {
  const { message, modal } = App.useApp();
  const [mode, setMode] = useState<'export' | 'import' | null>(null);
  const [csv, setCsv] = useState('');
  const [importText, setImportText] = useState('');

  const exportMutation = useMutation({
    mutationFn: () => client.promptSetExportCsv(setId),
    onSuccess: (content) => {
      setCsv(content);
      setMode('export');
    },
    onError: (error) => message.error(describeError(error)),
  });

  const importMutation = useMutation({
    mutationFn: (payload: string) => client.promptSetImportCsv(setId, payload),
    onSuccess: (result) => {
      const summary = `导入 ${result.items.length} 条，失败 ${result.errors.length} 行`;
      if (result.errors.length > 0) {
        modal.warning({
          title: summary,
          width: 560,
          content: (
            <ul>
              {result.errors.slice(0, 20).map((error) => (
                <li key={error.row}>
                  第 {error.row} 行：{error.reason}
                </li>
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
    onError: (error) => message.error(describeError(error)),
  });

  const lineCount = csv.trim() === '' ? 0 : csv.trim().split('\n').length;

  return (
    <>
      <Space>
        <Button
          icon={<DownloadOutlined />}
          loading={exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
        >
          导出 CSV
        </Button>
        <Button
          icon={<UploadOutlined />}
          onClick={() => {
            setImportText('');
            setMode('import');
          }}
        >
          导入 CSV
        </Button>
      </Space>

      <Modal
        open={mode === 'export'}
        title="导出 CSV 预览"
        width={760}
        onCancel={() => setMode(null)}
        okText="下载文件"
        cancelText="关闭"
        onOk={() => {
          download(`${filenamePrefix}-prompts.csv`, csv);
          message.success('CSV 已下载');
          setMode(null);
        }}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          共 {lineCount} 行（含表头 {PROMPT_CSV_HEADER.length} 列），UTF-8 带 BOM，可直接用 Excel 打开。
        </Typography.Paragraph>
        <Input.TextArea rows={12} readOnly value={csv} />
      </Modal>

      <Modal
        open={mode === 'import'}
        title="导入 CSV"
        width={760}
        confirmLoading={importMutation.isPending}
        onCancel={() => setMode(null)}
        okText="确认导入"
        cancelText="取消"
        onOk={() => {
          if (importText.trim() === '') {
            message.warning('请先粘贴 CSV 内容');
            return;
          }
          importMutation.mutate(importText);
        }}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          表头必须是：{PROMPT_CSV_HEADER.join(',')}。导入会替换当前题库条目，并生成新的内容哈希。
        </Typography.Paragraph>
        <Input.TextArea
          rows={12}
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder={'text,intent,weight,group_name,tags,source,repeat_count\n宏宇泵业靠谱吗？,purchase_recommendation,3,选购推荐,,manual,1'}
        />
      </Modal>
    </>
  );
}

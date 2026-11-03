import { App, Input, Modal, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import { describeIpcError } from '../api/errors';

export interface LibraryExportModalProps {
  open: boolean;
  title: string;
  /** 一句用途说明（CSV 是"贴进表格软件"，JSON-LD 是"贴进官网 head"）。 */
  hint: string;
  fileName: string;
  content: string;
  /** CSV 传 `true`（Excel 打开中文才不乱码）；JSON-LD 传 `false`。 */
  withBom: boolean;
  onClose: () => void;
}

/**
 * 素材导出的**预览 + 落盘**弹窗（spec DR-44）。
 *
 * 导出文本由 `api/library-compose.ts` 在**前端**组装，这里只负责两件事：给产品负责人看一眼
 * 将要导出的原文，以及走既有的 `export_write_file` 落盘（🔴 不新增导出命令）。
 * 形状照 `CsvToolbar` 的导出弹窗：先预览再下载，用户取消（真后端回 `null`）时不提示成功。
 *
 * ⚠ demo 里 `export_write_file` 走浏览器下载并回**文件名**而不是最终路径（差异台账 E-19），
 * 所以提示语在演示模式下读作「已导出：geo-keywords-….csv」。这条已知差异不在本轮修。
 */
export default function LibraryExportModal({
  open,
  title,
  hint,
  fileName,
  content,
  withBom,
  onClose,
}: LibraryExportModalProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();

  const downloadMutation = useMutation({
    mutationFn: () => client.exportWriteFile(fileName, content, withBom),
    onSuccess: (path) => {
      if (path === null) return;
      message.success(t('library.export.downloaded', { path }));
      onClose();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const lineCount = content.trim() === '' ? 0 : content.trim().split('\n').length;

  return (
    <Modal
      open={open}
      title={title}
      width={760}
      okText={t('library.export.download')}
      cancelText={t('common.close')}
      confirmLoading={downloadMutation.isPending}
      onCancel={onClose}
      onOk={() => downloadMutation.mutate()}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {hint}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {`${t('library.export.fileName')}: ${fileName} · ${t('library.export.lines', { total: lineCount })}`}
      </Typography.Paragraph>
      <Input.TextArea rows={14} readOnly value={content} />
    </Modal>
  );
}

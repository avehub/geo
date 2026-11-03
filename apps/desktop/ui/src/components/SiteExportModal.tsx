import { useMemo, useState } from 'react';
import { Alert, App, Button, Input, Modal, Select, Space, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useMutation, useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import * as client from '../api/client';
import * as site from '../api/site';
import { describeIpcError } from '../api/errors';
import {
  composeLedgerCsv,
  composeLlmsTxt,
  composePatchesJson,
  composeRobotsTxt,
  composeSiteBundle,
  composeWorkerJs,
  siteExportFileName,
  siteExportNeedsBom,
  SITE_EXPORTABLE_KINDS,
  type SiteExportKind,
} from '../api/site-compose';
import type { SitePatch, SitePatchEvent } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

export interface SiteExportModalProps {
  /** 受控开关（照 `LibraryExportModal`：弹窗常驻挂载，`patches` 变了预览立刻跟着变）。 */
  open: boolean;
  projectId: string;
  /** 要导出的那一批补丁（页面把当前筛选结果传进来：交接单 / 根文件导出所见即所得）。 */
  patches: SitePatch[];
  /** 全部补丁（`patches.json` 是线上数据，必须忽略筛选，否则会静默少下发）。 */
  allPatches: SitePatch[];
  /** `patches.json` 的托管地址：边缘函数要去拉它（页面按站点域名拼）。 */
  patchesUrl: string;
  onClose: () => void;
}

/**
 * 落地文件的**预览 + 落盘**弹窗（spec DR-53）。
 *
 * # 与 `LibraryExportModal` 的分工差异
 * 那边只有一种产物（CSV / JSON-LD 各一个入口），所以内容由页面算好传进来；
 * 这边一次要出**六种**产物，页面若都算一遍就是六份 `useMemo` 摆在那里，
 * 而用户只看其中一份 ⇒ 选择器与组装都收进本组件，页面只传"哪一批补丁"。
 *
 * # 🔴 组装口径在 `api/site-compose.ts`，这里不重判一遍
 * 交接单 / `llms.txt` / `robots.txt` 只收**已人工审核通过**的补丁，`patches.json` 只收
 * **已发布**的补丁（规则 6）。零条可用时组装函数回 `null` ⇒ 这里置灰下载并说明原因
 * （`export.disabled` + `disabledHint`），而不是导出一份空壳文件。
 *
 * ⚠ demo 里 `export_write_file` 走浏览器下载并回**文件名**而不是最终路径（差异台账 E-19），
 * 所以提示语在演示模式下读作「已导出：geo-site-bundle-….md」。
 */
export default function SiteExportModal({
  open,
  projectId,
  patches,
  allPatches,
  patchesUrl,
  onClose,
}: SiteExportModalProps) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [kind, setKind] = useState<SiteExportKind>('bundle');

  /**
   * 台账 CSV 是**补丁 × 事件**扁平表：事件只能按补丁逐条查（`site_patch_history`
   * 没有批量口径）。只在选中台账时开查询，避免打开导出弹窗就发 8 个请求。
   * 🔴 导出用 `allPatches`（全量），不是当前筛选结果——留档不能漏掉筛选外的补丁。
   */
  const historyQueries = useQueries({
    queries: allPatches.map((row) => ({
      queryKey: ['site-patch-history', row.id],
      queryFn: () => site.sitePatchHistory(row.id),
      enabled: open && kind === 'ledger_csv',
    })),
  });
  const ledgerEvents = historyQueries.flatMap((query) => query.data ?? []) as SitePatchEvent[];

  const content = useMemo<string | null>(() => {
    switch (kind) {
      case 'bundle':
        return composeSiteBundle(t, patches);
      case 'llms_txt':
        return composeLlmsTxt(patches);
      case 'robots_txt':
        return composeRobotsTxt(patches);
      case 'patches_json':
        return composePatchesJson(allPatches);
      case 'worker_js':
        return composeWorkerJs(t, projectId, patchesUrl);
      case 'ledger_csv':
        return composeLedgerCsv(allPatches, ledgerEvents);
    }
  }, [allPatches, kind, ledgerEvents, patches, projectId, patchesUrl, t]);

  const downloadMutation = useMutation({
    mutationFn: () =>
      client.exportWriteFile(siteExportFileName(projectId, kind), content ?? '', siteExportNeedsBom(kind)),
    onSuccess: (path) => {
      // 真后端回最终路径，demo 回文件名，用户取消回 null（三种都不该报成功）。
      if (path === null) return;
      message.success(t('site.export.downloaded', { path }));
      onClose();
    },
    onError: (error) => message.error(describeIpcError(error, t)),
  });

  const fileName = siteExportFileName(projectId, kind);
  const lineCount = content === null ? 0 : content.trim().split('\n').length;

  return (
    <Modal
      open={open}
      title={t('site.export.title')}
      width={860}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>{t('common.close')}</Button>
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            disabled={content === null}
            loading={downloadMutation.isPending}
            onClick={() => downloadMutation.mutate()}
          >
            {t('site.export.download')}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('site.export.hint')}
      </Typography.Paragraph>

      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Select
          aria-label={t('site.export.kind')}
          value={kind}
          style={{ width: 320 }}
          onChange={(value: SiteExportKind) => setKind(value)}
          options={SITE_EXPORTABLE_KINDS.map((value) => ({
            value,
            label: enumLabel(t, 'site.export.kinds', value),
          }))}
        />
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {enumLabel(t, 'site.export.about', kind)}
        </Typography.Paragraph>
        {kind === 'llms_txt' ? (
          <Alert type="info" showIcon message={t('site.export.llmsTxtNote')} />
        ) : null}
        {content === null ? (
          <Alert
            type="warning"
            showIcon
            message={t('site.export.disabled')}
            description={t('site.export.disabledHint')}
          />
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {`${t('site.export.fileName')}: ${fileName} · ${t('site.export.lines', { total: lineCount })}`}
          </Typography.Text>
        )}
        <Input.TextArea rows={16} readOnly value={content ?? ''} />
      </Space>
    </Modal>
  );
}

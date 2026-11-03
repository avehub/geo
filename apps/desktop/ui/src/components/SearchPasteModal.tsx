import { useState } from 'react';
import { Alert, DatePicker, Input, Modal, Select, Space, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';

import {
  SEARCH_INGEST_ERROR_KEYS,
  defaultIngestRange,
  ingestSummaryText,
} from '../api/search-ingest';
import type { SearchMetricImportResult, SearchSourceKind } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

/** 一次提交要交给页面的四样东西（== `search_metric_import_csv` 的入参，DR-98）。 */
export interface SearchIngestValues {
  kind: SearchSourceKind;
  payload: string;
  periodStart: string;
  periodEnd: string;
}

export interface SearchPasteModalProps {
  /** 支持 `paste_parse` 的一期源（二期源一个入口都不给，DR-92）。 */
  sources: readonly SearchSourceKind[];
  /** 默认选中的源：粘贴是百度《AI 流量分析》的**主**路径（DR-113）。 */
  defaultKind: SearchSourceKind;
  /** 页面的 `search_board.as_of`；默认区间必须与它同一锚点。 */
  asOf: string;
  importing: boolean;
  /** 上一次提交的结论（`null` = 还没提交过）。 */
  result: SearchMetricImportResult | null;
  onCancel: () => void;
  onSubmit: (values: SearchIngestValues) => void;
}

/** 结论那一句：零行零错 ⇒ "没有数据行"，带警告 ⇒ 报警告数，否则报入库行数。 */

/**
 * 「粘贴后台表格」弹窗（spec `2026-10-12-webmaster-data-integration-design.md` DR-113，
 * 走查 6 / 7）。
 *
 * # 🔴 粘贴是**一等**接入形态，不是 CSV 导入的备胎
 * 最该接的那批源全都没有读数接口（百度《AI 流量分析》灰度，且只有「AI 引用热门关键词」
 * 一张表带下载按钮），所以取数动作发生在**客户自己的浏览器**里：我们不持有凭据、
 * 不向平台发请求、不绕过任何技术措施（DR-114 / AGENTS 规则 11）。界面上它是**主按钮**，
 * 本弹窗底部常驻 `webmasterData.pasteNote` 那句产品承诺——🔴 不许收进问号 tooltip。
 *
 * # 🔴 这里**不解析**
 * 列识别（按表头文字认列、不要求列序）、千分位与中文「万」归一、行级校验全在后端那一条命令里
 * （`search_metric_import_csv` 同时吃文件与粘贴文本 ⇒ 命令面仍是 6 条，DR-113）。
 * 本弹窗只收四样东西：源、文本、区间起点、区间末日。
 *
 * # 🔴 区间必须由用户**显式确认**（DR-98）
 * 百度那份导出**没有日期列**，入库时 `window_source` 记 `user_stated`，
 * 参与源清单里因此显示"区间由导入时确认"而不是"平台声明"。
 */
export default function SearchPasteModal({
  sources,
  defaultKind,
  asOf,
  importing,
  result,
  onCancel,
  onSubmit,
}: SearchPasteModalProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<SearchSourceKind>(defaultKind);
  const [payload, setPayload] = useState('');
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => defaultIngestRange(asOf));

  return (
    <Modal
      open
      width={720}
      title={t('webmasterData.import.pasteTitle')}
      okText={t('webmasterData.import.pasteRun')}
      cancelText={t('webmasterData.import.cancel')}
      confirmLoading={importing}
      okButtonProps={{ disabled: payload.trim() === '' }}
      onCancel={onCancel}
      onOk={() =>
        onSubmit({
          kind,
          payload,
          periodStart: range[0].format('YYYY-MM-DD'),
          periodEnd: range[1].format('YYYY-MM-DD'),
        })
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={t('webmasterData.import.pasteHint')}
      />
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space size={6} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('webmasterData.import.sourceLabel')}
          </Typography.Text>
          <Select<SearchSourceKind>
            size="small"
            style={{ minWidth: 280 }}
            value={kind}
            onChange={setKind}
            options={sources.map((value) => ({
              value,
              label: enumLabel(t, 'webmasterData.sources', value),
            }))}
          />
        </Space>

        <Input.TextArea
          rows={8}
          aria-label={t('webmasterData.import.pasteAria')}
          placeholder={t('webmasterData.import.pastePlaceholder')}
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
        />

        <Space size={6} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('webmasterData.import.periodLabel')}
          </Typography.Text>
          <DatePicker.RangePicker
            size="small"
            allowClear={false}
            value={range}
            onChange={(dates) => {
              if (dates === null || dates[0] === null || dates[1] === null) return;
              setRange([dates[0], dates[1]]);
            }}
          />
        </Space>
        {/* 🔴 常驻：区间要用户自己确认，理由（导出没有日期列）得写在旁边。 */}
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {t('webmasterData.import.periodHint')}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {t('webmasterData.import.normalizeHint')}
        </Typography.Paragraph>
        {/* 🔴 常驻（DR-113）：这句是产品承诺，不是免责套话。 */}
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {t('webmasterData.pasteNote')}
        </Typography.Paragraph>

        {result === null ? null : (
          <Alert
            type={result.errors.length === 0 ? 'success' : 'error'}
            showIcon
            message={ingestSummaryText(t, result)}
          />
        )}
        {result === null || result.errors.length === 0 ? null : (
          <Typography.Paragraph type="danger" style={{ fontSize: 12, marginBottom: 0 }}>
            {t('webmasterData.import.errorsTitle', { total: result.errors.length })}
          </Typography.Paragraph>
        )}
        {result?.errors.map((error, index) => {
          const key = SEARCH_INGEST_ERROR_KEYS[error.reason];
          return (
            <Typography.Paragraph key={index} type="danger" style={{ fontSize: 12, marginBottom: 0 }}>
              {key === undefined
                ? t('webmasterData.import.errUnknownReason', {
                    row: error.row,
                    reason: error.reason,
                  })
                : t(key, { nsSeparator: false, row: error.row, ...error.params })}
            </Typography.Paragraph>
          );
        })}
        {result?.warnings.map((warning) => (
          <Typography.Paragraph
            key={`${warning.row}:${warning.kind}`}
            type="warning"
            style={{ fontSize: 12, marginBottom: 0 }}
          >
            {t('webmasterData.import.warnCtrMismatch', {
              row: warning.row,
              ...warning.params,
            })}
          </Typography.Paragraph>
        ))}
      </Space>
    </Modal>
  );
}

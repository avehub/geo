import { useState } from 'react';
import { Alert, Button, DatePicker, Modal, Select, Space, Typography, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';

import {
  SEARCH_INGEST_ERROR_KEYS,
  defaultIngestRange,
  ingestSummaryText,
} from '../api/search-ingest';
import { readXlsxGrid } from '../api/search-xlsx';
import type { SearchMetricImportResult, SearchSourceKind } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import type { SearchIngestValues } from './SearchPasteModal';

/** 两张模板（`api/constants.ts` 的 `SEARCH_QUERY_CSV_HEADER` / `SEARCH_AI_SUMMARY_CSV_HEADER`）。 */
export type SearchImportTemplate = 'web' | 'ai';

export interface SearchImportModalProps {
  /** 支持 `file_import` 的一期源。 */
  sources: readonly SearchSourceKind[];
  defaultKind: SearchSourceKind;
  /** 页面的 `search_board.as_of`；默认区间必须与它同一锚点。 */
  asOf: string;
  importing: boolean;
  result: SearchMetricImportResult | null;
  onCancel: () => void;
  onSubmit: (values: SearchIngestValues) => void;
  /** 下载模板：走既有 `export_write_file`，🔴 不新增导出命令（DR-97 ③）。 */
  onTemplate: (template: SearchImportTemplate) => void;
}


/**
 * 「导入 CSV / XLSX」弹窗（spec `2026-10-12-webmaster-data-integration-design.md` DR-98，
 * 走查 8 / 19 / 20）。
 *
 * # 🔴 次按钮，但**必须吃 xlsx**（DR-98 实测）
 * 百度《AI 流量分析》的官方导出**只有 xlsx**（表头五列原文 `关键词|AI引用量|AI曝光量|AI点击量|AI点击率`、
 * 无日期列、空站点导出仅表头）。按钮文案因此写 `CSV / XLSX` 而不是走查清单里那个"导入 CSV"：
 * 只写 CSV 等于把主用途藏起来。
 *
 * # 🔴 xlsx 在前端解成网格再走**同一条**管线
 * `api/search-xlsx.ts` 的 `readXlsxGrid` 把 `Sheet1` 读成二维字符串，这里拼成 TSV 交给
 * `search_metric_import_csv`（它的 `payload` 本来就是字符串，与粘贴共用列识别与校验）
 * ⇒ 命令面仍是 6 条（DR-113）。
 *
 * # 🔴 空文件是**成功**而不是错误（走查 19）
 * 仅表头零数据行 ⇒ 导入成功、提示"该文件没有数据行"、合计不变。
 *
 * # 🔴 非 xlsx / 非 csv 走稳定 reason + 词典文案（走查 20），不崩、不白屏。
 *
 * # 🔴 刻意**没有**"站内分析模板"那一档
 * `api/constants.ts` 只给两张模板：百度统计的量纲是会话，给它一张与曝光并列的模板
 * 就等于暗示它能进合计（DR-95 C 类 / DR-110 护栏 2）。
 */
export default function SearchImportModal({
  sources,
  defaultKind,
  asOf,
  importing,
  result,
  onCancel,
  onSubmit,
  onTemplate,
}: SearchImportModalProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<SearchSourceKind>(defaultKind);
  const [payload, setPayload] = useState('');
  const [fileName, setFileName] = useState('');
  /** 读文件本身的失败（格式不对 / xlsx 解不开）：稳定 reason，按 `SEARCH_INGEST_ERROR_KEYS` 渲染。 */
  const [readFailure, setReadFailure] = useState<string | null>(null);
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => defaultIngestRange(asOf));

  async function pick(file: File): Promise<void> {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.xlsx')) {
        const outcome = readXlsxGrid(new Uint8Array(await file.arrayBuffer()));
        if (!outcome.ok) {
          setReadFailure(outcome.reason);
          setPayload('');
          return;
        }
        // 拼成 TSV：与粘贴进来的表格同形，后端那一套列识别不必知道文本从哪来。
        setPayload(outcome.grid.map((cells) => cells.join('\t')).join('\n'));
      } else if (name.endsWith('.csv')) {
        setPayload(await file.text());
      } else {
        setReadFailure('not_allowed');
        setPayload('');
        return;
      }
      setReadFailure(null);
      setFileName(file.name);
    } catch {
      // 读盘失败（权限 / 文件被移走）：与"格式不对"同一档处置，不去猜原因。
      setReadFailure('not_allowed');
      setPayload('');
    }
  }

  // 🔴 查不到词典键时用 `undefined`（不是 `null`）：下面那处 `failureKey === undefined`
  // 的分支要同时兜住"没有失败"与"这个 reason 不在 `SEARCH_INGEST_ERROR_KEYS` 里"两种情况，
  // 后者按 DR-107 的口径**原样显示 reason**（不猜、不静默丢），与行级错误那一段同形。
  const failureKey = readFailure === null ? undefined : SEARCH_INGEST_ERROR_KEYS[readFailure];

  return (
    <Modal
      open
      width={720}
      title={t('webmasterData.import.fileTitle')}
      okText={t('webmasterData.import.ok')}
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
        message={t('webmasterData.import.fileHint')}
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

        <Space size={6} wrap>
          <Upload
            accept=".csv,.xlsx"
            maxCount={1}
            showUploadList={false}
            beforeUpload={(file) => {
              void pick(file);
              // 🔴 返回 false：不走 antd 的上传（我们没有上传端点，文件在前端就地解析）。
              return false;
            }}
          >
            <Button size="small" icon={<UploadOutlined />}>
              {t('webmasterData.import.filePick')}
            </Button>
          </Upload>
          {fileName === '' ? null : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {fileName}
            </Typography.Text>
          )}
        </Space>
        {readFailure === null ? null : (
          <Alert
            type="error"
            showIcon
            message={
              failureKey === undefined
                ? readFailure
                : t(failureKey, { nsSeparator: false, row: 1, column: '', value: fileName })
            }
          />
        )}

        <Space size={6} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('webmasterData.import.templates')}
          </Typography.Text>
          <Button size="small" onClick={() => onTemplate('web')}>
            {t('webmasterData.import.templateWeb')}
          </Button>
          <Button size="small" onClick={() => onTemplate('ai')}>
            {t('webmasterData.import.templateAi')}
          </Button>
        </Space>

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
        {/* 🔴 常驻：导出文件里没有日期列，区间要用户自己确认（DR-98）。 */}
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {t('webmasterData.import.periodHint')}
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
            {t('webmasterData.import.warnCtrMismatch', { row: warning.row, ...warning.params })}
          </Typography.Paragraph>
        ))}
      </Space>
    </Modal>
  );
}

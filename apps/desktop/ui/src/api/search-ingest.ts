/**
 * 「导入 CSV / XLSX」与「粘贴后台表格」两个弹窗的**共享常量**（P3 契约整洁度）。
 *
 * 两个弹窗不会同时开着，但默认区间与错误码映射**必须只有一份**：各抄一份之后，
 * 任何一次口径调整（例如把窗口从 28 天改成 30 天、或新增一个 reason）都极易只改一处，
 * 于是同一个错误在粘贴弹窗里是中文、在导入弹窗里是机器记号。
 *
 * 🔴 放在 `api/` 而不是 `components/`：组件目录里加非组件文件会触发 fast-refresh 规约
 * （每个文件只导出组件），当初两份重复就是这么来的。
 */
import dayjs, { type Dayjs } from 'dayjs';
import type { TFunction } from 'i18next';

import type { SearchMetricImportResult } from './types';

/**
 * 默认区间：以页面的 `search_board.as_of` 为锚，`as_of - 27 天` ~ `as_of - 1 天`（整 28 天）。
 *
 * 🔴 **不取系统今天**：demo 的数据日期是固定的，用 `dayjs()` 会让同一个页面在不同日期
 * 演示出不同区间，并让导入的数据落在种子窗口之外。真实导出通常也不是"到今天为止"。
 */
export function defaultIngestRange(asOf: string): [Dayjs, Dayjs] {
  const anchor = dayjs(asOf);
  return [anchor.subtract(27, 'day'), anchor.subtract(1, 'day')];
}

/**
 * `SearchTableError.reason` → 词典键（对应表来自 `api/search-paste.ts` 的头注释）。
 *
 * 认不出的 reason **回退成 reason 本身**（一个机器记号），不去猜一句人话
 * ——与 `enumLabel` 的"查不到回退 id"同一条纪律（DR-107）。
 * 键类型保持 `string` 而不是字面量联合：调用方拿到的 reason 来自后端，本就可能是新键，
 * 用联合类型只会骗过编译器、运行时照样查不到。
 */
export const SEARCH_INGEST_ERROR_KEYS: Readonly<Record<string, string>> = {
  empty: 'webmasterData.import.errEmptyPayload',
  unknown_field: 'webmasterData.import.errUnknownHeader',
  missing_header: 'webmasterData.import.errMissingColumn',
  invalid_format: 'webmasterData.import.errInvalidNumber',
  required: 'webmasterData.import.errRequiredCell',
  not_allowed: 'webmasterData.import.errUnsupportedFile',
} as const;

/**
 * 导入 / 粘贴完成后的**结论摘要**（`Alert` 里那一句）。
 *
 * 两个弹窗逐字共用：`total` 只数「指标行 + AI 汇总」，C 类原生列不重复计数；
 * 空文件（没有错误也没有任何行）与"有行但没解析出内容"共用同一句空态提示。
 */
export function ingestSummaryText(t: TFunction, result: SearchMetricImportResult): string {
  const imported = result.metrics.length + result.ai_overviews.length + result.native_extras.length;
  if (result.errors.length === 0 && imported === 0) return t('webmasterData.import.emptyFile');
  if (result.warnings.length > 0) {
    return t('webmasterData.import.doneWithWarnings', {
      total: result.metrics.length + result.ai_overviews.length,
      warnings: result.warnings.length,
    });
  }
  return t('webmasterData.import.done', { total: result.metrics.length + result.ai_overviews.length });
}

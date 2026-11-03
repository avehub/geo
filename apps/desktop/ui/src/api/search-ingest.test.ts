/**
 * 导入 / 粘贴两个弹窗的**共享常量**（P3 契约整洁度）：
 * ① 默认区间只能有一份实现——两处各抄一份就会在某次口径调整里漂移；
 * ② `SearchTableError.reason → 词典键` 也只能有一份——漏一个 reason 就让客户看到机器记号。
 *
 * 🔴 这两条都钉**精确值**：区间两端按 `YYYY-MM-DD` 逐字断言（含跨月 / 闰年），
 * 错误码映射用 `Object.keys().sort()` 断言**完整集合**（多一个少一个都红）。
 */
import { describe, expect, it } from 'vitest';

import reasonsJson from '../../../../../contracts/search-import-reasons.json';
import { i18n } from '../i18n';
import type { SearchMetricImportResult } from './types';
import { SEARCH_INGEST_ERROR_KEYS, defaultIngestRange, ingestSummaryText } from './search-ingest';

describe('defaultIngestRange', () => {
  it('以 as_of 为锚：前一天是末日，再往前 27 天是起点（整 28 天窗口）', () => {
    const [start, end] = defaultIngestRange('2026-10-12');
    expect(start.format('YYYY-MM-DD')).toBe('2026-09-15');
    expect(end.format('YYYY-MM-DD')).toBe('2026-10-11');
  });

  it('跨月：月初锚点退到上个月，不倒挂', () => {
    const [start, end] = defaultIngestRange('2026-03-01');
    expect(start.format('YYYY-MM-DD')).toBe('2026-02-02');
    expect(end.format('YYYY-MM-DD')).toBe('2026-02-28');
  });

  it('闰年：2 月 29 日参与计算，起点落在 2 月 3 日', () => {
    const [start, end] = defaultIngestRange('2024-03-01');
    expect(start.format('YYYY-MM-DD')).toBe('2024-02-03');
    expect(end.format('YYYY-MM-DD')).toBe('2024-02-29');
  });

  it('不取系统今天：同一 as_of 的结果与运行时间无关', () => {
    const first = defaultIngestRange('2026-10-12');
    const second = defaultIngestRange('2026-10-12');
    expect(first[0].format('YYYY-MM-DD')).toBe(second[0].format('YYYY-MM-DD'));
    expect(first[1].format('YYYY-MM-DD')).toBe(second[1].format('YYYY-MM-DD'));
  });
});

describe('SEARCH_INGEST_ERROR_KEYS', () => {
  it('键集合与 `api/search-paste.ts` 的 reason 目录逐字一致', () => {
    expect(Object.keys(SEARCH_INGEST_ERROR_KEYS).sort()).toEqual([
      'empty',
      'invalid_format',
      'missing_header',
      'not_allowed',
      'required',
      'unknown_field',
    ]);
  });

  it('每个 reason 都指向 `webmasterData.import.*` 词典键（不是自然语言）', () => {
    for (const key of Object.values(SEARCH_INGEST_ERROR_KEYS)) {
      expect(key.startsWith('webmasterData.import.')).toBe(true);
    }
  });

  it('映射内容是逐字固定值', () => {
    expect(SEARCH_INGEST_ERROR_KEYS).toEqual({
      empty: 'webmasterData.import.errEmptyPayload',
      unknown_field: 'webmasterData.import.errUnknownHeader',
      missing_header: 'webmasterData.import.errMissingColumn',
      invalid_format: 'webmasterData.import.errInvalidNumber',
      required: 'webmasterData.import.errRequiredCell',
      not_allowed: 'webmasterData.import.errUnsupportedFile',
    });
  });
});

describe('ingestSummaryText', () => {
  const zh = i18n.getFixedT('zh-CN');
  const base: SearchMetricImportResult = {
    metrics: [],
    ai_overviews: [],
    native_extras: [],
    errors: [],
    warnings: [],
    data_through: null,
  };

  it('空文件与“没有解析出任何行”给同一句空态提示', () => {
    expect(ingestSummaryText(zh, base)).toBe(zh('webmasterData.import.emptyFile'));
  });

  it('有警告时用带警告数的模板，total 只数真正入库的指标行', () => {
    const text = ingestSummaryText(zh, {
      ...base,
      metrics: [{} as SearchMetricImportResult['metrics'][number]],
      warnings: [{} as SearchMetricImportResult['warnings'][number]],
    });
    expect(text).toBe(zh('webmasterData.import.doneWithWarnings', { total: 1, warnings: 1 }));
  });

  it('无警告时用完成模板', () => {
    const text = ingestSummaryText(zh, {
      ...base,
      metrics: [{} as SearchMetricImportResult['metrics'][number]],
    });
    expect(text).toBe(zh('webmasterData.import.done', { total: 1 }));
  });
});

describe('contracts/search-import-reasons.json', () => {
  const catalog = reasonsJson as {
    note: string;
    reasons: Array<{ reason: string; params: string[]; note: string }>;
  };

  it('reason 集合与前端映射逐字相等（新增 reason 必须先改契约）', () => {
    expect(catalog.reasons.map((entry) => entry.reason).sort()).toEqual(
      Object.keys(SEARCH_INGEST_ERROR_KEYS).sort(),
    );
  });

  it('每条 reason 都有 params 数组与非空说明，且不重复', () => {
    expect(catalog.note.trim()).not.toBe('');
    expect(new Set(catalog.reasons.map((entry) => entry.reason)).size).toBe(catalog.reasons.length);
    for (const entry of catalog.reasons) {
      expect(Array.isArray(entry.params), `${entry.reason} 的 params 必须是数组`).toBe(true);
      expect(entry.note.trim(), `${entry.reason} 缺说明`).not.toBe('');
      for (const param of entry.params) {
        expect(param, `${entry.reason} 的 param 名要是 snake_case`).toMatch(/^[a-z][a-z_]*$/);
      }
    }
  });
});

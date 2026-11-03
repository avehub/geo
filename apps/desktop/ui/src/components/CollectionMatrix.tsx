import { useMemo } from 'react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { INTENT_VALUES } from '../api/types';
import type { CollectionRecord, EngineId, IntentCategory } from '../api/types';
import { enumLabel } from '../i18n/enum-label';
import { BRAND } from '../theme/tokens';
import SectionCard from './ui/SectionCard';

interface Cell {
  total: number;
  mentioned: number;
}

/**
 * 引擎 × 意图覆盖矩阵（2026-10-31 · 采集页第一批）。
 *
 * 只做**计数**：每个格子是本品牌提及数 / 样本数，不做评分、排序或百分比换算
 * （AGENTS 规则 9：领域算法不在 demo 里算）。空样本显示 `—`，不显示 0 分。
 *
 * 行 = 本轮出现过的引擎（按 `ENGINE_VALUES` 的固定顺序），列 = 有样本的意图。
 */
export default function CollectionMatrix({ records }: { records: CollectionRecord[] }) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const { engines, intents, cellOf } = useMemo(() => {
    const byEngine = new Map<EngineId, Map<IntentCategory, Cell>>();
    const engineOrder: EngineId[] = [];
    const intentSet = new Set<IntentCategory>();

    for (const record of records) {
      let row = byEngine.get(record.engine);
      if (row === undefined) {
        row = new Map<IntentCategory, Cell>();
        byEngine.set(record.engine, row);
        engineOrder.push(record.engine);
      }
      const cell = row.get(record.intent) ?? { total: 0, mentioned: 0 };
      cell.total += 1;
      if (record.mentioned) cell.mentioned += 1;
      row.set(record.intent, cell);
      intentSet.add(record.intent);
    }

    const intentOrder = INTENT_VALUES.filter((intent) => intentSet.has(intent));
    return {
      engines: engineOrder,
      intents: intentOrder,
      cellOf: (engine: EngineId, intent: IntentCategory): Cell | null =>
        byEngine.get(engine)?.get(intent) ?? null,
    };
  }, [records]);

  if (records.length === 0) {
    return (
      <SectionCard title={t('collection.matrix.title')}>
        <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{t('collection.matrix.empty')}</div>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={t('collection.matrix.title')}
      description={t('collection.matrix.note')}
      bodyStyle={{ padding: 0 }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  padding: '10px 16px',
                  color: token.colorTextSecondary,
                  fontWeight: 500,
                  background: token.colorFillAlter,
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {t('collection.round.engines')}
              </th>
              {intents.map((intent) => (
                <th
                  key={intent}
                  style={{
                    padding: '10px 12px',
                    color: token.colorTextSecondary,
                    fontWeight: 500,
                    background: token.colorFillAlter,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {enumLabel(t, 'prompt.intents', intent)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {engines.map((engine) => (
              <tr key={engine}>
                <td
                  style={{
                    padding: '10px 16px',
                    color: token.colorText,
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {enumLabel(t, 'collection.engines', engine)}
                </td>
                {intents.map((intent) => {
                  const cell = cellOf(engine, intent);
                  return (
                    <td
                      key={intent}
                      style={{
                        padding: '10px 12px',
                        textAlign: 'center',
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                        color: cell === null ? token.colorTextTertiary : token.colorText,
                        fontVariantNumeric: 'tabular-nums',
                        // 提及率着色：0 → 灰；0–1/3 / 1/3–2/3 / >2/3 三档蓝。
                        background:
                          cell === null || cell.total === 0
                            ? undefined
                            : cell.mentioned === 0
                              ? token.colorFillQuaternary
                              : `color-mix(in srgb, ${BRAND.primary} ${
                                  cell.mentioned / cell.total <= 1 / 3
                                    ? 6
                                    : cell.mentioned / cell.total <= 2 / 3
                                      ? 12
                                      : 18
                                }%, ${token.colorBgContainer})`,
                      }}
                    >
                      {cell === null
                        ? '—'
                        : t('collection.matrix.cell', {
                            mentioned: cell.mentioned,
                            total: cell.total,
                          })}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '10px 16px',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          fontSize: 12,
          color: token.colorTextTertiary,
        }}
      >
        <span>{t('collection.matrix.rate')}</span>
        {[
          { key: 'legend0', bg: token.colorFillQuaternary },
          { key: 'legendLow', bg: `color-mix(in srgb, ${BRAND.primary} 6%, ${token.colorBgContainer})` },
          { key: 'legendMid', bg: `color-mix(in srgb, ${BRAND.primary} 12%, ${token.colorBgContainer})` },
          { key: 'legendHigh', bg: `color-mix(in srgb, ${BRAND.primary} 18%, ${token.colorBgContainer})` },
        ].map((entry) => (
          <span key={entry.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: entry.bg,
                border: `1px solid ${token.colorBorderSecondary}`,
              }}
            />
            {t(`collection.matrix.${entry.key}`)}
          </span>
        ))}
      </div>
    </SectionCard>
  );
}

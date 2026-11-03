import type { ReactNode } from 'react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { BRAND } from '../../theme/tokens';
import MetricText from './MetricText';

/** 一条 24px 高的迷你折线：只表达方向，不给刻度（刻度在趋势卡里）。 */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min === 0 ? 1 : max - min;
  const coords = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 20 - ((point - min) / span) * 16;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg width="100%" height="24" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden>
      <polyline
        points={coords}
        fill="none"
        stroke={BRAND.primary}
        strokeOpacity={0.55}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * 指标块（2026-10-30 二稿）。
 *
 * 一稿把「环比 / 区间 / 口径 / 迷你图」全塞进一张卡，四张并排就是一屏小字。
 * 二稿只保留「标签 → 数字 → 环比 → 一句口径」，区间与迷你图改为可选：
 * 首屏默认四块只有数字与环比，细节留给下钻页。
 *
 * 🔴 样本不足时数字置灰而不是藏起来：产品口径是「不给精确分数、只给方向性参考」。
 */
export default function StatTile({
  label,
  value,
  unit,
  delta,
  margin,
  hint,
  insufficient = false,
  spark,
}: {
  label: ReactNode;
  value: string | number;
  unit?: string;
  delta?: { text: string; direction: 'up' | 'down' | 'flat' };
  margin?: ReactNode;
  hint?: ReactNode;
  insufficient?: boolean;
  spark?: number[];
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const deltaColor =
    delta === undefined
      ? token.colorTextTertiary
      : delta.direction === 'up'
        ? BRAND.success
        : delta.direction === 'down'
          ? BRAND.danger
          : token.colorTextTertiary;

  return (
    <div
      data-insufficient={insufficient || undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '16px 20px',
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        boxShadow: token.boxShadowTertiary,
        minWidth: 0,
        height: '100%',
      }}
    >
      <div style={{ fontSize: 12, lineHeight: '18px', color: token.colorTextSecondary }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <MetricText value={value} unit={unit} size="lg" muted={insufficient} />
        {delta === undefined ? null : (
          <span style={{ fontSize: 12, lineHeight: '18px', color: deltaColor, fontWeight: 500 }}>
            {delta.text}
          </span>
        )}
        {margin === undefined ? null : (
          <span style={{ fontSize: 12, lineHeight: '18px', color: token.colorTextTertiary }}>
            {margin}
          </span>
        )}
      </div>
      {hint === undefined ? null : (
        <div style={{ fontSize: 12, lineHeight: '18px', color: token.colorTextTertiary, marginTop: 2 }}>
          {hint}
        </div>
      )}
      {insufficient ? (
        <div style={{ fontSize: 12, lineHeight: '18px', color: token.colorWarning }}>
          {t('common.status.insufficient')}
        </div>
      ) : null}
      {spark === undefined ? null : (
        <div style={{ marginTop: 'auto', paddingTop: 6, opacity: 0.9 }}>
          <Sparkline points={spark} />
        </div>
      )}
    </div>
  );
}

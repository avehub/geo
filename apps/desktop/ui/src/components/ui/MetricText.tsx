import type { CSSProperties } from 'react';

export type MetricSize = 'sm' | 'md' | 'lg';

/**
 * 等宽数字 + 统一的单位排版。
 *
 * 🔴 为什么不用全局 CSS：`tailwind-sources.test.ts` 守的是「产物选择器集合不许新增」，
 * 而 `font-variant-numeric` 这类排版恰恰最容易被写成一条全局规则。内联样式不进 CSS 产物，
 * 所以数字排版只走这个组件——页面里**不要**再手写 `fontVariantNumeric`。
 */
const SIZE_PX: Record<MetricSize, number> = { sm: 14, md: 20, lg: 30 };

export default function MetricText({
  value,
  unit,
  size = 'md',
  muted = false,
  style,
}: {
  value: string | number;
  unit?: string;
  size?: MetricSize;
  muted?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 4,
        fontVariantNumeric: 'tabular-nums',
        fontFeatureSettings: '"tnum"',
        fontSize: SIZE_PX[size],
        fontWeight: 600,
        lineHeight: 1.25,
        letterSpacing: size === 'lg' ? '-0.01em' : 'normal',
        color: muted ? 'inherit' : undefined,
        opacity: muted ? 0.45 : undefined,
        ...style,
      }}
    >
      <span>{value}</span>
      {unit === undefined ? null : (
        <span style={{ fontSize: Math.max(12, Math.round(SIZE_PX[size] * 0.45)), fontWeight: 500, opacity: 0.7 }}>
          {unit}
        </span>
      )}
    </span>
  );
}

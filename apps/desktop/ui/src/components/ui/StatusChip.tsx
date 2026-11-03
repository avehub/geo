import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { BRAND } from '../../theme/tokens';

/** 全站统一的状态语言（AGENTS 规则 8/9：未接入与样本不足都必须可见，不许隐藏）。 */
export type ChipStatus =
  | 'ok'
  | 'running'
  | 'warning'
  | 'error'
  | 'todo'
  | 'unavailable'
  | 'insufficient';

/**
 * 状态徽标（2026-10-30 三稿 · 飞书参照）。
 *
 * 飞书后台的状态是「浅底 + 同色系文字」的小标签（22px 高、4px 圆角），不是彩色 Tag，
 * 也不是裸圆点。这里用 antd 的 `color*Bg` / `color*Text` 成对 token 取色：
 * 亮暗两套由算法派生，组件不自己判断主题。
 */
export default function StatusChip({
  status,
  label,
}: {
  status: ChipStatus;
  /** 覆盖默认词典文案（枚举值需要走 `enumLabel` 时由调用方传入）。 */
  label?: string;
}) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  // 浅底 = 语义色 12% 混进容器色；文字 = 语义色 72% 混进正文色。
  // 两个方向都跟着主题走：亮色里更沉、暗色里更亮，不需要组件自己判断 dark。
  const tint = (color: string, pct: number) =>
    `color-mix(in srgb, ${color} ${pct}%, ${token.colorBgContainer})`;
  const ink = (color: string) => `color-mix(in srgb, ${color} 60%, ${token.colorText})`;

  const palette: Record<ChipStatus, { bg: string; color: string; border?: string }> = {
    ok: { bg: tint(BRAND.success, 14), color: ink(BRAND.success) },
    running: { bg: tint(BRAND.primary, 12), color: ink(BRAND.primary) },
    warning: { bg: tint(BRAND.warning, 14), color: ink(BRAND.warning) },
    error: { bg: tint(BRAND.danger, 12), color: ink(BRAND.danger) },
    todo: { bg: token.colorFillQuaternary, color: token.colorTextSecondary },
    unavailable: {
      bg: 'transparent',
      color: token.colorTextTertiary,
      border: `1px dashed ${token.colorBorder}`,
    },
    insufficient: { bg: tint(BRAND.warning, 14), color: ink(BRAND.warning) },
  };
  const p = palette[status];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        paddingInline: 8,
        borderRadius: 4,
        background: p.bg,
        border: p.border,
        color: p.color,
        fontSize: 12,
        lineHeight: '20px',
        whiteSpace: 'nowrap',
      }}
    >
      {label ?? t(`common.status.${status}`)}
    </span>
  );
}

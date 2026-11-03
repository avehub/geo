import type { ReactNode } from 'react';
import { theme } from 'antd';

import { BRAND } from '../../theme/tokens';

export type VerdictTone = 'positive' | 'neutral' | 'risk' | 'insufficient';

/**
 * 结论条（2026-10-30 二稿）。
 *
 * 一稿是四块带底色的「色条」，一屏里出现两次就像告警墙；二稿退回**白底 + 左侧 3px 竖线**：
 * 结论仍然一眼可见，但不再抢走正文的注意力。tone 只决定竖线与圆点的颜色。
 */
export default function VerdictBar({
  tone,
  kicker,
  headline,
  meta,
  action,
}: {
  tone: VerdictTone;
  kicker: ReactNode;
  headline: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  const { token } = theme.useToken();
  const accent: Record<VerdictTone, string> = {
    positive: BRAND.success,
    neutral: token.colorBorder,
    risk: BRAND.danger,
    insufficient: BRAND.warning,
  };

  return (
    <div
      data-tone={tone}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 20px',
        borderRadius: token.borderRadiusLG,
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderLeft: `3px solid ${accent[tone]}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, lineHeight: '18px', color: token.colorTextTertiary }}>{kicker}</div>
        <div style={{ fontSize: 14, lineHeight: '22px', fontWeight: 600, color: token.colorText }}>
          {headline}
        </div>
        {meta === undefined ? null : (
          <div style={{ fontSize: 12, lineHeight: '18px', color: token.colorTextSecondary, marginTop: 2 }}>
            {meta}
          </div>
        )}
      </div>
      {action === undefined ? null : <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

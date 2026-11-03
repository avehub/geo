import type { CSSProperties, ReactNode } from 'react';
import { theme } from 'antd';

/**
 * 区块容器（2026-10-30 二稿）。
 *
 * 企业风的做法是「一张大平面 + 分隔线」，而不是每块都浮一张带阴影的卡：
 * 这里只留 1px 边框、白底、44px 标题行；正文默认 20px 内边距，表格区块传 `noBodyPadding`。
 */
export default function SectionCard({
  title,
  description,
  extra,
  children,
  style,
  bodyStyle,
  noBodyPadding = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
  noBodyPadding?: boolean;
}) {
  const { token } = theme.useToken();
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        boxShadow: token.boxShadowTertiary,
        minWidth: 0,
        ...style,
      }}
    >
      {title === undefined ? null : (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            minHeight: 48,
            padding: '12px 20px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, lineHeight: '22px', fontWeight: 600, color: token.colorText }}>
              {title}
            </div>
            {description === undefined ? null : (
              <div style={{ fontSize: 12, lineHeight: '18px', color: token.colorTextTertiary }}>
                {description}
              </div>
            )}
          </div>
          {extra === undefined ? null : <div style={{ flexShrink: 0 }}>{extra}</div>}
        </header>
      )}
      <div style={{ flex: 1, minWidth: 0, padding: noBodyPadding ? 0 : 20, ...bodyStyle }}>
        {children}
      </div>
    </section>
  );
}

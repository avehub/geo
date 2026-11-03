import type { ReactNode } from 'react';
import { Empty, theme } from 'antd';

export type EmptyVariant = 'not_started' | 'no_result' | 'unavailable';

/**
 * 空态三型（第 0 轮只做形态，不绑定具体页面）：
 * - `not_started` 给一个 CTA；
 * - `no_result` 提示清筛选；
 * - `unavailable` 说明能力未接入（错误码由调用方放进 body）。
 */
export default function EmptyState({
  variant = 'not_started',
  title,
  description,
  action,
}: {
  variant?: EmptyVariant;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <div
      data-variant={variant}
      style={{ padding: '40px 16px', textAlign: 'center', color: token.colorTextSecondary }}
    >
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 14, color: token.colorText }}>{title}</span>
            {description === undefined ? null : (
              <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{description}</span>
            )}
          </div>
        }
      />
      {action === undefined ? null : <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

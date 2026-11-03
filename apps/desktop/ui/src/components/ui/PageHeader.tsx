import type { ReactNode } from 'react';
import { Breadcrumb, theme } from 'antd';

export interface PageCrumb {
  label: string;
  onClick?: () => void;
}

/**
 * 页面头：面包屑 + 标题 + 状态 + 动作。
 *
 * 高度按 56–64 给（`minHeight`），不写死，长标题可以换行；粘性由调用方决定，
 * 组件本身不写 `position`——项目概览需要粘性，样张页不需要。
 */
export default function PageHeader({
  breadcrumb,
  title,
  description,
  status,
  actions,
}: {
  breadcrumb?: PageCrumb[];
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        minHeight: 56,
        marginBottom: 16,
      }}
    >
      <div style={{ minWidth: 0 }}>
        {breadcrumb === undefined ? null : (
          <Breadcrumb
            style={{ fontSize: 12 }}
            items={breadcrumb.map((crumb, index) => ({
              key: `${crumb.label}-${index}`,
              title:
                crumb.onClick === undefined ? (
                  crumb.label
                ) : (
                  <button
                    type="button"
                    onClick={crumb.onClick}
                    style={{
                      border: 'none',
                      background: 'none',
                      padding: 0,
                      font: 'inherit',
                      color: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    {crumb.label}
                  </button>
                ),
            }))}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              lineHeight: '28px',
              fontWeight: 600,
              color: token.colorText,
            }}
          >
            {title}
          </h1>
          {status}
        </div>
        {description === undefined ? null : (
          <div style={{ marginTop: 2, fontSize: 12, lineHeight: '18px', color: token.colorTextTertiary }}>
            {description}
          </div>
        )}
      </div>
      {actions === undefined ? null : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{actions}</div>
      )}
    </div>
  );
}

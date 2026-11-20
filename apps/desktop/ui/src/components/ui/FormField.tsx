import type { CSSProperties, ReactNode } from 'react';
import { theme } from 'antd';

/**
 * 飞书式表单字段：标签在上、控件在下、说明文字再下一行。
 *
 * 2026-11-06 设置 · 模型服务商重排时抽出。此前本仓的设置表单多用「标签 + 控件」同一行，
 * 长控件（下拉、接口地址、API Key）在窄列里会把标签挤成竖排；飞书后台的单列表单是
 * **标签 → 控件 → 说明**的纵向节奏，这里统一成一个可复用的薄壳，避免两处各写一套间距。
 *
 * 只做排版，不做校验、不登记错误：错误仍由页面用 `Alert` 就地渲染。
 */
export default function FormField({
  label,
  htmlFor,
  hint,
  extra,
  children,
  style,
}: {
  label: ReactNode;
  /** 关联的控件 id；没有可关联控件（如自定义复合控件）时省略。 */
  htmlFor?: string;
  /** 控件下方的 12px 说明，可含插值后的文案。 */
  hint?: ReactNode;
  /** 与标签同一行、靠右的少量状态（如 API Key 的「未配置」标签）。 */
  extra?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 22 }}>
        <label
          htmlFor={htmlFor}
          style={{
            fontSize: 14,
            lineHeight: '22px',
            fontWeight: 500,
            color: token.colorText,
          }}
        >
          {label}
        </label>
        {extra === undefined ? null : <div style={{ display: 'flex', alignItems: 'center' }}>{extra}</div>}
      </div>
      {children}
      {hint === undefined ? null : (
        <div style={{ fontSize: 12, lineHeight: '18px', color: token.colorTextTertiary }}>{hint}</div>
      )}
    </div>
  );
}

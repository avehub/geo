import type { ReactNode } from 'react';
import { Alert, Button } from 'antd';

/**
 * 错误三型里的两种容器形态：卡内局部 / 整页。
 *
 * 🔴 不隐藏（AGENTS 规则 8）：`ipc/unknown_command` 这类错误必须原样上屏，
 * 所以 `description` 是必填项，组件不提供「悄悄吞掉」的开关。
 */
export default function ErrorState({
  scope = 'card',
  title,
  description,
  onRetry,
  retryLabel,
}: {
  scope?: 'card' | 'page';
  title: ReactNode;
  description: ReactNode;
  onRetry?: () => void;
  retryLabel?: ReactNode;
}) {
  return (
    <Alert
      type="error"
      showIcon
      style={scope === 'page' ? { padding: '12px 16px' } : undefined}
      message={title}
      description={description}
      action={
        onRetry === undefined ? undefined : (
          <Button size="small" onClick={onRetry}>
            {retryLabel}
          </Button>
        )
      }
    />
  );
}

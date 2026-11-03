import type { ReactNode } from 'react';
import { Button, Popover, theme } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

/**
 * 口径提示（`?` 图标 + 弹层）。
 *
 * 首页与各业务页都有「这段数字按什么口径算」的说明。一稿把它们写成 12px 灰字段落，
 * 三稿收进这个图标：正文保持干净，需要时再展开。合规要求「常驻可见」的句子
 * （如站点接入的 demoBody / staticNote）**不要**收进来，仍按原位常驻。
 */
export default function InfoHint({
  title,
  body,
  label,
}: {
  title: ReactNode;
  body: ReactNode;
  /** 按钮的可访问名（图标按钮没有可见文字）。 */
  label: string;
}) {
  const { token } = theme.useToken();
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      title={title}
      content={<div style={{ maxWidth: 360, fontSize: 12, lineHeight: '20px' }}>{body}</div>}
    >
      <Button
        type="text"
        size="small"
        aria-label={label}
        icon={<QuestionCircleOutlined />}
        style={{ color: token.colorTextTertiary }}
      />
    </Popover>
  );
}

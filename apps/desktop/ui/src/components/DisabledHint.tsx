import type { ReactElement } from 'react';
import { Tooltip } from 'antd';

export interface DisabledHintProps {
  /** 为什么点不动；传 `null` 表示"这个动作现在可用"，此时不加任何包装。 */
  hint: string | null;
  children: ReactElement;
}

/**
 * 给**置灰**的按钮挂一句"为什么点不动"。
 *
 * 🔴 必须包一层 `<span>`：浏览器不给 `disabled` 的表单控件派发鼠标事件（也不冒泡），
 * 所以 `<Tooltip><Button disabled /></Tooltip>` 的气泡**永远出不来**——而"为什么置灰"
 * 正是这句 tooltip 唯一的存在理由（站点接入那一轮有两处硬性要求：
 * `source_layout` 类处方的「站点补丁」按钮 spec DR-46、以及补丁行上三个有前置条件的动作 DR-47）。
 * 外层 `<span>` 接管 hover，`cursor: not-allowed` 让"不可用"在视觉上成立。
 *
 * 🔴 只在 `hint !== null` 时包装：可用的按钮不该多一层 DOM（表格行里一排动作，
 * 多出来的 span 会把 `Space` 的间距算歪）。
 */
export default function DisabledHint({ hint, children }: DisabledHintProps) {
  if (hint === null) return children;
  return (
    <Tooltip title={hint}>
      <span style={{ display: 'inline-block', cursor: 'not-allowed' }}>{children}</span>
    </Tooltip>
  );
}

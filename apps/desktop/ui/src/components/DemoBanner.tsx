import { Alert } from 'antd';
import { useTranslation } from 'react-i18next';

import { runtime } from '../api/runtime';

/**
 * 演示模式横幅：**只在非 Tauri 运行时**（`mise run web` 打开的浏览器）渲染。
 *
 * 姿态照 `SampleSizeAlert`——一条常驻的 `Alert`，不是 `Modal` / `message` / `notification`：
 * 它要说的是「你现在看到的数据是静态种子」，属于背景事实，**不许遮挡任何操作**。
 * 挂载点见 `AppLayout.tsx`（外层 `Layout` 里、`Header` 之后）：内层 `Layout` 是横向的
 * Sider + Content，挂进去会被压成一根竖条，不是横幅。
 *
 * ⚠ 本文件里**一个 Tailwind 工具类名都不写**（`className` 一律不用）：`components/**` 是
 * Tailwind oxide 的白名单扫描面，一个新的真工具类就会在产物 CSS 里多出一条规则，踩常驻判据
 * 「选择器集合不许新增」。需要排版就用 antd 的组件与 props（内联 `style` 也不进 CSS 产物）。
 *
 * 文案走 `demo.banner` 词典键（zh / en 同一次编辑加同一批），组件里不留任何自然语言字面量
 * （AGENTS 规则 7；`no-hardcoded-strings.test.ts` 的扫描面含 `components/`）。
 */
export default function DemoBanner() {
  const { t } = useTranslation();
  if (runtime !== 'demo') return null;

  return <Alert type="info" showIcon banner message={t('demo.banner')} />;
}

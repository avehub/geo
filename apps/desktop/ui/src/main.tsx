import '@ant-design/v5-patch-for-react-19';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import Root from './Root';
import { initI18n } from './i18n';
import { usePreferences } from './store/preferences';
import './index.css';

const container = document.getElementById('root');
// ⚠ 这条信息**结构上用不了 `t()`**：`initI18n(...)` 在下面才执行，此刻 i18n 还没初始化。
// 裁定 B-4 选「改英文开发者信息」而不是「进词典」（做不到）或「给扫描守卫开白名单」
// （白名单是下一个静默洞）：`#root` 缺失时用户必然看到白屏，这句话只在 console 里给开发者看，
// 与界面语言无关。写成英文也让 Task 15 的「非测试、非 locales 源码只剩注释含中文」判据零例外。
if (!container) throw new Error('missing #root mount node');

// 挂载前把语言定好（裁定 R-C）：`usePreferences` 在模块加载时已从 localStorage 水合，
// 缺省 zh-CN；随后 `Root` 订阅同一个 store，运行期切语言无需重启。
// dayjs 与 antd 的 locale 由 `Root` 按当前语言一并应用（裁定 R-B）。
initI18n(usePreferences.getState().locale);

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

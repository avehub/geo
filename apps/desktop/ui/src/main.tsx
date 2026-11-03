import '@ant-design/v5-patch-for-react-19';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import Root from './Root';
import { initI18n } from './i18n';
import { readStoredPreferences } from './store/preferences';
import { applyColorScheme, resolveDark } from './theme/appearance';
import './index.css';

const container = document.getElementById('root');
// ⚠ 这条信息**结构上用不了 `t()`**：`initI18n(...)` 在下面才执行，此刻 i18n 还没初始化。
// 裁定 B-4 选「改英文开发者信息」而不是「进词典」（做不到）或「给扫描守卫开白名单」
// （白名单是下一个静默洞）：`#root` 缺失时用户必然看到白屏，这句话只在 console 里给开发者看，
// 与界面语言无关。写成英文也让 Task 15 的「非测试、非 locales 源码只剩注释含中文」判据零例外。
if (!container) throw new Error('missing #root mount node');

// 挂载前把语言与配色定好（裁定 R-C / Plan B DR-29）：偏好是**同步**读 localStorage 的
// （无 IO、无 await），缺省 zh-CN + 亮色；随后 `Root` 订阅同一个 store，运行期切换无需重启。
// dayjs 与 antd 的 locale 由 `Root` 按当前语言一并应用（裁定 R-B）。
//
// 🔴 `applyColorScheme` 必须在**挂载前**调：`Root` 渲染体里那一次是"持续跟随"，
// 而首帧之前浏览器已经按默认（亮色）画过滚动条与原生控件了——暗色用户会看到一次闪白。
// `system` 档在这里同步读一次 `matchMedia`（`resolveDark`），不订阅变化（订阅在 `Root` 里）。
const preferences = readStoredPreferences();
initI18n(preferences.locale);
applyColorScheme(resolveDark(preferences.theme));

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

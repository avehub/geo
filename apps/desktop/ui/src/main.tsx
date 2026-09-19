import '@ant-design/v5-patch-for-react-19';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import Root from './Root';
import { initI18n } from './i18n';
import { usePreferences } from './store/preferences';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 挂载点');

// 挂载前把语言定好（裁定 R-C）：`usePreferences` 在模块加载时已从 localStorage 水合，
// 缺省 zh-CN；随后 `Root` 订阅同一个 store，运行期切语言无需重启。
// dayjs 与 antd 的 locale 由 `Root` 按当前语言一并应用（裁定 R-B）。
initI18n(usePreferences.getState().locale);

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

import '@testing-library/jest-dom/vitest';
import '@ant-design/v5-patch-for-react-19';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { DEFAULT_LOCALE, initI18n } from '../i18n';
import { mockInvoke } from './invoke-mock';

// i18n 基座（Task 6 / 裁定 R-A）：全局初始化一次，并在每个用例前把语言拨回 zh-CN。
//
// 存量测试的断言全是中文（spec §7「既有测试固定 zh-CN 运行」）；Task 8/9 把页面与组件的
// 硬编码文案换成 `t(...)` 之后，靠这里保证渲染出来的是中文而不是 key。
// 单个用例里切到英文（`renderWithProviders(ui, { locale: 'en-US' })` 或直接 `initI18n`）
// 也会被下一个用例的 beforeEach 拨回来，用例之间互不串味。
initI18n(DEFAULT_LOCALE);

// antd 的响应式监听在 jsdom 下缺失，补最小实现避免告警噪音。
beforeEach(() => {
  initI18n(DEFAULT_LOCALE);
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(() => {
  cleanup();
  mockInvoke.reset();
});

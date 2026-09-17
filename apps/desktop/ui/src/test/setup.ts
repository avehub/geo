import '@testing-library/jest-dom/vitest';
import '@ant-design/v5-patch-for-react-19';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

import { mockInvoke } from './invoke-mock';

// antd 的响应式监听在 jsdom 下缺失，补最小实现避免告警噪音。
beforeEach(() => {
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

import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, App as AntdApp } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { DEFAULT_LOCALE, initI18n, type Locale } from '../i18n';
import { antdLocale } from '../i18n/antd-locale';

export interface RenderOptions {
  route?: string;
  /**
   * 界面语言，默认 `zh-CN`——存量测试文件因此**零改动**（裁定 R-D）。
   * 传 `'en-US'` 即可渲染英文界面（Task 7 的词典渲染测试、Task 8/9 的"切英文无残留"测试用）。
   */
  locale?: Locale;
}

/** 测试用渲染：每次一个全新 QueryClient（禁用重试，避免等待放大）。 */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', locale = DEFAULT_LOCALE }: RenderOptions = {},
) {
  // i18n 是全局单例：只换 antd 的 `ConfigProvider locale` 不换 i18n，组件里的 `t()` 仍是中文。
  // 在 `render` **之前**切，此时没有已挂载的订阅者，不会触发 React 的 act() 告警。
  // dayjs 的全局 locale 刻意不动：存量组件只用 `YYYY-MM-DD HH:mm` 这类语言无关的数字格式，
  // 而在测试里改 dayjs 全局状态会波及所有用例（真实运行期由 `src/Root.tsx` 负责）。
  initI18n(locale);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={antdLocale(locale)}>
        <AntdApp>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </AntdApp>
      </ConfigProvider>
    </QueryClientProvider>,
  );

  return { ...result, queryClient };
}

/** 带路由参数的页面测试：把 `ui` 挂在 `path` 上并定位到 `route`。 */
export function renderAtRoute(ui: ReactElement, path: string, route: string, locale?: Locale) {
  return renderWithProviders(
    <Routes>
      <Route path={path} element={ui} />
    </Routes>,
    { route, locale },
  );
}

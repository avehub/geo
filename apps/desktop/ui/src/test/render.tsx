import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/** 测试用渲染：每次一个全新 QueryClient（禁用重试，避免等待放大）。 */
export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={zhCN}>
        <AntdApp>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </AntdApp>
      </ConfigProvider>
    </QueryClientProvider>,
  );

  return { ...result, queryClient };
}

/** 带路由参数的页面测试：把 `ui` 挂在 `path` 上并定位到 `route`。 */
export function renderAtRoute(ui: ReactElement, path: string, route: string) {
  return renderWithProviders(
    <Routes>
      <Route path={path} element={ui} />
    </Routes>,
    { route },
  );
}

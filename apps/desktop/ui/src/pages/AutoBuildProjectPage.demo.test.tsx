/**
 * demo 运行时的自动采集屏：演示边界已按 2026-11-19 产品裁定移除，
 * 页面不再重复「演示模式」文案。
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import AutoBuildProjectPage from './AutoBuildProjectPage';
import zhCN from '../i18n/locales/zh-CN';
import { renderWithProviders } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const COPY = zhCN.project.autobuild;

describe('AutoBuildProjectPage · demo', () => {
  it('不重复演示提示；demo 下也不冒充真实抓取说明', () => {
    renderWithProviders(<AutoBuildProjectPage />, { route: '/projects/new/autobuild' });

    expect(screen.queryByText(/演示模式/)).toBeNull();
    expect(screen.queryByText(COPY.urlExtraLive)).toBeNull();
  });
});

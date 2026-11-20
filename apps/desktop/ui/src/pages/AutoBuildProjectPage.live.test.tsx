/**
 * 桌面端（Tauri 运行时）不挂演示提示：真后端会抓官网并抽取字段，
 * 页面不能说“抽取结果是预置数据”。
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import AutoBuildProjectPage from './AutoBuildProjectPage';
import zhCN from '../i18n/locales/zh-CN';
import { renderWithProviders } from '../test/render';

const COPY = zhCN.project.autobuild;

describe('AutoBuildProjectPage · 桌面端', () => {
  it('不挂演示提示，只说明抓取范围与逐字段确认', () => {
    renderWithProviders(<AutoBuildProjectPage />, { route: '/projects/new/autobuild' });

    expect(screen.queryByText(COPY.demoNotice)).toBeNull();
    expect(screen.getByText(COPY.urlExtraLive)).toBeInTheDocument();
    expect(screen.queryByText(COPY.urlExtra)).toBeNull();
  });
});

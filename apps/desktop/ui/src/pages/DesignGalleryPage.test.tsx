import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import DesignGalleryPage from './DesignGalleryPage';
import zhCN from '../i18n/locales/zh-CN';
import enUS from '../i18n/locales/en-US';
import { mockInvoke } from '../test/invoke-mock';
import { renderWithProviders } from '../test/render';

/**
 * 设计样张的两条硬判据（决策 5）：
 * ① **零 IPC**：进页面不产生任何命令（命令面保持 105）；
 * ② **文案全走词典**：en-US 下不出现中文（`design.*` 两侧同批）。
 * 路由是否只在 dev 注册由 `App.tsx` 的 `import.meta.env.DEV` 分支负责，
 * 生产剔除的证据是构建后 grep（见方案 §4），不在 jsdom 里假装验证。
 */
describe('DesignGalleryPage', () => {
  it('渲染样张主体，且一条 IPC 都不发', () => {
    renderWithProviders(<DesignGalleryPage />, { route: '/__design' });
    expect(screen.getByRole('heading', { name: zhCN.design.title })).toBeInTheDocument();
    expect(screen.getByText(zhCN.design.colors.title)).toBeInTheDocument();
    expect(screen.getByText(zhCN.design.status.title)).toBeInTheDocument();
    expect(mockInvoke.allCalls()).toHaveLength(0);
  });

  it('en-US 下不出现中文（词典覆盖的对照组）', () => {
    const { container } = renderWithProviders(<DesignGalleryPage />, {
      route: '/__design',
      locale: 'en-US',
    });
    expect(screen.getByRole('heading', { name: enUS.design.title })).toBeInTheDocument();
    // 品牌名是专有名词（裁定 B-3：en 值就是中文），先按数据减掉再看残留。
    const text = (container.textContent ?? '').replaceAll(enUS.common.appName, '');
    expect(text).not.toMatch(/[\u4e00-\u9fa5]/);
  });
});

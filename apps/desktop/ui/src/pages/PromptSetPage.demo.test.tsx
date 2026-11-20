/**
 * 题库页的演示边界已按 2026-11-19 产品裁定移除：
 * 页面不再单独挂「演示模式未执行合规扫描」。
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import PromptSetPage from './PromptSetPage';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import zhCN from '../i18n/locales/zh-CN';
import { renderAtRoute } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

describe('PromptSetPage · demo 边界提示', () => {
  it('页面不再重复合规/演示提示', async () => {
    renderAtRoute(
      <PromptSetPage />,
      '/projects/:id/prompts',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/prompts`,
    );

    await screen.findByRole('heading', { name: zhCN.prompt.promptSet.title });
    expect(screen.queryByText(/演示模式/)).toBeNull();
    expect(screen.queryByText(zhCN.library.faq.complianceUnchecked)).toBeNull();
  });
});

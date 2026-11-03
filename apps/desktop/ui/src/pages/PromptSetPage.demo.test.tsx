/**
 * 题库页在**演示模式**下必须明说「未执行合规扫描」（P2 审查：手动 CRUD 不跑扫描，
 * 不能假装扫过，也不能让用户以为界面漏了这一步）。
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import PromptSetPage from './PromptSetPage';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import zhCN from '../i18n/locales/zh-CN';
import { renderAtRoute } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

describe('PromptSetPage · 演示模式合规说明', () => {
  it('常驻「演示模式未执行合规扫描」', async () => {
    renderAtRoute(
      <PromptSetPage />,
      '/projects/:id/prompts',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/prompts`,
    );

    expect(
      await screen.findByText(zhCN.library.faq.complianceUnchecked),
    ).toBeInTheDocument();
  });
});

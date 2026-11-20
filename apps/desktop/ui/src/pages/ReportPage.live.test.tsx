/**
 * 报告页 · 桌面端白标默认署名的提示。
 * 桌面端不再说“演示数据里的那一家服务商”。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import ReportPage from './ReportPage';
import { demoInvoke } from '../demo/backend';
import { resetDemoDb } from '../demo/db';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import zhCN from '../i18n/locales/zh-CN';
import { mockInvoke } from '../test/invoke-mock';
import { renderAtRoute } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'tauri' }));

const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/report`;

beforeEach(() => {
  mockInvoke.reset();
  resetDemoDb();
  mockInvoke.stubAlways('collection_board', (args) => demoInvoke('collection_board', args));
});

describe('ReportPage · 桌面端白标提示', () => {
  it('只用中性的默认署名说明', async () => {
    renderAtRoute(<ReportPage />, '/projects/:id/report', ROUTE);
    await screen.findByRole('heading', { name: '报告与分享' });

    fireEvent.click(screen.getByRole('radio', { name: '白标版' }));

    expect(
      screen.getByText(
        `${zhCN.report.whiteLabel.defaultHintLive} ${zhCN.report.whiteLabel.applyHint}`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/演示数据里的那一家服务商/)).toBeNull();
  });
});

/**
 * 概览页趋势卡里的**区块级错误**（P2 审查：`diagnosis_engines` / `diagnosis_funnel`
 * 失败时标签直接消失，用户看不到稳定错误码）。
 *
 * 只覆盖这两个查询：其余数据走真实 demo 后端，避免把整页 stub 成一份假数据。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import OverviewPage from './OverviewPage';
import { IpcRequestError } from '../api/client';
import { resetDemoDb } from '../demo/db';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import { renderAtRoute } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

vi.mock('../api/diagnosis', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    diagnosisEngines: vi.fn(() =>
      Promise.reject(
        new IpcRequestError({
          code: 'ipc/unknown_command',
          params: { cmd: 'diagnosis_engines' },
          message: 'ipc/unknown_command cmd=diagnosis_engines',
        }),
      ),
    ),
    diagnosisFunnel: vi.fn(() =>
      Promise.reject(
        new IpcRequestError({
          code: 'ipc/unknown_command',
          params: { cmd: 'diagnosis_funnel' },
          message: 'ipc/unknown_command cmd=diagnosis_funnel',
        }),
      ),
    ),
  };
});

const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/overview`;
const PATH = '/projects/:id/overview';

beforeEach(() => {
  resetDemoDb();
});

describe('OverviewPage · 引擎差异 / 漏斗错误态', () => {
  it('两个查询失败时在趋势卡内显示稳定错误码，而不是静默隐藏', async () => {
    renderAtRoute(<OverviewPage />, PATH, ROUTE);

    expect(await screen.findByText('GEO 趋势')).toBeInTheDocument();
    expect(await screen.findByText(/不支持的操作：diagnosis_engines/)).toBeInTheDocument();
    expect(await screen.findByText(/不支持的操作：diagnosis_funnel/)).toBeInTheDocument();
  });
});

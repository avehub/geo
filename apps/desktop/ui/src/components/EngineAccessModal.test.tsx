/**
 * 「引擎接入」弹窗的纯登录按钮（2026-11-20）。
 *
 * 只钉两件事：
 * - 点元宝的「立即登录」调用 `collection_engine_login`，**不是**重跑任务；
 * - 浏览器不可用时按稳定错误码渲染，而不是甩一句原始诊断串。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import EngineAccessModal from './EngineAccessModal';
import * as collection from '../api/collection';
import { IpcRequestError } from '../api/client';
import { renderWithProviders } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const STATUS = {
  byProvider: {},
  loading: false,
  error: false,
  currentModelProvider: 'deep_seek',
};

function renderModal() {
  return renderWithProviders(
    <EngineAccessModal open onClose={() => {}} focusEngine="yuanbao" status={STATUS} />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EngineAccessModal · 元宝纯登录', () => {
  it('点「立即登录元宝」只调用登录命令，成功后给出扫码提示', async () => {
    const login = vi
      .spyOn(collection, 'collectionEngineLogin')
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: /立即登录元宝/ }));

    expect(login).toHaveBeenCalledWith('yuanbao');
    expect(
      await screen.findByText(/已打开浏览器窗口，请扫码登录/),
    ).toBeInTheDocument();
  });

  it('浏览器不可用 ⇒ 按 browser/unavailable 的子原因渲染', async () => {
    vi.spyOn(collection, 'collectionEngineLogin').mockRejectedValue(
      new IpcRequestError({
        code: 'browser/unavailable',
        message: 'browser/unavailable reason=browser_disabled',
        params: { reason: 'browser_disabled' },
      }),
    );
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByRole('button', { name: /立即登录元宝/ }));

    expect(
      await screen.findByText('浏览器自动化在当前环境被禁用。'),
    ).toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import DemoModeStrip from './DemoModeStrip';
import zhCN from '../../i18n/locales/zh-CN';
import { renderWithProviders } from '../../test/render';
import type { Runtime } from '../../api/runtime';

/**
 * 细条的判据（决策 4）：
 * ① 32px 固定高（形态变了，合规句不能跟着消失）；
 * ② 只在 demo 运行时出现；
 * ③ 是 `role="note"` 而不是 `role="alert"`——它不打断读屏；
 * ④ 合规句与短标签都来自词典，不是硬编码。
 */
const runtimeBox = vi.hoisted(() => ({ current: 'demo' as Runtime }));

vi.mock('../../api/runtime', () => ({
  get runtime(): Runtime {
    return runtimeBox.current;
  },
  detectRuntime: (): Runtime => runtimeBox.current,
}));

describe('DemoModeStrip', () => {
  afterEach(() => {
    runtimeBox.current = 'demo';
  });

  it('demo 运行时：32px、role=note、合规句与短标签都在', () => {
    runtimeBox.current = 'demo';
    renderWithProviders(<DemoModeStrip />);

    const strip = screen.getByRole('note');
    expect(strip).toHaveStyle({ height: '32px' });
    expect(screen.getByText(zhCN.demo.shortBadge)).toBeInTheDocument();
    expect(screen.getByText(zhCN.demo.banner)).toBeInTheDocument();
    // 防空跑：细条不是一个空壳。
    expect(strip.textContent).toContain(zhCN.demo.banner);
  });

  it('tauri 运行时：细条不出现（对照组同时证明渲染树是真的在跑）', () => {
    runtimeBox.current = 'tauri';
    renderWithProviders(<DemoModeStrip />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.queryByText(zhCN.demo.banner)).not.toBeInTheDocument();
  });
});

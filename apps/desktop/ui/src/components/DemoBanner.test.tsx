/**
 * `src/components/DemoBanner.tsx` 的渲染条件（Task 10 · 简报 §B-3 / §B-6）。
 *
 * 计划正文要的是两条：**demo 下渲染出横幅、tauri 下不渲染**——这里做成两条独立用例，
 * 再加一条「tauri 下中文哨兵串不出现」（AGENTS 规则 7 的运行期形状：横幅文案只能来自词典）。
 *
 * ⚠ 控制 `runtime` 只能 `vi.mock`：它是 `api/runtime.ts` 的**模块级常量**，改 `window` 再渲染
 * 拿到的还是模块首次求值的那一个。两种取值放在同一个文件里，靠 `vi.hoisted` 的可变盒子 +
 * 命名空间 getter 切换（`vi.mock` 是文件作用域的，一个文件只能有一个工厂）。
 * 组件每次渲染都经命名空间读 `runtime`，所以改盒子就够了，不必重挂载模块。
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DemoBanner from './DemoBanner';
import zhCN from '../i18n/locales/zh-CN';
import type { Runtime } from '../api/runtime';

// 工厂会被提升到 import 之前执行，直接引用文件顶层的绑定有踩 TDZ 的风险
// （同 `Root.test.tsx` 那条 async 工厂先例的动机）⇒ 用 `vi.hoisted` 造这个可变盒子。
const runtimeBox = vi.hoisted(() => ({ current: 'demo' as Runtime }));

vi.mock('../api/runtime', () => ({
  get runtime(): Runtime {
    return runtimeBox.current;
  },
  detectRuntime: (): Runtime => runtimeBox.current,
}));

describe('DemoBanner：只在非 Tauri 运行时渲染', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runtimeBox.current = 'demo';
  });

  it('demo 运行时：渲染出词典里的那句横幅（不是裸 key）', () => {
    runtimeBox.current = 'demo';

    render(<DemoBanner />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // 断言的是**词典值本身**，不是硬编码的同形串：改词典两侧一起改，这里不用跟着改。
    expect(screen.getByText(zhCN.demo.banner)).toBeInTheDocument();
    // 防空跑：词典值真的承载了「演示模式」这个语义（值被清空时上面两条会退化成永真）。
    expect(zhCN.demo.banner).toContain('演示模式');
  });

  it('tauri 运行时：不渲染任何东西', () => {
    runtimeBox.current = 'tauri';

    render(<DemoBanner />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(zhCN.demo.banner)).not.toBeInTheDocument();
  });

  it('tauri 运行时：中文哨兵串不出现（文案只能来自词典，组件里不留字面量）', () => {
    runtimeBox.current = 'tauri';

    const { container } = render(<DemoBanner />);

    expect(container.textContent ?? '').toBe('');
    expect(container.innerHTML).not.toContain('演示模式');
  });
});

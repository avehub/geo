/**
 * 外观偏好基座（Plan B Task 1 · spec DR-29 / DR-30 / DR-31）。
 *
 * # 为什么要有这一层
 * `store/preferences.ts` 只管**存**（localStorage + zustand），本模块管**用**：把
 * `ThemeMode` / `FontScale` 两个枚举翻译成 antd 的 `ThemeConfig`，并把「暗色」这件事
 * 同步给**原生控件**（`document.documentElement.style.colorScheme`）。
 *
 * 🔴 DR-30：暗色**只**走 antd 的 `theme.darkAlgorithm`，不新增 CSS class、不改 `src/index.css`
 * （Tailwind 的扫描面与产物选择器集有常驻守卫 `src/tailwind-sources.test.ts`）。所以本文件
 * 里出现的唯一"写 DOM"动作就是 `style.colorScheme`——它管的是滚动条、表单控件这类
 * **浏览器自绘**的部分，antd 的 CSS-in-JS 覆盖不到。
 */
import { theme as antdTheme } from 'antd';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DARK_MEDIA_QUERY,
  FONT_SCALE_PX,
  FONT_SCALES,
  THEME_MODES,
  applyColorScheme,
  isFontScale,
  isThemeMode,
  resolveDark,
  themeConfigFor,
  useResolvedDark,
} from './appearance';

/**
 * 换一个可编程的 `matchMedia`：`system` 那一档必须能观测到**运行期变化**
 * （用户在系统里切暗色，应用不重启也要跟着变），所以桩要能事后改 `matches` 并通知监听者。
 */
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const list = {
    matches: initial,
    media: DARK_MEDIA_QUERY,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: (_type: string, callback: (event: { matches: boolean }) => void) => {
      listeners.add(callback);
    },
    removeEventListener: (_type: string, callback: (event: { matches: boolean }) => void) => {
      listeners.delete(callback);
    },
    dispatchEvent: () => false,
  };
  vi.spyOn(window, 'matchMedia').mockImplementation(() => list as unknown as MediaQueryList);
  return {
    listenerCount: () => listeners.size,
    setMatches(matches: boolean) {
      list.matches = matches;
      for (const listener of listeners) listener({ matches });
    },
  };
}

describe('theme/appearance · 枚举与守卫', () => {
  it('两族枚举的取值与顺序钉死（词典 `settings.themes` / `settings.fontScales` 的键集来源）', () => {
    expect([...THEME_MODES]).toEqual(['light', 'dark', 'system']);
    expect([...FONT_SCALES]).toEqual(['sm', 'md', 'lg']);
  });

  it('isThemeMode / isFontScale 只认契约内的值，其余（含 null / 数字 / 空串）一律否', () => {
    for (const value of ['light', 'dark', 'system']) expect(isThemeMode(value), String(value)).toBe(true);
    for (const value of ['sm', 'md', 'lg']) expect(isFontScale(value), String(value)).toBe(true);
    for (const value of ['neon', '', null, undefined, 14, {}, ['dark']]) {
      expect(isThemeMode(value), JSON.stringify(value)).toBe(false);
      expect(isFontScale(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('三档字号逐一对上 FONT_SCALE_PX（13 / 14 / 16）', () => {
    expect(FONT_SCALE_PX).toEqual({ sm: 13, md: 14, lg: 16 });
    for (const scale of FONT_SCALES) {
      expect(themeConfigFor(false, scale).token?.fontSize).toBe(FONT_SCALE_PX[scale]);
    }
  });
});

describe('theme/appearance · themeConfigFor', () => {
  it('亮色 + 默认字号：defaultAlgorithm、fontSize 14，且保留既有的 borderRadius 6', () => {
    const config = themeConfigFor(false, 'md');
    expect(config.algorithm).toBe(antdTheme.defaultAlgorithm);
    expect(config.token?.fontSize).toBe(14);
    expect(config.token?.borderRadius).toBe(6);
  });

  it('暗色 + 大字号：darkAlgorithm、fontSize 16', () => {
    const config = themeConfigFor(true, 'lg');
    expect(config.algorithm).toBe(antdTheme.darkAlgorithm);
    expect(config.token?.fontSize).toBe(16);
  });

  it('自证（对照组）：两个方向的 algorithm 不是同一个对象，判据不是永真', () => {
    expect(themeConfigFor(false, 'sm').algorithm).not.toBe(themeConfigFor(true, 'sm').algorithm);
    expect(themeConfigFor(false, 'sm').token?.fontSize).not.toBe(themeConfigFor(false, 'lg').token?.fontSize);
  });
});

describe('theme/appearance · colorScheme 与 system 档', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.style.colorScheme = '';
  });

  it('applyColorScheme 写 documentElement.style.colorScheme（不碰 index.css，DR-30）', () => {
    applyColorScheme(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    applyColorScheme(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('resolveDark：light / dark 是常量档，system 同步读 matchMedia', () => {
    const media = stubMatchMedia(false);
    expect(resolveDark('light')).toBe(false);
    expect(resolveDark('dark')).toBe(true);
    expect(resolveDark('system')).toBe(false);
    media.setMatches(true);
    expect(resolveDark('system')).toBe(true);
  });

  it('useResolvedDark：light / dark 忽略系统设置，system 跟随系统并响应变化', () => {
    const media = stubMatchMedia(true);

    const light = renderHook(() => useResolvedDark('light'));
    expect(light.result.current).toBe(false);
    const dark = renderHook(() => useResolvedDark('dark'));
    expect(dark.result.current).toBe(true);

    const system = renderHook(() => useResolvedDark('system'));
    expect(system.result.current).toBe(true);
    act(() => media.setMatches(false));
    expect(system.result.current).toBe(false);
    expect(media.listenerCount()).toBeGreaterThan(0);

    // 卸载要摘掉监听：`system` 之外的档位不该留一个全局监听者。
    system.unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('useResolvedDark：非 system 档不注册监听（少一个不必要的全局订阅）', () => {
    const media = stubMatchMedia(false);
    const hook = renderHook(() => useResolvedDark('dark'));
    expect(hook.result.current).toBe(true);
    expect(media.listenerCount()).toBe(0);
    hook.unmount();
  });
});

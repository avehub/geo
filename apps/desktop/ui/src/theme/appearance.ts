/**
 * 外观（主题 / 字号）的**翻译层**：把偏好枚举翻成 antd 的 `ThemeConfig`，并把暗色同步给
 * 浏览器自绘的那部分（Plan B Task 1 · spec DR-29 / DR-30）。
 *
 * # 与 `store/preferences.ts` 的分工
 * 那边只管**存与取**（localStorage + zustand 单例，首帧前同步读）；这边只管**用**。
 * 分开是为了让"存"保持纯数据（测试可以直接断言 payload），而"用"这一层能自由依赖 antd
 * 与 DOM，不会把 antd 拖进 store。
 *
 * # 🔴 DR-30：暗色不加 CSS class、不改 `src/index.css`
 * Tailwind 的扫描面与产物选择器集有常驻守卫（`src/tailwind-sources.test.ts`），新增选择器要过审；
 * 而 antd 5 的 CSS-in-JS（`theme.darkAlgorithm`）已经覆盖全部 antd 组件。唯一覆盖不到的是
 * **浏览器自绘**的部分（滚动条、原生 `<input type="date">`、表单控件的默认配色），
 * 那部分由 `applyColorScheme` 写 `document.documentElement.style.colorScheme` 解决——
 * 它是内联样式，不新增任何选择器。
 *
 * ⚠ 本文件是 `.ts`（非 `.tsx`）且不含任何 class 名：Tailwind oxide 不扫 `.ts`
 * （`src/index.css` 顶部那条常驻警告）。
 */
import { useSyncExternalStore } from 'react';
import type { ThemeConfig } from 'antd';

import { buildThemeConfig } from './tokens';

/** 主题档：跟随系统是桌面应用的常规默认项，故三档而不是两档（spec §6「外观」）。 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 数组顺序即设置页里的展示顺序，也是词典 `settings.themes.*` 的键集来源。 */
export const THEME_MODES = ['light', 'dark', 'system'] as const satisfies readonly ThemeMode[];

export const DEFAULT_THEME: ThemeMode = 'light';

/** 字号档。`md` = antd 默认 14px，`sm` / `lg` 各让一档（产品定义 §3.10 的"可读性"）。 */
export type FontScale = 'sm' | 'md' | 'lg';

export const FONT_SCALES = ['sm', 'md', 'lg'] as const satisfies readonly FontScale[];

export const DEFAULT_FONT_SCALE: FontScale = 'md';

/** 字号档 → px。集中在这里，界面与测试都不再各写一份数字。 */
export const FONT_SCALE_PX: Record<FontScale, number> = { sm: 13, md: 14, lg: 16 };

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
}

export function isFontScale(value: unknown): value is FontScale {
  return typeof value === 'string' && (FONT_SCALES as readonly string[]).includes(value);
}

/** 系统暗色偏好的媒体查询。抽成常量是为了让测试桩与生产代码引用同一个串。 */
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** 同步读一次系统暗色偏好；`matchMedia` 缺失（老 WebView / 非浏览器环境）时按亮色处理。 */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

/**
 * 非响应式的暗色判定：给**挂载前**那一次防闪读取用（`main.tsx`），那里没有 React 上下文。
 * 运行期的切换一律走 `useResolvedDark`（它额外监听系统偏好变化）。
 */
export function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return systemPrefersDark();
}

/**
 * 偏好 → antd `ThemeConfig`。`Root.tsx` 的 `ConfigProvider theme` 只认这一个出口。
 *
 * 2026-10-30 视觉重做起，具体取值搬进 `theme/tokens.ts`（品牌色 / 语义色 / 组件 token），
 * 这里只负责把字号档翻成 px。`borderRadius: 6` 仍是 Plan A 的既有取值，未漂移。
 */
export function themeConfigFor(dark: boolean, fontScale: FontScale): ThemeConfig {
  return buildThemeConfig(dark, FONT_SCALE_PX[fontScale]);
}

/**
 * 把暗色告诉**浏览器自绘**的那部分（滚动条与原生控件）。
 *
 * 🔴 这是渲染期调用（`Root.tsx` 的渲染体里），与既有的 `applyDayjsLocale(locale)` 同一处、
 * 同一条护栏：`Root` 不得被 `startTransition` / `Suspense` 包住，否则 React 有权丢弃一次渲染，
 * 而这个全局副作用不会跟着回滚。幂等且极廉价，StrictMode 下重复渲染无副作用。
 */
export function applyColorScheme(dark: boolean): void {
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

/** `matchMedia` 的订阅适配（`useSyncExternalStore` 的 subscribe 位）。 */
function subscribeSystemScheme(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const media = window.matchMedia(DARK_MEDIA_QUERY);
  media.addEventListener('change', onStoreChange);
  return () => media.removeEventListener('change', onStoreChange);
}

/** 非 `system` 档用的空订阅：不注册全局监听，也就不需要在卸载时记得摘。 */
function subscribeNothing(): () => void {
  return () => undefined;
}

/**
 * 运行期的暗色判定：`light` / `dark` 是常量档，`system` 跟随系统偏好并**实时**响应变化。
 *
 * 🔴 用 `useSyncExternalStore` 而不是「`useState` + effect 里同步一次」：后者会在 effect 里
 * 直接 `setState`（本仓 eslint 的 `react-hooks/set-state-in-effect` 明文禁止，因为它触发级联渲染），
 * 而且"挂载后才知道系统偏好变了"这件事天然属于**外部 store**——`matchMedia` 正是。
 * 快照函数返回原始布尔 ⇒ 满足 React 对 `getSnapshot` 必须可缓存的要求。
 */
export function useResolvedDark(mode: ThemeMode): boolean {
  const systemDark = useSyncExternalStore(
    mode === 'system' ? subscribeSystemScheme : subscribeNothing,
    systemPrefersDark,
    systemPrefersDark,
  );

  if (mode === 'light') return false;
  if (mode === 'dark') return true;
  return systemDark;
}

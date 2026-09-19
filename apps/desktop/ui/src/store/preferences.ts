/**
 * 用户偏好 store（Plan A Task 6；裁定 R-C / R-F）。
 *
 * 写法对齐同目录的 `wizard-draft.ts`：`create` + 导出 KEY 常量 + **手写** localStorage +
 * try/catch 容忍损坏数据。刻意**不**用 `zustand/middleware` 的 persist——一来与同类 store
 * 不一致，二来 persist 的部分水合时机是异步的，会让 R-A 要求的「切语言同步生效」变难。
 */
import { create } from 'zustand';

import { DEFAULT_LOCALE, initI18n, isLocale, type Locale } from '../i18n';

export const PREFERENCES_KEY = 'geo.preferences';

/** 持久化的偏好。本轮只有语言；Plan B 的设置重构可以继续往这里加字段。 */
export interface PreferencesData {
  locale: Locale;
}

export function defaultPreferences(): PreferencesData {
  return { locale: DEFAULT_LOCALE };
}

/**
 * 从 localStorage 读语言偏好。
 *
 * 与 `wizard-draft.ts` 的 `readStorage()` 同一套口径：JSON 损坏、缺字段、
 * 不认识的语言值一律回退默认，**绝不抛错**——读偏好失败不该挡住应用启动。
 */
export function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return DEFAULT_LOCALE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return DEFAULT_LOCALE;
    }
    const { locale } = parsed as Partial<PreferencesData>;
    return isLocale(locale) ? locale : DEFAULT_LOCALE;
  } catch {
    // 存进去的不是 JSON（或 localStorage 被禁用）：当作没有偏好。
    return DEFAULT_LOCALE;
  }
}

interface PreferencesState {
  locale: Locale;
  /** 切语言：同步切 i18n（R-A）+ 写回 localStorage，界面立刻变、不需要重启（R-C）。 */
  setLocale: (locale: Locale) => void;
}

export const usePreferences = create<PreferencesState>((set) => ({
  locale: readStoredLocale(),

  setLocale: (locale) => {
    set({ locale });
    // 先切 i18n 再落盘：落盘失败（隐私模式/配额满）也不该让界面停在旧语言。
    initI18n(locale);
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale } satisfies PreferencesData));
    } catch {
      // 静默降级：本次会话仍然生效，下次启动回退默认语言。
    }
  },
}));

/** 测试与非 hook 场景使用：按当前 localStorage 重新水合 store 单例（等价于一次刷新）。 */
export function resetPreferencesStore(): void {
  usePreferences.setState({ locale: readStoredLocale() });
}

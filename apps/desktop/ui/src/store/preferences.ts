/**
 * 用户偏好 store（Plan A Task 6；裁定 R-C / R-F）。
 *
 * 写法对齐同目录的 `wizard-draft.ts`：`create` + 导出 KEY 常量 + **手写** localStorage +
 * try/catch 容忍损坏数据。刻意**不**用 `zustand/middleware` 的 persist——一来与同类 store
 * 不一致，二来 persist 的部分水合时机是异步的，会让 R-A 要求的「切语言同步生效」变难。
 */
import { create } from 'zustand';

import { DEFAULT_LOCALE, initI18n, isLocale, type Locale } from '../i18n';
import {
  DEFAULT_FONT_SCALE,
  DEFAULT_THEME,
  isFontScale,
  isThemeMode,
  type FontScale,
  type ThemeMode,
} from '../theme/appearance';

export const PREFERENCES_KEY = 'geo.preferences';

/**
 * 持久化的偏好：界面语言 + 外观（Plan B Task 1 · spec DR-29）。
 *
 * 🔴 外观**不进** `AppSettings`：主题是首帧就要确定的事，等 `settings_get` 往返回来才切会闪一次白；
 * 而 `AppSettings` 是 Rust 契约，为一个纯前端偏好去改它不划算。三个字段同住这一个 key，
 * 于是"挂载前同步读一次"只有一个读取点（spec §12 覆盖 2026-09-18 spec §4.6 的 `geo.appearance`）。
 */
export interface PreferencesData {
  locale: Locale;
  theme: ThemeMode;
  fontScale: FontScale;
}

export function defaultPreferences(): PreferencesData {
  return { locale: DEFAULT_LOCALE, theme: DEFAULT_THEME, fontScale: DEFAULT_FONT_SCALE };
}

/**
 * 从 localStorage 读整包偏好。
 *
 * 与 `wizard-draft.ts` 的 `readStorage()` 同一套口径：JSON 损坏、缺字段、
 * 不认识的值一律回退默认，**绝不抛错**——读偏好失败不该挡住应用启动。
 *
 * 🔴 **逐字段**回落而不是"有一处不认识就整包丢"：Plan A 写下的 payload 只有 `locale` 一个字段，
 * 整包丢会让老用户升级后语言被重置成 zh-CN（用户看得见的回退）。
 */
export function readStoredPreferences(): PreferencesData {
  const fallback = defaultPreferences();
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback;
    const { locale, theme, fontScale } = parsed as Partial<PreferencesData>;
    return {
      locale: isLocale(locale) ? locale : fallback.locale,
      theme: isThemeMode(theme) ? theme : fallback.theme,
      fontScale: isFontScale(fontScale) ? fontScale : fallback.fontScale,
    };
  } catch {
    // 存进去的不是 JSON（或 localStorage 被禁用）：当作没有偏好。
    return fallback;
  }
}

interface PreferencesState extends PreferencesData {
  /** 切语言：同步切 i18n（R-A）+ 写回 localStorage，界面立刻变、不需要重启（R-C）。 */
  setLocale: (locale: Locale) => void;
  /** 切主题：即时生效（spec DR-28：外观与语言这类偏好**不设**保存按钮）。 */
  setTheme: (theme: ThemeMode) => void;
  /** 切字号：即时生效，同上。 */
  setFontScale: (fontScale: FontScale) => void;
}

export const usePreferences = create<PreferencesState>((set, get) => {
  /**
   * 整包落盘（而不是逐字段写）：三个 setter 共用它，于是"切语言把主题冲掉"这类
   * 半包写在结构上就不可能发生。落盘失败静默降级——本次会话仍然生效，下次启动回退默认。
   */
  const persist = (patch: Partial<PreferencesData>) => {
    set(patch);
    try {
      const { locale, theme, fontScale } = get();
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ locale, theme, fontScale } satisfies PreferencesData));
    } catch {
      // 隐私模式 / 配额满：静默降级。
    }
  };

  return {
    ...readStoredPreferences(),

    setLocale: (locale) => {
      // 先切 i18n 再落盘：落盘失败（隐私模式/配额满）也不该让界面停在旧语言。
      initI18n(locale);
      persist({ locale });
    },

    setTheme: (theme) => persist({ theme }),

    setFontScale: (fontScale) => persist({ fontScale }),
  };
});

/** 测试与非 hook 场景使用：按当前 localStorage 重新水合 store 单例（等价于一次刷新）。 */
export function resetPreferencesStore(): void {
  usePreferences.setState(readStoredPreferences());
}

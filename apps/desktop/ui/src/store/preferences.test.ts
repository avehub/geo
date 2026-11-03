/**
 * 语言偏好 store（Plan A Task 6，裁定 R-F / R-C）。
 *
 * 写法对齐同目录的 `wizard-draft.ts`：`create` + 导出 KEY 常量 + 手写 localStorage +
 * try/catch 容忍损坏数据，**不**用 `zustand/middleware` 的 persist（部分水合时机会让
 * R-A 要求的"同步生效"变难，也与同类 store 不一致）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../i18n';
import {
  PREFERENCES_KEY,
  defaultPreferences,
  readStoredPreferences,
  resetPreferencesStore,
  usePreferences,
} from './preferences';

describe('usePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPreferencesStore();
  });

  // M-3（Task 6b-C）：最后那条用例把 `Storage.prototype.setItem` 换成了**抛异常**的实现。
  // vitest 默认 `restoreMocks: false`、`clearMocks: true`，而 `mockClear` 只清调用历史、
  // **不清实现** ⇒ 那个会抛异常的 setItem 会留给同文件后续用例，Task 8/9 往这里加
  // `setLocale` 落盘断言时会莫名失败。用 `afterEach` 而不是用例内 `mockRestore()`：
  // 前者对将来新增的用例同样生效。写法与 `src/i18n/index.test.ts` 保持一致。
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('默认偏好 = zh-CN / light / md，存储 key 固定为 geo.preferences', () => {
    expect(PREFERENCES_KEY).toBe('geo.preferences');
    expect(defaultPreferences()).toEqual({ locale: 'zh-CN', theme: 'light', fontScale: 'md' });
    expect(usePreferences.getState().locale).toBe('zh-CN');
    expect(usePreferences.getState().theme).toBe('light');
    expect(usePreferences.getState().fontScale).toBe('md');
  });

  it('setLocale 写进约定的 localStorage key，刷新后能恢复', () => {
    usePreferences.getState().setLocale('en-US');
    expect(localStorage.getItem(PREFERENCES_KEY)).toContain('"locale":"en-US"');

    // 模拟刷新：store 重新从 localStorage 水合
    resetPreferencesStore();
    expect(usePreferences.getState().locale).toBe('en-US');
  });

  it('R-C：setLocale 同步切 i18n 语言，切语言不需要重启', () => {
    usePreferences.getState().setLocale('en-US');
    expect(i18n.language).toBe('en-US');
    expect(i18n.t('nav.projects')).toBe('Projects');

    usePreferences.getState().setLocale('zh-CN');
    expect(i18n.language).toBe('zh-CN');
    expect(i18n.t('nav.projects')).toBe('项目');
  });

  it('R-F：损坏的偏好被忽略而不是抛错，回退默认值', () => {
    localStorage.setItem(PREFERENCES_KEY, '{不是 JSON');
    expect(readStoredPreferences()).toEqual(defaultPreferences());
    expect(() => resetPreferencesStore()).not.toThrow();
    expect(usePreferences.getState().locale).toBe('zh-CN');
  });

  it('不认识的语言值一律回退 zh-CN', () => {
    for (const raw of ['{"locale":"fr-FR"}', '{"locale":123}', '{}', 'null', '[]', '""']) {
      localStorage.setItem(PREFERENCES_KEY, raw);
      expect(readStoredPreferences().locale, `存 ${raw} 时应回退默认语言`).toBe('zh-CN');
    }
    localStorage.removeItem(PREFERENCES_KEY);
    expect(readStoredPreferences().locale).toBe('zh-CN');
  });

  // -------------------------------------------------------------------------
  // Plan B Task 1：外观偏好（主题 / 字号）与语言**同住一个 key**（spec DR-29）
  //
  // 🔴 为什么合进 `geo.preferences` 而不是新开一个 `geo.appearance`：主题是**首帧**就要
  // 定下来的事（`main.tsx` 挂载前同步读一次），多一个 key 就多一个防闪读取点，
  // 而两处读取很容易只改一处。代价是「只有 locale 的旧 payload」必须被容忍——见下面那条。
  // -------------------------------------------------------------------------

  it('setTheme / setFontScale 落盘到同一个 key，刷新后恢复', () => {
    usePreferences.getState().setTheme('dark');
    usePreferences.getState().setFontScale('lg');

    const raw = localStorage.getItem(PREFERENCES_KEY);
    expect(raw).toContain('"theme":"dark"');
    expect(raw).toContain('"fontScale":"lg"');

    resetPreferencesStore();
    expect(usePreferences.getState().theme).toBe('dark');
    expect(usePreferences.getState().fontScale).toBe('lg');
    // 语言没被外观的写入冲掉（整包写，不是逐字段写）。
    expect(usePreferences.getState().locale).toBe('zh-CN');
  });

  it('🔴 只有 locale 的旧 payload 被容忍：theme / fontScale 回落默认，不抛错', () => {
    localStorage.setItem(PREFERENCES_KEY, '{"locale":"en-US"}');
    expect(readStoredPreferences()).toEqual({ locale: 'en-US', theme: 'light', fontScale: 'md' });
    expect(() => resetPreferencesStore()).not.toThrow();
    expect(usePreferences.getState().locale).toBe('en-US');
    expect(usePreferences.getState().theme).toBe('light');
  });

  it('不认识的外观值逐字段回落默认（一个坏字段不牵连另外两个）', () => {
    localStorage.setItem(
      PREFERENCES_KEY,
      '{"locale":"en-US","theme":"neon","fontScale":"xl"}',
    );
    expect(readStoredPreferences()).toEqual({ locale: 'en-US', theme: 'light', fontScale: 'md' });

    localStorage.setItem(PREFERENCES_KEY, '{"locale":"zh-CN","theme":"dark","fontScale":null}');
    expect(readStoredPreferences()).toEqual({ locale: 'zh-CN', theme: 'dark', fontScale: 'md' });
  });

  it('切语言不会把已存的主题丢掉（setLocale 也走整包落盘）', () => {
    usePreferences.getState().setTheme('system');
    usePreferences.getState().setLocale('en-US');

    const parsed = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}') as Record<string, unknown>;
    expect(parsed).toEqual({ locale: 'en-US', theme: 'system', fontScale: 'md' });
  });

  it('localStorage 不可写时静默降级，内存状态仍然生效', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => usePreferences.getState().setLocale('en-US')).not.toThrow();
    expect(usePreferences.getState().locale).toBe('en-US');
    expect(setItem).toHaveBeenCalled();
  });
});

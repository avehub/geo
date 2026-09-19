/**
 * 语言偏好 store（Plan A Task 6，裁定 R-F / R-C）。
 *
 * 写法对齐同目录的 `wizard-draft.ts`：`create` + 导出 KEY 常量 + 手写 localStorage +
 * try/catch 容忍损坏数据，**不**用 `zustand/middleware` 的 persist（部分水合时机会让
 * R-A 要求的"同步生效"变难，也与同类 store 不一致）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../i18n';
import {
  PREFERENCES_KEY,
  defaultPreferences,
  readStoredLocale,
  resetPreferencesStore,
  usePreferences,
} from './preferences';

describe('usePreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPreferencesStore();
  });

  it('默认语言是 zh-CN，存储 key 固定为 geo.preferences', () => {
    expect(PREFERENCES_KEY).toBe('geo.preferences');
    expect(defaultPreferences()).toEqual({ locale: 'zh-CN' });
    expect(usePreferences.getState().locale).toBe('zh-CN');
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

  it('R-F：损坏的偏好被忽略而不是抛错，回退 zh-CN', () => {
    localStorage.setItem(PREFERENCES_KEY, '{不是 JSON');
    expect(readStoredLocale()).toBe('zh-CN');
    expect(() => resetPreferencesStore()).not.toThrow();
    expect(usePreferences.getState().locale).toBe('zh-CN');
  });

  it('不认识的语言值一律回退 zh-CN', () => {
    for (const raw of ['{"locale":"fr-FR"}', '{"locale":123}', '{}', 'null', '[]', '""']) {
      localStorage.setItem(PREFERENCES_KEY, raw);
      expect(readStoredLocale(), `存 ${raw} 时应回退默认语言`).toBe('zh-CN');
    }
    localStorage.removeItem(PREFERENCES_KEY);
    expect(readStoredLocale()).toBe('zh-CN');
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

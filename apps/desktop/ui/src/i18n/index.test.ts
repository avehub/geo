/**
 * i18n 基座的接缝测试（Plan A Task 6）。
 *
 * 覆盖控制器裁定：R-A（`initI18n` 幂等且对 `t()` 同步生效）、R-B（dayjs 跟随语言）、
 * R-G（双语键集用类型钉死）、R-H（单 namespace + 点分嵌套键）、R-I（配置基线）。
 *
 * 这里只断言**基座行为**，不断言业务文案条数：Task 7 补错误码词典与完整性断言，
 * Task 8/9 往占位 namespace 里填页面与组件文案，都不应该需要改本文件。
 */
import { createElement } from 'react';
import { act, render, screen } from '@testing-library/react';
import antdEnUS from 'antd/locale/en_US';
import antdZhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { antdLocale, applyDayjsLocale } from './antd-locale';
import { DEFAULT_LOCALE, LOCALES, i18n, initI18n, isLocale } from './index';
import enUS from './locales/en-US';
import zhCN from './locales/zh-CN';
import type { ResourceBundle, TranslationKey } from './resources';

/** 把资源树摊平成 `[点分路径, 值]`，用来断言"没有空值/非字符串值"。 */
function leafEntries(node: unknown, prefix = ''): Array<[string, unknown]> {
  if (node !== null && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      leafEntries(value, prefix === '' ? key : `${prefix}.${key}`),
    );
  }
  return [[prefix, node]];
}

/** 计划正文点名的 `common.*` 七个键，Task 8/9 只会往里加，不会删。 */
const REQUIRED_COMMON_KEYS = [
  'save',
  'cancel',
  'delete',
  'confirm',
  'search',
  'loading',
  'unknownError',
] as const;

describe('i18n 基座', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('语言清单固定为 zh-CN / en-US，默认 zh-CN', () => {
    expect(LOCALES).toEqual(['zh-CN', 'en-US']);
    expect(DEFAULT_LOCALE).toBe('zh-CN');
    expect(isLocale('en-US')).toBe(true);
    expect(isLocale('fr-FR')).toBe(false);
    expect(isLocale(123)).toBe(false);
  });

  it('R-A：initI18n 之后 t() 同步生效，不需要 await', () => {
    initI18n('en-US');
    // 不 await：i18next 26 在 resources 内联时走同步 load 分支
    expect(i18n.t('nav.projects')).toBe('Projects');
    expect(i18n.language).toBe('en-US');
  });

  it('R-A：切回 zh-CN 同样同步生效，可来回切', () => {
    initI18n('en-US');
    expect(i18n.t('nav.projects')).toBe('Projects');
    initI18n('zh-CN');
    expect(i18n.t('nav.projects')).toBe('项目');
    initI18n('en-US');
    expect(i18n.t('nav.projects')).toBe('Projects');
  });

  it('R-A：反复 initI18n 不产生任何 console 噪音（告警/报错都算不合格）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    initI18n('en-US');
    initI18n('en-US');
    initI18n('zh-CN');
    initI18n('zh-CN');
    initI18n('zh-CN');

    const noise = [...warn.mock.calls, ...error.mock.calls].map((args) => String(args[0]));
    expect(noise).toEqual([]);
    expect(i18n.t('nav.projects')).toBe('项目');
  });

  it('R-A：重复 initI18n 只走 changeLanguage，不会把 init 再跑一遍', () => {
    // 为什么在意：i18next 的 init() 会重跑整条 load 流水线、重发 initialized 事件、
    // 重新 merge options，还会用当前 options 重置**模块级共享**的 baseLogger
    // （dist/cjs/i18next.js:1829-1831 + :252 + :1775）。这些都是重复初始化的真实代价。
    //
    // 这里刻意**不**用「开 debug 让 i18next 真的打 already-initialized 告警」来做对照组：
    // i18next 的 logger.warn 是 debugOnly 的（:223-233），而 debug 落在共享的 baseLogger 上，
    // 一旦在测试里打开就会泄漏到同文件里其它 i18next 实例，反而制造 R-A 想避免的输出噪音。
    const initSpy = vi.spyOn(i18n, 'init');
    const changeSpy = vi.spyOn(i18n, 'changeLanguage');

    initI18n('en-US'); // setup.ts 的 beforeEach 已把语言拨回 zh-CN → 这次要切
    initI18n('zh-CN'); // → 再切回来
    initI18n('zh-CN'); // 同语言：不该再切一次

    expect(initSpy).not.toHaveBeenCalled();
    expect(changeSpy).toHaveBeenCalledTimes(2);
    expect(changeSpy).toHaveBeenLastCalledWith('zh-CN');
  });

  it('R-I：配置基线 = 回落 zh-CN、只支持两种语言、不做 HTML 转义', () => {
    initI18n('en-US');
    // i18next 的 transformOptions 会把 fallbackLng 字符串规整成数组、并给 supportedLngs
    // 追加内部用的 'cimode'（dist/cjs/i18next.js:1753-1756），所以断言写规整后的形状。
    expect(i18n.options.fallbackLng).toEqual(['zh-CN']);
    // supportedLngs 的类型是 `false | string[]`（false = 不限制），所以先收窄再过滤。
    const configured = i18n.options.supportedLngs;
    const supported = Array.isArray(configured) ? configured.filter((lng) => lng !== 'cimode') : [];
    expect(supported).toEqual(['zh-CN', 'en-US']);
    expect(i18n.options.interpolation?.escapeValue).toBe(false);
  });

  it('R-H：单 namespace + 点分嵌套键，不是 i18next 的多 ns 写法', () => {
    initI18n('zh-CN');
    expect(i18n.t('nav.projects')).toBe('项目');
    // 多 ns 口径会写成 'nav:projects'，这里必须解析不到
    expect(i18n.t('nav:projects')).not.toBe('项目');
    expect(i18n.options.ns).toEqual(['translation']);
    expect(i18n.options.defaultNS).toEqual(['translation']);
  });

  it('计划正文点名的 common.* 七个键两侧都有非空值', () => {
    initI18n('zh-CN');
    for (const key of REQUIRED_COMMON_KEYS) {
      expect(zhCN.common[key], `zh-CN common.${key}`).not.toBe('');
      expect(enUS.common[key], `en-US common.${key}`).not.toBe('');
      expect(i18n.t(`common.${key}`), `t(common.${key})`).not.toBe('');
    }
    expect(i18n.t('common.save')).toBe('保存');
    initI18n('en-US');
    expect(i18n.t('common.save')).toBe('Save');
  });

  it('两侧词典的每个叶子都是非空字符串（没有 undefined / 空串漏填）', () => {
    for (const [locale, bundle] of [
      ['zh-CN', zhCN],
      ['en-US', enUS],
    ] as const) {
      const entries = leafEntries(bundle);
      expect(entries.length, `${locale} 词典不能是空的`).toBeGreaterThan(0);
      for (const [path, value] of entries) {
        expect(typeof value, `${locale} ${path} 必须是字符串`).toBe('string');
        expect((value as string).trim(), `${locale} ${path} 不能是空串`).not.toBe('');
      }
    }
  });

  it('R-B：antdLocale 把内部语言码映射到 antd 的 locale 对象', () => {
    // 对象同一性是最硬的断言：拿到的就是 antd 自己那份 locale。
    expect(antdLocale('en-US')).toBe(antdEnUS);
    expect(antdLocale('zh-CN')).toBe(antdZhCN);
    // 注意实际值：antd 5.29.3 的 en_US.locale 是 'en'（**不是**计划正文写的 'en-us'），
    // zh_CN.locale 才是 'zh-cn'（lib/locale/en_US.js:14 vs lib/locale/zh_CN.js:14）。
    expect(antdLocale('en-US').locale).toBe('en');
    expect(antdLocale('zh-CN').locale).toBe('zh-cn');
  });

  it('R-B：applyDayjsLocale 同步切 dayjs 全局 locale，日期组件才不会半中半英', () => {
    applyDayjsLocale('en-US');
    expect(dayjs.locale()).toBe('en');
    applyDayjsLocale('zh-CN');
    expect(dayjs.locale()).toBe('zh-cn');
  });

  it('react-i18next 取到的是同一个单例，且随语言切换重渲染', async () => {
    function Probe() {
      const { t } = useTranslation();
      return createElement('span', { 'data-testid': 'probe' }, t('nav.projects'));
    }

    initI18n('zh-CN');
    render(createElement(Probe));
    expect(screen.getByTestId('probe')).toHaveTextContent('项目');

    await act(async () => {
      initI18n('en-US');
    });
    expect(screen.getByTestId('probe')).toHaveTextContent('Projects');
  });

  it('R-G：TranslationKey 是深层 key 联合类型，缺 key 编译不过', () => {
    const valid: TranslationKey = 'nav.projects';
    const alsoValid: TranslationKey = 'common.unknownError';
    // @ts-expect-error 'nav.nope' 不在词典里；这行若不再报错说明 TranslationKey 退化成了 string
    const invalid: TranslationKey = 'nav.nope';
    expect(valid).toBe('nav.projects');
    expect(alsoValid).toBe('common.unknownError');
    expect(invalid).toBe('nav.nope');
  });

  it('R-G：en-US 资源被 ResourceBundle 钉住，多一个 zh-CN 没有的键编译不过', () => {
    const bundle: ResourceBundle = enUS;
    expect(bundle.nav.projects).toBe('Projects');
    // @ts-expect-error zh-CN 侧没有 onlyInEn 这个键
    const surplus: ResourceBundle['nav'] = { ...zhCN.nav, onlyInEn: 'nope' };
    expect(surplus.projects).toBe('项目');
  });
});

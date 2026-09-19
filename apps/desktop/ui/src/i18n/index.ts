/**
 * i18n 单例与初始化（Plan A Task 6；裁定 R-A / R-I）。
 *
 * **安全约束（R-I）**：`interpolation.escapeValue` 关掉，是因为 React 在渲染文本节点时
 * 自己就会转义，再转一次会出现 `&amp;amp;` 这类双重转义。代价是词典值被当作**纯文本**处理，
 * 所以任何组件都**不得**把 `t()` 的结果塞进 `dangerouslySetInnerHTML`——那等于把词典
 * （以及 Task 7 里 `params.upstream` 这种上游原文）当 HTML 执行，是现成的 XSS 入口。
 * 需要在文案里嵌样式/链接就用 `<Trans>`，或者拆成多个 key 由组件自己排版。
 */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { resources } from './resources';

/** 界面语言。默认 zh-CN（AGENTS.md 规则 7），本轮做到 en-US（spec DR-7）。 */
export type Locale = 'zh-CN' | 'en-US';

/** 可选语言；数组顺序即设置页里的展示顺序。 */
export const LOCALES: readonly Locale[] = ['zh-CN', 'en-US'];

/** 缺省语言，也是 `fallbackLng`（漏翻时回落到中文而不是露出 key）。 */
export const DEFAULT_LOCALE: Locale = 'zh-CN';

/** 语言守卫：localStorage 里可能躺着旧版本写的、或被人手改过的值。 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** i18next 单例：`useTranslation()` 与命令式 `i18n.t()` 用的是同一个实例。 */
export const i18n = i18next;

let initialized = false;

/**
 * 初始化或切换界面语言：**幂等**，且返回后 `t()` 立刻是新语言（R-A）。
 *
 * - 首次调用走 `init`：资源全部内联打包（不引任何 HTTP loader），i18next 在
 *   `options.resources` 存在时走同步 load 分支，所以不需要 `await`。
 * - 之后的调用只走 `changeLanguage`：重复 `init` 会让 i18next 打
 *   `init: i18next is already initialized` 告警，污染测试输出。
 * - `initAsync: false` 是 i18next 26 里 `initImmediate: false` 的改名版
 *   （26.x 已经没有 `initImmediate`，`InitOptions` 也没有索引签名，传了会 TS 报错）。
 *   资源内联时它并非必需，但显式写上可以保证将来接入懒加载 backend 也不会退化成异步。
 */
export function initI18n(locale: Locale): void {
  if (!initialized) {
    initialized = true;
    void i18n.use(initReactI18next).init({
      lng: locale,
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...LOCALES],
      resources,
      interpolation: { escapeValue: false },
      initAsync: false,
    });
    return;
  }
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
}

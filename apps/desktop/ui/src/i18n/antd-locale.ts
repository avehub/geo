/**
 * 内部语言码 → antd / dayjs 各自的 locale（裁定 R-B）。
 *
 * 三套命名互不相同（`zh-CN` / `zh_CN` / `zh-cn`），集中映射一次，
 * 免得各处写死字面量、切语言时漏掉一半：只换 `ConfigProvider locale` 不换 dayjs，
 * 英文界面里的月份/星期仍然是中文（antd 的日期类组件直接用 dayjs 格式化）。
 */
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
// dayjs 的语言包是副作用导入：注册后 `dayjs.locale('zh-cn')` 才认得这个码。
import 'dayjs/locale/en';
import 'dayjs/locale/zh-cn';

import type { Locale } from './index';

/** antd 的 locale 对象类型（`antd/locale/*` 默认导出的形状，即 antd 内部的 `Locale`）。 */
type AntdLocale = typeof zhCN;

const ANTD_LOCALES: Record<Locale, AntdLocale> = { 'zh-CN': zhCN, 'en-US': enUS };

const DAYJS_LOCALES: Record<Locale, string> = { 'zh-CN': 'zh-cn', 'en-US': 'en' };

/** `ConfigProvider locale` 用：antd 组件内建文案（分页、空态、日期面板、Popconfirm…）跟着界面语言走。 */
export function antdLocale(locale: Locale): AntdLocale {
  return ANTD_LOCALES[locale];
}

/**
 * 切 dayjs 的全局 locale。dayjs 是**单例**、没有 Context，所以只能由根组件在语言变化时调用
 * （见 `src/Root.tsx`）；测试里默认不调，因为存量组件只用 `YYYY-MM-DD HH:mm` 这类
 * 与语言无关的数字格式。
 */
export function applyDayjsLocale(locale: Locale): void {
  dayjs.locale(DAYJS_LOCALES[locale]);
}

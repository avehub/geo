/**
 * 双语资源的组装点与**类型真值源**（Plan A Task 6；裁定 R-G / R-H / R-J）。
 *
 * - **单 namespace + 点分嵌套键（R-H）**：每种语言合成一个对象，走 i18next 默认的
 *   `keySeparator: '.'`，键写成 `nav.projects`、`errors.reasons.too_long`。
 *   `locales/` 下按 namespace 分文件只是**代码组织**，不是 i18next 的 `ns`——
 *   注册多 ns 会把键变成 `nav:projects`，与计划正文和 Task 7 的口径全部对不上。
 * - **键集用类型钉死（R-G）**：`ResourceBundle = typeof zhCN`（zh-CN 是产品主语言）。
 *   en-US 的**每个 namespace 文件**都标注 `ResourceBundle['<ns>']`，缺键/多键在
 *   `tsc -b`（`pnpm run build`）就红。只在组合层写 `const enUS: ResourceBundle = {…}`
 *   是不够的：嵌套值来自变量时不触发 excess property check，en 多出来的键会被放过。
 * - **占位 namespace（R-J）**：用 `EmptyNamespace` 钉成「一个键都不许有」，
 *   这样「只填一侧」在编译期就红，而不是等 Task 7 的运行时断言才发现。
 */
import enUS from './locales/en-US';
import zhCN from './locales/zh-CN';

/**
 * 尚未填充的 namespace 类型。`Record<string, never>` 读作「任何键的值都必须是 never」，
 * 也就是**只允许空对象**；往里塞键会报 `Type 'string' is not assignable to type 'never'`。
 * （注意：`{}` 与 `Record<never, never>` 都做不到这件事——TS 对这两种类型不做 excess
 * property check，实测证据见 task-6-report.md。）
 */
export type EmptyNamespace = Record<string, never>;

/** 键集的真值源：以 zh-CN 的资源树为准。 */
export type ResourceBundle = typeof zhCN;

/**
 * 递归取出资源树里所有**叶子**的点分路径，合成联合类型。
 *
 * 分支路径（如 `'nav'`）不算合法 key——i18next 只能渲染叶子字符串，
 * 让 `'nav'` 编译不过是有意为之。
 */
export type NestedKeys<T, Prefix extends string = ''> = T extends string
  ? Prefix
  : {
      [K in keyof T & string]: NestedKeys<T[K], Prefix extends '' ? K : `${Prefix}.${K}`>;
    }[keyof T & string];

/** 词典里所有可用的点分 key（`t()` 的合法入参集合）。 */
export type TranslationKey = NestedKeys<ResourceBundle>;

/**
 * i18next `init({ resources })` 的形状：`{ [lng]: { [ns]: 资源树 } }`。
 * ns 固定用默认的 `translation`（见上面 R-H）。
 */
export const resources = {
  'zh-CN': { translation: zhCN },
  'en-US': { translation: enUS },
};

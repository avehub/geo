/**
 * 测试专用：antd 弹层里「**只点看得见的那一项**」的定位 helper。
 *
 * # 它解决的竞态（实测形状，不是猜的）
 * antd 的 `Dropdown` 关掉之后弹层**不卸载**：同一个 `div.ant-dropdown` 会挂上
 * `ant-dropdown-hidden` 类 + 内联 `pointer-events: none`（`display` 计算值也变成 `none`），
 * 但菜单项**仍在 DOM 里、仍能被 `getByText` / `findByText` 命中**。
 * 于是两类偶发失败：
 * ① 同一行连开两次菜单时，`findByText` 可能在 React 把弹层从 hidden 翻回可见**之前**就 resolve，
 *    拿到的是关闭态那一份 ⇒ `user.click()` 撞上 `pointer-events: none` 直接抛错；
 * ② 换一行再开时，页面上会有**两份**同名菜单项（一份关闭态、一份可见），
 *    `getByText` 因多重命中抛 `Unable to find`/`Found multiple elements`。
 *
 * # 判据（三条一起看，任何一条不成立都算不可点）
 * - 祖先链上没有 `*-hidden` 类（antd 各弹层族的关闭态命名一致：`ant-dropdown-hidden`、
 *   `ant-select-dropdown-hidden`、`ant-picker-dropdown-hidden`…）；
 * - 祖先链上计算样式没有 `display: none` / `visibility: hidden`；
 * - 祖先链上计算样式没有 `pointer-events: none`（这一条是 user-event 自己抛错的那个前提）。
 *
 * # 第二支：弹层**内**定位（`findClickablePopupItem` / `clickClickablePopupItem`）
 * 上面那套"全文找可点项"有个前提：同名文案在页面上**只可能来自弹层**。素材库与题库那几页
 * 打破了它——筛选 `Select` 的选项与表格里的枚举标签逐字相同（`竞品词` / `AI 生成` / `已通过`），
 * 表格单元格同样是"可点"的（三条判据全过），于是命中数变成 2 / 5 / 10。
 * 这不是弹层没关干净，helper 也不该静默挑一个 ⇒ 判据收窄到**展开着的那一份弹层**内部：
 * 先按 `POPUP_ROOTS` 找出唯一一份可点的弹层根，再在它里面沿用同一套"恰好 1 个可点项"的不变量。
 *
 * 🔴 不许用 `sleep` / `advanceTimersByTime` 绕过：那是把竞态藏起来，不是消掉。
 * ⚠ 断言消息一律 ASCII：本文件在 `i18n/no-hardcoded-strings.test.ts` 的残留扫描面里。
 */
import { screen, waitFor, within } from '@testing-library/react';

/** antd 弹层关闭态的类名形状（`ant-dropdown-hidden` / `ant-select-dropdown-hidden` …）。 */
const HIDDEN_POPUP_CLASS = /(^|\s)[^\s]*-hidden(\s|$)/;

/** 这个节点此刻**能不能被点**：祖先链上任何一层不可见或不吃指针事件，都算不能。 */
export function isClickable(node: Element | null): boolean {
  for (let current = node; current !== null && current.tagName !== 'BODY'; current = current.parentElement) {
    const className = current.getAttribute('class') ?? '';
    if (HIDDEN_POPUP_CLASS.test(className)) return false;
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
      return false;
    }
  }
  return true;
}

/**
 * 等到「文案匹配且**可点**」的项恰好出现一个，再把它交出去。
 *
 * 用 `waitFor` 而不是先 `findByText` 再判可见：后者只等「存在」，而竞态恰恰发生在
 * 「存在但还不可点」那个窗口里。命中数**必须恰好 1**——两份同时可见说明弹层没关干净，
 * 那是被测组件的问题，不该由 helper 静默挑一个。
 */
export async function findClickableMenuItem(text: string | RegExp): Promise<HTMLElement> {
  return waitFor(() => {
    const hits = screen.queryAllByText(text).filter(isClickable);
    if (hits.length === 0) {
      throw new Error(`no clickable menu item matching ${String(text)} yet`);
    }
    if (hits.length > 1) {
      throw new Error(`${hits.length} clickable menu items match ${String(text)} (expected exactly 1)`);
    }
    return hits[0];
  });
}

/**
 * 便捷写法：等可点 → 点它。替代 `user.click(await screen.findByText(...))` 那个竞态形状。
 *
 * 入参用**结构类型**而不是 `ReturnType<typeof userEvent.setup>`：helper 只需要「会点」这一个能力，
 * 结构化后 `userEvent.setup()` 的返回值直接可传，也不用为了取类型去 import 那个包。
 */
export async function clickClickableMenuItem(
  user: { click: (element: Element) => Promise<void> },
  text: string | RegExp,
): Promise<void> {
  await user.click(await findClickableMenuItem(text));
}

/**
 * antd 各弹层族的**根节点**选择器。关闭态那份同样挂在 DOM 里（见文件头 ①），
 * 所以这里只负责"把候选根捞出来"，可见与否一律交给 `isClickable` 判。
 */
const POPUP_ROOTS = [
  '.ant-select-dropdown',
  '.ant-dropdown',
  '.ant-cascader-dropdown',
  '.ant-picker-dropdown',
].join(', ');

/**
 * 当前**展开着**的那一份弹层根节点。不是恰好一份就抛：
 * 0 份 = 还没开（`waitFor` 会重试），>1 份 = 有弹层没关干净（被测组件的问题，不静默挑一个）。
 */
export function openPopup(): HTMLElement {
  const open = [...document.querySelectorAll<HTMLElement>(POPUP_ROOTS)].filter(isClickable);
  if (open.length === 0) throw new Error('no open popup layer yet');
  if (open.length > 1) throw new Error(`${open.length} open popup layers (expected exactly 1)`);
  return open[0];
}

/**
 * 在**展开着的弹层里**等「文案匹配且可点」的项恰好出现一个。
 *
 * 与 `findClickableMenuItem` 的唯一区别是搜索范围：不变量（恰好 1 个）与"用 `waitFor` 而不是
 * 先 `findByText` 再判可见"这两条纪律原样沿用。
 */
export async function findClickablePopupItem(text: string | RegExp): Promise<HTMLElement> {
  return waitFor(() => {
    const hits = within(openPopup())
      .queryAllByText(text)
      .filter(isClickable);
    if (hits.length === 0) {
      throw new Error(`no clickable item matching ${String(text)} in the open popup`);
    }
    if (hits.length > 1) {
      throw new Error(
        `${hits.length} clickable items match ${String(text)} in the open popup (expected exactly 1)`,
      );
    }
    return hits[0];
  });
}

/** 便捷写法：等弹层内可点 → 点它。 */
export async function clickClickablePopupItem(
  user: { click: (element: Element) => Promise<void> },
  text: string | RegExp,
): Promise<void> {
  await user.click(await findClickablePopupItem(text));
}

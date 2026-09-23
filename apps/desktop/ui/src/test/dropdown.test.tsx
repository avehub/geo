/**
 * `src/test/dropdown.ts` 的判据自证（#26：消 `ProjectListPage` 导出菜单用例的 flake）。
 *
 * 🔴 这个 helper 是**判据类**改动，所以必须自证两件事，否则「用了 helper 就绿」是空话：
 * ① 它真的挑得对（关闭态那一份不会被点，可见那一份一定会被点）；
 * ② 它**不是可有可无**——同样的 DOM 下朴素写法（`screen.getByText` / `findByText`）确实会翻车。
 * ②就是本文件的对照组：少了它，①里那些断言全是「以缺席为判据」的永真式。
 *
 * DOM 形状逐字复刻实测结果（探针输出留在 task-15c1-report.md §2 #26）：关闭态弹层是
 * `div.ant-dropdown.ant-dropdown-hidden` + 内联 `pointer-events: none`，菜单项仍挂在里面。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { clickClickableMenuItem, findClickableMenuItem, isClickable } from './dropdown';

const ITEM_TEXT = 'Competitors CSV';

/** 造一份 antd 弹层。`closed` 复刻关闭态（hidden 类 + 内联 pointer-events/display）。 */
function Popup({ state, testId, onClick }: { state: 'open' | 'closed'; testId: string; onClick?: () => void }) {
  const closed = state === 'closed';
  return (
    <div
      data-testid={testId}
      className={closed ? 'ant-dropdown ant-dropdown-hidden' : 'ant-dropdown'}
      style={closed ? { pointerEvents: 'none', display: 'none' } : undefined}
    >
      <ul className="ant-dropdown-menu">
        <li className="ant-dropdown-menu-item" onClick={onClick}>
          <span className="ant-dropdown-menu-title-content">{ITEM_TEXT}</span>
        </li>
      </ul>
    </div>
  );
}

/** 命中项属于哪一份弹层（用 data-testid 认，避免断言里抄 class 名）。 */
function popupOf(node: HTMLElement): string | null {
  return node.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
}

describe('test/dropdown · 可点性判据', () => {
  it('关闭态弹层里的项不可点，可见弹层里的同一项可点', () => {
    render(
      <>
        <Popup state="closed" testId="closed" />
        <Popup state="open" testId="open" />
      </>,
    );

    const [closedItem, openItem] = screen.getAllByText(ITEM_TEXT);
    expect(isClickable(closedItem)).toBe(false);
    expect(isClickable(openItem)).toBe(true);
  });

  it('只有 `*-hidden` 类、没有内联样式时同样判不可点（antd 各弹层族形状一致）', () => {
    render(
      <div data-testid="cls" className="ant-select-dropdown ant-select-dropdown-hidden">
        <span>{ITEM_TEXT}</span>
      </div>,
    );

    expect(isClickable(screen.getByText(ITEM_TEXT))).toBe(false);
  });
});

describe('test/dropdown · findClickableMenuItem', () => {
  it('两份同名项并存时拿到可见那一份（朴素 getByText 在这里直接抛，这就是对照组）', () => {
    render(
      <>
        <Popup state="closed" testId="closed" />
        <Popup state="open" testId="open" />
      </>,
    );

    // 对照组：朴素写法在同一个 DOM 上**必然**失败 ⇒ helper 不是装饰。
    expect(() => screen.getByText(ITEM_TEXT)).toThrow(/Found multiple elements/);

    return expect(findClickableMenuItem(ITEM_TEXT)).resolves.toSatisfy(
      (node: HTMLElement) => popupOf(node) === 'open',
    );
  });

  it('项已在 DOM 但还不可点时会**等**（弹层从关闭翻成可见后才 resolve，不是立刻通过）', async () => {
    const { rerender } = render(<Popup state="closed" testId="closed" />);

    const pending = findClickableMenuItem(ITEM_TEXT);
    rerender(
      <>
        <Popup state="closed" testId="closed" />
        <Popup state="open" testId="open" />
      </>,
    );

    expect(popupOf(await pending)).toBe('open');
  });

  it('全程只有关闭态那一份时超时失败，并且报的是「没有可点项」而不是「找不到文案」', async () => {
    render(<Popup state="closed" testId="closed" />);

    // 文案确实找得到（否则这条会被误读成「定位写错了」）
    expect(screen.queryAllByText(ITEM_TEXT)).toHaveLength(1);
    await expect(findClickableMenuItem(ITEM_TEXT)).rejects.toThrow(/no clickable menu item/);
  });
});

describe('test/dropdown · clickClickableMenuItem', () => {
  it('点击只落在可见那一份上（关闭态那一份的 onClick 一次都不触发）', async () => {
    const onClosed = vi.fn();
    const onOpen = vi.fn();
    render(
      <>
        <Popup state="closed" testId="closed" onClick={onClosed} />
        <Popup state="open" testId="open" onClick={onOpen} />
      </>,
    );
    const user = userEvent.setup();

    await clickClickableMenuItem(user, ITEM_TEXT);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('对照组：朴素 `user.click(getByText(...))` 在同一 DOM 上点不动（多重命中直接抛）', async () => {
    render(
      <>
        <Popup state="closed" testId="closed" />
        <Popup state="open" testId="open" />
      </>,
    );
    const user = userEvent.setup();

    await expect((async () => user.click(screen.getByText(ITEM_TEXT)))()).rejects.toThrow(
      /Found multiple elements/,
    );
  });
});

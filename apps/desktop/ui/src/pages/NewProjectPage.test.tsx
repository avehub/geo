/**
 * 新建项目的模式选择屏（Plan B Task 7 · spec §7 / DR-36）。
 *
 * 三条靶心：
 * ① 两张卡片都在，标题 / 说明 / 「两条路同一张卡」那句全部来自词典（不是裸 key、不是硬编码）；
 * ② 点「用网址建项」去 `/projects/new/auto`，点「打开 5 步向导」去 `/projects/new/wizard`
 *    ——🔴 两个目标**必须不同**，否则"两张卡片其实通向同一屏"这件事就测不出来；
 * ③ 这一屏不发任何 IPC：它只是个岔路口，数据面从下一屏才开始。
 *
 * ⚠ 导航判据靠 `pathname` 探针，不靠"下一页渲染了什么"：本文件只测这个岔路口自己。
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';

import NewProjectPage from './NewProjectPage';
import zhCN from '../i18n/locales/zh-CN';
import { mockInvoke } from '../test/invoke-mock';
import { renderWithProviders } from '../test/render';

const COPY = zhCN.project.new;

function PathProbe() {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function pathname(): string {
  return screen.getByTestId('pathname').textContent ?? '';
}

/** DOM 顺序判据：`a` 在 `b` 之前。 */
function precedes(a: HTMLElement, b: HTMLElement): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function renderPage(route = '/projects/new') {
  return renderWithProviders(
    <>
      <NewProjectPage />
      <Routes>
        <Route path="*" element={<PathProbe />} />
      </Routes>
    </>,
    { route },
  );
}

describe('NewProjectPage · 双入口（spec §7）', () => {
  it('① 两张卡片都在，文案一律来自词典', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: COPY.title })).toBeInTheDocument();
    for (const text of [
      COPY.subtitle,
      COPY.autoTitle,
      COPY.autoDesc,
      COPY.manualTitle,
      COPY.manualDesc,
      COPY.sameFields,
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    // 防空跑：露出裸 key 也算"文案在"，所以显式否掉。
    expect(screen.queryByText('project.new.autoTitle')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.autoAction })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.manualAction })).toBeInTheDocument();
  });

  it('② 两个动作去不同的路由：自动采集屏 / 手动录入向导', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage();

    await user.click(screen.getByRole('button', { name: COPY.autoAction }));
    await waitFor(() => expect(pathname()).toBe('/projects/new/auto'));
    unmount();

    renderPage();
    await user.click(screen.getByRole('button', { name: COPY.manualAction }));
    await waitFor(() => expect(pathname()).toBe('/projects/new/wizard'));
    // 🔴 两个目标不同（防空跑：都写死成同一个路由时，上面两条断言会一起假绿）。
    expect('/projects/new/auto').not.toBe('/projects/new/wizard');
  });

  it('③ 这一屏不发任何 IPC：岔路口不碰数据面', () => {
    renderPage();

    expect(screen.getByText(COPY.subtitle)).toBeInTheDocument();
    expect(mockInvoke.allCalls()).toEqual([]);
  });

  it('④ 提示栏紧跟页头副标题，位于两张卡片之上', () => {
    renderPage();

    const subtitle = screen.getByText(COPY.subtitle);
    const hint = screen.getByText(COPY.sameFields);
    const autoTitle = screen.getByText(COPY.autoTitle);
    const manualTitle = screen.getByText(COPY.manualTitle);

    // 🔴 位置也是契约的一部分：同一条「字段口径一致」提示若掉到卡片下方，
    // 用户会在做完选择之后才读到它，等于没有在决策点上给出信息。
    expect(precedes(subtitle, hint)).toBe(true);
    expect(precedes(hint, autoTitle)).toBe(true);
    expect(precedes(hint, manualTitle)).toBe(true);
  });
});

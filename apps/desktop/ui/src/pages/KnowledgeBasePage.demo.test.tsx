/**
 * 知识库页的演示边界说明已按 2026-11-19 产品裁定移除：
 * 页面、生成弹窗与素材预览都不再重复「演示模式」文案。
 *
 * 保留的口径是运行时中立的产品说明（待人工审核 / 远端媒体不在客户端内加载），
 * 它们不是「这是演示」的提醒。
 */
import { fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDemoDb } from '../demo/db';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import { renderAtRoute } from '../test/render';
import KnowledgeBasePage from './KnowledgeBasePage';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/knowledge`;

function flat(value: string | null): string {
  return (value ?? '').replace(/\s+/g, '');
}

function button(text: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find(
    (node) => flat(node.textContent) === flat(text),
  );
  if (found === undefined) throw new Error(`button not found: ${text}`);
  return found;
}

async function renderPage() {
  renderAtRoute(<KnowledgeBasePage />, '/projects/:id/knowledge', ROUTE);
  await waitFor(() => {
    expect(document.body.querySelectorAll('.ant-statistic')).toHaveLength(6);
  });
}

beforeEach(() => {
  resetDemoDb();
});

describe('KnowledgeBasePage · demo 边界提示', () => {
  it('页头不再挂演示模式说明条', async () => {
    await renderPage();
    expect(document.body.textContent).not.toContain('演示模式');
  });

  it('生成弹窗不再重复演示说明，保留待人工审核口径', async () => {
    await renderPage();
    fireEvent.click(button('AI 生成'));
    await waitFor(() => {
      expect(document.body.textContent).not.toContain('演示模式');
      expect(document.body.textContent).toContain('生成内容默认待人工审核');
    });
  });

  it('素材预览不再重复演示说明，保留运行时中立的媒体说明', async () => {
    await renderPage();
    const group = [...document.body.querySelectorAll('.ant-segmented-item')].find((node) =>
      (node.textContent ?? '').includes('分组'),
    );
    if (group === undefined) throw new Error('grouped view not found');
    fireEvent.click(group);
    await waitFor(() => expect(button('预览素材')).toBeDefined());
    fireEvent.click(button('预览素材'));
    await waitFor(() => {
      expect(document.body.textContent).not.toContain('演示模式');
      expect(document.body.textContent).toContain('当前预览只展示素材地址');
    });
  });
});

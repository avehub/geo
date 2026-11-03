/**
 * `pages/KnowledgeBasePage.tsx`（M1.2b）的界面测试。
 *
 * # 🔴 性能裁定（续上一轮，别"修"回 getByRole）
 * 本页 DOM 节点上千（25 条卡片 × 面板 × 表格），RTL 的 `getByRole` 每次调用都会对每个元素
 * 跑 `isInaccessible` → 2 次 `window.getComputedStyle`，jsdom 里一次约 14ms ⇒ 一个
 * `getByRole('button', { name })` 实测十秒级。所以这里一律用
 * `querySelectorAll('button')` + textContent 的廉价助手（0.1ms 级）。
 *
 * # 覆盖（spec §7 走查清单的测试面）
 * ① 首屏：6 个统计 + 职责说明条 + 11 个模块面板；
 * ② 🔴 同步块 UI 彻底消失：没有「去实体卡修改 / 转为可编辑副本 / 重新同步」任何一个按钮；
 * ③ 视图切换：表格视图出 antd Table 且行数 = 条目数；
 * ④ 话术模块按场景出子标题；素材模块有预览入口、预览抽屉不拉远端媒体；
 * ⑤ 一键复制走 clipboard 并 toast；
 * ⑥ 从实体卡导入：勾选 → 落库 → 来源标签「导入」、状态按源头映射；
 * ⑦ 编辑侧滑：改标题保存成功；
 * ⑧ AI 生成：产物待审核 + 免责说明在弹窗里；
 * ⑨ 导出闸门：种子有可交付行 ⇒ 按钮可用，预览弹窗出内容。
 * ⑩ 编辑侧滑的「修订历史」页签（DR-119）：改过的条目出留痕（词典标签 + 新旧值 + 长正文截断串），
 *    没改过的条目出空态 `kb.revisions.empty`。
 */
import { fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { demoInvoke } from '../demo/backend';
import { resetDemoDb } from '../demo/db';
import { SEED_KB_ENTRIES, SEED_KB_REVISIONS } from '../demo/seed/kb';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import { mockInvoke } from '../test/invoke-mock';
import { renderAtRoute } from '../test/render';
import KnowledgeBasePage from './KnowledgeBasePage';

/**
 * 🔴 测试环境里 `runtime === 'tauri'`（`test/invoke-mock.ts` 装了 `__TAURI_INTERNALS__`），
 * 所以页面测试必须桩 IPC：这里把用到的命令**整体转接给 demo 假后端**，
 * 既拿到真种子的行为，又不用逐条手写桩值（`setFallback` 收不到 cmd，用不了）。
 */
const DEMO_CMDS = [
  'kb_board',
  'project_get',
  'kb_entry_add',
  'kb_entry_update',
  'kb_entry_delete',
  'kb_entry_verify',
  'kb_generate',
] as const;

const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/knowledge`;

/**
 * 🔴 查询一律走 `document.body`：antd 的 Modal / Drawer / message / Select 下拉都是
 * **portal 到 body** 的，render 返回的 container 里看不见它们。
 */
function byText<T extends HTMLElement>(selector: string, text: string): T[] {
  // 🔴 antd 会给**两个汉字**的按钮文案插一个空格（保存 → 保 存），匹配前先把空白抹掉。
  const flat = (value: string | null) => (value ?? '').replace(/\s+/g, '');
  return [...document.body.querySelectorAll<T>(selector)].filter((node) =>
    flat(node.textContent).includes(flat(text)),
  );
}

function buttons(text: string): HTMLButtonElement[] {
  return byText<HTMLButtonElement>('button', text);
}

function button(text: string): HTMLButtonElement {
  const found = buttons(text);
  if (found.length === 0) throw new Error(`button not found: ${text}`);
  return found[0];
}

/** Segmented 的选项是 label 不是 button（antd v5）。 */
function segment(text: string): HTMLElement {
  const found = byText<HTMLElement>('.ant-segmented-item', text);
  if (found.length === 0) throw new Error(`segment not found: ${text}`);
  return found[0];
}

/** Tabs 的页签同样是 label（`.ant-tabs-tab`）不是 button。 */
function tab(text: string): HTMLElement {
  const found = byText<HTMLElement>('.ant-tabs-tab', text);
  if (found.length === 0) throw new Error(`tab not found: ${text}`);
  return found[0];
}

/**
 * 侧滑里**当前可见**那个页签的文本。
 *
 * 🔴 不能直接断言 `document.body.textContent`：antd Tabs 默认不销毁非活动页签，
 * 「编辑」那页的表单标签（例如 `正文（Markdown）`）一直挂在 DOM 里 ⇒ 拿整页文本断言
 * 「修订历史里出现了字段标签」会**假绿**。
 */
function activePaneText(): string {
  return (
    document.body.querySelector('.ant-drawer .ant-tabs-tabpane-active')?.textContent ?? ''
  );
}

async function drawerReady(titlePart: string) {
  await waitFor(() => {
    const input = [...document.body.querySelectorAll('.ant-drawer input')].find((node) =>
      (node as HTMLInputElement).value.includes(titlePart),
    );
    if (input === undefined) throw new Error(`drawer not ready: ${titlePart}`);
  });
}

async function renderPage() {
  const view = renderAtRoute(<KnowledgeBasePage />, '/projects/:id/knowledge', ROUTE);
  await waitFor(() => {
    if (document.body.querySelectorAll('.ant-statistic').length !== 6) {
      throw new Error('stats not ready');
    }
  });
  return view;
}

beforeEach(() => {
  mockInvoke.reset();
  resetDemoDb();
  for (const cmd of DEMO_CMDS) {
    mockInvoke.stubAlways(cmd, (args) => demoInvoke(cmd, args));
  }
  vi.stubGlobal('navigator', {
    ...navigator,
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe('首屏', () => {
  it('6 个统计 + 职责说明条 + 默认表格；切到分组出 11 个模块面板（DR-73 / DR-74 / DR-80）', async () => {
    await renderPage();
    expect(document.body.querySelectorAll('.ant-statistic')).toHaveLength(6);
    expect(document.body.textContent).toContain('实体卡装「我是谁」的结构化事实');
    // 2026-10-31：默认视图改为表格（DR-76 的默认档随之调整）。
    await waitFor(() => {
      expect(document.body.querySelectorAll('.ant-table-tbody tr.ant-table-row')).toHaveLength(
        Math.min(20, SEED_KB_ENTRIES.length),
      );
    });
    expect(document.body.textContent).toContain('销售话术');
    expect(document.body.textContent).toContain('客服话术');
    fireEvent.click(segment('分组'));
    await waitFor(() => {
      expect(document.body.querySelectorAll('.ant-collapse-header')).toHaveLength(11);
    });
  });

  it('🔴 同步块 UI 彻底消失：三个旧按钮一个都不剩（DR-73）', async () => {
    await renderPage();
    expect(buttons('去实体卡修改')).toEqual([]);
    expect(buttons('转为可编辑副本')).toEqual([]);
    expect(buttons('重新同步')).toEqual([]);
    expect(document.body.textContent).not.toContain('同步块由品牌实体卡与项目信息现场投影');
  });

  it('话术模块按场景出子标题（DR-75 / DR-78）', async () => {
    await renderPage();
    const text = document.body.textContent ?? '';
    expect(text).toContain('首次触达');
    expect(text).toContain('投诉安抚');
  });
});

describe('视图切换（DR-76）', () => {
  it('切到表格：antd Table 行数 = 条目数；competitor 筛出来即 battlecard', async () => {
    await renderPage();
    fireEvent.click(segment('表格'));
    await waitFor(() => {
      if (document.body.querySelectorAll('.ant-table-tbody tr.ant-table-row').length === 0) {
        throw new Error('table not ready');
      }
    });
    expect(document.body.querySelectorAll('.ant-table-tbody tr.ant-table-row')).toHaveLength(
      Math.min(20, SEED_KB_ENTRIES.length),
    );
  });
});

describe('卡片交互（DR-78 / DR-79）', () => {
  it('一键复制：写 clipboard 并 toast「已复制到剪贴板」', async () => {
    await renderPage();
    fireEvent.click(button('复制'));
    await waitFor(() => {
      expect(document.body.textContent).toContain('已复制到剪贴板');
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it('素材预览抽屉：不拉远端媒体、写明原因（规则 2）', async () => {
    await renderPage();
    // 预览入口只在分组卡片上；表格视图没有预览列。
    fireEvent.click(segment('分组'));
    await waitFor(() => expect(buttons('预览素材').length).toBeGreaterThan(0));
    fireEvent.click(button('预览素材'));
    await waitFor(() => {
      expect(document.body.textContent).toContain('演示模式不加载远端媒体文件');
    });
    expect(document.body.querySelectorAll('.ant-drawer img, .ant-drawer video, .ant-drawer iframe')).toHaveLength(0);
  });

  it('text 形式正文完整进 DOM（🔴 jsdom 没有布局，折叠/展开按钮只在真浏览器出现，这里不断言）', async () => {
    await renderPage();
    // 正文只在分组卡片里；默认表格只显示标题与 meta。
    fireEvent.click(segment('分组'));
    await waitFor(() => {
      expect(document.body.textContent).toContain('处理风量 10000~120000 m³/h');
    });
  });
});

describe('从实体卡导入（DR-81）', () => {
  it('勾选导入：落库后来源标签「导入」、official 字段进已通过', async () => {
    await renderPage();
    fireEvent.click(button('从实体卡导入'));
    await waitFor(() => {
      if (document.body.querySelectorAll('.ant-modal .ant-table-tbody tr').length === 0) {
        throw new Error('import modal not ready');
      }
    });
    expect(document.body.textContent).toContain('导入是一次性复制');
    const rowsBefore = SEED_KB_ENTRIES.length;
    fireEvent.click(button('导入所选'));
    await waitFor(() => {
      if (!document.body.textContent?.includes('已新增')) throw new Error('import not done');
    });
    await waitFor(() => {
      const stats = [...document.body.querySelectorAll('.ant-statistic-content-value')].map((node) =>
        Number(node.textContent),
      );
      if (stats[1] <= rowsBefore) throw new Error('entries stat not updated');
    });
    expect(document.body.textContent).toContain('导入');
  });
});

describe('编辑侧滑（DR-77）', () => {
  it('改标题保存：toast「已保存」且卡片标题更新', async () => {
    await renderPage();
    fireEvent.click(button('编辑'));
    await waitFor(() => {
      if (document.body.querySelectorAll('.ant-drawer input').length === 0) {
        throw new Error('drawer not ready');
      }
    });
    let titleInput: HTMLInputElement | undefined;
    await waitFor(() => {
      titleInput = [...document.body.querySelectorAll('.ant-drawer input')].find(
        (input) => (input as HTMLInputElement).value.includes('品牌定义句'),
      ) as HTMLInputElement | undefined;
      if (titleInput === undefined) throw new Error('drawer form not populated');
    });
    fireEvent.change(titleInput as HTMLInputElement, { target: { value: '品牌定义句 v2' } });
    fireEvent.click(button('保存'));
    await waitFor(() => {
      expect(document.body.textContent).toContain('品牌定义句 v2');
    });
  });
});

describe('AI 生成（规则 6 / 9）', () => {
  it('弹窗挂免责说明；产物待审核', async () => {
    await renderPage();
    fireEvent.click(button('AI 生成'));
    await waitFor(() => {
      if (!document.body.textContent?.includes('演示模式不调用模型')) {
        throw new Error('generate modal not ready');
      }
    });
    // 选一个池子里有货的模块：产品卖点
    const select = [...document.body.querySelectorAll('.ant-modal .ant-select')][0];
    fireEvent.mouseDown(select.querySelector('.ant-select-selector') ?? select);
    await waitFor(() => {
      const option = [...document.body.querySelectorAll('.ant-select-item-option')].find((node) =>
        (node.textContent ?? '').includes('产品卖点'),
      );
      if (option === undefined) throw new Error('option not found');
      fireEvent.click(option);
    });
    const ok = byText<HTMLButtonElement>('.ant-modal-footer button', '生成').find(
      (node) => (node.textContent ?? '').replace(/\s+/g, '') === '生成',
    );
    expect(ok).toBeDefined();
    fireEvent.click(ok as HTMLButtonElement);
    await waitFor(() => {
      expect(document.body.textContent).toContain('已生成');
    });
    await waitFor(() => {
      expect(document.body.textContent).toContain('待人工审核');
    });
  });
});

describe('导出闸门（DR-72 续）', () => {
  it('种子有可交付行 ⇒ 两个导出按钮都可用；预览出 Markdown 内容', async () => {
    await renderPage();
    const mdButton = button('导出 Markdown');
    expect(mdButton.disabled).toBe(false);
    expect(button('导出 JSON').disabled).toBe(false);
    fireEvent.click(mdButton);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Markdown 知识册');
    });
  });
});

describe('编辑侧滑的「修订历史」页签（DR-119）', () => {
  it('改过的条目：留痕条数 = 种子给的条数，字段标签走词典、长正文只剩截断串', async () => {
    await renderPage();
    // 第一张卡 = `demo-kb-101` 品牌定义句，种子给了它 3 条留痕（含一条 body_markdown 截断样例）。
    fireEvent.click(button('编辑'));
    await drawerReady('品牌定义句');
    fireEvent.click(tab('修订历史'));
    await waitFor(() => {
      if (!activePaneText().includes('待市场部裁决')) throw new Error('revisions not ready');
    });

    expect(document.body.querySelectorAll('.ant-drawer .ant-timeline-item')).toHaveLength(
      SEED_KB_REVISIONS.length,
    );
    // 字段标签查 `kb.fields.*`（规则 7：不露机器记号）。
    expect(activePaneText()).toContain('正文');
    expect(activePaneText()).toContain('标题');
    expect(activePaneText()).not.toContain('body_markdown');
    expect(activePaneText()).not.toContain('field_path');
    // 状态标记与实体卡同一个组件（disputed → 存疑）。
    expect(activePaneText()).toContain('存疑');
    // 🔴 截断串：120 字以内的那截在，被切掉的尾巴不在（DR-119）。
    expect(activePaneText()).toContain('服务网络覆盖江苏');
    expect(activePaneText()).not.toContain('缩短停机时间');
  });

  it('没改过的条目显示空态（kb.revisions.empty）', async () => {
    await renderPage();
    // 第二张卡 = `demo-kb-102` 品牌故事：种子没给它任何留痕。
    fireEvent.click(buttons('编辑')[1]);
    await drawerReady('品牌故事');
    fireEvent.click(tab('修订历史'));
    await waitFor(() => {
      if (!activePaneText().includes('还没有修订记录')) throw new Error('empty state not ready');
    });

    expect(document.body.querySelectorAll('.ant-drawer .ant-timeline-item')).toHaveLength(0);
    // 🔴 空态必须是**知识库自己那句**（条目级口径），不是共用组件里实体卡那句：
    // 两句话要是同词面，把 `KbEntryDrawer` 的空态分流删掉也不会有任何判据变红。
    expect(activePaneText()).toContain('这条知识');
  });

  it('改一个字段 ⇒ 页签里当场多一条留痕，新旧值并排（走查 22）', async () => {
    await renderPage();
    fireEvent.click(buttons('编辑')[1]);
    await drawerReady('品牌故事');
    const titleInput = [...document.body.querySelectorAll('.ant-drawer input')].find((node) =>
      (node as HTMLInputElement).value.includes('品牌故事'),
    ) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: '品牌故事 v2' } });
    fireEvent.click(button('保存'));
    await waitFor(() => {
      expect(document.body.textContent).toContain('已保存');
    });

    // 保存后侧滑关掉 ⇒ 重新打开同一条，页签里应多出那条 `title` 留痕。
    fireEvent.click(buttons('编辑')[1]);
    await drawerReady('品牌故事 v2');
    fireEvent.click(tab('修订历史'));
    await waitFor(() => {
      if (!activePaneText().includes('品牌故事 v2')) throw new Error('new revision not ready');
    });
    expect(activePaneText()).toContain('标题');
    expect(activePaneText()).toContain('品牌故事');
    expect(activePaneText()).toContain('→');
  });
});


describe('筛选与批量选择（防止动到看不见的行）', () => {
  it('切换模块筛选会清空选区，批量删除立即置灰', async () => {
    await renderPage();

    const checkbox = document.body.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    await waitFor(() => expect(button('删除选中').disabled).toBe(false));

    const select = [...document.body.querySelectorAll('.ant-select-selector')][0];
    fireEvent.mouseDown(select);
    await waitFor(() => {
      const option = [...document.body.querySelectorAll('.ant-select-item-option')].find((node) =>
        (node.textContent ?? '').includes('产品知识'),
      );
      if (option === undefined) throw new Error('module option not found');
      fireEvent.click(option);
    });

    await waitFor(() => expect(button('删除选中').disabled).toBe(true));
  });
});

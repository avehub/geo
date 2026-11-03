/**
 * M6.5 站点接入与补丁工作台的页面测试（走**演示假后端 + 真种子**）。
 *
 * # 这里钉的是**界面形态**（handler 侧裁定在 `demo/handlers/site.test.ts` /
 * `site-patch.test.ts`，产物形状在 `api/site-compose.test.ts`）
 * - 四块自上而下都在（档案 / 通道 / 补丁工作台 / 页面清单），且**两句常驻提示必须显示**
 *   ——`demoBody`（不真下发）与 `staticNote`（页面清单与自检是预置值）是规则 6 / 规则 9
 *   在界面上的对价，少一句就等于把演示数据说成了真实探测结果；
 * - 🔴 **发布闸门长在界面上**：`pending_review` 的草案那个「发布」按钮置灰**并给出理由**
 *   （后端 `transition` 是全函数、不存在"非法跃迁"错误码 ⇒ 判据只能在界面上）；
 * - 🔴 撤回 / 回滚同理：没有生效中的线上版本就不给撤回，没有可回快照就不给回滚；
 * - 🔴 `?from=<action_id>` 是行动中心那个入口的落点：自动开生成弹窗并预选该处方，
 *   关掉弹窗时把参数**抹掉**（否则刷新页面又弹一次）；
 * - 导出弹窗里 `patches.json` 只收**已发布**、交接单只收**已审核通过**（DR-53）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SitePage from './SitePage';
import type { SitePatch } from '../api/types';
import { dateTimeText } from '../components/format';
import { getDemoDb, resetDemoDb, sitePatchEventsOf, sitePatchesOf } from '../demo/db';
import { SEED_ACTIONS } from '../demo/seed/actions';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import {
  SEED_SITE_CHANNELS,
  SEED_SITE_DOMAIN,
  SEED_SITE_PATCHES,
  SEED_SITE_PATCH_EVENTS,
  SEED_SITE_PATCH_POOL,
  SEED_SITE_PAGES,
  SEED_SITE_PROFILE,
} from '../demo/seed/site';
import { clickClickablePopupItem } from '../test/dropdown';
import { renderAtRoute } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const PATH = '/projects/:id/site';
const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/site`;

/** 草案 + 待人工审核（`demo-act-004`）：🔴 它的「发布」必须置灰。 */
const PENDING = patchById('demo-site-patch-006');
/** 已撤回 + 已通过：撤回与回滚都该置灰（没有生效中的线上版本、草案与快照逐字相同）。 */
const UNPUBLISHED = patchById('demo-site-patch-002');
/** 已发布 + 已通过：改一下正文就该出现"有未发布的修改"，回滚随之可用。 */
const PUBLISHED = patchById('demo-site-patch-001');
/** `source_layout` 类处方：行动中心那个入口置灰，生成弹窗里也要给出同一句理由。 */
const OFF_SITE_ACTION = SEED_ACTIONS.find((item) => item.category === 'source_layout');
/** 池子里有 2 类候选的处方（术语页）：`?from=` 那条用例拿它当落点。 */
const POOLED_ACTION = SEED_ACTIONS.find(
  (item) => (SEED_SITE_PATCH_POOL[item.id]?.length ?? 0) === 2,
);

function patchById(id: string): SitePatch {
  const patch = SEED_SITE_PATCHES.find((row) => row.id === id);
  expect(patch, `种子里找不到补丁 ${id}`).toBeDefined();
  return patch as SitePatch;
}

function renderPage(route: string = ROUTE) {
  return renderAtRoute(<SitePage />, PATH, route);
}

async function waitLoaded() {
  await screen.findByRole('heading', { name: '站点接入' });
  await screen.findByText(PUBLISHED.title);
}

/**
 * 按标题认卡片（档案 / 页面清单 / 通道 / 工作台四块的容器）。
 *
 * 🔴 用 `closest('.ant-card')` 而不是 `getAllByRole'：通道那四张是 `type="inner"` 的**嵌套**卡，
 * 从标题往上找到的第一个 `.ant-card` 恰好就是它自己那一张（外层「落地通道」的标题在更上面）。
 */
function cardOf(title: string, scope: ParentNode = document): HTMLElement {
  const node = [...scope.querySelectorAll('.ant-card-head-title, .ant-typography, span, div')].find(
    (entry) => entry.textContent === title && entry.querySelector('.ant-card') === null,
  );
  expect(node, `找不到标题为「${title}」的卡片`).toBeDefined();
  const card = (node as HTMLElement).closest('.ant-card');
  expect(card, `「${title}」不在卡片里`).not.toBeNull();
  return card as HTMLElement;
}

/**
 * 台账表里的数据行。两个坑各挡一次（口径与 `FaqLibraryPage.test.tsx` 的同名 helper 逐字相同）：
 * - 只取 `.ant-table-tbody`：表头那行也带复选框（全选），从 `.ant-table` 起数会多出一行；
 * - 再按"带复选框"过滤：展开行同样是 `tr`，但它没有复选框那一列。
 */
function patchRows(scope: ParentNode = document): HTMLElement[] {
  const body = cardOf('补丁工作台', scope).querySelector('.ant-table-tbody');
  expect(body, 'patch table body missing').not.toBeNull();
  return [...within(body as HTMLElement).getAllByRole('row')].filter(
    (row) => row.querySelector('input[type="checkbox"]') !== null,
  );
}

function rowOf(patch: SitePatch): HTMLElement {
  const row = patchRows().find((entry) => entry.textContent?.includes(patch.title));
  expect(row, `台账里找不到「${patch.title}」`).toBeDefined();
  return row as HTMLElement;
}

/**
 * 行内那个动作按钮。
 *
 * 🔴 名字一律用**正则**：antd 的图标会渲染成 `<span role="img" aria-label="send">`，
 * 而可访问名是子节点文本的拼接 ⇒ 实际名字是 `"send 发布"` 而不是 `"发布"`，
 * 拿全等匹配会直接找不到（`SitePatchTable` 只给「编辑」「删除」显式补了 `aria-label`）。
 */
function rowButton(patch: SitePatch, label: string): HTMLElement {
  return within(rowOf(patch)).getByRole('button', { name: new RegExp(label) });
}

/**
 * hover 置灰按钮外层那个 `<span>`（`DisabledHint` 加的）：tooltip 挂在它身上，不在按钮上
 * ——浏览器不给 `disabled` 的表单控件派发鼠标事件，直接 hover 按钮气泡永远出不来。
 */
function hoverDisabled(user: ReturnType<typeof userEvent.setup>, button: HTMLElement) {
  const wrapper = button.parentElement;
  expect(wrapper?.tagName, 'disabled button must be span-wrapped for the tooltip').toBe('SPAN');
  return user.hover(wrapper as HTMLElement);
}

async function openModal() {
  return waitFor(() => {
    const wraps = [...document.querySelectorAll<HTMLElement>('.ant-modal-wrap')].filter(
      (wrap) => wrap.style.display !== 'none',
    );
    expect(wraps.length, 'exactly one open modal expected').toBe(1);
    const node = wraps[0].querySelector('.ant-modal');
    expect(node, '弹窗没出现').not.toBeNull();
    return node as HTMLElement;
  });
}

async function confirmDanger(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  const dialog = await waitFor(() => {
    const node = document.querySelector('.ant-modal-confirm');
    expect(node, '确认弹窗没出现').not.toBeNull();
    return node as HTMLElement;
  });
  await user.click(within(dialog).getByRole('button', { name }));
}

function dbPatches(): SitePatch[] {
  return sitePatchesOf(getDemoDb(), SEED_ACTIVE_PROJECT_ID);
}

/** 这条补丁在假后端里的事件（`created_at` 正序）。 */
function dbEvents(patchId: string) {
  return sitePatchEventsOf(getDemoDb(), patchId);
}

/** 导出弹窗里那份预览：`Input.TextArea` 的**值**（不是文本节点，`getByText` 找不到）。 */
function previewOf(dialog: HTMLElement): string {
  const area = dialog.querySelector('textarea[readonly]');
  expect(area, 'export preview textarea missing').not.toBeNull();
  return (area as HTMLTextAreaElement).value;
}

/** 四条通道的中文名（与 `site.channelKinds` 逐字一致，用来在内层卡里认它们）。 */
const KIND_LABEL: Record<string, string> = {
  bundle: '落地包与交接单',
  cms: 'CMS 连接器（WordPress）',
  edge: '边缘函数（CDN）',
  repo: '代码仓库 / 编码代理',
};

/** 历史表格里那一列的事件名（与 `site.eventKinds` 逐字一致）。 */
const EVENT_LABEL: Record<string, string> = {
  created: '新建',
  saved: '保存草案',
  published: '发布',
  unpublished: '撤回',
  rolled_back: '回滚草案',
  exported: '导出留档',
};

beforeEach(() => {
  resetDemoDb();
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = vi.fn(() => 'blob:demo');
  }
});

describe('pages/SitePage · 四块都渲染出来（DR-54）', () => {
  it('标题、副标题，以及两句**常驻**提示都在（规则 6 / 规则 9 的界面侧对价）', async () => {
    renderPage();
    await waitLoaded();

    expect(screen.getByText('把行动中心的站点处方落成可下发、可撤回、可回滚的补丁台账')).toBeDefined();
    // 🔴 这两句是硬性要求：少一句就是把演示数据说成了真实结果。
    expect(
      screen.getByText(/演示模式不会改动线上站点：发布 \/ 撤回 \/ 回滚只在本地记账/),
    ).toBeDefined();
    expect(screen.getByText(/页面清单与通道自检结论都是预置静态值/)).toBeDefined();
  });

  it('站点档案：域名是项目官网的镜像，形态与"谁在管"按种子端出来', async () => {
    renderPage();
    await waitLoaded();

    const card = cardOf('站点档案');
    expect(within(card).getByText(SEED_SITE_DOMAIN)).toBeDefined();
    expect(within(card).getByText('自建或定制 CMS')).toBeDefined();
    expect(within(card).getByText('外包代管（客户只有部分权限）')).toBeDefined();
    // 🔴 备注是 `TextArea` 的**值**，不是文本节点：只能读 `.value`（`getByText` 找不到）
    const note = within(card).getByRole('textbox', { name: '权限与备注' });
    expect((note as HTMLTextAreaElement).value).toBe(SEED_SITE_PROFILE.note);
    // 档案已建 ⇒ 不该出现"还没有站点档案"那句空态
    expect(screen.queryByText(/这个项目还没有站点档案/)).toBeNull();
  });

  it('受管页面清单：种子里那几个页面逐个上屏，可抓与否用词典文案', async () => {
    renderPage();
    await waitLoaded();

    const card = cardOf('受管页面清单');
    expect(SEED_SITE_PAGES.length).toBeGreaterThan(0);
    for (const page of SEED_SITE_PAGES) {
      expect(within(card).getByText(page.url), `页面清单里缺 ${page.url}`).toBeDefined();
    }
    // `crawlable` 的三态都要能看见（种子里既有可抓也有被挡住的）
    const crawlable = SEED_SITE_PAGES.filter((page) => page.crawlable).length;
    expect(within(card).getAllByText('可抓')).toHaveLength(crawlable);
    expect(within(card).getAllByText('被挡住')).toHaveLength(SEED_SITE_PAGES.length - crawlable);
  });

  it('落地通道：四张卡，零凭据那条说"不需要凭据"，其余说"演示模式不收密码"', async () => {
    renderPage();
    await waitLoaded();

    const card = cardOf('落地通道');
    expect(SEED_SITE_CHANNELS).toHaveLength(4);
    for (const channel of SEED_SITE_CHANNELS) {
      expect(within(card).getByText(KIND_LABEL[channel.kind])).toBeDefined();
    }
    // 零凭据那条明说"不需要凭据"
    expect(within(cardOf('落地包与交接单')).getByText('不需要凭据')).toBeDefined();
    // 🔴 规则 3 的界面侧对价：要凭据的那几条一律挂这句，且**不给**密码输入框
    const cms = cardOf('CMS 连接器（WordPress）');
    expect(within(cms).getByText(/演示模式不收任何密码与令牌/)).toBeDefined();
    expect(within(cms).queryByText(/凭据已入钥匙串/)).toBeNull();
    expect(within(cardOf('边缘函数（CDN）')).getByText(/演示模式不收任何密码与令牌/)).toBeDefined();
  });

  it('补丁工作台：种子里那几条台账全上屏，计数条对上', async () => {
    renderPage();
    await waitLoaded();

    expect(patchRows()).toHaveLength(SEED_SITE_PATCHES.length);
    expect(screen.getByText(`显示 ${SEED_SITE_PATCHES.length} / ${SEED_SITE_PATCHES.length} 条`)).toBeDefined();
    for (const patch of SEED_SITE_PATCHES) {
      expect(within(rowOf(patch)).getByText(patch.target_url)).toBeDefined();
    }
  });
});

describe('pages/SitePage · 筛选（展示层，不进后端契约）', () => {
  it('按状态筛：只剩草案那一条，计数条跟着变', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const drafts = SEED_SITE_PATCHES.filter((row) => row.status === 'draft');
    await user.click(screen.getByRole('combobox', { name: '状态' }));
    await clickClickablePopupItem(user, '草案');

    await waitFor(() => expect(patchRows()).toHaveLength(drafts.length));
    expect(screen.getByText(`显示 ${drafts.length} / ${SEED_SITE_PATCHES.length} 条`)).toBeDefined();
    for (const draft of drafts) expect(rowOf(draft)).toBeDefined();
  });

  it('切换状态筛选会清空选区，批量删除立即置灰（不动看不见的行）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    // 已发布的行不参与批量选择（删除会绕过撤回状态机）⇒ 拿已撤回的那条当落点。
    const checkbox = rowOf(UNPUBLISHED).querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(await screen.findByText('删除选中 1 条')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: '状态' }));
    await clickClickablePopupItem(user, '草案');

    await waitFor(() => {
      const button = screen.getByText('删除选中').closest('button');
      expect(button).toBeDisabled();
    });
  });

  it('按落点子串搜：命中的都是那个网址，没命中的一条不剩', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const needle = '/qualification';
    const hits = SEED_SITE_PATCHES.filter((row) => row.target_url.includes(needle));
    expect(hits.length).toBeGreaterThan(0);

    await user.type(screen.getByRole('searchbox', { name: '搜索落点或标题' }), needle);

    await waitFor(() => expect(patchRows()).toHaveLength(hits.length));
    for (const row of patchRows()) expect(row.textContent).toContain(needle);
  });

  it('按通道筛：落地包那一档只留下走它的补丁', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const bundled = SEED_SITE_PATCHES.filter((row) => row.channel_kind === 'bundle');
    await user.click(screen.getByRole('combobox', { name: '通道' }));
    await clickClickablePopupItem(user, '落地包与交接单');

    await waitFor(() => expect(patchRows()).toHaveLength(bundled.length));
    expect(screen.getByText(`显示 ${bundled.length} / ${SEED_SITE_PATCHES.length} 条`)).toBeDefined();
  });
});

describe('pages/SitePage · 三个动作的置灰理由都长在界面上（DR-47）', () => {
  it('待人工审核的草案：「发布」置灰，hover 出"先人工审核通过，再发布"', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const publish = rowButton(PENDING, '发布');
    expect(publish).toBeDisabled();
    await hoverDisabled(user, publish);
    expect(await screen.findByText('先人工审核通过，再发布：AI 生成的草案默认待审。')).toBeDefined();
  });

  it('已撤回的那条：「撤回」与「回滚草案」都置灰，各说各的理由', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const unpublish = rowButton(UNPUBLISHED, '撤回');
    expect(unpublish).toBeDisabled();
    await hoverDisabled(user, unpublish);
    expect(
      await screen.findByText('这一条现在没有生效中的线上版本：只有已发布的补丁需要撤回。'),
    ).toBeDefined();

    const rollback = rowButton(UNPUBLISHED, '回滚草案');
    expect(rollback).toBeDisabled();
    await hoverDisabled(user, rollback);
    expect(
      await screen.findByText(/没有可回滚的落点：这条补丁还没发布过，或草案与线上版本逐字相同。/),
    ).toBeDefined();
  });

  it('刚发布、草案与快照逐字相同的那条：「回滚草案」同样置灰', async () => {
    renderPage();
    await waitLoaded();

    expect(PUBLISHED.published_body).toBe(PUBLISHED.body);
    expect(rowButton(PUBLISHED, '回滚草案')).toBeDisabled();
    expect(rowButton(PUBLISHED, '撤回')).toBeEnabled();
  });
});

describe('pages/SitePage · 审核 → 发布 → 撤回 → 回滚（一条补丁的完整生命周期）', () => {
  it('把审核态翻成"已通过"，「发布」随即解禁；点它 ⇒ 状态变已发布、事件多一条', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const eventsBefore = SEED_SITE_PATCH_EVENTS.filter((row) => row.patch_id === PENDING.id).length;
    expect(eventsBefore).toBeGreaterThan(0);
    await user.click(within(rowOf(PENDING)).getByRole('combobox', { name: '审核态' }));
    await clickClickablePopupItem(user, '已通过');

    const publish = await waitFor(() => {
      const button = rowButton(PENDING, '发布');
      expect(button).toBeEnabled();
      return button;
    });
    await user.click(publish);

    expect(await screen.findByText(/已记为发布：线上生效要靠所选通道真的执行一次。/)).toBeDefined();
    await waitFor(() => {
      const stored = dbPatches().find((row) => row.id === PENDING.id);
      expect(stored?.status).toBe('published');
      expect(stored?.published_body).toBe(stored?.body);
    });
    // 🔴 **两条**新事件，不是一条：翻审核态走的是 `site_patch_save`，它自己也留痕（`saved`）。
    const events = dbEvents(PENDING.id);
    expect(events).toHaveLength(eventsBefore + 2);
    expect(events.slice(-2).map((row) => row.kind)).toEqual(['saved', 'published']);
    expect(within(rowOf(PENDING)).getByText('已发布')).toBeDefined();
  });

  it('改一条已发布补丁的正文 ⇒ 行上出现"有未发布的修改"，「回滚草案」解禁', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    expect(within(rowOf(PUBLISHED)).queryByText('有未发布的修改')).toBeNull();
    expect(within(rowOf(PUBLISHED)).getByText('与线上一致')).toBeDefined();

    await user.click(rowButton(PUBLISHED, '编辑'));
    const dialog = await openModal();
    const body = within(dialog).getByRole('textbox', { name: '补丁正文（代码或文案）' });
    await user.type(body, 'EDITED');
    await user.click(within(dialog).getByRole('button', { name: /^保\s*存$/ }));

    expect(await screen.findByText('补丁已保存')).toBeDefined();
    await waitFor(() => {
      expect(within(rowOf(PUBLISHED)).getByText('有未发布的修改')).toBeDefined();
      expect(rowButton(PUBLISHED, '回滚草案')).toBeEnabled();
    });
  });

  it('回滚 ⇒ 草案恢复成上次发布的快照（状态仍是已发布：线上那一版没动过），事件多一条', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(rowButton(PUBLISHED, '编辑'));
    const dialog = await openModal();
    await user.type(within(dialog).getByRole('textbox', { name: '补丁正文（代码或文案）' }), 'EDITED');
    await user.click(within(dialog).getByRole('button', { name: /^保\s*存$/ }));
    await screen.findByText('补丁已保存');
    const edited = await waitFor(() => {
      const button = rowButton(PUBLISHED, '回滚草案');
      expect(button).toBeEnabled();
      return button;
    });

    await user.click(edited);
    expect(await screen.findByText('草案已回滚到上一次发布的版本')).toBeDefined();

    await waitFor(() => {
      const stored = dbPatches().find((row) => row.id === PUBLISHED.id);
      expect(stored?.body).toBe(PUBLISHED.published_body);
      // 🔴 status 仍是 published：rollback 只把**草案**拉回快照，线上那一版从头到尾没变过
      expect(stored?.status).toBe('published');
    });
    const events = dbEvents(PUBLISHED.id);
    expect(events.at(-1)?.kind).toBe('rolled_back');
    // 草案与快照又逐字相同了 ⇒ 标记与回滚按钮都该收回去
    await waitFor(() => {
      expect(within(rowOf(PUBLISHED)).queryByText('有未发布的修改')).toBeNull();
      expect(rowButton(PUBLISHED, '回滚草案')).toBeDisabled();
    });
  });

  it('🔴 已发布的补丁删除按钮置灰并给理由，选中框也置灰（先撤回再删）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const button = rowButton(PUBLISHED, '删除');
    expect(button).toBeDisabled();
    expect(within(rowOf(PUBLISHED)).getByRole('checkbox')).toBeDisabled();
    await hoverDisabled(user, button);
    expect(
      await screen.findByText('已发布的补丁不能直接删除：先撤回，再删除，避免审计链断掉。'),
    ).toBeDefined();

    // 草案仍然可删：置灰不是因为"这一列整体禁用了"
    expect(rowButton(PENDING, '删除')).toBeEnabled();
  });

  it('删除一条补丁 ⇒ 台账少一行、它的事件一起清掉', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(rowButton(PENDING, '删除'));
    await confirmDanger(user, /删\s*除/);

    expect(await screen.findByText(/已删除 1 条补丁/)).toBeDefined();
    await waitFor(() => expect(patchRows()).toHaveLength(SEED_SITE_PATCHES.length - 1));
    expect(dbPatches().some((row) => row.id === PENDING.id)).toBe(false);
    expect(dbEvents(PENDING.id)).toHaveLength(0);
  });
});

describe('pages/SitePage · 历史（`site_patch_history`）', () => {
  it('事件按时间**正序**，每条都能看出是哪个动作在什么时候做的', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(rowButton(PUBLISHED, '历史'));
    const dialog = await openModal();

    const expected = SEED_SITE_PATCH_EVENTS.filter((row) => row.patch_id === PUBLISHED.id)
      .slice()
      .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
    expect(expected.length).toBeGreaterThan(1);

    const times = within(dialog.querySelector('.ant-table-tbody') as HTMLElement)
      .getAllByRole('row')
      .map((row) => row.textContent ?? '');
    expect(times).toHaveLength(expected.length);
    times.forEach((text, index) => {
      expect(text, `第 ${index} 行`).toContain(dateTimeText(expected[index].created_at));
      expect(text).toContain(EVENT_LABEL[expected[index].kind]);
    });
  });
});

describe('pages/SitePage · 从处方生成（DR-50 / DR-56④）', () => {
  it('工具条上「从处方生成」⇒ 弹窗里只列**池子里有**的候选，勾一条生成出台账新行', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const action = POOLED_ACTION;
    expect(action, '种子里该有一条池子含 2 类候选的处方').toBeDefined();
    const candidates = SEED_SITE_PATCH_POOL[action!.id];

    await user.click(screen.getByRole('button', { name: /从处方生成/ }));
    const dialog = await openModal();
    expect(within(dialog).getByText('演示模式不调模型：下面这些候选来自预置模板，生成后一律是「草案 + 待人工审核」。')).toBeDefined();

    await user.click(within(dialog).getByRole('combobox'));
    await clickClickablePopupItem(user, action!.title);
    for (const candidate of candidates) {
      expect(within(dialog).getByText(candidate.title)).toBeDefined();
    }

    await user.click(within(dialog).getByText(candidates[0].title));
    await user.click(within(dialog).getByRole('button', { name: /^生\s*成$/ }));

    expect(await screen.findByText('已生成 1 条补丁草案')).toBeDefined();
    await waitFor(() => expect(patchRows()).toHaveLength(SEED_SITE_PATCHES.length + 1));
    const created = dbPatches().find((row) => row.title === candidates[0].title);
    // 🔴 生成出来一律是「草案 + 待人工审核」（规则 6）
    expect(created?.status).toBe('draft');
    expect(created?.review_status).toBe('pending_review');
    expect(created?.source).toBe('generated');
    expect(created?.action_id).toBe(action!.id);
  });

  it('`?from=<action_id>` 进来 ⇒ 弹窗自动开着并已预选那条处方；关掉后参数被抹掉', async () => {
    const user = userEvent.setup();
    const action = POOLED_ACTION!;
    renderPage(`${ROUTE}?from=${action.id}`);

    const dialog = await openModal();
    expect(within(dialog).getByText('从处方生成补丁草案')).toBeDefined();
    // 预选生效 ⇒ 候选直接列出来了，不用先开下拉
    for (const candidate of SEED_SITE_PATCH_POOL[action.id]) {
      expect(within(dialog).getByText(candidate.title)).toBeDefined();
    }

    await user.click(within(dialog).getByRole('button', { name: /^取\s*消$/ }));
    await waitFor(() => expect(document.querySelector('.ant-modal-wrap')).toBeNull());
    // 🔴 留着 `?from=` 的话刷新页面又会弹一次
    expect(window.location.search).toBe('');
  });

  it('`source_layout` 类处方在弹窗里也给出理由，「生成」按钮点不动（DR-46）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const action = OFF_SITE_ACTION;
    expect(action, '种子里该有一条 source_layout 处方').toBeDefined();

    await user.click(screen.getByRole('button', { name: /从处方生成/ }));
    const dialog = await openModal();
    await user.click(within(dialog).getByRole('combobox'));
    await clickClickablePopupItem(user, action!.title);

    expect(
      within(dialog).getByText('这条处方的落点在站外平台（百科词条、行业媒体、B2B 平台），不在站点通道范围内。'),
    ).toBeDefined();
    expect(within(dialog).getByRole('button', { name: /^生\s*成$/ })).toBeDisabled();
  });

  it('池子里没有的处方 ⇒ 提示"没有可用的补丁模板"，不是回一个空列表', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    const action = SEED_ACTIONS.find(
      (item) =>
        item.category !== 'source_layout' && (SEED_SITE_PATCH_POOL[item.id]?.length ?? 0) === 0,
    );
    expect(action, '种子里该有一条不在池子里的站内处方').toBeDefined();

    await user.click(screen.getByRole('button', { name: /从处方生成/ }));
    const dialog = await openModal();
    await user.click(within(dialog).getByRole('combobox'));
    await clickClickablePopupItem(user, action!.title);

    expect(
      within(dialog).getByText('这条处方没有可用的补丁模板，可以关掉弹窗手动新建一条。'),
    ).toBeDefined();
    expect(within(dialog).getByRole('button', { name: /^生\s*成$/ })).toBeDisabled();
  });
});

describe('pages/SitePage · 导出落地文件（DR-53）', () => {
  it('交接单预览在弹窗里就能读到，且只收已审核通过的补丁', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('button', { name: /导出/ }));
    const dialog = await openModal();
    expect(within(dialog).getByText(/本交接单由稿得快 GEO 客户端生成/)).toBeDefined();

    const approved = SEED_SITE_PATCHES.filter((row) => row.review_status === 'approved');
    expect(approved.length).toBeGreaterThan(0);
    expect(approved.length).toBeLessThan(SEED_SITE_PATCHES.length);
    const preview = previewOf(dialog);
    expect(preview).toContain('站点整改交接单');
    for (const patch of approved) expect(preview).toContain(patch.title);
    for (const patch of SEED_SITE_PATCHES.filter((row) => row.review_status !== 'approved')) {
      expect(preview, `待审的「${patch.title}」不该进交接单`).not.toContain(patch.title);
    }
  });

  it('筛选状态下导出 patches.json 仍包含全部已发布补丁（不能把筛选子集当线上数据）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    // 先筛到「草案」：可见集合里一条 published 都没有。
    await user.click(screen.getByRole('combobox', { name: '状态' }));
    await clickClickablePopupItem(user, '草案');
    await waitFor(() => expect(patchRows().every((row) => row.textContent?.includes('草案'))).toBe(true));

    await user.click(screen.getByRole('button', { name: /导出/ }));
    const dialog = await openModal();
    await user.click(within(dialog).getByRole('combobox', { name: '导出什么' }));
    await clickClickablePopupItem(user, 'patches.json（边缘函数用）');

    const published = SEED_SITE_PATCHES.filter((row) => row.status === 'published');
    const payload = JSON.parse(previewOf(dialog)) as { patches: { id: string }[] };
    expect(payload.patches.map((row) => row.id).sort()).toEqual(
      published.map((row) => row.id).sort(),
    );
  });

  it('🔴 台账 CSV 是补丁 × 事件扁平表，且忽略当前筛选（导出全量）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    // 先筛到「草案」：可见集合里一条 published 都没有，但留档必须仍然包含它们。
    await user.click(screen.getByRole('combobox', { name: '状态' }));
    await clickClickablePopupItem(user, '草案');
    await waitFor(() => expect(patchRows().every((row) => row.textContent?.includes('草案'))).toBe(true));

    await user.click(screen.getByRole('button', { name: /导出/ }));
    const dialog = await openModal();
    await user.click(within(dialog).getByRole('combobox', { name: '导出什么' }));
    await clickClickablePopupItem(user, '补丁台账留档（CSV）');

    // 事件按补丁逐条查（异步）⇒ 等到事件列真的落进预览。
    await waitFor(() => expect(previewOf(dialog)).toContain(',published,2026-'));

    const csv = previewOf(dialog);
    expect(csv.split('\n')[0]).toContain('event_kind');
    expect(csv.split('\n')[0]).toContain('event_at');
    expect(csv.split('\n')[0]).toContain('event_channel');
    for (const row of SEED_SITE_PATCHES) expect(csv, row.id).toContain(row.id);
    expect(csv).toContain(',unpublished,2026-');
  });

  it('切到 patches.json ⇒ 文件名对得上，且里面只有已发布的补丁', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('button', { name: /导出/ }));
    const dialog = await openModal();
    await user.click(within(dialog).getByRole('combobox', { name: '导出什么' }));
    await clickClickablePopupItem(user, 'patches.json（边缘函数用）');

    expect(
      within(dialog).getByText(
        `文件名: geo-site-patches_json-${SEED_ACTIVE_PROJECT_ID}.json`,
        { exact: false },
      ),
    ).toBeDefined();

    const published = SEED_SITE_PATCHES.filter((row) => row.status === 'published');
    const payload = JSON.parse(previewOf(dialog)) as {
      version: number;
      project_id: string;
      patches: { id: string; body: string }[];
    };
    expect(payload.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(payload.patches.map((row) => row.id).sort()).toEqual(
      published.map((row) => row.id).sort(),
    );
    // 🔴 边缘下发的是**已发布快照**，不是还在改的草案；草案进 patches.json 等于绕过人工审核
    for (const entry of payload.patches) {
      expect(entry.body).toBe(SEED_SITE_PATCHES.find((row) => row.id === entry.id)?.published_body);
    }
    expect(payload.patches.some((row) => row.id === PENDING.id)).toBe(false);
  });
});

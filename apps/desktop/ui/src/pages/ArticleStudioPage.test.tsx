/**
 * M6 文章管理（Article Studio）的页面测试（走**演示假后端 + 真种子**，口径同 `KnowledgeBasePage.test.tsx`）。
 *
 * # 这里钉的是**界面形态**（spec `2026-10-10-kb-redesign-and-article-studio-design.md` §6）
 * 命令侧的裁定（预置池、按标题去重、生成物恒 pending_review、两处「一条命令两件事」）在
 * `demo/handlers/article.test.ts`，导出闸门在 `api/article-compose.test.ts`；本文件只管它们在
 * 界面上**看得见**：
 * - 三个工作区（方向 / 模板 / 排期与文章）各自的内容与常驻说明；
 * - 模板 Drawer：槽位 chips 点击插入**光标处** + 实时预览用项目真实值替换槽位（DR-86②）；
 * - 排期表：开关就地生效、下次运行随之清空/重算、「立即运行」真的多出一篇待审文章（DR-86③）；
 * - 评审队列：状态筛选、批量通过、导出只收已通过、待审行挂着那句免责标签（规则 6）。
 *
 * # 🔴 定位口径与 `KnowledgeBasePage.test.tsx` 同：**不用 `getByRole`**
 * 本页首屏是三块 Tab × 四张表，RTL 的 `getByRole` 对每个候选元素调 `isInaccessible`
 * （两次 `getComputedStyle`），在 jsdom 上会把一次定位拖到秒级。所以一律走
 * `buttonOf` / `rowOf` / `drawerOf` 这些不调 `getComputedStyle` 的 helper，
 * 只有「点开筛选下拉」这种必须发真指针事件的地方才用 `userEvent`（弹层本身只有几十个节点）。
 * ⚠ 这不是「绕过可访问性」：可访问名与标签覆盖由 `i18n/no-hardcoded-strings.test.ts`（B-4 家族）
 * 与 `i18n/enum-label-prefixes.test.ts` 持有，本文件钉的是**行为**。
 *
 * ⚠ en-US 整页无中文那一支不写在这里：`pages/en-us-page-residual.test.tsx` 已把本页收进整页守卫。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ArticleStudioPage from './ArticleStudioPage';
import zhCN from '../i18n/locales/zh-CN';
import { getDemoDb, resetDemoDb } from '../demo/db';
import {
  SEED_ARTICLES,
  SEED_ARTICLE_DIRECTIONS,
  SEED_ARTICLE_SCHEDULES,
  SEED_ARTICLE_TEMPLATES,
} from '../demo/seed/articles';
import { SEED_ACTIVE_PROJECT_ID, SEED_PROJECTS } from '../demo/seed/projects';
import { clickClickablePopupItem } from '../test/dropdown';
import { renderAtRoute } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/articles`;
const PATH = '/projects/:id/articles';
const PROJECT = SEED_PROJECTS[0];
const A = zhCN.article;

/** 三张表各自的容器 `data-testid`（数行数用，不靠 id 前缀猜）。 */
const TEMPLATE_TABLE = 'article-template-table';
const SCHEDULE_TABLE = 'article-schedule-table';
const REVIEW_TABLE = 'article-review-table';

/** 种子里那条已归档的方向（走查「归档 / 恢复」两个动作的起点）。 */
const ARCHIVED_DIRECTION = SEED_ARTICLE_DIRECTIONS.find((row) => row.status === 'archived');
/** 种子里那两条待人工审核的文章（批量通过就用它们）。 */
const PENDING_ARTICLES = SEED_ARTICLES.filter((row) => row.status === 'pending_review');
/** 种子里那条被打回的文章（导出闸门要用它当反例）。 */
const REJECTED_ARTICLE = SEED_ARTICLES.find((row) => row.status === 'rejected');
/** 那条启用的日更排期。 */
const DAILY_SCHEDULE = SEED_ARTICLE_SCHEDULES[0];
/** 那条停用的周更排期。 */
const WEEKLY_SCHEDULE = SEED_ARTICLE_SCHEDULES[1];

function renderPage() {
  return renderAtRoute(<ArticleStudioPage />, PATH, ROUTE);
}

async function waitLoaded() {
  // 三栏同屏后，方向标题会同时出现在方向卡与模板/排期表里 ⇒ 用 findAll 等数据落地。
  await screen.findAllByText(SEED_ARTICLE_DIRECTIONS[0].title);
}

/**
 * 把一段界面文案变成"容忍 antd 两字按钮插空格"的正则：`编辑` → `/^编\s*辑$/`。
 * 🔴 全宽括号不是正则元字符，所以带插值的文案（`通过选中（2）`）也能直接喂进来。
 */
function labelRe(label: string): RegExp {
  return new RegExp(`^${label.split('').join('\\s*')}$`);
}

/** 按可见文案找按钮（🔴 不用 `getByRole`，理由见文件头）。 */
function buttonOf(label: RegExp, scope: ParentNode = document): HTMLButtonElement {
  const all = [...scope.querySelectorAll('button')];
  const hit = all.find((node) => label.test(node.textContent ?? ''));
  expect(
    hit,
    `找不到按钮 ${label}（现有：${all.map((node) => node.textContent).join(' / ')}）`,
  ).toBeDefined();
  return hit as HTMLButtonElement;
}

/**
 * 三栏工作台（2026-11-02 裁定）后三个工作区同屏，不再需要切换。
 * 保留这个 helper 让既有用例的调用点零改动；标签参数只用于报错信息。
 */
function openTab(label: string) {
  expect(document.body.textContent ?? '', `三栏里没有「${label}」`).toContain(label);
}

/** 方向卡（`ArticleDirectionCards` 的 `data-testid`）。 */
function directionCards(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid^="article-direction-"]')];
}

function directionCardOf(id: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(`[data-testid="article-direction-${id}"]`);
  expect(card, `找不到方向卡 ${id}`).not.toBeNull();
  return card as HTMLElement;
}

/** 某张表的数据行（antd 把 `rowKey` 的值写成 `data-row-key`）。 */
function tableRows(testId: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"] tr[data-row-key]`)];
}

function rowOf(key: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`tr[data-row-key="${key}"]`);
  expect(row, `找不到表格行 ${key}`).not.toBeNull();
  return row as HTMLElement;
}

/** 当前打开着的那个 Drawer（关掉之后节点随组件卸载消失）。 */
function drawerOf(title: RegExp): HTMLElement {
  const hit = [...document.querySelectorAll<HTMLElement>('.ant-drawer-content')].find((node) =>
    title.test(node.querySelector('.ant-drawer-title')?.textContent ?? ''),
  );
  expect(hit, `找不到标题匹配 ${title} 的 Drawer`).toBeDefined();
  return hit as HTMLElement;
}

function textareaOf(label: string, scope: ParentNode = document): HTMLTextAreaElement {
  const hit = scope.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);
  expect(hit, `找不到 textarea「${label}」`).not.toBeNull();
  return hit as HTMLTextAreaElement;
}

/** 当前打开着的那个 Modal。 */
function dialogOf(title: RegExp): HTMLElement {
  const hit = [...document.querySelectorAll<HTMLElement>('.ant-modal')].find((node) =>
    title.test(node.querySelector('.ant-modal-title')?.textContent ?? ''),
  );
  expect(hit, `找不到标题匹配 ${title} 的弹窗`).toBeDefined();
  return hit as HTMLElement;
}

function filterSelect(label: string): HTMLElement {
  const hit = document.querySelector<HTMLElement>(`input[aria-label="${label}"]`);
  expect(hit, `找不到筛选框「${label}」`).not.toBeNull();
  return hit as HTMLInputElement;
}

beforeEach(() => {
  resetDemoDb();
});

describe('ArticleStudioPage · 首屏与方向工作区', () => {
  it('三个工作区都在，方向卡逐字来自种子（含那条已归档的），demo 说明常驻', async () => {
    renderPage();
    await waitLoaded();

    const text = document.body.textContent ?? '';
    expect(screen.getByRole('heading', { name: A.title })).toBeInTheDocument();
    for (const label of [A.tabs.directions, A.tabs.templates, A.tabs.pipeline]) {
      expect(text, `少了工作区「${label}」`).toContain(label);
    }
    // 三个工作区改为三栏同屏：没有 Tabs，三张 SectionCard 头就是三栏标题。
    expect(document.querySelectorAll('.ant-tabs-tab')).toHaveLength(0);
    expect(document.querySelectorAll('section')).toHaveLength(3);

    expect(directionCards()).toHaveLength(SEED_ARTICLE_DIRECTIONS.length);
    for (const row of SEED_ARTICLE_DIRECTIONS) {
      expect(directionCardOf(row.id).textContent).toContain(row.title);
      expect(directionCardOf(row.id).textContent).toContain(row.summary);
    }
    // 已归档那张挂状态标签，其余挂来源标签；裸记号一个都不许上屏。
    expect(directionCardOf(ARCHIVED_DIRECTION!.id).textContent).toContain(
      A.directions.statusArchived,
    );
    expect(text).toContain(A.sources.manual);
    expect(text).toContain(A.demoHint);
    expect(text).toContain(A.directions.hint);
    for (const token of ['archived', 'manual', 'generated', 'article.tabs', 'pending_review']) {
      expect(text, `裸记号 ${token} 上屏了`).not.toContain(token);
    }
  });

  it('「AI 生成方向」从预置池里多出一张卡，且挂 AI 生成来源标签', async () => {
    renderPage();
    await waitLoaded();

    fireEvent.click(buttonOf(labelRe(A.directions.generate)));

    await waitFor(() =>
      expect(directionCards()).toHaveLength(SEED_ARTICLE_DIRECTIONS.length + 1),
    );
    const generated = directionCards().find((card) =>
      card.textContent?.includes(A.sources.generated),
    );
    expect(generated, '新生成的方向没挂 AI 生成标签').toBeDefined();
  });

  it('手动新增方向：标题空白时表单拦住不发命令，填了才落库', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();

    fireEvent.click(buttonOf(labelRe(A.directions.add)));
    const dialog = dialogOf(new RegExp(A.directions.addTitle));
    await user.click(buttonOf(labelRe(A.directions.ok), dialog));
    expect(within(dialog).getByText(A.directions.titleRequired)).toBeInTheDocument();
    expect(directionCards()).toHaveLength(SEED_ARTICLE_DIRECTIONS.length);

    const title = '滤袋更换周期的运维问答';
    fireEvent.change(dialog.querySelector('input#direction_title') as HTMLInputElement, {
      target: { value: title },
    });
    await user.click(buttonOf(labelRe(A.directions.ok), dialog));

    await waitFor(() =>
      expect(directionCards()).toHaveLength(SEED_ARTICLE_DIRECTIONS.length + 1),
    );
    expect(document.body.textContent).toContain(title);
  });

  it('归档 / 恢复就地翻状态（DR-86①：卡片列表 + 归档）', async () => {
    renderPage();
    await waitLoaded();

    const active = SEED_ARTICLE_DIRECTIONS.find((row) => row.status === 'active');
    fireEvent.click(
      buttonOf(labelRe(A.directions.archive), directionCardOf(active!.id)),
    );

    await waitFor(() =>
      expect(directionCardOf(active!.id).textContent).toContain(A.directions.statusArchived),
    );

    fireEvent.click(
      buttonOf(labelRe(A.directions.restore), directionCardOf(active!.id)),
    );
    await waitFor(() =>
      expect(directionCardOf(active!.id).textContent).not.toContain(A.directions.statusArchived),
    );
    // 种子里那条本来就是归档的，全程没动。
    expect(directionCardOf(ARCHIVED_DIRECTION!.id).textContent).toContain(
      A.directions.statusArchived,
    );
  });
});

describe('ArticleStudioPage · 模板工作区（DR-86②：槽位 chips + 实时预览）', () => {
  async function openTemplates() {
    renderPage();
    await waitLoaded();
    openTab(A.tabs.templates);
    await screen.findAllByText(SEED_ARTICLE_TEMPLATES[0].name);
  }

  it('模板表逐字来自种子：名称 / 方向 / 槽位 chips / 文风', async () => {
    await openTemplates();

    expect(tableRows(TEMPLATE_TABLE)).toHaveLength(SEED_ARTICLE_TEMPLATES.length);
    const text = document.body.textContent ?? '';
    for (const row of SEED_ARTICLE_TEMPLATES) {
      expect(text).toContain(row.name);
      expect(text).toContain(row.style);
    }
    // 方向那一列显示方向标题，不是 direction_id 这种裸记号。
    expect(text).toContain(SEED_ARTICLE_DIRECTIONS[0].title);
    expect(text).toContain(A.slots.brand);
    expect(buttonOf(labelRe(A.templates.create))).toBeDefined();
  });

  it('编辑 Drawer：槽位 chip 插在**光标处**，实时预览用项目真实值替换槽位', async () => {
    const user = userEvent.setup();
    await openTemplates();

    const target = SEED_ARTICLE_TEMPLATES[0];
    fireEvent.click(buttonOf(labelRe(A.templates.edit), rowOf(target.id)));
    const drawer = drawerOf(new RegExp(A.templates.editor.editTitle));

    const prompt = textareaOf(A.templates.editor.promptAria, drawer);
    expect(prompt.value).toBe(target.prompt_template);
    // 预览是「替换过槽位」的那一份：品牌名来自项目、产品名来自模板绑定，槽位记号一个不剩。
    const preview = textareaOf(A.templates.editor.previewAria, drawer);
    expect(preview.value).toContain(PROJECT.brand_name);
    expect(preview.value).toContain(target.bindings.product_names[0]);
    expect(preview.value).not.toContain('{{brand}}');
    expect(preview.value).not.toContain('{{product}}');
    // 字数是预览那一份的字数（展示层计数，不是后端指标）。
    const words = preview.value.replace(/\s/g, '').length;
    expect(drawer.textContent).toContain(
      A.templates.editor.wordCount.replace('{{total}}', String(words)),
    );
    // 绑定的知识模块只**记录**不拼接（DR-89）：以 chips 展示，预览正文里不出现模块名。
    expect(drawer.textContent).toContain(A.templates.editor.kbModules);

    // ① 光标在中间 ⇒ 插在中间（不是无脑追加到末尾）。
    const caret = 4;
    prompt.focus();
    prompt.setSelectionRange(caret, caret);
    await user.click(buttonOf(labelRe(A.slots.competitor), drawer));
    expect(prompt.value).toBe(
      `${target.prompt_template.slice(0, caret)}{{competitor}}${target.prompt_template.slice(caret)}`,
    );
    // ② 插入之后预览跟着变：竞品槽位换成项目里的真竞品名。
    const competitors = getDemoDb().competitors.filter((row) => row.project_id === PROJECT.id);
    expect(competitors.length).toBeGreaterThan(0);
    expect(preview.value).toContain(competitors[0].name);
    expect(preview.value).not.toContain('{{competitor}}');
  });

  it('保存模板就地改名称；删模板要过确认，并连带它名下的排期一起消失', async () => {
    const user = userEvent.setup();
    await openTemplates();

    const target = SEED_ARTICLE_TEMPLATES[2];
    fireEvent.click(buttonOf(labelRe(A.templates.edit), rowOf(target.id)));
    const drawer = drawerOf(new RegExp(A.templates.editor.editTitle));
    const name = '资质合规清单模板（改版）';
    fireEvent.change(drawer.querySelector('input#template_name') as HTMLInputElement, {
      target: { value: name },
    });
    await user.click(buttonOf(labelRe(A.templates.editor.ok), drawer));
    await waitFor(() => expect(document.body.textContent).toContain(name));

    // 删掉那条**挂着排期**的模板 ⇒ 排期表里那一行也没了（cascade 在界面上看得见）。
    const bound = SEED_ARTICLE_TEMPLATES[0];
    fireEvent.click(buttonOf(labelRe(A.templates.delete), rowOf(bound.id)));
    const confirm = dialogOf(new RegExp(A.templates.deleteTitle));
    expect(confirm.textContent).toContain(A.templates.deleteCascade);
    await user.click(buttonOf(labelRe(A.templates.deleteOk), confirm));

    await waitFor(() =>
      expect(tableRows(TEMPLATE_TABLE)).toHaveLength(SEED_ARTICLE_TEMPLATES.length - 1),
    );
    openTab(A.tabs.pipeline);
    await screen.findByText(A.schedules.title);
    await waitFor(() =>
      expect(document.querySelector(`tr[data-row-key="${DAILY_SCHEDULE.id}"]`)).toBeNull(),
    );
  });

  it('模板「立即生成」多出一篇待审文章，并挂那句免责标签（规则 6）', async () => {
    await openTemplates();

    fireEvent.click(buttonOf(labelRe(A.templates.runNow), rowOf(SEED_ARTICLE_TEMPLATES[1].id)));

    await waitFor(() => expect(getDemoDb().articles).toHaveLength(SEED_ARTICLES.length + 1));
    openTab(A.tabs.pipeline);
    await screen.findByText(A.review.title);
    await waitFor(() =>
      expect(tableRows(REVIEW_TABLE)).toHaveLength(SEED_ARTICLES.length + 1),
    );
    expect(document.body.textContent).toContain(A.review.complianceUnchecked);
  });
});

describe('ArticleStudioPage · 排期与文章工作区（DR-86③）', () => {
  beforeEach(async () => {
    renderPage();
    await waitLoaded();
    openTab(A.tabs.pipeline);
    await screen.findByText(A.review.title);
  });

  it('排期表：频率 / 时间 / 下次运行都是词典标签与格式化值，那句「不跑真实定时任务」常驻', () => {
    const text = document.body.textContent ?? '';

    expect(tableRows(SCHEDULE_TABLE)).toHaveLength(SEED_ARTICLE_SCHEDULES.length);
    expect(text).toContain(A.schedules.demoBody);
    expect(rowOf(DAILY_SCHEDULE.id).textContent).toContain(A.freqs.daily);
    expect(rowOf(DAILY_SCHEDULE.id).textContent).toContain(DAILY_SCHEDULE.time);
    expect(rowOf(DAILY_SCHEDULE.id).textContent).toContain(String(DAILY_SCHEDULE.run_count));
    expect(rowOf(WEEKLY_SCHEDULE.id).textContent).toContain(A.freqs.weekly);
    // 种子里那条周更排在周三（`weekday: 3`）⇒ 界面上要看到词典里的星期三，不是裸数字。
    expect(WEEKLY_SCHEDULE.weekday).toBe(3);
    expect(rowOf(WEEKLY_SCHEDULE.id).textContent).toContain(A.weekdays.wed);
    // 停用那条没有下次运行时间 ⇒ 空值占位符，不是一个假时间。
    expect(rowOf(WEEKLY_SCHEDULE.id).textContent).toContain('—');
    expect(rowOf(DAILY_SCHEDULE.id).textContent).not.toContain('—');
    for (const token of ['daily', 'weekly', 'next_run_at', 'article.freqs']) {
      expect(text, `裸记号 ${token} 上屏了`).not.toContain(token);
    }
  });

  it('开关就地生效：关掉 ⇒ 下次运行清空；打开 ⇒ 重新算出来', async () => {
    fireEvent.click(rowOf(DAILY_SCHEDULE.id).querySelector('.ant-switch') as HTMLButtonElement);

    await waitFor(() => expect(rowOf(DAILY_SCHEDULE.id).textContent).toContain('—'));
    expect(
      getDemoDb().articleSchedules.find((row) => row.id === DAILY_SCHEDULE.id)?.enabled,
    ).toBe(false);

    fireEvent.click(rowOf(DAILY_SCHEDULE.id).querySelector('.ant-switch') as HTMLButtonElement);
    await waitFor(() => expect(rowOf(DAILY_SCHEDULE.id).textContent).not.toContain('—'));
    expect(
      getDemoDb().articleSchedules.find((row) => row.id === DAILY_SCHEDULE.id)?.enabled,
    ).toBe(true);
  });

  it('「立即运行」真的多出一篇待审文章（预置池，不调模型）', async () => {
    fireEvent.click(buttonOf(labelRe(A.schedules.runNow), rowOf(DAILY_SCHEDULE.id)));

    await waitFor(() => expect(tableRows(REVIEW_TABLE)).toHaveLength(SEED_ARTICLES.length + 1));
    const created = getDemoDb().articles.find(
      (row) => !SEED_ARTICLES.some((seed) => seed.id === row.id),
    );
    expect(created?.status).toBe('pending_review');
    expect(created?.source).toBe('scheduled');
    expect(created?.schedule_id).toBe(DAILY_SCHEDULE.id);
    expect(document.body.textContent).toContain(A.review.complianceUnchecked);
  });

  it('评审队列：状态筛选、批量通过、导出只收已通过（DR-89 复用 LibraryExportModal）', async () => {
    const user = userEvent.setup();

    // ① 状态筛选：只看待审核 ⇒ 种子里那两条，且都挂着免责标签。
    await user.click(filterSelect(A.review.filterAria));
    await clickClickablePopupItem(user, A.statuses.pending_review);
    await waitFor(() => expect(tableRows(REVIEW_TABLE)).toHaveLength(PENDING_ARTICLES.length));
    for (const row of PENDING_ARTICLES) {
      expect(rowOf(row.id).textContent).toContain(row.title);
      expect(rowOf(row.id).textContent).toContain(A.review.complianceUnchecked);
    }

    // ② 批量通过：勾两行 → 点按钮 → 状态列变「已通过」，免责标签随之消失。
    await user.click(filterSelect(A.review.filterAria));
    await clickClickablePopupItem(user, A.review.filterAll);
    await waitFor(() => expect(tableRows(REVIEW_TABLE)).toHaveLength(SEED_ARTICLES.length));
    for (const row of PENDING_ARTICLES) {
      fireEvent.click(rowOf(row.id).querySelector('input[type="checkbox"]') as HTMLInputElement);
    }
    fireEvent.click(
      buttonOf(labelRe(A.review.approveCount.replace('{{selected}}', '2'))),
    );
    await waitFor(() =>
      expect(rowOf(PENDING_ARTICLES[0].id).textContent).toContain(A.statuses.approved),
    );
    expect(rowOf(PENDING_ARTICLES[0].id).textContent).not.toContain(A.review.complianceUnchecked);

    // ③ 导出：只收已通过 ⇒ 打回的那篇一个字都不进产物。
    fireEvent.click(buttonOf(labelRe(A.review.export)));
    const dialog = dialogOf(new RegExp(A.export.markdownTitle));
    const content = (dialog.querySelector('textarea') as HTMLTextAreaElement).value;
    expect(content).toContain(SEED_ARTICLES.find((row) => row.status === 'approved')!.title);
    expect(content).toContain(PENDING_ARTICLES[0].title);
    expect(content).not.toContain(REJECTED_ARTICLE!.title);
    expect(dialog.textContent).toContain(`geo-articles-${SEED_ACTIVE_PROJECT_ID}.md`);
  });

  it('评审队列可以批量退回：rejected 状态不再不可达', async () => {
    const user = userEvent.setup();
    await screen.findByText(A.review.title);

    for (const row of PENDING_ARTICLES) {
      fireEvent.click(rowOf(row.id).querySelector('input[type="checkbox"]') as HTMLInputElement);
    }
    fireEvent.click(buttonOf(labelRe(A.review.rejectCount.replace('{{selected}}', '2'))));

    await waitFor(() =>
      expect(getDemoDb().articles.find((row) => row.id === PENDING_ARTICLES[0].id)?.status).toBe(
        'rejected',
      ),
    );
    await waitFor(() =>
      expect(rowOf(PENDING_ARTICLES[0].id).textContent).toContain(A.statuses.rejected),
    );
    expect(rowOf(PENDING_ARTICLES[1].id).textContent).toContain(A.statuses.rejected);

    await user.click(filterSelect(A.review.filterAria));
    await clickClickablePopupItem(user, A.statuses.rejected);
    await waitFor(() => expect(tableRows(REVIEW_TABLE)).toHaveLength(1 + PENDING_ARTICLES.length));
  });

  it('预览 Drawer 展示正文原文与元信息，不把 Markdown 渲染成 HTML（数据不是标记）', async () => {
    const target = SEED_ARTICLES.find((row) => row.status === 'approved');

    fireEvent.click(buttonOf(labelRe(A.review.preview), rowOf(target!.id)));
    const drawer = drawerOf(new RegExp(target!.title));

    expect(textareaOf(A.review.previewAria, drawer).value).toBe(target!.body_markdown);
    expect(drawer.textContent).toContain(String(target!.word_count));
    expect(drawer.textContent).toContain(A.sources.scheduled);
    expect(drawer.querySelector('h1, h2, h3')).toBeNull();
  });
});

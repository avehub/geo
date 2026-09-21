/**
 * 常驻守卫（Task 15a 第 9 条 · 台账 #04）：**5 个页面在 en-US 下，除数据之外整页无 CJK**。
 *
 * # 为什么这条判据现在才写得出来
 *
 * Task 9 那两轮各页的 B-2 用例都**刻意避开**了「整页无 CJK」，注释原话是
 * 「得先把数据级泄漏面列清楚才写得对」（`pages/ProjectListPage.test.tsx` 与
 * `pages/EntityCardPage.test.tsx` 的 B-2 头注释）。原因很实在：项目名 / 品牌名 / 别名 /
 * 地域 / 标签 / 实体卡字段值 / `prompt.text` / `group_name` 都是**数据**，后端发什么就显示什么，
 * en locale 下照旧是中文——直接断言「整页无 CJK」会假红，于是只能退化成逐条点名 chrome。
 * Task 9b 把最后几处 chrome 泄漏（`ProviderInfo.label_zh`、notes 散文行、枚举标签）收进词典之后，
 * 这条判据才**可能**为真；本文件把它落成常驻守卫，并给「数据」下一个可执行定义。
 *
 * # 判据形状：`整页文本节点 − 演示种子数据 = 无 CJK`
 *
 * 不做「白名单几个 chrome 串」那种点名式断言（漏一个就静默通过），而是反过来：
 * 遍历 `document.body` 的**全部文本节点**，把 demo 种子数据里出现过的每一个中文串从节点文本里
 * 减掉，剩下的部分再查 CJK。剩下的还有中文 ⇒ 那一定是**界面文案**泄漏（词典漏翻、
 * 硬编码、或后端散文行直接上屏），必须红。
 *
 * 「减掉」而不是「整节点相等」，是为了容下**模板 + 数据**的组合形态：
 * `AI-extracted: 澜舟` 这种节点整体不在数据清单里，但减掉数据串 `澜舟` 之后剩下的
 * `AI-extracted: ` 是干净 ASCII ⇒ 判为合格。反过来，`已抽取：澜舟` 减完之后还剩 `已抽取：`
 * ⇒ 判红。这正是本守卫要的判别力（对照组见下面那条用例）。
 *
 * 数据清单**从种子模块现算、不手抄**：`import * as seed…` 把 6 个 seed 模块的全部导出走一遍，
 * 收上所有含 CJK 的字符串。所以给 demo 加一条中文语料不需要同步改这里；
 * 而清单塌成空集会被下面「防空跑」那条抓住。
 *
 * # 为什么走 demo 假后端而不是逐页 stub
 *
 * 5 个页面各有一套 `mockInvoke` 桩（`stubList()` / `stub('sufficient')` …），复刻一遍既冗长
 * 又会与各自的页面测试漂移。这里把 `api/runtime` mock 成 `'demo'`，`api/client.ts:172` 就会
 * 把全部命令分派给 `demo/backend.ts` 的 `demoInvoke` ⇒ 5 个页面共用**同一份真种子数据**，
 * 与产品负责人在 `mise run web` 里看到的是同一个数据面。
 *
 * ⚠ 副作用是「数据清单」也必须取 demo 侧的种子（`src/demo/seed/**`）而不是 `src/test/fixtures.ts`
 * ——两套桩数据的品牌名不同（澜舟除尘 vs 宏宇泵业）。取错一侧会整页假红。
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import * as seedEntityCards from '../demo/seed/entity-cards';
import * as seedProjects from '../demo/seed/projects';
import * as seedPromptItemsInsufficient from '../demo/seed/prompt-items-insufficient';
import * as seedPromptItemsSufficient from '../demo/seed/prompt-items-sufficient';
import * as seedPromptSets from '../demo/seed/prompt-sets';
import * as seedSettings from '../demo/seed/settings';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import enUS from '../i18n/locales/en-US';
import { renderAtRoute, renderWithProviders } from '../test/render';
import EntityCardPage from './EntityCardPage';
import ProjectListPage from './ProjectListPage';
import ProjectWizardPage from './ProjectWizardPage';
import PromptSetPage from './PromptSetPage';
import SettingsPage from './SettingsPage';

// `client.ts` 只从 `./runtime` 取 `runtime` 这一个绑定（照 `api/client.demo-runtime.test.ts:38` 的既有做法）。
vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

/**
 * 残留字符类：与 `i18n/no-hardcoded-strings.test.ts:90`、`i18n/enum-label.test.tsx:51`
 * **同集合**（CJK 汉字 + CJK 标点 + 全角形式）。这里判的是**渲染结果**而不是源码，
 * 所以窄区间那套「看不见 `、`」的老问题同样适用——`join('、')` 泄漏到界面上要能被这条抓住。
 */
const CJK = /[\u3000-\u303f\u4e00-\u9fa5\uff00-\uffef]/;

function collectCjkStrings(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 8) return;
  if (typeof node === 'string') {
    if (CJK.test(node)) out.add(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const value of node) collectCjkStrings(value, out, depth + 1);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      collectCjkStrings(value, out, depth + 1);
    }
  }
}

/**
 * 演示种子数据里全部含 CJK 的字符串，**长的排前面**。
 *
 * 排序是必需的：`'澜舟除尘 · 基线题库'` 必须先于 `'澜舟除尘'` 被减掉，
 * 否则节点文本里会剩下 `' · 基线题库'` 这段（虽然它是 ASCII，但换个语料就会剩下中文尾巴）。
 */
const DATA_STRINGS: string[] = (() => {
  const found = new Set<string>();
  for (const mod of [
    seedEntityCards,
    seedProjects,
    seedPromptItemsInsufficient,
    seedPromptItemsSufficient,
    seedPromptSets,
    seedSettings,
  ]) {
    for (const value of Object.values(mod)) collectCjkStrings(value, found);
  }
  return [...found].sort((left, right) => right.length - left.length);
})();

/**
 * en-US 词典里**刻意**含 CJK 的值（第二类例外，形状钉死为恰好 2 条）。
 *
 * - `common.appName` = `'稿得快 GEO'`：产品名，两侧**逐字相同**（专有名词不译）。
 * - `project.wizard.aliasesPlaceholder` = `'e.g. HongYu, 宏宇'`：那个中文样本是**产品意图**
 *   而不是漏翻——别名既可能是中文也可能是拼音，占位提示要同时示范两种写法
 *   （`i18n/locales/zh-CN/project.ts` 顶部那段注释讲的就是它，zh 侧对应值是 `'例如：宏宇、HongYu'`）。
 *
 * ⚠ 从词典**现算**、不手抄，并逐条钉住：en 侧再长出一个含中文的值 ⇒ 下面那条断言立刻红，
 * 必须回来判断它是"同类刻意样本"还是真漏翻。这条例外因此不会悄悄长大。
 */
function leafValues(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) leafValues(value, out);
  }
  return out;
}

const EN_DICT_CJK: string[] = leafValues(enUS)
  .filter((value) => CJK.test(value))
  .sort((left, right) => right.length - left.length);

/** 把节点文本里的数据串与已登记的词典例外逐个减掉，返回剩下的部分。 */
function withoutData(text: string): string {
  let rest = text;
  for (const data of [...DATA_STRINGS, ...EN_DICT_CJK]) rest = rest.split(data).join('');
  return rest;
}

/** 当前 DOM 里「减掉数据之后仍含 CJK」的文本节点（= 界面文案泄漏，格式带上原文便于定位）。 */
function unexplainedCjkText(): string[] {
  const offenders: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const raw = node.textContent ?? '';
    if (!CJK.test(raw)) continue;
    const rest = withoutData(raw);
    if (CJK.test(rest)) offenders.push(`剩下 "${rest.trim()}" ⟵ 节点原文 "${raw.trim()}"`);
  }
  return offenders;
}

/** 每个页面都要先证明自己**真的渲染出来了**，否则「0 条泄漏」是空跑。 */
function expectRendered(englishChrome: string): void {
  expect(screen.getByText(englishChrome), `页面没渲染出 "${englishChrome}"，判据是空跑的`).toBeDefined();
  expect((document.body.textContent ?? '').length).toBeGreaterThan(40);
}

/**
 * 等到演示种子数据**真的上屏**（标题在 loading 期间就渲染了，只等标题等于没等）。
 * 没有这一步，"页面还在转圈 ⇒ 一个文本节点都没有 ⇒ 0 条泄漏" 会让判据空跑。
 */
async function expectDataLanded(): Promise<void> {
  await waitFor(() => {
    const body = document.body.textContent ?? '';
    expect(
      DATA_STRINGS.some((value) => body.includes(value)),
      '页面没有渲染出任何演示种子数据 ⇒ 数据面没落地，本条判据是空跑的',
    ).toBe(true);
  });
}

const MESSAGE =
  '这些文本节点在减掉演示种子数据之后仍含中文 ⇒ **界面文案**泄漏（词典漏翻 / 硬编码 / ' +
  '后端散文行直接上屏）。迁进 `i18n/locales/**`（zh/en 同批），🔴 不许把数据串加进 DATA_STRINGS 来让它变绿';

describe('常驻守卫（第 9 条）· 5 个页面在 en-US 下整页无非数据 CJK', () => {
  it('防空跑：数据清单非空、真的从种子里数得出中文，且减法只对数据串生效', () => {
    expect(DATA_STRINGS.length, '种子数据清单为空 ⇒ 判据退化成「整页无 CJK」，会整页假红').toBeGreaterThanOrEqual(20);
    expect(DATA_STRINGS.some((value) => value.includes('澜舟')), '清单里连品牌名都没有 ⇒ 走错了桩数据源').toBe(true);
    // en 词典里刻意含 CJK 的值：逐条钉死（多一条 ⇒ 必须回来判断是刻意样本还是漏翻）
    expect(EN_DICT_CJK, 'en-US 词典里含 CJK 的值变了（逐条判断：刻意样本还是漏翻？）').toEqual([
      'e.g. HongYu, 宏宇',
      '稿得快 GEO',
    ]);
    // 长串排在前面（减法顺序的前提）
    for (let index = 1; index < DATA_STRINGS.length; index += 1) {
      expect(DATA_STRINGS[index - 1].length).toBeGreaterThanOrEqual(DATA_STRINGS[index].length);
    }
    expect(withoutData('Save')).toBe('Save');
    // 数据串被减成空；数据串之外的中文一个字符都不减
    expect(withoutData(DATA_STRINGS[0])).toBe('');
    expect(withoutData('保存')).toBe('保存');
  });

  /**
   * ⚠ 这条用例直接改 DOM，所以改动一律收进自己创建的宿主节点、`finally` 里摘掉：
   * RTL 的 `cleanup()`（`test/setup.ts:35`）只卸它自己建的容器，
   * 留在 `document.body` 上的节点会漏给后面 5 个页面用例，把它们的判据污染成假红
   * （本轮实测踩过：`['A', 'B'].join('、')` 那个探针串在 ProjectWizardPage 与 SettingsPage 里又红了一次）。
   */
  it('自证（对照组）：塞一个中文文本节点就会被扫出来；塞一条数据串则不会', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      host.innerHTML = '<div>Save</div>';
      expect(unexplainedCjkText()).toEqual([]);

      // ① 裸中文 chrome ⇒ 必须红
      host.innerHTML = '<div>保存</div>';
      expect(unexplainedCjkText()).toHaveLength(1);

      // ② 数据串 ⇒ 合格（这条证明判据不是「见中文就红」）
      host.innerHTML = `<div>${DATA_STRINGS[0]}</div>`;
      expect(unexplainedCjkText()).toEqual([]);

      // ③ 模板 + 数据：中文模板部分仍要报（这条才是 ② 的对价）
      host.innerHTML = `<div>已抽取：${DATA_STRINGS[0]}</div>`;
      expect(unexplainedCjkText()).toHaveLength(1);

      // ④ 中文标点同样看得见（`、` U+3001 不在窄区间里，是 Task 8 复审 #6 的漏网形态）
      host.innerHTML = "<div>['A', 'B'].join('、')</div>";
      expect(unexplainedCjkText()).toHaveLength(1);

      // ⑤ 已登记的词典例外（那个刻意保留的中文样本）⇒ 合格
      host.innerHTML = `<div>${EN_DICT_CJK[0]}</div>`;
      expect(unexplainedCjkText()).toEqual([]);
    } finally {
      host.remove();
    }
  });

  it('ProjectListPage：项目表的 chrome 全英文，中文只来自数据列', async () => {
    renderWithProviders(<ProjectListPage />, { locale: 'en-US' });
    await screen.findByRole('heading', { name: 'Projects' });
    await expectDataLanded();
    expectRendered('New project');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('EntityCardPage：实体卡字段名全英文，中文只来自字段值', async () => {
    renderAtRoute(
      <EntityCardPage />,
      '/projects/:id/entity-card',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/entity-card`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Brand Entity Card' });
    await expectDataLanded();
    expectRendered('Revision history');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('PromptSetPage：题库表格与筛选器全英文，中文只来自题干与分组名', async () => {
    renderAtRoute(
      <PromptSetPage />,
      '/projects/:id/prompts',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/prompts`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Prompt Library' });
    await expectDataLanded();

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('ProjectWizardPage：向导步骤与表单字段全英文（空白表单，本页连数据都不该有中文）', () => {
    renderWithProviders(<ProjectWizardPage />, { locale: 'en-US' });
    expectRendered('New project');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('SettingsPage：设置项与密钥区全英文（provider 名走词典，不许回落 `label_zh`）', async () => {
    renderWithProviders(<SettingsPage />, { locale: 'en-US' });
    await screen.findByRole('heading', { name: 'Settings' });
    expectRendered('Model provider');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });
});

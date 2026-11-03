/**
 * M7 报告页的页面测试（走**演示假后端 + 真种子**，口径同 `pages/CollectionPage.test.tsx`）。
 *
 * # 这里钉的是**界面形态**
 * 挑节、省略空节、白标回落、`variant` 不收敛——都在 `demo/handlers/report.test.ts`。
 * 本文件只管它们在界面上**看得见**：
 * - 出不了报告的轮次在选择器里置灰，并说明为什么；
 * - 🔴 三个版本的差别由**后端给哪些节**决定，前端不裁剪（预览里就是那几个节标题）；
 * - 白标信息要显式点「生成报告」才生效，留空回落默认署名；
 * - 🔴 六个导出按钮都渲染，但只有三个能点，其余逐条说明"由桌面端提供"；
 * - 免责声明与口径说明每一版都在（合规红线，AGENTS 规则 6）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ReportPage from './ReportPage';
import { resetDemoDb } from '../demo/db';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import {
  SEED_BASELINE_ROUND_ID,
  SEED_COLLECTION_ROUNDS,
  SEED_RETEST_ROUND_ID,
  SEED_TRIAL_ROUND_ID,
} from '../demo/seed/collection-rounds';
import { SEED_REPORTS, SEED_VARIANT_SECTIONS, SEED_WHITE_LABEL } from '../demo/seed/reports';
import { dateTimeText } from '../components/format';
import { renderAtRoute } from '../test/render';

vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

const ROUTE = `/projects/${SEED_ACTIVE_PROJECT_ID}/report`;
const PATH = '/projects/:id/report';

/** 节 id → 界面标题（`report.sections.<id>`，zh-CN 词典）。 */
const SECTION_TITLES: Record<string, string> = {
  conclusion: '结论',
  coverage: '可见度明细',
  competitors: '竞品对标',
  engines: '引擎差异',
  funnel: '意图漏斗',
  fact_check: '事实核查明细',
  actions: '处方摘要',
  evidence: '证据附录',
};

const BRAND = '澜舟';

/** 预览里的引擎名（`collection.engines`，zh-CN）。 */
const ENGINE_LABELS: Record<string, string> = {
  doubao: '豆包',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  qwen: '通义千问',
  yuanbao: '腾讯元宝',
  baidu_ai: '百度 AI 搜索',
  metaso: '秘塔搜索',
};
const RETEST_LABEL = SEED_COLLECTION_ROUNDS.find((round) => round.id === SEED_RETEST_ROUND_ID)!.label;
const TRIAL_LABEL = SEED_COLLECTION_ROUNDS.find((round) => round.id === SEED_TRIAL_ROUND_ID)!.label;

function renderPage() {
  return renderAtRoute(<ReportPage />, PATH, ROUTE);
}

async function waitLoaded() {
  await screen.findByRole('heading', { name: '报告与分享' });
  // 默认选中最近一轮**能出报告**的（进行中那轮被排除）。回显是「轮次名 · 状态」⇒ 用正则。
  await screen.findByText(new RegExp(RETEST_LABEL), {
    selector: '.ant-select-selection-item',
  });
}

/** 点「生成报告」并等预览出来（标题是报告卡片的 title）。 */
async function generate(user: ReturnType<typeof userEvent.setup>, title: string | RegExp) {
  await user.click(screen.getByRole('button', { name: /生成报告/ }));
  await screen.findByText(title);
}

/**
 * 切报告版本。
 *
 * ⚠ 用 `fireEvent.click` 而不是 `user.click`：antd 的 `Radio.Button` 把真正的 `<input>`
 * 藏成 `pointer-events: none`（可见的是外面那个 label），user-event 会直接拒绝点它。
 * 与 `pages/PromptSetPage.test.tsx` 里点 Radio 的既有口径一致。
 */
function clickVariant(name: string) {
  fireEvent.click(screen.getByRole('radio', { name }));
}

/** 切到某一轮。 */
async function selectRound(user: ReturnType<typeof userEvent.setup>, roundId: string) {
  const round = SEED_COLLECTION_ROUNDS.find((entry) => entry.id === roundId)!;
  await user.click(screen.getByRole('combobox'));
  const options = (await screen.findAllByTitle(new RegExp(round.label))).filter((element) =>
    element.hasAttribute('aria-selected'),
  );
  expect(options).toHaveLength(1);
  await user.click(options[0]);
}

/**
 * 白标表单里某个字段名下的输入框。
 *
 * ⚠ 不能用 `getByLabelText`：那三个 `Form.Item` 是**不受控**的（没有 `name`，值由页面 state 管），
 * antd 因此不会给 `label` 挂 `for` ⇒ 没有可访问名。按「字段名 → 最近的 form-item → 里面的 input」定位。
 */
function inputUnderLabel(label: string): HTMLElement {
  const item = screen.getByText(label).closest('.ant-form-item');
  expect(item, `找不到字段「${label}」`).not.toBeNull();
  const input = item!.querySelector('input');
  expect(input, `字段「${label}」下没有输入框`).not.toBeNull();
  return input as HTMLElement;
}

/** 预览卡片里出现的节标题（按 `report.sections` 的中文标签查）。 */
function renderedSections(): string[] {
  return Object.values(SECTION_TITLES).filter((title) =>
    screen.queryAllByText(title).some((element) => element.closest('.ant-divider') !== null),
  );
}

beforeEach(() => {
  resetDemoDb();
});

describe('ReportPage · 生成之前', () => {
  it('🔴 空状态 + 出不了报告的轮次置灰并说明原因 + 静态值口径', async () => {
    renderPage();
    await waitLoaded();

    expect(screen.getByText('选择一轮已完成的采集，再生成报告。')).toBeInTheDocument();
    expect(
      screen.getByText('报告里的数字取自诊断页的静态口径，演示模式不重算。'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('排队中、采集中或失败的轮次不能出报告。'),
    ).toBeInTheDocument();
    // 预览与导出条都还没渲染。
    expect(screen.queryByText('导出与分享')).not.toBeInTheDocument();

    // 进行中那轮在下拉里是 disabled 的（`partial` 可以出，`running` 不行）。
    await userEvent.setup().click(screen.getByRole('combobox'));
    const live = SEED_COLLECTION_ROUNDS[3];
    expect(live.status).toBe('running');
    const liveOption = (await screen.findAllByTitle(new RegExp(live.label))).find((element) =>
      element.hasAttribute('aria-selected'),
    );
    expect(liveOption?.closest('.ant-select-item-option-disabled')).not.toBeNull();
    const trialOption = (await screen.findAllByTitle(new RegExp(TRIAL_LABEL))).find((element) =>
      element.hasAttribute('aria-selected'),
    );
    expect(trialOption?.closest('.ant-select-item-option-disabled')).toBeNull();
  });

  it('三个版本的说明就在单选按钮旁边（选哪个就说哪个的差别）', async () => {
    renderPage();
    await waitLoaded();

    expect(screen.getByText('1 页结论 + 3 个数字 + 下一步')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '老板版' })).toBeChecked();
    clickVariant('白标版');
    expect(
      await screen.findByText('服务商署名，去掉漏斗与核查明细'),
    ).toBeInTheDocument();
    // 白标版才出现那张表单。
    expect(screen.getByText('白标信息')).toBeInTheDocument();
    expect(screen.getByText('服务商名称')).toBeInTheDocument();
    expect(
      screen.getByText(
        '三项都留空时使用默认署名（演示数据里的那一家服务商）。 改完白标信息后点「生成报告」生效。',
      ),
    ).toBeInTheDocument();
  });
});

describe('ReportPage · 老板版', () => {
  it('只有结论一节（+ 证据附录），标题按词典拼，免责声明与口径说明都在', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await generate(user, `${BRAND} · GEO 体检简报（${RETEST_LABEL}）`);

    // 🔴 版本差别由后端给哪些节决定：老板版就一个 conclusion，勾了附录再加一节。
    expect(renderedSections()).toEqual([
      SECTION_TITLES.conclusion,
      SECTION_TITLES.evidence,
    ]);
    expect(SEED_VARIANT_SECTIONS.executive).toEqual(['conclusion']);

    expect(screen.getByText('关键数字')).toBeInTheDocument();
    const payload = SEED_REPORTS[SEED_RETEST_ROUND_ID];
    for (const step of payload.next_steps) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
    expect(screen.getByText('下一步建议')).toBeInTheDocument();

    // 口径说明：样本量分级、引擎、题库、指标口径版本。
    expect(screen.getByText('口径说明')).toBeInTheDocument();
    expect(screen.getByText(`${payload.methodology.sample_size} · 样本充足`)).toBeInTheDocument();
    expect(screen.getByText(`${payload.methodology.prompt_set_label} (v1)`)).toBeInTheDocument();
    expect(screen.getByText(payload.methodology.metric_spec_version)).toBeInTheDocument();
    // 样本充足 ⇒ 不显示那条降级告警；重复采样 1 次 ⇒ 也不显示区间那句。
    expect(
      screen.queryByText('样本量低于下限，本报告只提供方向性参考，不提供精确分数。'),
    ).not.toBeInTheDocument();

    // 🔴 合规红线：免责声明每一版都在。
    expect(
      screen.getByText(
        '本报告基于抽样采集与既定指标口径，反映的是本品牌在 AI 回答里的可见度与内容适配情况，' +
          '不构成对搜索或 AI 排名结果的承诺。',
      ),
    ).toBeInTheDocument();
    // 老板版没有白标信息 ⇒ 不渲染"本报告由…出品"。
    expect(screen.queryByText(/本报告由/)).not.toBeInTheDocument();
  });

  it('关掉「附证据附录」后那一节整节消失，其余不变', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await generate(user, `${BRAND} · GEO 体检简报（${RETEST_LABEL}）`);
    expect(renderedSections()).toContain(SECTION_TITLES.evidence);

    await user.click(screen.getByRole('switch'));
    await waitFor(() => expect(renderedSections()).toEqual([SECTION_TITLES.conclusion]));
    expect(
      screen.getByText('附录含原始回答片段、引擎与采集时间，用于向老板或客户自证。'),
    ).toBeInTheDocument();
  });

  it('🔴 六个导出按钮都渲染，Word / PDF / PNG 置灰并逐条说明', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await generate(user, `${BRAND} · GEO 体检简报（${RETEST_LABEL}）`);

    const bar = screen.getByText('导出与分享').closest('.ant-card') as HTMLElement;
    for (const format of ['Markdown', 'HTML', 'CSV']) {
      expect(within(bar).getByRole('button', { name: new RegExp(format) })).toBeEnabled();
    }
    for (const format of ['Word', 'PDF', 'PNG']) {
      expect(within(bar).getByRole('button', { name: new RegExp(format) })).toBeDisabled();
      expect(
        within(bar).getByText(`${format} 由桌面端提供，演示模式下不可用。`),
      ).toBeInTheDocument();
    }
    expect(within(bar).getByRole('button', { name: /复制正文/ })).toBeEnabled();
    expect(within(bar).getByText(/生成时间: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)).toBeInTheDocument();
  });
});

describe('ReportPage · 执行版与小样本轮', () => {
  it('执行版把七节全给（+ 附录），竞品对标表按后端给的行渲染', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await generate(user, `${BRAND} · GEO 体检简报（${RETEST_LABEL}）`);

    clickVariant('执行版');
    // 版本进 query key ⇒ 换版本自动重渲，不必再点一次「生成报告」。
    await waitFor(() =>
      expect(screen.getByText(`${BRAND} · GEO 体检执行报告（${RETEST_LABEL}）`)).toBeInTheDocument(),
    );
    expect(renderedSections()).toEqual([
      ...SEED_VARIANT_SECTIONS.detailed.map((id) => SECTION_TITLES[id]),
      SECTION_TITLES.evidence,
    ]);
    // 竞品对标那一节里有本品牌与三家竞品（数据级中文）。
    expect(screen.getByText('清源环保')).toBeInTheDocument();
    expect(screen.getByText('恒宇环境')).toBeInTheDocument();
  });

  it('小样本的通道验证轮：只剩结论一节 + 🔴 降级告警 + 样本不足分级', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_TRIAL_ROUND_ID);
    await generate(user, `${BRAND} · GEO 体检简报（${TRIAL_LABEL}）`);

    // 这一轮连竞品矩阵都没有 ⇒ 三个版本都只剩结论（+ 附录）。
    expect(renderedSections()).toEqual([
      SECTION_TITLES.conclusion,
      SECTION_TITLES.evidence,
    ]);
    expect(
      screen.getByText('样本量低于下限，本报告只提供方向性参考，不提供精确分数。'),
    ).toBeInTheDocument();
    expect(screen.getByText('5 · 样本不足')).toBeInTheDocument();
    // 附录行来自种子（这一轮只预置了 1 行证据）。
    expect(SEED_REPORTS[SEED_TRIAL_ROUND_ID].evidence_rows).toHaveLength(1);
    expect(screen.getByText(SEED_REPORTS[SEED_TRIAL_ROUND_ID].evidence_rows[0][0])).toBeInTheDocument();
  });

  it('基线轮的附录行数与种子一致（前端不改写单元格）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    await selectRound(user, SEED_BASELINE_ROUND_ID);
    clickVariant('执行版');
    await generate(user, /GEO 体检执行报告/);

    const rows = SEED_REPORTS[SEED_BASELINE_ROUND_ID].evidence_rows;
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(screen.getByText(row[0])).toBeInTheDocument();
    }
  });
});

describe('ReportPage · 白标版', () => {
  it('三项都留空 ⇒ 回落种子里的默认署名', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    clickVariant('白标版');
    await generate(user, `${BRAND} · GEO 体检报告（${RETEST_LABEL}）`);

    expect(renderedSections()).toEqual([
      ...SEED_VARIANT_SECTIONS.white_label.map((id) => SECTION_TITLES[id]),
      SECTION_TITLES.evidence,
    ]);
    // 🔴 白标版去掉漏斗与核查明细。
    expect(renderedSections()).not.toContain(SECTION_TITLES.funnel);
    expect(renderedSections()).not.toContain(SECTION_TITLES.fact_check);
    expect(
      screen.getByText(
        `本报告由 ${SEED_WHITE_LABEL.agency_name} 出品 · ${SEED_WHITE_LABEL.contact}`,
      ),
    ).toBeInTheDocument();
  });

  it('🔴 白标 Logo 在预览里可见，采集时间与引擎名和导出同源', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    clickVariant('白标版');
    await generate(user, `${BRAND} · GEO 体检报告（${RETEST_LABEL}）`);

    await user.type(inputUnderLabel('服务商名称'), 'Suzhou Sample Agency');
    await user.type(inputUnderLabel('Logo 链接'), 'https://cdn.example.com/suzhou-logo.png');
    await user.click(screen.getByRole('button', { name: /生成报告/ }));

    const logo = await screen.findByAltText('Suzhou Sample Agency');
    expect(logo.tagName).toBe('IMG');
    expect(logo).toHaveAttribute('src', 'https://cdn.example.com/suzhou-logo.png');

    // 采集时间走 dateTimeText，不再露出 ISO 原文；引擎名走词典，不再露 doubao。
    const payload = SEED_REPORTS[SEED_RETEST_ROUND_ID];
    expect(screen.getByText(dateTimeText(payload.methodology.collected_at))).toBeInTheDocument();
    expect(screen.queryByText(payload.methodology.collected_at)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        payload.methodology.engines.map((engine) => ENGINE_LABELS[engine]).join(', '),
      ),
    ).toBeInTheDocument();
  });

  it('🔴 现场改的白标信息要点「生成报告」才生效（不进 query key）', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitLoaded();
    clickVariant('白标版');
    await generate(user, `${BRAND} · GEO 体检报告（${RETEST_LABEL}）`);
    expect(screen.queryByText(/Suzhou Sample Agency/)).not.toBeInTheDocument();

    await user.type(inputUnderLabel('服务商名称'), 'Suzhou Sample Agency');
    await user.type(inputUnderLabel('联系方式'), 'geo@example-agency.example.com');
    // 敲字不会重渲报告（否则每敲一个字就重取一次，还带着 demo 的假延迟）。
    expect(screen.queryByText(/Suzhou Sample Agency/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /生成报告/ }));
    await waitFor(() =>
      expect(
        screen.getByText(
          '本报告由 Suzhou Sample Agency 出品 · geo@example-agency.example.com',
        ),
      ).toBeInTheDocument(),
    );
    // 默认署名那一行随之消失（只有一处署名）。
    expect(screen.queryByText(new RegExp(SEED_WHITE_LABEL.agency_name))).not.toBeInTheDocument();
  });
});

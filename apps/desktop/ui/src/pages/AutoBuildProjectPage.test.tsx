/**
 * 填网址自动采集屏（Plan B Task 7 · spec §7 / DR-36）。
 *
 * 五条靶心，逐条对着 spec §7 写：
 * ① 空网址点「开始」**就地拦下**，一条 IPC 都不发；
 * ② 非 demo 域名（host 里没有点号，走 `assertDemoDomain` 那支）⇒ 显示**词典渲染**的错误，
 *    并且把已经建出来的项目**回滚删掉**（先建后抽 ⇒ 抽取失败时项目已落库，不删就留空壳）；
 * ③ 合法网址 ⇒ `抓取中` → `抽取中` → `完成 N% 字段` 三段**依次都能观测到**，不许一步跳完
 *    （等待形态本身就是要验收的东西：真后端抓取要几十秒）；
 * ④ 🔴「演示模式不抓取网页，抽取结果是预置数据」**全程常驻**（开跑前、跑动中都在）；
 * ⑤ 成功后跳 `/projects/:id/entity-card`，且抽出来的卡每个字段都是「待确认」
 *    （真值源 `crates/geo-domain/src/entity_card.rs:243-250` 的 `from_extraction` 用
 *    `FieldStatus::Pending` 建卡）——逐字段确认在实体卡那一页做，这一屏不重复造界面。
 *
 * # 🔴 桩**委托给真 demo 后端**，不是手写返回值
 * `mockInvoke.stubAlways(cmd, (args) => demoInvoke(cmd, args))`：这样 ② 走的是
 * `assertDemoDomain` 的真实分支、⑤ 落的是真实的内存库，判据才不是"我桩了什么就断言什么"。
 * 命令级 mock 会把 demo 后端的契约测试与页面测试割裂成两套真相。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';

import AutoBuildProjectPage from './AutoBuildProjectPage';
import zhCN from '../i18n/locales/zh-CN';
import { mockInvoke } from '../test/invoke-mock';
import { renderWithProviders } from '../test/render';
import { demoInvoke } from '../demo/backend';
import { getDemoDb, resetDemoDb } from '../demo/db';
import { SEED_ENTITY_CARDS } from '../demo/seed/entity-cards';
import { SEED_PROJECTS } from '../demo/seed/projects';

const COPY = zhCN.project.autobuild;
const VALID_URL = 'https://demo-brand.example.com';
/** host 里没有点号 ⇒ 真 demo 后端按 `asset.rs:117` 那条分支拒掉（reason=invalid_url）。 */
const INVALID_URL = 'localhost';
const EXPECTED_PERCENT = Math.round(SEED_ENTITY_CARDS[0].completeness * 100);

/** 这一屏会碰到的 4 条命令，全部委托给真 demo 后端。 */
const DELEGATED = [
  'project_create',
  'entity_card_autobuild',
  'project_update',
  'project_delete',
] as const;

function stubRealDemoBackend(): void {
  for (const cmd of DELEGATED) {
    mockInvoke.stubAlways(cmd, (args) => demoInvoke(cmd, args));
  }
}

function PathProbe() {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function pathname(): string {
  return screen.getByTestId('pathname').textContent ?? '';
}

function renderPage(route = '/projects/new/auto') {
  return renderWithProviders(
    <>
      <AutoBuildProjectPage />
      <Routes>
        <Route path="*" element={<PathProbe />} />
      </Routes>
    </>,
    { route },
  );
}

/** 三段进度的第三段：`{{percent}}` 用种子里的静态完整率插值（规则 9：demo 不算完整率）。 */
function doneText(): string {
  return COPY.stageDone.replace('{{percent}}', String(EXPECTED_PERCENT));
}

beforeEach(() => {
  resetDemoDb();
  stubRealDemoBackend();
});

afterEach(() => {
  resetDemoDb();
});

describe('AutoBuildProjectPage · 填网址自动采集（spec §7）', () => {
  it('① 空网址点「开始」就地拦下，一条 IPC 都不发', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: COPY.start }));

    expect(await screen.findByText(COPY.emptyUrl)).toBeInTheDocument();
    expect(mockInvoke.allCalls()).toEqual([]);
    // 拦下来之后不许进任何一段进度
    expect(screen.queryByText(COPY.stageCrawling)).not.toBeInTheDocument();
  });

  it('② 非 demo 域名：词典渲染的错误 + 已建的项目被回滚删掉', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(COPY.urlPlaceholder), INVALID_URL);
    await user.click(screen.getByRole('button', { name: COPY.start }));

    // `validation/failed` + `field=domain` + `reason=invalid_url` + `value` 走 fragments.param_value
    expect(await screen.findByText('官网域名不是合法网址（localhost）')).toBeInTheDocument();
    // 🔴 回滚：先建后抽 ⇒ 抽取失败时项目已经落库了
    await waitFor(() => expect(mockInvoke.callsOf('project_delete')).toHaveLength(1));
    expect(getDemoDb().projects).toHaveLength(SEED_PROJECTS.length);
    // 失败之后不许把进度停在中间态（否则界面上一直是"抽取中"）
    expect(screen.queryByText(COPY.stageExtracting)).not.toBeInTheDocument();
    // 「演示模式不抓取网页」这句失败时也得在
    expect(screen.getByText(COPY.demoNotice)).toBeInTheDocument();
  });

  it('③④⑤ 合法网址：三段依次可观测、演示提示常驻、跳到实体卡且字段全待确认', async () => {
    const user = userEvent.setup();
    renderPage();

    // ④ 开跑之前就在
    expect(screen.getByText(COPY.demoNotice)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(COPY.urlPlaceholder), VALID_URL);
    await user.click(screen.getByRole('button', { name: COPY.start }));

    // ③ 第一段
    expect(await screen.findByText(COPY.stageCrawling)).toBeInTheDocument();
    // ④ 跑动中仍然在
    expect(screen.getByText(COPY.demoNotice)).toBeInTheDocument();
    // ③ 第二段
    expect(await screen.findByText(COPY.stageExtracting)).toBeInTheDocument();
    // ③ 第三段：完成 N% 字段
    expect(await screen.findByText(doneText())).toBeInTheDocument();

    // ⑤ 跳到刚建出来的那个项目的品牌实体卡
    await waitFor(() => expect(pathname()).toMatch(/^\/projects\/[^/]+\/entity-card$/));
    const newProjectId = pathname().split('/')[2];

    // DR-36 先建后抽：抽取用的是刚建出来的项目 id 与用户填的那个网址
    expect(mockInvoke.lastArgsOf('project_create')).toMatchObject({
      draft: { website: VALID_URL },
    });
    expect(mockInvoke.lastArgsOf('entity_card_autobuild')).toEqual({
      project_id: newProjectId,
      domain: VALID_URL,
    });

    // ⑤ 抽出来的卡：每个字段都是「待确认」，值仍是种子里那份预置抽取结果
    const card = getDemoDb().entityCards.find((row) => row.project_id === newProjectId);
    expect(card, '新项目没有实体卡').toBeDefined();
    expect(new Set(Object.values(card?.field_status ?? {}))).toEqual(new Set(['pending']));
    expect(card?.fields.standard_name).toBe(SEED_ENTITY_CARDS[0].fields.standard_name);

    // 项目名用抽到的标准名回填：否则左侧清单里躺着一条叫 "demo-brand.example.com" 的项目
    expect(getDemoDb().projects.find((row) => row.id === newProjectId)?.name).toBe(
      SEED_ENTITY_CARDS[0].fields.standard_name,
    );
  });

  it('返回按钮回到模式选择屏（岔路口不许变成死路）', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: COPY.backToModes }));

    await waitFor(() => expect(pathname()).toBe('/projects/new'));
  });
});

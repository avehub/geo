/**
 * M5.5 站长数据页的**界面形态**测试（spec `2026-10-12-webmaster-data-integration-design.md`
 * §5.3 五段 + §9 走查 1…21）。
 *
 * # 🔴 为什么走 `mockInvoke` 桩而不是「演示假后端 + 真种子」
 * 存量页面测试（`SitePage.test.tsx` / `KeywordLibraryPage.test.tsx`）都 `vi.mock('../api/runtime')`
 * 走真 demo 后端。`search_*` 六条命令的 handler 与 `demo/seed/search-data.ts` 后来也在并行切片上
 * 落地了（差异台账 §4h E-67 起），但这一份仍然桩在 IPC 边界上，理由是**判据要手算得出来**：
 * 走查 10…13 钉的是"1800 / 90 / 5%（不是各源平均的 6%）"、"区间收敛到 40 天前那份并点名头条"
 * 这类**具体数字**，只有桩数据能把它钉死；换成真种子就变成了"渲染没崩"这种弱判据。
 * 页面与 compose 层跑的仍是真代码，桩数据也**手工算对**（照 §5.2 的种子自洽纪律）：
 * A 类求和、B 类重算、交集区间与旗标全部由 `api/search-compose.ts` 现算。
 * 真 demo 后端那一路由 `pages/en-us-page-residual.test.tsx` 那族守卫覆盖（整页无 CJK 泄漏）。
 *
 * # 这里钉的靶心（逐条对走查清单）
 * - 走查 2/3：三分组渲染 + 海外可达性常驻 + 站内分析"不参与曝光合计"常驻；二期源不渲染；
 *   `auth_mode: 'none'` 的源在侧滑里**看不到** OAuth 那一档（DR-93：不置灰，根本不渲染）；
 * - 走查 4/6：`demoBody` / `metricNote` / `staticNote` / `pasteNote` 四句**直接渲染**，
 *   断言它们的祖先链上没有 `.ant-tooltip`（藏进问号里就是本条要抓的回归）；
 * - 走查 10/11/12/13：合计行给出区间 + 参与源清单（可展开）+ 旗标；区间收敛到最早的
 *   `data_through` 并**点名**受限源；取消勾选一个平台 ⇒ 合计、CTR、区间三个当场重算；
 *   汇总 CTR 是重算值（5%）而不是各源 CTR 的算术平均（5.67% → 6%）；
 * - 走查 13/14：AI 面点击率的 tooltip 写"÷ 引用量"；C 类面板每项带平台徽章；
 * - 走查 6/15：粘贴是主按钮、导入是次按钮；6 张机会卡覆盖 6 条规则，采纳可翻，两个跳转入口
 *   分别落到文章管理与站点接入；
 * - 走查 18/21：`self_index_summary` 为 `null` 时是空态而不是抛错；状态卡上没有 CTR 曲线
 *   （自有索引没有点击，DR-118 末条）；后端缺命令时页面出 Alert 而不是白屏。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import { Route, Routes } from 'react-router-dom';

import WebmasterDataPage from './WebmasterDataPage';
import { MINIMUM_SAMPLE_SIZE, SELF_INDEX_RETENTION_DAYS } from '../api/constants';
import { catalogEntryOf } from '../api/search-catalog';
import type {
  SearchAiOverview,
  SearchBoardResult,
  SearchMetricImportResult,
  SearchNativeExtra,
  SearchOpportunity,
  SearchOpportunityStatus,
  SearchQueryMetric,
  SearchSource,
  SearchSourceKind,
  SelfIndexSnapshot,
  SearchTrafficShare,
} from '../api/types';
import { SEARCH_RULE_KEY_BY_ID } from '../api/types';
import { dateTimeText } from '../components/format';
import en from '../i18n/locales/en-US';
import zh from '../i18n/locales/zh-CN';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import { mockInvoke } from '../test/invoke-mock';
import { renderAtRoute, renderWithProviders } from '../test/render';

const PROJECT_ID = SEED_ACTIVE_PROJECT_ID;
const PATH = '/projects/:id/webmaster-data';
const ROUTE = `/projects/${PROJECT_ID}/webmaster-data`;

/** 演示数据的日期一律相对"今天"推：陈旧判定（`STALE_AFTER_DAYS`）依赖 `asOf` = 运行日。 */
const day = (offset: number) => dayjs().subtract(offset, 'day').format('YYYY-MM-DD');
/**
 * 区间起点。🔴 必须**早于**最早的那个 `data_through`（下面是 40 天前的头条）：
 * `resolveAggregateWindow` 遇到"起点晚于终点"会判成倒挂区间并返回**空窗口**，
 * 于是"收敛到交集并点名受限源"这条走查（第 11 条）就永远走不到（§5.2 的自洽纪律）。
 */
const PERIOD_START = day(60);
/** 百度两个源：最新的一份。 */
const THROUGH_BAIDU = day(7);
/** GSC：比百度早 3 天（§5.2 第 5 条：故意让收敛逻辑可被走查）。 */
const THROUGH_GSC = day(10);
/** 头条：40 天前 ⇒ 超过 `STALE_AFTER_DAYS`(35) 触发陈旧告警，同时它是区间末日的受限方。 */
const THROUGH_TOUTIAO = day(40);

const SITE_URL = 'https://lanzhou.example.com';

/**
 * 客户自己的流量来源分布（DR-111 `suggestSources` 的输入）。
 * 🔴 这三项是**这个站点**的来源分析结果，不是市场份额表：DR-111 明令禁止内置默认推荐
 * （同一时期百度份额有 38.1% 与 53.32% 两种口径，任何写死的假设都会在某个客户身上错得离谱）。
 * 数字与 `demo/seed/search-data.ts` 的 `SEED_SEARCH_TRAFFIC_SPLIT` 同口径（三项之和为 1）。
 */
const TRAFFIC_SPLIT: SearchTrafficShare[] = [
  { engine: 'baidu', share: 0.62 },
  { engine: 'google', share: 0.21 },
  { engine: 'toutiao', share: 0.17 },
];

function makeSource(kind: SearchSourceKind, overrides: Partial<SearchSource> = {}): SearchSource {
  const entry = catalogEntryOf(kind);
  return {
    id: `src-${kind}`,
    project_id: PROJECT_ID,
    kind,
    auth_mode: entry.auth_mode,
    ingest_modes: [...entry.ingest_modes],
    status: 'ready',
    region: entry.region,
    group: entry.group,
    binding: entry.binding_fields.length === 0 ? {} : { siteUrl: SITE_URL },
    credentials_state: entry.auth_mode === 'oauth' ? 'missing' : 'not_required',
    secret_ref: entry.auth_mode === 'oauth' ? `keyring://search/${kind}` : null,
    data_through: null,
    checked_at: null,
    check_detail: null,
    note: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function makeMetric(id: string, kind: SearchSourceKind, overrides: Partial<SearchQueryMetric> = {}): SearchQueryMetric {
  return {
    id,
    project_id: PROJECT_ID,
    source_kind: kind,
    surface: 'web_search',
    query: '',
    page_url: null,
    impressions: null,
    clicks: null,
    ctr: null,
    citations: null,
    ai_clicks: null,
    period_start: PERIOD_START,
    period_end: day(1),
    data_through: THROUGH_BAIDU,
    imported_at: '2026-10-01T00:00:00Z',
    completeness: 'full',
    window_source: 'platform',
    mapping_version: '2026-10-12.1',
    ...overrides,
  };
}

/**
 * 手算好的五行（§5.2 第 1 条：每行 `ctr == clicks / impressions`）：
 * 🔴 刻意**没有** `bing_wmt` 的指标行：Bing 在这一批数据里只有 C 类独有维度
 * （`Grounding Queries`），给它一行曝光 0 / 点击 0 会同时踩两条口径——DR-94 的
 * "用 0 顶替没有这一列"，以及把参与源从 3 个虚增成 4 个（合计行就要给不出账了）。
 * - `m-baidu` 与 `m-gsc` 是**同一个词面**（大小写不同）⇒ 按关键词透视时合并成一行"2 个平台"；
 * - `m-tongji` 是站内分析组：没有曝光列（§5.2 第 13 条），🔴 不得进 A 类合计，但要触发排除旗标；
 * - `m-ai` 是 AI 面：默认 `surface: 'web_search'` 的汇总里不出现，只喂 AI 引用表现那一段。
 *
 * 默认筛选下的期望：曝光 1000+500+300 = **1800**、点击 50+10+30 = **90**、
 * 重算 CTR = 90 ÷ 1800 = **5%**（各源 CTR 5% / 2% / 10% 的算术平均是 5.67% ⇒ 界面上不许出现 6%）。
 */
function makeMetrics(): SearchQueryMetric[] {
  return [
    makeMetric('m-baidu', 'baidu_ziyuan', {
      query: 'geo优化',
      page_url: `${SITE_URL}/geo`,
      impressions: 1000,
      clicks: 50,
      ctr: 0.05,
      data_through: THROUGH_BAIDU,
    }),
    makeMetric('m-gsc', 'gsc', {
      query: 'GEO优化',
      page_url: `${SITE_URL}/geo`,
      impressions: 500,
      clicks: 10,
      ctr: 0.02,
      data_through: THROUGH_GSC,
      completeness: 'sampled',
    }),
    makeMetric('m-toutiao', 'toutiao', {
      query: '布袋除尘器',
      page_url: `${SITE_URL}/products/bag-filter`,
      impressions: 300,
      clicks: 30,
      ctr: 0.1,
      data_through: THROUGH_TOUTIAO,
      completeness: 'partial',
    }),
    makeMetric('m-tongji', 'baidu_tongji', {
      query: '布袋除尘器',
      data_through: THROUGH_BAIDU,
    }),
    makeMetric('m-ai', 'baidu_ziyuan_ai', {
      surface: 'ai_answer',
      query: 'geo优化',
      impressions: 2000,
      citations: 40,
      ai_clicks: 8,
      data_through: THROUGH_BAIDU,
      completeness: 'partial',
      window_source: 'user_stated',
    }),
  ];
}

function makeOverview(): SearchAiOverview {
  return {
    id: 'ov-baidu',
    project_id: PROJECT_ID,
    source_kind: 'baidu_ziyuan_ai',
    citations: 40,
    // 全站 AI 曝光量与热门关键词切片的 2000 刻意不同：五项必须是同一份 summary 口径。
    ai_impressions: 6106,
    ai_clicks: 8,
    // §5.2 第 2 条：分母是**引用量**（8 ÷ 40 = 0.2），不是曝光量（8 ÷ 6106）。
    ai_ctr: 0.2,
    cited_pages: 6,
    period_start: PERIOD_START,
    period_end: day(1),
    data_through: THROUGH_BAIDU,
    imported_at: '2026-10-01T00:00:00Z',
    completeness: 'partial',
    window_source: 'user_stated',
    mapping_version: '2026-10-12.1',
  };
}

function makeExtras(): SearchNativeExtra[] {
  return [
    {
      id: 'nx-bing',
      project_id: PROJECT_ID,
      source_kind: 'bing_wmt',
      label: 'Grounding Queries',
      value: 12,
      metric_id: null,
      observed_at: '2026-10-01T00:00:00Z',
    },
    {
      id: 'nx-baidu',
      project_id: PROJECT_ID,
      source_kind: 'baidu_ziyuan',
      label: '平均排名',
      value: 3.2,
      metric_id: 'm-baidu',
      observed_at: '2026-10-01T00:00:00Z',
    },
  ];
}

function makeOpportunity(index: number, overrides: Partial<SearchOpportunity> = {}): SearchOpportunity {
  const ruleId = (index + 1) as SearchOpportunity['rule_id'];
  const key = SEARCH_RULE_KEY_BY_ID[ruleId];
  return {
    id: `opp-${index + 1}`,
    project_id: PROJECT_ID,
    rule_id: ruleId,
    title_key: `webmasterData.rules.${key}.name`,
    basis: `依据数字 ${index + 1}`,
    evidence_metric_ids: ['m-baidu', 'm-gsc'],
    prescription_category: 'site_structure',
    impact: 'high',
    difficulty: 'medium',
    confidence: 0.82,
    status: 'new',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

/** 6 条机会，每条规则恰好一条（§5.2 第 12 条）。 */
function makeOpportunities(): SearchOpportunity[] {
  return [0, 1, 2, 3, 4, 5].map((index) => makeOpportunity(index));
}

function makeBoard(overrides: Partial<SearchBoardResult> = {}): SearchBoardResult {
  return {
    as_of: day(0),
    sources: [
      makeSource('baidu_ziyuan_ai', { data_through: THROUGH_BAIDU }),
      makeSource('baidu_ziyuan', { data_through: THROUGH_BAIDU }),
      makeSource('toutiao', { data_through: THROUGH_TOUTIAO }),
      makeSource('gsc', { data_through: THROUGH_GSC }),
      makeSource('bing_wmt', { status: 'not_configured', credentials_state: 'missing' }),
      makeSource('baidu_tongji', { data_through: THROUGH_BAIDU }),
      makeSource('manual', { status: 'not_configured' }),
    ],
    metrics: makeMetrics(),
    ai_overviews: [makeOverview()],
    native_extras: makeExtras(),
    opportunities: makeOpportunities(),
    self_index_snapshots: [],
    self_index_summary: {
      engines_covered: 3,
      queries_covered: 12,
      last_run_at: '2026-10-12T02:18:00Z',
      rounds_covered: 4,
    },
    traffic_split: TRAFFIC_SPLIT,
    ...overrides,
  };
}

const EMPTY_IMPORT: SearchMetricImportResult = {
  metrics: [],
  ai_overviews: [],
  native_extras: [],
  errors: [],
  warnings: [],
  data_through: null,
};

/**
 * 桩住六条命令。🔴 `search_board` 与 `search_opportunity_update` **共享同一份可变 board**：
 * 翻完状态之后页面重取，桩要给出翻过的那一份（照 `EntityCardPage.test.tsx` 的有状态桩）。
 */
function stubBoard(board: SearchBoardResult = makeBoard()): SearchBoardResult {
  mockInvoke.stubAlways('search_board', () => structuredClone(board));
  mockInvoke.stubAlways('search_source_upsert', (args) =>
    makeSource(args.kind as SearchSourceKind, { note: (args.note as string | null) ?? null }),
  );
  mockInvoke.stubAlways('search_source_remove', () => []);
  mockInvoke.stubAlways('search_source_test', (args) =>
    makeSource(args.kind as SearchSourceKind, {
      checked_at: '2026-10-12T03:00:00Z',
      check_detail: '预置自检结论',
    }),
  );
  mockInvoke.stubAlways('search_metric_import_csv', () => structuredClone(EMPTY_IMPORT));
  mockInvoke.stubAlways('search_opportunity_update', (args) => {
    const row = board.opportunities.find((item) => item.id === args.opportunity_id);
    if (row === undefined) throw new Error('opportunity not found');
    row.status = args.status as SearchOpportunityStatus;
    return structuredClone(row);
  });
  mockInvoke.stubAlways('export_write_file', () => '/tmp/search-template.csv');
  return board;
}

function renderPage() {
  return renderAtRoute(<WebmasterDataPage />, PATH, ROUTE);
}

async function waitLoaded() {
  await screen.findByRole('heading', { name: zh.webmasterData.title });
  await screen.findByText('1,800');
}

/**
 * 按标题认卡片（口径逐字照 `SitePage.test.tsx` 的同名 helper）：
 * 找到 textContent 恰好等于标题、且自己不含嵌套卡片的那个节点，再往上取 `.ant-card`。
 */
function cardOf(title: string): HTMLElement {
  const node = [...document.querySelectorAll('.ant-card-head-title, .ant-typography, span, div')].find(
    (entry) => entry.textContent === title && entry.querySelector('.ant-card') === null,
  );
  expect(node, `找不到标题为「${title}」的卡片`).toBeDefined();
  const card = (node as HTMLElement).closest('.ant-card');
  expect(card, `「${title}」不在卡片里`).not.toBeNull();
  return card as HTMLElement;
}

/**
/**
 * 四句常驻说明的共同判据：在文档里、**看得见**、且祖先链上没有 `.ant-tooltip`。
 *
 * # 🔴 为什么不用 jest-dom 的 `toBeVisible`
 * 它把 `opacity: '0'` 也算不可见，而 antd 的 Modal 进场带 `ant-zoom-enter`
 * （cssinjs 写了 `opacity: 0` + `animation-fill-mode: both`），jsdom 不跑动画
 * ⇒ 弹窗里的常驻说明（`pasteNote` / `import.periodHint`）会恒假。
 *
 * # 🔴 为什么不用 `test/dropdown.ts` 的 `isClickable`
 * 它多判一条 `pointer-events`，而 antd 的 Drawer / Modal **根节点**正是靠
 * `pointer-events: none` 把点击让给遮罩、再由内容层打开 ⇒ 它会在第一个祖先上就把
 * 弹窗里的文案判死。"点不点得动"不是这条走查的靶心，"有没有被藏起来"才是。
 */
function expectPersistent(text: string) {
  const node = screen.getByText(text);
  expect(isOnScreen(node), '常驻说明不在可见层里').toBe(true);
  expect(node.closest('.ant-tooltip'), '常驻说明被藏进了 tooltip').toBeNull();
}

/** antd 弹层关闭态的类名形状（`ant-drawer-hidden` / `ant-select-dropdown-hidden` …）。 */
const HIDDEN_POPUP_CLASS = /(^|\s)[^\s]*-hidden(\s|$)/;

/** 祖先链上有没有任何一层把它藏起来（口径同 `test/dropdown.ts`，只少 `pointer-events` 那一条）。 */
function isOnScreen(node: Element | null): boolean {
  for (
    let current = node;
    current !== null && current.tagName !== 'BODY';
    current = current.parentElement
  ) {
    if (HIDDEN_POPUP_CLASS.test(current.getAttribute('class') ?? '')) return false;
    const style = window.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function filled(key: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
    key,
  );
}

/**
 * antd 会在**恰好两个** CJK 字符的按钮文案中间插一个空格（`配置` 渲染成 `配 置`），
 * 于是按字面量认按钮名会漏。既有口径见 `SitePage.test.tsx` 的 `/^保\s*存$/`；
 * 这里把它写成 helper，免得每处都手拼一个 `\s*`。
 */
function cjkName(label: string): RegExp {
  const body = [...label]
    .map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*');
  return new RegExp(`^${body}$`);
}

describe('WebmasterDataPage · 数据源三分组（走查 2 / 3）', () => {
  beforeEach(() => mockInvoke.reset());

  it('三段都渲染，海外组挂可达性提示、站内分析组挂"不参与曝光合计"', async () => {
    stubBoard();
    renderPage();
    await waitLoaded();

    expect(screen.getByText(zh.webmasterData.groups.webmaster_cn)).toBeInTheDocument();
    expect(screen.getByText(zh.webmasterData.groups.webmaster_global)).toBeInTheDocument();
    expect(screen.getByText(zh.webmasterData.groups.analytics)).toBeInTheDocument();
    expectPersistent(zh.webmasterData.regionNote);
    expectPersistent(zh.webmasterData.groupNotes.analytics);
    // 🔴 这一句是"量纲不可混"的护栏（DR-110 护栏 2）：说明文案必须自己说出"不参与曝光合计"，
    // 光有 `analytics` 这个组名不够。
    expect(screen.getByText(zh.webmasterData.groupNotes.analytics)).toHaveTextContent('不参与曝光合计');
  });

  it('二期源（搜狗 / 360）一个入口都不渲染', async () => {
    stubBoard();
    renderPage();
    await waitLoaded();

    expect(screen.queryByText(zh.webmasterData.sources.sogou)).toBeNull();
    expect(screen.queryByText(zh.webmasterData.sources.so_360)).toBeNull();
    // 对照组：一期源在场（否则上一条会因为"整面墙都没渲染"而假绿）。
    // 🔴 认在海外组那张卡**里面**：GSC 的译名同时出现在数据源墙与自动采集状态卡的
    // L2 令牌清单里（那张卡按 `auth_mode: 'oauth'` 逐个源报凭据态），全文找会撞成两个命中。
    const globalGroup = cardOf(zh.webmasterData.groups.webmaster_global);
    expect(within(globalGroup).getByText(zh.webmasterData.sources.gsc)).toBeInTheDocument();
  });

  it('新建项目没有任何源行时，点「配置」仍然能打开侧滑（不能要求先有一行才能建档）', async () => {
    const user = userEvent.setup();
    stubBoard(makeBoard({ sources: [], metrics: [], ai_overviews: [], native_extras: [], opportunities: [], self_index_summary: null, traffic_split: [] }));
    renderPage();
    await screen.findByRole('heading', { name: zh.webmasterData.title });

    const card = cardOf(zh.webmasterData.sources.baidu_ziyuan_ai);
    await user.click(
      within(card).getByRole('button', {
        name: cjkName(zh.webmasterData.sourceCards.configure),
      }),
    );

    expect(await screen.findByText(zh.webmasterData.sourceCards.drawerTitle)).toBeInTheDocument();
    expect(screen.getByText(zh.webmasterData.authModes.none)).toBeInTheDocument();
    expect(screen.getByLabelText(zh.webmasterData.sourceCards.siteUrl)).toBeInTheDocument();
  });

  it('新建项目没有源行时，粘贴弹窗仍能选到全部支持 paste_parse 的一期源', async () => {
    const user = userEvent.setup();
    stubBoard(makeBoard({ sources: [], metrics: [], ai_overviews: [], native_extras: [], opportunities: [], self_index_summary: null, traffic_split: [] }));
    renderPage();
    await screen.findByRole('heading', { name: zh.webmasterData.title });

    await user.click(screen.getAllByRole('button', { name: /粘贴后台表格/ })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox'));

    // 源卡片本身也在 DOM 里；下拉打开后同一个译名会多出现一次（选项）。
    expect(screen.getAllByText(zh.webmasterData.sources.gsc).length).toBeGreaterThan(1);
    expect(screen.getAllByText(zh.webmasterData.sources.baidu_ziyuan_ai).length).toBeGreaterThan(1);
  });

  it('陈旧判定用 search_board.as_of，不取系统今天（同一次会话可复算）', async () => {
    stubBoard(
      makeBoard({
        as_of: '2026-09-30',
        sources: [makeSource('baidu_ziyuan', { data_through: '2026-09-20' })],
      }),
    );
    renderPage();
    await screen.findByRole('heading', { name: zh.webmasterData.title });

    const card = cardOf(zh.webmasterData.sources.baidu_ziyuan);
    expect(within(card).queryByText(zh.webmasterData.staleTitle)).toBeNull();
  });

  it('auth_mode 为 none 的源在配置侧滑里看不到 OAuth 那一档（DR-93：不置灰，根本不渲染）', async () => {
    const user = userEvent.setup();
    stubBoard();
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.sources.baidu_ziyuan_ai);
    await user.click(
      within(card).getByRole('button', {
        name: cjkName(zh.webmasterData.sourceCards.configure),
      }),
    );

    expect(await screen.findByText(zh.webmasterData.sourceCards.drawerTitle)).toBeInTheDocument();
    expect(screen.getByText(zh.webmasterData.authModes.none)).toBeInTheDocument();
    expect(screen.queryByText(zh.webmasterData.authModes.oauth)).toBeNull();
    // 绑定值是非敏感的站点标识，凭据面一句常驻说明（规则 3）
    expect(screen.getByDisplayValue(SITE_URL)).toBeInTheDocument();
    // 可见标签不只是 aria-label：眼睛也要知道哪个框填站点地址。
    expect(screen.getByText(zh.webmasterData.sourceCards.siteUrl)).toBeInTheDocument();
    expectPersistent(zh.webmasterData.sourceCards.bindingHint);
  });

  it('oauth 源渲染凭据形态与钥匙串引用串，且演示模式不收凭据这句常驻', async () => {
    const user = userEvent.setup();
    stubBoard();
    renderPage();
    await waitLoaded();

    await user.click(
      within(cardOf(zh.webmasterData.sources.gsc)).getByRole('button', {
        name: cjkName(zh.webmasterData.sourceCards.configure),
      }),
    );

    expect(await screen.findByText(zh.webmasterData.authModes.oauth)).toBeInTheDocument();
    expect(screen.getByText('keyring://search/gsc')).toBeInTheDocument();
    expectPersistent(zh.webmasterData.sourceCards.demoCredentials);
  });
});

describe('WebmasterDataPage · 常驻说明与自动采集状态卡（走查 4 / 21）', () => {
  beforeEach(() => mockInvoke.reset());

  it('demoBody / metricNote / staticNote 三句直接渲染，不在问号 tooltip 里', async () => {
    stubBoard();
    renderPage();
    await waitLoaded();

    expectPersistent(zh.webmasterData.demoBody);
    expectPersistent(zh.webmasterData.metricNote);
    expectPersistent(zh.webmasterData.staticNote);
    expectPersistent(zh.webmasterData.trademarkNote);
  });

  it('状态卡给出最近运行 / 覆盖引擎数 / 覆盖 query 数，并常驻"没有 CTR 曲线"那句', async () => {
    stubBoard();
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.stats.title);
    expect(within(card).getByText(filled(zh.webmasterData.stats.engineCount, { total: 3 }))).toBeInTheDocument();
    expect(within(card).getByText(filled(zh.webmasterData.stats.queryCount, { total: 12 }))).toBeInTheDocument();
    expect(within(card).getByText(dateTimeText('2026-10-12T02:18:00Z'))).toBeInTheDocument();
    expect(within(card).getByText(filled(zh.webmasterData.selfIndex.rounds, { total: 4 }))).toBeInTheDocument();
    expect(within(card).getByText(filled(zh.webmasterData.selfIndex.retention, { days: SELF_INDEX_RETENTION_DAYS }))).toBeInTheDocument();
    // DR-118 末条：自有索引没有点击 ⇒ 这句必须常驻，界面上不许出现 CTR 曲线
    expect(within(card).getByText(zh.webmasterData.selfIndex.noCtr)).toBeInTheDocument();
    expect(card.querySelector('canvas, .echarts-for-react')).toBeNull();
    // L2 令牌状态：一期里三个 oauth 源（GSC / Bing / 百度统计）各报一次凭据态
    expect(within(card).getAllByText(zh.site.credentialsStates.missing)).toHaveLength(3);
  });

  it('self_index_summary 为 null 时是空态，不抛错', async () => {
    stubBoard(makeBoard({ self_index_summary: null }));
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.stats.title);
    expect(within(card).getByText(zh.webmasterData.stats.neverRun)).toBeInTheDocument();
  });
});

describe('WebmasterDataPage · 接入建议条（走查 5 / DR-111）', () => {
  beforeEach(() => mockInvoke.reset());

  it('已接入的源不再出现在建议里：只建议未接入的头条（17%），不重复建议百度 / GSC', async () => {
    stubBoard(
      makeBoard({
        sources: [makeSource('baidu_ziyuan'), makeSource('gsc')],
      }),
    );
    renderPage();
    await waitLoaded();

    const text = cardOf(zh.webmasterData.onboarding.title).textContent ?? '';

    expect(text).toContain('17%');
    expect(text).toContain(zh.webmasterData.sources.toutiao);
    expect(text).not.toContain(zh.webmasterData.sources.baidu_ziyuan);
    expect(text).not.toContain(zh.webmasterData.sources.gsc);
    expect(text).not.toContain('62%');
    expect(text).not.toContain('21%');
    expect(text).not.toContain(zh.webmasterData.onboarding.empty);
  });

  it('分布里的源已全部接入 ⇒ 显示 allConnected，不再建议任何平台', async () => {
    stubBoard();
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.onboarding.title);
    expect(within(card).getByText(zh.webmasterData.onboarding.allConnected)).toBeInTheDocument();
    expect(card.textContent ?? '').not.toMatch(/\d+%/);
  });

  it('没有流量分布 ⇒ 空态，且绝不退化成一份通用推荐（DR-111 的硬裁定）', async () => {
    stubBoard(makeBoard({ traffic_split: [] }));
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.onboarding.title);

    expect(within(card).getByText(zh.webmasterData.onboarding.empty)).toBeInTheDocument();
    // 一个占比都不许出现：内置推荐最典型的形状就是写死的"62% 百度"这类数字。
    expect(card.textContent ?? '').not.toMatch(/\d+%/);
  });
});

describe('WebmasterDataPage · 跨平台汇总（走查 10 / 11 / 12 / 13）', () => {
  beforeEach(() => mockInvoke.reset());

  it('A 类合计 + B 类重算 CTR：是 5% 而不是各源平均的 6%', async () => {
    stubBoard();
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.aggregate.title);
    expect(within(card).getByText('1,800')).toBeInTheDocument();
    expect(within(card).getByText('90')).toBeInTheDocument();
    expect(within(card).getByText('5%')).toBeInTheDocument();
    expect(within(card).queryByText('6%'), '汇总 CTR 不许是各源比率的算术平均').toBeNull();
    expectPersistent(zh.webmasterData.aggregate.ctrNote);
  });

  it('取消勾选到最后一个平台时不会把 [] 当成"全部源"（必须至少留一个）', async () => {
    const user = userEvent.setup();
    stubBoard();
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.aggregate.title);
    let checks = within(card).getAllByRole('checkbox');
    for (let index = 0; index < checks.length - 1; index += 1) {
      await user.click(checks[index]);
    }

    checks = within(card).getAllByRole('checkbox');
    expect((checks[checks.length - 1] as HTMLInputElement).checked).toBe(true);
    await user.click(checks[checks.length - 1]);

    const after = within(card).getAllByRole('checkbox') as HTMLInputElement[];
    expect(after.filter((checkbox) => checkbox.checked)).toHaveLength(1);
  });

  it('区间收敛到最早的 data_through 并点名受限源；旗标含陈旧 / 采样 / 站内分析被排除', async () => {
    stubBoard();
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.aggregate.title);
    expect(
      within(card).getByText(
        filled(zh.webmasterData.aggregate.windowLimited, {
          start: PERIOD_START,
          end: THROUGH_TOUTIAO,
          source: zh.webmasterData.sources.toutiao,
        }),
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        filled(zh.webmasterData.staleWarning, { through: THROUGH_TOUTIAO, days: 40 }),
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        filled(zh.webmasterData.sampledWarning, { source: zh.webmasterData.sources.gsc }),
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText(zh.webmasterData.aggregate.excludedAnalytics)).toBeInTheDocument();
    expect(within(card).getByText(zh.webmasterData.completenessNotes.partial)).toBeInTheDocument();
  });

  it('参与源清单可展开，每行给出平台 / 数据截至 / 完整性', async () => {
    const user = userEvent.setup();
    stubBoard();
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.aggregate.title);
    await user.click(within(card).getByRole('button', { name: zh.webmasterData.aggregate.participatingToggle }));

    expect(within(card).getByText(filled(zh.webmasterData.aggregate.participating, { total: 3 }))).toBeInTheDocument();
    expect(
      within(card).getByText(
        filled(zh.webmasterData.aggregate.participatingLine, {
          source: zh.webmasterData.sources.gsc,
          through: THROUGH_GSC,
          completeness: zh.webmasterData.completeness.sampled,
        }),
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        filled(zh.webmasterData.aggregate.participatingLine, {
          source: zh.webmasterData.sources.toutiao,
          through: THROUGH_TOUTIAO,
          completeness: zh.webmasterData.completeness.partial,
        }),
      ),
    ).toBeInTheDocument();
  });

  it('取消勾选一个平台 ⇒ 合计、CTR 与汇总区间当场重算（DR-112）', async () => {
    const user = userEvent.setup();
    stubBoard();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('checkbox', { name: zh.webmasterData.sources.toutiao }));

    const card = cardOf(zh.webmasterData.aggregate.title);
    await waitFor(() => expect(within(card).getByText('1,500')).toBeInTheDocument());
    expect(within(card).getByText('60')).toBeInTheDocument();
    expect(within(card).getByText('4%')).toBeInTheDocument();
    // 交集变了 ⇒ 受限方从头条换成 GSC
    expect(
      within(card).getByText(
        filled(zh.webmasterData.aggregate.windowLimited, {
          start: PERIOD_START,
          end: THROUGH_GSC,
          source: zh.webmasterData.sources.gsc,
        }),
      ),
    ).toBeInTheDocument();
    expect(
      within(card).queryByText(filled(zh.webmasterData.staleWarning, { through: THROUGH_TOUTIAO, days: 40 })),
      '陈旧旗标应随取消勾选一起消失',
    ).toBeNull();
    expectPersistent(zh.webmasterData.filters.recomputeHint);
  });

  it('切到 AI 回答面 ⇒ 合计换成 AI 面的数（跨面合计要显式选，DR-95）', async () => {
    stubBoard();
    renderPage();
    await waitLoaded();

    // 🔴 `fireEvent.click` 而不是 `user.click`：antd 的按钮式 Radio 把真正的 `<input>`
    // 藏在 `pointer-events: none` 底下，user-event 会拒绝落点（口径同 `ReportPage.test.tsx`）。
    fireEvent.click(screen.getByRole('radio', { name: zh.webmasterData.surfaces.ai_answer }));

    const card = cardOf(zh.webmasterData.aggregate.title);
    await waitFor(() => expect(within(card).getByText('2,000')).toBeInTheDocument());
    expect(within(card).getByText('40')).toBeInTheDocument();
    expectPersistent(zh.webmasterData.surfaceNote);
  });
});

describe('WebmasterDataPage · AI 引用表现与 C 类面板（走查 13 / 14）', () => {
  beforeEach(() => mockInvoke.reset());

  it('五项汇总卡都在，点击率的 tooltip 写明分母是引用量', async () => {
    const user = userEvent.setup();
    stubBoard();
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.aiOverview.title);
    expect(within(card).getByText('40')).toBeInTheDocument();
    expect(within(card).getByText('6,106')).toBeInTheDocument();
    expect(within(card).getByText('8')).toBeInTheDocument();
    expect(within(card).getByText('20%')).toBeInTheDocument();
    expect(within(card).getByText('6')).toBeInTheDocument();
    expect(within(card).getByText(zh.webmasterData.sources.baidu_ziyuan_ai)).toBeInTheDocument();
    expect(
      within(card).getByText(
        filled(zh.webmasterData.aiOverview.period, {
          start: PERIOD_START,
          end: day(1),
          through: THROUGH_BAIDU,
        }),
      ),
    ).toBeInTheDocument();

    await user.hover(within(card).getByText(zh.webmasterData.aiOverview.ctr));
    const note = await screen.findByText(zh.webmasterData.aiOverview.ctrNote);
    // 走查 13：tooltip 必须写明分母是**引用量**（不是曝光量），否则这个比率会被读成 CTR。
    expect(note).toHaveTextContent('引用量');
  });

  it('取消勾选一个平台 ⇒ AI 汇总卡与 C 类面板也一起收窄（不是只有合计在变）', async () => {
    const user = userEvent.setup();
    stubBoard();
    renderPage();
    await waitLoaded();

    const aggregateCard = cardOf(zh.webmasterData.aggregate.title);
    await user.click(
      within(aggregateCard).getByRole('checkbox', {
        name: zh.webmasterData.sources.baidu_ziyuan_ai,
      }),
    );

    const aiCard = cardOf(zh.webmasterData.aiOverview.title);
    await waitFor(() =>
      expect(within(aiCard).getByText(zh.webmasterData.aiOverview.empty)).toBeInTheDocument(),
    );

    // 再取消百度传统面 ⇒ 它的 C 类「平均排名」也消失；Bing 的 Grounding Queries 还在。
    await user.click(
      within(aggregateCard).getByRole('checkbox', {
        name: zh.webmasterData.sources.baidu_ziyuan,
      }),
    );
    const nativeCard = cardOf(zh.webmasterData.nativePanel.title);
    await waitFor(() => expect(within(nativeCard).queryByText('平均排名')).toBeNull());
    expect(within(nativeCard).getByText('Grounding Queries')).toBeInTheDocument();
  });

  it('L1 自有抽样与 L3 平台口径并排对账：无对照的引擎标「未经平台对账」', async () => {
    const snapshots: SelfIndexSnapshot[] = [
      {
        id: 'sis-baidu-ai',
        project_id: PROJECT_ID,
        kind: 'ai_citation',
        key: 'geo优化',
        engine: 'baidu_ai',
        surface: 'ai_answer',
        cited: true,
        cite_position_band: 'top3',
        rank_band: null,
        snippet_hash: null,
        title_hash: null,
        robots_ok: null,
        canonical_ok: null,
        schema_types: null,
        observed_at: '2026-10-01T00:00:00Z',
        round_id: 'round-1',
      },
      {
        id: 'sis-doubao',
        project_id: PROJECT_ID,
        kind: 'ai_citation',
        key: 'geo优化',
        engine: 'doubao',
        surface: 'ai_answer',
        cited: true,
        cite_position_band: 'top3',
        rank_band: null,
        snippet_hash: null,
        title_hash: null,
        robots_ok: null,
        canonical_ok: null,
        schema_types: null,
        observed_at: '2026-10-01T00:00:00Z',
        round_id: 'round-1',
      },
    ];
    stubBoard(makeBoard({ self_index_snapshots: snapshots }));
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.reconcile.sampleTitle);
    expect(within(card).getAllByText('geo优化').length).toBeGreaterThanOrEqual(2);
    expect(within(card).getByText(zh.webmasterData.reconcile.reconciled)).toBeInTheDocument();
    expect(within(card).getByText(zh.webmasterData.reconcile.notReconciled)).toBeInTheDocument();
  });

  it('C 类平台独有维度跟随时间筛选：切到近 7 天后，区间外的表级留档消失', async () => {
    const user = userEvent.setup();
    const extras = makeExtras().map((row) =>
      row.id === 'nx-bing' ? { ...row, observed_at: '2026-01-01T00:00:00Z' } : row,
    );
    stubBoard(makeBoard({ native_extras: extras }));
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.nativePanel.title);
    expect(within(card).getByText('Grounding Queries')).toBeInTheDocument();

    const aggregateCard = cardOf(zh.webmasterData.aggregate.title);
    await user.click(within(aggregateCard).getAllByRole('textbox')[0]);
    await user.click(await screen.findByText(zh.webmasterData.filters.presets.d7));

    await waitFor(() => expect(within(card).queryByText('Grounding Queries')).toBeNull());
    expect(within(card).getByText('平均排名')).toBeInTheDocument();
  });

  it('C 类平台独有维度逐项带平台徽章', async () => {
    stubBoard();
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.nativePanel.title);
    expect(within(card).getByText('Grounding Queries')).toBeInTheDocument();
    expect(within(card).getByText(zh.webmasterData.sources.bing_wmt)).toBeInTheDocument();
    expect(within(card).getByText('平均排名')).toBeInTheDocument();
    expect(within(card).getByText(zh.webmasterData.sources.baidu_ziyuan)).toBeInTheDocument();
    expectPersistent(zh.webmasterData.nativePanel.hint);
  });
});

describe('WebmasterDataPage · 对账区与密集表（走查 6 / 7 / 12）', () => {
  beforeEach(() => mockInvoke.reset());

  it('分区标题是对账语义；粘贴是主按钮、导入是次按钮', async () => {
    stubBoard();
    renderPage();
    await waitLoaded();

    const card = cardOf(zh.webmasterData.reconcile.title);
    expect(within(card).getByText(zh.webmasterData.metrics.title)).toBeInTheDocument();
    expectPersistent(zh.webmasterData.reconcile.hint);

    const paste = within(card).getByRole('button', { name: new RegExp(zh.webmasterData.import.pasteButton) });
    expect(paste.className).toContain('ant-btn-primary');
    const file = within(card).getByRole('button', { name: /导入 CSV/ });
    expect(file.className).not.toContain('ant-btn-primary');
  });

  it('按关键词透视：多源合并的行写明"2 个平台"，点击率是重算值', async () => {
    stubBoard();
    renderPage();
    await waitLoaded();

    // 2026-11-02：密集表默认收起（`metrics.expand`），先展开再断言行。
    fireEvent.click(screen.getByText(zh.webmasterData.metrics.expand));
    const card = cardOf(zh.webmasterData.reconcile.title);
    const row = within(card)
      .getAllByRole('row')
      .find((entry) => entry.textContent?.includes('geo优化'));
    expect(row, '关键词透视里找不到合并行').toBeDefined();
    expect(within(row as HTMLElement).getByText(filled(zh.webmasterData.metrics.multiPlatform, { total: 2 }))).toBeInTheDocument();
    // 计数与全站其他位置同一套千分位（P3 格式化统一）。
    expect(within(row as HTMLElement).getByText('1,500')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('4%')).toBeInTheDocument();
  });

  it('切到按平台透视 ⇒ 行首是平台译名，"N 个平台"标注随之消失', async () => {
    stubBoard();
    renderPage();
    await waitLoaded();

    fireEvent.click(screen.getByRole('radio', { name: zh.webmasterData.pivots.engine }));
    fireEvent.click(screen.getByText(zh.webmasterData.metrics.expand));

    const card = cardOf(zh.webmasterData.reconcile.title);
    await waitFor(() =>
      expect(
        within(card)
          .getAllByRole('row')
          .some((entry) => entry.textContent?.includes(zh.webmasterData.sources.gsc)),
      ).toBe(true),
    );
    expect(within(card).queryByText(filled(zh.webmasterData.metrics.multiPlatform, { total: 2 }))).toBeNull();
  });

  it('粘贴弹窗底部常驻 pasteNote，提交走 search_metric_import_csv 一条命令', async () => {
    const user = userEvent.setup();
    stubBoard();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('button', { name: new RegExp(zh.webmasterData.import.pasteButton) }));
    // 🔴 在弹窗**里面**认标题：`import.pasteTitle` 与主按钮文案逐字相同（都是"粘贴后台表格"），
    // 而数据源卡上那枚接入形态徽章也是这四个字 ⇒ 全文找会撞成多个命中。
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(zh.webmasterData.import.pasteTitle)).toBeInTheDocument();
    expectPersistent(zh.webmasterData.pasteNote);
    expectPersistent(zh.webmasterData.import.pasteHint);
    expectPersistent(zh.webmasterData.import.normalizeHint);

    const box = screen.getByLabelText(zh.webmasterData.import.pasteAria);
    fireEvent.change(box, { target: { value: '关键词\tAI引用量\ngeo优化\t12' } });
    await user.click(screen.getByRole('button', { name: new RegExp(zh.webmasterData.import.pasteRun) }));

    await waitFor(() => expect(mockInvoke.callsOf('search_metric_import_csv')).toHaveLength(1));
    const args = mockInvoke.lastArgsOf('search_metric_import_csv');
    expect(args?.project_id).toBe(PROJECT_ID);
    expect(args?.kind).toBe('baidu_ziyuan_ai');
    expect(args?.payload).toContain('geo优化');
    expect(args?.period_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(args?.period_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 桩回的是「零行、零错、零警告」⇒ 界面报 `emptyFile`（导入成功但合计不变），
    // 而不是 `done{total:0}`：走查 19 那条（空 xlsx）用的就是这一句。
    expect(await screen.findByText(zh.webmasterData.import.emptyFile)).toBeInTheDocument();
  });

  it('导入弹窗的模板下载走既有 export_write_file（不新增导出命令）', async () => {
    const user = userEvent.setup();
    stubBoard();
    renderPage();
    await waitLoaded();

    await user.click(screen.getByRole('button', { name: /导入 CSV/ }));
    expect(await screen.findByText(zh.webmasterData.import.fileTitle)).toBeInTheDocument();
    expectPersistent(zh.webmasterData.import.periodHint);

    await user.click(screen.getByRole('button', { name: new RegExp(zh.webmasterData.import.templateAi) }));
    await waitFor(() => expect(mockInvoke.callsOf('export_write_file')).toHaveLength(1));
    expect(String(mockInvoke.lastArgsOf('export_write_file')?.content)).toContain('citations');
  });
});

describe('WebmasterDataPage · 优化机会（走查 15）', () => {
  beforeEach(() => mockInvoke.reset());

  it('6 张卡覆盖 6 条规则，staticNote 与样本量门槛常驻', async () => {
    stubBoard();
    renderPage();
    await waitLoaded();

    for (const key of Object.values(SEARCH_RULE_KEY_BY_ID)) {
      expect(screen.getByText(zh.webmasterData.rules[key].name)).toBeInTheDocument();
    }
    expectPersistent(zh.webmasterData.opportunity.demoStatic);
    expectPersistent(filled(zh.webmasterData.opportunity.sampleGate, { min: MINIMUM_SAMPLE_SIZE }));
  });

  it('采纳 ⇒ 翻状态并在卡上显示已采纳', async () => {
    const user = userEvent.setup();
    const board = stubBoard();
    renderPage();
    await waitLoaded();

    const first = cardOf(zh.webmasterData.rules.high_impression_low_ctr.name);
    await user.click(
      within(first).getByRole('button', { name: cjkName(zh.webmasterData.opportunity.adopt) }),
    );

    await waitFor(() => expect(mockInvoke.callsOf('search_opportunity_update')).toHaveLength(1));
    expect(mockInvoke.lastArgsOf('search_opportunity_update')).toEqual({
      opportunity_id: board.opportunities[0].id,
      status: 'adopted',
    });
    expect(await screen.findByText(zh.webmasterData.opportunity.statuses.adopted)).toBeInTheDocument();
  });

  it('「转为文章方向」与「生成补丁」分别落到文章管理与站点接入', async () => {
    const user = userEvent.setup();
    stubBoard();
    renderWithProviders(
      <Routes>
        <Route path={PATH} element={<WebmasterDataPage />} />
        <Route path="/projects/:id/articles" element={<span data-testid="at-articles" />} />
        <Route path="/projects/:id/site" element={<span data-testid="at-site" />} />
      </Routes>,
      { route: ROUTE },
    );
    await screen.findByRole('heading', { name: zh.webmasterData.title });
    await screen.findByText('1,800');

    await user.click(screen.getAllByRole('button', { name: new RegExp(zh.webmasterData.opportunity.toArticle) })[0]);
    expect(await screen.findByTestId('at-articles')).toBeInTheDocument();
  });

  it('「生成补丁」跳到站点接入', async () => {
    const user = userEvent.setup();
    stubBoard();
    renderWithProviders(
      <Routes>
        <Route path={PATH} element={<WebmasterDataPage />} />
        <Route path="/projects/:id/articles" element={<span data-testid="at-articles" />} />
        <Route path="/projects/:id/site" element={<span data-testid="at-site" />} />
      </Routes>,
      { route: ROUTE },
    );
    await screen.findByRole('heading', { name: zh.webmasterData.title });
    await screen.findByText('1,800');

    await user.click(screen.getAllByRole('button', { name: new RegExp(zh.webmasterData.opportunity.toPatch) })[0]);
    expect(await screen.findByTestId('at-site')).toBeInTheDocument();
  });
});

describe('WebmasterDataPage · 降级与双语（走查 17 / 18）', () => {
  beforeEach(() => mockInvoke.reset());

  it('后端缺命令时出 Alert（桌面端的预期行为），不白屏', async () => {
    mockInvoke.stubAlways(
      'search_board',
      { code: 'ipc/unknown_command', params: { cmd: 'search_board' }, message: '' },
      'reject',
    );
    renderPage();

    expect(await screen.findByText(zh.webmasterData.loadFailed)).toBeInTheDocument();
    expect(screen.getByText('不支持的操作：search_board')).toBeInTheDocument();
  });

  it('切 English：页面骨架文案全部走词典', async () => {
    stubBoard();
    renderAtRoute(<WebmasterDataPage />, PATH, ROUTE, 'en-US');

    expect(await screen.findByRole('heading', { name: en.webmasterData.title })).toBeInTheDocument();
    expect(screen.getByText(en.webmasterData.aggregate.title)).toBeInTheDocument();
    expect(screen.getByText(en.webmasterData.reconcile.title)).toBeInTheDocument();
    expect(screen.getByText(en.webmasterData.groups.webmaster_global)).toBeInTheDocument();
    // 🔴 用 `aggregate.ctr` 而不是 `aggregate.impressions`：en 侧后者与表头
    // `metrics.columns.impressions` 逐字同为 'Impressions'，`getByText` 会撞成两个命中。
    expect(screen.getByText(en.webmasterData.aggregate.ctr)).toBeInTheDocument();
  });
});

/**
 * 手动控制 resolve 的 Promise：用来把 `search_board` 按在 pending 态上。
 * `mockInvoke` 的 handler 返回值会被 `Promise.resolve(...)` 包一层，所以返回这个
 * promise 就等于"这条 IPC 还没回"。
 */
/** 只做字面量转义、不锚定：用于「图标 + 文案」这类无障碍名里含前缀的按钮。 */
function looseName(label: string): RegExp {
  return new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * P3 切片 D：board 还没回来时，三个取数入口必须禁用。
 *
 * # 为什么这是 bug 而不是体验瑕疵
 * 粘贴 / 导入弹窗的默认区间从 `board.as_of` 推导（P2 定稿：不取系统日期）。board 未到时
 * 页面只有 `dayjs()` 兜底，此时放行就会让弹窗默认区间落在**系统今天**，与页面锚点不一致。
 * 「配置」按钮同理：人工填报也走同一套默认区间。
 */
describe('WebmasterDataPage · 加载期取数入口（P3 · board 锚点未就绪）', () => {
  beforeEach(() => mockInvoke.reset());

  it('board 未返回时粘贴 / 导入 / 配置都禁用，返回后恢复可用', async () => {
    const gateway = deferred<SearchBoardResult>();
    mockInvoke.stubAlways('search_board', () => gateway.promise);
    renderPage();

    await screen.findByRole('heading', { name: zh.webmasterData.title });

    // 🔴 不锚定首尾：这两个按钮带 antd 图标（`<span role="img" aria-label="snippets">`），
    // 无障碍名是「图标名 + 文案」，锚定正则反而找不到控件。
    const ingestButtons = () => [
      screen.getByRole('button', { name: looseName(zh.webmasterData.import.pasteButton) }),
      screen.getByRole('button', { name: looseName(zh.webmasterData.import.fileButton) }),
    ];
    const configureButtons = () =>
      screen.getAllByRole('button', { name: cjkName(zh.webmasterData.sourceCards.configure) });

    // 控件确实渲染了：否则下面的 disabled 断言会因为"根本没渲染"而假绿。
    expect(configureButtons().length).toBeGreaterThan(0);
    for (const button of [...ingestButtons(), ...configureButtons()]) {
      expect(button).toBeDisabled();
    }

    gateway.resolve(makeBoard());
    await waitLoaded();

    for (const button of [...ingestButtons(), ...configureButtons()]) {
      expect(button).toBeEnabled();
    }
  });
});

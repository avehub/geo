/**
 * demo 的内存库：从静态种子深拷一份，**刷新即重置**（简报 §B-2 / §B-4）。
 *
 * - `createDemoDb()`：纯函数式的重建，每次返回一份**互不共享引用**的新数据；
 * - `getDemoDb()`：进程内单例（懒建），handler 一律经它拿库；
 * - `resetDemoDb()`：把单例换成新建的一份 ⇒ 「刷新即重置」的语义落点，
 *   测试的 `afterEach` 也要调它，否则用例之间会串味。
 *
 * 深拷用 `structuredClone`（jsdom / node 下都可用，`src/test/invoke-mock.ts` 已在用）：
 * 直接把种子对象交出去的话，handler 的第一次写操作就会**永久改掉种子模块**，
 * 于是"刷新即重置"变成"第一次改完就再也回不去了"。
 *
 * ⚠ 题库在库里有**两份视图**（`promptItems` 归一化 + `promptSets[].items` 内嵌副本），
 * `structuredClone` 会切断它们的引用共享 ⇒ Task 12 的 handler 改条目时必须同时更新两处，
 * 或以 `promptItems` 为真值重组。详见 `types.ts` 的 `DemoDb` 注释。
 */
import type { DemoDb } from './types';
import type {
  ActionItem,
  AlertItem,
  AnswerInsight,
  Article,
  ArticleDirection,
  ArticleSchedule,
  ArticleTemplate,
  CollectionRecordDetail,
  CollectionRound,
  CollectionTask,
  Competitor,
  EntityCard,
  EntityCardRevision,
  FactCheckIssue,
  FaqItem,
  GeneratedContent,
  KbEntry,
  KbEntryRevision,
  KeywordItem,
  Project,
  ProjectAsset,
  PromptItem,
  PromptSet,
  SearchAiOverview,
  SearchNativeExtra,
  SearchOpportunity,
  SearchQueryMetric,
  SearchSource,
  SearchSourceKind,
  SearchTrafficShare,
  SelfIndexSnapshot,
  SiteChannel,
  SiteChannelKind,
  SitePatch,
  SitePatchEvent,
  SiteProfile,
} from '../api/types';
// 通道排序要按**清单序**（bundle → cms → edge → repo）⇒ 这里需要值而不只是类型。
// 数据源排序同理：按 `SEARCH_SOURCE_VALUES` 的目录序（DR-92 的枚举序 == 三分组的视觉权重序）。
import { SEARCH_SOURCE_VALUES, SITE_CHANNEL_KIND_VALUES } from '../api/types';
import { SEED_COLLECTION_RECORDS } from './seed/collection-records-retest';
import { SEED_COLLECTION_ROUNDS, SEED_COLLECTION_TASKS } from './seed/collection-rounds';
import { SEED_ACTIONS } from './seed/actions';
import {
  SEED_ARTICLES,
  SEED_ARTICLE_DIRECTIONS,
  SEED_ARTICLE_SCHEDULES,
  SEED_ARTICLE_TEMPLATES,
} from './seed/articles';
import { SEED_GENERATED_CONTENTS } from './seed/contents';
import { SEED_ALERTS } from './seed/diagnosis';
import { SEED_ENTITY_CARD_REVISIONS, SEED_ENTITY_CARDS } from './seed/entity-cards';
import { SEED_FAQS } from './seed/faqs';
import { SEED_KB_ENTRIES, SEED_KB_REVISIONS } from './seed/kb';
import { SEED_KEYWORDS } from './seed/keywords';
import { SEED_ANSWER_INSIGHTS, SEED_FACT_CHECK_ISSUES } from './seed/insights';
import { SEED_ASSETS, SEED_COMPETITORS, SEED_PROJECTS } from './seed/projects';
import { SEED_PROMPT_ITEMS, SEED_PROMPT_SETS } from './seed/prompt-sets';
import {
  SEED_SEARCH_AI_OVERVIEWS,
  SEED_SEARCH_NATIVE_EXTRAS,
  SEED_SEARCH_OPPORTUNITIES,
  SEED_SEARCH_QUERY_METRICS,
  SEED_SEARCH_SOURCES,
  SEED_SEARCH_TRAFFIC_SPLIT,
  SEED_SELF_INDEX_SNAPSHOTS,
} from './seed/search-data';
import { SEED_SETTINGS } from './seed/settings';
import {
  SEED_SITE_CHANNELS,
  SEED_SITE_PATCH_EVENTS,
  SEED_SITE_PATCHES,
  SEED_SITE_PROFILE,
} from './seed/site';

/**
 * 钥匙串引用串：`keyring://llm/<provider 稳定 id>`。
 *
 * 与后端同形（`apps/desktop/src-tauri/src/services/settings_service.rs` 的 `SECRET_KIND = "llm"`
 * + `secret_ref(...)`），且**无论 `configured` 真假都返回这个 ref**（`configured` 只表示
 * 钥匙串里有没有值）。纯函数、ASCII、同输入同输出（§B-4 / §B-11）。
 *
 * ⚠ AGENTS 规则 3：库里只许有这个**引用串**，绝不含任何形如 API Key 的值。
 */
export function demoSecretRef(provider: string): string {
  return `keyring://llm/${provider}`;
}

/**
 * 站点通道的钥匙串引用串：`keyring://site/<kind>/<project_id>`。
 *
 * 与 `demoSecretRef` 同一条纪律（纯函数、ASCII、同输入同输出、**只造引用串不装值**），
 * 只是 `SECRET_KIND` 从 `"llm"` 换成 `"site"`：站点通道要存的是 WordPress 应用程序密码
 * 或边缘平台的部署 token，与模型 Key 是两类东西，混在一个 kind 下会互相覆盖。
 *
 * 🔴 真后端的 `secret_set` 今天**只认 `provider`**（`settings_service.rs` 的 `SECRET_KIND = "llm"`）
 * ⇒ 这一族引用串在 Rust 侧还没有落点，已登记为差异 E-56。
 */
export function demoSiteSecretRef(kind: string, projectId: string): string {
  return `keyring://site/${kind}/${projectId}`;
}

/** 从种子重建一份全新的库。 */
export function createDemoDb(): DemoDb {
  return structuredClone({
    projects: SEED_PROJECTS,
    competitors: SEED_COMPETITORS,
    assets: SEED_ASSETS,
    entityCards: SEED_ENTITY_CARDS,
    revisions: SEED_ENTITY_CARD_REVISIONS,
    promptSets: SEED_PROMPT_SETS,
    promptItems: SEED_PROMPT_ITEMS,
    settings: SEED_SETTINGS,
    // 档案制（provider profiles）是 Plan B/C 的契约，本轮刻意不造形状（简报 §B-10）⇒ 留空。
    profiles: [],
    // 12 个内置服务商（7 个来自 Rust 真值源 + 5 家中转站，DR-33）各一条「未配置」状态：
    // 形状与 secret_ref 都照后端真值源，
    // Task 14 的 secret_set / secret_status / secret_delete 只需在这份数组上翻 configured。
    secrets: SEED_SETTINGS.providers.map((info) => ({
      provider: info.provider,
      configured: false,
      secret_ref: demoSecretRef(info.provider),
    })),

    // ---- M3–M7：只拷「有写路径」的那几张表（静态聚合留在 seed/**，见 DemoDb 注释）----
    collectionRounds: SEED_COLLECTION_ROUNDS,
    collectionTasks: SEED_COLLECTION_TASKS,
    // ⚠ 不含 `SEED_RETRY_OUTCOMES`：那 6 条是**重跑之后**才存在的证据，
    // 初始库里没有它们，才能让「失败 → 重跑 → 证据出现」这条链路在界面上看得见变化。
    collectionRecords: SEED_COLLECTION_RECORDS,
    // 同理不含 `SEED_RETRY_INSIGHTS`（`seed/insights.ts` 已把它们从 SEED_ANSWER_INSIGHTS 里滤掉）。
    insights: SEED_ANSWER_INSIGHTS,
    factIssues: SEED_FACT_CHECK_ISSUES,
    alerts: SEED_ALERTS,
    actions: SEED_ACTIONS,
    contents: SEED_GENERATED_CONTENTS,

    // ---- M1.5 素材层：两张**有写路径**的表（生成池刻意不进来，见 DemoDb 注释）----
    keywords: SEED_KEYWORDS,
    faqs: SEED_FAQS,

    // ---- M6.5 站点接入：四张**有写路径**的表 ----
    // 🔴 页面清单（`SEED_SITE_PAGES`）与通道自检结论（`SEED_SITE_CHANNEL_PROBES`）刻意不进来：
    // 前者是"爬出来的东西"的替身、后者是"探测结果"的替身，demo 既不爬也不探测（规则 9 / 规则 2）。
    siteProfiles: [SEED_SITE_PROFILE],
    siteChannels: SEED_SITE_CHANNELS,
    sitePatches: SEED_SITE_PATCHES,
    sitePatchEvents: SEED_SITE_PATCH_EVENTS,

    // ---- M1.2 知识库：只有**落库条目**这一张表 ----
    // 🔴 同步块（实体卡 / 项目信息的投影）刻意不进来：它由 `handlers/kb.ts` 每次 `kb_board`
    // 现场算（spec 2026-10-01 · DR-67）。生成池 `SEED_KB_GENERATED_POOL` 同样不进来
    // （与 `SEED_KEYWORD_GENERATED_POOL` 同一条理由：要让"点生成 → 库里多出来"看得见）。
    kbEntries: SEED_KB_ENTRIES,
    // 修订留痕（DR-119）：与 `revisions`（实体卡留痕）同族的一张**只追加**表。
    kbRevisions: SEED_KB_REVISIONS,

    // ---- M6 文章管理：四张**有写路径**的表 ----
    // 🔴 两个预置语料池（`SEED_ARTICLE_DIRECTION_POOL` / `SEED_ARTICLE_POOL`）刻意不进来：
    // 它们是「AI 生成」的替身，要让"点生成 → 库里多出来"在界面上看得见（规则 9 / DR-85）。
    articleDirections: SEED_ARTICLE_DIRECTIONS,
    articleTemplates: SEED_ARTICLE_TEMPLATES,
    articleSchedules: SEED_ARTICLE_SCHEDULES,
    articles: SEED_ARTICLES,

    // ---- M5.5 站长数据：六张表（写路径密度逐张写在 DemoDb 注释里）----
    // 🔴 一个静态表刻意不进来：`SEED_SEARCH_SOURCE_PROBES`（自检结论，`search_source_test`
    // 不联网 ⇒ 逐字端出来，规则 2 / DR-99）——与 `SEED_SITE_CHANNEL_PROBES` 同一条裁定。
    searchSources: SEED_SEARCH_SOURCES,
    searchMetrics: SEED_SEARCH_QUERY_METRICS,
    searchAiOverviews: SEED_SEARCH_AI_OVERVIEWS,
    searchNativeExtras: SEED_SEARCH_NATIVE_EXTRAS,
    searchOpportunities: SEED_SEARCH_OPPORTUNITIES,
    // 🔴 本轮**只读**（DR-118：命令面不加，写路径寄生 `collection_*`）。进库而不留在 seed/**，
    // 是为了让 `search_board` 的 `self_index_summary` 有一个可聚合的真值，而不是现算一份静态数字。
    selfIndexSnapshots: SEED_SELF_INDEX_SNAPSHOTS,
    // 🔴 本轮**只读**（DR-111：接入建议的唯一输入，真后端由百度统计的来源分析算出）。
    // 进库是为了让"这个项目有没有分布"有一个真值：归档项目没有行 ⇒ 回空数组 ⇒ 界面显示空态，
    // 而不是替它编一份通用推荐。
    searchTrafficSplit: SEED_SEARCH_TRAFFIC_SPLIT,
  });
}

let db: DemoDb | null = null;

/** 进程内单例；第一次调用时从种子建。 */
export function getDemoDb(): DemoDb {
  db ??= createDemoDb();
  return db;
}

/** 丢弃当前库、按种子重建（页面刷新 / 测试复位）。 */
export function resetDemoDb(): void {
  db = createDemoDb();
}

// ---------------------------------------------------------------------------
// 只读派生 helper（Task 12 · 简报 §B-12）
// ---------------------------------------------------------------------------
//
// 🔴 **这里是「题库两份视图谁是真值」的唯一裁定点。**
// `DemoDb` 里题库有两份视图：`promptItems`（归一化，靠 `set_id` 归属）与
// `promptSets[].items`（DTO 要求的内嵌副本），`createDemoDb()` 的 `structuredClone`
// 已经**切断**两者的引用共享。裁定：
// - **set 级**（有几份题库、挂在哪个项目下）真值 = `db.promptSets`；
// - **item 级**（一份题库里有哪些条目）真值 = `db.promptItems`；内嵌副本只服务 DTO 形状。
// 于是「读一份完整题库」= `promptSetWithItems()`：set 级取自 `promptSets`、items 取自
// `promptItems`。M1 的 handler 一律经这几个 helper 读，**不许**各写各的过滤——
// 那正是复审警告的「每个改动点都要手动同步两处」。
// ⚠ 真正把两份视图合并成单一真值归 Task 13（它拥有 prompt 的写路径）；本轮只读不合并，
// 但 helper 的形状就是给 Task 13 直接复用的。
//
// 排序一律照仓储层的 `ORDER BY`（真值源见每个 helper 的注释），因为界面看到的顺序
// 就是后端给的顺序；`filter` 已经复制过数组，所以 `sort` 就地排不会动到库里的顺序。

/** `repo/project.rs`：按 id 取一行。 */
export function projectById(db: DemoDb, id: string): Project | undefined {
  return db.projects.find((project) => project.id === id);
}

/** `repo/competitor.rs`：`ORDER BY position ASC, id ASC`。 */
export function competitorsOf(db: DemoDb, projectId: string): Competitor[] {
  return db.competitors
    .filter((row) => row.project_id === projectId)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

/** `repo/asset.rs`：`ORDER BY created_at ASC, id ASC`。 */
export function assetsOf(db: DemoDb, projectId: string): ProjectAsset[] {
  return db.assets
    .filter((row) => row.project_id === projectId)
    .sort(
      (left, right) =>
        ascending(left.created_at, right.created_at) || left.id.localeCompare(right.id),
    );
}

/** `repo/entity_card.rs` 的 `get()`：没有卡就是没有卡（`Option`，不是 not_found）。 */
export function entityCardOf(db: DemoDb, projectId: string): EntityCard | undefined {
  return db.entityCards.find((card) => card.project_id === projectId);
}

/** `repo/entity_card.rs` 的 `revisions()`：`ORDER BY edited_at DESC, rowid DESC`（新的在前）。 */
export function revisionsOf(db: DemoDb, projectId: string): EntityCardRevision[] {
  return db.revisions
    .map((revision, index) => ({ revision, index }))
    .filter((entry) => entry.revision.project_id === projectId)
    .sort(
      (left, right) =>
        descending(left.revision.edited_at, right.revision.edited_at) || right.index - left.index,
    )
    .map((entry) => entry.revision);
}

/** **set 级真值**：`repo/prompt_set.rs` 的 `list_by_project`（`ORDER BY version DESC, created_at DESC`）。 */
export function promptSetsOf(db: DemoDb, projectId: string): PromptSet[] {
  return db.promptSets
    .filter((set) => set.project_id === projectId)
    .sort(
      (left, right) =>
        right.version - left.version || descending(left.created_at, right.created_at),
    );
}

/** **item 级真值**：`repo/prompt_set.rs` 的条目查询（`ORDER BY position ASC, rowid ASC`）。 */
export function promptItemsOf(db: DemoDb, setId: string): PromptItem[] {
  return db.promptItems
    .filter((item) => item.set_id === setId)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

/**
 * 把「set 级真值 + item 级真值」拼成 DTO 要求的形状（`PromptSet.items` 内嵌）。
 * `project_export` 走它，所以导出的题库**永远**与归一化视图一致，不会带上过期的内嵌副本。
 */
export function promptSetWithItems(db: DemoDb, set: PromptSet): PromptSet {
  return { ...set, items: promptItemsOf(db, set.id) };
}

/** `ProjectDetail.prompt_set_count`：只数 set 级真值。 */
export function promptSetCountOf(db: DemoDb, projectId: string): number {
  return promptSetsOf(db, projectId).length;
}

// ---------------------------------------------------------------------------
// M1.5 素材层的只读派生 helper（spec 2026-09-30 §6）
// ---------------------------------------------------------------------------
//
// 排序口径与 `promptItemsOf` 一致（`position ASC, id ASC`）：素材库在真后端也会是一张
// 按 `position` 排序的表，界面看到的顺序就是后端给的顺序。Plan C 落库时若改用别的
// `ORDER BY`，改这两个 helper 就够了——handler 一律经它们读，不许各写各的 filter。

/** 关键词素材：`ORDER BY position ASC, id ASC`。 */
export function keywordsOf(db: DemoDb, projectId: string): KeywordItem[] {
  return db.keywords
    .filter((row) => row.project_id === projectId)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

/** FAQ 素材：`ORDER BY position ASC, id ASC`。 */
export function faqsOf(db: DemoDb, projectId: string): FaqItem[] {
  return db.faqs
    .filter((row) => row.project_id === projectId)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

/**
 * 知识条目：`ORDER BY position ASC, id ASC`（口径与 `keywordsOf` / `faqsOf` 一致）。
 *
 * 🔴 这里**只有落库的那一半**：同步块不落库，由 `handlers/kb.ts` 的 `projectSyncedBlocks`
 * 现场投影（spec 2026-10-01 · DR-66 / DR-67）⇒ 「实体卡改了知识库跟着变」不需要刷新协议。
 */
export function kbEntriesOf(db: DemoDb, projectId: string): KbEntry[] {
  return db.kbEntries
    .filter((row) => row.project_id === projectId)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

/**
 * 知识条目的修订留痕：`ORDER BY edited_at DESC, rowid DESC`（新的在前，与 `revisionsOf` 同口径）。
 *
 * 🔴 返回**全项目**的留痕，不按 `entry_id` 过滤：读出口寄生在 `kb_board` 上（DR-119），
 * 一次拿全，界面在编辑侧滑里自己筛当前那条——省掉一条命令，也省掉"改完还要再拉一次历史"的往返。
 */
export function kbRevisionsOf(db: DemoDb, projectId: string): KbEntryRevision[] {
  return db.kbRevisions
    .map((revision, index) => ({ revision, index }))
    .filter((entry) => entry.revision.project_id === projectId)
    .sort(
      (left, right) =>
        descending(left.revision.edited_at, right.revision.edited_at) || right.index - left.index,
    )
    .map((entry) => entry.revision);
}

// ---------------------------------------------------------------------------
// M3–M7 的只读派生 helper
// ---------------------------------------------------------------------------
//
// 与上面那批同一个纪律：**排序与过滤只在这里写一次**，handler 不许各写各的 `filter`。
// 真后端这几张表的 `ORDER BY` 还不存在（M3–M7 尚未落 Rust），所以这里的顺序是
// demo 侧的**裁定**，判据写在每个 helper 的注释里；等后端落地时以这份顺序为对齐目标，
// 差异登记进 `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`。
// `filter` 已经复制过数组 ⇒ 就地 `sort` 不会动到库里的顺序。

/** 采集轮次：按轮次序号升序（界面上「第 1 轮 → 第 4 轮」的时间顺序）。 */
export function roundsOf(db: DemoDb, projectId: string): CollectionRound[] {
  return db.collectionRounds
    .filter((round) => round.project_id === projectId)
    .sort(
      (left, right) => left.round_index - right.round_index || left.id.localeCompare(right.id),
    );
}

/** 按 id 取一轮；不存在返回 `undefined`（是不是 `not_found` 由 handler 裁定）。 */
export function roundById(db: DemoDb, roundId: string): CollectionRound | undefined {
  return db.collectionRounds.find((round) => round.id === roundId);
}

/** 队列任务：`queued_at ASC, id ASC`（任务中心的自然顺序＝入队顺序）。 */
export function tasksOf(db: DemoDb, roundId: string): CollectionTask[] {
  return db.collectionTasks
    .filter((task) => task.round_id === roundId)
    .sort(
      (left, right) => ascending(left.queued_at, right.queued_at) || left.id.localeCompare(right.id),
    );
}

/** 按 id 取一条队列任务。 */
export function taskById(db: DemoDb, taskId: string): CollectionTask | undefined {
  return db.collectionTasks.find((task) => task.id === taskId);
}

/** 原始证据：`collected_at ASC, id ASC`（证据列表按采集时间正序，便于顺着轮次读）。 */
export function recordsOf(db: DemoDb, roundId: string): CollectionRecordDetail[] {
  return db.collectionRecords
    .filter((record) => record.round_id === roundId)
    .sort(
      (left, right) =>
        ascending(left.collected_at, right.collected_at) || left.id.localeCompare(right.id),
    );
}

/** 按 id 取一条证据。 */
export function recordById(db: DemoDb, recordId: string): CollectionRecordDetail | undefined {
  return db.collectionRecords.find((record) => record.id === recordId);
}

/** 解析结果：`id ASC`（种子 id 是 `demo-ins-<round>-NNN`，字典序即证据顺序）。 */
export function insightsOf(db: DemoDb, roundId: string): AnswerInsight[] {
  return db.insights
    .filter((insight) => insight.round_id === roundId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** 按 id 取一条解析结果。 */
export function insightById(db: DemoDb, insightId: string): AnswerInsight | undefined {
  return db.insights.find((insight) => insight.id === insightId);
}

/** 事实核查问题：`id ASC`（`demo-fc-NNN`，字典序即种子里的编排顺序）。 */
export function factIssuesOf(db: DemoDb, roundId: string): FactCheckIssue[] {
  return db.factIssues
    .filter((issue) => issue.round_id === roundId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** 按 id 取一条核查问题。 */
export function factIssueById(db: DemoDb, issueId: string): FactCheckIssue | undefined {
  return db.factIssues.find((issue) => issue.id === issueId);
}

/** 告警：`raised_at DESC, id ASC`（新的在前，与通知中心的读法一致）。 */
export function alertsOf(db: DemoDb, projectId: string): AlertItem[] {
  return db.alerts
    .filter((alert) => alert.project_id === projectId)
    .sort(
      (left, right) => descending(left.raised_at, right.raised_at) || left.id.localeCompare(right.id),
    );
}

/** 按 id 取一条告警。 */
export function alertById(db: DemoDb, alertId: string): AlertItem | undefined {
  return db.alerts.find((alert) => alert.id === alertId);
}

/** 行动处方：`rank ASC, id ASC`（Top-N 处方的名次序，界面照此展示）。 */
export function actionsOf(db: DemoDb, projectId: string): ActionItem[] {
  return db.actions
    .filter((action) => action.project_id === projectId)
    .sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id));
}

/** 按 id 取一条处方。 */
export function actionById(db: DemoDb, actionId: string): ActionItem | undefined {
  return db.actions.find((action) => action.id === actionId);
}

/** 生成文稿：`created_at DESC, id ASC`（新的在前）。 */
export function contentsOf(db: DemoDb, projectId: string): GeneratedContent[] {
  return db.contents
    .filter((content) => content.project_id === projectId)
    .sort(
      (left, right) =>
        descending(left.created_at, right.created_at) || left.id.localeCompare(right.id),
    );
}

/** 按 id 取一份文稿。 */
export function contentById(db: DemoDb, contentId: string): GeneratedContent | undefined {
  return db.contents.find((content) => content.id === contentId);
}

// ---------------------------------------------------------------------------
// M6.5 站点接入与补丁工作台的只读派生 helper（spec 2026-09-30 · DR-51）
// ---------------------------------------------------------------------------
//
// 与上面几批同一个纪律：**过滤与排序只在这里写一次**，handler 不许各写各的 `filter`。
// 真后端这四张表还不存在（本轮 Rust 侧零改动），所以这里的顺序是 demo 侧的**裁定**：
// - 通道按 `SITE_CHANNEL_KIND_VALUES` 的清单序（bundle → cms → edge → repo）：
//   界面上四张卡的顺序必须稳定，且与 spec DR-46 的叙述顺序一致（`updated_at` 排序会随点击漂）；
// - 补丁按 `position ASC, id ASC`（照 `keywordsOf` / `promptItemsOf`）；
// - 事件按 `created_at ASC, id ASC`（**时间正序**：历史是"从头读到尾"的账，
//   与 `revisionsOf` 的倒序刻意相反——那边是"最近改了什么"，这边是"这条补丁经历了什么"）。

/** 站点档案：一个项目一份（没有就是没有，`Option` 语义，照 `entityCardOf`）。 */
export function siteProfileOf(db: DemoDb, projectId: string): SiteProfile | undefined {
  return db.siteProfiles.find((profile) => profile.project_id === projectId);
}

/** 下发通道：按 `SITE_CHANNEL_KIND_VALUES` 的清单序。 */
export function siteChannelsOf(db: DemoDb, projectId: string): SiteChannel[] {
  return db.siteChannels
    .filter((channel) => channel.project_id === projectId)
    .sort(
      (left, right) =>
        SITE_CHANNEL_KIND_VALUES.indexOf(left.kind) - SITE_CHANNEL_KIND_VALUES.indexOf(right.kind) ||
        left.id.localeCompare(right.id),
    );
}

/** 按 kind 取一条通道（同项目内 kind 唯一，`site_channel_upsert` 保证）。 */
export function siteChannelOf(
  db: DemoDb,
  projectId: string,
  kind: SiteChannelKind,
): SiteChannel | undefined {
  return db.siteChannels.find((channel) => channel.project_id === projectId && channel.kind === kind);
}

/** 补丁台账：`position ASC, id ASC`。 */
export function sitePatchesOf(db: DemoDb, projectId: string): SitePatch[] {
  return db.sitePatches
    .filter((patch) => patch.project_id === projectId)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

/** 按 id 取一条补丁。 */
export function sitePatchById(db: DemoDb, patchId: string): SitePatch | undefined {
  return db.sitePatches.find((patch) => patch.id === patchId);
}

/**
 * 一条补丁的历史：`created_at ASC`（时间正序）。
 *
 * 🔴 **刻意不加 `id` 那个次级键**（与 `revisionsOf` / `keywordsOf` 的写法不同）：
 * id 是 uuid v4，拿它当同一时刻的 tie-break 等于**随机排序**。而"保存草案"与"回滚"
 * 完全可能落在同一毫秒里（`nowIso()` 是 `Date.toISOString()`，毫秒精度），
 * 那时唯一还成立的因果信息就是**追加顺序**——`sitePatchEvents` 是只追加的数组，
 * `filter` 保序、`Array.prototype.sort` 自 ES2019 起稳定 ⇒ 只比时间就得到确定的因果序。
 * 加了 id 反而会把"先保存后回滚"随机显示成"先回滚后保存"。
 */
export function sitePatchEventsOf(db: DemoDb, patchId: string): SitePatchEvent[] {
  return db.sitePatchEvents
    .filter((event) => event.patch_id === patchId)
    .sort((left, right) => ascending(left.created_at, right.created_at));
}

/** RFC3339 时间戳升序比较（用 `Date.parse` 而不是字符串比：秒/毫秒精度混排时字符串比会说谎）。 */
function ascending(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

/** RFC3339 时间戳降序比较。 */
function descending(left: string, right: string): number {
  return Date.parse(right) - Date.parse(left);
}

// ---------------------------------------------------------------------------
// M6 文章管理 Article Studio 的只读派生 helper（spec 2026-10-10 · DR-84 … DR-86）
// ---------------------------------------------------------------------------
//
// 与上面几批同一个纪律：**过滤与排序只在这里写一次**，handler 不许各写各的 `filter`。
// 真后端这四张表还不存在（本轮 Rust 侧零改动），所以这里的顺序是 demo 侧的**裁定**：
// - 方向与模板按 `created_at ASC, id ASC`（照 `assetsOf`：先建的在上，清单读起来是"一路加出来的"）；
// - 排期按 `next_run_at ASC`（**null 排最后**）：界面上"下一次什么时候跑"是这张表的主问题，
//   停用的排期没有下次运行时间 ⇒ 沉到末尾，而不是用 `Date.parse(null)` 混进时间序里；
// - 文章按 `generated_at DESC, id ASC`（照 `contentsOf`：评审队列是"最新的先看"）。

/** 可空时间戳的升序比较，`null` 一律排最后（排期表用）。 */
function nullableAscending(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return ascending(left, right);
}

/** 内容方向：`created_at ASC, id ASC`。 */
export function articleDirectionsOf(db: DemoDb, projectId: string): ArticleDirection[] {
  return db.articleDirections
    .filter((row) => row.project_id === projectId)
    .sort(
      (left, right) => ascending(left.created_at, right.created_at) || left.id.localeCompare(right.id),
    );
}

/** 按 id 取一个方向（认不出 ⇒ `undefined`，由 handler 决定是报错还是忽略）。 */
export function articleDirectionById(db: DemoDb, directionId: string): ArticleDirection | undefined {
  return db.articleDirections.find((row) => row.id === directionId);
}

/** 提示词模板：`created_at ASC, id ASC`。 */
export function articleTemplatesOf(db: DemoDb, projectId: string): ArticleTemplate[] {
  return db.articleTemplates
    .filter((row) => row.project_id === projectId)
    .sort(
      (left, right) => ascending(left.created_at, right.created_at) || left.id.localeCompare(right.id),
    );
}

/** 按 id 取一份模板。 */
export function articleTemplateById(db: DemoDb, templateId: string): ArticleTemplate | undefined {
  return db.articleTemplates.find((row) => row.id === templateId);
}

/** 生成排期：`next_run_at ASC`（null 最后）`, id ASC`。 */
export function articleSchedulesOf(db: DemoDb, projectId: string): ArticleSchedule[] {
  return db.articleSchedules
    .filter((row) => row.project_id === projectId)
    .sort(
      (left, right) => nullableAscending(left.next_run_at, right.next_run_at) || left.id.localeCompare(right.id),
    );
}

/** 按 id 取一条排期。 */
export function articleScheduleById(db: DemoDb, scheduleId: string): ArticleSchedule | undefined {
  return db.articleSchedules.find((row) => row.id === scheduleId);
}

/** 文章评审队列：`generated_at DESC, id ASC`（最新的先审）。 */
export function articlesOf(db: DemoDb, projectId: string): Article[] {
  return db.articles
    .filter((row) => row.project_id === projectId)
    .sort(
      (left, right) =>
        descending(left.generated_at, right.generated_at) || left.id.localeCompare(right.id),
    );
}

// ---------------------------------------------------------------------------
// M5.5 站长数据的只读派生 helper（spec 2026-10-12 · DR-92 / DR-97 / DR-109 / DR-118）
// ---------------------------------------------------------------------------
//
// 与上面几批同一个纪律：**过滤与排序只在这里写一次**，handler 不许各写各的 `filter`。
// 真后端这六张表还不存在（本轮 Rust 侧零改动，差异台账 §4h E-67 起），所以这里的顺序是
// demo 侧的**裁定**：
// - 源按 `SEARCH_SOURCE_VALUES` 的**目录序**（照 `siteChannelsOf` 按 `SITE_CHANNEL_KIND_VALUES`
//   排的理由）：界面上三分组卡片墙的顺序必须稳定，而 `updated_at` 排序会随点击漂；
// - 指标明细按 `period_start ASC` → 源目录序 → `id ASC`：**周期正序**，因为汇总区间收敛
//   （DR-109）读的就是"最早那一批"，把最旧的排在最前面，走查时不必翻到表尾；
// - AI 汇总与 C 类留档按源目录序 → `id ASC`（同一批导入的东西挨在一起）；
// - 机会按 `rule_id ASC`（DR-100 那 6 条规则的序号 == 界面上 6 张卡的顺序）；
// - 自建索引快照按 `observed_at ASC`（DR-118 是**时间序列**：从早到晚读才是"这三周变了什么"）。

/** 源目录序的比较器（认不出的 kind 沉到末尾，`indexOf` 回 -1 时不能让它排到最前面）。 */
function sourceKindRank(kind: SearchSourceKind): number {
  const at = SEARCH_SOURCE_VALUES.indexOf(kind);
  return at === -1 ? SEARCH_SOURCE_VALUES.length : at;
}

/** 已接入的数据源：按目录序。 */
export function searchSourcesOf(db: DemoDb, projectId: string): SearchSource[] {
  return db.searchSources
    .filter((row) => row.project_id === projectId)
    .sort(
      (left, right) => sourceKindRank(left.kind) - sourceKindRank(right.kind) || left.id.localeCompare(right.id),
    );
}

/** 按 kind 取一个源（同项目内 kind 唯一，`search_source_upsert` 保证）。 */
export function searchSourceOf(
  db: DemoDb,
  projectId: string,
  kind: SearchSourceKind,
): SearchSource | undefined {
  return db.searchSources.find((row) => row.project_id === projectId && row.kind === kind);
}

/** 指标明细：`period_start ASC` → 源目录序 → `id ASC`。 */
export function searchMetricsOf(db: DemoDb, projectId: string): SearchQueryMetric[] {
  return db.searchMetrics
    .filter((row) => row.project_id === projectId)
    .sort(
      (left, right) =>
        left.period_start.localeCompare(right.period_start) ||
        sourceKindRank(left.source_kind) - sourceKindRank(right.source_kind) ||
        left.id.localeCompare(right.id),
    );
}

/** AI 引用表现的项目级汇总：源目录序 → `period_start ASC` → `id ASC`。 */
export function searchAiOverviewsOf(db: DemoDb, projectId: string): SearchAiOverview[] {
  return db.searchAiOverviews
    .filter((row) => row.project_id === projectId)
    .sort(
      (left, right) =>
        sourceKindRank(left.source_kind) - sourceKindRank(right.source_kind) ||
        left.period_start.localeCompare(right.period_start) ||
        left.id.localeCompare(right.id),
    );
}

/** C 类平台独有维度的留档：源目录序 → `observed_at ASC` → `id ASC`。 */
export function searchNativeExtrasOf(db: DemoDb, projectId: string): SearchNativeExtra[] {
  return db.searchNativeExtras
    .filter((row) => row.project_id === projectId)
    .sort(
      (left, right) =>
        sourceKindRank(left.source_kind) - sourceKindRank(right.source_kind) ||
        ascending(left.observed_at, right.observed_at) ||
        left.id.localeCompare(right.id),
    );
}

/** 优化机会：`rule_id ASC`（DR-100 的规则序号即界面卡片序）。 */
export function searchOpportunitiesOf(db: DemoDb, projectId: string): SearchOpportunity[] {
  return db.searchOpportunities
    .filter((row) => row.project_id === projectId)
    .sort((left, right) => left.rule_id - right.rule_id || left.id.localeCompare(right.id));
}

/**
 * 按 id 取一条机会。
 * 🔴 **不按项目过滤**：`search_opportunity_update` 的入参只有 `opportunity_id` + `status`
 * （照 `action_update_status` 的取舍——id 已经是全局唯一的，再要一次 project_id 就是
 * 给调用方一个"填错了就静默改不动"的机会）。归属项目由这一行自己带。
 */
export function searchOpportunityById(db: DemoDb, opportunityId: string): SearchOpportunity | undefined {
  return db.searchOpportunities.find((row) => row.id === opportunityId);
}

/** 自建索引快照：`observed_at ASC`（时间序列，DR-118）。 */
/**
 * 这个项目的流量来源分布（DR-111）。
 *
 * 🔴 剥掉 `project_id` 再端出去：那是 demo 的存储细节，契约形状只有 `engine` + `share`。
 * 🔴 **不排序、不补齐**：`suggestSources` 自己按占比降序排；这里补一个 0 占比的引擎
 * 就等于暗示"这家也有量"，而 DR-111 禁止任何内置假设。
 */
export function searchTrafficSplitOf(db: DemoDb, projectId: string): SearchTrafficShare[] {
  return db.searchTrafficSplit
    .filter((row) => row.project_id === projectId)
    .map(({ engine, share }) => ({ engine, share }));
}

export function selfIndexSnapshotsOf(db: DemoDb, projectId: string): SelfIndexSnapshot[] {
  return db.selfIndexSnapshots
    .filter((row) => row.project_id === projectId)
    .sort(
      (left, right) => ascending(left.observed_at, right.observed_at) || left.id.localeCompare(right.id),
    );
}

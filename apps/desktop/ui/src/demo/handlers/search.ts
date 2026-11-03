/**
 * M5.5 站长数据：**源档案 + 机会处置**那 5 条命令
 * （`search_board` / `search_source_upsert` / `_remove` / `_test` / `search_opportunity_update`）。
 * 导入那一条（`search_metric_import_csv`）在 `handlers/search-import.ts`——照 `site.ts` /
 * `site-patch.ts` 与 `article.ts` / `article-schedule.ts` 的同款拆分，守 AGENTS「单文件约 400 行」那条软线。
 * 设计规格 `docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md`（DR-97 … DR-99 / DR-108 / DR-118）。
 *
 * 🔴 **Rust 侧没有对应实现**：这 6 条与 M3–M7 那 20 条、Plan B 那 2 条、M1.5 那 10 条、
 * M6.5 那 11 条、M1.2b/M6 那 16 条同族——只有 demo 侧接线，桌面端点进来会报
 * `ipc/unknown_command`（差异台账 §4h E-67 起，待本轮落地后写入）。
 *
 * # 🔴 demo 不做的四件事（DR-99，界面上都有常驻说明）
 * ① **不联网自检**：`search_source_test` 逐字端出 `SEED_SEARCH_SOURCE_PROBES`（规则 2），
 *   OAuth 一条都没实现 ⇒ `credentials_state` 恒不为 `stored`；
 * ② **不重算机会**：DR-100 那 6 条规则的判定是 `geo-domain` 纯函数，demo 只端静态清单，
 *   `search_opportunity_update` 只翻 `status` + `updated_at`（E-68）；
 * ③ **不收凭据**：入参里的 `password` / `token` 一类键**根本不读**，库里只有
 *   `keyring://search/<kind>` 这个账号级两段引用串（DR-96 / 规则 3）；
 * ④ **不算汇总**：DR-97 ④ 刻意没有 `search_aggregate`——归一、A 类求和、B 类重算、筛选与
 *   区间收敛全在 `api/search-compose.ts`（纯函数，demo 与桌面端共用同一份）。
 *
 * # 三种照抄既有 handler 的后端语义
 * - **返回形状不统一**（刻意）：`board` 回一个对象、`upsert` / `test` / `opportunity_update`
 *   回**单条**、`remove` 回**剩余快照**（照 `site.ts` 那三条）；
 * - **删除幂等**：认不出的 kind 直接忽略（照 `siteChannelRemove` / `competitor_delete`）；
 * - **一次写操作只取一个时间戳**（照 `handlers/action.ts`）。
 *
 * # 🔴 二期源在**命令面**也不收（DR-92 / DR-108）
 * `sogou` / `so_360` 的目录行是 `phase: 2` ⇒ `requireSourceKind` 拒。开放二期只改目录表一个数字，
 * 这里跟着自动放开——**不用改这个文件**（这正是 DR-108「加一个源只加数据、不改页面」的命令面对价）。
 *
 * # 语言约束（门禁 7 / §B-11）
 * 本目录非注释 CJK 必须为 0 ⇒ 字符串常量全是 ASCII；自检结论与机会依据的中文逐字来自
 * `seed/search-data.ts`（那边是**数据**，不是文案）。
 */
import type { DemoDb, DemoHandler } from '../types';
import { demoError } from '../types';
import {
  getDemoDb,
  searchAiOverviewsOf,
  searchMetricsOf,
  searchNativeExtrasOf,
  searchOpportunitiesOf,
  searchOpportunityById,
  searchSourceOf,
  searchSourcesOf,
  searchTrafficSplitOf,
  selfIndexSnapshotsOf,
} from '../db';
import { catalogEntryOf, searchSecretRef } from '../../api/search-catalog';
import type {
  SearchBindingField,
  SearchBoardResult,
  SearchOpportunity,
  SearchSource,
  SearchSourceKind,
  SelfIndexSummary,
  SiteChannelStatus,
  SiteCredentialsState,
} from '../../api/types';
import { SEARCH_OPPORTUNITY_STATUS_VALUES, SEARCH_SOURCE_VALUES } from '../../api/types';
import {
  SEED_SEARCH_AS_OF,
  SEED_SEARCH_BINDING_BLOCKED_DETAIL,
  SEED_SEARCH_SOURCE_PROBES,
} from '../seed/search-data';
import { asRecord, asString, cleanOptional, newId, nowIso, requireProject } from './shared';

// ---------------------------------------------------------------------------
// 入参收窄
// ---------------------------------------------------------------------------

/**
 * 数据源 kind 入参：它决定**改哪一行** ⇒ 认不出就报错，不收敛（照 `site.ts` 的 `requireChannelKind`）。
 *
 * 🔴 与 `shared.ts` 那批 `asXxx`（数据字段的收敛）刻意不同：那边是"一条已存在的记录总得有个
 * 合法取值"，这边是"用户点名要操作哪个源"——把认不出的 kind 悄悄换成 `manual`，
 * 就会把一份 GSC 导出写进人工填报那一行。
 * 🔴 **二期源同一条错误码**（`not_allowed`）：界面上根本不渲染二期的接入入口（`renderableCatalog`），
 * 所以走到这里的一定是绕过界面的调用；给它一个专门的 reason 只会多一个词典键、多一份漂移面。
 */
export function requireSourceKind(value: unknown): SearchSourceKind {
  const raw = asString(value);
  const known = (SEARCH_SOURCE_VALUES as readonly string[]).includes(raw);
  if (!known || catalogEntryOf(raw as SearchSourceKind).phase !== 1) {
    throw demoError('validation/failed', {
      field: 'source_kind',
      reason: 'not_allowed',
      value: raw,
    });
  }
  return raw as SearchSourceKind;
}

/**
 * 站点绑定（**非敏感**，DR-96）：只收目录表 `binding_fields` 点名的那几个键，其余一律丢掉。
 *
 * 🔴 这就是"不收凭据"的落点：入参里塞 `password` / `token` / `apiKey` 都进不了 `binding`，
 * 因为它们不在任何一个源的 `binding_fields` 里 ⇒ 既不落库、也不进错误 params（规则 3）。
 */
function cleanBinding(
  kind: SearchSourceKind,
  value: unknown,
): Partial<Record<SearchBindingField, string>> {
  const raw = asRecord(value);
  const binding: Partial<Record<SearchBindingField, string>> = {};
  for (const field of catalogEntryOf(kind).binding_fields) {
    const cleaned = cleanOptional(raw[field]);
    if (cleaned !== null) binding[field] = cleaned;
  }
  return binding;
}

/**
 * 凭据形态由目录表的 `auth_mode` 推导（DR-113：与"数据怎么进来"是两个正交维度）。
 * 🔴 demo 里只有"不需要"与"缺"两档，`stored` **永远不会出现**（OAuth 一条都没实现，DR-99）
 * ——比真后端更强，照 `handlers/secret.ts` 的口径。
 */
function credentialsOf(kind: SearchSourceKind): SiteCredentialsState {
  return catalogEntryOf(kind).auth_mode === 'none' ? 'not_required' : 'missing';
}

/** 引用串（账号级两段，DR-96）；不需要凭据的源连引用串都没有 ⇒ `null`。 */
function secretRefOf(kind: SearchSourceKind): string | null {
  return catalogEntryOf(kind).auth_mode === 'none' ? null : searchSecretRef(kind);
}

/**
 * 建档状态：绑定字段一个都不需要 ⇒ 建档即 `ready`（`manual` 是唯一一个，照 `site.ts` 的
 * `READY_WITHOUT_CONFIG` 里那个 `bundle`）；填全了 ⇒ `pending_verify`（等一次自检）；
 * 缺一个 ⇒ `not_configured`。
 */
function statusOf(
  kind: SearchSourceKind,
  binding: Partial<Record<SearchBindingField, string>>,
): SiteChannelStatus {
  const required = catalogEntryOf(kind).binding_fields;
  if (required.length === 0) return 'ready';
  return required.every((field) => binding[field] !== undefined) ? 'pending_verify' : 'not_configured';
}

/**
 * 造一行源（`upsert` 的新建支与 `test` / 导入的"即建档"支共用，免得三处各写一份字段映射）。
 * 🔴 `group` / `region` / `auth_mode` / `ingest_modes` **一律取自目录表**（DR-108），不收用户输入：
 * 一个源支持哪几种取数形态是产品的建模决定，不是每次接入时现场填的表单。
 */
function makeSource(
  projectId: string,
  kind: SearchSourceKind,
  binding: Partial<Record<SearchBindingField, string>>,
  note: string | null,
  stamp: string,
): SearchSource {
  const entry = catalogEntryOf(kind);
  return {
    id: newId(),
    project_id: projectId,
    kind,
    auth_mode: entry.auth_mode,
    ingest_modes: [...entry.ingest_modes],
    status: statusOf(kind, binding),
    region: entry.region,
    group: entry.group,
    binding,
    credentials_state: credentialsOf(kind),
    secret_ref: secretRefOf(kind),
    data_through: null,
    checked_at: null,
    check_detail: null,
    note,
    created_at: stamp,
    updated_at: stamp,
  };
}

/**
 * "即建档"：这个项目还没有该源的行时按目录表补一行（照 `siteChannelTest` 的先例）。
 *
 * 🔴 与 `makeSource` 刻意分开：建档的起点是 `not_configured`（还没填绑定），
 * 而自检与导入这两支随后就把 `status` 覆盖成自己的结论——探测结论与导入的数据
 * 都必须落在**某一行**上，而"没配过"本身也是一个合法起点。
 */
function ensureSource(db: DemoDb, projectId: string, kind: SearchSourceKind, stamp: string): SearchSource {
  const existing = searchSourceOf(db, projectId, kind);
  if (existing !== undefined) return existing;
  const created = makeSource(projectId, kind, {}, null, stamp);
  db.searchSources.push(created);
  return created;
}

/**
 * 导入成功后回写源行（`search-import.ts` 调它）：数据真的进来了就说明这个源可用 ⇒ `ready`。
 *
 * 🔴 **不动** `binding` / `note` / `checked_at`：导入证明的是"这个源有数据"，
 * 不是"绑定填对了"或"连通性探过了"，把三者混成一次写入就会让界面上那句自检结论变成假话。
 */
export function markSourceImported(
  db: DemoDb,
  projectId: string,
  kind: SearchSourceKind,
  dataThrough: string,
  stamp: string,
): SearchSource {
  const source = ensureSource(db, projectId, kind, stamp);
  source.status = 'ready';
  source.data_through = dataThrough;
  source.updated_at = stamp;
  return source;
}

// ---------------------------------------------------------------------------
// search_board
// ---------------------------------------------------------------------------

/**
 * 自建索引的覆盖情况（DR-118 的读出口，命令面不加）。
 * 🔴 可空：还没跑过采集轮的项目回 `null`，界面显示空态而不是抛错。
 * 🔴 四个数全是**去重后的计数**，`last_run_at` 取最近一次观测——自有索引**没有点击**、
 * 算不出 CTR，所以这里刻意不给任何比率（界面上不许把它与 CTR 混成一条曲线）。
 */
function selfIndexOf(db: DemoDb, projectId: string): SelfIndexSummary | null {
  const rows = selfIndexSnapshotsOf(db, projectId);
  if (rows.length === 0) return null;
  let lastRunAt: string | null = null;
  for (const row of rows) {
    if (lastRunAt === null || row.observed_at > lastRunAt) lastRunAt = row.observed_at;
  }
  return {
    engines_covered: new Set(rows.map((row) => row.engine)).size,
    queries_covered: new Set(rows.map((row) => row.key)).size,
    last_run_at: lastRunAt,
    rounds_covered: new Set(rows.map((row) => row.round_id)).size,
  };
}

/**
 * `search_board`：站长数据页首屏（源 + 明细 + AI 汇总 + C 类留档 + 机会 + 自建索引覆盖 + 流量分布）。
 *
 * 一次往返拿全七块，避免七个 loading 打架——与 `site_board` / `action_board` / `collection_board`
 * 同一个取舍。🔴 **不含汇总数字**（DR-97 ④）：`search_board` 已经把明细全端出来了，
 * 再让后端算一遍汇总就是两个真值源。
 * ⚠ 不分页：明细上万行时前端要扛（代价登记在差异台账 E-67）。
 */
export const searchBoard: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const board: SearchBoardResult = {
    as_of: SEED_SEARCH_AS_OF,
    sources: structuredClone(searchSourcesOf(db, projectId)),
    metrics: structuredClone(searchMetricsOf(db, projectId)),
    ai_overviews: structuredClone(searchAiOverviewsOf(db, projectId)),
    native_extras: structuredClone(searchNativeExtrasOf(db, projectId)),
    opportunities: structuredClone(searchOpportunitiesOf(db, projectId)),
    self_index_summary: selfIndexOf(db, projectId),
    self_index_snapshots: structuredClone(selfIndexSnapshotsOf(db, projectId)),
    // DR-111：接入建议的**唯一输入**。这里只端分布、不算建议——`suggestSources` 在前端
    // （纯函数，demo 与桌面端共用），所以后端不持有任何"该推荐谁"的口径。
    traffic_split: structuredClone(searchTrafficSplitOf(db, projectId)),
  };
  return board;
};

// ---------------------------------------------------------------------------
// search_source_upsert / _remove / _test
// ---------------------------------------------------------------------------

/**
 * `search_source_upsert`：增改一个数据源（同 `kind` 覆盖 ⇒ 一个项目就是一个站点，每 kind 至多一行）。
 *
 * 🔴 改配置 ⇒ 上一次的自检结论**作废**（`checked_at` / `check_detail` 清空、状态回绑定推导值）：
 * 留着一条针对旧资源库地址的"自检通过"是最容易骗人的那种界面（照 `siteChannelUpsert`）。
 * 🔴 但**已经导入的数据不因改配置而消失**：`data_through` 原样留着——那批数字是真的进过库的，
 * 改一次绑定就把它说成"没有数据"，比留着更错。
 */
export const searchSourceUpsert: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);
  const kind = requireSourceKind(args.kind);

  const binding = cleanBinding(kind, args.binding);
  const note = cleanOptional(args.note);
  const stamp = nowIso();

  const existing = searchSourceOf(db, projectId, kind);
  if (existing !== undefined) {
    existing.binding = binding;
    existing.note = note;
    existing.status = statusOf(kind, binding);
    existing.credentials_state = credentialsOf(kind);
    existing.secret_ref = secretRefOf(kind);
    existing.checked_at = null;
    existing.check_detail = null;
    existing.updated_at = stamp;
    return structuredClone(existing);
  }

  const source = makeSource(projectId, kind, binding, note, stamp);
  db.searchSources.push(source);
  return structuredClone(source);
};

/**
 * `search_source_remove`：移除一个源，回**剩余快照**（幂等：认不出的 kind 直接忽略）。
 *
 * 🔴 **连带删掉三张从属表**（明细 / AI 汇总 / C 类留档）：留着就是"合计里有一批查不到出处的数字"
 * ——汇总行的"参与源清单"点不开、旗标也无从解释，而 DR-110 那条"给数字同时给得出账"就废了。
 * 🔴 自建索引快照**不删**：它是 L1 我们自己采的（M3 轮次的产物），不是这个源的数据。
 */
export const searchSourceRemove: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);
  const kind = requireSourceKind(args.kind);

  const ofThisSource = (row: { project_id: string; source_kind?: SearchSourceKind; kind?: SearchSourceKind }) =>
    row.project_id === projectId && (row.source_kind ?? row.kind) === kind;

  // 机会的证据 id 必须指向仍在库里的指标行：源一删，依赖它的机会就失去依据。
  // demo 不重算机会（DR-99），所以这里选择**移除**而不是改写 basis；留下悬空 id 会让
  // 机会卡上的“依据”无法复算，正是 DR-110“给数字同时给得出账”要禁止的形态。
  const removedMetricIds = new Set(
    db.searchMetrics
      .filter((row) => ofThisSource(row))
      .map((row) => row.id),
  );

  db.searchSources = db.searchSources.filter((row) => !(row.project_id === projectId && row.kind === kind));
  db.searchMetrics = db.searchMetrics.filter((row) => !ofThisSource(row));
  db.searchOpportunities = db.searchOpportunities.filter(
    (row) =>
      row.project_id !== projectId ||
      !row.evidence_metric_ids.some((id) => removedMetricIds.has(id)),
  );
  db.searchAiOverviews = db.searchAiOverviews.filter((row) => !ofThisSource(row));
  db.searchNativeExtras = db.searchNativeExtras.filter((row) => !ofThisSource(row));
  // 站内分析是 DR-111 流量分布的唯一来源：源没了，基于它的接入建议也必须一起走。
  if (catalogEntryOf(kind).group === 'analytics') {
    db.searchTrafficSplit = db.searchTrafficSplit.filter((row) => row.project_id !== projectId);
  }
  return structuredClone(searchSourcesOf(db, projectId));
};

/**
 * `search_source_test`：跑一次自检，回**那个源**。
 *
 * 🔴 **不联网**（规则 2 / DR-99）：结论逐字来自 `SEED_SEARCH_SOURCE_PROBES`。真后端这一支要真发一次
 * 探测（OAuth 令牌有效性 / 站点归属 / 导出入口可达性），并带上真实延迟与失败原因；
 * 界面上有常驻说明 `webmasterData.demoBody`，不让人把预置结论当探测结果。
 * 🔴 **自检即建档**（照 `siteChannelTest`）：探测结论必须落在某一行上。
 * 🔴 **自检不动数据**：明细行数与 `data_through` 都不变——它探的是"这个源还能不能取数"，
 * 不是"这个源有多少数"。
 */
export const searchSourceTest: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);
  const kind = requireSourceKind(args.kind);

  const probe = SEED_SEARCH_SOURCE_PROBES[kind];
  const stamp = nowIso();
  const source = ensureSource(db, projectId, kind, stamp);

  // 预置结论可以演『连通性』，但不能越过绑定推导：没填必填绑定就不许说 ready。
  const bindingStatus = statusOf(kind, source.binding);
  const blockedByBinding = probe.status === 'ready' && bindingStatus !== 'ready';
  source.status = blockedByBinding ? bindingStatus : probe.status;
  source.check_detail = blockedByBinding ? SEED_SEARCH_BINDING_BLOCKED_DETAIL : probe.check_detail;
  source.checked_at = stamp;
  source.updated_at = stamp;
  return structuredClone(source);
};

// ---------------------------------------------------------------------------
// search_opportunity_update
// ---------------------------------------------------------------------------

/**
 * `search_opportunity_update`：翻一条优化机会的处置状态（照 `action_update_status`）。
 *
 * 🔴 **只翻 `status` + `updated_at`**：`basis` / `evidence_metric_ids` / `confidence` 一条不动，
 * 也**不会长出新机会**——DR-100 那 6 条规则的判定是 `geo-domain` 纯函数，demo 只端预置的静态清单
 * （DR-99 / E-68）。页面必须常驻 `webmasterData.staticNote` 说清这件事，否则产品负责人会以为
 * "机会清单也该跟着导入变"。
 * 🔴 入参**没有** `project_id`（照 `action_update_status`）：机会 id 已经全局唯一，
 * 再要一次项目 id 就是给调用方一个"填错了就静默改不动"的机会。
 * 🔴 采纳**不**自动生成处方（DR-102）：界面上那两个跳转入口走既有命令
 * （`article_direction_add` / `site_patch_generate`），这里不新增出口。
 */
export const searchOpportunityUpdate: DemoHandler = (args) => {
  const db = getDemoDb();
  const opportunityId = asString(args.opportunity_id);
  const opportunity: SearchOpportunity | undefined = searchOpportunityById(db, opportunityId);
  if (opportunity === undefined) {
    throw demoError('validation/failed', {
      field: 'opportunity_id',
      reason: 'invalid_id',
      value: opportunityId,
    });
  }

  const raw = asString(args.status);
  if (!(SEARCH_OPPORTUNITY_STATUS_VALUES as readonly string[]).includes(raw)) {
    throw demoError('validation/failed', {
      field: 'opportunity_status',
      reason: 'not_allowed',
      value: raw,
    });
  }

  opportunity.status = raw as SearchOpportunity['status'];
  opportunity.updated_at = nowIso();
  return structuredClone(opportunity);
};

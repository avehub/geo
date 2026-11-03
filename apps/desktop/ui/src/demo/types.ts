/**
 * demo 假后端自己的类型与错误构造 helper。
 *
 * ⚠ **DTO 一律从 `src/api/types.ts` 取**（那是与 Rust serde 同形的唯一真值源，AGENTS 规则 8）：
 * 本文件**不许**另造一套平行 DTO，否则 demo 与真实后端的形状会各自漂移，而 demo 的全部价值
 * 恰恰是「让产品负责人看到真实数据长什么样」。这里只放 demo 独有的东西：
 * `DemoHandler` / `DemoDb` / 内部辅助类型 / `demoError`。
 *
 * # 为什么 `demoError` 放在本文件而不是 `backend.ts`
 * Task 12–14 的 `src/demo/handlers/**` 要用它构造错误，而 `backend.ts` 那时会反过来 import
 * 那些 handler ⇒ 放 `backend.ts` 就是一个运行期循环依赖。本文件是**叶子**（只 `import type`
 * 别的模块），谁都能安全 import。
 *
 * # 语言约束
 * 本文件的**非注释部分不含任何 CJK**：demo 代码生成的字符串（错误 message、派生 id / label）
 * 一律 ASCII / 语言中立（简报 §B-11）。中文只出现在 `src/demo/seed/**` 的**数据**里——
 * 那是「后端数据」的替身，不是界面文案，也不归词典管。
 */
import type {
  ActionItem,
  AlertItem,
  AnswerInsight,
  AppSettings,
  Article,
  ArticleDirection,
  ArticleSchedule,
  ArticleTemplate,
  CollectionRound,
  CollectionRecordDetail,
  CollectionTask,
  Competitor,
  EntityCard,
  EntityCardRevision,
  FactCheckIssue,
  FaqItem,
  GeneratedContent,
  IntentCategory,
  IpcErrorPayload,
  KbEntry,
  KbEntryKind,
  KbEntryRevision,
  KbModule,
  KeywordItem,
  KeywordKind,
  Project,
  ProjectAsset,
  PromptItem,
  PromptSet,
  PromptSource,
  ProviderInfo,
  SearchAiOverview,
  SearchNativeExtra,
  SearchOpportunity,
  SearchQueryMetric,
  SearchSource,
  SearchTrafficShare,
  SecretStatus,
  SelfIndexSnapshot,
  SiteChannel,
  SiteChannelKind,
  SitePatch,
  SitePatchEvent,
  SitePatchKind,
  SiteProfile,
} from '../api/types';

/**
 * 一条命令的假实现。`args` 的形状与 Tauri 命令的 `rename_all = "snake_case"` 入参一致。
 *
 * 刻意**不**泛型化返回值（`DemoHandler<T>` 那种写法会让 `Record<IpcCommand, DemoHandler>`
 * 的全覆盖网失效）：返回 `unknown`，由 `demoInvoke<T>` 在 IPC 边界上一次性收窄，
 * 与 `@tauri-apps/api/core` 的 `invoke<T>` 同族。
 */
export type DemoHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/**
 * `DemoDb.settings` 的形状：设置项 + 内置服务商预设。
 *
 * 两者放一起是因为后端也是这么给的：`settings_get` 回 `AppSettings`，`llm_providers` 回
 * `LlmProvider::all()` 映射成的 `ProviderInfo[]`（`settings_service.rs` 的
 * `impl From<LlmProvider> for ProviderInfo`）。demo 侧共用同一份种子，Task 14 直接消费，
 * **不要另造一张 provider 表**。
 */
export interface DemoSettings {
  app: AppSettings;
  providers: ProviderInfo[];
}

/**
 * demo 的内存库：每次页面刷新 / 每个测试都从静态种子重建（「刷新即重置」）。
 *
 * ⚠ 题库有**两份视图**：`promptItems` 是归一化真值（靠 `set_id` 归属），
 * `promptSets[].items` 是 DTO 要求的内嵌副本。`structuredClone` 会切断两者的引用共享，
 * 所以 handler 改条目时必须同时更新两处（或以 `promptItems` 为准重组）。
 * 种子侧的一致性由 `src/demo/seed.test.ts` 钉住。
 */
export interface DemoDb {
  projects: Project[];
  competitors: Competitor[];
  assets: ProjectAsset[];
  entityCards: EntityCard[];
  revisions: EntityCardRevision[];
  promptSets: PromptSet[];
  promptItems: PromptItem[];
  settings: DemoSettings;
  /**
   * provider 档案（profiles）**刻意留空**：档案制是 Plan B/C 的契约，现在造一份形状必然漂移
   * （简报 §B-10）。`unknown[]` 而不是自造 DTO，就是为了让「往里塞东西」这件事在类型上显眼。
   */
  profiles: unknown[];
  /** 钥匙串状态。规则 3：只有 `secret_ref` 引用串，绝不含任何形如 API Key 的值。 */
  secrets: SecretStatus[];

  // -------------------------------------------------------------------------
  // M3–M7：**只放会被写的那几张表**
  //
  // 🔴 静态聚合（引擎执行汇总、用量看板、核查汇总、体检总分、竞品矩阵、意图漏斗、
  // 引擎差异、趋势、归因卡片、内容模板目录、报告块）**一律不进库**，handler 直接读
  // `seed/**` 的常量。理由与 `profiles` 同源但方向相反：那些值在真后端是采集与计算的
  // 记账结果，demo 既不采集也不计算（AGENTS 规则 9），把它们拷进可变库里只会制造
  // 「有人以为改了它就生效」的错觉。库里这几张是**真的有写路径**的：
  // 排一轮采集、重跑一条失败任务、人工纠正一条解析、结办一条核查问题、
  // 标记告警已读、翻一条处方状态、生成/审核一份文稿。
  //
  // ⚠ `DiagnosisOverview` 里内嵌了 `trend` 与 `alerts` 两份副本（DTO 要求），
  // 而 `alerts` 的**真值是 `db.alerts`**：`diagnosis_overview` 每次读时用库里的告警
  // 覆盖内嵌副本，所以「标记已读」不需要写两处。裁定写在 `handlers/diagnosis.ts`。
  // -------------------------------------------------------------------------
  /** M3 采集轮次（`collection_start` 会往这里排一轮 `queued`）。 */
  collectionRounds: CollectionRound[];
  /** M3 队列任务（`collection_task_retry` 翻状态、写 `record_id`）。 */
  collectionTasks: CollectionTask[];
  /** M3 原始证据（重跑成功后 push 一条预置记录）。 */
  collectionRecords: CollectionRecordDetail[];
  /** M4 解析结果（重跑后 push；`insight_correct` 就地改）。 */
  insights: AnswerInsight[];
  /** M4 事实核查问题（`fact_check_resolve` 翻状态、写 `resolved_at`）。 */
  factIssues: FactCheckIssue[];
  /** M5 告警（`diagnosis_alert_acknowledge` 翻 `acknowledged`）。 */
  alerts: AlertItem[];
  /** M6 行动处方（`action_update_status` 翻状态）。 */
  actions: ActionItem[];
  /** M6 生成文稿（`content_generate` push；`content_update_status` 翻审核态）。 */
  contents: GeneratedContent[];

  // -------------------------------------------------------------------------
  // M1.5 素材层（关键词库 / FAQ 常见问题库，spec 2026-09-30 §9）
  //
  // 两张表都**有写路径**（手动录入、就地编辑、批量删除、AI 生成入库），所以照
  // 上面的裁定进可变库；🔴 生成用的**预置语料池**不进库（`seed/keywords.ts` 的
  // `SEED_KEYWORD_GENERATED_POOL` / `seed/faqs.ts` 的 `SEED_FAQ_GENERATED_POOL`），
  // handler 直接读种子常量——与 `SEED_RETRY_OUTCOMES` 不入初始库同一条理由：
  // 要让「点生成 → 库里多出来」这件事在界面上看得见变化。
  // -------------------------------------------------------------------------
  /** 关键词素材（`keyword_add` / `keyword_generate` push；`keyword_update` 就地改）。 */
  keywords: KeywordItem[];
  /** FAQ 素材（`faq_add` / `faq_generate` push；`faq_update` 就地改）。 */
  faqs: FaqItem[];

  // -------------------------------------------------------------------------
  // M6.5 站点接入与补丁工作台（spec 2026-09-30 · DR-49 / DR-56）
  //
  // 四张表都**有写路径**：保存档案、增删改通道、生成/编辑/发布补丁、追加历史事件。
  // 🔴 **页面清单不进库**（`seed/site.ts` 的 `SEED_SITE_PAGES`）：它是"爬出来的东西"的替身，
  //   demo 不爬（规则 9），放进可变库只会制造「有人以为改了它就生效」的错觉——
  //   与 `profiles` 留空、`SEED_ATTRIBUTION_CARDS` 不进库同一条裁定。
  // 🔴 **自检结论也不进库**（`SEED_SITE_CHANNEL_PROBES`）：`site_channel_test` 不联网（规则 2），
  //   它只把预置结论**写回那条通道行**（`status` / `check_detail` / `checked_at`）。
  // -------------------------------------------------------------------------
  /** 站点档案（`site_profile_save` 就地改；一个项目一份）。 */
  siteProfiles: SiteProfile[];
  /** 下发通道（`site_channel_upsert` / `_remove` / `_test`）。 */
  siteChannels: SiteChannel[];
  /** 补丁台账（`site_patch_add` / `_generate` push；`_save` / `_transition` 就地改；`_delete` 删）。 */
  sitePatches: SitePatch[];
  /** 补丁历史（只追加，不改不删；`site_patch_history` 按它出账）。 */
  sitePatchEvents: SitePatchEvent[];

  // -------------------------------------------------------------------------
  // M1.2 知识库（spec 2026-10-01 · DR-63 … DR-68）
  //
  // 🔴 **只有落库条目这一张表**：同步块（`KbSyncedBlock`）**不进库**——它是 `kb_board`
  //   每次调用时从 `entityCards` / `projects` / `competitors` / `assets` 现场投影出来的
  //   只读镜像（Notion 的 synced block 同族）。没有第二份数据 ⇒「实体卡一改，知识库跟着变」
  //   是结构性成立的，也不需要任何刷新协议（DR-67）。
  // -------------------------------------------------------------------------
  /** 知识条目（`kb_entry_add` / `_detach` / `_generate` push；`_update` / `_verify` 就地改；`_delete` 删）。 */
  kbEntries: KbEntry[];
  /**
   * 知识条目的修订留痕（DR-119，照 `revisions` 那张实体卡留痕表的姿态）。
   *
   * 🔴 **只追加**：`kb_entry_update` 每改一个字段 push 一条、`kb_entry_verify` push 一条
   * `field_path: 'verified_at'`；`kb_entry_add` / `_delete` / `kb_generate` **不 push**
   * （创建与删除不是"修订"）。删掉一条知识也**不**连带删它的留痕——台账是"改过什么"的账。
   * 🔴 读出口寄生 `kb_board`（`KbBoard.revisions`），**命令面不加**（`IPC_COMMANDS` 不变）。
   */
  kbRevisions: KbEntryRevision[];

  // -------------------------------------------------------------------------
  // M6 文章管理 Article Studio（spec 2026-10-10 · DR-84 … DR-86）
  //
  // 四张表都**有写路径**：新增/归档方向、存删模板、开关排期与「立即运行」、评审文章。
  // 🔴 两个**预置语料池**不进库（`seed/articles.ts` 的 `SEED_ARTICLE_DIRECTION_POOL` /
  //   `SEED_ARTICLE_POOL`）：它们是「AI 生成」的替身，handler 直接读种子常量——
  //   与 `SEED_KEYWORD_GENERATED_POOL` / `SEED_KB_GENERATED_POOL` 同一条裁定：
  //   要让「点生成 → 库里多出来」这件事在界面上看得见（AGENTS 规则 9：demo 不调模型）。
  // 🔴 **没有定时器**（DR-85）：`next_run_at` 只是按 freq + time 算出来的显示值，
  //   到点不会自己跑；界面上那句「演示模式不跑真实定时任务」常驻。
  // -------------------------------------------------------------------------
  /** 内容方向（`article_direction_add` / `_generate` push；带 `id` 的 add 就地改状态）。 */
  articleDirections: ArticleDirection[];
  /** 提示词模板（`article_template_save` push / 就地改；`_delete` 删，并连带删挂在它上面的排期）。 */
  articleTemplates: ArticleTemplate[];
  /** 生成排期（`article_schedule_save` push / 就地改；`_run` 记 `last_run_at` / `run_count`）。 */
  articleSchedules: ArticleSchedule[];
  /** 生成出来的文章（`article_schedule_run` push；评审写路径搭在 `article_list` 上）。 */
  articles: Article[];

  // -------------------------------------------------------------------------
  // M5.5 站长数据（spec 2026-10-12 · DR-97 / DR-99 / DR-118）
  //
  // 🔴 六张表都进库，但**写路径的密度差别很大**，逐张写明：
  // - `searchSources`：`search_source_upsert` / `_remove` / `_test` 三条都写它，
  //   `search_metric_import_csv` 还会「导入即建档」（数据真进来了就说明这个源可用）；
  // - `searchMetrics` / `searchAiOverviews` / `searchNativeExtras`：**只有导入这一条写路径**，
  //   且是「同周期同源整批覆盖」（DR-97 ②：删除是导入的一个分支 ⇒ 没有 `search_metric_delete`）；
  //   `search_source_remove` 连带删这三张里属于该源的行（留着就是"合计里有一批查不到出处的数字"）；
  // - `searchOpportunities`：`search_opportunity_update` **只翻 `status` + `updated_at`**，
  //   🔴 绝不重算（DR-99 / E-68：6 条规则的判定是 `geo-domain` 纯函数，demo 只端静态清单）；
  // - `selfIndexSnapshots`：🔴 **只读**——它是 L1 自有抽样（M3 `geo-crawler`）的时间序列化，
  //   本轮命令面**一条写路径都没有**（DR-118：寄生 `collection_*` 的写路径 + `search_board` 的读出口）。
  //   进库而不留在 `seed/**`，是为了让 `search_board` 的 `self_index_summary` 有一个**可聚合的真值**，
  //   而不是在 handler 里现算一份静态数字（规则 9 的反面）。
  //
  // - `searchTrafficSplit`：🔴 **只读**——它是 DR-111 接入建议的唯一输入（客户自己的流量来源
  //   分布，来自 `analytics` 组的来源分析）。进库而不留在 `seed/**`，与 `selfIndexSnapshots`
  //   同一条理由：`search_board` 要按项目端出**这个站点**的分布，归档项目自然回空数组
  //   （DR-111 的裁定是"没有 analytics 数据时不显示建议"，不是"显示一份通用推荐"）。
  //   本轮**没有写命令**：真后端由百度统计的来源分析算出，填报入口留到 OAuth 那一轮。
  //
  // 🔴 **一个静态表刻意不进库**：`SEED_SEARCH_SOURCE_PROBES`（自检结论，`search_source_test`
  //   不联网 ⇒ 逐字端出来，规则 2）。
  // -------------------------------------------------------------------------
  /** 已接入的数据源（一个项目每 `kind` 至多一行，`search_source_upsert` 保证）。 */
  searchSources: SearchSource[];
  /** 关键词 / 页面级指标明细（L2 接口与 L3 导入的共同落点）。 */
  searchMetrics: SearchQueryMetric[];
  /** AI 引用表现的项目级汇总（百度《AI 流量分析》那五项；没有 query 维度）。 */
  searchAiOverviews: SearchAiOverview[];
  /** 映射不上的平台原生字段，原样留档（DR-107：静默丢弃是最坏的失败形态）。 */
  searchNativeExtras: SearchNativeExtra[];
  /** 自动开出的优化机会（demo 里是静态 6 条，只翻状态）。 */
  searchOpportunities: SearchOpportunity[];
  /** 站点自建索引的关键性采样快照（DR-118，本轮只读）。 */
  selfIndexSnapshots: SelfIndexSnapshot[];
  /** 客户自己的流量来源分布（DR-111 接入建议的输入，本轮只读）。 */
  searchTrafficSplit: SearchTrafficShareRow[];
}

/**
 * 流量分布的**库内行** = 契约形状 + `project_id`。
 *
 * 🔴 `project_id` 是 demo 的存储细节，**不回前端**：`db.ts` 的 `searchTrafficSplitOf` 会剥掉它，
 * 端出去的就是契约里的 `SearchTrafficShare`（照 `SearchSource` 与种子行的同一条关系）。
 */
export type SearchTrafficShareRow = SearchTrafficShare & { project_id: string };

/**
 * 站点补丁生成池的**紧凑行**（spec 2026-09-30 §10）。
 *
 * 只写「落点 + 正文 + 语义字段」：`id` / `project_id` / `position` / 时间戳由
 * `handlers/site.ts` 在运行时补，`status` 恒 `draft`、`review_status` 恒 `pending_review`、
 * `source` 恒 `generated`（AGENTS 规则 6）⇒ 三者都不进行表，免得池子里出现
 * "已发布的生成补丁"这种自相矛盾的形状（口径照 `KeywordSeedRow`）。
 *
 * 🔴 `body` 必须是**字面量**代码/文案（`PromptSeedRow.text` 同一条纪律）：程序化拼出来
 * 就等于在 demo 里实现"补丁生成"，直接违反规则 9。
 */
export interface SitePatchSeedRow {
  kind: SitePatchKind;
  /** 补丁标题（数据级中文）。 */
  title: string;
  target_url: string;
  target_hint: string | null;
  body: string;
  channel_kind: SiteChannelKind;
}

/**
 * 种子题库的**紧凑行**（简报 §B-3）。
 *
 * 只写「文案本身 + 语义字段」：`id` / `set_id` / `position` / `repeat_count` / `competitor_ids`
 * 由 `seed/prompt-sets.ts` 里的纯函数从下标推导。
 * 🔴 `text` **必须是字面量中文串**，绝不许程序化拼出来（`` `${brand}${intent}哪个好` `` 那种）：
 * 那等于在 demo 里实现「模板展开」，直接违反 AGENTS 规则 9，也会把「演示数据」变成
 * 「看起来像真算过的数据」。
 */
export interface PromptSeedRow {
  /** 字面量中文问法（照产品文档附录 B 的口语化风格）。 */
  text: string;
  intent: IntentCategory;
  /** 1~5。 */
  weight: number;
  group_name: string | null;
  tags: readonly string[];
  source: PromptSource;
  /**
   * 指向 `seed/projects.ts` 里**同项目竞品**的下标（`SEED_ACTIVE_COMPETITOR_IDS`）。
   * 空数组 = 这条不做品牌对比。下标越界由 `seed.test.ts` 抓。
   */
  competitors: readonly number[];
}

/**
 * 关键词生成池的**紧凑行**（spec 2026-09-30 §9）。
 *
 * 只写「词面 + 语义字段 + 静态指标」：`id` / `project_id` / `position` / 时间戳由
 * `handlers/keyword.ts` 在运行时补，`source` 恒 `generated`、`status` 恒 `pending_review`
 * （AGENTS 规则 6）⇒ 两者都不进行表，免得池子里出现"人工录入的生成词"这种自相矛盾的形状。
 * 🔴 `text` 必须是**字面量中文串**，`monthly_volume` / `difficulty` 是**写死的静态值**（规则 9）。
 */
export interface KeywordSeedRow {
  text: string;
  kind: KeywordKind;
  intent: IntentCategory;
  monthly_volume: number | null;
  difficulty: number | null;
  /** 1~5。 */
  priority: number;
  note: string | null;
}

/** FAQ 生成池的紧凑行。口径与 `KeywordSeedRow` 同（见上）。 */
export interface FaqSeedRow {
  question: string;
  answer_markdown: string;
  /** 自由文本分类；它是**数据**不是枚举，所以不进词典。 */
  category: string | null;
  intent: IntentCategory;
}

/**
 * 知识库生成池的**紧凑行**（spec 2026-10-01 §10）。
 *
 * 只写「内容 + 语义字段」：`id` / `project_id` / `position` / 时间戳由 `handlers/kb.ts` 在运行时补，
 * `source` 恒 `generated`、`status` 恒 `pending_review`、`verified_at` 恒 `null`（AGENTS 规则 6）
 * ⇒ 三者都不进行表，免得池子里出现"已核实的 AI 生成知识"这种自相矛盾的形状（口径照 `KeywordSeedRow`）。
 *
 * 🔴 `title` / `body_markdown` 必须是**字面量中文串**：程序化拼出来就等于在 demo 里实现
 * "知识生成"，直接违反规则 9（同 `PromptSeedRow.text` 那条纪律）。
 * 🔴 `origin` / `origin_block_id` / `field_path` 也**不进表**：AI 生成的知识不是实体卡的投影，
 * 让它们恒为 `null` 才是诚实的形状。
 */
export interface KbSeedRow {
  module: KbModule;
  kind: KbEntryKind;
  title: string;
  body_markdown: string;
  url: string | null;
  mime: string | null;
  tags: readonly string[];
}

/**
 * 文章生成池的**紧凑行**（spec 2026-10-10 · DR-85）。
 *
 * 只写「标题 + 正文 + 字数」：`id` / `project_id` / 三个外键 / `source` / `schedule_id` /
 * 时间戳由 `handlers/article.ts` 在运行时按**触发方式**补（排期跑 → `scheduled`、
 * 模板「立即生成」→ `manual`），`status` 恒 `pending_review`（AGENTS 规则 6）
 * ⇒ 四者都不进行表，免得池子里出现"已通过的待生成文章"这种自相矛盾的形状（口径照 `KeywordSeedRow`）。
 *
 * 🔴 `title` / `body_markdown` 必须是**字面量中文串**：程序化拼出来就等于在 demo 里实现
 * "文章生成"，直接违反规则 9。`word_count` 同样是**写死的静态值**（真后端要数生成物的字数）。
 */
export interface ArticleSeedRow {
  title: string;
  body_markdown: string;
  word_count: number;
}

/**
 * 「AI 生成方向」池的紧凑行（同上：`id` / `project_id` / 时间戳由 handler 补，
 * `source` 恒 `generated`、`status` 恒 `active` ⇒ 都不进行表）。
 */
export interface ArticleDirectionSeedRow {
  title: string;
  summary: string;
}

/**
 * 造一个 `IpcErrorPayload` 形状的错误（简报 §B-7）。
 *
 * - **只造形状、不新增码**：`contracts/error-codes.json` 冻结在 43 条，`code` 必须是里面已有的；
 * - **`params` 的键集要同时满足两层**（B-13②，更正原先「必须完全一致」的口径，见简报 §A-11）：
 *   ① **对契约（词表）**——发出的每个键都 **∈** 该 code 在 `contracts/error-codes.json` 登记的 `params`
 *   数组（**子集**关系，不是相等）；② **对发射点（真值表）**——**精确键集以该 code 的 Rust 发射点为准**：
 *   例如 `validation/failed` 登记 `expected/field/limit/reason/value` 共 5 个键，而空白 `domain` 只发
 *   `{field, reason}` 2 个键、非法域名发 3 个键——**真实后端自己就发子集**。
 *   ⚠ 反过来**少一个已登记的必需键**同样违约（三个 `not_found` 都必须带 `kind`），词典插值会出空洞。
 *   本 helper **不校验键集**——校验需要把契约表复制一份进前端，那必然漂移；
 *   改由 `src/i18n/error-codes.test.ts`（词典侧）与调用点的测试（demo 侧）两头钉；
 * - `message` 是**语言中立紧凑串** `{code} {k}={v}…`，键按字典序，与后端
 *   `IpcError::with_params`（`apps/desktop/src-tauri/src/error.rs`，BTreeMap 排序）逐字同构。
 *   展示一律走 `describeIpcError(error, t)`，**绝不**把 message 端给用户（AGENTS 规则 7）；
 * - ⚠ **规则 3**：`params` 的值里绝不能出现密钥材料。后端那一侧还有 `redact()` 兜底，
 *   demo 这边没有 ⇒ 写 handler 时就不要把用户输入的 Key 放进 params。
 *
 * @param code `contracts/error-codes.json` 里已登记的稳定错误码。
 * @param params 该 code 的 params：每个键必须 ∈ 契约登记的词表，精确键集以其 Rust 发射点为准（见上）。
 * @param detail 结构化上下文，默认 `null`（与 DTO 的 `detail?: unknown | null` 对齐）。
 */
export function demoError(
  code: string,
  params: Record<string, string> = {},
  detail: unknown | null = null,
): IpcErrorPayload {
  const message = Object.keys(params)
    .sort()
    .reduce((acc, key) => `${acc} ${key}=${params[key]}`, code);
  return { code, params: { ...params }, message, detail };
}

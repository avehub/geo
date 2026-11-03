/**
 * 站长数据（M5.5 站外真相层，zh-CN）。
 * 设计规格 `docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md`（DR-90 … DR-118）。
 *
 * # 命名（DR-91）
 * 二级项与 namespace 都叫「站长数据」：这就是客户自己后台的名字（百度搜索资源平台前身即
 * "百度站长平台"、头条 / 搜狗 / 360 都叫"站长平台"、Bing 叫 Webmaster Tools），
 * 比描述性的「搜索数据」更有指向性。en 侧同理选 `Webmaster Data` 而不是 `Search Console Data`
 * ——后者会让人以为只有 Google。
 *
 * # 🔴 三句常驻说明（DR-99，照 M6.5 `site.demoBody` / `site.staticNote` 的双常驻纪律）
 * `demoBody`（页顶）/ `staticNote`（机会段顶）/ `metricNote`（汇总段顶）**都不许藏进问号 tooltip**。
 * 这一页是"一半真一半假"：映射查表、A 类求和、B 类重算、筛选与交集区间在前端**真做**
 * （导入之后合计真的会变），而 DR-100 那 6 条规则的判定是 `geo-domain` 纯函数、
 * demo 只端静态机会清单（导入不会长出新机会）。这个不对称不说清，
 * 产品负责人就会把它误读成"分析坏了"（差异台账 E-68 ④ 点名的正是这一条）。
 *
 * # 🔴 三层归一的措辞刻意避开「分级 / 档位」
 * `dictionary.test.ts` 的 #22 判据是"同一句里同时出现『分级|档位』与『重算』⇒ 红"，
 * 而 B 类的口径说明**必须**写"只能重算不能平均"（DR-95 / DR-110 护栏 3）⇒ 这三层一律叫「类」，
 * en 侧叫 `Class A/B/C` 而不是 `Tier`（en 判据同族：`tier|grade` × `recomput|recalculat`）。
 *
 * # 不新造第二套标签表（`enum-label-prefixes.test.ts` 守的那个缺陷类）
 * - 源状态四值（`not_configured` / `pending_verify` / `ready` / `failed`）**复用** `site.channelStatuses`（DR-94）；
 * - 凭据态三值 **复用** `site.credentialsStates`；
 * - 机会的处方类别 **复用** `action.categories`（DR-94：机会与处方同一套分类词）；
 * - 影响与难度 **复用** `action.levels`。
 * 本文件只放这一页**独有**的枚举：源 / 分组 / 面 / 接入形态 / 完整性 / 机会态 / 规则 / 位次带 /
 * 快照面 / 区间来源 / 证据来源（键名一律与 `api/types-search.ts` 的 `*_VALUES` 逐字对齐）。
 *
 * # 🔴 合规（AGENTS 规则 6 与规则 11）
 * 不承诺排名与效果；外部 CTR 曲线只作冷启动参考且必须标机构名 + 年份（DR-115）；
 * `pasteNote` 是**产品承诺**而不是免责套话——它与 DR-114"不做模拟登录"互为表里，写上去就得守住。
 *
 * ⚠ 插值变量一律不叫 `count`（i18next 会走复数分支去找 `_one` / `_other`，本词典没有）。
 */
const webmasterData = {
  title: '站长数据 · 多平台汇总',
  lead: '把你自己后台里的曝光、点击与 AI 引用接进来，跨平台归一汇总，与我们的自有抽样对照之后自动开出优化机会。',
  loadFailed: '站长数据加载失败',

  /** 常驻说明①（DR-99）：演示模式不联网、没有 OAuth 流程。 */
  demoBody:
    '演示模式不联网：数据源的自检结论与优化机会清单都是预置静态值，官方接口授权流程一条都没有实现，只能走查导入、粘贴、填报、汇总与机会处置。',
  /** 常驻说明②（DR-99 / E-68 ④）：机会清单不随导入变化，而汇总数字会。 */
  staticNote:
    '演示数据：机会清单不是算出来的，导入或粘贴数据不会让它长出新条目；但汇总合计、点击率与汇总区间是真算的，导入之后会跟着变。这个不对称是演示模式的能力边界，不是分析出错。',
  /** 常驻说明③（DR-99）：三层归一的口径。 */
  metricNote:
    '各平台口径不同，本页按 A / B / C 三层归一：曝光、点击与 AI 引用可以跨平台求和；点击率只能用求和后的分子除以分母重算，不做跨平台平均；映射不上的平台独有维度单独展示并标注平台。',
  /** 🔴 常驻（DR-113）：粘贴弹窗底部那一句产品承诺，不许收进 tooltip。 */
  pasteNote:
    '复制粘贴在你自己的浏览器里完成，本软件不保存你的平台账号密码，也不会代你登录任何平台。',
  /** 常驻（DR-103 / DR-105）：平台名与商标属指称性使用。 */
  trademarkNote: '数据来自各平台，本产品非其官方合作伙伴；各平台指标口径以其官方文档为准。',
  /** 常驻（DR-104）：海外组的可达性提示。 */
  regionNote:
    '这些平台的接口在中国大陆可能无法访问；桌面端的请求从你自己的电脑发出，因此取决于你的网络环境。',

  /** 陈旧告警（DR-105）：`data_through` 早于 `STALE_AFTER_DAYS` 时挂在该源上。 */
  staleTitle: '数据陈旧',
  staleWarning: '这份数据截至 {{through}}，比最新数据口径落后 {{days}} 天：拿它去汇报之前先更新一次。',
  /** 采样旗标（DR-110）：GSC 超出每日 5 万行上限时静默采样，合计可能偏低。 */
  sampledWarning: '含 {{source}} 的采样数据（超出每日 5 万行上限），合计可能偏低。',
  /** 合计行旁边常驻的汇总区间（DR-109）。 */
  aggregateWindow: '汇总区间 {{start}} ~ {{end}}',

  /**
   * 这个区间是谁声明的（键名 == `WINDOW_SOURCE_VALUES`）。
   * 百度《AI 流量分析》的导出没有日期列 ⇒ 那一档只能写"由导入时确认"，不能冒充"平台声明"。
   */
  windowSources: {
    platform: '区间由平台声明',
    user_stated: '区间由导入时确认',
  },

  // -------------------------------------------------------------------------
  // 数据源（§5.3 第 1 段）
  // -------------------------------------------------------------------------

  /**
   * 三分组标签（`enumLabel(t, 'webmasterData.groups', group)`，键名 == `SEARCH_GROUP_VALUES`）。
   * 🔴 键名按**已落地契约** `api/types-search.ts` 的三值写（`webmaster_cn` / `webmaster_global` /
   * `analytics`），而不是 DR-103 那句 `groups.{webmaster,analytics}`：DR-104 要求页面上就是三段渲染，
   * 契约把"国内 / 海外"直接编进 group 值，界面才不必再拿 `region` 拼一次（也就少一处漂移）。
   */
  groups: {
    webmaster_cn: '站长平台 · 国内',
    webmaster_global: '站长平台 · 海外',
    analytics: '站内分析（补充）',
  },

  /** 三段各自那句常驻说明（DR-104：组序即视觉权重，`analytics` 段视觉上次级）。 */
  groupNotes: {
    webmaster_cn: '这几家的后台数据只有你自己账号里看得到：平台没有开放读数接口，靠复制、导出或填报带进来。',
    webmaster_global: '含 Google Search Console 与 Bing Webmaster Tools，两家都走官方授权、数据由接口按周期拉取；出海客户线才用得上。',
    analytics: '这一组给的是站内访问量纲（会话 / 访问），不参与曝光合计，只作为流量来源分布与站内表现的补充。',
  },

  /** 9 个源标签（`enumLabel(t, 'webmasterData.sources', kind)`，键名 == `SEARCH_SOURCE_VALUES`）。 */
  sources: {
    baidu_ziyuan_ai: '百度搜索资源平台《AI 流量分析》',
    baidu_ziyuan: '百度搜索资源平台（索引量 / 流量与关键词）',
    toutiao: '头条搜索站长平台',
    gsc: 'Google Search Console',
    bing_wmt: 'Bing Webmaster Tools',
    sogou: '搜狗站长平台（微信搜一搜底层）',
    so_360: '360 站长平台',
    baidu_tongji: '百度统计',
    manual: '人工填报',
  },

  /** 每个源是什么、能拿到什么（DR-103 要求 9 个 kind 全都有）。 */
  sourceHints: {
    baidu_ziyuan_ai:
      '灰度功能：站点验证初期看到数据空白属于正常现象。导出只有「AI 引用热门关键词」一张表带下载按钮，格式 xlsx，且没有日期列。',
    baidu_ziyuan:
      '传统搜索面：索引量与「流量与关键词」表（展现量 / 点击量 / 平均排名）。平台只开放收录推送接口，读数要靠复制或导出。',
    toutiao: '传统搜索面：关键词的展现量与点击量。新注册站点的数据提取存在延时。',
    gsc: '传统搜索面：clicks / impressions / ctr / position。AI Overviews 的数据混在 web 里、接口分不出来；数据延迟约 2~3 天。',
    bing_wmt:
      '传统搜索面：排名与流量统计、关键词明细。AI Performance 报告目前只有后台界面；接口一律走 REST（SOAP 与 POX 已于 2026-08-31 退役）。',
    sogou: '传统搜索面（二期）：微信搜一搜的底层数据。官方只有收录推送接口，没有读数接口。',
    so_360: '传统搜索面（二期）：360 搜索的关键词数据。官方只有收录推送接口，没有读数接口。',
    baidu_tongji:
      '站内分析：会话、访问与来源分析。接口权限要在百度统计后台申请、有审批；注意百度账号与百度智能云是两套体系。',
    manual: '兜底：拿不到导出也拿不到接口权限时，按周期手工填几个关键数字。没有的指标留空，不要填 0。',
  },

  /** 口径说明（DR-95：常驻可展开，不藏在问号里；分母不同的比率绝不跨平台平均）。 */
  metricNotes: {
    baidu_ziyuan_ai:
      '给五项：关键词、AI 引用量、AI 曝光量、AI 点击量、AI 点击率。点击率的分母是「引用量」而不是曝光量；入库与展示一律按「点击量 ÷ 引用量」重算，文件里那一列只作交叉校验。',
    baidu_ziyuan:
      '给的是索引量与关键词表：展现量、点击量、平均排名。展现量的计数规则与 AI 面不同，两个面默认不合并合计。',
    toutiao: '给展现量与点击量，按关键词汇总；平台不支持按目录级别查询，缺列不代表数值为 0。',
    gsc: '给 clicks / impressions / ctr / position；点击率的分母是 impressions。每种搜索类型每天最多返回 5 万行，超出部分是静默采样。',
    bing_wmt:
      '给排名与流量统计、关键词明细；AI Performance 里的 Grounding Queries 是平台独有维度，单独展示并标注平台。',
    sogou: '给展现量、点击量与点击率，点击率的分母是「查询量」（与百度 AI 面、GSC 都不同）；二期开放后按此口径接入。',
    so_360: '给关键词的展现量与点击量；口径细节以其官方文档为准，二期开放后按此接入。',
    baidu_tongji:
      '量纲是会话与访问，没有曝光这一列——这一列的缺席本身就是"量纲不可混"的物证。它的数字永不进曝光合计。',
    manual:
      '按你填的口径入库，区间标注为"由填报时确认"；填报值与平台官方口径的数字冲突时，以平台对账结果为准。',
  },

  /** 怎么把数据拿出来（DR-108 的 `alias_columns` 在界面上的那一份说明）。 */
  howToExport: {
    baidu_ziyuan_ai:
      '百度搜索资源平台 →「AI 流量分析」→「AI 引用热门关键词」表右上角的下载按钮，导出 xlsx；概览与趋势两段目前没有导出入口，请用复制粘贴。',
    baidu_ziyuan: '百度搜索资源平台 →「数据统计 → 流量与关键词」：选中表格复制，或导出 CSV 后导入。',
    toutiao: '头条搜索站长平台 →「数据统计 → 关键词」：选中表格复制；平台没有提供批量导出。',
    gsc: 'Google Search Console → Performance → Export 下载 CSV，或授权之后由接口直接拉取。',
    bing_wmt: 'Bing Webmaster Tools → Reports & Data → 对应报表导出 CSV，或授权之后由 REST 接口拉取。',
    sogou: '搜狗站长平台 →「数据统计」：选中表格复制（二期开放后同样支持粘贴与 CSV 导入）。',
    so_360: '360 站长平台 →「数据统计」：选中表格复制（二期开放后同样支持粘贴与 CSV 导入）。',
    baidu_tongji: '百度统计 →「来源分析 → 搜索引擎」：选中表格复制，或申请接口权限后由接口拉取。',
    manual: '不需要导出：在录入表单里按周期填曝光、点击与 AI 引用；没有的指标留空，不要填 0。',
  },

  /** 二期源（DR-92 `phase: 2`）：枚举与词典齐全，但界面不渲染接入入口。 */
  upcoming: {
    title: '二期数据源',
    note: '这两个源已经进了目录表与词典，界面暂不提供接入入口：渲染一个永远点不动的入口，只会让人以为是自己配错了。',
    sogou: '搜狗站长平台列为二期：官方没有读数接口，开放后按粘贴与导入两种形态接入，页面代码不用改。',
    so_360: '360 站长平台列为二期：官方没有读数接口，开放后按粘贴与导入两种形态接入，页面代码不用改。',
  },

  regions: {
    cn: '国内',
    global: '海外',
  },

  surfaces: {
    web_search: '传统搜索',
    ai_answer: 'AI 回答',
  },
  surfaceNote:
    '两个面的曝光计数规则不同（AI 面算的是"用户看到引用链接的次数"），跨面合计要显式选在一起，得到的数只作量级参考。',

  /** 三层归一的名字（DR-95 / DR-103）：措辞刻意避开「分级 / 档位」，理由见文件头。 */
  tiers: {
    a: 'A 类 · 可加',
    b: 'B 类 · 派生',
    c: 'C 类 · 平台独有',
  },
  tierNotes: {
    a: '曝光、点击与 AI 引用：跨平台是不相交的事件集合，可以求和；合计行必须带区间、参与源清单与完整性旗标。',
    b: '点击率与平均位次：只能拿 A 类求和后的分子除以分母重算，绝不对各平台的比率取平均——三家的分母各不相同（百度 AI 面除以引用量、搜狗除以查询量、GSC 除以曝光量）。',
    c: 'Bing Grounding Queries、百度引用页面量、按设备的位次、百度统计会话数：映射不上也不合并，单独展示并标注平台。',
  },

  /** 凭据形态（DR-113：与"数据怎么进来"是两个正交维度，不混成一个字段）。 */
  authModes: {
    none: '不需要授权',
    oauth: '官方接口授权',
  },

  /** 接入形态徽章（DR-93 / DR-113）。 */
  ingestModes: {
    api: '接口直连',
    file_import: '文件导入',
    paste_parse: '粘贴后台表格',
    manual_entry: '人工填报',
  },
  ingestModeNotes: {
    api: '授权之后按周期自动拉取；令牌只进系统钥匙串，库里留的是 keyring:// 引用串。',
    file_import: '吃 .xlsx 与 .csv：按表头文字认列，不要求列序。',
    paste_parse: '在你自己的后台选中整张表复制过来：我们不碰凭据、不代你登录、不绕过任何验证。',
    manual_entry: '按周期手填关键数字；没有的指标留空，不要填 0（"没有这一列"与"这一列是 0"是两个结论）。',
  },

  /** 源卡片与配置侧滑（§5.3 第 1 段）。 */
  sourceCards: {
    title: '数据源',
    hint: '一个源 = 一个平台后台。绑定值（站点地址 / 站点 ID）不是敏感信息，会存在项目里；令牌只进钥匙串。',
    configure: '配置',
    drawerTitle: '配置数据源',
    test: '自检',
    testing: '自检中',
    tested: '自检完成',
    remove: '移除',
    removed: '数据源已移除',
    saved: '数据源已保存',
    binding: '绑定',
    siteUrl: '站点地址',
    siteId: '站点 ID',
    bindingHint: '这里填的是站点在平台后台的标识，不是账号密码。',
    authModeLabel: '凭据形态',
    ingestModesLabel: '数据怎么进来',
    dataThrough: '数据截至',
    neverImported: '还没有数据',
    importedAt: '导入时间',
    checkedAt: '最近自检',
    checkDetail: '自检结论',
    neverChecked: '还没自检过',
    credentials: '凭据',
    secretRef: '钥匙串引用',
    demoCredentials: '演示模式不收任何密码与令牌：真后端才会把它写进系统钥匙串，库里只留引用串。',
    empty: '还没有接入任何数据源。',
  },

  // -------------------------------------------------------------------------
  // 自动采集状态卡（DR-116：让"自动化"是看得见的）
  // -------------------------------------------------------------------------
  stats: {
    title: '自动采集',
    hint: '主喂料永远是自动的两层：自有抽样（按关键词库向各家 AI 引擎提问并记录引用）与官方接口（授权后按周期拉取）。下面的导入、粘贴与填报是对账层，用平台官方口径的数字校准我们的抽样。',
    lastRun: '最近运行',
    neverRun: '还没有跑过采集',
    engines: '覆盖引擎数',
    queries: '覆盖 query 数',
    engineCount: '{{total}} 个引擎',
    queryCount: '{{total}} 个 query',
    tokenState: '接口授权状态',
  },

  // -------------------------------------------------------------------------
  // 汇总（§5.3 第 2 段：给数字，同时给得出这个数字的账）
  // -------------------------------------------------------------------------
  aggregate: {
    title: '跨平台汇总',
    hint: '合计行常驻三样东西：汇总区间、参与源清单与完整性旗标。一个能被追问到底的合计，才是有说服力的合计。',
    impressions: '曝光合计',
    clicks: '点击合计',
    citations: 'AI 引用合计',
    ctr: '汇总点击率',
    ctrNote: '汇总点击率 = 点击合计 ÷ 曝光合计（同面、同区间、同参与源），不是各平台点击率的算术平均。',
    windowLimited: '汇总区间 {{start}} ~ {{end}}（受 {{source}} 的数据截至日限制，已收敛到各源交集）',
    windowEmpty: '参与源没有共同的时间区间，合计仅按各自区间相加，不可比。',
    windowOverride: '按各源自己的可用区间相加（数字会偏低）',
    windowOverrideFlag: '当前没有收敛到交集区间：各源按自己的可用天数相加，合计偏低。',
    participating: '参与合计的源（{{total}}）',
    participatingToggle: '展开参与源清单',
    participatingLine: '{{source}} · 数据截至 {{through}} · {{completeness}}',
    participatingEmpty: '当前筛选下没有可参与合计的源。',
    excludedAnalytics: '站内分析组不参与这里的合计：它的量纲是会话，不是曝光。',
    crossSurface: '传统搜索 + AI 回答',
  },

  /** 筛选面（DR-112：四个维度全在前端做，筛选态刷新即重置）。 */
  filters: {
    time: '时间',
    platform: '平台',
    surface: '面',
    dimension: '维度',
    presets: {
      d7: '近 7 天',
      d28: '近 28 天',
      d90: '近 90 天',
      custom: '自定义',
    },
    allPlatforms: '全部平台',
    bothSurfaces: '两个面',
    recomputeHint: '取消勾选任一平台，合计、点击率与汇总区间都会当场按新的交集重算。',
    stateNote: '筛选状态只在当前页面有效，刷新即重置。',
  },

  /** 维度透视（DR-112 ④）。 */
  pivots: {
    query: '按关键词',
    page: '按页面',
    engine: '按平台',
  },

  // -------------------------------------------------------------------------
  // AI 引用表现（§5.3 第 3 段）
  // -------------------------------------------------------------------------
  aiOverview: {
    title: 'AI 引用表现',
    hint: '五项汇总来自百度《AI 流量分析》；其余平台的 AI 报告目前都只有后台界面，靠复制或导出带进来。',
    citations: 'AI 引用量',
    impressions: 'AI 曝光量',
    clicks: 'AI 点击量',
    ctr: 'AI 点击率',
    ctrNote: '点击率 = 点击量 ÷ 引用量（百度官方口径）；分母与 GSC、搜狗都不同，所以这个比率不与其他平台取平均。',
    citedPages: '引用页面量',
    period: '{{start}} ~ {{end}}（截至 {{through}}）',
    hotKeywords: 'AI 引用热门关键词',
    hotPages: 'AI 引用热门页面',
    empty: '还没有 AI 面数据：从百度《AI 流量分析》复制或导出一张表进来。',
  },

  /** C 类面板（DR-107：未映射字段不静默丢弃）。 */
  nativePanel: {
    title: '平台独有维度',
    hint: '映射不上的平台原生字段原样留档并在这里展示，标注来自哪个平台：我们不猜口径，也不静默丢弃。',
    examples: '例如 Bing 的 Grounding Queries、百度的引用页面量、GSC 按设备的位次、百度统计的会话数与跳出率。',
    empty: '这一批数据没有映射不上的字段。',
  },

  // -------------------------------------------------------------------------
  // 关键词曝光与点击（§5.3 第 4 段，分区标题是对账语义）
  // -------------------------------------------------------------------------
  metrics: {
    expand: '查看明细表',
    title: '关键词曝光与点击',
    hint: '同一批数据可以按关键词、按页面或按平台透视；多源合并的行会写明合并了几个平台。',
    empty: '还没有指标数据：粘贴或导入一份后台表格，合计与这张表都会跟着变。',
    multiPlatform: '{{total}} 个平台',
    columns: {
      query: '关键词',
      page: '页面',
      platform: '平台',
      impressions: '曝光',
      clicks: '点击',
      ctr: '点击率',
      citations: 'AI 引用',
      position: '平均位次',
      window: '区间',
      completeness: '完整性',
      dataThrough: '数据截至',
    },
  },

  /** 对账区（DR-116：L3 是校准层，不是主喂料）。 */
  reconcile: {
    sampleTitle: '抽样对账（L1 vs L3）',
    reconciled: '已对账',
    columns: {
      query: '关键词',
      engine: '引擎',
      l1: '自有抽样',
      l3: '平台口径',
      displayed: '展示值',
      divergence: '差异率',
      status: '对账状态',
    },
    title: '对账',
    hint: '这一区不是主喂料：用平台官方口径的数字校准我们自己的抽样。冲突时展示以平台数字为准，抽样原值保留可查。',
    notReconciled: '未经平台对账',
    notReconciledNote: '这些数字来自我们的自有抽样，还没有平台官方数据对照过；缺对账不阻断任何展示。',
    divergenceTitle: '对账差异',
    divergenceEvent:
      '{{metric}} 在 {{source}} 的口径与我们的抽样相差 {{rate}}：已按平台数字展示，抽样原值保留可查。',
    divergenceHint: '差异率超过阈值才开一条对账差异事件；平台自己给的数字对客户更有说服力，所以展示以它为准。',
    sampledSide: '我们问出来的（自有抽样）',
    platformSide: '平台记的（官方口径）',
  },

  /** 导入与粘贴（DR-98 / DR-113：粘贴是主按钮，CSV 降为次按钮）。 */
  import: {
    pasteTitle: '粘贴后台表格',
    /** 🔴 主按钮（DR-113）：粘贴是一等接入形态，不是 CSV 导入的备胎。 */
    pasteButton: '粘贴后台表格',
    pasteHint: '在平台后台选中整张表（连表头一起）复制，粘到这里：按表头文字认列，不要求列序。',
    pastePlaceholder: '把复制的表格粘在这里（TSV、HTML 表格或逗号分隔都认）',
    pasteAria: '粘贴内容',
    pasteRun: '解析并导入',
    normalizeHint:
      '千分位、百分号与中文「万」会自动归一（1.2万 → 12000）；认不出的列不会被丢掉，会原样留档到「平台独有维度」。',
    fileTitle: '导入文件',
    /**
     * 次按钮。走查清单第 6 条写的是「导入 CSV」，这里刻意多写一个 XLSX：
     * DR-98 实测百度《AI 流量分析》的官方导出**只有 xlsx**，按钮只写 CSV 等于把主用途藏起来。
     */
    fileButton: '导入 CSV / XLSX',
    fileHint: '支持 .xlsx（百度《AI 流量分析》的官方导出格式）与 .csv；一次补几个月历史数据时，文件比剪贴板合适。',
    filePick: '选择文件',
    fileRun: '导入',
    templates: '下载模板',
    templateWeb: '关键词表模板（曝光 / 点击 / 位次）',
    templateAi: 'AI 面模板（引用 / 曝光 / 点击）',
    templateAnalytics: '站内分析模板（会话 / 落地页）',
    sourceLabel: '数据源',
    sourceRequired: '请选择数据源',
    periodLabel: '数据区间',
    periodHint: '导出文件里没有日期列：请确认这份文件对应哪个区间，我们会把区间末日记成该源的数据截至日。',
    periodRequired: '请填写数据区间',
    cancel: '取消',
    ok: '导入',
    done: '已导入 {{total}} 行',
    doneWithWarnings: '已导入 {{total}} 行，其中 {{warnings}} 行带警告',
    emptyFile: '这份文件没有数据行：导入已完成，汇总数字不变。',
    errorsTitle: '导入未通过：有 {{total}} 处错误',
    errMissingColumn: '表头缺 {{column}} 列',
    errUnknownHeader: '表头认不出来：至少要有一列对得上 {{column}}',
    errInvalidNumber: '第 {{row}} 行「{{column}}」不是合法数字：{{value}}',
    errRequiredCell: '第 {{row}} 行缺「{{column}}」',
    errUnsupportedFile: '只支持 .xlsx 与 .csv：请换成这两种格式，或直接在后台复制表格走「粘贴后台表格」。',
    errEmptyPayload: '粘贴内容是空的：请连表头一起选中复制。',
    errUnknownReason: '第 {{row}} 行遇到无法识别的导入问题：{{reason}}。请把文件发给支持排查。',
    warnCtrMismatch:
      '第 {{row}} 行的点击率与重算值不一致（文件 {{given}}、重算 {{recalculated}}）：已按重算值入库，不阻断导入。',
    aliasHint: '各平台导出的列名对照写在目录表里，界面按对照认列；平台改了表头结构就报错，不猜。',
  },

  // -------------------------------------------------------------------------
  // 优化机会（§5.3 第 5 段）
  // -------------------------------------------------------------------------
  opportunity: {
    title: '优化机会',
    hint: '每条机会都写明依据数字、建议处方类别与置信度。采纳只是把它排进下一轮处方排序，不会自动生成处方。',
    empty: '还没有优化机会。',
    rule: '规则',
    rationale: '依据',
    evidence: '依据数字',
    category: '建议处方类别',
    impact: '影响',
    difficulty: '难度',
    confidence: '置信度',
    status: '状态',
    adopt: '采纳',
    ignore: '忽略',
    adopted: '已采纳：会进入下一轮处方排序（演示模式不会真的长出处方）。',
    ignored: '已忽略',
    updated: '已更新机会状态',
    toArticle: '转为文章方向',
    toPatch: '生成补丁',
    toArticleHint: '复用文章管理的「新增方向」：把这条机会的关键词与依据一起带过去。',
    toPatchHint: '复用站点接入的补丁生成：把这条机会的依据带进补丁的落点提示。',
    demoStatic: '演示模式下这 6 条是预置样本（每条规则一条）：翻状态不重算，导入数据也不会长出新机会。',
    sampleGate: '样本不足 {{min}} 个查询时，点击率那条规则不出机会：宁缺勿滥。',
    /**
     * 机会生命周期三态（键名 == `SEARCH_OPPORTUNITY_STATUS_VALUES`）。
     * 🔴 用契约的 `new` / `adopted` / `ignored`，不用 DR-94 的 `pending` / `dismissed`：
     * 契约那份已经落地，下游两个 agent 按它写 ⇒ 词典跟着契约走，别在这里改名字。
     */
    statuses: {
      new: '待处理',
      adopted: '已采纳',
      ignored: '已忽略',
    },
  },

  /** 6 条规则的名字与判据说明（DR-100，键名 == `rule_id`）。 */
  rules: {
    high_impression_low_ctr: {
      name: '曝光高、点击率低',
      hint: '曝光达到下限，但点击率低于同位次档的自身中位数 ⇒ 建议重写标题与描述（落点：站点接入）。',
    },
    demand_without_content: {
      name: '有需求、没内容',
      hint: '这个词有曝光，但关键词库里没有它、站内也没有对应主题页 ⇒ 建议补内容（落点：文章管理，并回写关键词库）。',
    },
    ai_citation_gap: {
      name: 'AI 引用缺口',
      hint: '传统搜索面这个词有点击，AI 回答面的引用量却是 0 或缺失 ⇒ 建议做信源布局（落点：行动中心）。',
    },
    landing_role_mismatch: {
      name: '落地页角色错配',
      hint: '流量集中在角色为"其他"的页面，首页与产品页没有量 ⇒ 建议调整信息架构（落点：行动中心）。',
    },
    crawl_blocked_with_demand: {
      name: '有需求却被挡住抓取',
      hint: '有曝光的页面在站点接入里标记为不可抓取，或 robots.txt 挡了 AI 爬虫 ⇒ 直接生成 robots.txt 补丁（落点：站点接入）。',
    },
    trend_divergence: {
      name: '趋势背离',
      hint: '品牌词搜索量在升而品牌覆盖率在降（或反向），差值超出区间 ⇒ 进 M5 告警。',
    },
  },

  /** 完整性三旗标（DR-110）。 */
  completeness: {
    full: '完整',
    sampled: '平台采样',
    partial: '平台自陈不全',
  },
  completenessNotes: {
    full: '这一份在平台侧是完整口径。',
    sampled:
      'GSC 每种搜索类型每天最多返回 5 万行，超出部分是静默采样：平台不报错，只是少给行，合计因此可能偏低。',
    partial:
      '平台自己说明数据不全（百度《AI 流量分析》灰度期空白、头条新站延时、搜狗不支持目录级查询）。缺列不代表数值为 0。',
  },
  completenessFlagNote:
    '非完整的源照样参与合计，但合计行会挂旗标：剔除会让合计忽大忽小（接了第三个源总数反而变小），比挂旗标更难解释。',

  /** 站点自建索引（DR-118：关键性采样，只存对本站点的观测）。 */
  selfIndex: {
    title: 'AI 引用可见性趋势（自有观测）',
    hint: '这条曲线来自我们自己对本站点的采样：每轮按关键词库向各家 AI 引擎提问，记录是否被引用。',
    noCtr: '自有观测里没有点击数据，所以这张图不提供点击率曲线；点击率请看上面的平台汇总，那是平台自己的口径。',
    boundary: '不建全网索引、不估算曝光、不做点击流：只存对本站点观测到的快照。',
    rankBandsTitle: 'SERP 位次带',
    rankBandNote: '只记位次带、不记精确名次：一次采样支撑不了精确名次，写成精确值就是假精确。',
    rounds: '{{total}} 轮观测',
    retention: '快照留存 {{days}} 天，用于同比。',
    rankBands: {
      top3: '前 3 位',
      top10: '前 10 位',
      top30: '前 30 位',
      absent: '未进前 30 位',
    },
    /** 三块采样面（键名 == `SELF_INDEX_SNAPSHOT_KIND_VALUES`）。 */
    snapshotKinds: {
      ai_citation: 'AI 引用快照',
      page_indexability: '页面可索引性快照',
      serp_rank_band: 'SERP 位次带快照',
    },
  },

  /** 点击率经验基准（DR-115：外部曲线只作冷启动参考且必须标出处）。 */
  ctrBenchmark: {
    title: '点击率基准',
    primary: '主基准是本站点同位次的自身中位数：这是你自己的数据，不引用任何外部曲线，也天然按引擎各算各的。',
    source: '参考带来自 {{org}}（{{year}}）：英文 SERP 经验值，仅供冷启动参考。',
    sourceNote: '外部曲线只作参考带、不作阈值，默认不参与判定；要启用请在设置里显式打开「冷启动参考带」。',
    enable: '启用冷启动参考带',
    disabledByDefault:
      '冷启动参考带默认关闭：几份主流研究对"排名 1 的平均点击率"给的值差近一倍，而且全是英文 SERP。',
    insufficientSample: '样本不足 {{min}} 个查询：这一条不出机会，避免拿不可比的基准去判你的页面。',
    wording: '基准只表述为"同位次经验区间"，不表述为"应该达到的点击率"。',
  },

  /** 接入建议（DR-111：不硬编码任何默认推荐，没有站内分析数据时不显示）。 */
  onboarding: {
    title: '该接哪几个平台',
    hint: '数据源的多少取决于你的站点访客用哪个引擎，所以我们不猜：接入站内分析之后，这里按你自己的流量来源给建议。',
    empty: '还没有站内分析数据：接入百度统计之后，这里会按你的流量来源分布给出建议。没有数据时不显示任何通用推荐。',
    allConnected: '分布里出现过的站长平台都已接入；搜狗 / 360 仍属二期，暂不显示入口。',
    suggestion: '你的站内流量 {{split}} ⇒ 建议优先接这 {{total}} 个站长平台。',
    later: '{{sources}} 列为二期：占比很小时可以等。',
  },

  /** 拼到关键词库行上的汇总指标标注（DR-101，走查清单第 16 条）。 */
  keywordOverlay: {
    fromPlatforms: '来自 {{total}} 个平台',
    window: '区间 {{start}} ~ {{end}}',
    withCompleteness: '来自 {{total}} 个平台 · 区间 {{start}} ~ {{end}} · {{completeness}}',
    noneNote: '拼不上站长数据的词不显示空值占位：没有数据就是没有数据，不用 0 冒充。',
  },

  /** 证据来源（DR-101：归因卡与报告都要标这组数字是谁给的）。 */
  evidenceSources: {
    model_sample: '来自我们的抽样估计',
    webmaster: '来自客户自己的站长后台',
  },

  /** 报告里的对照章节（DR-101 / DR-116：报告是要发给客户或客户老板的）。 */
  report: {
    sectionTitle: '站外数据对照',
    sectionNote: '这一章把"我们问出来的"与"平台记的"并排放：每个数字都带平台徽章、区间与完整性旗标。',
    metricBlock: '站外数据',
    attributionNote: '这组数字来自客户自己的站长后台，不是我们的抽样估计。',
  },
};

export default webmasterData;

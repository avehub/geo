/**
 * M3 多引擎采集（zh-CN）。
 *
 * # 哪些串在这里、哪些不在
 * - **界面文案**（表头、按钮、空状态、口径说明）⇒ 在这里；
 * - **数据**（轮次名 `第 2 轮 · 基线体检`、题目原文、回答全文、引用标题）⇒ 在 `demo/seed/**`，
 *   后端发什么就显示什么，en locale 下照旧是中文（AGENTS 规则 7 的「数据不入词典」）；
 * - **枚举标签**（引擎名、通道、状态、失败原因、来源类型）⇒ 键名逐字 = 枚举值本身，
 *   组件一律通过 `src/i18n/enum-label.ts` 的 `enumLabel` 查（查不到回退 id 本身、绝不回退中文）。
 *
 * # 合规（AGENTS 规则 6）
 * 采集页只陈述"采到了什么、成功率多少"，不出现任何排名承诺类表述。
 */
const collection = {
  title: '多引擎采集',
  subtitle: '7 家引擎 × 3 种采集通道，原始证据全量留存',
  // 2026-11-19 产品裁定：演示边界统一由全局 `DemoModeStrip` 说明。
  // `sampleOnly` / `staticNote` 保留为历史键，模块页不再渲染。
  sampleOnly: '演示数据每轮只收录若干条样本任务与证据，不代表全量采集结果。',
  staticNote: '成功率、耗时与 token 用量在演示模式下是预置静态值，不由前端重算。',

  board: {
    rounds: '采集轮次',
    usage: '用量看板',
    start: '排一轮采集',
    open: '查看队列与证据',
    empty: '还没有采集轮次，先排一轮。',
  },

  round: {
    label: '轮次',
    promptSet: '题库',
    promptSetVersion: '题库版本',
    engines: '引擎范围',
    repeatCount: '重复采样',
    plannedQueries: '计划查询',
    completedQueries: '已完成',
    failedQueries: '失败',
    successRate: '成功率',
    startedAt: '开始时间',
    finishedAt: '结束时间',
    grade: '样本量分级',
    metricSpec: '指标口径',
    notes: '轮次说明',
    notStarted: '已排队，等待执行。演示模式不会真的调用引擎，这一轮会停在「排队中」。',
    notStartedLive: '已排队，等待执行。',
    running: '采集进行中，下面的数字还会继续变化。',
    repeatNote: '关键题目重复采样 {{times}} 次，比率类指标按区间读，不当单点用。',
  },

  /** 轮次状态（`RoundStatus`）。 */
  statuses: {
    queued: '排队中',
    running: '采集中',
    succeeded: '已完成',
    partial: '部分完成',
    failed: '失败',
  },

  /** 任务 / 证据状态（`CollectionStatus`）。 */
  taskStatuses: {
    queued: '排队中',
    running: '进行中',
    succeeded: '成功',
    failed: '失败',
    skipped: '已跳过',
  },

  /** 引擎（`EngineId`）。zh 值照产品定义 §3.5 的引擎矩阵表。 */
  engines: {
    doubao: '豆包',
    deepseek: 'DeepSeek',
    kimi: 'Kimi',
    qwen: '通义千问',
    yuanbao: '腾讯元宝',
    baidu_ai: '百度 AI 搜索',
    metaso: '秘塔搜索',
  },

  /** 采集通道（`EngineChannel`）。 */
  channels: {
    official_api: '官方 API',
    browser_automation: '浏览器自动化',
    gateway: '网关聚合',
  },

  /** 失败原因（`FailureReason`）：进表格与筛选器，是可统计的数据而不是异常。 */
  failureReasons: {
    rate_limited: '触发限流',
    timeout: '超时',
    blocked: '被拦截',
    login_required: '需要登录',
    empty_answer: '空回答',
    transport: '传输错误',
  },

  /** 引用来源类型（`SourceType`，M4 的自动归类结果）。 */
  sourceTypes: {
    owned_page: '自有页面',
    baike: '百科词条',
    news_media: '新闻媒体',
    zhihu: '知乎',
    xiaohongshu: '小红书',
    ecommerce: '电商平台',
    official_doc: '官方文档',
    forum: '论坛社区',
    other: '其他',
  },

  engineRuns: {
    title: '各引擎执行情况',
    engine: '引擎',
    channel: '通道',
    model: '模型版本',
    planned: '计划',
    succeeded: '成功',
    failed: '失败',
    avgLatency: '平均耗时',
    promptTokens: '输入 token',
    completionTokens: '输出 token',
    empty: '这一轮还没有引擎执行记录。',
    browserNote: '浏览器自动化通道没有 token 记账，耗时也明显高于官方 API。',
  },

  tasks: {
    title: '任务队列',
    prompt: '题目',
    intent: '意图',
    engine: '引擎',
    status: '状态',
    attempt: '尝试次数',
    failureReason: '失败原因',
    finishedAt: '完成时间',
    latency: '耗时',
    retry: '重跑',
    loginAndRetry: '登录并重跑',
    retryOk: '重跑完成，证据与解析结果已入库',
    retryUnavailable: '演示数据未收录这条任务的重跑结果',
    viewRecord: '看证据',
    empty: '这一轮还没有任务。',
  },

  records: {
    title: '原始证据',
    prompt: '题目',
    intent: '意图',
    engine: '引擎',
    model: '模型版本',
    mentioned: '本品牌',
    mentionedYes: '提及',
    mentionedNo: '未提及',
    rank: '推荐位次',
    sentiment: '情感',
    citations: '引用',
    collectedAt: '采集时间',
    latency: '耗时',
    status: '状态',
    open: '查看证据',
    empty: '没有符合筛选条件的证据。',
    filterEngine: '引擎',
    filterIntent: '意图',
    filterMentioned: '是否提及',
    filterStatus: '状态',
    filterAll: '全部',
  },

  evidence: {
    title: '证据详情',
    answer: '回答全文',
    citations: '引用链接',
    domain: '引用域名',
    sourceType: '来源类型',
    screenshot: '网页截图',
    screenshotAlt: '原始页面截图',
    noScreenshot: '演示数据未包含截图；真后端会把截图与回答一起留存。',
    noScreenshotLive: '这条记录没有截图。',
    noCitations: '这条回答没有返回引用链接。',
    model: '模型版本',
    channel: '采集通道',
    collectedAt: '采集时间',
    latency: '耗时',
    tokens: 'token 用量',
    repeatIndex: '第 {{index}} 次采样',
    failed: '这条任务没有拿到回答',
  },

  usage: {
    title: '用量看板',
    round: '轮次',
    queries: '查询次数',
    promptTokens: '输入 token',
    completionTokens: '输出 token',
    totalTokens: 'token 合计',
    totalQueries: '累计查询',
    quotaQueries: '查询硬配额',
    quotaTokens: 'token 硬配额',
    quotaNotSet: '未设配额',
    quotaExceeded: '已超出硬配额，采集已自动暂停。',
    quotaProgress: '已用 {{used}} / {{quota}}',
    empty: '暂无用量数据。',
    note: '金额估算不在 MVP 范围内：这里只记查询次数与 token 用量。',
  },

  start: {
    title: '排一轮采集',
    promptSet: '选择题库',
    engines: '引擎范围',
    repeatCount: '重复采样次数',
    label: '轮次名称',
    labelPlaceholder: '留空则沿用品库名',
    submit: '排队',
    queued: '已排队：{{label}}',
    engineRequired: '至少选择一家引擎',
    accessHint: '所选引擎需要先完成接入，否则任务会以「需要登录」失败。',
    accessLink: '查看接入方式',
    accessWarning: '这些引擎尚未接入：{{engines}}。仍可排队，但对应任务会失败。',
    demoNotice: '演示模式不发请求：新轮次会停在「排队中」，任务队列为空。',
    liveNotice:
      '将使用已配置的官方 Key 真实调用：Kimi / 豆包 / 千问 / 百度走官方搜索并在结果上回答；DeepSeek 借用 Kimi/百度搜索；秘塔走官方搜索 + 当前对话模型；元宝会打开本地 Chrome，由你扫码登录后采样并截图。',
  },

  /**
   * 引擎接入（2026-11-20）：把「哪个引擎要配哪把 Key / 要不要扫码」摆到采集页上。
   *
   * 起因：豆包任务报 `login_required`，但采集页没有一个能补 Key 或扫码的入口。
   * 本段只描述**接入方式**；Key 本身仍由 `SecretStatusPanel` 直接写钥匙串（规则 3）。
   */
  access: {
    open: '引擎接入',
    title: '引擎接入',
    intro:
      '采集前先完成各引擎的接入：API Key 只写入本机系统钥匙串；腾讯元宝走浏览器扫码登录，不代登录、不绕验证码。',
    requirement: '接入要求',
    status: '状态',
    ready: '已接入',
    needsSetup: '待配置 Key',
    unknown: '未检查',
    browserLogin: '需扫码登录',
    settingsHint:
      'Key 与登录态都只留在本机；换机或重装需要重新接入。秘塔还需要「模型服务商」里当前模型的 Key。',
    openSettings: '打开设置',
    fix: '去接入',
    yuanbaoSteps:
      '元宝没有公开对话 API：排一轮包含元宝的采集时，会打开受控 Chrome 窗口，请在窗口里扫码登录（3 分钟内完成）；登录态保存在本机，之后复用。已有失败任务时，点「登录并重跑」也会打开窗口。',
    loginFailedTitle: '有 {{failed}} 条任务因「需要登录」失败',
    loginFailedDesc:
      '这些引擎还没有完成接入，或 Key 已经失效。补上 / 更新 Key 或扫码登录后，直接点对应任务的「重跑」即可，不用重排整轮。',
    loginFailedEngines: '涉及的引擎：{{engines}}',
    notes: {
      doubao: '使用「火山方舟（豆包）」的 API Key；搜索与回答共用同一把 Key。',
      deepseek: '使用 DeepSeek 的 API Key；DeepSeek 没有官方搜索接口，会借用已配置的 Kimi / 百度搜索。',
      kimi: '使用「Kimi（月之暗面）」的 API Key。',
      qwen: '使用「阿里云百炼（通义千问）」的 API Key。',
      baidu_ai: '使用「百度千帆（文心一言）」的 API Key。',
      metaso: '秘塔搜索按次计费，需要单独的搜索 API Key；回答仍使用「模型服务商」里的当前模型，它的 Key 也要配置。',
      yuanbao: '元宝走浏览器自动化：不需要 API Key，需要在本机浏览器里扫码登录。',
    },
  },

  matrix: {
    title: '引擎 × 意图覆盖矩阵',
    note: '单元格是「本品牌提及数 / 样本数」，只做计数，不做评分或排序。',
    empty: '这一轮还没有可汇总的证据。',
    cell: '{{mentioned}} / {{total}}',

    rate: '提及率',
    legend0: '0%',
    legendLow: '1–33%',
    legendMid: '34–66%',
    legendHigh: '67% 以上',
  },
};

export default collection;

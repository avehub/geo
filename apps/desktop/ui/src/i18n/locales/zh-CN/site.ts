/**
 * 站点接入与补丁工作台（M6.5 落地层，zh-CN）。
 * 设计规格 `docs/superpowers/specs/2026-09-30-site-connect-patch-bench-design.md`（DR-55）。
 *
 * # 文案合规（AGENTS 规则 6）
 * 不承诺排名与效果，也不承诺"自动改好官网"：`demoBody` 与 `staticNote` 两句必须显示——
 * 演示模式**不真下发**、页面清单与通道自检结果都是**预置静态值**。发布 / 撤回 / 回滚
 * 三个动词一律按"记账"的口径写（"记为已发布"），不写成"已改到线上"。
 *
 * # 🔴 为什么 `patchKinds` 与 `channelKinds` 要逐档写说明
 * 这两张表是产品负责人评审时唯一能看出"我们到底能改站点的哪些部分"的地方；
 * 只给一个词（"结构化标记"）等于没给。每档说明都写明**落点**与**谁能执行**。
 *
 * ⚠ 插值变量一律不叫 `count`（i18next 会走复数分支去找 `_one` / `_other`，本词典没有）。
 */
const site = {
  title: '站点接入',
  subtitle: '把行动中心的站点处方落成可下发、可撤回、可回滚的补丁台账',
  /** 常驻说明①：哪些数字是预置的（AGENTS 规则 9）。 */
  staticNote: '演示数据：页面清单与通道自检结论都是预置静态值，不是真的抓取或探测结果。',
  /** 常驻说明②：演示模式不真下发（这一句必须显示，见 spec DR-56①）。 */
  demoBody: '演示模式不会改动线上站点：发布 / 撤回 / 回滚只在本地记账，并生成可下载的交接文件。',

  /** 建站形态（`enumLabel(t, 'site.platforms', …)`）。 */
  platforms: {
    wordpress: 'WordPress',
    static: '静态站点 / 前端框架',
    custom: '自建或定制 CMS',
    saas_builder: '建站 SaaS（凡科 / 上线了 一类）',
    ecommerce: '电商店铺 / 平台页',
    unknown: '尚未确认',
  },

  /** 谁在管这个站（决定哪几条通道可行）。 */
  ownerships: {
    self: '自己管（有服务器或后台权限）',
    agency: '外包代管（客户只有部分权限）',
    no_access: '拿不到权限（只能交接）',
    unknown: '尚未确认',
  },

  /** 四条下发通道（spec DR-46）。 */
  channelKinds: {
    bundle: '落地包与交接单',
    cms: 'CMS 连接器（WordPress）',
    edge: '边缘函数（CDN）',
    repo: '代码仓库 / 编码代理',
  },

  channelStatuses: {
    not_configured: '未配置',
    pending_verify: '待自检',
    ready: '可用',
    failed: '自检未通过',
  },

  credentialsStates: {
    not_required: '不需要凭据',
    missing: '凭据未配置',
    stored: '凭据已入钥匙串',
  },

  /** 十类补丁：每档都写清"改的是站点上的哪一处"。 */
  patchKinds: {
    llms_txt: 'llms.txt（站点根目录）',
    robots_txt: 'robots.txt 放行片段',
    jsonld: 'JSON-LD 结构化标记',
    html_fragment: '页面 HTML 片段',
    meta_title: '页面标题（title）',
    meta_description: '页面描述（description）',
    canonical: '规范链接（canonical）',
    alt_text: '图片替代文本',
    internal_link: '站内链接',
    entity_consistency: '实体口径统一',
  },

  patchStatuses: {
    draft: '草案',
    published: '已发布',
    unpublished: '已撤回',
  },

  eventKinds: {
    created: '新建',
    saved: '保存草案',
    published: '发布',
    unpublished: '撤回',
    rolled_back: '回滚草案',
    exported: '导出留档',
  },

  profile: {
    title: '站点档案',
    hint: '先说清"这个站长什么样、谁能改它"，下面的通道与补丁才有落点。',
    domain: '站点域名',
    platform: '建站形态',
    ownership: '谁在管这个站',
    note: '权限与备注',
    notePlaceholder: '例如：服务器由外包代管，客户只有 CMS 后台账号，改根目录文件要提工单。',
    save: '保存档案',
    saved: '站点档案已保存',
    empty: '这个项目还没有站点档案：填一下建站形态与谁在管，就能开始记补丁。',
    domainMissing: '项目里还没有官网地址：先在项目向导第 2 步补上，站点档案的域名会自动带过来。',
    updated: '最后更新',
  },

  pages: {
    expand: '查看页面清单',
    title: '受管页面清单',
    hint: '补丁的落点从这份清单里挑，不用手打网址。真后端由爬虫发现，演示模式是预置的 6 个页面。',
    url: '页面地址',
    role: '页面角色',
    pageTitle: '页面标题',
    lastChecked: '最近自检',
    crawlable: 'AI 爬虫可抓',
    crawlableYes: '可抓',
    crawlableNo: '被挡住',
    never: '没查过',
    empty: '还没有受管页面：真后端会在采集时把发现的页面填进来。',
    roles: {
      home: '首页',
      product: '产品页',
      about: '关于页',
      qualification: '资质页',
      service: '服务页',
      news: '资讯页',
      faq: '问答页',
      other: '其它页面',
    },
  },

  channels: {
    title: '落地通道',
    hint: '同一份补丁可以走四条路落地。零凭据的落地包人人可用，其余三条要看客户手里有什么权限。',
    about: {
      bundle: '把补丁渲染成可上传的文件与一份交接单，交给站长或外包执行。不需要任何凭据，也不需要客户交出服务器权限。',
      cms: '通过 WordPress REST 接口把内容推成草稿（不直接发布）。需要站点地址、用户名与应用程序密码；演示模式不收密码。',
      edge: '生成一段边缘函数骨架与一份 patches.json，由客户贴进自己的 Cloudflare / 腾讯云 EdgeOne / 阿里云 ESA 控制台。函数在客户账号里跑，补丁数据可随时更新，不需要重新部署。',
      repo: '生成 diff 与一段交接说明，交给编码代理（Codex / Cursor 一类）或有仓库权限的同事去提合并请求。本客户端不持有代码托管平台的令牌。',
    },
    endpoint: '落点地址',
    endpointPlaceholder: {
      cms: 'https://example.com/wp-json',
      edge: 'https://www.example.com/*',
      repo: 'https://github.com/org/site-repo',
      bundle: '（落地包不需要落点地址）',
    },
    username: '后台用户名',
    note: '备注',
    save: '保存配置',
    saved: '通道配置已保存',
    test: '自检',
    testing: '自检中',
    tested: '自检完成',
    clear: '清除配置',
    cleared: '通道配置已清除',
    clearConfirm: '清除后这条通道回到「未配置」，已经挂在它上面的补丁不受影响。',
    checkedAt: '最近自检',
    checkDetail: '自检结论',
    neverChecked: '还没自检过',
    credentials: '凭据',
    secretRef: '钥匙串引用',
    demoCredentials: '演示模式不收任何密码与令牌：真后端才会把它写进系统钥匙串，库里只留引用串。',
    configTitle: '配置',
  },

  patches: {
    title: '补丁工作台',
    hint: '一条补丁 = 站点上的一处改动。草案可以随时改，发布之后仍然可以撤回或把草案回滚到上一次发布的版本。',
    generate: '从处方生成',
    add: '手动新建',
    export: '导出',
    filterStatus: '全部状态',
    filterKind: '全部类型',
    filterChannel: '全部通道',
    search: '搜索落点或标题',
    deleteSelected: '删除选中',
    deleteSelectedCount: '删除选中 {{selected}} 条',
    filtered: '显示 {{shown}} / {{total}} 条',
    empty: '还没有补丁：从行动中心的处方生成，或手动新建一条。',
    pendingChange: '有未发布的修改',
    noPendingChange: '与线上一致',
    columns: {
      title: '补丁',
      target: '落点页面',
      kind: '类型',
      status: '状态',
      channel: '通道',
      review: '审核态',
      publishedAt: '发布时间',
      updatedAt: '最后更新',
      action: '来自处方',
      neverPublished: '没发布过',
      noAction: '手动新建',
    },
    actions: {
      edit: '编辑',
      publish: '发布',
      unpublish: '撤回',
      rollback: '回滚草案',
      history: '历史',
      delete: '删除',
      toAction: '看处方',
    },
    deleteConfirmTitle: '删除补丁',
    deleteConfirmContent: '删除 {{total}} 条补丁及其历史事件。已经导出过的交接文件不会被改动。',
    deleted: '已删除 {{total}} 条补丁',
    saved: '补丁已保存',
    published: '已记为发布：线上生效要靠所选通道真的执行一次。',
    unpublished: '已记为撤回',
    rolledBack: '草案已回滚到上一次发布的版本',
    generated: '已生成 {{total}} 条补丁草案',
    publishBlocked: '先人工审核通过，再发布：AI 生成的草案默认待审。',
    rollbackDisabled: '没有可回滚的落点：这条补丁还没发布过，或草案与线上版本逐字相同。',
    // 🔴 判据是「当前**没有**生效中的线上版本」，不是「从没发布过」：已撤回的那一条也置灰
    // （后端 `unpublish` 幂等、原样返回，点它什么也不会发生 ⇒ 界面上就不给点）。
    unpublishDisabled: '这一条现在没有生效中的线上版本：只有已发布的补丁需要撤回。',
    deleteBlocked: '已发布的补丁不能直接删除：先撤回，再删除，避免审计链断掉。',
  },

  editor: {
    createTitle: '新建补丁',
    editTitle: '编辑补丁',
    kind: '补丁类型',
    titleField: '补丁标题',
    titlePlaceholder: '例如：产品页首屏补一段可被直接引用的定义句与参数表',
    targetUrl: '落点页面',
    targetHint: '贴在页面哪一块',
    targetHintPlaceholder: '例如：首屏标题之下、"产品特点"之上；参数表用真表格，不要用图片。',
    body: '补丁正文（代码或文案）',
    bodyHint: '这里放的是要贴到站点上的原文：HTML 片段、JSON-LD、robots.txt 追加段，或一段可直接引用的文案。',
    channel: '走哪条通道',
    review: '人工审核',
    save: '保存',
    cancel: '取消',
    requiredTitle: '补丁标题不能为空',
    requiredTarget: '落点页面不能为空',
    requiredBody: '补丁正文不能为空',
    pickPage: '从受管页面清单里挑',
    historyTitle: '历史事件',
    noHistory: '这条补丁还没有历史事件。',
  },

  generate: {
    title: '从处方生成补丁草案',
    hint: '演示模式不调模型：下面这些候选来自预置模板，生成后一律是「草案 + 待人工审核」。',
    action: '选择处方',
    kinds: '要生成哪几类补丁',
    none: '（这条处方没有预置的补丁模板）',
    run: '生成',
    cancel: '取消',
    emptyHint: '这条处方没有可用的补丁模板，可以关掉弹窗手动新建一条。',
    alreadyAll: '这条处方的补丁已经都在台账里了，没有新增。',
    sourceLayout: '这条处方的落点在站外平台（百科词条、行业媒体、B2B 平台），不在站点通道范围内。',
  },

  history: {
    title: '补丁历史',
    empty: '还没有事件。',
    channel: '通道',
    note: '备注',
    at: '时间',
  },

  export: {
    title: '导出落地文件',
    hint: '导出物在前端组装，落盘走既有的导出通道。中文界面导出中文交接单，切到英文再导出就是英文的。',
    kind: '导出什么',
    kinds: {
      bundle: '交接单（Markdown）',
      llms_txt: 'llms.txt',
      robots_txt: 'robots.txt 放行片段',
      patches_json: 'patches.json（边缘函数用）',
      worker_js: '边缘函数骨架（JS）',
      ledger_csv: '补丁台账留档（CSV）',
    },
    about: {
      bundle: '给站长或外包照着做的那一份：每条补丁一节，含落点、贴在哪、原文与验收动作。只收已人工审核通过的补丁。',
      llms_txt: '站点根目录的 llms.txt。只收已审核通过的同类补丁；一条都没有时按钮置灰。',
      robots_txt: '追加到站点根目录 robots.txt 的放行段。只收已审核通过的同类补丁。',
      patches_json: '边缘函数实时拉取的那份数据。只收已发布的补丁——把草案塞进去等于绕过人工审核。',
      worker_js: '一段可读的边缘函数骨架：逻辑在客户侧、补丁数据在 patches.json 里，改补丁不需要重新部署。',
      ledger_csv: '一行一条补丁的台账，给"哪一处改动在什么时候被记为发布"留证据。',
    },
    download: '下载',
    downloaded: '已导出：{{path}}',
    fileName: '文件名',
    lines: '共 {{total}} 行',
    disabled: '这个导出物现在没有内容',
    disabledHint: '按上面的筛选口径（审核通过 / 已发布），当前一条可用的补丁都没有。',
    llmsTxtNote: 'llms.txt 目前主要被开发者工具与部分检索层读取；消费级 AI 助手未必读取它，所以 robots.txt 放行与服务端可见的正文同样重要。',
    bundleTitle: '站点整改交接单',
    bundleDisclaimer: '本交接单由稿得快 GEO 客户端生成。所列改动均需在客户确认后执行；执行完成请回填日期与负责人，并保留改动前后的截图。',
    bundleCount: '共 {{total}} 条待执行改动。',
    bundleTarget: '落点页面',
    bundleKind: '补丁类型',
    bundleChannel: '建议通道',
    bundleStatus: '台账状态',
    bundleReview: '人工审核',
    bundleHint: '贴在哪',
    bundleAction: '来自处方',
    bundleVerify: '验收动作：改完在无痕窗口打开落点页面，查看源码确认这一段已经在里面；把截图与日期回填到本文件对应小节。',
    workerNote1: '边缘函数骨架：按 patches.json 把已发布的补丁叠加到站点响应上（逻辑在你自己的云账号里跑）。',
    workerNote2: '落点：Cloudflare Workers 直接新建一个 Worker 并绑定路由；腾讯云 EdgeOne 用「边缘函数 + 触发规则」；阿里云 ESA 用「边缘程序」。三家都支持这里用到的 fetch 与字符串处理。',
    workerNote3: '凭据纪律：本客户端不代管任何云账号令牌。部署时在你自己的控制台里操作，改完补丁只需要更新 patches.json，不需要重新部署函数。',
  },
};

export default site;

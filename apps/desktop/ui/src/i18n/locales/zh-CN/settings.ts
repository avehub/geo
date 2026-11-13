/**
 * 设置页文案。按**消费者**分块（不再按任务号描述——组件层与页面层都已落地）：
 * `providers.*` / `providerForm.*` / `proxy.*` / `secret.*` 由组件层消费
 * （`ProviderSelect.tsx` / `ProxyForm.tsx` / `SecretStatus.tsx`），`page.*` 由
 * `pages/SettingsPage.tsx` 消费。en-US 侧同结构、同键集（`i18n/index.test.ts` 的 R-G 双向断言钉住）。
 *
 * # `providers.*` 的键名 = 后端稳定 id，zh 值 = `LlmProvider::label_zh()` 逐字相同
 *
 * 计划正文那条"控制器裁定"点名了这条泄漏：`ProviderSelect` 原先直接渲染后端给的
 * `ProviderInfo.label_zh`，英文 locale 下仍是中文——而组件扫描只查 CJK **字面量**，抓不到它。
 * 改成查 `settings.providers.<id>`；查不到时回退 **provider id 本身**，**绝不回退 `label_zh`**
 * （回退它就等于把泄漏面原地留着）。哨兵断言在 `src/components/ProviderSelect.test.tsx`。
 *
 * 🔴 键集今天一共 **12** 个（Plan B Task 4 / DR-33）：前 6 个 + `custom` 逐字取自
 * `crates/geo-llm/src/provider.rs` 的 `LlmProvider::as_str()`；中间 5 个中转站是 **demo 独有**
 * （Rust 侧本轮零改动 ⇒ 桌面端会少这 5 项，差异 E-47）。顺序由 `demo/seed.test.ts` 与
 * `components/ProviderSelect.test.tsx` 双向钉住：6 家国内厂商 → 5 家中转站 → `custom` 末位。
 *
 * `ProviderInfo.label_zh` 字段本身**不删**（删它要连带改 demo 种子、`src/test/fixtures.ts`、
 * Task 11/14），Park 到 Plan B/C；但 UI 侧任何代码都不再读它。
 *
 * # `providers`（复数）与 `providerForm` 刻意分开
 *
 * `providers.*` 的键名来自后端数据、集合被契约冻结；`providerForm.*` 是这个表单自己的
 * label 与提示。混在一个 `provider` 对象里会让"哪些键是动态拼出来的"看不出来。
 */
const settings = {
  providers: {
    deep_seek: 'DeepSeek（深度求索）',
    moonshot: 'Kimi（月之暗面）',
    volcengine_ark: '火山方舟（豆包）',
    ali_bailian: '阿里云百炼（通义千问）',
    baidu_qianfan: '百度千帆（文心一言）',
    tencent_hunyuan: '腾讯混元',
    /**
     * 🔴 下面 5 家是 **demo 独有**的中转站（Plan B Task 4 / DR-33）：Rust 的
     * `LlmProvider::all()` 今天只有上面 7 个 ⇒ 桌面端的厂商清单会少这 5 项（差异 E-47）。
     * zh 值带一句括号说明，让"这是中转站而不是厂商"在界面上一眼可辨；
     * 每条都 **> 4 字**——`pages/en-us-page-residual.test.tsx` 把种子里 ≤4 字的中文串
     * 逐字钉死（M-1 闸门），短名会把减法放行面撑开。
     */
    openrouter: 'OpenRouter（海外模型聚合）',
    siliconflow: '硅基流动（SiliconFlow）',
    '302ai': '302.AI（AI 应用超市）',
    yunwu: '云雾 API（中转站）',
    deepbricks: 'DeepBricks（API 中转）',
    /**
     * 🔴 从「自定义（OpenAI 兼容）」改成「自定义服务商」（spec §9-A 授权的文案改动）：
     * 协议现在**可选**（`settings.protocols` 两档），把「OpenAI 兼容」写死在厂商名里
     * 就与新行为自相矛盾。en 侧同批从 'Custom (OpenAI-compatible)' 改成 'Custom'。
     */
    custom: '自定义服务商',
  },

  /**
   * 模型协议（Plan B Task 4 · DR-34）。键名 == `api/types-llm.ts` 的 `MODEL_PROTOCOL_VALUES`，
   * 是 `enumLabel` 的命名空间（守卫在 `i18n/enum-label-prefixes.test.ts`）⇒ 这一块里
   * **只放枚举标签**，控件自己的 label 与提示放在 `providerForm` 下面。
   *
   * 🔴 只有「自定义服务商」才用得上：预设厂商与中转站走哪种协议由后端固定，
   * 给它们一个能改的下拉等于允许用户改出一个连不上的配置（判据在 `ProviderSelect.test.tsx`）。
   */
  protocols: {
    openai_compat: 'OpenAI 兼容',
    anthropic: 'Anthropic 原生',
  },

  providerForm: {
    provider: '模型服务商',
    baseUrl: '接口地址',
    /**
     * 选「自定义」时那个输入框的占位提示。原先硬编码在 `components/ProviderSelect.tsx` 上：
     * 全 ASCII ⇒ 两遍 CJK 残留扫描都看不见它，但它确实会上屏（与 `project.wizard.*Placeholder`
     * 同性质）。值**逐字搬进词典、不改文案**（加「例如：」前缀属改文案，AGENTS 规则 8 要产品负责人先点头）。
     */
    baseUrlPlaceholder: 'https://api.example.com/v1',
    baseUrlHint: '已带入官方默认地址，可按需修改；企业网关或代理也可填这里。',
    baseUrlCustomHint: '自定义服务商必填，需以 http:// 或 https:// 开头。',
    defaultModelHintWithModel: '留空时使用默认模型 {{model}}',
    defaultModelHintCustom: '自定义服务商没有默认模型，请填写模型名',
    protocol: '模型协议',
    protocolHint: '自定义服务商按哪种协议发请求；预设厂商与中转站的协议由后端固定。',
  },

  /**
   * 「服务商与连接」+「模型配置」两张卡的说明（2026-11-06 飞书式重排）。
   * API Key 紧跟在接口地址之后，避免用户先在下方点「拉取模型列表」才被告知没配 Key。
   */
  modelForm: {
    connectionDesc: '选择服务商，填写接口地址与 API Key。',
    apiKey: 'API Key',
    apiKeyHint: '拉取模型列表与测试连接都使用这里保存的 Key。',
    modelDesc: '填写模型名，或从服务商拉取可用模型列表。',
  },

  /**
   * 「拉取模型列表」（Plan B Task 4 · DR-34）。
   *
   * 🔴 `hint` 里那句"演示模式不发请求"是**常驻**的，不是只在失败时才说：
   * demo 端的是预置清单（`seed/model-catalogs.ts`），走查的人必须随时看得出这是假数据。
   * `resultPreset` / `resultUpstream` 两句对应 `ModelsListResult.source` 的两档——
   * 刻意**不**做成 `enumLabel` 命名空间（那会多一个前缀），因为只有两档且各自要说的话不同。
   */
  modelList: {
    fetch: '拉取模型列表',
    fetching: '正在拉取…',
    hint: '按当前的厂商、协议与接口地址取回可用模型名。演示模式不发请求，取回的是预置清单。',
    resultPreset: '已取回 {{total}} 个预置模型名',
    resultUpstream: '已从接口取回 {{total}} 个模型名',
    empty: '没有取回模型名。演示模式不访问外部接口，自定义服务商请直接手输模型名。',
    hintLive: '按当前的厂商、协议与接口地址取回可用模型名。',
    emptyLive: '没有取回模型名；请检查服务商配置，或直接手输模型名。',
    keepTyped: '拉取失败不会清掉你已经填的模型名。',
  },

  proxy: {
    enable: '启用代理',
    /**
     * 代理地址输入框的占位提示（#54）。与 `project.wizard.websitePlaceholder`（#47）、
     * `settings.providerForm.baseUrlPlaceholder`（#25）**同性质、同裁定**：原先硬编码在
     * `components/ProxyForm.tsx` 上，全 ASCII ⇒ 两遍 CJK 残留扫描都看不见它，但它确实会上屏。
     * 值**逐字搬进词典、不改文案**（加「例如：」这种前缀属改文案，AGENTS 规则 8 要先经产品负责人点头）。
     */
    placeholder: 'http://127.0.0.1:7890',
    invalidUrl: '代理地址需以 http:// / https:// / socks5:// 开头',
    hint: '抓取官网与调用模型都会走这个代理；改动在应用重启后生效。',
  },

  /**
   * API Key 管理（AGENTS.md 规则 3：Key 只进系统钥匙串，库里只留引用串）。
   * `testFailed` 只是 `LlmTestResult.message` 为 null 时的兜底；后端给了 message 时仍原样显示
   * ——那是**后端产出自然语言**的第三处泄漏（前两处是 `label_zh` 与 notes 散文行），
   * 已记进 task-8-report.md 的 backlog，本任务不越界改契约。
   */
  secret: {
    reading: '读取中',
    readFailed: '读取钥匙串状态失败',
    configured: '已配置',
    notConfigured: '未配置',
    placeholder: '请输入 API Key',
    emptyWarning: '请先输入 API Key',
    save: '保存到钥匙串',
    test: '测试连接',
    delete: '删除 Key',
    saved: 'API Key 已写入系统钥匙串',
    deleted: 'API Key 已删除',
    testFailed: '连接失败',
    hint: 'Key 只保存在本机系统钥匙串，数据库里只留引用串；换机或重装需要重新填写。',
    result: {
      model: '模型',
      latency: '耗时',
      usage: '用量',
    },
  },

  /**
   * 设置页左侧二级菜单的分段名（Plan B · spec DR-27 / §6）。
   *
   * 键名 = 路由里的**稳定 slug**（`/settings/:section`），不是 index：重排不会静默错位。
   * 🔴 没有「扩展」这一组（产品负责人 2026-09-29 裁定 4：skill 安装与导入、客服机器人推二期，
   * 连置灰占位都不留）。清单本身在 `pages/settings/sections.ts`，两侧同批增删。
   */
  sections: {
    general: '通用',
    models: '模型服务商',
    collection: '采集与频控',
    storage: '数据与存储',
    about: '关于',
  },

  /**
   * 通用段（Plan B Task 3 · spec §6 / DR-29 / DR-32）。
   *
   * 🔴 `themes` / `fontScales` / `permissions` 三块是 **enumLabel 的命名空间**：
   * 键名必须与 `theme/appearance.ts` 的 `THEME_MODES` / `FONT_SCALES`、
   * `api/types-app.ts` 的 `PERMISSION_STATE_VALUES` 逐字相等（守卫在
   * `i18n/enum-label-prefixes.test.ts`）。查不到时 `enumLabel` 回退**裸 id**，
   * 绝不回退中文——那会把"词典漏了一档"从显眼的机器记号变成静默的中文串。
   */
  appearance: {
    card: '外观',
    theme: '主题',
    fontScale: '字体大小',
    hint: '外观只作用于本机，不写进项目数据；切换即时生效。',
  },

  themes: {
    light: '浅色',
    dark: '深色',
    system: '跟随系统',
  },

  fontScales: {
    sm: '小',
    md: '标准',
    lg: '大',
  },

  /**
   * 语言（DR-32）：**两个**语言，两个字段，刻意不联动。
   *
   * - `ui` → `preferences.locale`（`zh-CN` / `en-US`，界面语言，标签走 `common.languages`）；
   * - `content` → `settings.language`（`zh_cn` / `en_us`，**生成内容**的语言）。
   * 界面用英文、内容生成中文是完全合法的组合，所以两者各自一个控件、各写各的字段。
   * （旧版把 `settings.language` 标成"界面语言"是**错标**，本轮改掉。）
   */
  languageGroup: {
    card: '语言',
    ui: '界面语言',
    uiHint: '菜单、按钮与提示所用的语言，切换即时生效。',
    content: '生成内容语言',
    contentHint: '题库、文稿与报告默认用这种语言生成；与界面语言互不影响。',
    contentZhCn: '简体中文',
    contentEnUs: '英文',
  },

  /** 系统权限状态标签（`enumLabel(t, 'settings.permissions', state)`；键名 == `PERMISSION_STATE_VALUES`）。 */
  permissions: {
    granted: '已允许',
    denied: '已拒绝',
    not_determined: '尚未询问',
    unsupported: '当前环境不支持',
  },

  permissionsCard: {
    title: '权限与隐私',
    systemTitle: '系统权限',
    openSystemSettings: '去系统设置',
    desktopOnly: '系统权限由桌面端申请，演示模式下不可用。',
    liveHint: '系统权限由操作系统管理；一键跳转将在后续版本提供。',
  },

  /** 系统权限名（`Permissions` 的三个键）。不是 enumLabel 命名空间：键名来自契约，逐条显式 `t()`。 */
  permissionItems: {
    notification: '通知',
    files_and_folders: '文件与文件夹',
    screen_recording: '屏幕录制',
  },

  /**
   * 数据与存储段（Plan B Task 5 · spec §6 / DR-35）。数据全部来自 `app_environment`。
   *
   * 🔴 `hint` 与 `desktopOnly` 两句是**如实描述**，不是免责声明：demo 里这些路径
   * 是 `demo/handlers/app-environment.ts` 端出来的一组静态值，浏览器既没有那个目录、
   * 也打不开访达。少任何一句，走查的人都会以为"点一下就能打开"。
   * 两个按钮照旧渲染但置灰（与 M7 对 docx/pdf/png 同一口径），Plan C 再加
   * `storage_open_dir` / `storage_change_dir` 两条命令。
   */
  storage: {
    dataDir: '数据目录',
    dbPath: '数据库文件',
    dbSize: '数据库大小',
    screenshotsDir: '截图目录',
    logDir: '日志目录',
    exportDir: '导出目录',
    exportDirNone: '还没有导出过',
    migrations: '已应用的迁移',
    openDir: '打开目录',
    openFailed: '打开目录失败',
    changeDirLater: '更改数据目录将在后续版本提供。',
    changeDir: '更改目录',
    desktopOnly: '目录操作由桌面端提供，演示模式下不可用。',
    hint: '演示模式不读写磁盘，下面是桌面端将使用的位置与一份示例占用。',
    liveHint: '下面是你这台机器上的真实数据目录、数据库与日志位置。',
  },

  /**
   * 关于段（Plan B Task 5）。
   *
   * 🔴 **没有**「扩展」相关的任何键（裁定 4：skill 安装与导入、客服机器人推二期，
   * 连置灰占位都不留）。判据在 `pages/settings/AboutSection.test.tsx`：中英两侧各扫一遍，
   * 「扩展 / skill / 客服机器人」出现任何一个就红。
   * `licensesValue` 两侧同值——它是一串专有名词，与 `providerForm.baseUrlPlaceholder`
   * 同一处理方式（语言无关的值也进词典，为的是不在组件里留硬编码界面文案）。
   */
  about: {
    version: '版本',
    build: '构建号',
    licenses: '开源许可',
    licensesValue: 'React · Ant Design · Tauri · SQLite（sqlx）· reqwest · i18next',
    phase2: '本轮为演示版本；桌面端专属能力与后续功能会在正式版本中提供。',
  },

  /**
   * 设置页自身的文案（Task 9，`pages/SettingsPage.tsx`）。
   *
   * `page.*` 与上面几个块刻意分开：`providers` / `providerForm` / `proxy` / `secret` 是
   * **组件层**（Task 8 抽的）在用的键，`page` 是页面骨架自己的标题、卡片名、label 与 toast。
   *
   * ⚠ `languageZhCn` 与 `project.wizard.languageZhCn` 值相同但**不合并**：前者是设置页里
   * `AppSettings.language`（**生成内容的语言**，P0-A 只有 `zh_cn` 一档）的唯一选项，
   * 后者是建项向导第 4 步的项目语言字段。两个字段将来会各自演化。
   */
  page: {
    title: '设置',
    loadFailed: '读取设置失败',
    environmentFailed: '读取本机环境失败',
    saved: '设置已保存；代理与超时改动将在重启后生效',
    modelCard: '服务商与连接',
    modelConfigCard: '模型配置',
    modelName: '模型名',
    modelNamePlaceholder: '留空则使用默认模型',
    modelNameRequired: '自定义服务商必须填写模型名，否则自动建档等 AI 功能会降级。',
    temperature: '温度',
    timeoutSeconds: '超时（秒）',
    proxyCard: '网络代理',
    crawlerCard: '采集并发与频控',
    searchKeyCard: '秘塔搜索 API Key',
    searchKeyHint:
      '秘塔搜索按次计费。Key 只写入系统钥匙串；Kimi / 豆包 / 千问 / 百度复用上方模型服务商 Key。',
    crawlerHint: '这些取值给 P0-B 的采集队列用。默认刻意保守：目标是别被引擎封，不是跑得快。',
    maxParallel: '最大并发',
    queueSize: '队列长度',
    requestsPerMinute: '每分钟请求数',
    minIntervalMs: '最小间隔（毫秒）',
    retryMax: '重试次数',
    notifyCard: '通知',
    notifyOnFinish: '任务完成时通知',
    notifyOnRisk: '发现风险时通知',
    notifySound: '播放提示音',
    save: '保存设置',
    discard: '放弃修改',
    unsaved: '有未保存的修改',
  },
};

export default settings;

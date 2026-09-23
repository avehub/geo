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
 * 改成查 `settings.providers.<id>`，7 个 id 逐字取自 `crates/geo-llm/src/provider.rs` 的
 * `LlmProvider::as_str()`；查不到时回退 **provider id 本身**，**绝不回退 `label_zh`**
 * （回退它就等于把泄漏面原地留着）。哨兵断言在 `src/components/ProviderSelect.test.tsx`。
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
    custom: '自定义（OpenAI 兼容）',
  },

  providerForm: {
    baseUrl: '接口地址',
    /**
     * 选「自定义」时那个输入框的占位提示。原先硬编码在 `components/ProviderSelect.tsx` 上：
     * 全 ASCII ⇒ 两遍 CJK 残留扫描都看不见它，但它确实会上屏（与 `project.wizard.*Placeholder`
     * 同性质）。值**逐字搬进词典、不改文案**（加「例如：」前缀属改文案，AGENTS 规则 8 要产品负责人先点头）。
     */
    baseUrlPlaceholder: 'https://api.example.com/v1',
    baseUrlHint: 'OpenAI 兼容服务，需以 http:// 或 https:// 开头；必填',
    baseUrlReadonly: '接口地址：',
    defaultModel: '默认模型',
    defaultModelHint: '想换模型在下方「模型名」里填，留空即用默认模型',
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
    saved: '设置已保存；代理与超时改动将在重启后生效',
    modelCard: '模型服务商',
    modelName: '模型名',
    modelNamePlaceholder: '留空则使用默认模型',
    temperature: '温度',
    timeoutSeconds: '超时（秒）',
    proxyCard: '网络代理',
    crawlerCard: '采集并发与频控',
    crawlerHint: '这些取值给 P0-B 的采集队列用。默认刻意保守：目标是别被引擎封，不是跑得快。',
    maxParallel: '最大并发',
    queueSize: '队列长度',
    requestsPerMinute: '每分钟请求数',
    minIntervalMs: '最小间隔（毫秒）',
    retryMax: '重试次数',
    languageCard: '语言与通知',
    uiLanguage: '界面语言',
    languageZhCn: '简体中文',
    languageHint: 'P0-A 只做中文，多语言列 P1',
    notifyOnFinish: '任务完成时通知',
    notifyOnRisk: '发现风险时通知',
    notifySound: '播放提示音',
    save: '保存设置',
    discard: '放弃修改',
    unsaved: '有未保存的修改',
  },
};

export default settings;

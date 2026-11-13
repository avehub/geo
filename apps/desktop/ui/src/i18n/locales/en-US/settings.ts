import type { ResourceBundle } from '../../resources';

/**
 * 设置页（组件层部分）。键集由 zh-CN 侧钉死（R-G）。
 *
 * `providers.*` 的键名是厂商的稳定 id；en 值用各服务商的通用英文名，
 * 括号里的中文品牌名不再复述（英文界面里它是噪音）。UI 侧不再读 `ProviderInfo.label_zh`。
 * 🔴 12 个键里前 7 个逐字来自 `LlmProvider::as_str()`，后 5 个中转站是 demo 独有（DR-33 / E-47）。
 */
const settings: ResourceBundle['settings'] = {
  providers: {
    deep_seek: 'DeepSeek',
    moonshot: 'Kimi (Moonshot)',
    volcengine_ark: 'Volcengine Ark (Doubao)',
    ali_bailian: 'Alibaba Cloud Bailian (Qwen)',
    baidu_qianfan: 'Baidu Qianfan (ERNIE Bot)',
    tencent_hunyuan: 'Tencent Hunyuan',
    // 5 relay gateways (Plan B Task 4 / DR-33): demo-only, the Rust enum still has 7 members
    // (divergence E-47). English labels are the brand names alone and stay pure ASCII, so the
    // en-US residual guard keeps finding exactly two intentional CJK values in the dictionary.
    openrouter: 'OpenRouter',
    siliconflow: 'SiliconFlow',
    '302ai': '302.AI',
    yunwu: 'Yunwu API',
    deepbricks: 'DeepBricks',
    // Was 'Custom (OpenAI-compatible)': the protocol is now a choice (settings.protocols),
    // so pinning one protocol into the provider name contradicts the new behaviour.
    custom: 'Custom',
  },

  /**
   * Model protocols (Plan B Task 4 · DR-34). Keys == `MODEL_PROTOCOL_VALUES` in
   * `api/types-llm.ts`; this is an `enumLabel` namespace, so it holds enum labels only.
   */
  protocols: {
    openai_compat: 'OpenAI-compatible',
    anthropic: 'Anthropic native',
  },

  providerForm: {
    provider: 'Model provider',
    baseUrl: 'Base URL',
    // 与 zh-CN 同批新增（#25）：值逐字相同——示例地址语言无关，搬进词典是为了不留硬编码界面文案。
    baseUrlPlaceholder: 'https://api.example.com/v1',
    baseUrlHint:
      'Prefilled with the official default. You can change it, for example to an enterprise gateway or proxy.',
    baseUrlCustomHint: 'Required for a custom provider; must start with http:// or https://.',
    defaultModelHintWithModel: 'Leave blank to use the default model {{model}}',
    defaultModelHintCustom: 'A custom provider has no default model; enter a model name',
    protocol: 'Model protocol',
    protocolHint:
      'How a custom provider receives requests. The protocol of presets and relays is fixed by the backend.',
  },

  /**
   * Copy for the “provider and connection” + “model settings” cards (2026-11-06 Feishu-style
   * re-layout). The API key sits directly below the base URL so users do not have to click
   * “Fetch model list” before learning that no key is configured.
   */
  modelForm: {
    connectionDesc: 'Choose a provider, then fill in the base URL and API key.',
    apiKey: 'API Key',
    apiKeyHint: 'Fetching the model list and testing the connection both use the key saved here.',
    modelDesc: 'Enter a model name, or fetch the available models from the provider.',
  },

  /**
   * “Fetch model list” (Plan B Task 4 · DR-34). The demo-sends-no-requests note lives in `hint`
   * and is always on screen, not only on failure: the list is preset data and reviewers must be
   * able to see that at a glance.
   */
  modelList: {
    fetch: 'Fetch model list',
    fetching: 'Fetching…',
    hint: 'Fetches the model names available for the current provider, protocol and base URL. The demo sends no requests: the list is preset data.',
    resultPreset: 'Fetched {{total}} preset model names',
    resultUpstream: 'Fetched {{total}} model names from the endpoint',
    empty: 'No model names were returned. The demo never calls external endpoints; for a custom provider, type the model name yourself.',
    hintLive: 'Fetches the model names available for the current provider, protocol and base URL.',
    emptyLive: 'No model names were returned. Check the provider configuration, or type the model name yourself.',
    keepTyped: 'A failed fetch keeps the model name you already typed.',
  },

  proxy: {
    enable: 'Enable proxy',
    // 与 zh-CN 同批新增（#54）：值逐字相同——示例地址语言无关，搬进词典是为了不留硬编码界面文案。
    placeholder: 'http://127.0.0.1:7890',
    invalidUrl: 'The proxy URL must start with http://, https:// or socks5://',
    hint: 'Site crawling and model calls both go through this proxy. Changes take effect after the app restarts.',
  },

  secret: {
    reading: 'Loading',
    readFailed: 'Could not read the keychain status',
    configured: 'Configured',
    notConfigured: 'Not configured',
    placeholder: 'Enter the API key',
    emptyWarning: 'Enter an API key first',
    save: 'Save to keychain',
    test: 'Test connection',
    delete: 'Delete key',
    saved: 'The API key was stored in the system keychain',
    deleted: 'The API key was deleted',
    testFailed: 'Connection failed',
    hint: 'The key is stored only in this machine’s system keychain; the database keeps just a reference. Enter it again after moving machines or reinstalling.',
    result: {
      model: 'Model',
      latency: 'Latency',
      usage: 'Usage',
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
    general: 'General',
    models: 'Model providers',
    collection: 'Collection and rate limits',
    storage: 'Data and storage',
    about: 'About',
  },

  /**
   * 通用段（Plan B Task 3 · spec §6 / DR-29 / DR-32）。
   *
   * 🔴 `themes` / `fontScales` / `permissions` 三块是 **enumLabel 的命名空间**：
   * 键名必须与 `theme/appearance.ts` 的 `THEME_MODES` / `FONT_SCALES`、
   * `api/types-app.ts` 的 `PERMISSION_STATE_VALUES` 逐字相等（守卫在
   * `i18n/enum-label-prefixes.test.ts`）。
   */
  appearance: {
    card: 'Appearance',
    theme: 'Theme',
    fontScale: 'Font size',
    hint: 'Appearance applies to this machine only and is never written into project data. Changes take effect immediately.',
  },

  themes: {
    light: 'Light',
    dark: 'Dark',
    system: 'Follow the system',
  },

  fontScales: {
    sm: 'Small',
    md: 'Standard',
    lg: 'Large',
  },

  /**
   * 语言（DR-32）：**两个**语言，两个字段，刻意不联动。
   * en 侧的语言名一律 ASCII（`en-us-page-residual.test.tsx` 把 en 词典里含 CJK 的值钉成恰好 2 条）。
   */
  languageGroup: {
    card: 'Language',
    ui: 'Interface language',
    uiHint: 'The language of menus, buttons and messages. Switching takes effect immediately.',
    content: 'Generated content language',
    contentHint:
      'Prompt libraries, drafts and reports are generated in this language. It is independent of the interface language.',
    contentZhCn: 'Simplified Chinese',
    contentEnUs: 'English',
  },

  /** 系统权限状态标签（`enumLabel(t, 'settings.permissions', state)`；键名 == `PERMISSION_STATE_VALUES`）。 */
  permissions: {
    granted: 'Allowed',
    denied: 'Denied',
    not_determined: 'Not asked yet',
    unsupported: 'Not available here',
  },

  permissionsCard: {
    title: 'Permissions and privacy',
    systemTitle: 'System permissions',
    openSystemSettings: 'Open System Settings',
    desktopOnly: 'System permissions are requested by the desktop app; they are not available in the demo.',
    liveHint: 'System permissions are managed by the operating system; one-click navigation ships in a later release.',
  },

  /** 系统权限名（`Permissions` 的三个键）。不是 enumLabel 命名空间：键名来自契约，逐条显式 `t()`。 */
  permissionItems: {
    notification: 'Notifications',
    files_and_folders: 'Files and folders',
    screen_recording: 'Screen recording',
  },

  /**
   * Data and storage (Plan B Task 5 · DR-35). Everything comes from `app_environment`.
   * `hint` and `desktopOnly` are statements of fact: in the demo these paths are static values
   * and the browser has neither the folder nor a way to open Finder.
   */
  storage: {
    dataDir: 'Data directory',
    dbPath: 'Database file',
    dbSize: 'Database size',
    screenshotsDir: 'Screenshots',
    logDir: 'Logs',
    exportDir: 'Exports',
    exportDirNone: 'Nothing has been exported yet',
    migrations: 'Migrations applied',
    openDir: 'Open folder',
    openFailed: 'Could not open the folder',
    changeDirLater: 'Changing the data folder will be available in a later version.',
    changeDir: 'Change folder',
    desktopOnly: 'Folder actions are provided by the desktop app and are unavailable in the demo.',
    hint: 'The demo neither reads nor writes the disk. These are the locations the desktop app will use, with a sample size.',
    liveHint: 'These are the real data, database and log locations on this machine.',
  },

  /**
   * About (Plan B Task 5).
   * 🔴 No extension-related keys at all (ruling 4: skill install/import and the support bot are
   * deferred to the next phase, with no disabled placeholder either).
   */
  about: {
    version: 'Version',
    build: 'Build',
    licenses: 'Open-source licenses',
    licensesValue: 'React · Ant Design · Tauri · SQLite (sqlx) · reqwest · i18next',
    phase2: 'This is a demo build. Desktop-only capabilities and later features ship in the full release.',
  },

  page: {
    title: 'Settings',
    loadFailed: 'Failed to read the settings',
    environmentFailed: 'Failed to read the local environment',
    saved: 'Settings saved. Proxy and timeout changes take effect after the app restarts.',
    modelCard: 'Provider and connection',
    modelConfigCard: 'Model settings',
    modelName: 'Model name',
    modelNamePlaceholder: 'Leave blank to use the default model',
    modelNameRequired:
      'A custom provider requires a model name; otherwise AI features such as auto-build will fall back.',
    temperature: 'Temperature',
    timeoutSeconds: 'Timeout (seconds)',
    proxyCard: 'Network proxy',
    crawlerCard: 'Crawler concurrency and rate limits',
    searchKeyCard: 'Metaso search API key',
    searchKeyHint:
      'Metaso charges per query. The key is stored in the system keychain only; Kimi, Doubao, Qwen and Baidu reuse the model provider key above.',
    crawlerHint:
      'These values feed the P0-B crawl queue. The defaults are deliberately conservative: the goal is to avoid being blocked by the engines, not to run fast.',
    maxParallel: 'Max parallelism',
    queueSize: 'Queue length',
    requestsPerMinute: 'Requests per minute',
    minIntervalMs: 'Minimum interval (ms)',
    retryMax: 'Retries',
    notifyCard: 'Notifications',
    notifyOnFinish: 'Notify when a task finishes',
    notifyOnRisk: 'Notify when a risk is found',
    notifySound: 'Play a sound',
    save: 'Save settings',
    discard: 'Discard changes',
    unsaved: 'You have unsaved changes',
  },
};

export default settings;

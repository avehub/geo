import type { ResourceBundle } from '../../resources';

/**
 * 设置页（组件层部分）。键集由 zh-CN 侧钉死（R-G）。
 *
 * `providers.*` 的键名是 `LlmProvider::as_str()` 的稳定 id；en 值用各服务商的通用英文名，
 * 括号里的中文品牌名不再复述（英文界面里它是噪音）。UI 侧不再读 `ProviderInfo.label_zh`。
 */
const settings: ResourceBundle['settings'] = {
  providers: {
    deep_seek: 'DeepSeek',
    moonshot: 'Kimi (Moonshot)',
    volcengine_ark: 'Volcengine Ark (Doubao)',
    ali_bailian: 'Alibaba Cloud Bailian (Qwen)',
    baidu_qianfan: 'Baidu Qianfan (ERNIE Bot)',
    tencent_hunyuan: 'Tencent Hunyuan',
    custom: 'Custom (OpenAI-compatible)',
  },

  providerForm: {
    baseUrl: 'Base URL',
    // 与 zh-CN 同批新增（#25）：值逐字相同——示例地址语言无关，搬进词典是为了不留硬编码界面文案。
    baseUrlPlaceholder: 'https://api.example.com/v1',
    baseUrlHint: 'OpenAI-compatible service; must start with http:// or https://. Required.',
    baseUrlReadonly: 'Base URL:',
    defaultModel: 'Default model',
    defaultModelHint:
      'To use another model, fill in “Model name” below; leave blank to use the default model',
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

  page: {
    title: 'Settings',
    loadFailed: 'Failed to read the settings',
    saved: 'Settings saved. Proxy and timeout changes take effect after the app restarts.',
    modelCard: 'Model provider',
    modelName: 'Model name',
    modelNamePlaceholder: 'Leave blank to use the default model',
    temperature: 'Temperature',
    timeoutSeconds: 'Timeout (seconds)',
    proxyCard: 'Network proxy',
    crawlerCard: 'Crawler concurrency and rate limits',
    crawlerHint:
      'These values feed the P0-B crawl queue. The defaults are deliberately conservative: the goal is to avoid being blocked by the engines, not to run fast.',
    maxParallel: 'Max parallelism',
    queueSize: 'Queue length',
    requestsPerMinute: 'Requests per minute',
    minIntervalMs: 'Minimum interval (ms)',
    retryMax: 'Retries',
    languageCard: 'Language and notifications',
    uiLanguage: 'Interface language',
    languageZhCn: 'Simplified Chinese',
    languageHint: 'P0-A ships Chinese only; more languages are scheduled for P1',
    notifyOnFinish: 'Notify when a task finishes',
    notifyOnRisk: 'Notify when a risk is found',
    notifySound: 'Play a sound',
    save: 'Save settings',
    discard: 'Discard changes',
    unsaved: 'You have unsaved changes',
  },
};

export default settings;

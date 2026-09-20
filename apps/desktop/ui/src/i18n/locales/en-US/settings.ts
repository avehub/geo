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
    baseUrlHint: 'OpenAI-compatible service; must start with http:// or https://. Required.',
    baseUrlReadonly: 'Base URL:',
    defaultModel: 'Default model',
    defaultModelHint:
      'To use another model, fill in “Model name” below; leave blank to use the default model',
  },

  proxy: {
    enable: 'Enable proxy',
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
      cost: 'Cost',
    },
  },
};

export default settings;

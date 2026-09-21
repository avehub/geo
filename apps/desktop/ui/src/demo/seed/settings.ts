/**
 * 种子：应用设置 + 内置服务商预设（简报 §A-5 / §A-6 / §A-7）。
 *
 * ⚠ 本文件与 `src/store/preferences.ts`（界面语言的 zustand 单例）、
 * 与词典的 `settings` namespace（设置页的**界面文案**）**都没有关系**：
 * 这里是 `settings_get` / `llm_providers` 两条命令要回的**数据**。
 *
 * # 真值源（逐字抄录，不许自己编）
 * - provider 表 = `crates/geo-llm/src/provider.rs` 的 `LlmProvider::all()`，
 *   **顺序即界面顺序**；`label_zh` = `LlmProvider::label_zh()`（前端 UI 已不读它，
 *   Task 8 起一律走 `t('settings.providers.<id>')`，但字段必须存在且填对——它是后端真值源的镜像，
 *   漂移守卫在 `src/demo/seed.test.ts`）。
 * - `ProviderInfo` 只有 `input_per_mtok` / `output_per_mtok` 两个价格字段（**没有** cache_hit）；
 *   Q4 决议是不展示价目/记账 ⇒ 价格**照填但 UI 不显示**，不要因为"不展示"就填 0 或删字段。
 * - `AppSettings` 各默认值 = `crates/geo-store/src/settings.rs` 的 `impl Default`。
 *
 * # 🔴 `model.provider` 必须写归一化后的稳定 id
 * `geo-store` 的默认值是别名字符串 `"deepseek"`，但 `settings_service.rs` 的 `settings_get`
 * 会经 `canonical_provider(...)` 归一化成 `LlmProvider::as_str()` ⇒ **前端拿到的永远是
 * `'deep_seek'`（带下划线）**。demo 是假后端、直接对前端说话，所以这里必须写归一化之后的值：
 * 写错成 `'deepseek'` 的话 `ProviderSelect` 查词典会落空、回退成裸 id 显示，
 * 而这个 bug **只在 demo 里看得见**（真后端会归一化）——典型的"假后端失真"。
 *
 * # 🔴 两个"语言"不是一回事（§A-7）
 * `AppSettings.language` 是**生成内容的语言**，取值 `'zh_cn'`（下划线，P0-A 只有这一档）；
 * **界面语言**是 `src/i18n` 的 `'zh-CN' | 'en-US'`（连字符），由 `preferences` 单独持久化。
 * 两者本轮**不同步**（那是产品决定）。
 */
import type { DemoSettings } from '../types';

export const SEED_SETTINGS: DemoSettings = {
  app: {
    proxy: null,
    concurrency: { max_parallel: 3, queue_size: 200 },
    rate_limit: { requests_per_minute: 20, min_interval_ms: 1500, retry_max: 3 },
    model: {
      provider: 'deep_seek',
      model: null,
      base_url: null,
      temperature: 0.3,
      timeout_secs: 60,
    },
    language: 'zh_cn',
    notify: { on_finish: true, on_risk: true, sound: false },
  },
  providers: [
    {
      provider: 'deep_seek',
      label_zh: 'DeepSeek（深度求索）',
      base_url: 'https://api.deepseek.com/v1',
      default_model: 'deepseek-chat',
      input_per_mtok: 2,
      output_per_mtok: 8,
    },
    {
      provider: 'moonshot',
      label_zh: 'Kimi（月之暗面）',
      base_url: 'https://api.moonshot.cn/v1',
      default_model: 'moonshot-v1-8k',
      input_per_mtok: 12,
      output_per_mtok: 12,
    },
    {
      provider: 'volcengine_ark',
      label_zh: '火山方舟（豆包）',
      base_url: 'https://ark.cn-beijing.volces.com/api/v3',
      default_model: 'doubao-1-5-pro-32k-250115',
      input_per_mtok: 0.8,
      output_per_mtok: 2,
    },
    {
      provider: 'ali_bailian',
      label_zh: '阿里云百炼（通义千问）',
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      default_model: 'qwen-plus',
      input_per_mtok: 0.8,
      output_per_mtok: 2,
    },
    {
      provider: 'baidu_qianfan',
      label_zh: '百度千帆（文心一言）',
      base_url: 'https://qianfan.baidubce.com/v2',
      default_model: 'ernie-4.0-8k-latest',
      input_per_mtok: 120,
      output_per_mtok: 120,
    },
    {
      provider: 'tencent_hunyuan',
      label_zh: '腾讯混元',
      base_url: 'https://api.hunyuan.cloud.tencent.com/v1',
      default_model: 'hunyuan-turbos',
      input_per_mtok: 3.2,
      output_per_mtok: 9.6,
    },
    {
      provider: 'custom',
      label_zh: '自定义（OpenAI 兼容）',
      base_url: '',
      default_model: '',
      input_per_mtok: 0,
      output_per_mtok: 0,
    },
  ],
};

/**
 * 种子：应用设置 + 内置服务商预设（简报 §A-5 / §A-6 / §A-7）。
 *
 * ⚠ 本文件与 `src/store/preferences.ts`（界面语言的 zustand 单例）、
 * 与词典的 `settings` namespace（设置页的**界面文案**）**都没有关系**：
 * 这里是 `settings_get` / `llm_providers` 两条命令要回的**数据**。
 *
 * # 真值源（逐字抄录，不许自己编）
 * - provider 表的**前 7 条** = `crates/geo-llm/src/provider.rs` 的 `LlmProvider::all()`，
 *   **顺序即界面顺序**；`label_zh` = `LlmProvider::label_zh()`（前端 UI 已不读它，
 *   Task 8 起一律走 `t('settings.providers.<id>')`，但字段必须存在且填对——它是后端真值源的镜像，
 *   漂移守卫在 `src/demo/seed.test.ts`）。
 * - 🔴 **后 5 条（中转站）不在那份真值源里**：Plan B Task 4 / DR-33 先在 demo 里加，
 *   Rust 侧本轮零改动 ⇒ 桌面端的厂商清单今天会少这 5 项（差异 E-47）。
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
      /**
       * 🔴 `protocol` **不是** Rust 默认值的镜像（`crates/geo-store` 的 `ModelConfig` 里还没有
       * 这个字段，差异 E-48）：它是 Plan B Task 4 先在 demo 里冻结的契约（DR-34）。
       * 默认 `openai_compat`——今天全部 11 家预设厂商走的都是这一种。
       */
      protocol: 'openai_compat',
      temperature: 0.3,
      timeout_secs: 60,
    },
    language: 'zh_cn',
    notify: { on_finish: true, on_risk: true, sound: false },
    /**
     * 🔴 这两段**不是** Rust 默认值的镜像（`crates/geo-store/src/settings.rs` 里根本没有它们）：
     * 隐私开关与导出目录是 Plan B 先在 demo 里定的形状，落库要等 Plan C（差异 E-48）。
     * 默认值刻意保守：只有"诊断结果上报"默认关（它含竞品与归因语料，四项里最敏感）。
     */
    privacy: {
      share_entity_card: true,
      share_prompts: true,
      share_crawled_text: true,
      share_diagnostics: false,
    },
    storage: { last_export_dir: null },
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
    /**
     * ---- 5 家中转站（Plan B Task 4 · DR-33）----
     *
     * 🔴 这 5 条**不在** `LlmProvider::all()` 里：Rust 侧本轮零改动，桌面端今天会少这 5 项
     * （差异 E-47，与 M3–M7 那 20 条 demo 独有命令同一族：demo 先冻结契约，Rust 后跟）。
     * 每条都有自己的 provider id ⇒ 有自己的钥匙串位（`keyring://llm/openrouter`），多家 Key 可并存。
     *
     * `base_url` 逐字取各家公开文档里的 **OpenAI 兼容根路径**（`/v1` 结尾，不是
     * `/chat/completions`——填全路径是最常见的接不上原因，形状判据在 `demo/seed.test.ts`）。
     * 价格一律填 **0**：中转站的价格随上游模型浮动，填具体数字就是编数据（与 `custom` 同口径；
     * Q4 决议本来也不上屏价目，字段照留是契约冻结）。
     */
    {
      provider: 'openrouter',
      label_zh: 'OpenRouter（海外模型聚合）',
      base_url: 'https://openrouter.ai/api/v1',
      default_model: 'openai/gpt-4o',
      input_per_mtok: 0,
      output_per_mtok: 0,
    },
    {
      provider: 'siliconflow',
      label_zh: '硅基流动（SiliconFlow）',
      base_url: 'https://api.siliconflow.cn/v1',
      default_model: 'deepseek-ai/DeepSeek-V3',
      input_per_mtok: 0,
      output_per_mtok: 0,
    },
    {
      provider: '302ai',
      label_zh: '302.AI（AI 应用超市）',
      base_url: 'https://api.302.ai/v1',
      default_model: 'gpt-4o',
      input_per_mtok: 0,
      output_per_mtok: 0,
    },
    {
      provider: 'yunwu',
      label_zh: '云雾 API（中转站）',
      base_url: 'https://yunwu.ai/v1',
      default_model: 'gpt-4o-mini',
      input_per_mtok: 0,
      output_per_mtok: 0,
    },
    {
      provider: 'deepbricks',
      label_zh: 'DeepBricks（API 中转）',
      base_url: 'https://api.deepbricks.ai/v1',
      default_model: 'gpt-4o',
      input_per_mtok: 0,
      output_per_mtok: 0,
    },
    /**
     * `custom` **永远排在最后一位**（顺序判据在 `demo/seed.test.ts` 与 `ProviderSelect.test.tsx`）。
     *
     * 🔴 `label_zh` 从「自定义（OpenAI 兼容）」改成「自定义服务商」（spec §9-A 授权的文案改动）：
     * 协议现在是**可选**的（`openai_compat` / `anthropic`），把「OpenAI 兼容」写死在厂商名里
     * 就与新行为自相矛盾。词典两侧同批改（en 从 'Custom (OpenAI-compatible)' 改成 'Custom'）。
     * zh 值刻意 **> 4 字**：`en-us-page-residual.test.tsx` 把种子里 ≤4 字的中文串逐字钉死
     * （M-1 闸门），而「自定义」这三个字与界面标签同形，正是那道闸门要拦的形状。
     */
    {
      provider: 'custom',
      label_zh: '自定义服务商',
      base_url: '',
      default_model: '',
      input_per_mtok: 0,
      output_per_mtok: 0,
    },
  ],
};

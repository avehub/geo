/**
 * 种子：每家厂商 / 中转站的**预置模型名清单**（Plan B Task 4 · DR-34）。
 *
 * # 这份数据是干什么的
 * `llm_models_list` 在 demo 里不发任何网络请求（AGENTS 规则 2），它端的就是这张表：
 * 界面上点「拉取模型列表」→ 加载态 → 模型名下拉变成这里的清单，`source` 标成 `'preset'`
 * 并上屏一句"演示模式不发请求"。真后端读 `{base_url}/models` 成功时回 `source: 'upstream'`。
 *
 * # 🔴 键集 == 厂商预设 id 集合**去掉 `custom`**（漂移守卫在 `demo/handlers/llm-models.test.ts`）
 * `custom` 没有清单可言：用户填的是他自己的网关，demo 又不去访问它 ⇒ 回空数组，
 * 界面据此给一句"请直接手输模型名"，而不是一个静默的空下拉。
 * 反过来，厂商表里多一家而这张表漏一家 ⇒ 守卫红。
 *
 * # 🔴 值一律是 ASCII 机器记号
 * 模型名是要**原样发给上游**的 id，不是给人看的文案 ⇒ 不进词典、也不该有中文。
 * 全 ASCII 还有一层实际收益：`pages/en-us-page-residual.test.tsx` 会把 `demo/seed/**`
 * 里所有含 CJK 的字符串收进"减法清单"，这张表一条都不贡献，放行面不会因此变宽。
 *
 * # 清单怎么挑的（不是穷举，是"每家三个代表"）
 * 每家取 3~4 个**该家文档里长期在架**的名字，覆盖"对话 / 推理 / 长上下文或开源大杯"三种用途，
 * 够走查时看出下拉形态即可；各家真实在架模型随时间变动，穷举一份必然过期。
 * 中转站那 5 家取的是它们**聚合后**的常见入口名（OpenRouter 是 `厂商/模型` 的带斜杠形式，
 * SiliconFlow 是 `组织/模型`），这正是中转站与直连厂商在使用上的差别，值得在界面上看得见。
 *
 * 🔴 每家的 `default_model`（`seed/settings.ts`）必须能在自己这份清单里找到，
 * 否则"默认模型"与"拉回来的清单"各说各话（判据在 `demo/seed.test.ts`）。
 */

/** provider 稳定 id → 该家预置的模型名清单。数组顺序即下拉顺序。 */
export const SEED_MODEL_CATALOGS: Record<string, string[]> = {
  // ---- 6 家国内厂商（id 逐字取自 `crates/geo-llm/src/provider.rs` 的 `as_str()`）----
  deep_seek: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
  moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-instruct'],
  volcengine_ark: [
    'doubao-1-5-pro-32k-250115',
    'doubao-1-5-lite-32k-250115',
    'doubao-pro-128k-240615',
  ],
  ali_bailian: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen2.5-72b-instruct'],
  baidu_qianfan: ['ernie-4.0-8k-latest', 'ernie-3.5-8k', 'ernie-speed-128k'],
  tencent_hunyuan: ['hunyuan-turbos', 'hunyuan-pro', 'hunyuan-standard'],

  // ---- 5 家中转站（DR-33：demo 独有，Rust 侧还没有对应枚举成员，差异 E-47）----
  openrouter: [
    'openai/gpt-4o',
    'anthropic/claude-3.5-sonnet',
    'deepseek/deepseek-chat',
    'meta-llama/llama-3.1-70b-instruct',
  ],
  siliconflow: [
    'deepseek-ai/DeepSeek-V3',
    'Qwen/Qwen2.5-72B-Instruct',
    'THUDM/glm-4-9b-chat',
  ],
  '302ai': ['gpt-4o', 'claude-3-5-sonnet-20241022', 'deepseek-chat'],
  yunwu: ['gpt-4o-mini', 'claude-3-haiku-20240307', 'gemini-1.5-flash'],
  deepbricks: ['gpt-4o', 'deepseek-v3', 'claude-3-5-sonnet'],
};

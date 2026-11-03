/**
 * 模型服务商族的 DTO（Plan B Task 4 · spec DR-33 / DR-34）。
 *
 * 与 M3–M7 那五个 `types-*.ts` 同一个拆法：`api/types.ts` 已经超过 500 行，
 * 新增一族契约就单开一个模块，再由 `types.ts` 末尾 `export *` 汇总
 * ⇒ 调用方照旧只 `import … from '../api/types'`，不必知道拆分细节。
 *
 * # 🔴 这一族**Rust 侧今天还不存在**
 * `ModelProtocol` 与 `llm_models_list` 都是 demo 先冻结的契约（AGENTS 规则 8 的
 * "demo 优先"），桌面端点进来是 `ipc/unknown_command`；`ModelConfig.protocol` 在
 * `crates/geo-store` 的 `ModelConfig` 里也还没有对应字段。差异登记在
 * `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`（E-46 起）。
 * 与 M3–M7 那 20 条 demo 独有命令是同一套做法：**demo 先冻结契约，Rust 后跟**。
 *
 * # 为什么不复用 `llm_providers`（DR-34 的裁定理由）
 * `llm_providers` 回的是 `ProviderInfo[]`——**厂商目录**（每家的地址、默认模型、价目）；
 * `llm_models_list` 回的是"**某一套具体配置下**有哪些模型名"。塞进同一条命令会让它的
 * 返回形状变成联合类型，两个问题也就此绑死：换一次接口地址就得重取整份厂商目录。
 */

/**
 * 自定义服务商的模型协议（DR-34）。
 *
 * 🔴 **只有 `custom` 需要选**：6 家国内厂商与 5 家中转站走哪种协议由后端固定
 * （今天全是 OpenAI 兼容），给用户一个能改的下拉等于允许他改出一个连不上的配置。
 * 预设厂商的协议在界面上**不出现**（不是置灰，判据在 `ProviderSelect.test.tsx`）。
 *
 * 键名即 `settings.protocols.<id>` 的词典键（`enumLabel`，守卫在
 * `i18n/enum-label-prefixes.test.ts`），也是落库值 ⇒ 一律 snake_case。
 */
export type ModelProtocol = 'openai_compat' | 'anthropic';

/** 运行时清单：契约外的值由 `demo/handlers/shared.ts` 的 `asModelProtocol` 收敛到第一项。 */
export const MODEL_PROTOCOL_VALUES = ['openai_compat', 'anthropic'] as const;

/**
 * 清单来源。demo 恒为 `'preset'`（AGENTS 规则 2：测试与 demo 都不联网）；
 * `'upstream'` 是真后端**读 `{base_url}/models` 成功**时该回的值。
 *
 * 🔴 这个字段不是摆设：界面按它换一句话（"预置清单" vs "从接口取回"），
 * 于是"demo 演的是假数据"这件事在界面上一直看得见，不会被走查的人当成真结果。
 */
export type ModelsListSource = 'preset' | 'upstream';

/**
 * `llm_models_list` 的入参 = **界面上的草稿配置**（DR-34），不是已落库那份。
 *
 * 🔴 这与 `llm_provider_test` 刻意**不同**：那条读的是库里已保存的设置
 * （`settings_service.rs` 的 `client_for` 读 `self.get()`，因此"不先保存就测"测的是旧值，
 * 是已知用户 bug #5）。拉模型名列表没有理由重蹈覆辙——用户正在填的地址就该拿它去拉。
 *
 * `api_key` 是**可选的临时 Key**：AGENTS 规则 3 要求 Key 只进系统钥匙串，
 * 所以界面今天恒传 `null`（demo 的 Key 从不经这条命令出去），真后端在 Plan C 里
 * 自己去钥匙串读。它出现在契约里只是为了让"将来要带 Key"这件事不需要再改一次命令签名。
 */
export interface LlmModelsQuery {
  provider: string;
  protocol: ModelProtocol;
  base_url: string | null;
  api_key?: string | null;
}

/** `llm_models_list` 的返回：模型名清单 + 它的来源。 */
export interface ModelsListResult {
  models: string[];
  source: ModelsListSource;
}

/**
 * 设置 / 厂商预设 / 连通性测试这 4 条命令的内存实现（Task 14 · 简报 §A-7）。
 * 真值源 `apps/desktop/src-tauri/src/services/settings_service.rs`（下称 service）：
 * `settings_get` ← `get()`(:111-118)、`settings_update` ← `update()`(:124-141)、
 * `llm_providers` ← `providers()`(:143-149)、`llm_provider_test` ← `provider_test()`(:196-245)
 * 与 `client_for()`(:248-263)。
 *
 * # 为什么 `llm_*` 两条也在这个文件（简报 §A-7）
 * 计划正文只点名了 `settings.ts` / `secret.ts` / `export.ts`。`llm_providers` 与
 * `llm_provider_test` 读的都是**同一份** `db.settings.providers`（厂商预设表），而在 Rust 侧
 * `provider_test` 本来就是 `SettingsService` 的方法、与 `get()/update()` 同一个模块 ⇒ 放一起。
 * `secret.ts` 只 import 本文件的 `requireKnownProvider`（`parse_provider` 的替身），依赖单向。
 *
 * # 🔴 读写不对称是**故意的**（简报 A-3 · service:111-141）
 * - **读宽容**：`get()` 一律归一化 `model.provider`，注释逐字「库里存了认不出的值就
 *   **回落默认厂商**，不让应用起不来」；回落只发生在**返回值**上，不回写库。
 * - **写严格**：`update()` 先体检后落库，任何一项越界就**整批拒绝**。
 *
 * # 🔴 只镜像两条体检（简报 A-4；其余每条都进了报告的异常表）
 * `validate_settings()`(:292-386) 一共 12 项判据，demo 只镜像两项：
 * ① `model.provider` 认不出（成员清单**直接读 `db.settings.providers`**，不新造任何常量）；
 * ② `language` 空白。
 * 不镜像的：7 个数值区间(:30-36) + `MAX_MODEL_NAME_CHARS`(:41)（要在前端另造镜像常量，必漂）、
 * `model.base_url` 的 `invalid_format`/`invalid_url`(:355-362) 与 `proxy.url` 的
 * `required`/`invalid_format`(:369-386)（前两条属 spec G5，那条链路要重新设计）。
 * demo 演的是**错误契约**，不当校验器（§B-2③ 的口径）⇒ 越界值一律放行。
 *
 * # 🔴 两级错误模型不许合并（简报 A-2 · service:196-245 的文档注释逐字）
 * 「没配 Key / 配置不全属于**用户要修的问题**，返回错误让前端引导；
 *   网络不通、限流、5xx 属于**测试结果**，用 `ok=false` + 中文原因回给界面」
 * ⇒ `Err`(reject) 与 `ok=false`(resolve) 是两条不同的路。本轮只演 `Err` 那一支
 * （`llm/missing_secret`）+ 成功支；`ok=false` 需要一个「失败注入开关」⇒ 不演（归 Plan B）。
 * 也因此 `LlmTestResult.message` 在 demo 里**恒为 null**——它装的是中文原因，
 * 写进来就踩门禁 7（本目录非注释 CJK 必须为 0）。
 *
 * # 🔴 用户 bug #5 在这里**原样复现**，刻意不修（简报 A-2 末段）
 * `client_for`(:248-263) 读的是 `self.get().await?`——**已落库**的设置；而设置页是草稿式
 * （`SettingsPage.tsx:87` 的 `settings = draft ?? settingsQuery.data`，点「保存设置」才落库）
 * ⇒「不先保存就测」测的是旧值。demo 的 `llm_provider_test` 读的正是 `settings_update` 写的
 * 那同一份库，行为与桌面端一致；在 demo 里"修好"它会造成两侧分歧（违反 AGENTS 规则 8 的初衷）。
 * 修它归 spec G5。复现步骤写在报告 §F-4。
 *
 * # 🔴 不做成本记账（AGENTS 规则 9）
 * `cost_cny` 恒为 0：`ProviderInfo` 的 `input_per_mtok`/`output_per_mtok` 读都不读
 * （Q4 决议不展示价目/记账；那两个字段照端种子值，只是**契约冻结**不许删）。
 * 也不镜像 `CONNECTIVITY_PROMPT`(service:26) 那句中文提示词——demo 不发请求。
 */
import type { AppSettings, LlmTestResult } from '../../api/types';
import type { DemoDb, DemoHandler } from '../types';
import { demoError } from '../types';
import { getDemoDb } from '../db';
import { withLatency } from '../latency';
import { asBoolean, asNumber, asRecord, asString, cleanOptional } from './shared';

/**
 * `LlmProvider::default()` 的 `as_str()`：`crates/geo-llm/src/provider.rs:67` 的 `#[default]`
 * 落在 `DeepSeek` 上，`#[serde(rename_all = "snake_case")]` ⇒ 稳定 id **带下划线**。
 * 读设置时认不出的值一律回落它（service:111-118）。
 */
const DEFAULT_PROVIDER = 'deep_seek';

/** 计划正文逐字的那套连通性测试假象：600ms 延迟 + 固定用量，成本恒 0（理由见文件头）。 */
const LLM_TEST_LATENCY_MS = 600;
const LLM_TEST_PROMPT_TOKENS = 12;
const LLM_TEST_COMPLETION_TOKENS = 4;
const LLM_TEST_COST_CNY = 0;

/** 厂商预设表的成员清单（简报 A-4：直接读种子那 7 条，不另造常量）。 */
function providerIds(db: DemoDb): string[] {
  return db.settings.providers.map((info) => info.provider);
}

/**
 * `canonical_provider`(service:286-288) 的替身：认得出就回稳定 id，认不出回 `null`。
 *
 * ⚠ **有据偏离**：真值源走 `LlmProvider::parse`(provider.rs:121-141)，它先把输入
 * trim / 转小写 / 去掉 `_`-`-`与空白，再查 12 条 `PROVIDER_ALIASES` ⇒ `deepseek` / `Deep Seek` /
 * `kimi` 都认。demo 是**逐字相等**判定（成员清单就是预设表那 7 个稳定 id）：
 * 镜像那套归一化就要在前端另造一份别名表（必漂），而 UI 只会发稳定 id
 * （`ProviderSelect` 的选项就来自 `llm_providers`）⇒ 手填别名这条路在界面上不可达。
 */
function canonicalProvider(db: DemoDb, raw: string): string | null {
  return providerIds(db).includes(raw) ? raw : null;
}

/**
 * `parse_provider`(service:270-279) 的替身：**命令入参**认不出 ⇒ `llm/config` + 两键。
 *
 * 🔴 与 `settings_update` 的表单体检（`validation/failed` + 三键）是**同一份数据、只是 code 不同**
 * （注释逐字：「前者走命令入参，后者走表单字段校验」）⇒ 两个 code **绝不混用**。
 * `secret.ts` 的三条命令也走这里（依赖单向：secret → settings，与 Rust 侧同一个 `SettingsService` 对应）。
 */
export function requireKnownProvider(db: DemoDb, raw: string): string {
  const canonical = canonicalProvider(db, raw);
  if (canonical === null) {
    throw demoError('llm/config', { reason: 'unknown_provider', value: raw });
  }
  return canonical;
}

/**
 * `Option<String>` 入参的收窄：非字符串一律 `null`，**不在这里 trim**
 * ——trim 是 `update()` 的第 ③ 步（service:130-132），顺序照抄。
 */
function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * 把 `Record<string, unknown>` 收窄成一份**完整**的 `AppSettings`。
 *
 * §B-2③ 的口径：脏字段/缺字段一律收敛到合法形状，不在这里当校验器（体检只有 `canonicalProvider`
 * 与 `language` 那两条）。真后端由 serde 在 IPC 边界**拒绝**半包；页面本来就整包提交
 * （设置是段落化存储，半包会把没改的段落冲掉，见 `SettingsPage.tsx` 的头注释）。
 * 数值走 `asNumber`（非有限数 ⇒ 0）⇒ 越界值能存进内存库，这是**已知代价**（异常表 E-13）。
 */
function settingsFromUnknown(raw: Record<string, unknown>): AppSettings {
  const concurrency = asRecord(raw.concurrency);
  const rateLimit = asRecord(raw.rate_limit);
  const model = asRecord(raw.model);
  const notify = asRecord(raw.notify);
  const proxyRaw = raw.proxy;
  const proxy = typeof proxyRaw === 'object' && proxyRaw !== null ? asRecord(proxyRaw) : null;

  return {
    // `proxy` 是 `Option<ProxyConfig>`：null 就是 null，不收窄成一份空配置。
    proxy:
      proxy === null
        ? null
        : { enabled: asBoolean(proxy.enabled), url: asNullableString(proxy.url) },
    concurrency: {
      max_parallel: asNumber(concurrency.max_parallel),
      queue_size: asNumber(concurrency.queue_size),
    },
    rate_limit: {
      requests_per_minute: asNumber(rateLimit.requests_per_minute),
      min_interval_ms: asNumber(rateLimit.min_interval_ms),
      retry_max: asNumber(rateLimit.retry_max),
    },
    model: {
      provider: asString(model.provider),
      model: cleanOptional(model.model),
      base_url: cleanOptional(model.base_url),
      temperature: asNumber(model.temperature),
      timeout_secs: asNumber(model.timeout_secs),
    },
    language: asString(raw.language),
    notify: {
      on_finish: asBoolean(notify.on_finish),
      on_risk: asBoolean(notify.on_risk),
      sound: asBoolean(notify.sound),
    },
  };
}

/**
 * 库里那份设置的**归一化副本** = `get()`(service:111-118)。
 *
 * 🔴 两个消费者，正好对应真值源的两处：`settings_get` 直接端它出去；
 * `llm_provider_test` 也读它，因为 `client_for`(:249) 读的就是 `self.get().await?`
 * ⇒ 用户 bug #5 的「测的是已保存值」在 demo 里结构性成立（见文件头）。
 * 归一化只作用于**返回值**：库里那个坏值原样留着（真值源也不回写）。
 */
function storedSettings(db: DemoDb): AppSettings {
  const settings = structuredClone(db.settings.app);
  settings.model.provider = canonicalProvider(db, settings.model.provider) ?? DEFAULT_PROVIDER;
  return settings;
}

/** `settings_get`：读是宽容的（认不出的 provider 回落默认厂商，不让应用起不来）。 */
export const settingsGet: DemoHandler = () => storedSettings(getDemoDb());

/**
 * `settings_update`：写是严格的（service:124-141 那六步，顺序照抄）。
 * ① 体检 → ② 归一化 → ③ trim `proxy.url` → ④ trim `language` → ⑤ 落库 → ⑥ 回归一化后的那份。
 */
export const settingsUpdate: DemoHandler = (args) => {
  const db = getDemoDb();
  const next = settingsFromUnknown(asRecord(args.settings));

  // ①+② 体检与归一化。真值源这里是**两步同一个判据**：`validate_settings` 的
  // `canonical_provider(...).is_none()`(:330-332) 与 `update()` 的
  // `canonical_provider(...).ok_or_else(|| unknown_provider_validation(...))`(:127-129)，
  // 两者的 code 与 params 逐字相同 ⇒ demo 合成一次调用（第二道在真值源里同样不可达）。
  const canonical = canonicalProvider(db, next.model.provider);
  if (canonical === null) {
    // 三键（:281-283 的 `with_param("value", raw)`）：`value` 装**用户填的原串**。
    throw demoError('validation/failed', {
      field: 'model.provider',
      reason: 'unknown_provider',
      value: next.model.provider,
    });
  }
  next.model.provider = canonical;

  // ① 的第二条（:344-346）：`language` 空白 ⇒ 两键。⚠ 顺序照抄，provider 那条在前。
  if (next.language.trim() === '') {
    throw demoError('validation/failed', { field: 'language', reason: 'required' });
  }

  // ③④ 落库前的两处 trim（:130-133）。
  if (next.proxy !== null) {
    next.proxy.url = next.proxy.url === null ? null : next.proxy.url.trim();
  }
  next.language = next.language.trim();

  // ⑤⑥ 整包落库，再把**归一化后的那份**交回去（副本：库里的对象绝不外泄）。
  db.settings.app = next;
  return structuredClone(next);
};

/** `llm_providers`：直接端种子那 7 条预设（service:143-149 的 `LlmProvider::all()` 映射）。 */
export const llmProviders: DemoHandler = () => structuredClone(getDemoDb().settings.providers);

/**
 * 被测厂商用哪个模型名（`client_for`:248-263 + `state.rs:72-101` 的 `config_from_settings`）：
 * 被测厂商**就是**当前默认厂商且库里存了非空模型名 ⇒ 用那个值（trim 后）；
 * 否则 `client_for` 会把 `model.model` 置 `None` ⇒ 回落该厂商预设里的 `default_model`。
 */
function modelUnderTest(db: DemoDb, saved: AppSettings, provider: string): string {
  const stored = saved.model.model;
  if (saved.model.provider === provider && stored !== null && stored.trim() !== '') {
    return stored.trim();
  }
  return db.settings.providers.find((info) => info.provider === provider)?.default_model ?? '';
}

/**
 * `llm_provider_test`：demo 不发请求，600ms 后回一套固定的成功假象；未配 Key 则 reject。
 *
 * 🔴 缺 Key 的判定按**被测那个厂商**算（`client_for` 用的是 `config.secret_ref`，
 * 而 `secret_ref` 由被测 provider 推出），不看当前默认厂商配没配。
 */
export const llmProviderTest: DemoHandler = async (args) => {
  const db = getDemoDb();
  // 命令入参那条路 ⇒ `llm/config`（service:270-279）。
  const provider = requireKnownProvider(db, asString(args.provider));

  // service:256-262：Key 不存在/空白 ⇒ `LlmError::MissingSecret`。demo 的库里只有
  // `configured` 这个布尔（**没有值字段**，AGENTS 规则 3），「空白串算未配」由 `secret_set`
  // 那一侧的 trim 保证 ⇒ 这里读布尔就是等价判据。
  if (!db.secrets.some((row) => row.provider === provider && row.configured)) {
    // 契约给这条码登记的 params 是**空数组** ⇒ 一个键都不许加（provider 前端自己知道）。
    throw demoError('llm/missing_secret');
  }

  const saved = storedSettings(db);
  await withLatency(LLM_TEST_LATENCY_MS);

  const result: LlmTestResult = {
    ok: true,
    model: modelUnderTest(db, saved, provider),
    latency_ms: LLM_TEST_LATENCY_MS,
    prompt_tokens: LLM_TEST_PROMPT_TOKENS,
    completion_tokens: LLM_TEST_COMPLETION_TOKENS,
    cost_cny: LLM_TEST_COST_CNY,
    // 恒为 null：demo 不演 `ok=false` 那一支（它装的是中文原因，见文件头）。
    message: null,
  };
  return result;
};

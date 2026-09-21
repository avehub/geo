/**
 * `settings_get` / `settings_update` / `llm_providers` / `llm_provider_test` 四条的行为测试
 * （Task 14 · 简报 §B）。
 *
 * 真值源 `apps/desktop/src-tauri/src/services/settings_service.rs`（下称 service）。
 * 口径与 `relations.test.ts` 一致：错误 params 的**精确键集**归 `error-contract.test.ts`，
 * 本文件只管行为——
 * - **读写不对称**（service:111-140）：读回落默认厂商、写整批拒绝；
 * - `update()` 那六步的顺序（体检 → 归一化 → trim proxy.url → trim language → 落库 → 回归一化后的那份）；
 * - `llm_provider_test` 的 `model` 取值规则（`client_for`，service:248-263）；
 * - 计划逐字的成功支字面量（`ok` / `latency_ms` / `prompt_tokens` / `completion_tokens` / `cost_cny`）。
 *
 * 🔴 `withLatency` 被 `vi.mock` 包了一层 spy：测试模式下 `demoLatencyMs()` 把请求值归零，
 * 「handler 真的请求了 600ms」只有在这一层看得见（包的是原函数，不改行为、只记账）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppSettings, LlmTestResult, ProviderInfo } from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import { setDemoLatency, withLatency } from '../latency';
import { SEED_SETTINGS } from '../seed/settings';

vi.mock('../latency', async (importOriginal) => {
  const actual = await importOriginal<{ withLatency: (ms?: number) => Promise<void> }>();
  return { ...actual, withLatency: vi.fn(actual.withLatency) };
});

/** 计划正文逐字的那个延迟值（独立写死，不 import 生产常量免得自我印证）。 */
const REQUESTED_LATENCY_MS = 600;
/** `LlmProvider::default()` 的 `as_str()`（`crates/geo-llm/src/provider.rs:67` 的 `#[default]`）。 */
const DEFAULT_PROVIDER = 'deep_seek';
const UNKNOWN_PROVIDER = 'no_such_provider';
const API_KEY = 'sk-demo-not-a-real-key';
/** `LlmProvider::Custom` 的 `as_str()`（`crates/geo-llm/src/provider.rs:116`）：它就在种子那 7 条预设里。 */
const CUSTOM_PROVIDER = 'custom';
/** 造「custom 填了接口地址」这个前提用的假网关地址（demo 不发请求，它只是数据）。 */
const GATEWAY_BASE_URL = 'https://gateway.example.com/v1';

async function capture(thunk: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(thunk)
    .then(
      () => null,
      (cause: unknown) => cause,
    );
}

function expectPayload(cause: unknown): { code: string; params: Record<string, string> } {
  expect(isIpcErrorPayload(cause)).toBe(true);
  if (!isIpcErrorPayload(cause)) throw new Error('unreachable');
  return { code: cause.code, params: { ...(cause.params ?? {}) } };
}

/** 种子里某个厂商的预设行（`llm_providers` 端的就是这份）。 */
function seedProvider(provider: string): ProviderInfo {
  const info = SEED_SETTINGS.providers.find((row) => row.provider === provider);
  if (!info) throw new Error(`seed has no provider ${provider}`);
  return info;
}

/** 一份合法的整包设置（页面就是整包提交的：半包会把没改的段落冲掉）。 */
function validSettings(overrides: Record<string, unknown> = {}): AppSettings {
  return structuredClone({ ...SEED_SETTINGS.app, ...overrides }) as AppSettings;
}

/** 把某个厂商标成「已配 Key」：走真命令，顺带证明 settings 与 secret 两侧读的是同一份库。 */
async function configureSecret(provider: string): Promise<void> {
  await demoInvoke('secret_set', { provider, value: API_KEY });
}

/** 走真命令改库里那份设置的 `model` 段（页面是整包提交的，这里也整包提交）。 */
async function saveModel(model: Record<string, unknown>): Promise<void> {
  await demoInvoke('settings_update', {
    settings: validSettings({ model: { ...SEED_SETTINGS.app.model, ...model } }),
  });
}

beforeEach(() => {
  resetDemoDb();
  vi.mocked(withLatency).mockClear();
});

afterEach(() => {
  setDemoLatency(null);
  resetDemoDb();
});

describe('demo/handlers/settings · settings_get（读是宽容的）', () => {
  it('端出种子里那份设置，且交出去的是副本（改它不会动库）', async () => {
    const settings = await demoInvoke<AppSettings>('settings_get');

    expect(settings).toEqual(SEED_SETTINGS.app);
    expect(settings.model.provider).toBe(DEFAULT_PROVIDER);

    settings.language = 'en_us';
    settings.model.provider = UNKNOWN_PROVIDER;

    expect(getDemoDb().settings.app.language).toBe(SEED_SETTINGS.app.language);
    expect((await demoInvoke<AppSettings>('settings_get')).language).toBe(SEED_SETTINGS.app.language);
  });

  it('库里 provider 被写坏时回落默认厂商，且**不回写**库（白盒造前提）', async () => {
    // 「库里存了认不出的值」在命令面上不可达（`settings_update` 会先体检拒绝），
    // 所以直接改内存库造前提（白盒，先例：`prompt-csv.test.ts` 的「空题库」那条）。
    getDemoDb().settings.app.model.provider = UNKNOWN_PROVIDER;

    const settings = await demoInvoke<AppSettings>('settings_get');

    expect(settings.model.provider).toBe(DEFAULT_PROVIDER);
    // service:111-117 的 `get()` 只在**返回值**上归一化，不落库 ⇒ 库里那个坏值原样还在。
    expect(getDemoDb().settings.app.model.provider).toBe(UNKNOWN_PROVIDER);
  });
});

describe('demo/handlers/settings · settings_update（写是严格的）', () => {
  it('写完之后 settings_get 回新值，返回体就是归一化后的那份（计划钉法 ①）', async () => {
    const next = validSettings({
      language: 'zh_cn',
      model: { ...SEED_SETTINGS.app.model, provider: 'moonshot', model: 'moonshot-v1-32k' },
      concurrency: { max_parallel: 5, queue_size: 400 },
    });

    const saved = await demoInvoke<AppSettings>('settings_update', { settings: next });
    expect(saved.model.provider).toBe('moonshot');
    expect(saved.model.model).toBe('moonshot-v1-32k');
    expect(saved.concurrency).toEqual({ max_parallel: 5, queue_size: 400 });

    const again = await demoInvoke<AppSettings>('settings_get');
    expect(again).toEqual(saved);
    expect(again).not.toBe(saved);
    // 交回去的也是**副本**：改它不会动库（与 settings_get 同一条纪律，库里的对象绝不外泄）。
    expect(saved).not.toBe(getDemoDb().settings.app);
    saved.language = 'en_us';
    expect((await demoInvoke<AppSettings>('settings_get')).language).toBe('zh_cn');
  });

  it('trim 那两步照抄：language 与 proxy.url 落库前各自 trim（service:129-132）', async () => {
    const saved = await demoInvoke<AppSettings>('settings_update', {
      settings: validSettings({
        language: '  zh_cn  ',
        proxy: { enabled: true, url: '  http://127.0.0.1:7890  ' },
      }),
    });

    expect(saved.language).toBe('zh_cn');
    expect(saved.proxy).toEqual({ enabled: true, url: 'http://127.0.0.1:7890' });
    expect((await demoInvoke<AppSettings>('settings_get')).language).toBe('zh_cn');
  });

  it('proxy 传 null 就是 null（不会被收窄成一份空配置）', async () => {
    const saved = await demoInvoke<AppSettings>('settings_update', {
      settings: validSettings({ proxy: null }),
    });

    expect(saved.proxy).toBeNull();
  });

  it('model.provider 认不出 ⇒ validation/failed 三键，且**整批不落库**', async () => {
    const before = structuredClone(getDemoDb().settings.app);

    const cause = await capture(() =>
      demoInvoke('settings_update', {
        settings: validSettings({
          language: 'zh_cn',
          concurrency: { max_parallel: 9, queue_size: 900 },
          model: { ...SEED_SETTINGS.app.model, provider: UNKNOWN_PROVIDER },
        }),
      }),
    );

    expect(expectPayload(cause)).toEqual({
      code: 'validation/failed',
      params: { field: 'model.provider', reason: 'unknown_provider', value: UNKNOWN_PROVIDER },
    });
    // 先体检后落库：任何一项越界就整批拒绝（service:124-140）。
    expect(getDemoDb().settings.app).toStrictEqual(before);
    expect((await demoInvoke<AppSettings>('settings_get')).concurrency).toEqual(
      SEED_SETTINGS.app.concurrency,
    );
  });

  it('language 空白 ⇒ validation/failed 两键（不落库）', async () => {
    const before = structuredClone(getDemoDb().settings.app);

    const cause = await capture(() =>
      demoInvoke('settings_update', { settings: validSettings({ language: '   ' }) }),
    );

    expect(expectPayload(cause)).toEqual({
      code: 'validation/failed',
      params: { field: 'language', reason: 'required' },
    });
    expect(getDemoDb().settings.app).toStrictEqual(before);
  });

  it('provider 与 language 同时坏 ⇒ 报 provider 那条（体检顺序镜像 service:330-346）', async () => {
    const cause = await capture(() =>
      demoInvoke('settings_update', {
        settings: validSettings({
          language: '',
          model: { ...SEED_SETTINGS.app.model, provider: UNKNOWN_PROVIDER },
        }),
      }),
    );

    expect(expectPayload(cause).params.field).toBe('model.provider');
  });

  it('空入参不会把库改成半包（settings 是整包提交，缺字段一律收窄后过体检）', async () => {
    const before = structuredClone(getDemoDb().settings.app);

    const cause = await capture(() => demoInvoke('settings_update', {}));

    expect(expectPayload(cause).code).toBe('validation/failed');
    expect(getDemoDb().settings.app).toStrictEqual(before);
  });
});

describe('demo/handlers/settings · llm_providers', () => {
  it('直接端种子里那 7 条，价目字段照填（契约冻结，UI 不展示也不许删）', async () => {
    const rows = await demoInvoke<ProviderInfo[]>('llm_providers');

    expect(rows).toEqual(SEED_SETTINGS.providers);
    expect(rows.map((row) => row.provider)).toEqual(
      SEED_SETTINGS.providers.map((row) => row.provider),
    );
    expect(Object.keys(rows[0]).sort()).toEqual([
      'base_url',
      'default_model',
      'input_per_mtok',
      'label_zh',
      'output_per_mtok',
      'provider',
    ]);
    // `custom` 的 base_url 是空串（seed.test.ts 已钉）⇒ 这里只证明 demo 没偷偷填一个。
    expect(rows.find((row) => row.provider === 'custom')?.base_url).toBe('');
  });

  it('交出去的是副本：改返回值不会动库', async () => {
    const rows = await demoInvoke<ProviderInfo[]>('llm_providers');
    rows[0].default_model = 'mutated-by-test';

    expect(getDemoDb().settings.providers[0].default_model).toBe(
      SEED_SETTINGS.providers[0].default_model,
    );
  });
});

describe('demo/handlers/settings · llm_provider_test', () => {
  it('未配 Key ⇒ reject llm/missing_secret（计划钉法 ③），且不碰库', async () => {
    const before = structuredClone(getDemoDb());

    const cause = await capture(() =>
      demoInvoke('llm_provider_test', { provider: DEFAULT_PROVIDER }),
    );

    expect(expectPayload(cause)).toEqual({ code: 'llm/missing_secret', params: {} });
    expect(getDemoDb()).toStrictEqual(before);
  });

  it('配了 Key ⇒ 成功支就是计划逐字那几个字段，message 恒为 null', async () => {
    await configureSecret(DEFAULT_PROVIDER);

    const result = await demoInvoke<LlmTestResult>('llm_provider_test', {
      provider: DEFAULT_PROVIDER,
    });

    expect(result).toEqual({
      ok: true,
      model: seedProvider(DEFAULT_PROVIDER).default_model,
      latency_ms: REQUESTED_LATENCY_MS,
      prompt_tokens: 12,
      completion_tokens: 4,
      // AGENTS 规则 9：demo 不做成本记账，价目字段读都不读。
      cost_cny: 0,
      message: null,
    });
    expect(Object.keys(result).sort()).toEqual([
      'completion_tokens',
      'cost_cny',
      'latency_ms',
      'message',
      'model',
      'ok',
      'prompt_tokens',
    ]);
  });

  it('它请求的假延迟就是 600ms（测试模式归零，但请求值必须是真 600）', async () => {
    await configureSecret(DEFAULT_PROVIDER);

    await demoInvoke<LlmTestResult>('llm_provider_test', { provider: DEFAULT_PROVIDER });

    expect(vi.mocked(withLatency)).toHaveBeenCalledWith(REQUESTED_LATENCY_MS);
  });

  it('model 取值：被测厂商不是当前默认厂商 ⇒ 忽略已存的模型名，用该厂商的 default_model', async () => {
    // `client_for`（service:248-263）：测的不是当前默认厂商时把 `model.model` 置 None
    // ⇒ 回落该厂商的默认模型。这里先把库里存成 deep_seek + 一个具名模型，再测 moonshot。
    await demoInvoke('settings_update', {
      settings: validSettings({
        model: { ...SEED_SETTINGS.app.model, provider: DEFAULT_PROVIDER, model: 'saved-model' },
      }),
    });
    await configureSecret('moonshot');

    const result = await demoInvoke<LlmTestResult>('llm_provider_test', { provider: 'moonshot' });

    expect(result.model).toBe(seedProvider('moonshot').default_model);
    expect(result.model).not.toBe('saved-model');
  });

  it('model 取值：被测厂商就是当前默认厂商且已填模型名 ⇒ 用填的那个', async () => {
    await demoInvoke('settings_update', {
      settings: validSettings({
        model: { ...SEED_SETTINGS.app.model, provider: DEFAULT_PROVIDER, model: 'deepseek-reasoner' },
      }),
    });
    await configureSecret(DEFAULT_PROVIDER);

    const result = await demoInvoke<LlmTestResult>('llm_provider_test', {
      provider: DEFAULT_PROVIDER,
    });

    expect(result.model).toBe('deepseek-reasoner');
  });

  it('用户 bug #5 的机制面：测试读的是**库里那份**设置，页面上的草稿到不了这里（白盒造前提）', async () => {
    await configureSecret(DEFAULT_PROVIDER);
    const beforeSave = await demoInvoke<LlmTestResult>('llm_provider_test', {
      provider: DEFAULT_PROVIDER,
    });
    expect(beforeSave.model).toBe(seedProvider(DEFAULT_PROVIDER).default_model);

    // 白盒改库 = 用户点了「保存设置」。设置页是草稿式（`SettingsPage.tsx` 的
    // `settings = draft ?? settingsQuery.data`），**不点保存就没有这一步** ⇒
    // 测试永远读的是旧值：这正是 bug #5 的 ①，demo 与桌面端一致，本轮刻意不修（归 spec G5）。
    getDemoDb().settings.app.model.model = 'saved-model';

    const afterSave = await demoInvoke<LlmTestResult>('llm_provider_test', {
      provider: DEFAULT_PROVIDER,
    });
    expect(afterSave.model).toBe('saved-model');
  });

  it('认不出的 provider ⇒ llm/config（命令入参那条路，不是 validation/failed）', async () => {
    const cause = await capture(() =>
      demoInvoke('llm_provider_test', { provider: UNKNOWN_PROVIDER }),
    );

    expect(expectPayload(cause)).toEqual({
      code: 'llm/config',
      params: { reason: 'unknown_provider', value: UNKNOWN_PROVIDER },
    });
  });

  it('缺 Key 的判定按**被测那个厂商**算，不看当前默认厂商配没配', async () => {
    await configureSecret(DEFAULT_PROVIDER);

    const cause = await capture(() => demoInvoke('llm_provider_test', { provider: 'moonshot' }));

    expect(expectPayload(cause).code).toBe('llm/missing_secret');
  });

  // ---- Task 14 复审 Minor 2：`custom` 的配置推导，顺序照 `state.rs:72-119` ----
  // 真值源的失败顺序是：① `unknown_provider` → ② 仅当 `provider == Custom`：`base_url` 空 ⇒
  // `missing_base_url`、`model` 空 ⇒ `missing_model`（两者 `value` 都是 `provider.as_str()`）
  // → ③ 取 Key，空白 ⇒ `MissingSecret`。② 是**纯配置推导**、发生在取 Key **之前**，
  // 所以下面第一条用例（base_url 空 + Key 也没配 ⇒ 报 `missing_base_url`）是唯一能判别顺序的那条。
  it('custom 且 base_url 空且未配 Key ⇒ 报 missing_base_url 而**不是** missing_secret（顺序判据）', async () => {
    const cause = await capture(() =>
      demoInvoke('llm_provider_test', { provider: CUSTOM_PROVIDER }),
    );

    expect(expectPayload(cause)).toEqual({
      code: 'llm/config',
      params: { reason: 'missing_base_url', value: CUSTOM_PROVIDER },
    });
  });

  it('custom 且库里的 base_url 只是空白 ⇒ 仍报 missing_base_url（读侧 trim 镜像 state.rs:99）', async () => {
    // 🔴 **白盒造前提**（先例：本文件 bug #5 那条直接改 `getDemoDb()`）。走 `settings_update` 造不出来：
    // demo 的写侧用 `cleanOptional`（`handlers/shared.ts:103-107`）把空白收窄成 `null`；而真后端的
    // `update()` 只 trim `proxy.url` 与 `language`（service:129-132），**不 trim `base_url`**
    // ⇒ 库里真可能存着一串空白，读侧那句 `.map(str::trim)`（state.rs:99）就是为它准备的。
    // 这条断言就是「命令路径造不出这个前提」的证据：写侧把空白收窄成了 `null`。
    await saveModel({ provider: CUSTOM_PROVIDER, base_url: '   ', model: 'gateway-model' });
    expect(getDemoDb().settings.app.model.base_url).toBe(null);
    getDemoDb().settings.app.model.base_url = '   ';

    const cause = await capture(() =>
      demoInvoke('llm_provider_test', { provider: CUSTOM_PROVIDER }),
    );

    expect(expectPayload(cause)).toEqual({
      code: 'llm/config',
      params: { reason: 'missing_base_url', value: CUSTOM_PROVIDER },
    });
  });

  it('custom 且 base_url 填了、模型名空 ⇒ missing_model（value 仍是厂商 id，不是模型名）', async () => {
    // `custom` 没有默认模型名（`state.rs:111` 注释逐字，判据在 `:112-117`）⇒ 不填就没有回落可用。
    await saveModel({ provider: CUSTOM_PROVIDER, base_url: GATEWAY_BASE_URL, model: null });

    const cause = await capture(() =>
      demoInvoke('llm_provider_test', { provider: CUSTOM_PROVIDER }),
    );

    expect(expectPayload(cause)).toEqual({
      code: 'llm/config',
      params: { reason: 'missing_model', value: CUSTOM_PROVIDER },
    });
  });

  it('custom 且 base_url 与模型名都填了、未配 Key ⇒ 才轮到 missing_secret（② 在 ③ 之前）', async () => {
    await saveModel({
      provider: CUSTOM_PROVIDER,
      base_url: GATEWAY_BASE_URL,
      model: 'gateway-model',
    });

    const cause = await capture(() =>
      demoInvoke('llm_provider_test', { provider: CUSTOM_PROVIDER }),
    );

    expect(expectPayload(cause)).toEqual({ code: 'llm/missing_secret', params: {} });
  });

  it('custom 且都填了、配了 Key ⇒ 成功，model 用填的那个（custom 不回落 default_model）', async () => {
    await saveModel({
      provider: CUSTOM_PROVIDER,
      base_url: GATEWAY_BASE_URL,
      model: 'gateway-model',
    });
    await configureSecret(CUSTOM_PROVIDER);

    const result = await demoInvoke<LlmTestResult>('llm_provider_test', {
      provider: CUSTOM_PROVIDER,
    });

    expect(result.model).toBe('gateway-model');
    // 回落目标本来就是空串（`provider.rs:178` 的 `Custom => ""`，种子在 `seed/settings.ts:99` 镜像）
    // ⇒ 「custom 不回落」不是一句口号，是这条断言的对照面。
    expect(seedProvider(CUSTOM_PROVIDER).default_model).toBe('');
  });

  it('预设厂商 base_url 空也**不**报 missing_base_url：那两条判据只对 custom（state.rs:104）', async () => {
    // 种子里 deep_seek 的 base_url 是 null（用户没填覆盖），照样不该撞配置推导那两条。
    const cause = await capture(() =>
      demoInvoke('llm_provider_test', { provider: DEFAULT_PROVIDER }),
    );

    expect(expectPayload(cause).code).toBe('llm/missing_secret');
  });

  it('被测厂商不是默认厂商时只清 model、不清 base_url（client_for:250-254 的不对称）', async () => {
    // 库里默认厂商仍是 deep_seek，但 base_url 与 model 都填了 ⇒ 测 custom 时
    // `client_for` 只把 `model.model` 置 None（base_url 原样保留）⇒ 顺序推进到 missing_model。
    await saveModel({ base_url: GATEWAY_BASE_URL, model: 'saved-model' });

    const cause = await capture(() =>
      demoInvoke('llm_provider_test', { provider: CUSTOM_PROVIDER }),
    );

    expect(expectPayload(cause)).toEqual({
      code: 'llm/config',
      params: { reason: 'missing_model', value: CUSTOM_PROVIDER },
    });
  });
});

describe('demo/handlers/settings · resetDemoDb()', () => {
  it('重置之后设置与密钥状态都回种子（简报 §B-12）', async () => {
    await demoInvoke('settings_update', {
      settings: validSettings({ model: { ...SEED_SETTINGS.app.model, provider: 'moonshot' } }),
    });
    await configureSecret('moonshot');
    expect((await demoInvoke<AppSettings>('settings_get')).model.provider).toBe('moonshot');

    resetDemoDb();

    expect(await demoInvoke<AppSettings>('settings_get')).toEqual(SEED_SETTINGS.app);
    const status = await demoInvoke<{ configured: boolean }>('secret_status', {
      provider: 'moonshot',
    });
    expect(status.configured).toBe(false);
    expect(getDemoDb().secrets.every((row) => !row.configured)).toBe(true);
  });
});

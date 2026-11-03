/**
 * `llm_models_list` 的契约测试（Plan B Task 4 · spec DR-34 / §8 / §10）。
 *
 * 四条靶心：
 * ① 认得的厂商回**该家**的预置清单，`source === 'preset'`（demo 不发请求，AGENTS 规则 2）；
 * ② `custom` 缺接口地址 ⇒ 走**命令入参**那条错误路（`llm/config` + `missing_base_url`），
 *    与 `llm_provider_test` 逐字同口径——`handlers/settings.ts` 的文件头写死了
 *    「命令入参用 `llm/config`、表单字段校验用 `validation/failed`，两个 code 绝不混用」；
 * ③ 契约外的 `protocol` **收敛**成 `openai_compat`（不报错、也不回显进返回值）；
 * ④ 🔴 入参里的 `api_key` 绝不出现在返回值、错误 `params` 或抛出的 `message` 里（AGENTS 规则 3）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { isIpcErrorPayload } from '../../api/types';
import type { ModelsListResult } from '../../api/types';
import { demoInvoke } from '../backend';
import { resetDemoDb } from '../db';
import { SEED_MODEL_CATALOGS } from '../seed/model-catalogs';
import { SEED_SETTINGS } from '../seed/settings';

afterEach(() => resetDemoDb());

/** 一个绝不会与真 Key 混淆的哨兵串：它出现在任何输出里都是泄漏。 */
const API_KEY_SENTINEL = 'sk-SENTINEL-DO-NOT-LEAK-0001';
const CUSTOM_PROVIDER = 'custom';
const UNKNOWN_PROVIDER = 'no_such_provider';
const GATEWAY_BASE_URL = 'https://gateway.example.com/v1';

/** Plan B Task 4 新增的 5 家中转站（DR-33：demo 独有，Rust `LlmProvider::all()` 今天只有 7 个）。 */
const RELAY_PROVIDER_IDS = ['openrouter', 'siliconflow', '302ai', 'yunwu', 'deepbricks'];

function query(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'deep_seek',
    protocol: 'openai_compat',
    base_url: null,
    ...overrides,
  };
}

async function capture(thunk: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(thunk)
    .then(
      () => null,
      (cause: unknown) => cause,
    );
}

function expectPayload(cause: unknown): { code: string; params: Record<string, string>; message: string } {
  expect(isIpcErrorPayload(cause)).toBe(true);
  if (!isIpcErrorPayload(cause)) throw new Error('unreachable');
  return { code: cause.code, params: { ...(cause.params ?? {}) }, message: cause.message };
}

describe('demo/handlers · llm_models_list', () => {
  it('认得的厂商回该家预置清单，source === preset，返回形状恰好两键', async () => {
    const result = (await demoInvoke('llm_models_list', query())) as ModelsListResult;

    expect(Object.keys(result).sort()).toEqual(['models', 'source']);
    expect(result.source).toBe('preset');
    expect(result.models).toEqual(SEED_MODEL_CATALOGS.deep_seek);
    expect(result.models.length).toBeGreaterThan(0);
  });

  it('5 家中转站各有自己的清单，且都在厂商预设表里（DR-33）', async () => {
    const presetIds = SEED_SETTINGS.providers.map((info) => info.provider);

    for (const provider of RELAY_PROVIDER_IDS) {
      expect(presetIds, `${provider} 不在厂商预设表里`).toContain(provider);
      const result = (await demoInvoke('llm_models_list', query({ provider }))) as ModelsListResult;
      expect(result.models, provider).toEqual(SEED_MODEL_CATALOGS[provider]);
      expect(result.models.length, `${provider} 的清单是空的`).toBeGreaterThan(0);
      // 每家清单互不相同：抄一份贴五遍的话这条会红。
      for (const other of RELAY_PROVIDER_IDS) {
        if (other === provider) continue;
        expect(result.models, `${provider} 与 ${other} 的清单一样`).not.toEqual(
          SEED_MODEL_CATALOGS[other],
        );
      }
    }
  });

  it('🔴 custom 缺接口地址 ⇒ llm/config + missing_base_url（与 llm_provider_test 同一口径，不新增错误码）', async () => {
    for (const baseUrl of [null, '', '   ']) {
      const cause = await capture(() =>
        demoInvoke('llm_models_list', query({ provider: CUSTOM_PROVIDER, base_url: baseUrl })),
      );
      expect(expectPayload(cause), `base_url=${JSON.stringify(baseUrl)}`).toEqual({
        code: 'llm/config',
        params: { reason: 'missing_base_url', value: CUSTOM_PROVIDER },
        message: `llm/config reason=missing_base_url value=${CUSTOM_PROVIDER}`,
      });
    }
  });

  it('custom 填了接口地址 ⇒ 回空清单（demo 不访问外部地址，界面据此给出手输提示）', async () => {
    const result = (await demoInvoke(
      'llm_models_list',
      query({ provider: CUSTOM_PROVIDER, base_url: GATEWAY_BASE_URL }),
    )) as ModelsListResult;

    expect(result).toEqual({ models: [], source: 'preset' });
  });

  it('认不出的 provider ⇒ llm/config + unknown_provider（复用 settings.ts 的 requireKnownProvider）', async () => {
    const cause = await capture(() =>
      demoInvoke('llm_models_list', query({ provider: UNKNOWN_PROVIDER })),
    );

    expect(expectPayload(cause)).toEqual({
      code: 'llm/config',
      params: { reason: 'unknown_provider', value: UNKNOWN_PROVIDER },
      message: `llm/config reason=unknown_provider value=${UNKNOWN_PROVIDER}`,
    });
  });

  it('契约外的 protocol 收敛成 openai_compat：不报错，也不回显进返回值', async () => {
    for (const protocol of ['anthropic', 'grpc', '', null, 42]) {
      const result = (await demoInvoke('llm_models_list', query({ protocol }))) as ModelsListResult;
      expect(Object.keys(result).sort(), `protocol=${JSON.stringify(protocol)}`).toEqual([
        'models',
        'source',
      ]);
      expect(result.models).toEqual(SEED_MODEL_CATALOGS.deep_seek);
    }
  });

  it('🔴 api_key 绝不出现在返回值 / 错误 params / message 里（AGENTS 规则 3）', async () => {
    const ok = (await demoInvoke(
      'llm_models_list',
      query({ api_key: API_KEY_SENTINEL }),
    )) as ModelsListResult;
    expect(JSON.stringify(ok)).not.toContain(API_KEY_SENTINEL);

    const cause = await capture(() =>
      demoInvoke(
        'llm_models_list',
        query({ provider: CUSTOM_PROVIDER, base_url: null, api_key: API_KEY_SENTINEL }),
      ),
    );
    const payload = expectPayload(cause);
    expect(Object.keys(payload.params).sort()).toEqual(['reason', 'value']);
    expect(JSON.stringify(payload)).not.toContain(API_KEY_SENTINEL);
    expect(payload.message).not.toContain(API_KEY_SENTINEL);
  });

  it('端出去的是副本：改返回值不会污染种子清单', async () => {
    const first = (await demoInvoke('llm_models_list', query())) as ModelsListResult;
    const before = [...SEED_MODEL_CATALOGS.deep_seek];
    first.models.push('polluted-model');

    const second = (await demoInvoke('llm_models_list', query())) as ModelsListResult;
    expect(second.models).toEqual(before);
  });

  it('漂移守卫：清单键集 == 厂商预设 id 集合去掉 custom', () => {
    const catalogIds = Object.keys(SEED_MODEL_CATALOGS).sort();
    const presetIds = SEED_SETTINGS.providers.map((info) => info.provider)
      .filter((provider) => provider !== CUSTOM_PROVIDER)
      .sort();

    expect(catalogIds).toEqual(presetIds);
    for (const models of Object.values(SEED_MODEL_CATALOGS)) {
      expect(models.length).toBeGreaterThan(0);
      // 模型名是**机器记号**，一律 ASCII（踩了 CJK 就会污染 en-US 的整页残留判据）。
      for (const model of models) expect(model).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});

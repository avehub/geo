/**
 * `secret_set` / `secret_status` / `secret_delete` 三条的行为测试（Task 14 · 简报 §B）。
 *
 * 真值源 `apps/desktop/src-tauri/src/services/settings_service.rs:151-190`（下称 service）。
 * 本文件的**主判据**是 AGENTS 规则 3（密钥永不落库）在 demo 里的落法：
 * `DemoDb.secrets` 的形状就是 `SecretStatus[]`（`{provider, configured, secret_ref}`，**没有值字段**）
 * ⇒ `secret_set` 校验完就把用户填的 Key **丢掉**，只把那条的 `configured` 翻成 `true`。
 * 所以「泄漏」这条路在 demo 里是**结构性不存在**的，而不只是"记得别存"——
 * 下面那条「整份库 JSON 化后不含 Key 串」就是这件事的机械执行者。
 *
 * 另钉两件事：`field` 逐字是 `api_key`（service:155-159 的裁定 R-F 唯一例外，不是 `value`），
 * 以及命令入参走 `llm/config`、表单体检走 `validation/failed`（两个 code 不混用，service:270-283）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SecretStatus } from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { demoSecretRef, getDemoDb, resetDemoDb } from '../db';
import { SEED_SETTINGS } from '../seed/settings';

const API_KEY = 'sk-demo-0123456789abcdef';
const UNKNOWN_PROVIDER = 'no_such_provider';
const PROVIDERS = SEED_SETTINGS.providers.map((row) => row.provider);

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

function status(provider: string): Promise<SecretStatus> {
  return demoInvoke<SecretStatus>('secret_status', { provider });
}

beforeEach(() => {
  resetDemoDb();
});

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/secret · 写入与查询', () => {
  it('secret_set 之后 secret_status.configured === true，且返回体只有那三个键（计划钉法 ②）', async () => {
    expect(await demoInvoke('secret_set', { provider: 'deep_seek', value: API_KEY })).toBeUndefined();

    const secret = await status('deep_seek');

    expect(secret.configured).toBe(true);
    expect(Object.keys(secret).sort()).toEqual(['configured', 'provider', 'secret_ref']);
    expect(secret).toEqual({
      provider: 'deep_seek',
      configured: true,
      // 复用 `db.ts` 的 helper，不另写一份同形串（简报 A-5）。
      secret_ref: demoSecretRef('deep_seek'),
    });
  });

  it('规则 3 的机械执行者：整份库 JSON 化之后不含用户填的那个 Key 串', async () => {
    await demoInvoke('secret_set', { provider: 'moonshot', value: API_KEY });

    const dumped = JSON.stringify(getDemoDb());
    expect(dumped).not.toContain(API_KEY);
    // 状态行本身也不含值，且 7 个厂商一个不多一个不少（只翻 configured，不新增/删除条目）。
    expect(getDemoDb().secrets).toHaveLength(PROVIDERS.length);
    expect(getDemoDb().secrets.map((row) => row.provider)).toEqual(PROVIDERS);
    expect(JSON.stringify(await status('moonshot'))).not.toContain(API_KEY);
  });

  it('没配过的厂商回 configured:false，secret_ref 与配没配无关', async () => {
    const secret = await status('ali_bailian');

    expect(secret).toEqual({
      provider: 'ali_bailian',
      configured: false,
      secret_ref: 'keyring://llm/ali_bailian',
    });
  });

  it('值两端空白算已配（service:153 先 trim），但**纯空白**算未配 ⇒ 直接拒', async () => {
    await demoInvoke('secret_set', { provider: 'deep_seek', value: `  ${API_KEY}  ` });
    expect((await status('deep_seek')).configured).toBe(true);

    const cause = await capture(() =>
      demoInvoke('secret_set', { provider: 'moonshot', value: '   ' }),
    );

    // 🔴 逐字钉 `api_key`（不是含糊的 `value`）：裁定 R-F 的唯一例外。
    expect(expectPayload(cause)).toEqual({
      code: 'validation/failed',
      params: { field: 'api_key', reason: 'required' },
    });
    expect((await status('moonshot')).configured).toBe(false);
    // 拒绝的那一路上，params 里也不许带出用户填的东西（`demoError` 会把 params 拼进 message）。
    expect(JSON.stringify(cause)).not.toContain(API_KEY);
  });

  it('空入参不会把某个厂商误标成已配', async () => {
    const cause = await capture(() => demoInvoke('secret_set', {}));

    expect(expectPayload(cause).code).toBe('llm/config');
    expect(getDemoDb().secrets.every((row) => !row.configured)).toBe(true);
  });

  it('重复写入只是覆盖：仍然一条记录、仍然 configured:true', async () => {
    await demoInvoke('secret_set', { provider: 'deep_seek', value: API_KEY });
    await demoInvoke('secret_set', { provider: 'deep_seek', value: 'sk-demo-second' });

    expect(getDemoDb().secrets.filter((row) => row.provider === 'deep_seek')).toHaveLength(1);
    expect((await status('deep_seek')).configured).toBe(true);
    expect(JSON.stringify(getDemoDb())).not.toContain('sk-demo-second');
  });
});

describe('demo/handlers/secret · 删除是幂等的', () => {
  it('删两次都不报错，configured 回 false（service:183-194）', async () => {
    await demoInvoke('secret_set', { provider: 'deep_seek', value: API_KEY });

    expect(await demoInvoke('secret_delete', { provider: 'deep_seek' })).toBeUndefined();
    expect((await status('deep_seek')).configured).toBe(false);
    expect(await demoInvoke('secret_delete', { provider: 'deep_seek' })).toBeUndefined();
    expect((await status('deep_seek')).configured).toBe(false);
  });

  it('没配过也能删（不报 not_found：契约里本来就没有 secret/not_found 这条码）', async () => {
    expect(await demoInvoke('secret_delete', { provider: 'tencent_hunyuan' })).toBeUndefined();
    expect((await status('tencent_hunyuan')).configured).toBe(false);
  });

  it('删一个厂商不影响其它厂商的 configured', async () => {
    await demoInvoke('secret_set', { provider: 'deep_seek', value: API_KEY });
    await demoInvoke('secret_set', { provider: 'moonshot', value: API_KEY });

    await demoInvoke('secret_delete', { provider: 'deep_seek' });

    expect((await status('deep_seek')).configured).toBe(false);
    expect((await status('moonshot')).configured).toBe(true);
  });
});

describe('demo/handlers/secret · 两个 code 不混用', () => {
  it('四条命令传认不出的 provider 一律 llm/config + 两键，绝不是 validation/failed', async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['secret_set', { provider: UNKNOWN_PROVIDER, value: API_KEY }],
      ['secret_status', { provider: UNKNOWN_PROVIDER }],
      ['secret_delete', { provider: UNKNOWN_PROVIDER }],
      ['llm_provider_test', { provider: UNKNOWN_PROVIDER }],
    ];

    for (const [cmd, args] of calls) {
      const cause = await capture(() => demoInvoke(cmd, args));

      expect(expectPayload(cause), cmd).toEqual({
        code: 'llm/config',
        params: { reason: 'unknown_provider', value: UNKNOWN_PROVIDER },
      });
    }
  });

  it('对照组：同一份数据走表单体检时是 validation/failed（code 不同、键集不同）', async () => {
    const cause = await capture(() =>
      demoInvoke('settings_update', {
        // structuredClone：种子模块是共享的，绝不把它的嵌套对象直接交出去。
        settings: structuredClone({
          ...SEED_SETTINGS.app,
          model: { ...SEED_SETTINGS.app.model, provider: UNKNOWN_PROVIDER },
        }),
      }),
    );

    expect(expectPayload(cause)).toEqual({
      code: 'validation/failed',
      params: { field: 'model.provider', reason: 'unknown_provider', value: UNKNOWN_PROVIDER },
    });
  });

  it('认不出的 provider 一律不碰库（四条命令跑完 secrets 与 settings 都还是种子态）', async () => {
    const before = structuredClone(getDemoDb());

    await capture(() => demoInvoke('secret_set', { provider: UNKNOWN_PROVIDER, value: API_KEY }));
    await capture(() => demoInvoke('secret_status', { provider: UNKNOWN_PROVIDER }));
    await capture(() => demoInvoke('secret_delete', { provider: UNKNOWN_PROVIDER }));
    await capture(() => demoInvoke('llm_provider_test', { provider: UNKNOWN_PROVIDER }));

    expect(getDemoDb()).toStrictEqual(before);
  });
});

/**
 * demo 假后端的门禁测试（Task 11 建的骨架，每轮 handler 落地后同步收口）。
 *
 * 钉四件事：
 * ① **键集全覆盖**：`demoBackend` 的键集合与 `IPC_COMMANDS` **完全相等**。
 *    `Record<IpcCommand, DemoHandler>` 已经在编译期强制全覆盖（AGENTS 规则 8「命令增减两侧
 *    同时改」的保证），但未知命令守卫是拿**这张表的键**在运行时收窄的 ⇒ 键集漂了，
 *    守卫就跟着漂。编译期网 + 运行期集合相等，两道一起才算钉住。
 * ② **40 条全部脱离骨架**：逐条空入参调用，谁都不许再抛「未实现」。
 *    🔴 这条是「未实现探针」退休后的**对价**（简报 §C）：探针的价值是「证明分派真的到了
 *    `demoBackend`」，40 条全落地之后它无处可移；接管的这条断言面从 **32 扩到 40**，
 *    并按模块逐条列出清单（不用前缀正则）——那张清单同时就是「哪条命令归哪一轮」的账本。
 * ③ **`demoInvoke` 真的走到 handler**：拿一条已落地的命令断言它 **resolve 出内存库里的种子数据**。
 *    旧探针只能证明「消息里带命令名」，这条还证明「读到了库」⇒ 严格更强（简报 §C 的裁定原则）。
 * ④ **刷新即重置**：`resetDemoDb()` 真的从种子重建，且种子模块自身不被 db 的改动污染（深拷）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { IPC_COMMANDS } from '../api/client';
import type { IpcCommand } from '../api/client';
import type { AppSettings } from '../api/types';
import { isIpcErrorPayload } from '../api/types';
import { demoBackend, demoInvoke } from './backend';
import { createDemoDb, getDemoDb, resetDemoDb } from './db';
import { DEFAULT_DEMO_LATENCY_MS, setDemoLatency, withLatency } from './latency';
import { SEED_PROJECTS } from './seed/projects';
import { SEED_SETTINGS } from './seed/settings';
import { demoError } from './types';

/** 与 `client.demo-runtime.test.ts` 同一条判据：开发者诊断串不许含 CJK（§B-11）。 */
const CJK = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;

/**
 * 已接真 handler 的命令，按**模块**分组逐条列出（不用前缀正则）：这张清单就是
 * 「哪条命令已经脱离骨架」的账本，② 的断言面 = 它的全集，待实现集合 = `IPC_COMMANDS` 减它。
 * M1 21 条（`project_*` 10 + `entity_card_*` 4 + `competitor_*` 4 + `asset_*` 3）。
 */
const M1_COMMANDS: readonly IpcCommand[] = [
  'project_create',
  'project_list',
  'project_get',
  'project_update',
  'project_archive',
  'project_delete',
  'project_export',
  'project_import',
  'project_export_competitors_csv',
  'project_export_assets_csv',
  'entity_card_autobuild',
  'entity_card_get',
  'entity_card_update_field',
  'entity_card_revisions',
  'competitor_upsert',
  'competitor_list',
  'competitor_delete',
  'competitor_reorder',
  'asset_add',
  'asset_list',
  'asset_delete',
];

/** M2 11 条（`prompt_set_*` 8 + `prompt_item_*` 3）。 */
const M2_COMMANDS: readonly IpcCommand[] = [
  'prompt_set_generate',
  'prompt_set_list',
  'prompt_set_get',
  'prompt_set_rename',
  'prompt_set_delete',
  'prompt_item_update',
  'prompt_item_add',
  'prompt_item_delete',
  'prompt_set_dedupe',
  'prompt_set_export_csv',
  'prompt_set_import_csv',
];

/** 设置 / 密钥 / 导出 8 条（`settings_*` 2 + `secret_*` 3 + `llm_*` 2 + `export_*` 1，Task 14）。 */
const SETTINGS_COMMANDS: readonly IpcCommand[] = [
  'settings_get',
  'settings_update',
  'secret_set',
  'secret_status',
  'secret_delete',
  'llm_provider_test',
  'llm_providers',
  'export_write_file',
];

/** 已接线全集（② 的断言面）：随每轮落地**只增不减**；Task 14 之后就是 40 条全集。 */
const IMPLEMENTED_COMMANDS: readonly IpcCommand[] = [
  ...M1_COMMANDS,
  ...M2_COMMANDS,
  ...SETTINGS_COMMANDS,
];

/** 把「同步 throw」与「返回 rejected promise」两种 handler 形状收成同一个 catch。 */
async function capture(thunk: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(thunk)
    .then(
      () => null,
      (cause: unknown) => cause,
    );
}

afterEach(() => {
  setDemoLatency(null);
  resetDemoDb();
});

describe('demo/backend · 骨架契约', () => {
  it('demoBackend 的键集合与 IPC_COMMANDS 完全相等（40 条，不多不少）', () => {
    const keys = Object.keys(demoBackend);

    expect(IPC_COMMANDS).toHaveLength(40);
    expect(keys).toHaveLength(IPC_COMMANDS.length);
    expect([...keys].sort()).toEqual([...IPC_COMMANDS].sort());
  });

  it('40 条全部脱离骨架：空入参调用不再抛「not implemented」（反向断言，强度只增不减）', async () => {
    // 三份账本各自的条数写死在这里：将来加一条命令必须同时改这个数，改不动就是没真的加。
    expect(M1_COMMANDS).toHaveLength(21);
    expect(M2_COMMANDS).toHaveLength(11);
    expect(SETTINGS_COMMANDS).toHaveLength(8);
    expect(IMPLEMENTED_COMMANDS).toHaveLength(40);
    // 账本没有漏项：`IPC_COMMANDS` 里没有一条还挂在「待实现」上（Task 14 之后这个集合恒空）。
    expect(IPC_COMMANDS.filter((cmd) => !IMPLEMENTED_COMMANDS.includes(cmd))).toEqual([]);

    for (const cmd of IMPLEMENTED_COMMANDS) {
      const cause = await capture(() => demoBackend[cmd]({}));
      const message = cause instanceof Error ? cause.message : '';

      expect(message, cmd).not.toContain('not implemented');
      expect(message, cmd).not.toMatch(CJK);
    }
  });

  it('demoInvoke 对契约内命令真的走到 demoBackend：已落地的那条 resolve 出内存库里的种子数据', async () => {
    // 探针退休后的等价物（简报 §C-3）：旧断言只看「reject 的消息里带命令名」，
    // 这条直接拿回**库里的种子设置** ⇒ 既证明分派穿过了守卫与延迟层到达 handler，
    // 也证明 handler 真的读到了内存库（旧探针证不了后半截，严格更强）。
    const settings = await demoInvoke<AppSettings>('settings_get');

    expect(settings).toEqual(SEED_SETTINGS.app);
    // 归一化后的稳定 id（`LlmProvider::default()` = DeepSeek，带下划线）。
    expect(settings.model.provider).toBe('deep_seek');
  });

  it('demoInvoke 对未知命令 reject ipc/unknown_command，params.cmd 逐字等于命令名', async () => {
    const cause = await capture(() => demoInvoke('not_a_command'));

    expect(isIpcErrorPayload(cause)).toBe(true);
    if (!isIpcErrorPayload(cause)) throw new Error('unreachable');
    expect(cause.code).toBe('ipc/unknown_command');
    // 契约（contracts/error-codes.json）里这条码的 params 只有一个键 `cmd`。
    expect(cause.params).toEqual({ cmd: 'not_a_command' });
    expect(cause.message).toBe('ipc/unknown_command cmd=not_a_command');
    expect(cause.message).not.toMatch(CJK);
    expect(cause.detail).toBeNull();
  });

  it('未知命令守卫挡得住原型链上的键名（只看自有键）', async () => {
    for (const cmd of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      const cause = await capture(() => demoInvoke(cmd));

      expect(isIpcErrorPayload(cause), cmd).toBe(true);
      if (!isIpcErrorPayload(cause)) throw new Error('unreachable');
      expect(cause.code).toBe('ipc/unknown_command');
      expect(cause.params).toEqual({ cmd });
    }
  });

  it('demoError 只造契约形状：params 原样、message 是键按字典序的紧凑串', () => {
    const payload = demoError(
      'validation/failed',
      {
        reason: 'required',
        field: 'brand_name',
        value: '',
        limit: '40',
        expected: '1~40',
      },
      { row: 3 },
    );

    expect(payload.code).toBe('validation/failed');
    expect(Object.keys(payload.params ?? {}).sort()).toEqual([
      'expected',
      'field',
      'limit',
      'reason',
      'value',
    ]);
    // 与后端 IpcError::with_params 同构：`{code} {k}={v}…`，键按 BTreeMap（字典序）排。
    expect(payload.message).toBe(
      'validation/failed expected=1~40 field=brand_name limit=40 reason=required value=',
    );
    expect(payload.message).not.toMatch(CJK);
    expect(payload.detail).toEqual({ row: 3 });
  });

  it('demoError 不带参数时 message 就是 code 本身（与后端一致）', () => {
    const payload = demoError('llm/missing_secret');

    expect(payload.params).toEqual({});
    expect(payload.message).toBe('llm/missing_secret');
    expect(payload.detail).toBeNull();
  });
});

describe('demo/latency · 测试路径必须是 0', () => {
  it('测试环境下 withLatency() 不等待（全量门禁不被 90 条种子 × 120ms 拖慢）', async () => {
    expect(DEFAULT_DEMO_LATENCY_MS).toBe(120);

    const startedAt = performance.now();
    await withLatency();
    const elapsed = performance.now() - startedAt;

    expect(elapsed).toBeLessThan(20);
  });

  it('setDemoLatency 能显式改等待时长，且置回 null 后恢复默认判定', async () => {
    setDemoLatency(40);
    const startedAt = performance.now();
    await withLatency(0);
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(30);

    setDemoLatency(null);
    const resetAt = performance.now();
    await withLatency();
    expect(performance.now() - resetAt).toBeLessThan(20);
  });

  it('demoInvoke 在测试里不因默认延迟变慢', async () => {
    const startedAt = performance.now();
    await capture(() => demoInvoke('settings_get'));
    expect(performance.now() - startedAt).toBeLessThan(50);
  });
});

describe('demo/db · 刷新即重置', () => {
  it('createDemoDb() 每次返回深拷的新实例，互不共享引用', () => {
    const first = createDemoDb();
    const second = createDemoDb();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(first.projects).not.toBe(second.projects);

    first.projects[0].name = 'mutated-by-test';
    expect(second.projects[0].name).toBe(SEED_PROJECTS[0].name);
    expect(SEED_PROJECTS[0].name).toBe('澜舟工业除尘设备');
  });

  it('改坏 db 后 resetDemoDb() 回到种子态，且种子模块没被污染', () => {
    const db = getDemoDb();
    db.projects[0].name = 'mutated-by-test';
    // 正向对照：改的确实是 getDemoDb() handing 出去的同一个实例，不是副本。
    expect(getDemoDb().projects[0].name).toBe('mutated-by-test');

    resetDemoDb();

    expect(getDemoDb().projects[0].name).toBe(SEED_PROJECTS[0].name);
    expect(getDemoDb().projects[0].name).not.toBe('mutated-by-test');
    expect(SEED_PROJECTS[0].name).toBe('澜舟工业除尘设备');
  });

  it('重置后库里就是种子里那 2 个项目（1 个 active、1 个 archived）', () => {
    resetDemoDb();
    const db = getDemoDb();

    expect(db.projects).toHaveLength(2);
    expect(db.projects.map((project) => project.name)).toEqual(
      SEED_PROJECTS.map((project) => project.name),
    );
    expect(db.projects.map((project) => project.status)).toEqual(['active', 'archived']);
    // Task 12 接上 project_list 之后，这条断言会从「读 db」升级成「读 handler 的返回值」。
    expect(db.profiles).toEqual([]);
    expect(db.secrets).toHaveLength(7);
    expect(db.secrets.every((secret) => secret.configured)).toBe(false);
  });
});

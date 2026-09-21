/**
 * demo 假后端骨架的门禁测试（Task 11 · 计划正文 Task 11 的第 1 步）。
 *
 * 钉三件事：
 * ① **键集全覆盖**：`demoBackend` 的键集合与 `IPC_COMMANDS` **完全相等**。
 *    `Record<IpcCommand, DemoHandler>` 已经在编译期强制全覆盖（AGENTS 规则 8「命令增减两侧
 *    同时改」的保证），但本轮的未知命令守卫是拿**这张表的键**在运行时收窄的 ⇒ 键集漂了，
 *    守卫就跟着漂。编译期网 + 运行期集合相等，两道一起才算钉住。
 * ② **本轮 40 条 handler 全部未实现**：抛的是给开发者看的英文 `Error`（`not implemented: <cmd>`），
 *    经 `api/client.ts` 的 `callVia` 归一化成 `ipc/invoke_failed`。
 *    ⚠ Task 12–14 逐条替换 handler 时，被替换掉的那条命令要从 ② 的清单里摘掉——
 *    那是**预期演进**（骨架变实体），不是断言降级。
 * ③ **刷新即重置**：`resetDemoDb()` 真的从种子重建，且种子模块自身不被 db 的改动污染（深拷）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import { IPC_COMMANDS } from '../api/client';
import { isIpcErrorPayload } from '../api/types';
import { demoBackend, demoInvoke } from './backend';
import { createDemoDb, getDemoDb, resetDemoDb } from './db';
import { DEFAULT_DEMO_LATENCY_MS, setDemoLatency, withLatency } from './latency';
import { SEED_PROJECTS } from './seed/projects';
import { demoError } from './types';

/** 与 `demo/backend.ts` 里的措辞对齐（这里独立写死，不 import 生产常量，免得自我印证）。 */
const NOT_IMPLEMENTED = 'not implemented: ';

/** 与 `client.demo-runtime.test.ts` 同一条判据：开发者诊断串不许含 CJK（§B-11）。 */
const CJK = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;

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

  it('40 条 handler 逐条抛「not implemented: <cmd>」的英文 Error', async () => {
    for (const cmd of IPC_COMMANDS) {
      const cause = await capture(() => demoBackend[cmd]({}));

      expect(cause, cmd).toBeInstanceOf(Error);
      expect((cause as Error).message).toBe(`${NOT_IMPLEMENTED}${cmd}`);
      expect((cause as Error).message).not.toMatch(CJK);
    }
  });

  it('demoInvoke 对契约内命令真的走到 demoBackend（消息里带命令名）', async () => {
    const cause = await capture(() => demoInvoke('project_list', { filter: {} }));

    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toBe(`${NOT_IMPLEMENTED}project_list`);
    expect((cause as Error).message).not.toMatch(CJK);
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

/**
 * demo 运行时下的分派（Task 10 落的接缝，接上 `src/demo/backend.ts` 之后按新契约改写）。
 *
 * **单独一个文件**，因为 `vi.mock` 是文件作用域的：`client.test.ts` 的存量用例测的是
 * **Tauri 分派路径**（桩打在 `mockInvoke` 上），把整个文件 mock 成 demo 会把它们全部带偏。
 *
 * 机制：这里把 `./runtime` mock 成 `'demo'`，于是 `client.ts` 分派点选中的 invoker 是
 * `demo/backend.ts` 的 `demoInvoke`，而不是 Tauri 的 `invoke`。断言三件事：
 *   ① **契约内**的命令走到假后端，钉**两个半边**：
 *      - **未实现探针**：挑**当前仍是骨架的那一条命令**（即 `demo/backend.ts` 里仍由
 *        `notImplemented()` 占位的那条；探针随 handler 逐轮落地而往后移一位），
 *        断言它 reject 出「未实现」的**英文**开发者信息，经 `callVia`
 *        的 catch 归一化成 `ipc/invoke_failed`（不新增错误码：`contracts/error-codes.json` 冻结在
 *        43 条）。消息里**含命令名** ⇒ 同时证明「真的到达了 `demoBackend`」，否则「两边都没调」也会绿。
 *      - **已实现半边**：已接真 handler 的命令（本轮取 `project_list`）必须 **resolve 出真种子数据**
 *        （按种子的 id / brand_name 断言，不重打字面量）⇒ 证明分派真的读到了内存库，而不是空转。
 *   ② **契约外**的命令走 demo 守卫 ⇒ `ipc/unknown_command` + `params.cmd` 逐字等于命令名
 *      （`contracts/error-codes.json` 里那条 note 点名的唯一发射点），且归一化后 code 不被吞掉。
 *   ③ demo 分支**绕过了** `invoke`——桩打在 `mockInvoke` 上也不会被碰到。
 *      ③才是「分派真的换了 invoker」的判据：把分派点改回直接调 `invoke`，①拿不到英文信息、
 *      ③数出一次调用，两条一起红。
 *
 * ⚠ 与 `client.demo-seam.test.ts` 的分工：本文件把检测结论**喂**给分派点（证分派正确），
 * 那一份用**真** `runtime` 模块（证检测结论真的传到了分派点、且绕开了 Tauri）。
 *
 * ⚠ **未实现探针是移动的**：某条命令一旦接上真 handler，它就退出探针位、改由「已实现半边」钉住，
 * 探针往后移一位到下一条仍是骨架的命令；40 条全部落地后这半个用例退休。
 * 「③零调用」与「①不含 CJK」是**不变量**，与探针移到哪一条无关（开发者诊断串一律 ASCII，简报 §B-11）。
 */
import { describe, expect, it, vi } from 'vitest';

import * as client from './client';
import { demoInvoke } from '../demo/backend';
import { mockInvoke } from '../test/invoke-mock';
import { isIpcErrorPayload } from './types';
import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID, SEED_PROJECTS } from '../demo/seed/projects';

// `client.ts` 只从 `./runtime` 取 `runtime` 这一个绑定，所以工厂给它就够了。
vi.mock('./runtime', () => ({ runtime: 'demo' }));

/** 与 `demo/backend.ts` 的 `NOT_IMPLEMENTED` 措辞对齐（独立写死，不 import 生产常量免得自我印证）。 */
const NOT_IMPLEMENTED = 'not implemented: ';
const INVOKE_FAILED = 'ipc/invoke_failed';
const UNKNOWN_COMMAND = 'ipc/unknown_command';
const CJK = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;

describe('api/client · demo 运行时（分派到 src/demo/backend.ts 的假后端）', () => {
  it('契约内的命令走到 demoBackend：reject「未实现」的英文信息并归一化成 ipc/invoke_failed', async () => {
    mockInvoke.stubAlways('settings_get', () => ({}));

    const error: unknown = await client.settingsGet().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(client.IpcRequestError);
    if (!(error instanceof client.IpcRequestError)) throw new Error('expected IpcRequestError');
    expect(error.code).toBe(INVOKE_FAILED);
    // 含命令名 ⇒ 证明真的到达了 demoBackend（正向对照，不是「两边都没调」的假绿）。
    expect(error.message).toContain(`${NOT_IMPLEMENTED}settings_get`);
    expect(error.params).toEqual({
      cmd: 'settings_get',
      reason: `${NOT_IMPLEMENTED}settings_get`,
    });
    // 开发者诊断串不进词典、不上屏，一律 ASCII（简报 §B-11）。
    expect(error.message).not.toMatch(CJK);
  });

  it('已实现半边：M1 的命令 resolve 出真种子数据（分派真的读到内存库，不是空转）', async () => {
    const rows = await client.projectList({});

    expect(rows.map((row) => row.id)).toContain(SEED_ACTIVE_PROJECT_ID);
    expect(rows.map((row) => row.brand_name)).toContain(SEED_PROJECTS[0].brand_name);
    // 默认过滤掉归档项目：种子那条 archived 不在结果里（过滤逻辑也是真的在跑）。
    expect(rows.map((row) => row.id)).not.toContain(SEED_ARCHIVED_PROJECT_ID);
  });

  it('契约外的命令走 demo 守卫：ipc/unknown_command + params.cmd 逐字相等', async () => {
    const cause: unknown = await demoInvoke('not_a_command').catch((error: unknown) => error);

    expect(isIpcErrorPayload(cause)).toBe(true);
    if (!isIpcErrorPayload(cause)) throw new Error('expected IpcErrorPayload');
    // 契约里这条码的 params 只有一个键 `cmd`。
    expect(cause.code).toBe(UNKNOWN_COMMAND);
    expect(cause.params).toEqual({ cmd: 'not_a_command' });
    expect(cause.message).not.toMatch(CJK);

    // 归一化之后 code 与 params 都不被吞掉（`unwrapIpcError` 认得 payload 形状）。
    const normalized = client.unwrapIpcError('not_a_command', cause);
    expect(normalized).toBeInstanceOf(client.IpcRequestError);
    expect(normalized.code).toBe(UNKNOWN_COMMAND);
    expect(normalized.params).toEqual({ cmd: 'not_a_command' });
  });

  it('demo 分支不调用 invoke：桩在 mockInvoke 上也不会被碰到', async () => {
    mockInvoke.stubAlways('settings_get', () => ({ locale: 'zh-CN' }));

    await client.settingsGet().catch(() => undefined);

    expect(mockInvoke.callsOf('settings_get')).toHaveLength(0);
  });
});

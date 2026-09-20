/**
 * demo 运行时下的分派（Task 10 · 简报 §B-2，控制器更正 #22 第 2 条）。
 *
 * **单独一个文件**，因为 `vi.mock` 是文件作用域的：`client.test.ts` 的存量用例测的是
 * **Tauri 分派路径**（桩打在 `mockInvoke` 上），把整个文件 mock 成 demo 会把它们全部带偏。
 *
 * 这里 mock 掉 `./runtime` 给出 `'demo'`，断言两件事：
 *   ① 经 `call()` 的导出函数 reject 出**含那句英文开发者信息**的 Error，且消息里没有 CJK
 *      （Task 9 §B-4 的先例：跑在 i18n 之外的诊断串用英文、不进词典）；
 *   ② demo 分支**绕过了** `invoke`——桩打在 `mockInvoke` 上也不会被碰到。
 *      ②才是「分派真的换了 invoker」的判据，也是 §D-9 变异③（`call()` 直接调真 `invoke`）
 *      的落点：那条变异会让 ① 拿不到英文信息、② 数出一次调用，两条一起红。
 */
import { describe, expect, it, vi } from 'vitest';

import * as client from './client';
import { mockInvoke } from '../test/invoke-mock';

// `client.ts` 只从 `./runtime` 取 `runtime` 这一个绑定，所以工厂给它就够了。
vi.mock('./runtime', () => ({ runtime: 'demo' }));

/** 与 `client.ts` 里 `DEMO_NOT_WIRED` 的措辞对齐（这里只钉语义部分，不钉 Task 编号）。 */
const DEMO_NOT_WIRED = 'demo runtime detected but the demo backend is not wired yet';

describe('api/client · demo 运行时（假后端是 Task 11 的产物）', () => {
  it('抛出的消息点名「非 Tauri 运行时 + demo 后端未接线」，且不含 CJK', async () => {
    mockInvoke.stubAlways('project_list', () => []);

    const error = (await client.projectList({}).catch((cause: unknown) => cause)) as Error;

    // 它经 `callVia` 的 catch 归一化成 `ipc/invoke_failed`，与任何 invoker 失败同一条路径
    // （不新增错误码：`contracts/error-codes.json` 冻结在 43 条）。
    expect(error).toBeInstanceOf(client.IpcRequestError);
    expect(error.message).toContain(DEMO_NOT_WIRED);
    expect(error.message).not.toMatch(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/);
  });

  it('demo 分支不调用 invoke：桩在 mockInvoke 上也不会被碰到', async () => {
    mockInvoke.stubAlways('settings_get', () => ({ locale: 'zh-CN' }));

    await client.settingsGet().catch(() => undefined);

    expect(mockInvoke.callsOf('settings_get')).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';

import * as client from './client';
import { describeIpcError } from './errors';
import { i18n } from '../i18n';
import { makeProject } from '../test/fixtures';
import { mockInvoke } from '../test/invoke-mock';

const project = {
  id: 'p-1',
  name: '宏宇泵业 GEO',
  brand_name: '宏宇泵业',
  aliases: ['宏宇'],
  website: 'https://www.hongyu-pump.example',
  region: '浙江杭州',
  language: 'zh_cn',
  industry: 'b2b_manufacturing',
  industry_label: null,
  tags: ['水泵'],
  status: 'active',
  archived_at: null,
  created_at: '2026-09-16T00:00:00Z',
  updated_at: '2026-09-16T00:00:00Z',
};

describe('api/client', () => {
  it('projectList 在 mock invoke 下返回项目数组', async () => {
    mockInvoke.stub('project_list', () => [project]);

    const result = await client.projectList({ include_archived: false });

    expect(result).toHaveLength(1);
    expect(result[0].brand_name).toBe('宏宇泵业');
    expect(mockInvoke.callsOf('project_list')).toHaveLength(1);
    expect(mockInvoke.lastArgsOf('project_list')).toEqual({ filter: { include_archived: false } });
  });

  // fixture 用契约内的真实形状（复审 F-2h②）：`store/sqlx` 后端零发射点
  // （`StoreError::Sqlx` 映射成 `state/conflict` 或 `io/failed`，`geo-store/src/error.rs:146`-`:152`），
  // 拿它当 fixture 会让「后端报错」这条路径永远走词典 miss，页面级错误渲染等于没测。
  it('后端返回 IpcError 时抛出带稳定 code、params 与紧凑 message 的 Error', async () => {
    mockInvoke.stub(
      'project_list',
      {
        code: 'io/failed',
        params: { reason: 'Permission denied (os error 13)' },
        message: 'io/failed reason=Permission denied (os error 13)',
      },
      'reject',
    );

    const error = (await client.projectList({}).catch((cause: unknown) => cause)) as client.IpcRequestError;

    expect(error).toBeInstanceOf(client.IpcRequestError);
    expect(error.code).toBe('io/failed');
    expect(error.params).toEqual({ reason: 'Permission denied (os error 13)' });
    expect(error.message).toBe('io/failed reason=Permission denied (os error 13)');
    // 词典渲染出来是人话，不是紧凑串
    expect(describeIpcError(error, i18n.getFixedT('zh-CN'))).toBe(
      '文件或数据库读写失败：Permission denied (os error 13)',
    );
  });

  it('抛出的错误保留稳定错误码', async () => {
    mockInvoke.stub(
      'project_get',
      { code: 'project/not_found', message: 'project 不存在：nope' },
      'reject',
    );

    const error = await client.projectGet('nope').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(client.IpcRequestError);
    expect((error as client.IpcRequestError).code).toBe('project/not_found');
  });

  // B-2（复审 I-1）：这里曾经合成 `ipc/internal`，而它的模板**没有占位符**
  // （契约把 params 冻结成 `[]`）⇒ 命令名与真实原因被词典整个吞掉，用户只看到
  // 「内部错误，请重试」——对确定性的参数形状不匹配而言还是个错建议。
  it('非结构化异常包装为 ipc/invoke_failed，命令名与原因都留在 params 里', async () => {
    mockInvoke.stub('settings_get', new TypeError('boom'), 'reject');

    const error = (await client.settingsGet().catch((cause: unknown) => cause)) as client.IpcRequestError;

    expect(error.code).toBe('ipc/invoke_failed');
    expect(error.params).toEqual({ cmd: 'settings_get', reason: 'boom' });
    // message 是语言中立的紧凑串，与后端 `IpcError::with_params` 同构（键按 BTreeMap 排序）
    expect(error.message).toBe('ipc/invoke_failed cmd=settings_get reason=boom');
    // 计划正文 Task 9 那条 checkbox 点名要「`message` 不含 CJK」：上面那条是**逐字相等**，
    // 已经严格强于它。这里再补一条显式字符类断言，让这条判据在字面值将来改动后仍独立成立
    // （含 CJK 标点——`\u4e00-\u9fa5` 看不见 `、`/`：` 这类字符，Task 8 复审 #6 踩过）。
    expect(error.message).not.toMatch(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/);
  });

  it('B-2 · 合成出来的错误经词典渲染后，命令名与真实原因都还在（信息量不回退）', async () => {
    // 这才是本条的真正判据：将来有人把 code 改回 `ipc/internal`，这两行就会红。
    mockInvoke.stub(
      'project_update',
      'invalid args `project` for command `project_update`: command project_update missing required key status',
      'reject',
    );

    const error = (await client.projectUpdate(makeProject()).catch((cause: unknown) => cause)) as client.IpcRequestError;
    const zhText = describeIpcError(error, i18n.getFixedT('zh-CN'));
    const enText = describeIpcError(error, i18n.getFixedT('en-US'));

    for (const text of [zhText, enText]) {
      expect(text).toContain('project_update');
      expect(text).toContain('missing required key status');
      expect(text).not.toContain('内部错误');
      expect(text).not.toContain('Internal error');
    }
    expect(zhText).toBe(
      '调用 project_update 失败：invalid args `project` for command `project_update`: command project_update missing required key status',
    );
  });

  it('promptSetGenerate 透传生成参数', async () => {
    mockInvoke.stub('prompt_set_generate', () => ({ id: 's-1', items: [] }));

    await client.promptSetGenerate('p-1', { target_count: 80, industry: 'b2b_manufacturing' });

    expect(mockInvoke.lastArgsOf('prompt_set_generate')).toEqual({
      project_id: 'p-1',
      options: { target_count: 80, industry: 'b2b_manufacturing' },
    });
  });

  it('命令名集合稳定，防止前后端漂移', () => {
    expect(client.IPC_COMMANDS.length).toBeGreaterThan(30);
    expect(new Set(client.IPC_COMMANDS).size).toBe(client.IPC_COMMANDS.length);
    expect(client.IPC_COMMANDS).toContain('entity_card_autobuild');
  });

  /**
   * 裁定 B-3.1：`super(payload.message || '未知错误')` 的中文兜底改成语言中立记号。
   *
   * 为什么这条要紧：`message` 的既有定位是**紧凑诊断串**（`unwrapIpcError` 按
   * `{code} {k}={v}…` 填），而 `describeIpcError` 的词典 miss 那一级会**回落 `error.message`**
   * ⇒ 兜底填一句中文，等于让「后端发了合法 payload 但 message 是空串」这种契约破损
   * 在界面上伪装成一句正常文案，排障线索也没了。
   */
  it('B-3 · 后端发空 message 时兜到 code 本身，且兜底记号语言中立', async () => {
    mockInvoke.stub('project_list', { code: 'state/conflict', params: {}, message: '' }, 'reject');

    const error = (await client.projectList({}).catch((cause: unknown) => cause)) as client.IpcRequestError;

    expect(error).toBeInstanceOf(client.IpcRequestError);
    expect(error.code).toBe('state/conflict');
    expect(error.message).toBe('state/conflict');
    // Task 15 的残留判据提前到运行期：兜底记号里一个 CJK 字符都不许有（含 CJK 标点）
    expect(error.message).not.toMatch(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/);
  });

  it('B-3 · code 也是空串时兜到 ipc/unknown，message 与 code 同源（不新增第三种记号）', async () => {
    mockInvoke.stub('project_get', { code: '', message: '' }, 'reject');

    const error = (await client.projectGet('nope').catch((cause: unknown) => cause)) as client.IpcRequestError;

    expect(error.code).toBe('ipc/unknown');
    expect(error.message).toBe('ipc/unknown');
  });

  /**
   * 裁定 B-3.2：删掉 `get userMessage()`。唯一读者（`pages/ProjectWizardPage.tsx`）改走
   * `describeIpcError(error, t)`；`@ts-expect-error` 让「getter 又被人加回来」在 `tsc -b` 就红，
   * 而运行期断言让「还没删」也红——两侧都是可失败的判据，不是注释。
   * （`components/` 里那 3 处 `userMessage` 命中全是 Task 8 留下的说明性注释，不许删。）
   */
  it('B-3 · userMessage getter 已删除，类型层封死任何幸存读者', () => {
    const error = new client.IpcRequestError({ code: 'io/failed', message: 'io/failed reason=x' });

    // @ts-expect-error Task 9 删掉了这个 getter（连带它那句已经失真的文档注释）
    expect(error.userMessage).toBeUndefined();
    expect(error.message).toBe('io/failed reason=x');
  });

  /**
   * 裁定 B-2（Task 10）第 1 条：`callVia` 把「用哪个 invoker」变成参数。
   *
   * 这两条钉住注入语义本身：注入的 invoker 真的被调用、真 `invoke` 一次都没被碰到，
   * 且 invoker 的拒绝仍走 `unwrapIpcError` 归一化（分派点搬家了，错误契约不变）。
   * ⚠ 本文件**刻意不 mock** `./runtime`：这里的存量用例测的是 Tauri 分派路径
   * （桩打在 `mockInvoke` 上），而 `vi.mock` 是文件作用域的——demo 分支的用例单独放在
   * `client.demo-runtime.test.ts`。
   */
  it('B-2 · callVia 走注入的 invoker，真 invoke 一次都没被调用', async () => {
    const seen: Array<[string, Record<string, unknown> | undefined]> = [];
    const fakeInvoker = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
      seen.push([cmd, args]);
      return [{ id: 'from-injected-invoker' }] as T;
    };

    const result = await client.callVia<{ id: string }[]>('project_list', { filter: {} }, fakeInvoker);

    expect(result).toEqual([{ id: 'from-injected-invoker' }]);
    expect(seen).toEqual([['project_list', { filter: {} }]]);
    // 注入点生效的判据：真 `invoke`（测试里就是 `mockInvoke`）一次都没被碰到
    expect(mockInvoke.callsOf('project_list')).toHaveLength(0);
  });

  it('B-2 · callVia 仍把 invoker 的拒绝归一化成 IpcRequestError（错误契约不随分派点改变）', async () => {
    const boom = async (): Promise<never> => {
      throw new TypeError('boom');
    };

    const error = (await client
      .callVia('settings_get', undefined, boom)
      .catch((cause: unknown) => cause)) as client.IpcRequestError;

    expect(error).toBeInstanceOf(client.IpcRequestError);
    expect(error.code).toBe('ipc/invoke_failed');
    expect(error.params).toEqual({ cmd: 'settings_get', reason: 'boom' });
  });
});

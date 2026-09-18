/**
 * 测试替身：替换 `@tauri-apps/api/core` 的 `invoke`。
 *
 * vite.config.ts 在 test 环境把 `@tauri-apps/api/core` 别名到本文件，
 * 因此组件与 `src/api/client.ts` 无需任何条件分支即可在 jsdom 下运行。
 *
 * 用法：
 * ```ts
 * mockInvoke.stub('project_list', () => [project]);
 * mockInvoke.stub('project_list', { code: 'boom', message: '炸了' }, 'reject');
 * expect(mockInvoke.callsOf('project_list')).toHaveLength(1);
 * ```
 */

export type InvokeHandler = (args: Record<string, unknown>) => unknown;

/**
 * 桩值：函数按「每次调用现算」处理，其它值按深拷贝返回。
 *
 * 写成联合类型（而不是 `unknown`）是为了让 `stubAlways('x', (args) => ...)`
 * 里的 `args` 拿到上下文类型——`unknown` 会让它退化成隐式 any，
 * 在 `tsc -b` 的严格模式下直接报错。
 */
export type StubValue =
  | InvokeHandler
  | Error
  | string
  | number
  | boolean
  | null
  | unknown[]
  | Record<string, unknown>;

type StubEntry = {
  mode: 'resolve' | 'reject';
  handler: InvokeHandler | { error: unknown };
};

const stubs = new Map<string, StubEntry[]>();
const calls: { cmd: string; args: Record<string, unknown> }[] = [];

/** 默认桩：未 stub 的命令直接 reject，避免测试静默通过。 */
let fallback: InvokeHandler | null = null;

export const mockInvoke = {
  stub(cmd: string, value: StubValue, mode: 'resolve' | 'reject' = 'resolve') {
    const entry: StubEntry =
      mode === 'reject'
        ? { mode, handler: { error: value } }
        : {
            mode,
            handler:
              typeof value === 'function'
                ? (value as InvokeHandler)
                : () => structuredClone(value),
          };
    const list = stubs.get(cmd) ?? [];
    list.push(entry);
    stubs.set(cmd, list);
    return mockInvoke;
  },

  stubAlways(cmd: string, value: StubValue, mode: 'resolve' | 'reject' = 'resolve') {
    mockInvoke.stub(cmd, value, mode);
    const list = stubs.get(cmd)!;
    const last = list[list.length - 1];
    (last as StubEntry & { always?: boolean }).always = true;
    return mockInvoke;
  },

  setFallback(handler: InvokeHandler | null) {
    fallback = handler;
    return mockInvoke;
  },

  callsOf(cmd: string) {
    return calls.filter((call) => call.cmd === cmd);
  },

  lastArgsOf(cmd: string): Record<string, unknown> | undefined {
    const matched = mockInvoke.callsOf(cmd);
    return matched[matched.length - 1]?.args;
  },

  allCalls() {
    return [...calls];
  },

  reset() {
    stubs.clear();
    calls.length = 0;
    fallback = null;
    return mockInvoke;
  },
};

export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const payload = args ?? {};
  calls.push({ cmd, args: structuredClone(payload) });

  const list = stubs.get(cmd);
  if (list && list.length > 0) {
    const entry = list.length === 1 && (list[0] as StubEntry & { always?: boolean }).always
      ? list[0]
      : list.shift()!;
    if (list.length === 0) stubs.delete(cmd);
    if (entry.mode === 'reject') {
      return Promise.reject((entry.handler as { error: unknown }).error);
    }
    return Promise.resolve((entry.handler as InvokeHandler)(payload) as T);
  }

  if (fallback) return Promise.resolve(fallback(payload) as T);

  return Promise.reject(new Error(`未预期的 IPC 调用：${cmd}`));
}

export default invoke;

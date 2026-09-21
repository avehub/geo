/**
 * demo 的假延迟：让浏览器里的 loading 态**看得见**（计划正文 Task 11 的动机）。
 *
 * 真实后端有网络与 LLM 往返，界面因此有过渡态；假后端同步返回会让那些 loading / skeleton
 * 永远一闪而过，产品负责人走查不到。所以在每条命令前插一小段可配置的等待。
 *
 * # 三个必须同时成立的约束（简报 §B-9）
 * ① 浏览器 demo 里默认等 **120ms**；
 * ② **全量测试里必须是 0**：90 条种子 × 多个命令 × 120ms 会显著拖长门禁；
 * ③ 状态**可复位**、用例之间不串味。
 *
 * ②的实现方式是读 `import.meta.env.MODE === 'test'`（vitest 固定用 `test` 这个 mode），
 * 而不是靠每个测试文件自己调 `setDemoLatency(0)`：全局复位本该写在 `src/test/setup.ts`，
 * 但那个文件本轮**禁改**（简报 §C），而 `api/client.demo-runtime.test.ts` 这类存量文件
 * 也会经分派点走到这里。放在被调用的这一侧，才能让「测试路径是 0」成为**结构性事实**，
 * 而不是「每个作者都记得写一行」的约定。
 *
 * `setDemoLatency()` 仍然保留：它优先级高于 mode 判定，用来在测试里显式验证
 * 「浏览器那条路真的会等」（否则 ① 就没有任何非空洞的证据）。
 */

/** 浏览器 demo 里的默认等待时长。 */
export const DEFAULT_DEMO_LATENCY_MS = 120;

/** vitest 跑起来时的 `import.meta.env.MODE`。 */
const TEST_MODE = 'test';

/** 显式覆盖；`null` = 不覆盖，回落到 mode 判定。 */
let overrideMs: number | null = null;

/**
 * 显式设置延迟（毫秒），传 `null` 复位成默认判定。
 *
 * 复位是调用方的责任：照本仓既有做法写在 `afterEach` 里
 * （先例：`vi.restoreAllMocks()`、`mockInvoke.reset()`）。
 */
export function setDemoLatency(ms: number | null): void {
  overrideMs = ms;
}

/** 实际会等多久：显式覆盖优先，其次测试环境归零，最后才是请求值。 */
export function demoLatencyMs(requestedMs: number): number {
  if (overrideMs !== null) return overrideMs;
  return import.meta.env.MODE === TEST_MODE ? 0 : requestedMs;
}

/**
 * 等一段假延迟。`ms <= 0` 时**不排 setTimeout**：测试路径上这是一次同步返回，
 * 不给事件循环添任何额外 tick（这也是「测试耗时不涨」的机制保证）。
 */
export async function withLatency(ms: number = DEFAULT_DEMO_LATENCY_MS): Promise<void> {
  const wait = demoLatencyMs(ms);
  if (wait <= 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, wait);
  });
}

/**
 * demo 假后端的门禁测试（命令面已全部落地，这里守的是「不许再退回骨架」这件事）。
 *
 * 钉四件事：
 * ① **键集全覆盖**：`demoBackend` 的键集合与 `IPC_COMMANDS` **完全相等**。
 *    `Record<IpcCommand, DemoHandler>` 已经在编译期强制全覆盖（AGENTS 规则 8「命令增减两侧
 *    同时改」的保证），但未知命令守卫是拿**这张表的键**在运行时收窄的 ⇒ 键集漂了，
 *    守卫就跟着漂。编译期网 + 运行期集合相等，两道一起才算钉住。
 * ② **83 条全部脱离骨架**：逐条空入参调用，谁都不许再抛「未实现」。
 *    🔴 这条是「未实现探针」退休后的**对价**：探针的价值是「证明分派真的到了
 *    `demoBackend`」，全部命令落地之后它无处可移；接管的这条断言面从
 *    **32 → 40 → 60 → 62 → 72 → 83**（M3–M7 那 20 条是 demo 闭环那一轮加的、Plan B 加 2 条、
 *    M1.5 素材层加 10 条、M6.5 站点接入加 11 条），并按模块逐条列出清单（不用前缀正则）
 *    ——那张清单同时就是「哪条命令归哪一轮」的账本。
 *    ⚠ 空入参调用时，M3–M7 的 handler 大多 reject `validation/failed`（`project_id` / `round_id`
 *    认不出）：这里断言的是**不再抛骨架那句**，不是"必须成功"，两者刻意分开。
 * ③ **`demoInvoke` 真的走到 handler**：拿一条已落地的命令断言它 **resolve 出内存库里的种子数据**。
 *    旧探针只能证明「消息里带命令名」，这条还证明「读到了库」⇒ 严格更强
 *    （退休/替换必须同时扩强别处作为对价，这条原则本身写在 `i18n/no-hardcoded-strings.test.ts` 里也一样适用）。
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

/** 设置 / 密钥 / 导出 8 条（`settings_*` 2 + `secret_*` 3 + `llm_*` 2 + `export_*` 1）。 */
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

/** M3 多引擎采集 6 条（`collection_*`）。 */
const M3_COMMANDS: readonly IpcCommand[] = [
  'collection_board',
  'collection_round_get',
  'collection_start',
  'collection_task_retry',
  'collection_record_list',
  'collection_record_get',
];

/** M4 回答解析与事实核查 4 条（`insight_*` 2 + `fact_check_*` 2）。 */
const M4_COMMANDS: readonly IpcCommand[] = [
  'insight_list',
  'insight_correct',
  'fact_check_list',
  'fact_check_resolve',
];

/** M5 诊断与归因 5 条（`diagnosis_*`）。 */
const M5_COMMANDS: readonly IpcCommand[] = [
  'diagnosis_overview',
  'diagnosis_competitors',
  'diagnosis_funnel',
  'diagnosis_engines',
  'diagnosis_alert_acknowledge',
];

/** M6 GEO 行动中心 4 条（`action_*` 2 + `content_*` 2）。 */
const M6_COMMANDS: readonly IpcCommand[] = [
  'action_board',
  'action_update_status',
  'content_generate',
  'content_update_status',
];

/** M7 报告与分享 1 条。导出文本的组装在前端（`api/report-compose.ts`），不是命令。 */
const M7_COMMANDS: readonly IpcCommand[] = ['report_render'];

/**
 * Plan B 新增的命令（🔴 **demo 独有**，Rust 侧本轮零改动 ⇒ 桌面端点进来是
 * `ipc/unknown_command`，与 M3–M7 那 20 条同一族，差异登记在 E-46 起）。
 * Task 3 加 `app_environment`；Task 4 加 `llm_models_list`（按界面上的草稿配置拉模型名清单）。
 */
const PLAN_B_COMMANDS: readonly IpcCommand[] = ['app_environment', 'llm_models_list'];

/**
 * M1.5 素材层 10 条（`keyword_*` 5 + `faq_*` 5）。
 *
 * 🔴 与 Plan B 那 2 条、M3–M7 那 20 条同族：**demo 独有**，Rust 侧本轮零改动
 * ⇒ 桌面端点进来是 `ipc/unknown_command`（差异台账 §4d E-52 起）。
 */
const LIBRARY_COMMANDS: readonly IpcCommand[] = [
  'keyword_list',
  'keyword_add',
  'keyword_update',
  'keyword_delete',
  'keyword_generate',
  'faq_list',
  'faq_add',
  'faq_update',
  'faq_delete',
  'faq_generate',
];

/**
 * M6.5 站点接入与补丁工作台 11 条（档案 + 通道 5 条在 `handlers/site.ts`，
 * 补丁台账 6 条在 `handlers/site-patch.ts`）。
 *
 * 🔴 与 M1.5 那 10 条、Plan B 那 2 条、M3–M7 那 20 条同族：**demo 独有**，Rust 侧本轮零改动
 * ⇒ 桌面端点进来是 `ipc/unknown_command`（差异台账 §4e E-55）。
 */
const SITE_COMMANDS: readonly IpcCommand[] = [
  'site_board',
  'site_profile_save',
  'site_channel_upsert',
  'site_channel_remove',
  'site_channel_test',
  'site_patch_add',
  'site_patch_generate',
  'site_patch_save',
  'site_patch_transition',
  'site_patch_history',
  'site_patch_delete',
];

/**
 * M1.2b 知识库 **6** 条（都在 `handlers/kb.ts`）。
 *
 * 🔴 与上面几批同族：**demo 独有**，Rust 侧本轮零改动 ⇒ 桌面端点进来是 `ipc/unknown_command`
 * （差异台账 §4f E-60 / §4g E-63）。
 * ⚠ 导出**不在这里**：知识册与知识包都走既有的 `export_write_file`（`SETTINGS_COMMANDS` 里那条），
 * 本轮一条导出命令都没加（spec 2026-10-01 · DR-72）。
 * 🔴 本轮**减了一条**：`kb_entry_detach` 随同步块整体退役而删除（spec 2026-10-10 · DR-73），
 * 「从实体卡导入」走既有 `kb_entry_add`（draft 带 `source:'imported'`），同样不新增命令（DR-81）。
 */
const KB_COMMANDS: readonly IpcCommand[] = [
  'kb_board',
  'kb_entry_add',
  'kb_entry_update',
  'kb_entry_delete',
  'kb_entry_verify',
  'kb_generate',
];

/**
 * M6 文章管理 Article Studio **10** 条（方向 / 模板 6 条在 `handlers/article.ts`，
 * 排期 / 文章 4 条在 `handlers/article-schedule.ts`——单文件约 400 行的软线，与 KB 那批的拆法对齐）。
 *
 * 🔴 与上面几批同族：**demo 独有**，Rust 侧本轮零改动 ⇒ 桌面端点进来是 `ipc/unknown_command`
 * （差异台账 §4g E-64）。
 * ⚠ 导出**不在这里**：Markdown 文章册在前端组装（`api/article-compose.ts`）后走既有的
 * `export_write_file`，本轮一条导出命令都没加（spec 2026-10-10 · DR-89）。
 * 🔴 命令面被 DR-87 冻在 10 条，于是有两处「一条命令两件事」：方向**归档 / 恢复**搭在
 * `article_direction_add` 带 `id` 的那一支上，文章**批量通过**搭在 `article_list` 带 `review`
 * 的那一支上（Rust 侧落地时应当拆成 `article_direction_update` / `article_review`）。
 */
const ARTICLE_COMMANDS: readonly IpcCommand[] = [
  'article_direction_list',
  'article_direction_add',
  'article_direction_generate',
  'article_template_list',
  'article_template_save',
  'article_template_delete',
  'article_schedule_list',
  'article_schedule_save',
  'article_schedule_run',
  'article_list',
];

/**
 * M5.5 站长数据 **6** 条（读出口 1 条 + 源 CRUD/自检 3 条 + 导入 1 条 + 机会处置 1 条；
 * 数据层在 `handlers/search.ts`，导入/粘贴/xlsx 解析那一支拆到 `handlers/search-import.ts`
 * ——单文件约 400 行的软线，与 KB / 文章那两批的拆法对齐）。
 *
 * 🔴 与上面几批同族：**demo 独有**，Rust 侧本轮零改动 ⇒ 桌面端点进「站长数据」是
 * `ipc/unknown_command`（差异台账 §4h E-67）。
 * ⚠ **OAuth 一条都没有**（连假授权流程也不演）：`search_source_upsert` 只存非敏感的站点绑定与
 * `secret_ref` 字符串，令牌本身永不落库（AGENTS 规则 3 / spec 2026-10-12 · DR-96）。
 * ⚠ CSV 模板导出**不在这里**：走既有的 `export_write_file`，本轮一条导出命令都没加。
 * 🔴 归一 / 求和 / 重算 / 区间收敛**不是命令**：它们在前端 `api/search-compose.ts` 真算（DR-99），
 * 所以这一批命令只负责"存取"，不负责"算"。
 */
const SEARCH_COMMANDS: readonly IpcCommand[] = [
  'search_board',
  'search_source_upsert',
  'search_source_remove',
  'search_source_test',
  'search_metric_import_csv',
  'search_opportunity_update',
];

/** 已接线全集（② 的断言面）：**只增不减**；`IPC_COMMANDS` 全部接满之后就是 105 条全集。 */
const IMPLEMENTED_COMMANDS: readonly IpcCommand[] = [
  ...M1_COMMANDS,
  ...M2_COMMANDS,
  ...SETTINGS_COMMANDS,
  ...M3_COMMANDS,
  ...M4_COMMANDS,
  ...M5_COMMANDS,
  ...M6_COMMANDS,
  ...M7_COMMANDS,
  ...PLAN_B_COMMANDS,
  ...LIBRARY_COMMANDS,
  ...SITE_COMMANDS,
  ...KB_COMMANDS,
  ...ARTICLE_COMMANDS,
  ...SEARCH_COMMANDS,
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
  it('demoBackend 的键集合与 IPC_COMMANDS 完全相等（105 条，不多不少）', () => {
    const keys = Object.keys(demoBackend);

    expect(IPC_COMMANDS).toHaveLength(105);
    expect(keys).toHaveLength(IPC_COMMANDS.length);
    expect([...keys].sort()).toEqual([...IPC_COMMANDS].sort());
  });

  it('105 条全部脱离骨架：空入参调用不再抛「not implemented」（反向断言，强度只增不减）', async () => {
    // 十四份账本各自的条数写死在这里：将来加一条命令必须同时改这个数，改不动就是没真的加。
    expect(M1_COMMANDS).toHaveLength(21);
    expect(M2_COMMANDS).toHaveLength(11);
    expect(SETTINGS_COMMANDS).toHaveLength(8);
    expect(M3_COMMANDS).toHaveLength(6);
    expect(M4_COMMANDS).toHaveLength(4);
    expect(M5_COMMANDS).toHaveLength(5);
    expect(M6_COMMANDS).toHaveLength(4);
    expect(M7_COMMANDS).toHaveLength(1);
    expect(PLAN_B_COMMANDS).toHaveLength(2);
    expect(LIBRARY_COMMANDS).toHaveLength(10);
    expect(SITE_COMMANDS).toHaveLength(11);
    expect(KB_COMMANDS).toHaveLength(6);
    expect(ARTICLE_COMMANDS).toHaveLength(10);
    expect(SEARCH_COMMANDS).toHaveLength(6);
    expect(IMPLEMENTED_COMMANDS).toHaveLength(105);
    // 账本没有漏项：`IPC_COMMANDS` 里没有一条还挂在「待实现」上（清单接满后这个集合恒空）。
    expect(IPC_COMMANDS.filter((cmd) => !IMPLEMENTED_COMMANDS.includes(cmd))).toEqual([]);

    for (const cmd of IMPLEMENTED_COMMANDS) {
      const cause = await capture(() => demoBackend[cmd]({}));
      const message = cause instanceof Error ? cause.message : '';

      expect(message, cmd).not.toContain('not implemented');
      expect(message, cmd).not.toMatch(CJK);
    }
  });

  it('demoInvoke 对契约内命令真的走到 demoBackend：已落地的那条 resolve 出内存库里的种子数据', async () => {
    // 探针退休后的等价物：旧断言只看「reject 的消息里带命令名」，
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
  it('测试环境下 withLatency() 不等待（全量门禁不被 99 条种子 × 120ms 拖慢）', async () => {
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

  it('重置后库里就是种子里那 4 个项目（3 个 active、1 个 archived）', () => {
    resetDemoDb();
    const db = getDemoDb();

    expect(db.projects).toHaveLength(4);
    expect(db.projects.map((project) => project.name)).toEqual(
      SEED_PROJECTS.map((project) => project.name),
    );
    expect(db.projects.map((project) => project.status)).toEqual([
      'active',
      'archived',
      'active',
      'active',
    ]);
    // `profiles` 恒空：档案制（provider profiles）是 Plan B/C 的契约，demo 里没有任何一条命令
    // 写这张表，所以重置之后它必然还是空的（形状与理由见 `demo/db.ts:56-57`、`demo/types.ts:75-78`）。
    expect(db.profiles).toEqual([]);
    // 12 = 厂商预设表的条数（7 个来自 Rust 真值源 + 5 家中转站，DR-33）：
    // 钥匙串位是 `SEED_SETTINGS.providers.map(...)` 派生的，加一家就自动多一位（逐条判据在 `seed.test.ts`）。
    expect(db.secrets).toHaveLength(12);
    expect(db.secrets.every((secret) => secret.configured)).toBe(false);
  });
});

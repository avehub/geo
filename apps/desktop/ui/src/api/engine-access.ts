/**
 * 引擎接入映射：采集页的「哪个引擎要配哪把 Key / 要不要扫码」唯一真值源。
 *
 * # 为什么需要这张表
 * 2026-11-20 用户报障：豆包任务报「需要登录」（`FailureReason::LoginRequired`），
 * 但采集页没有任何补 Key 或扫码的入口。后端的真实口径是——
 * `services/collection_service.rs` 的 `engine_bundle()` 按引擎去取对应服务商的钥匙串位
 * （`secret_for_provider`），取不到就回 `LoginRequired`；元宝走浏览器自动化，没有 Key，
 * 靠本机扫码登录态。这些知识原先只存在于 Rust 里，界面无从引导。
 *
 * # 🔴 与后端的对齐点（改任何一边都要同时改另一边）
 * - `doubao` → `volcengine_ark`、`kimi` → `moonshot`、`qwen` → `ali_bailian`、
 *   `baidu_ai` → `baidu_qianfan`、`deepseek` → `deep_seek`（`engine_provider()`）；
 * - `metaso` → 搜索 Key 位 `metaso` **加** 当前对话模型的 Key（`engine_bundle()` 的 Metaso 分支）；
 *   后者属于「模型服务商」设置，这里只钉搜索 Key，界面上用一句说明补齐；
 * - `yuanbao` → 无 Key（`browser_automation`）。
 *
 * 这张表只回答「需要什么」，不判断「现在能不能跑」——那要看 `secret_status`，
 * 由 `engineAccessState()` 合并。它也不发请求，纯函数（组件与测试共用）。
 */
import type { TranslationKey } from '../i18n/resources';
import type { EngineId } from './types-collection';

/** 引擎的接入方式：API Key（钥匙串）或浏览器扫码登录。 */
export type EngineAccessKind = 'api_key' | 'browser_login';

export interface EngineAccessSpec {
  kind: EngineAccessKind;
  /** 必须配好的钥匙串位：`keyring://llm/<provider>` 的 `<provider>` 段。元宝为空。 */
  providers: readonly string[];
  /** 接入要求的一句话说明（词典键，zh/en 必须都补齐）。 */
  noteKey: TranslationKey;
}

/** 引擎 → 接入要求。键集必须与 `EngineId` 完全一致（测试钉住）。 */
export const ENGINE_ACCESS: Record<EngineId, EngineAccessSpec> = {
  doubao: {
    kind: 'api_key',
    providers: ['volcengine_ark'],
    noteKey: 'collection.access.notes.doubao',
  },
  deepseek: {
    kind: 'api_key',
    providers: ['deep_seek'],
    noteKey: 'collection.access.notes.deepseek',
  },
  kimi: {
    kind: 'api_key',
    providers: ['moonshot'],
    noteKey: 'collection.access.notes.kimi',
  },
  qwen: {
    kind: 'api_key',
    providers: ['ali_bailian'],
    noteKey: 'collection.access.notes.qwen',
  },
  baidu_ai: {
    kind: 'api_key',
    providers: ['baidu_qianfan'],
    noteKey: 'collection.access.notes.baidu_ai',
  },
  metaso: {
    kind: 'api_key',
    providers: ['metaso'],
    noteKey: 'collection.access.notes.metaso',
  },
  yuanbao: {
    kind: 'browser_login',
    providers: [],
    noteKey: 'collection.access.notes.yuanbao',
  },
};

/**
 * 判定时需要的上下文。
 *
 * `currentModelProvider` = 「模型服务商」里当前选的对话模型。秘塔引擎的搜索用 `metaso` Key，
 * **回答**仍走这个模型（`engine_bundle()` 的 Metaso 分支调 `answer_client(settings, main_provider)`），
 * 所以它的 Key 也要在。查不到设置时回 `undefined`，只按搜索 Key 判——不拿一个查不到的值
 * 去告诉用户「未配置」。
 */
export interface EngineAccessContext {
  currentModelProvider?: string | null;
}

/** 引擎的接入状态：已接入 / 确认缺 Key / 还没查到 / 需扫码（与 Key 无关）。 */
export type EngineAccessState = 'ready' | 'needs_setup' | 'unknown' | 'browser_login';

/**
 * 合并「引擎要求」与「钥匙串现状」。
 *
 * `configured` 回 `true` / `false` / `undefined`（查询未回或读取失败）。
 * 🔴 有 `false` 就是 `needs_setup`（已知要修），只有全部为 `undefined` 才算 `unknown`——
 * 把「读不到钥匙串」当成「没配」会让用户去重填一把其实已经有的 Key。
 */
export function engineAccessState(
  engine: EngineId,
  configured: (provider: string) => boolean | undefined,
  context: EngineAccessContext = {},
): EngineAccessState {
  const spec = ENGINE_ACCESS[engine];
  if (spec.kind === 'browser_login') return 'browser_login';

  let unknown = false;
  for (const provider of providersFor(engine, context)) {
    const state = configured(provider);
    if (state === false) return 'needs_setup';
    if (state === undefined) unknown = true;
  }
  return unknown ? 'unknown' : 'ready';
}

/** 单个引擎实际要查的钥匙串位（秘塔额外叠加当前对话模型）。 */
function providersFor(
  engine: EngineId,
  context: EngineAccessContext,
): readonly string[] {
  const base = ENGINE_ACCESS[engine].providers;
  const current = context.currentModelProvider ?? null;
  if (engine === 'metaso' && current !== null && current !== '') {
    return base.includes(current) ? base : [...base, current];
  }
  return base;
}

/** 这些引擎需要的全部钥匙串位（去重、保持引擎顺序；元宝不贡献）。 */
export function requiredProviders(
  engines: readonly EngineId[],
  context: EngineAccessContext = {},
): string[] {
  const seen = new Set<string>();
  for (const engine of engines) {
    for (const provider of providersFor(engine, context)) seen.add(provider);
  }
  return [...seen];
}

/**
 * 确认缺 Key 的引擎（只回 `needs_setup`）。
 *
 * 排一轮采集的预检只报这一档：`unknown` 可能只是钥匙串还没读完，
 * 拿它去警告用户等于在界面上编一个「未接入」。
 */
export function enginesNeedingSetup(
  engines: readonly EngineId[],
  configured: (provider: string) => boolean | undefined,
  context: EngineAccessContext = {},
): EngineId[] {
  return engines.filter(
    (engine) => engineAccessState(engine, configured, context) === 'needs_setup',
  );
}

/** 一条采集任务里与接入判定有关的字段（结构子集，便于纯函数测试）。 */
export interface LoginFailureTaskLike {
  engine: EngineId;
  status: string;
  failure_reason: string | null;
}

/** 因「需要登录」失败的引擎（按任务出现顺序去重）。 */
export function loginRequiredEngines(tasks: readonly LoginFailureTaskLike[]): EngineId[] {
  const engines: EngineId[] = [];
  for (const task of tasks) {
    if (task.status !== 'failed' || task.failure_reason !== 'login_required') continue;
    if (!engines.includes(task.engine)) engines.push(task.engine);
  }
  return engines;
}

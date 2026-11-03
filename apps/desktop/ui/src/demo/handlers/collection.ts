/**
 * M3 多引擎采集的 6 条命令（`collection_*`）的内存实现。
 *
 * # 🔴 demo 不采集（AGENTS 规则 9）
 * 真后端在这里跑引擎适配器、记账 token、算成功率与耗时。demo 一律**不发请求**：
 * - `collection_start` 只往内存库排一轮 `queued` 的空轮次（让「排队 → 进行中」的界面态可走查）；
 * - `collection_task_retry` 不重跑，而是把 `seed/collection-records-retest.ts` 里**预置**的那条
 *   证据与解析结果推进库（让「失败 → 重跑 → 证据出现」这条链路可走查）；
 * - 轮次的 `completed/failed/success_rate/avg_latency_ms/token` 一律沿用种子里的静态值，
 *   重跑之后**也不重算**——重算就等于在 demo 里实现记账口径，那必然与真后端漂移。
 * 以上差异登记在 `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`。
 *
 * # 错误码：只用契约里已有的（`contracts/error-codes.json` 冻结在 43 条）
 * - 项目不存在 ⇒ `project/not_found`（`kind: 'project'`）；
 * - 题库不存在 ⇒ `prompt_set/not_found`（`kind: 'prompt_set'`）；
 * - 轮次 / 任务 / 证据的 id 认不出 ⇒ `validation/failed` + `reason: 'invalid_id'`
 *   （M3–M7 这些实体在契约里**没有**自己的 `*_not_found` 码，`errors.kinds.*` 又被钉在
 *   Rust 真值源上不许扩 ⇒ 走 `field` + `invalid_id` 这条既有组合，字段名进 `fields` 词典）；
 * - 状态不允许（重跑一条没失败的任务）⇒ `state/conflict` + `reason: 'not_allowed'`。
 *
 * # 语言约束：本文件非注释部分 0 个 CJK（门禁 7 / §B-11）
 * 新建轮次的 `label` 因此**不在这里造中文**：调用方没给就回落到题库名（数据级中文，来自库里）。
 */
import type { DemoDb, DemoHandler } from '../types';
import { demoError } from '../types';
import {
  getDemoDb,
  recordsOf,
  roundById,
  roundsOf,
  taskById,
  tasksOf,
} from '../db';
import type {
  CollectionBoard,
  CollectionRecord,
  CollectionRecordDetail,
  CollectionRound,
  CollectionRoundDetail,
  CollectionStartOptions,
  CollectionStatus,
  EngineId,
  RecordFilter,
  UsageBoard,
} from '../../api/types';
import { COLLECTION_STATUS_VALUES, ENGINE_VALUES } from '../../api/types';
import { SEED_ENGINE_RUNS, SEED_USAGE_BOARD } from '../seed/collection-rounds';
import { SEED_RETRY_OUTCOMES } from '../seed/collection-records-retest';
import { SEED_RETRY_INSIGHTS } from '../seed/insights';
import { asNumber, asRecord, asString, cleanOptional, requireProject } from './shared';

/** 关键题目的重复采样次数上限（产品定义 §3.5：1/2/3）。 */
const REPEAT_LIMIT = 3;

/** `validation/failed` 的 `invalid_id` 组合：M3–M7 的实体 id 认不出时统一走它。 */
function unknownId(field: string, id: string): never {
  throw demoError('validation/failed', { field, reason: 'invalid_id', value: id });
}

/** 按 id 取一轮，认不出就抛（`field` 让词典能渲染出「采集轮次不是合法 ID」）。 */
function requireRound(db: DemoDb, roundId: string): CollectionRound {
  const round = roundById(db, roundId);
  if (!round) unknownId('round_id', roundId);
  return round;
}

/** 只收契约内的引擎 id；契约外的值直接丢掉（真后端由 serde 在边界拒绝，demo 不复制那套）。 */
function engineScopeOf(value: unknown): EngineId[] {
  if (!Array.isArray(value)) return [];
  const allowed = ENGINE_VALUES as readonly string[];
  const scope: EngineId[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && allowed.includes(entry) && !scope.includes(entry as EngineId)) {
      scope.push(entry as EngineId);
    }
  }
  return scope;
}

/** 没有采集数据的项目：一张空看板（配额未设 ⇒ 两个 `quota_*` 都是 null）。 */
function emptyUsageBoard(projectId: string): UsageBoard {
  return {
    project_id: projectId,
    rows: [],
    total_queries: 0,
    total_tokens: 0,
    quota_queries: null,
    quota_tokens: null,
    quota_exceeded: false,
  };
}

/** 证据详情 → 列表行（去掉回答全文、引用列表与截图，避免一次拉回上百段文本）。 */
function toRecordRow(record: CollectionRecordDetail): CollectionRecord {
  return {
    id: record.id,
    round_id: record.round_id,
    prompt_id: record.prompt_id,
    prompt_text: record.prompt_text,
    intent: record.intent,
    engine: record.engine,
    model: record.model,
    channel: record.channel,
    status: record.status,
    failure_reason: record.failure_reason,
    mentioned: record.mentioned,
    rank: record.rank,
    sentiment: record.sentiment,
    citation_count: record.citation_count,
    collected_at: record.collected_at,
    latency_ms: record.latency_ms,
    prompt_tokens: record.prompt_tokens,
    completion_tokens: record.completion_tokens,
    repeat_index: record.repeat_index,
  };
}

/** `RecordFilter` 的四个可选条件按 AND 组合；`null` / 缺省 = 该维不筛。 */
function matchesFilter(record: CollectionRecordDetail, filter: RecordFilter): boolean {
  if (filter.engine != null && record.engine !== filter.engine) return false;
  if (filter.intent != null && record.intent !== filter.intent) return false;
  if (filter.mentioned != null && record.mentioned !== filter.mentioned) return false;
  if (filter.status != null && record.status !== filter.status) return false;
  return true;
}

/**
 * `collection_board`：轮次列表 + 用量看板（一次往返，采集页首屏）。
 *
 * 用量看板是**静态种子**（规则 9）：`collection_start` 排的新轮次不会出现在看板里，
 * 因为 demo 不记账。看板只对种子里那个演示项目有数据，其余项目回空看板。
 */
export const collectionBoard: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);

  const usage =
    projectId === SEED_USAGE_BOARD.project_id
      ? structuredClone(SEED_USAGE_BOARD)
      : emptyUsageBoard(projectId);

  const board: CollectionBoard = { rounds: structuredClone(roundsOf(db, projectId)), usage };
  return board;
};

/**
 * `collection_round_get`：一轮的详情（轮次 + 各引擎执行汇总 + 队列任务）。
 *
 * ⚠ 任务与证据都是种子里的**样本子集**（一轮 434 次查询不可能全铺进种子）⇒ 界面必须
 * 明说「演示数据仅收录样本」（词典 `collection.sampleOnly`），**不假装**这是全量。
 */
export const collectionRoundGet: DemoHandler = (args) => {
  const db = getDemoDb();
  const roundId = asString(args.round_id);
  const round = requireRound(db, roundId);

  const detail: CollectionRoundDetail = {
    round: structuredClone(round),
    // 引擎执行汇总是静态种子；新排队的轮次还没有任何执行 ⇒ 空数组（界面显示空状态）。
    engines: structuredClone(SEED_ENGINE_RUNS[roundId] ?? []),
    tasks: structuredClone(tasksOf(db, roundId)),
  };
  return detail;
};

/**
 * `collection_start`：排一轮新采集。
 *
 * 🔴 demo 只**排队**、不执行：新轮次是 `queued`，`completed/failed` 都是 0，
 * `success_rate` 0，任务队列为空（真后端此刻会 enqueue 出 `题目数 × 引擎数 × 重复次数` 条任务）。
 * 界面因此能走查「已排队、等待执行」这一态，但**不会**看到它自己跑完——那是真后端的活。
 *
 * `planned_queries` 是**队列构造的算术**（题目数 × 引擎数），不是领域指标：真后端 enqueue 时
 * 同样这么算，所以这里算它不构成「在 demo 里实现算法」（规则 9 的红线是去重率 / 完整率 /
 * 样本量分级那类**领域**计算）。
 *
 * 🔴 **刻意不乘 `repeat_count`**：重复采样只作用于「关键题目」（产品定义 §3.5），而"哪些题算
 * 关键"是后端按意图与权重判定的——demo 不判（规则 9）。乘上去就会与种子里第 3 轮自相矛盾
 * （那一轮 `repeat_count: 2`、`planned_queries: 434` = 62 题 × 7 引擎），而"两个数字对不上"
 * 正是本产品最不能出现的失败形态。判据在 `demo/seed.test.ts`，差异登记在
 * `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md`。
 *
 * `sample_size_grade` 反之**不算**：一律回落最保守的 `insufficient`
 * （还没采到任何样本，分级无意义）。
 */
export const collectionStart: DemoHandler = (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  const project = requireProject(db, projectId);

  const options = asRecord(args.options) as Partial<CollectionStartOptions>;
  const setId = asString(options.prompt_set_id);
  const set = db.promptSets.find((entry) => entry.id === setId && entry.project_id === projectId);
  if (!set) {
    throw demoError('prompt_set/not_found', { kind: 'prompt_set', id: setId });
  }

  const engineScope = engineScopeOf(options.engine_scope);
  if (engineScope.length === 0) {
    throw demoError('validation/failed', { field: 'engine_scope', reason: 'empty' });
  }

  const repeatCount = asNumber(options.repeat_count);
  if (!Number.isInteger(repeatCount) || repeatCount < 1 || repeatCount > REPEAT_LIMIT) {
    throw demoError('validation/failed', {
      field: 'repeat_count',
      reason: 'out_of_range',
      expected: `1~${REPEAT_LIMIT}`,
      value: String(repeatCount),
    });
  }

  const existing = roundsOf(db, projectId);
  const roundIndex = existing.reduce((max, round) => Math.max(max, round.round_index), 0) + 1;
  const round: CollectionRound = {
    id: `demo-round-queued-${roundIndex}`,
    project_id: project.id,
    prompt_set_id: set.id,
    prompt_set_label: set.label,
    prompt_set_version: set.version,
    // 调用方没给名字就回落题库名（数据级中文）：handler 里不许造中文字面量（门禁 7）。
    label: cleanOptional(options.label) ?? set.label,
    round_index: roundIndex,
    status: 'queued',
    engine_scope: engineScope,
    repeat_count: repeatCount,
    planned_queries: set.items.length * engineScope.length,
    completed_queries: 0,
    failed_queries: 0,
    success_rate: 0,
    started_at: null,
    finished_at: null,
    metric_spec_version: set.metric_spec_version,
    sample_size_grade: 'insufficient',
    notes: null,
  };

  db.collectionRounds.push(round);
  return structuredClone(round);
};

/**
 * `collection_task_retry`：重跑一条**失败的**任务。
 *
 * demo 的"重跑"= 把种子里预置的那条证据与解析结果推进库，并把任务翻成 `succeeded`。
 * 预置产物一共 6 条（`SEED_RETRY_OUTCOMES` 的键就是可重跑的任务 id）；种子里其余失败任务
 * 没有预置产物 ⇒ 回 `state/conflict`，界面提示「演示数据未收录这条任务的重跑结果」。
 *
 * ⚠ 时间戳取预置证据的 `collected_at`（**不读时钟**）：证据与任务必须对得上，
 * 而种子的确定性（§B-4）也要求这条链路可复现。`attempt` 照真后端 +1。
 */
export const collectionTaskRetry: DemoHandler = (args) => {
  const db = getDemoDb();
  const taskId = asString(args.task_id);
  const task = taskById(db, taskId);
  if (!task) unknownId('task_id', taskId);

  if (task.status !== 'failed') {
    throw demoError('state/conflict', { reason: 'not_allowed', value: task.status });
  }

  const record = SEED_RETRY_OUTCOMES[taskId];
  if (!record) {
    throw demoError('state/conflict', { reason: 'not_allowed', value: 'no_demo_outcome' });
  }

  // 同一条任务重复点重跑时不许把证据推进库两次（否则证据列表会出现两条同 id 的记录）。
  if (!db.collectionRecords.some((entry) => entry.id === record.id)) {
    db.collectionRecords.push(structuredClone(record));
  }
  const insight = SEED_RETRY_INSIGHTS[taskId];
  if (insight && !db.insights.some((entry) => entry.id === insight.id)) {
    db.insights.push(structuredClone(insight));
  }

  task.status = record.status;
  task.attempt += 1;
  task.failure_reason = null;
  task.record_id = record.id;
  task.finished_at = record.collected_at;
  task.latency_ms = record.latency_ms;

  return structuredClone(task);
};

/** `collection_record_list`：一轮的证据列表行（带筛选）。 */
export const collectionRecordList: DemoHandler = (args) => {
  const db = getDemoDb();
  const roundId = asString(args.round_id);
  requireRound(db, roundId);

  const filter = asRecord(args.filter) as RecordFilter;
  const statuses = COLLECTION_STATUS_VALUES as readonly string[];
  if (filter.status != null && !statuses.includes(filter.status as CollectionStatus)) {
    throw demoError('validation/failed', {
      field: 'status',
      reason: 'invalid_format',
      value: String(filter.status),
    });
  }

  return recordsOf(db, roundId)
    .filter((record) => matchesFilter(record, filter))
    .map(toRecordRow);
};

/** `collection_record_get`：单条证据的完整快照（回答全文 + 引用 + 截图占位）。 */
export const collectionRecordGet: DemoHandler = (args) => {
  const db = getDemoDb();
  const id = asString(args.id);
  const record = db.collectionRecords.find((entry) => entry.id === id);
  if (!record) unknownId('record_id', id);
  return structuredClone(record);
};

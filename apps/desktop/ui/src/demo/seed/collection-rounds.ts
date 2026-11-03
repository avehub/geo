/**
 * 种子：M3 采集轮次 / 引擎执行汇总 / 队列任务 / 用量看板。
 *
 * # 四轮的设计意图（每一轮都要能在界面上走查出一个**不同**的状态）
 * | 轮次 | 状态 | 走查什么 |
 * |---|---|---|
 * | 第 1 轮 通道验证 | `partial` + 样本不足 | 「样本不足，仅供方向性参考」的降级口径、失败原因分布 |
 * | 第 2 轮 基线体检 | `succeeded` | 完整证据链、诊断与处方的基准 |
 * | 第 3 轮 行动后复测 | `succeeded` | 环比与**闭环归因**（M6 的续费理由） |
 * | 第 4 轮 周更采集 | `running` | 任务中心的排队/进行中/失败重跑、用量看板的配额消耗 |
 *
 * # 🔴 静态口径（AGENTS 规则 9）
 * `planned/completed/failed_queries`、`success_rate`、`avg_latency_ms`、token 用量都是**写死的**：
 * 真后端是采集过程的记账结果，demo 不跑采集也不重算。数字之间**手工自洽**
 * （各引擎 succeeded 之和 == 轮次 completed_queries，判据在 `demo/seed.test.ts`），
 * 这样产品负责人在界面上横看竖看都不会撞见矛盾。
 *
 * # 队列任务与证据记录都是**样本子集**
 * 一轮 434 次查询不可能全铺进种子。`collection_record_list` / `collection_round_get` 因此带
 * `sample_only` 标记，界面上明说"演示数据仅收录 N 条样本"——**不假装**这是全量。
 *
 * 合规（AGENTS 规则 6）：种子文案里不出现绝对化用语。域名一律 `example.com` 家族（RFC 2606）。
 */
import type {
  CollectionRound,
  CollectionTask,
  EngineChannel,
  EngineId,
  EngineRun,
  UsageBoard,
} from '../../api/types';
import { SEED_BASELINE_SET_ID, SEED_PILOT_SET_ID } from './prompt-sets';
import { SEED_ACTIVE_PROJECT_ID } from './projects';

/** 四个轮次的 id（ASCII 稳定字面量，§B-4）。 */
export const SEED_TRIAL_ROUND_ID = 'demo-round-trial';
export const SEED_BASELINE_ROUND_ID = 'demo-round-baseline';
export const SEED_RETEST_ROUND_ID = 'demo-round-retest';
export const SEED_LIVE_ROUND_ID = 'demo-round-live';

/** MVP 引擎矩阵的 7 家 P0 引擎（产品定义 §3.5）。 */
export const SEED_ALL_ENGINES: EngineId[] = [
  'doubao',
  'deepseek',
  'kimi',
  'qwen',
  'yuanbao',
  'baidu_ai',
  'metaso',
];

/**
 * 每家引擎本轮用的通道与模型版本。
 *
 * 元宝没有公开对话 API ⇒ 只能是 `browser_automation`（产品定义 §3.5 的表里就是这么写的），
 * 它的 `avg_latency_ms` 也因此比 API 通道高一个量级——这个差异要在界面上看得出来。
 */
export const SEED_ENGINE_PROFILES: Record<EngineId, { channel: EngineChannel; model: string }> = {
  doubao: { channel: 'official_api', model: 'doubao-seed-1.8' },
  deepseek: { channel: 'official_api', model: 'deepseek-chat' },
  kimi: { channel: 'official_api', model: 'kimi-k2-thinking' },
  qwen: { channel: 'official_api', model: 'qwen3-max-search' },
  yuanbao: { channel: 'browser_automation', model: 'yuanbao-web-2026-09' },
  baidu_ai: { channel: 'official_api', model: 'ernie-4.5-turbo-search' },
  metaso: { channel: 'official_api', model: 'metaso-search-pro' },
};

export const SEED_COLLECTION_ROUNDS: CollectionRound[] = [
  {
    id: SEED_TRIAL_ROUND_ID,
    project_id: SEED_ACTIVE_PROJECT_ID,
    prompt_set_id: SEED_PILOT_SET_ID,
    prompt_set_label: '澜舟除尘 · 滤筒细分小样本',
    prompt_set_version: 1,
    label: '第 1 轮 · 通道验证（小样本）',
    round_index: 1,
    status: 'partial',
    engine_scope: ['doubao', 'deepseek', 'metaso'],
    repeat_count: 1,
    planned_queries: 15,
    completed_queries: 11,
    failed_queries: 4,
    success_rate: 0.73,
    started_at: '2026-09-08T02:10:00Z',
    finished_at: '2026-09-08T02:38:00Z',
    metric_spec_version: 'geo-metrics-v1',
    sample_size_grade: 'insufficient',
    notes:
      '通道验证轮：只跑 3 家引擎 × 5 道题，确认官方 API 与浏览器自动化两条通道都能拿到回答。' +
      '样本不足，结论仅供方向性参考。',
  },
  {
    id: SEED_BASELINE_ROUND_ID,
    project_id: SEED_ACTIVE_PROJECT_ID,
    prompt_set_id: SEED_BASELINE_SET_ID,
    prompt_set_label: '澜舟除尘 · 基线题库',
    prompt_set_version: 1,
    label: '第 2 轮 · 基线体检',
    round_index: 2,
    status: 'succeeded',
    engine_scope: [...SEED_ALL_ENGINES],
    repeat_count: 1,
    planned_queries: 434,
    completed_queries: 421,
    failed_queries: 13,
    success_rate: 0.97,
    started_at: '2026-09-16T01:00:00Z',
    finished_at: '2026-09-16T02:18:00Z',
    metric_spec_version: 'geo-metrics-v1',
    sample_size_grade: 'sufficient',
    notes: null,
  },
  {
    id: SEED_RETEST_ROUND_ID,
    project_id: SEED_ACTIVE_PROJECT_ID,
    prompt_set_id: SEED_BASELINE_SET_ID,
    prompt_set_label: '澜舟除尘 · 基线题库',
    prompt_set_version: 1,
    label: '第 3 轮 · 行动后复测',
    round_index: 3,
    status: 'succeeded',
    engine_scope: [...SEED_ALL_ENGINES],
    repeat_count: 2,
    planned_queries: 434,
    completed_queries: 428,
    failed_queries: 6,
    success_rate: 0.99,
    started_at: '2026-09-23T01:00:00Z',
    finished_at: '2026-09-23T02:12:00Z',
    metric_spec_version: 'geo-metrics-v1',
    sample_size_grade: 'sufficient',
    notes: '复测沿用第 2 轮的题库版本（v1）与引擎清单，关键题目重复采样 2 次，得分可直接环比。',
  },
  {
    id: SEED_LIVE_ROUND_ID,
    project_id: SEED_ACTIVE_PROJECT_ID,
    prompt_set_id: SEED_BASELINE_SET_ID,
    prompt_set_label: '澜舟除尘 · 基线题库',
    prompt_set_version: 1,
    label: '第 4 轮 · 周更采集（进行中）',
    round_index: 4,
    status: 'running',
    engine_scope: [...SEED_ALL_ENGINES],
    repeat_count: 1,
    planned_queries: 434,
    completed_queries: 187,
    failed_queries: 5,
    success_rate: 0.97,
    started_at: '2026-09-28T01:00:00Z',
    finished_at: null,
    metric_spec_version: 'geo-metrics-v1',
    sample_size_grade: 'sufficient',
    notes: null,
  },
];

/** 各引擎的执行汇总（按轮次分组）。进行中那轮只统计已完成的部分。 */
export const SEED_ENGINE_RUNS: Record<string, EngineRun[]> = {
  [SEED_TRIAL_ROUND_ID]: [
    { engine: 'doubao', channel: 'official_api', model: 'doubao-seed-1.8', planned: 5, succeeded: 4, failed: 1, avg_latency_ms: 2450, prompt_tokens: 168, completion_tokens: 2210 },
    { engine: 'deepseek', channel: 'official_api', model: 'deepseek-chat', planned: 5, succeeded: 4, failed: 1, avg_latency_ms: 3120, prompt_tokens: 151, completion_tokens: 2480 },
    { engine: 'metaso', channel: 'official_api', model: 'metaso-search-pro', planned: 5, succeeded: 3, failed: 2, avg_latency_ms: 1180, prompt_tokens: 96, completion_tokens: 1340 },
  ],
  [SEED_BASELINE_ROUND_ID]: [
    { engine: 'doubao', channel: 'official_api', model: 'doubao-seed-1.8', planned: 62, succeeded: 61, failed: 1, avg_latency_ms: 2380, prompt_tokens: 1922, completion_tokens: 38140 },
    { engine: 'deepseek', channel: 'official_api', model: 'deepseek-chat', planned: 62, succeeded: 62, failed: 0, avg_latency_ms: 3050, prompt_tokens: 1860, completion_tokens: 41230 },
    { engine: 'kimi', channel: 'official_api', model: 'kimi-k2-thinking', planned: 62, succeeded: 61, failed: 1, avg_latency_ms: 2810, prompt_tokens: 1946, completion_tokens: 36980 },
    { engine: 'qwen', channel: 'official_api', model: 'qwen3-max-search', planned: 62, succeeded: 62, failed: 0, avg_latency_ms: 2640, prompt_tokens: 1899, completion_tokens: 35410 },
    { engine: 'yuanbao', channel: 'browser_automation', model: 'yuanbao-web-2026-09', planned: 62, succeeded: 58, failed: 4, avg_latency_ms: 9240, prompt_tokens: 0, completion_tokens: 0 },
    { engine: 'baidu_ai', channel: 'official_api', model: 'ernie-4.5-turbo-search', planned: 62, succeeded: 61, failed: 1, avg_latency_ms: 3320, prompt_tokens: 1873, completion_tokens: 33260 },
    { engine: 'metaso', channel: 'official_api', model: 'metaso-search-pro', planned: 62, succeeded: 56, failed: 6, avg_latency_ms: 1210, prompt_tokens: 1798, completion_tokens: 21870 },
  ],
  [SEED_RETEST_ROUND_ID]: [
    { engine: 'doubao', channel: 'official_api', model: 'doubao-seed-1.8', planned: 62, succeeded: 62, failed: 0, avg_latency_ms: 2290, prompt_tokens: 1940, completion_tokens: 39210 },
    { engine: 'deepseek', channel: 'official_api', model: 'deepseek-chat', planned: 62, succeeded: 62, failed: 0, avg_latency_ms: 2980, prompt_tokens: 1872, completion_tokens: 42080 },
    { engine: 'kimi', channel: 'official_api', model: 'kimi-k2-thinking', planned: 62, succeeded: 61, failed: 1, avg_latency_ms: 2760, prompt_tokens: 1951, completion_tokens: 37420 },
    { engine: 'qwen', channel: 'official_api', model: 'qwen3-max-search', planned: 62, succeeded: 62, failed: 0, avg_latency_ms: 2580, prompt_tokens: 1902, completion_tokens: 36110 },
    { engine: 'yuanbao', channel: 'browser_automation', model: 'yuanbao-web-2026-09', planned: 62, succeeded: 59, failed: 3, avg_latency_ms: 8870, prompt_tokens: 0, completion_tokens: 0 },
    { engine: 'baidu_ai', channel: 'official_api', model: 'ernie-4.5-turbo-search', planned: 62, succeeded: 62, failed: 0, avg_latency_ms: 3180, prompt_tokens: 1884, completion_tokens: 34020 },
    { engine: 'metaso', channel: 'official_api', model: 'metaso-search-pro', planned: 62, succeeded: 60, failed: 2, avg_latency_ms: 1190, prompt_tokens: 1806, completion_tokens: 22440 },
  ],
  [SEED_LIVE_ROUND_ID]: [
    { engine: 'doubao', channel: 'official_api', model: 'doubao-seed-1.8', planned: 62, succeeded: 31, failed: 1, avg_latency_ms: 2360, prompt_tokens: 948, completion_tokens: 18730 },
    { engine: 'deepseek', channel: 'official_api', model: 'deepseek-chat', planned: 62, succeeded: 30, failed: 1, avg_latency_ms: 3010, prompt_tokens: 912, completion_tokens: 19880 },
    { engine: 'kimi', channel: 'official_api', model: 'kimi-k2-thinking', planned: 62, succeeded: 30, failed: 1, avg_latency_ms: 2790, prompt_tokens: 936, completion_tokens: 18240 },
    { engine: 'qwen', channel: 'official_api', model: 'qwen3-max-search', planned: 62, succeeded: 32, failed: 0, avg_latency_ms: 2610, prompt_tokens: 958, completion_tokens: 18010 },
    { engine: 'yuanbao', channel: 'browser_automation', model: 'yuanbao-web-2026-09', planned: 62, succeeded: 22, failed: 2, avg_latency_ms: 9410, prompt_tokens: 0, completion_tokens: 0 },
    { engine: 'baidu_ai', channel: 'official_api', model: 'ernie-4.5-turbo-search', planned: 62, succeeded: 24, failed: 0, avg_latency_ms: 3260, prompt_tokens: 921, completion_tokens: 16880 },
    { engine: 'metaso', channel: 'official_api', model: 'metaso-search-pro', planned: 62, succeeded: 18, failed: 0, avg_latency_ms: 1200, prompt_tokens: 903, completion_tokens: 11240 },
  ],
};

/**
 * 队列任务的**样本子集**（19 条）。
 *
 * 覆盖全部 5 种状态与 5 种失败原因，否则界面走查不出「失败条目显示原因并可单独重跑」这条验收。
 * `prompt_text` 逐字取自题库种子（一致性由 `demo/seed.test.ts` 钉住）。
 */
export const SEED_COLLECTION_TASKS: CollectionTask[] = [
  // ---- 第 1 轮（通道验证）：暴露两条通道的典型失败 ----
  { id: 'demo-task-trial-001', round_id: SEED_TRIAL_ROUND_ID, prompt_id: 'demo-pi-pilot-001', prompt_text: '滤筒除尘器的滤芯一般多久换一次？', intent: 'professional_long_tail', engine: 'doubao', channel: 'official_api', status: 'succeeded', attempt: 1, failure_reason: null, record_id: null, queued_at: '2026-09-08T02:10:00Z', finished_at: '2026-09-08T02:11:00Z', latency_ms: 2410 },
  { id: 'demo-task-trial-002', round_id: SEED_TRIAL_ROUND_ID, prompt_id: 'demo-pi-pilot-004', prompt_text: '滤筒除尘和布袋除尘在细粉尘工况下哪个更合适？', intent: 'category_awareness', engine: 'metaso', channel: 'official_api', status: 'failed', attempt: 2, failure_reason: 'rate_limited', record_id: null, queued_at: '2026-09-08T02:12:00Z', finished_at: '2026-09-08T02:19:00Z', latency_ms: null },
  // ---- 第 2 轮（基线体检）：成功与失败并存，失败可单独重跑 ----
  { id: 'demo-task-baseline-001', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-001', prompt_text: '什么是脉冲布袋除尘器，它和普通布袋除尘器有什么区别？', intent: 'category_awareness', engine: 'doubao', channel: 'official_api', status: 'succeeded', attempt: 1, failure_reason: null, record_id: 'demo-rec-baseline-001', queued_at: '2026-09-16T01:00:00Z', finished_at: '2026-09-16T01:01:00Z', latency_ms: 2380 },
  { id: 'demo-task-baseline-002', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-019', prompt_text: '澜舟和清源环保的布袋除尘器在滤料上有什么不同？', intent: 'brand_comparison', engine: 'deepseek', channel: 'official_api', status: 'succeeded', attempt: 1, failure_reason: null, record_id: 'demo-rec-baseline-002', queued_at: '2026-09-16T01:02:00Z', finished_at: '2026-09-16T01:03:00Z', latency_ms: 3040 },
  { id: 'demo-task-baseline-003', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-021', prompt_text: '澜舟、清源环保、恒宇环境这三家的除尘设备各自强在哪？', intent: 'brand_comparison', engine: 'yuanbao', channel: 'browser_automation', status: 'failed', attempt: 3, failure_reason: 'login_required', record_id: null, queued_at: '2026-09-16T01:05:00Z', finished_at: '2026-09-16T01:22:00Z', latency_ms: null },
  { id: 'demo-task-baseline-004', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-028', prompt_text: '一台处理风量 2 万立方米每小时的布袋除尘器大概什么价位？', intent: 'pricing_plan', engine: 'metaso', channel: 'official_api', status: 'failed', attempt: 2, failure_reason: 'timeout', record_id: null, queued_at: '2026-09-16T01:08:00Z', finished_at: '2026-09-16T01:16:00Z', latency_ms: null },
  { id: 'demo-task-baseline-005', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-037', prompt_text: '苏州本地有哪些工业除尘设备厂家可以上门勘测？', intent: 'local_service', engine: 'qwen', channel: 'official_api', status: 'succeeded', attempt: 1, failure_reason: null, record_id: 'demo-rec-baseline-005', queued_at: '2026-09-16T01:11:00Z', finished_at: '2026-09-16T01:12:00Z', latency_ms: 2620 },
  { id: 'demo-task-baseline-006', round_id: SEED_BASELINE_ROUND_ID, prompt_id: 'demo-pi-baseline-048', prompt_text: '澜舟的售后服务口碑怎么样，有客户反馈可以参考吗？', intent: 'after_sales_reputation', engine: 'baidu_ai', channel: 'official_api', status: 'succeeded', attempt: 1, failure_reason: null, record_id: 'demo-rec-baseline-006', queued_at: '2026-09-16T01:14:00Z', finished_at: '2026-09-16T01:15:00Z', latency_ms: 3310 },
  // ---- 第 3 轮（复测）：同一批题目，用来对照 ----
  { id: 'demo-task-retest-001', round_id: SEED_RETEST_ROUND_ID, prompt_id: 'demo-pi-baseline-001', prompt_text: '什么是脉冲布袋除尘器，它和普通布袋除尘器有什么区别？', intent: 'category_awareness', engine: 'doubao', channel: 'official_api', status: 'succeeded', attempt: 1, failure_reason: null, record_id: 'demo-rec-retest-001', queued_at: '2026-09-23T01:00:00Z', finished_at: '2026-09-23T01:01:00Z', latency_ms: 2270 },
  { id: 'demo-task-retest-002', round_id: SEED_RETEST_ROUND_ID, prompt_id: 'demo-pi-baseline-019', prompt_text: '澜舟和清源环保的布袋除尘器在滤料上有什么不同？', intent: 'brand_comparison', engine: 'deepseek', channel: 'official_api', status: 'succeeded', attempt: 1, failure_reason: null, record_id: 'demo-rec-retest-002', queued_at: '2026-09-23T01:03:00Z', finished_at: '2026-09-23T01:04:00Z', latency_ms: 2960 },
  { id: 'demo-task-retest-003', round_id: SEED_RETEST_ROUND_ID, prompt_id: 'demo-pi-baseline-021', prompt_text: '澜舟、清源环保、恒宇环境这三家的除尘设备各自强在哪？', intent: 'brand_comparison', engine: 'yuanbao', channel: 'browser_automation', status: 'failed', attempt: 2, failure_reason: 'blocked', record_id: null, queued_at: '2026-09-23T01:06:00Z', finished_at: '2026-09-23T01:18:00Z', latency_ms: null },
  // ---- 第 4 轮（进行中）：排队 / 进行中 / 失败重跑都看得见 ----
  { id: 'demo-task-live-001', round_id: SEED_LIVE_ROUND_ID, prompt_id: 'demo-pi-baseline-002', prompt_text: '工业除尘设备主要分成哪几类，各自适用什么工况？', intent: 'category_awareness', engine: 'doubao', channel: 'official_api', status: 'succeeded', attempt: 1, failure_reason: null, record_id: 'demo-rec-live-001', queued_at: '2026-09-28T01:00:00Z', finished_at: '2026-09-28T01:01:00Z', latency_ms: 2340 },
  { id: 'demo-task-live-002', round_id: SEED_LIVE_ROUND_ID, prompt_id: 'demo-pi-baseline-010', prompt_text: '处理风量 5 万立方米每小时的工况，该选多大规格的布袋除尘器？', intent: 'purchase_recommendation', engine: 'kimi', channel: 'official_api', status: 'running', attempt: 1, failure_reason: null, record_id: null, queued_at: '2026-09-28T01:20:00Z', finished_at: null, latency_ms: null },
  { id: 'demo-task-live-003', round_id: SEED_LIVE_ROUND_ID, prompt_id: 'demo-pi-baseline-011', prompt_text: '采购工业除尘设备时，厂家资质要看哪几项？', intent: 'purchase_recommendation', engine: 'qwen', channel: 'official_api', status: 'running', attempt: 1, failure_reason: null, record_id: null, queued_at: '2026-09-28T01:20:00Z', finished_at: null, latency_ms: null },
  { id: 'demo-task-live-004', round_id: SEED_LIVE_ROUND_ID, prompt_id: 'demo-pi-baseline-023', prompt_text: '做水泥厂除尘改造，选澜舟还是清源环保更合适？', intent: 'brand_comparison', engine: 'yuanbao', channel: 'browser_automation', status: 'failed', attempt: 1, failure_reason: 'blocked', record_id: null, queued_at: '2026-09-28T01:22:00Z', finished_at: '2026-09-28T01:26:00Z', latency_ms: null },
  { id: 'demo-task-live-005', round_id: SEED_LIVE_ROUND_ID, prompt_id: 'demo-pi-baseline-030', prompt_text: '除尘设备的价格受哪些因素影响比较大？', intent: 'pricing_plan', engine: 'metaso', channel: 'official_api', status: 'failed', attempt: 1, failure_reason: 'transport', record_id: null, queued_at: '2026-09-28T01:24:00Z', finished_at: '2026-09-28T01:25:00Z', latency_ms: null },
  { id: 'demo-task-live-006', round_id: SEED_LIVE_ROUND_ID, prompt_id: 'demo-pi-baseline-055', prompt_text: '处理风量 12 万立方米每小时的窑线除尘改造，过滤风速取多少合适？', intent: 'professional_long_tail', engine: 'deepseek', channel: 'official_api', status: 'queued', attempt: 0, failure_reason: null, record_id: null, queued_at: '2026-09-28T01:30:00Z', finished_at: null, latency_ms: null },
  { id: 'demo-task-live-007', round_id: SEED_LIVE_ROUND_ID, prompt_id: 'demo-pi-baseline-056', prompt_text: '高温烟气工况下，PTFE 覆膜滤袋和玻纤滤袋怎么选？', intent: 'professional_long_tail', engine: 'baidu_ai', channel: 'official_api', status: 'queued', attempt: 0, failure_reason: null, record_id: null, queued_at: '2026-09-28T01:30:00Z', finished_at: null, latency_ms: null },
  { id: 'demo-task-live-008', round_id: SEED_LIVE_ROUND_ID, prompt_id: 'demo-pi-baseline-046', prompt_text: '布袋除尘器常见故障有哪些，厂家一般怎么处理？', intent: 'after_sales_reputation', engine: 'doubao', channel: 'official_api', status: 'skipped', attempt: 0, failure_reason: 'empty_answer', record_id: null, queued_at: '2026-09-28T01:32:00Z', finished_at: '2026-09-28T01:33:00Z', latency_ms: 1980 },
];

/**
 * 用量看板（M3 / M8：查询次数 + token + 硬配额）。
 *
 * 🔴 金额估算刻意不在契约里（spec DR-8：成本看板降级为用量看板，不作 P0 验收）。
 * 配额取"专业版"那一档的口径（产品定义 §5.2：100 prompts / 7 引擎 / 周更），
 * `quota_exceeded` 是静态值：本月已发出 1075 次查询，未超 1200 次的硬配额（进度条因此接近满格，
 * 正好走查"超额自动暂停"的提示长什么样）。
 */
export const SEED_USAGE_BOARD: UsageBoard = {
  project_id: SEED_ACTIVE_PROJECT_ID,
  rows: [
    // 每一行的 token 数 == 该轮 `SEED_ENGINE_RUNS` 各引擎之和；`queries` == 实际发出的查询次数
    // （成功 + 失败；失败也消耗了配额）。判据在 `demo/seed.test.ts`，写错就红。
    { round_id: SEED_TRIAL_ROUND_ID, round_label: '第 1 轮 · 通道验证（小样本）', queries: 15, prompt_tokens: 415, completion_tokens: 6030, total_tokens: 6445 },
    { round_id: SEED_BASELINE_ROUND_ID, round_label: '第 2 轮 · 基线体检', queries: 434, prompt_tokens: 11298, completion_tokens: 206890, total_tokens: 218188 },
    { round_id: SEED_RETEST_ROUND_ID, round_label: '第 3 轮 · 行动后复测', queries: 434, prompt_tokens: 11355, completion_tokens: 211280, total_tokens: 222635 },
    { round_id: SEED_LIVE_ROUND_ID, round_label: '第 4 轮 · 周更采集（进行中）', queries: 192, prompt_tokens: 5578, completion_tokens: 102980, total_tokens: 108558 },
  ],
  total_queries: 1075,
  total_tokens: 555826,
  quota_queries: 1200,
  quota_tokens: 900000,
  quota_exceeded: false,
};

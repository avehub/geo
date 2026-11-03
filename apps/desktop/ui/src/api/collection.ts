/**
 * M3 多引擎采集的 IPC wrapper（6 条命令）。
 *
 * 与 `client.ts` 同族：组件只调这里的具名函数，**不许**直接 `call` / `invoke`。
 * 拆出单独一个模块是因为 `client.ts` 已经接近「单文件约 400 行就拆分」的上限
 * （AGENTS 代码风格），而 M3–M7 一次要加 20 条。分派与错误归一化仍走 `client.ts` 的
 * `call`（唯一分派点，`runtime === 'tauri' ? invoke : demoInvoke`）。
 */
import { call } from './client';
import type {
  CollectionBoard,
  CollectionRecord,
  CollectionRecordDetail,
  CollectionRound,
  CollectionRoundDetail,
  CollectionStartOptions,
  CollectionTask,
  RecordFilter,
} from './types';

/** 采集页首屏：轮次列表 + 用量看板（一次往返）。 */
export const collectionBoard = (projectId: string) =>
  call<CollectionBoard>('collection_board', { project_id: projectId });

/** 一轮的详情：轮次 + 各引擎执行汇总 + 队列任务（任务与证据都是样本子集）。 */
export const collectionRoundGet = (roundId: string) =>
  call<CollectionRoundDetail>('collection_round_get', { round_id: roundId });

/** 排一轮新采集（demo 只排队、不执行）。 */
export const collectionStart = (projectId: string, options: CollectionStartOptions) =>
  call<CollectionRound>('collection_start', { project_id: projectId, options });

/** 重跑一条失败任务（demo 里推入一条预置证据）。 */
export const collectionTaskRetry = (taskId: string) =>
  call<CollectionTask>('collection_task_retry', { task_id: taskId });

/** 一轮的证据列表行（不含回答全文）。 */
export const collectionRecordList = (roundId: string, filter: RecordFilter = {}) =>
  call<CollectionRecord[]>('collection_record_list', { round_id: roundId, filter });

/** 单条证据的完整快照（回答全文 + 引用 + 截图占位）。 */
export const collectionRecordGet = (id: string) =>
  call<CollectionRecordDetail>('collection_record_get', { id });

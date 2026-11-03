/**
 * M4 回答解析与事实核查的 IPC wrapper（4 条命令）。
 * 拆分理由与依赖方向见 `api/collection.ts` 的头注释。
 */
import { call } from './client';
import type {
  AnswerInsight,
  FactCheckBoard,
  FactCheckIssue,
  FactIssueStatus,
  InsightCorrection,
  InsightFilter,
} from './types';

/** 一轮的解析结果（可只看复核队列 / 只看未提及 / 只看某个风险标记）。 */
export const insightList = (roundId: string, filter: InsightFilter = {}) =>
  call<AnswerInsight[]>('insight_list', { round_id: roundId, filter });

/** 人工纠正一条解析结果（只许改提及与否 / 推荐位次 / 情感倾向）。 */
export const insightCorrect = (id: string, correction: InsightCorrection) =>
  call<AnswerInsight>('insight_correct', { id, correction });

/** 一轮的核查问题 + 分组汇总（`summary` 为 null = 该轮没有可发布的汇总）。 */
export const factCheckList = (roundId: string) =>
  call<FactCheckBoard>('fact_check_list', { round_id: roundId });

/** 结办一条核查问题（已更正 / 误报 / 重新打开）。 */
export const factCheckResolve = (id: string, status: FactIssueStatus, note: string | null = null) =>
  call<FactCheckIssue>('fact_check_resolve', { id, status, note });

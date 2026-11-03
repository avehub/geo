/**
 * M5 诊断与归因的 IPC wrapper（5 条命令）。
 *
 * ⚠ 前四条的返回**可以为 `null`**：轮次存在但这一轮还没有该视图的数据
 * （进行中那轮刻意不出体检结论）。`null` 不是错误，界面显示空状态；
 * 只有 `round_id` 根本认不出才 reject `validation/failed`。
 * 拆分理由与依赖方向见 `api/collection.ts` 的头注释。
 */
import { call } from './client';
import type {
  AlertItem,
  CompetitorMatrix,
  DiagnosisOverview,
  EngineScore,
  IntentFunnel,
} from './types';

/** 体检首屏：总分 + 五维 + 头号 KPI + 趋势 + 告警。 */
export const diagnosisOverview = (roundId: string) =>
  call<DiagnosisOverview | null>('diagnosis_overview', { round_id: roundId });

/** 竞品对标矩阵。 */
export const diagnosisCompetitors = (roundId: string) =>
  call<CompetitorMatrix | null>('diagnosis_competitors', { round_id: roundId });

/** 意图漏斗（认知 → 推荐 → 决策）+ 病症结论。 */
export const diagnosisFunnel = (roundId: string) =>
  call<IntentFunnel | null>('diagnosis_funnel', { round_id: roundId });

/** 引擎差异视图（哪个引擎最认可你、哪个最容易说错你）。 */
export const diagnosisEngines = (roundId: string) =>
  call<EngineScore[]>('diagnosis_engines', { round_id: roundId });

/** 标记告警已读 / 取消已读（`acknowledged` 缺省为 true）。 */
export const diagnosisAlertAcknowledge = (alertId: string, acknowledged = true) =>
  call<AlertItem>('diagnosis_alert_acknowledge', { alert_id: alertId, acknowledged });

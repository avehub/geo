/**
 * M5 诊断与归因的 5 条命令（`diagnosis_*`）的内存实现。
 *
 * # 🔴 全部是静态值（AGENTS 规则 9）
 * 体检总分、五维得分、竞品对标矩阵、意图漏斗、引擎差异、趋势点在真后端都是从证据算出来的
 * （附录 C 的加权口径）。demo 一律取 `seed/diagnosis.ts` 里预置的数：种子之间的自洽
 * （权重加权 == 总分、归因卡片的四个数 == 两轮 overview）由 `demo/seed.test.ts` 钉住，
 * 这里**一个算术都不做**。
 *
 * # 唯一的写路径：告警已读
 * `diagnosis_alert_acknowledge` 翻 `db.alerts` 上的 `acknowledged`。
 *
 * 🔴 **告警的真值是 `db.alerts`，不是 `DiagnosisOverview.alerts`**：DTO 要求 overview 内嵌一份
 * 告警副本（种子里那 4 条），如果 handler 直接回内嵌副本，「标记已读」就得同时写两处——
 * 正是本仓反复警告的那种同步面。裁定：**读时用库里的告警覆盖内嵌副本**，写只写库里那一处。
 * 趋势同理用 `SEED_TREND` 覆盖（它没有写路径，覆盖只是为了让「overview 里的两份副本谁是真值」
 * 这个疑问在代码里只有一个答案）。
 *
 * # 「这一轮没有体检结果」是 `null`，不是错误
 * 进行中那轮（第 4 轮）在种子里刻意没有 overview / 矩阵 / 漏斗——采集还没跑完，
 * 出结论就是造假。handler 因此区分两件事：
 * - `round_id` 根本不存在 ⇒ `validation/failed` + `invalid_id`（调用方传错了）；
 * - 轮次存在但这一轮没有该视图的数据 ⇒ 回 `null`（列表类回 `[]`），界面显示空状态。
 */
import type { DemoHandler } from '../types';
import { demoError } from '../types';
import { alertById, alertsOf, getDemoDb, roundById } from '../db';
import type { DiagnosisOverview } from '../../api/types';
import {
  SEED_COMPETITOR_MATRICES,
  SEED_DIAGNOSIS_OVERVIEWS,
  SEED_ENGINE_SCORES,
  SEED_INTENT_FUNNELS,
  SEED_TREND,
} from '../seed/diagnosis';
import { asBoolean, asString } from './shared';

/** 轮次 id 认不出（≠「这一轮没有数据」，见文件头）。 */
function requireRoundId(roundId: string): void {
  const db = getDemoDb();
  if (!roundById(db, roundId)) {
    throw demoError('validation/failed', { field: 'round_id', reason: 'invalid_id', value: roundId });
  }
}

/**
 * `diagnosis_overview`：体检首屏（总分 + 五维 + 头号 KPI + 趋势 + 告警）。
 *
 * @returns `DiagnosisOverview | null`；`null` = 这一轮还没有可发布的体检结果。
 */
export const diagnosisOverview: DemoHandler = (args) => {
  const db = getDemoDb();
  const roundId = asString(args.round_id);
  requireRoundId(roundId);

  const seeded = SEED_DIAGNOSIS_OVERVIEWS[roundId];
  if (!seeded) return null;

  const overview: DiagnosisOverview = {
    ...structuredClone(seeded),
    // 告警与趋势一律取真值源（见文件头的裁定），不用种子里那两份内嵌副本。
    alerts: structuredClone(alertsOf(db, seeded.project_id)),
    trend: structuredClone(SEED_TREND),
  };
  return overview;
};

/** `diagnosis_competitors`：竞品对标矩阵（同框 prompt 的分母口径在 DTO 里，界面要显式说明）。 */
export const diagnosisCompetitors: DemoHandler = (args) => {
  const roundId = asString(args.round_id);
  requireRoundId(roundId);
  return structuredClone(SEED_COMPETITOR_MATRICES[roundId] ?? null);
};

/** `diagnosis_funnel`：意图漏斗（认知 → 推荐 → 决策）+ 病症结论。 */
export const diagnosisFunnel: DemoHandler = (args) => {
  const roundId = asString(args.round_id);
  requireRoundId(roundId);
  return structuredClone(SEED_INTENT_FUNNELS[roundId] ?? null);
};

/** `diagnosis_engines`：引擎差异视图（哪个引擎最认可你、哪个最容易说错你）。 */
export const diagnosisEngines: DemoHandler = (args) => {
  const roundId = asString(args.round_id);
  requireRoundId(roundId);
  return structuredClone(SEED_ENGINE_SCORES[roundId] ?? []);
};

/**
 * `diagnosis_alert_acknowledge`：标记告警已读 / 取消已读。
 *
 * `acknowledged` 缺省为 `true`（界面上的动作就叫「标记已读」；「取消已读」显式传 false）。
 * 返回整条告警，调用方就地替换列表里的那一行，不必重拉整份 overview。
 */
export const diagnosisAlertAcknowledge: DemoHandler = (args) => {
  const db = getDemoDb();
  const alertId = asString(args.alert_id);
  const alert = alertById(db, alertId);
  if (!alert) {
    throw demoError('validation/failed', { field: 'alert_id', reason: 'invalid_id', value: alertId });
  }

  alert.acknowledged = args.acknowledged === undefined ? true : asBoolean(args.acknowledged);
  return structuredClone(alert);
};

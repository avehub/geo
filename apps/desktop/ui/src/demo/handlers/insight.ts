/**
 * M4 回答解析与事实核查的 4 条命令（`insight_*` / `fact_check_*`）的内存实现。
 *
 * # 🔴 demo 不跑模型（AGENTS 规则 9）
 * 结构化抽取、来源归类、置信度打分、双模型交叉校验在真后端都是 LLM + 规则的产物；
 * demo 只把 `seed/insights.ts` 里预置的结果端出来。因此：
 * - `insight_correct` / `fact_check_resolve` **真的**改内存库（人工纠正这条交互必须能走查），
 *   但改完**不触发任何重算**：`confidence` / `fact_accuracy` / 各维度得分都还是静态值；
 * - 唯一被同步的是**证据行上的投影**（`CollectionRecord.mentioned/rank/sentiment`）——
 *   那不是重算，那是同一条事实在两个 DTO 上的两份写法，不同步界面就会自相矛盾
 *   （种子里的一致性判据在 `demo/seed.test.ts`，运行期由这里维持）。
 *
 * # 人工纠正只许改三项（`InsightCorrection`）
 * 提及与否 / 推荐位次 / 情感倾向。其余字段（提及明细、回答形态、来源分布、置信度、风险标记）
 * 是模型与规则的产物，不接受手填 ⇒ 传进来也**原样忽略**，不报错（与 demo 对契约外枚举值
 * 一律「收敛而不拒绝」的既有口径一致，见 `handlers/shared.ts` 的 `asEnumValue`）。
 */
import type { DemoDb, DemoHandler } from '../types';
import { demoError } from '../types';
import { factIssueById, factIssuesOf, getDemoDb, insightById, insightsOf, recordById } from '../db';
import type {
  AnswerInsight,
  FactCheckBoard,
  FactIssueStatus,
  InsightCorrection,
  InsightFilter,
  RiskFlag,
  Sentiment,
} from '../../api/types';
import { FACT_ISSUE_STATUS_VALUES, RISK_FLAG_VALUES, SENTIMENT_VALUES } from '../../api/types';
import { SEED_FACT_CHECK_SUMMARIES } from '../seed/insights';
import { asBoolean, asNumber, asRecord, asString, cleanOptional, nowIso } from './shared';

/** `validation/failed` + `invalid_id`：M4 的实体 id 认不出时统一走它（理由见 `handlers/collection.ts`）。 */
function unknownId(field: string, id: string): never {
  throw demoError('validation/failed', { field, reason: 'invalid_id', value: id });
}

function requireRound(db: DemoDb, roundId: string): void {
  if (!db.collectionRounds.some((round) => round.id === roundId)) unknownId('round_id', roundId);
}

/** 情感倾向：契约外的值收敛成 `null`（= 未判定），不凭空盖一个中性戳。 */
function asSentimentOrNull(value: unknown): Sentiment | null {
  const values = SENTIMENT_VALUES as readonly string[];
  return typeof value === 'string' && values.includes(value) ? (value as Sentiment) : null;
}

/** 推荐位次：只收正整数，其余（含 null / 0 / 小数 / 负数）一律 `null` = 未进推荐清单。 */
function asRankOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const rank = asNumber(value);
  return Number.isInteger(rank) && rank >= 1 ? rank : null;
}

/** 风险标记筛选：契约外的值当作「不筛」（收敛而不拒绝）。 */
function asRiskOrNull(value: unknown): RiskFlag | null {
  const values = RISK_FLAG_VALUES as readonly string[];
  return typeof value === 'string' && values.includes(value) ? (value as RiskFlag) : null;
}

/** `InsightFilter` 的四个可选条件按 AND 组合。 */
function matchesFilter(insight: AnswerInsight, filter: InsightFilter): boolean {
  if (filter.engine != null && insight.engine !== filter.engine) return false;
  if (filter.needs_review != null && insight.needs_review !== filter.needs_review) return false;
  if (filter.self_mentioned != null && insight.self_mentioned !== filter.self_mentioned) return false;
  const risk = asRiskOrNull(filter.risk);
  if (risk !== null && !insight.risks.includes(risk)) return false;
  return true;
}

/** `insight_list`：一轮的解析结果（可只看复核队列 / 只看未提及 / 只看某个风险标记）。 */
export const insightList: DemoHandler = (args) => {
  const db = getDemoDb();
  const roundId = asString(args.round_id);
  requireRound(db, roundId);

  const filter = asRecord(args.filter) as InsightFilter;
  return structuredClone(
    insightsOf(db, roundId).filter((insight) => matchesFilter(insight, filter)),
  );
};

/**
 * `insight_correct`：人工纠正一条解析结果（M4 验收点名的「一键纠正」）。
 *
 * 三件事同时发生：
 * ① 改 `self_*` 三项；② 把改过的字段名记进 `corrected_fields`（界面据此显示「已人工纠正」标记，
 * 键名进词典 `insight.correctedFields.<name>`）；③ 出复核队列（`needs_review = false`）并盖
 * `reviewed_at`。`confidence` **不动**——那是模型的自评分，人工纠正不改模型的信心。
 */
export const insightCorrect: DemoHandler = (args) => {
  const db = getDemoDb();
  const id = asString(args.id);
  const insight = insightById(db, id);
  if (!insight) unknownId('insight_id', id);

  const correction = asRecord(args.correction) as InsightCorrection;
  const corrected: string[] = [];

  if (correction.self_mentioned !== undefined) {
    insight.self_mentioned = asBoolean(correction.self_mentioned);
    corrected.push('self_mentioned');
    // 「没被提及」与「位次 / 情感」互斥：真后端抽取时同理，界面上也不该出现
    // 「未提及但排第 2」这种自相矛盾的行。
    if (!insight.self_mentioned) {
      insight.self_rank = null;
      insight.self_sentiment = null;
    }
  }
  // 位次 / 情感只在**最终仍被提及**时才有意义。若同一次纠正把「是否提及」关掉，
  // 即使调用方还带着旧的 rank（Modal 曾这样传），也不能把它写回去——
  // 否则会落下「未提及但排第 2」这种自相矛盾的行，并同步污染证据投影。
  if (correction.self_rank !== undefined) {
    // 校验总是执行（即使这条最终「未提及」）：调用方传了非法值，仍应得到稳定错误码。
    if (correction.self_rank !== null && asRankOrNull(correction.self_rank) === null) {
      throw demoError('validation/failed', {
        field: 'self_rank',
        reason: 'out_of_range',
        expected: '>=1',
        value: String(correction.self_rank),
      });
    }
    // 只有最终仍被提及才写回；同一次纠正把提及关掉时，旧 rank 不能复活。
    if (insight.self_mentioned) {
      insight.self_rank = asRankOrNull(correction.self_rank);
      corrected.push('self_rank');
    }
  }
  if (insight.self_mentioned && correction.self_sentiment !== undefined) {
    insight.self_sentiment = asSentimentOrNull(correction.self_sentiment);
    corrected.push('self_sentiment');
  }

  for (const field of corrected) {
    if (!insight.corrected_fields.includes(field)) insight.corrected_fields.push(field);
  }
  insight.needs_review = false;
  insight.reviewed_at = nowIso();

  // 同步证据行上的投影（同一条事实的两份写法，见文件头）。
  const record = recordById(db, insight.record_id);
  if (record) {
    record.mentioned = insight.self_mentioned;
    record.rank = insight.self_rank;
    record.sentiment = insight.self_sentiment;
  }
  // 提及明细里那条 `role: 'self'` 的行也要跟上，否则「提及表」与「本品牌结论」会打架。
  const selfMention = insight.mentions.find((mention) => mention.role === 'self');
  if (selfMention) {
    selfMention.rank = insight.self_rank;
    selfMention.sentiment = insight.self_sentiment ?? 'neutral';
  }

  return structuredClone(insight);
};

/**
 * `fact_check_list`：一轮的核查问题 + 分组汇总。
 *
 * `summary` 为 `null` 表示这一轮没有可发布的汇总 ⇒ 界面显示空状态（`insight.factCheck.noSummary`），
 * **不**把 0 当成"准确率为零"。种子里 4 轮都有汇总（含小样本的通道验证轮，理由见
 * `seed/insights.ts` 的 `SEED_FACT_CHECK_SUMMARIES` 头注释），所以这一支今天是防御性的：
 * 真后端在采集未完成时就是回 null。
 */
export const factCheckList: DemoHandler = (args) => {
  const db = getDemoDb();
  const roundId = asString(args.round_id);
  requireRound(db, roundId);

  const board: FactCheckBoard = {
    issues: structuredClone(factIssuesOf(db, roundId)),
    summary: structuredClone(SEED_FACT_CHECK_SUMMARIES[roundId] ?? null),
  };
  return board;
};

/**
 * `fact_check_resolve`：把一条核查问题结办成 `corrected`（已更正）或 `false_positive`（误报）。
 *
 * - `status` 契约外的值收敛成 `open`（最保守：不声称已处理）；
 * - 结办时盖 `resolved_at`，重新打开（`open`）时清掉它；
 * - `note` 是人工写的处理说明（可选）。
 *
 * 🔴 结办**不会**去改实体卡，也**不会**重算 `fact_accuracy`：真后端会不会联动是后端的事，
 * demo 不猜（规则 9）。界面上因此要看得到「已结办 2 条，但准确率仍是采集时的静态值」。
 */
export const factCheckResolve: DemoHandler = (args) => {
  const db = getDemoDb();
  const id = asString(args.id);
  const issue = factIssueById(db, id);
  if (!issue) unknownId('issue_id', id);

  const values = FACT_ISSUE_STATUS_VALUES as readonly string[];
  const requested = asString(args.status);
  const status: FactIssueStatus = values.includes(requested)
    ? (requested as FactIssueStatus)
    : 'open';

  issue.status = status;
  issue.resolved_at = status === 'open' ? null : nowIso();
  const note = cleanOptional(args.note);
  if (note !== null) issue.note = note;

  return structuredClone(issue);
};

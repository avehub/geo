/**
 * 数字与时间的**展示格式化**（M3–M7 五个页面 + `api/report-compose.ts` 共用）。
 *
 * # 为什么单独一个模块
 * 覆盖率、准确率、耗时、token 这几个量在采集页、解析页、诊断页、行动页、报告页与导出文本里
 * 都要出现。各页各写一份 `Math.round(x * 100) + '%'` 就是六个漂移面：改一处口径，
 * 另外五处会在界面上自相矛盾（而"数字对不上"正是本产品最不能出现的失败形态）。
 *
 * # 🔴 这里**不算指标**（AGENTS 规则 9）
 * 只做「已经算好的数」→「怎么显示」：乘 100、四舍五入、加正负号、套单位词条。
 * 去重率、覆盖率、准确率、样本量分级一律是后端（demo 里是种子）的静态值，
 * 本模块**一个都不重算**。
 *
 * # 单位词走词典
 * `3 个百分点` / `3 pp`、`2.4 秒` / `2.4 s` 这类单位在两种语言里形状不同 ⇒ 一律
 * `t('common.units.*')`，本模块只负责把数字算成语言中立的串再插值进去。
 * ⚠ 插值变量名一律不叫 `count`（i18next 会走复数分支找 `_one` / `_other`，本词典没有）。
 *
 * 本文件是 `.ts`，不会被 Tailwind oxide 扫到 ⇒ **不要往里放 class 名**（`src/index.css` 的常驻警告）。
 */
import type { TFunction } from 'i18next';
import dayjs from 'dayjs';

import type { ReportMetricUnit } from '../api/types';

/** 比率 → 百分数（四舍五入到整数：种子里的比率都是两位小数，再细就是假精度）。 */
export function percentNumber(ratio: number): number {
  return Math.round(ratio * 100);
}

/** 比率 → `42%`。 */
export function percentText(ratio: number): string {
  return `${percentNumber(ratio)}%`;
}

/** 带符号的整数（`+13` / `-3` / `0`）：变化量一律带符号，免得"降了 3 个点"被读成"涨了"。 */
export function signedNumber(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

/** 打分与条数：原样取整（`44` / `421`）。 */
export function plainNumber(value: number): string {
  return String(Math.round(value));
}

/**
 * 条数 → 固定 `en-US` 千分位（`1234` → `1,234`）。
 *
 * 🔴 **固定 locale，不用裸 `toLocaleString()`**：后者的分组符跟随运行环境默认 locale，
 * 同一份种子在中文 Windows 与英文 macOS 上会显示成 `1,234` / `1 234`，走查与截图对不上。
 * `en-US` 的逗号分组是本产品所有页面的既定口径（也是 `tokensText` 一直在用的那个）。
 *
 * 非有限值收敛成 `0`（照 `bytesText`）：`app_environment` / 用量统计里的计数来自异步命令，
 * 读到 `NaN` 时显示 `0` 比显示 `NaN` 好。**只做分组**，不做取整、不改小数位。
 */
export function countText(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString('en-US');
}

/**
 * 字节数 → 人类可读（`0 B` / `1.5 KB` / `3.3 MB` / `2.5 GB`），1024 进制、一位小数。
 *
 * 🔴 **不走词典**：`B` / `KB` / `MB` / `GB` 在两种语言里逐字相同，与 `3 个百分点` / `3 pp`
 * 那种"单位词形状随语言变"的情况不同（那批必须走 `common.units.*`）。
 * 两侧同值的词条只会让"哪一类单位该进词典"这条口径变糊。
 *
 * 非法值（负数 / NaN / Infinity）一律收敛成 `0 B`：`app_environment` 的 `db_size_bytes`
 * 在真桌面端来自 `fs::metadata` 的 len，读失败时可能是 0；把 `NaN MB` 显示给用户
 * 比显示 `0 B` 更糟。
 */
export function bytesText(bytes: number): string {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  // 字节档不给小数（`1023.0 B` 是假精度）；再往上保留一位。
  const text = unit === 0 ? String(Math.round(scaled)) : scaled.toFixed(1);
  return `${text} ${units[unit]}`;
}

/** 毫秒 → `2.4 秒` / `2.4 s`（一位小数：种子里的耗时都是十毫秒级精度）。 */
export function latencyText(t: TFunction, ms: number): string {
  return t('common.units.seconds', { value: (ms / 1000).toFixed(1) });
}

/** token 数 → `218188 token` / `218188 tokens`（千分位走 `countText`，语言中立）。 */
export function tokensText(t: TFunction, tokens: number): string {
  return t('common.units.tokens', { value: countText(tokens) });
}

/** 条数 → `15 条` / `15 items`。 */
export function itemsText(t: TFunction, total: number): string {
  return t('common.units.items', { value: plainNumber(total) });
}

/** 题目数 → `62 道题` / `62 prompts`。 */
export function promptsText(t: TFunction, total: number): string {
  return t('common.units.prompts', { value: plainNumber(total) });
}

/**
 * 按 `ReportMetricUnit` 格式化一个指标值（报告页、导出文本、诊断页的头号 KPI 共用）。
 *
 * - `percent`：值是 0~1 的比率 ⇒ 乘 100 显示；
 * - `score`：0~100 的打分 ⇒ 原样；
 * - `count`：条数 ⇒ 原样。
 */
export function metricValueText(unit: ReportMetricUnit, value: number): string {
  if (unit === 'percent') return percentText(value);
  return plainNumber(value);
}

/**
 * 按单位格式化一个变化量。
 *
 * 🔴 `percent` 那一支的 `delta` **已经是百分点**（种子里 `brand_coverage` 的 `delta: 13`
 * 表示 +13 个百分点，不是 +1300%）；`count` / `score` 的 delta 是原单位的差值。
 * 这条口径写在 `api/types-report.ts` 的 `ReportMetricBlock.delta` 注释里，两边不许各说各话。
 */
export function metricDeltaText(t: TFunction, unit: ReportMetricUnit, delta: number): string {
  if (unit === 'percent') {
    return t('common.units.percentagePoints', { value: signedNumber(delta) });
  }
  if (unit === 'count') return t('common.units.items', { value: signedNumber(delta) });
  return signedNumber(delta);
}

/**
 * 告警指标 → delta 的单位（Plan B Task 8 · 裁定 3 / 差异台账 E-40）。
 *
 * # 🔴 口径统一之后，格式化只剩 `metricDeltaText` 一个函数
 * 统一之前 `AlertItem.delta` 装 0~1 的**比率**（`-0.14`），`ReportMetricBlock.delta` 装
 * **百分点**（`13`），所以这里曾有一个 `alertDeltaText` 专门乘 100。裁定 3 把两侧统一到
 * 百分点之后，那个函数**连同那支 `* 100` 一起删掉**——留着它，下一个消费方仍会挑到旧口径，
 * 同一个数字又会在 M5 与 M7 之间差 100 倍（判据在 `format.test.ts`：断言它不再被导出）。
 *
 * 本函数只回答"这个指标是哪种单位"，**不做任何算术**（AGENTS 规则 9）。
 *
 * 契约外的记号一律按百分点：`AlertItem.metric` 在 DTO 里是 `string`（没有编译期白名单），
 * 而比率类指标是多数派。
 */
export function alertMetricUnit(
  metric: string,
): Extract<ReportMetricUnit, 'percent' | 'count'> {
  return metric === 'fact_error_count' ? 'count' : 'percent';
}

/**
 * RFC3339 → `2026-09-16 02:18`（语言中立的数字格式）。
 *
 * # 与 `dateText` / `dateTimeSecondsText` 的关系（此前注释说"同口径"是不准的）
 * 三者共用 `dayjs` 与 `YYYY-MM-DD` 前缀，但**精度不同**：`ProjectTable` 只要日期、
 * `RevisionTimeline` 要到秒、报告与诊断用本函数到分钟。此前三个消费方各写一份
 * `dayjs(...).format(...)`，注释却声称同口径 —— 实际是三份实现。现在统一从这里取。
 *
 * `null` 一律空串（不落成 `Invalid Date`，也不落成 1970）。
 */
export function dateTimeText(iso: string | null): string {
  return iso === null ? '' : dayjs(iso).format('YYYY-MM-DD HH:mm');
}

/** RFC3339 → `2026-09-16`（`ProjectTable` 的更新时间）。`null` 一律空串。 */
export function dateText(iso: string | null): string {
  return iso === null ? '' : dayjs(iso).format('YYYY-MM-DD');
}

/** RFC3339 → `2026-09-16 02:18:45`（`RevisionTimeline` 的留痕时间）。`null` 一律空串。 */
export function dateTimeSecondsText(iso: string | null): string {
  return iso === null ? '' : dayjs(iso).format('YYYY-MM-DD HH:mm:ss');
}

/** 0~1 的置信度 → 两位小数（`0.91`）：置信度不是比率指标，乘 100 反而与准确率混淆。 */
export function confidenceText(confidence: number): string {
  return confidence.toFixed(2);
}

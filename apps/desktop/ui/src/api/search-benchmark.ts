/**
 * 外部 CTR 经验曲线（DR-115）：**带出处与生效日期的数据文件**，🔴 默认不参与判定。
 *
 * # 🔴 为什么这些数据**不写进** `api/constants.ts`
 * 那个文件的口径是"与 Rust 真值源逐字同步的常量"；而这些数字会过期（AWR 每季度都在变），
 * 写进常量就是造一份**没人负责更新的假真值源**。所以它们以数据文件的形态存在，
 * 每条自带 `source` / `year` / `url` / `as_of`，界面上把机构名 + 年份 + 链接一起标出来
 * （词典键 `webmasterData.ctrBenchmark.source`）。
 *
 * # 🔴 为什么它们**不能**当阈值（这是本文件存在的理由）
 * 四份主流研究对"排名第一的平均点击率"给的值差近一倍：Semrush 22.4% / SISTRIX 28.5% /
 * Backlinko 31.73% / AWR 教育行业 45.35%——而且**全是英文 Google SERP**。
 * 百度 / 头条 / 搜狗**根本没有可比口径的公开曲线**（DR-100 也指出基准必须按引擎分组）。
 * ⇒ 主基准用**站点自身同位次的分位数**（样本量门槛复用 `api/constants.ts` 的
 * `MINIMUM_SAMPLE_SIZE`，🔴 不新造第二个样本量常量；样本不足时规则 1 **不出机会**），
 * 外部曲线只作**冷启动参考带**（区间，不是阈值），且冷启动期规则 1 的 `confidence` 强制压低
 * 到 `REVIEW_CONFIDENCE_FLOOR` 以下 ⇒ 进人工复核队列（与 M4 同一道门槛）。
 *
 * # 出处分级（🔴 哪些是原始研究、哪些只是我们转录的来源）
 * - **原始**：Backlinko（`backlinko.com/google-ctr-stats`）、Semrush（`semrush.com/blog/google-search-statistics/`）；
 * - **转录**：SISTRIX 与 AWR 的两条来自规格 §DR-115 记录的中文转载页（原始研究页当时未取到稳定链接）。
 *   🔴 这四条链接 2026-10-12 全部实测可达（HTTP 200）；哪天要引用到客户材料里，先回溯原始研究再换链接。
 *
 * # 合规（规则 6）
 * 界面上只能表述为"同位次经验区间"（`webmasterData.ctrBenchmark.wording`），
 * **不得**表述为"应该达到的点击率"，也不得出现排名承诺。
 */
import type { SearchSurface } from './types-search';

/** 一个位次上的经验点击率（比率，不是百分数）。 */
export interface CtrBenchmarkPoint {
  /** SERP 位次（1 基）。 */
  position: number;
  /** 该位次的平均点击率（0~1）。 */
  ctr: number;
  /** 分行业 / 分查询类型的细分（AWR 那种口径才用得上；`undefined` = 全行业）。 */
  segment?: string;
}

/**
 * 一条外部曲线。🔴 `enabled_by_default` 的类型就是字面量 `false`：
 * 谁想把它改成 `true`，`tsc -b` 当场红（`search-benchmark.test.ts` 还有一道运行期判据，§7 变异 ⑥）。
 */
export interface CtrBenchmarkCurve {
  /** 机构名（词典插值 `{{org}}`）。 */
  source: string;
  /** 研究年份（词典插值 `{{year}}`）。 */
  year: number;
  /** 可点的出处。 */
  url: string;
  /** 我们转录 / 核对这些数字的日期（`YYYY-MM-DD`）。 */
  as_of: string;
  /** 哪一家引擎的 SERP（🔴 今天四条全是 `google`，都是英文结果页）。 */
  engine: string;
  surface: SearchSurface;
  /** 设备口径：不同设备的曲线差很多，混着比就是假比较。 */
  device: 'desktop' | 'mobile' | 'mixed';
  enabled_by_default: false;
  points: readonly CtrBenchmarkPoint[];
}

/**
 * 四条曲线（DR-115 点名的那四家）。
 * 🔴 顺序按机构名字母序，不按"看起来更权威"排——排先后就是暗示取舍。
 */
export const SEARCH_CTR_BENCHMARKS: readonly CtrBenchmarkCurve[] = [
  {
    source: 'Advanced Web Ranking',
    year: 2025,
    url: 'https://k.sina.cn/article_1084407072_40a2bd2000101crqg.html',
    as_of: '2026-10-12',
    engine: 'google',
    surface: 'web_search',
    device: 'desktop',
    enabled_by_default: false,
    // 2025Q1 桌面第一位，分行业：教育 45.35% / 宠物 15.75%
    // （同一家机构、同一个位次，行业之间就差近三倍 ⇒ 全局曲线套不住任何一个具体客户）。
    points: [
      { position: 1, ctr: 0.4535, segment: 'education' },
      { position: 1, ctr: 0.1575, segment: 'pets' },
    ],
  },
  {
    source: 'Backlinko',
    year: 2023,
    url: 'https://backlinko.com/google-ctr-stats',
    as_of: '2026-10-12',
    engine: 'google',
    surface: 'web_search',
    device: 'mixed',
    enabled_by_default: false,
    // Google CTR Study（原始研究页）。
    points: [
      { position: 1, ctr: 0.3173 },
      { position: 2, ctr: 0.2471 },
      { position: 3, ctr: 0.1866 },
      { position: 4, ctr: 0.136 },
      { position: 5, ctr: 0.0951 },
    ],
  },
  {
    source: 'SISTRIX',
    year: 2023,
    url: 'https://m.sohu.com/a/712265413_121769793',
    as_of: '2026-10-12',
    engine: 'google',
    surface: 'web_search',
    device: 'mixed',
    enabled_by_default: false,
    // 分析 Google 逾 8000 万关键词、数十亿搜索结果（转录来源另见
    // `www.bilibili.com/read/mobile?id=25784667`）。第二页各位置均 <1%，故只录第一页这几档。
    points: [
      { position: 1, ctr: 0.285 },
      { position: 2, ctr: 0.15 },
      { position: 3, ctr: 0.11 },
      { position: 10, ctr: 0.025 },
    ],
  },
  {
    source: 'Semrush',
    year: 2023,
    url: 'https://www.semrush.com/blog/google-search-statistics/',
    as_of: '2026-10-12',
    engine: 'google',
    surface: 'web_search',
    device: 'mobile',
    enabled_by_default: false,
    points: [
      { position: 1, ctr: 0.224 },
      { position: 2, ctr: 0.13 },
      { position: 3, ctr: 0.1 },
    ],
  },
];

/**
 * 冷启动参考带（DR-115 ③）。🔴 **只有用户在设置里显式开启才给曲线**，否则回空数组：
 * "默认不参与判定"因此是一条**可执行的判据**，而不是一句注释。
 */
export function ctrReferenceBand(enabledInSettings: boolean): readonly CtrBenchmarkCurve[] {
  return enabledInSettings ? SEARCH_CTR_BENCHMARKS : [];
}

/**
 * 四家给"第一位平均点击率"的最大值 ÷ 最小值。
 * 🔴 这个数就是"外部曲线不能当阈值"的物证（界面上可以用它解释为什么默认关闭）。
 */
export function topOneSpread(): number {
  const values = SEARCH_CTR_BENCHMARKS.flatMap((curve) =>
    curve.points.filter((point) => point.position === 1).map((point) => point.ctr),
  );
  if (values.length === 0) return 0;
  return Math.max(...values) / Math.min(...values);
}

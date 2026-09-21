/**
 * 种子：两份题库的**组装**（简报 §B-3）。
 *
 * 行表在 `prompt-items-sufficient.ts`（62 条，`sufficient`）与
 * `prompt-items-insufficient.ts`（28 条，`insufficient`）里；本文件只做两件事：
 * ① 用一个**纯函数**从下标推导 `id` / `set_id` / `position` / `repeat_count` / `competitor_ids`；
 * ② 组装成 `PromptSet`（含 DTO 要求的内嵌 `items`）与归一化的 `SEED_PROMPT_ITEMS`。
 *
 * 🔴 这个映射函数**只搬运**：它不生成文案、不做模板展开、不算相似度、不算分级
 * （AGENTS 规则 9）。`sample_size_grade` 与 `content_hash` 都是**写死的静态值**。
 *
 * # `content_hash` 是稳定占位，不是真哈希
 * demo 种子不计算内容哈希（AGENTS 规则 9）；真实值由 Rust 侧算。刻意用一眼能看出是占位的
 * ASCII 串（而不是 64 位十六进制），免得走查的人把它当成"真算过的"结果；
 * Task 13 的环比演示靠的是「两个固定值不同」，不靠哈希本身。
 *
 * # `label` 是**数据**，可以是中文（简报 §B-11）
 * 后端产出的 `PromptSet.label` 本身就是数据级中文泄漏面（已 Park 到 Plan B/C），
 * 种子照实写中文。约束是「**代码生成的**字符串必须 ASCII」——所以下面 `promptItemId`
 * 派生出来的 id 是 `demo-pi-baseline-001` 这种形状，Task 13 克隆题库时的 label 也要照此办理。
 */
import type { PromptItem, PromptSet } from '../../api/types';
import type { PromptSeedRow } from '../types';
import { INSUFFICIENT_PROMPT_ROWS } from './prompt-items-insufficient';
import { SEED_ACTIVE_COMPETITOR_IDS, SEED_ACTIVE_PROJECT_ID } from './projects';
import { SUFFICIENT_PROMPT_ROWS } from './prompt-items-sufficient';

/** 基线题库（62 条）。 */
export const SEED_BASELINE_SET_ID = '5f6a7b8c-9d0e-4f1a-8b2c-4d5e6f708192';
/** 细分小样本题库（28 条），用来走查 `SampleSizeAlert` 的 insufficient 档。 */
export const SEED_PILOT_SET_ID = '6a7b8c9d-0e1f-4a2b-9c3d-5e6f708192a3';

const BASELINE_KEY = 'baseline';
const PILOT_KEY = 'pilot';

/** 确定性 id：固定前缀 + 三位序号（§B-3），ASCII（§B-11），同输入同输出（§B-4）。 */
function promptItemId(setKey: string, index: number): string {
  return `demo-pi-${setKey}-${String(index + 1).padStart(3, '0')}`;
}

/**
 * 紧凑行表 → `PromptItem[]`。**纯函数**：同输入同输出，不读时钟、不读随机数。
 *
 * `position` = 数组序（0 起，与 `crates/geo-domain/src/prompt.rs` 的
 * `item.position = index as i32` 同口径）；`repeat_count` 固定 1；
 * `competitor_ids` 由行表里的下标查 `competitorIds` 得到（下标越界由 `seed.test.ts` 抓）。
 */
function toPromptItems(
  rows: readonly PromptSeedRow[],
  setId: string,
  setKey: string,
  competitorIds: readonly string[],
): PromptItem[] {
  return rows.map((row, index) => ({
    id: promptItemId(setKey, index),
    set_id: setId,
    text: row.text,
    intent: row.intent,
    weight: row.weight,
    group_name: row.group_name,
    tags: [...row.tags],
    source: row.source,
    competitor_ids: row.competitors.map((slot) => competitorIds[slot]),
    repeat_count: 1,
    position: index,
  }));
}

const BASELINE_ITEMS = toPromptItems(
  SUFFICIENT_PROMPT_ROWS,
  SEED_BASELINE_SET_ID,
  BASELINE_KEY,
  SEED_ACTIVE_COMPETITOR_IDS,
);

const PILOT_ITEMS = toPromptItems(
  INSUFFICIENT_PROMPT_ROWS,
  SEED_PILOT_SET_ID,
  PILOT_KEY,
  SEED_ACTIVE_COMPETITOR_IDS,
);

export const SEED_PROMPT_SETS: PromptSet[] = [
  {
    id: SEED_BASELINE_SET_ID,
    project_id: SEED_ACTIVE_PROJECT_ID,
    version: 1,
    label: '澜舟除尘 · 基线题库',
    items: BASELINE_ITEMS,
    content_hash: 'demo-content-hash-baseline-v1',
    // A-8：`PromptSet::new` 的 engine_scope 默认是空 vec（P0-A 还没接引擎，不自己编引擎名）。
    engine_scope: [],
    metric_spec_version: 'geo-metrics-v1',
    // 62 条 >= SUFFICIENT_SAMPLE_SIZE(60) ⇒ 静态写死 sufficient（规则 9：不重算）。
    sample_size_grade: 'sufficient',
    created_at: '2026-09-16T06:00:00Z',
    // `notes` 的**两条渲染路径**都要有样本（`pages/PromptSetPage.tsx` 的 `describeNoteLine` 按行分派）：
    // 第 1 行 = 后端 `degradation_note("expansion", …)` 的**单行紧凑 ASCII 机器行**
    // （真值源 `prompt_service.rs:282` 调用、`:842` 生成；字段 stage / code / params，键按字典序），
    // 前端 `JSON.parse` 之后走词典，机器记号一个都不上屏；
    // 第 2 行 = **既存的中文散文行**，原样渲染（裁定 §H-2 明令不许顺手改成机器行）。
    // `reason: 'other'` 与 `stage: 'expansion'` 都是词典里已登记的值（zh-CN/errors.ts 的 transport.*）。
    notes:
      'degraded {"code":"llm/transport","params":{"reason":"other"},"stage":"expansion"}\n' +
      '扩写阶段调用模型失败，本轮题目改由行业模板与本地改写补足，结论仅供方向性参考。',
  },
  {
    id: SEED_PILOT_SET_ID,
    project_id: SEED_ACTIVE_PROJECT_ID,
    version: 1,
    label: '澜舟除尘 · 滤筒细分小样本',
    items: PILOT_ITEMS,
    content_hash: 'demo-content-hash-pilot-v1',
    engine_scope: [],
    metric_spec_version: 'geo-metrics-v1',
    // 28 条 < MINIMUM_SAMPLE_SIZE(30) ⇒ 静态写死 insufficient。
    sample_size_grade: 'insufficient',
    created_at: '2026-09-17T07:30:00Z',
    notes: null,
  },
];

/**
 * 归一化的条目清单（`DemoDb.promptItems` 的种子）。
 * ⚠ 与 `SEED_PROMPT_SETS[].items` 是同一份数据的两种视图，`structuredClone` 之后不再共享引用
 * ⇒ handler 改条目时两处都要更新（或以本清单为真值重组）。一致性由 `seed.test.ts` 钉住。
 */
export const SEED_PROMPT_ITEMS: PromptItem[] = [...BASELINE_ITEMS, ...PILOT_ITEMS];

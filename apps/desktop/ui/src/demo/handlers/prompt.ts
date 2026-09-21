/**
 * M2 题库的 **set 级与条目级** 9 条命令的内存实现（Task 13 · 简报 §B / §H）。
 * 真值源 `apps/desktop/src-tauri/src/services/prompt_service.rs`（下称 service）与
 * `crates/geo-store/src/repo/prompt_set.rs`（下称 repo）。CSV 那两条在 `prompt-csv.ts`。
 *
 * # 四种照抄的后端语义
 * - **返回形状三种不一致**（真后端的既有契约，不许在 demo 里“统一”掉）：
 *   `prompt_set_rename` 回**摘要**、`prompt_item_update` 回**单条**、
 *   `prompt_item_add` / `prompt_item_delete` 回**整份快照**；
 * - **`position` 是 0 基**（service:787-792 的 `reindex`：`item.position = index as i32`）；
 * - **不许把题库删空**（service:630-637：`ids.len() >= 条目总数` 就拒，一次最多删 N-1 条）；
 * - **列表不加载 items**（`api/types.ts` 的 `PromptSetSummary` 只有 `item_count`）。
 *
 * # 🔴 题库两份视图的单一真值落点（`db.ts` 留给本轮的收口）
 * `DemoDb` 里题库有 `promptItems`（归一化）与 `promptSets[].items`（DTO 内嵌副本）两份视图。
 * 裁定见 `db.ts:88-95`：item 级真值是 `promptItems`。本轮拥有写路径 ⇒ 所有改动一律经
 * `writePromptItems()` 落库，它**同时**重写两份视图与 `content_hash`，于是「忘记同步内嵌副本」
 * 这一类漂移在结构上不可能发生（读侧一律经 `promptSetWithItems`，从不读内嵌副本）。
 *
 * # 🔴 AGENTS 规则 9：demo 不算领域算法
 * `sample_size_grade` **不重算**（继承被克隆那份的静态值）、`content_hash` 是**占位派生值**
 * （`demo-` 前缀，一眼看出不是真哈希）、`prompt_set_dedupe` **不算相似度**（回静态报告）。
 * 这三件事的真值都在 Rust 纯函数里，demo 只呈现预置静态值。
 *
 * # 语言约束（门禁 7 / §B-11）
 * 本目录非注释 CJK 必须为 0 ⇒ 下面的字符串常量全是 ASCII（含 `prompt_set_generate`
 * 生成的 `label`：代码生成的字符串一律语言中立，先例 `seed/prompt-sets.ts` 的 `demo-pi-*`）。
 */
import type { DemoDb, DemoHandler } from '../types';
import { demoError } from '../types';
import { getDemoDb, promptItemsOf, promptSetsOf, promptSetWithItems } from '../db';
import { withLatency } from '../latency';
import { SEED_BASELINE_SET_ID, SEED_PROMPT_ITEMS, SEED_PROMPT_SETS } from '../seed/prompt-sets';
import type { DedupeReport, PromptItem, PromptSet, PromptSetSummary } from '../../api/types';
import {
  asIntent,
  asPromptSource,
  asRecord,
  asRecordList,
  asSampleSizeGrade,
  asString,
  asStringList,
  cleanOptional,
  newId,
  nowIso,
  requireProject,
} from './shared';

/**
 * 生成命令额外等待的毫秒数。浏览器里 `demoInvoke` 已经等过 `DEFAULT_DEMO_LATENCY_MS`(120)，
 * 两者相加约 1.2s：真实生成要跑「模板展开 → LLM 扩写 → 口语化改写 → 去重」四段，
 * 一瞬间返回会让产品负责人以为没在干活。测试路径上 `demoLatencyMs()` 一律归零 ⇒ 不拖门禁。
 */
const GENERATE_EXTRA_MS = 1080;

/** `prompt_set_generate` 造的 `label` 前缀（代码生成 ⇒ ASCII / 语言中立）。 */
const GENERATED_LABEL_PREFIX = 'demo-set-';

/** 认出自己造过的 label（序号必须与 `GENERATED_LABEL_PREFIX` 同步改）。 */
const GENERATED_LABEL = /^demo-set-(\d+)$/;

/** `metric_spec_version` 的兜底值：项目里一份题库都没有时无从继承（种子用的就是它）。 */
const METRIC_SPEC_VERSION = 'geo-metrics-v1';

/** `PromptDraft` 的 `#[serde(default = "default_weight")]`（service:101-123）。 */
const DEFAULT_WEIGHT = 3;

/** `PromptDraft` 的 `#[serde(default = "default_repeat_count")]`。 */
const DEFAULT_REPEAT_COUNT = 1;

/**
 * `content_hash` 的**占位**口径（AGENTS 规则 9）：条目数 + 文本总长，不做任何哈希运算。
 *
 * 三个必须同时成立的性质：① 以 `demo-` 开头（一眼看出是占位、不是真算过的 64 位十六进制）；
 * ② 内容一变它就变（环比演示靠这个）；③ 纯函数、零依赖（不引 crypto，浏览器与 node 都能跑）。
 * 真值由 Rust 侧算；这里**刻意不**去逼近它。
 */
export function demoContentHash(items: readonly PromptItem[]): string {
  const textLength = items.reduce((total, item) => total + item.text.length, 0);
  return `demo-${items.length}-${textLength}`;
}

/**
 * 取题库行，取不到就发 `prompt_set/not_found`。
 * params 两个键都要（简报 A-11）：契约登记的词表是 `['kind','id']`，`kind` 恒为 `'prompt_set'`。
 */
export function requirePromptSet(db: DemoDb, id: string): PromptSet {
  const found = db.promptSets.find((set) => set.id === id);
  if (!found) {
    throw demoError('prompt_set/not_found', { kind: 'prompt_set', id });
  }
  return found;
}

/**
 * 0 基重排（service:787-792 的 `reindex`）。新增/删除/导入都会改变条目集合 ⇒ 一律重排，
 * 于是「position 连续且从 0 开始」是**结构性质**，不靠每个调用点自己记得写。
 */
export function reindexed(items: readonly PromptItem[]): PromptItem[] {
  return items.map((item, index) => ({ ...item, position: index }));
}

/**
 * 唯一的 item 级写入口：同时重写归一化真值、DTO 内嵌副本与 `content_hash`。
 *
 * 🔴 两份视图存的是**同一批对象引用**（不是两份拷贝），所以它们不可能内容不一致；
 * 交给调用方的返回值一律 `structuredClone`，库里的对象绝不外泄。
 * `content_hash` 只在**写**的时候重算：读路径保持种子里那个静态占位值不变
 * （`seed/prompt-sets.ts` 刻意用了另一种形状，好让「改过」与「没改过」肉眼可分）。
 */
export function writePromptItems(db: DemoDb, setId: string, items: readonly PromptItem[]): void {
  // 🔴 **先**查 set 再动库：反过来写（先重写 `promptItems`、发现 set 没了就 return）会在极端情况下
  // 留下"归一化真值已改、内嵌副本与 content_hash 还是旧的"的半途状态——单一写入口里
  // 唯一一处**静默**的不一致。今天所有调用方都先过了 `requirePromptSet`，所以不可达；
  // 但"不可达"不该靠调用方的自觉，写入口自己就得是全有或全无。
  const set = db.promptSets.find((row) => row.id === setId);
  if (!set) {
    throw demoError('prompt_set/not_found', { kind: 'prompt_set', id: setId });
  }
  const owned = items.map((item) => ({ ...item, set_id: setId }));
  db.promptItems = [...db.promptItems.filter((item) => item.set_id !== setId), ...owned];
  set.items = owned;
  set.content_hash = demoContentHash(owned);
}

/** `PromptSet` → `PromptSetSummary`：剥掉 `items`、换成 `item_count`（列表接口不加载条目）。 */
function toSummary(db: DemoDb, set: PromptSet): PromptSetSummary {
  return {
    id: set.id,
    project_id: set.project_id,
    version: set.version,
    label: set.label,
    item_count: promptItemsOf(db, set.id).length,
    content_hash: set.content_hash,
    sample_size_grade: set.sample_size_grade,
    created_at: set.created_at,
    notes: set.notes,
  };
}

/**
 * 新题库的 label 序号 = 「既存 `demo-set-N` 的最大 N」与「项目内题库份数」两者的较大者 + 1。
 *
 * 只看份数会**撞名**：2 份种子 → `demo-set-3` → `demo-set-4`；把 `demo-set-3` 删掉后再生成，
 * 份数又回到 3 ⇒ 又叫 `demo-set-4`，下拉里出现两个同名题库（id 是 UUID，数据不受影响，
 * 但界面看起来像坏了）。取较大者就把"删掉中间一份"这个路径也堵住了。
 */
function nextLabelIndex(sets: readonly PromptSet[]): number {
  const highest = sets.reduce((max, set) => {
    const matched = GENERATED_LABEL.exec(set.label);
    return matched === null ? max : Math.max(max, Number(matched[1]));
  }, 0);
  return Math.max(sets.length, highest) + 1;
}

/**
 * 项目里一份题库都没有时的**克隆素材**：回落到种子模块的基线题库。
 *
 * 🔴 为什么必须有这个回落：真后端的生成管线（模板展开 + LLM 扩写）**永远返回非空**，
 * 而"取项目里条目最多的那份"在用户把题库全删光之后会产出一份 **0 条**的空题库且不报任何错——
 * 产品负责人点「生成」看到一个空列表，会当成 bug 报回来。
 * 读种子是读**静态数据**，不违反规则 9（不生成文案、不算相似度、不算分级）。
 */
function seedBaselineSet(): PromptSet | undefined {
  return SEED_PROMPT_SETS.find((row) => row.id === SEED_BASELINE_SET_ID);
}

function seedBaselineItems(): PromptItem[] {
  return structuredClone(
    SEED_PROMPT_ITEMS.filter((item) => item.set_id === SEED_BASELINE_SET_ID),
  );
}

/** 计数入参：非有限数回落到 `fallback`（不能用 `asNumber`，它把缺省归零，而这里的缺省是 3 / 1）。 */
function countOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** 标签清洗：逐个 trim、丢空串（与 CSV 那侧的 `TAG_SEPARATOR` 拆分对称，否则多标签会静默合并）。 */
function cleanTags(tags: readonly string[]): string[] {
  return tags.map((tag) => tag.trim()).filter((tag) => tag !== '');
}

/**
 * `PromptDraft` → `PromptItem`（service:101-123 的 `into_item`）。
 *
 * 三条照抄：① `source` **强制 `manual`**——前端不能自称模板/AI 生成（`api/types.ts` 的
 * `PromptDraft` 注释逐字如此），来源是指标口径的一部分；② `weight` / `repeat_count` 缺省 3 / 1；
 * ③ `group_name` 留空 ⇒ `null`。
 *
 * ⚠ 后端在分组留空时回填 `intent.label_zh()`（一张 7 条的**中文**表），demo 不镜像它（简报 H-8）：
 * 那会把中文字面量写进 handler（踩门禁 7），而前端本来就有本地化的 `__ungrouped__` 路径
 * （`pages/PromptSetPage.tsx:35-40`）。
 */
function makePromptItem(setId: string, draft: Record<string, unknown>, position: number): PromptItem {
  return {
    id: newId(),
    set_id: setId,
    text: asString(draft.text).trim(),
    intent: asIntent(draft.intent),
    weight: countOr(draft.weight, DEFAULT_WEIGHT),
    group_name: cleanOptional(draft.group_name),
    tags: cleanTags(asStringList(draft.tags)),
    source: 'manual',
    competitor_ids: [],
    repeat_count: countOr(draft.repeat_count, DEFAULT_REPEAT_COUNT),
    position,
  };
}

/**
 * `prompt_set_list`：`ORDER BY version DESC, created_at DESC`（repo 的 `list_by_project`）。
 *
 * 🔴 **不校项目存在性**：没有题库就回空数组。与 `competitor_list` 同口径
 * （`handlers/relations.ts`），也符合真后端「按 `project_id` 过滤」的实现——
 * 「这个项目一份题库都没有」是正常状态，不是错误。
 */
export const promptSetList: DemoHandler = (args) => {
  const db = getDemoDb();
  return promptSetsOf(db, asString(args.project_id)).map((set) => toSummary(db, set));
};

/** `prompt_set_get`：整份快照（`items` 从归一化真值重组，绝不读内嵌副本）。 */
export const promptSetGet: DemoHandler = (args) => {
  const db = getDemoDb();
  return structuredClone(promptSetWithItems(db, requirePromptSet(db, asString(args.id))));
};

/**
 * `prompt_set_generate`：**克隆**项目里条目最多的那份题库，换上新 id / label / 条目 id。
 *
 * 🔴 为什么是克隆而不是真生成：真生成要跑「模板展开 → LLM 意图分层扩写 → 中文口语化改写 →
 * 强制竞品同框 → 去重」整条管线，那是 Rust 侧的领域算法，AGENTS 规则 9 明令 demo 不许实现。
 * 取「条目最多的那份」而不是写死基线 id：种子状态下它就是 62 条的基线题库，而用户把基线删掉之后
 * 这个命令仍然有东西可克隆（不依赖某个特定种子 id 存在）。
 *
 * 入参 `options`（`target_count` / `industry` / `intents` / `repeat_count`）**一律忽略**：
 * 它驱动的是模板展开与扩写，demo 两样都不做。
 *
 * ⚠ `version` 恒为 1：真后端按项目内最大 version + 1 递增，而「版本」的语义是 P0-B 的
 * **采集轮次**——demo 没有轮次概念，编一个递增数字反而像是在演一个不存在的环比链路。
 */
export const promptSetGenerate: DemoHandler = async (args) => {
  const db = getDemoDb();
  const projectId = asString(args.project_id);
  requireProject(db, projectId);
  await withLatency(GENERATE_EXTRA_MS);

  const sets = promptSetsOf(db, projectId);
  const richest = sets.reduce<PromptSet | undefined>(
    (acc, set) =>
      acc === undefined || promptItemsOf(db, set.id).length > promptItemsOf(db, acc.id).length
        ? set
        : acc,
    undefined,
  );
  // 一份都没有 ⇒ 回落到种子的基线题库（见 `seedBaselineSet` 的理由），绝不产出空题库。
  const source = richest ?? seedBaselineSet();
  const sourceItems = richest ? promptItemsOf(db, richest.id) : seedBaselineItems();

  const setId = newId();
  const set: PromptSet = {
    id: setId,
    project_id: projectId,
    version: 1,
    // 代码生成的 label ⇒ ASCII；序号规则见 `nextLabelIndex`（两份种子 ⇒ 第一次生成是 demo-set-3）。
    label: `${GENERATED_LABEL_PREFIX}${nextLabelIndex(sets)}`,
    items: [],
    content_hash: demoContentHash(sourceItems),
    // A-8：`PromptSet::new` 的 engine_scope 默认空 vec（P0-A 还没接引擎，不自己编引擎名）。
    engine_scope: [],
    metric_spec_version: source?.metric_spec_version ?? METRIC_SPEC_VERSION,
    // 规则 9：分级**不重算**，继承被克隆那份的静态值。`asSampleSizeGrade` 那一支只是类型上的
    // 兜底（种子表非空 ⇒ 实践中到不了），回落的是三档里最保守的一档。
    sample_size_grade: source ? source.sample_size_grade : asSampleSizeGrade(undefined),
    created_at: nowIso(),
    // notes 继承：降级说明属于**这一轮生成的事实**，克隆体照带（前端按行分派渲染）。
    notes: source?.notes ?? null,
  };

  const items = sourceItems.map((item, index) => ({
    ...structuredClone(item),
    id: newId(),
    set_id: setId,
    position: index,
  }));

  db.promptSets.push(set);
  writePromptItems(db, setId, items);
  return structuredClone(promptSetWithItems(db, requirePromptSet(db, setId)));
};

/**
 * `prompt_set_rename`：回**摘要**（不是整份 `PromptSet`）。
 * 空白 label 拒（`validation/failed {field:'label', reason:'required'}`）；非空则 trim 后落库。
 * ⚠ 只改 label ⇒ **不动** `content_hash`（它是内容哈希，改名不是改内容）。
 */
export const promptSetRename: DemoHandler = (args) => {
  const db = getDemoDb();
  const set = requirePromptSet(db, asString(args.id));
  const label = asString(args.label).trim();
  if (label === '') {
    throw demoError('validation/failed', { field: 'label', reason: 'required' });
  }
  set.label = label;
  return structuredClone(toSummary(db, set));
};

/**
 * `prompt_set_delete`：连它的全部条目一起删（0 孤儿）。
 * 🔴 **不是幂等**：删不存在的题库先报一次 `prompt_set/not_found`。与 `competitor_delete` /
 * `asset_delete`（裸 `DELETE`，幂等）刻意不同——删掉一整份题库是重操作，静默成功会掩盖
 * 「前端拿着一个已经不存在的 id 在删」这类真 bug。
 */
export const promptSetDelete: DemoHandler = (args) => {
  const db = getDemoDb();
  const set = requirePromptSet(db, asString(args.id));
  db.promptSets = db.promptSets.filter((row) => row.id !== set.id);
  db.promptItems = db.promptItems.filter((item) => item.set_id !== set.id);
  return undefined;
};

/**
 * `prompt_item_update`：回**单条条目**（不是整份快照），`position` 保留原值（不重排）。
 *
 * `id` / `set_id` / `position` 一律取**库里那份**：入参是个完整 `PromptItem` 形状，
 * 但「把条目挪到另一份题库」不是这条命令的语义（真后端那支 `set_id/not_allowed`
 * 只有 `update_items_bulk` 能到达，而它**没有** IPC 命令 ⇒ 不可达，不实现）。
 */
export const promptItemUpdate: DemoHandler = (args) => {
  const db = getDemoDb();
  const incoming = asRecord(args.item);
  const id = asString(incoming.id);
  const existing = db.promptItems.find((item) => item.id === id);
  if (!existing) {
    throw demoError('prompt_item/not_found', { kind: 'prompt_item', id });
  }

  existing.text = asString(incoming.text).trim();
  existing.intent = asIntent(incoming.intent);
  existing.weight = countOr(incoming.weight, DEFAULT_WEIGHT);
  // 留空 ⇒ null；demo **不**回填意图中文标签（见 `makePromptItem` 的 H-8 说明）。
  existing.group_name = cleanOptional(incoming.group_name);
  existing.tags = cleanTags(asStringList(incoming.tags));
  existing.competitor_ids = asStringList(incoming.competitor_ids);
  existing.repeat_count = countOr(incoming.repeat_count, DEFAULT_REPEAT_COUNT);
  // 来源照收但只认契约内的值：契约外回落 `manual`（绝不凭空给条目盖上 template/generated 的戳）。
  existing.source = asPromptSource(incoming.source);

  const setId = existing.set_id;
  requirePromptSet(db, setId);
  writePromptItems(db, setId, promptItemsOf(db, setId));
  return structuredClone(existing);
};

/**
 * `prompt_item_add`：追加后 0 基重排，回**整份快照**。
 * 🔴 **整批不落库**：题库不存在时先抛，一条也不写（真后端是单事务）。
 * 空数组拒 `{field:'items', reason:'empty'}`。`source` 由 `makePromptItem` 强制 `manual`。
 */
export const promptItemAdd: DemoHandler = (args) => {
  const db = getDemoDb();
  const setId = asString(args.set_id);
  const set = requirePromptSet(db, setId);

  const drafts = asRecordList(args.items);
  if (drafts.length === 0) {
    throw demoError('validation/failed', { field: 'items', reason: 'empty' });
  }

  const existing = promptItemsOf(db, setId);
  const added = drafts.map((draft, index) => makePromptItem(setId, draft, existing.length + index));
  writePromptItems(db, setId, reindexed([...existing, ...added]));
  return structuredClone(promptSetWithItems(db, set));
};

/**
 * `prompt_item_delete`：删掉后 0 基重排，回**整份快照**。三道守卫按此顺序：
 * ① 空 `ids` ⇒ `{field:'ids', reason:'empty'}`；
 * ② **不许删空**（service:630-637）⇒ `ids.len() >= 条目总数` 就拒
 *    `{field:'ids', reason:'out_of_range', expected:'<N', value:'N'}`（要清空请显式删掉整份题库）；
 * ③ 含不属于该题库的 id ⇒ `prompt_item/not_found`。
 * 🔴 三道守卫**全部先跑完**才动库：任一失败都是 0 副作用（真后端单事务整体回滚）。
 */
export const promptItemDelete: DemoHandler = (args) => {
  const db = getDemoDb();
  const setId = asString(args.set_id);
  const set = requirePromptSet(db, setId);

  const ids = asStringList(args.ids);
  if (ids.length === 0) {
    throw demoError('validation/failed', { field: 'ids', reason: 'empty' });
  }
  const items = promptItemsOf(db, setId);
  if (ids.length >= items.length) {
    throw demoError('validation/failed', {
      field: 'ids',
      reason: 'out_of_range',
      expected: `<${items.length}`,
      value: String(ids.length),
    });
  }
  const requested = new Set(ids);
  for (const id of requested) {
    if (!items.some((item) => item.id === id)) {
      throw demoError('prompt_item/not_found', { kind: 'prompt_item', id });
    }
  }

  writePromptItems(db, setId, reindexed(items.filter((item) => !requested.has(item.id))));
  return structuredClone(promptSetWithItems(db, set));
};

/**
 * `prompt_set_dedupe`：回**静态**报告——`kept` = 全部条目、`removed` 为空、`duplicate_pairs` = 0。
 *
 * 🔴 AGENTS 规则 9 的正面案例：真去重口径是「字符 3-gram Jaccard ≥0.85 判重并合并保留权重高者」，
 * 那是 Rust 纯函数（P0-C 还要复用），demo 里**一次相似度都不许算**。所以这条命令在 demo 里
 * 只演「检查跑过了、报告长这样、界面这么渲染」，报告内容是预置静态值。
 * 字段名逐字对齐 `api/types.ts` 的 `DedupeReport`（计划正文写的 merged/remaining **不存在**）。
 */
export const promptSetDedupe: DemoHandler = (args) => {
  const db = getDemoDb();
  const set = requirePromptSet(db, asString(args.id));
  const report: DedupeReport = {
    kept: structuredClone(promptItemsOf(db, set.id)),
    removed: [],
    duplicate_pairs: 0,
  };
  return report;
};

/**
 * M2 题库的 **set 级与条目级** 9 条命令的行为测试（Task 13 · 简报 §B / §H）。
 *
 * 口径与 `relations.test.ts` 一致：错误 params 的**精确键集**归 `error-contract.test.ts`，
 * args 键名归契约测试，本文件只管行为。CSV 的两条（`prompt_set_export_csv` /
 * `prompt_set_import_csv`）在 `prompt-csv.test.ts`。
 *
 * # 本文件钉住的几件「不看代码就会写错」的事
 * - **返回形状三种不一致**（真后端的既有契约，不许在 demo 里“统一”掉）：
 *   `prompt_set_rename` 回**摘要**、`prompt_item_update` 回**单条**、`prompt_item_add`/`prompt_item_delete` 回**整份快照**。
 * - **`prompt_set_list` 不加载 items**（`api/types.ts` 的 `PromptSetSummary` 没有 `items` 字段，只有 `item_count`）。
 * - **`position` 是 0 基**（真值源 `prompt_service.rs:787-792` 的 `reindex`：`item.position = index as i32`）。
 * - **不许把题库删空**（`prompt_service.rs:630-637`：`ids.len() >= 条目总数` 就拒，一次最多删 N-1 条）。
 * - **AGENTS 规则 9**：`sample_size_grade` 不重算、`content_hash` 不算真哈希、去重不算相似度。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { DedupeReport, PromptItem, PromptSet, PromptSetSummary } from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID } from '../seed/projects';
import { SEED_BASELINE_SET_ID, SEED_PILOT_SET_ID } from '../seed/prompt-sets';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** 与 `client.demo-runtime.test.ts` 同形的 CJK 判据（用转义而不是字面中文，保持仓内一致风格）。 */
const CJK = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const MISSING_SET_ID = '00000000-0000-4000-8000-0000000000c1';
const MISSING_ITEM_ID = '00000000-0000-4000-8000-0000000000c2';
const BASELINE_COUNT = 62;
const PILOT_COUNT = 28;

async function capture(thunk: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(thunk)
    .then(
      () => null,
      (cause: unknown) => cause,
    );
}

function expectCode(cause: unknown, code: string): void {
  expect(isIpcErrorPayload(cause)).toBe(true);
  if (!isIpcErrorPayload(cause)) throw new Error('unreachable');
  expect(cause.code).toBe(code);
}

function paramsOf(cause: unknown): Readonly<Record<string, string>> {
  if (!isIpcErrorPayload(cause)) throw new Error('unreachable');
  // `params` 在 DTO 上是可选的 ⇒ 兜底成 {}（真缺键时下面的 toEqual 照样红，不是放过）。
  return cause.params ?? {};
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    text: '除尘器滤筒多久换一次比较合理？',
    intent: 'after_sales_reputation',
    weight: 4,
    group_name: null,
    repeat_count: 2,
    tags: ['耗材'],
    ...overrides,
  };
}

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/prompt · prompt_set_list', () => {
  it('回摘要形状：两份种子题库、item_count 分别是 62 与 28、**不含 items**', async () => {
    const rows = await demoInvoke<PromptSetSummary[]>('prompt_set_list', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });

    expect(rows).toHaveLength(2);
    const counts = new Map(rows.map((row) => [row.id, row.item_count]));
    expect(counts.get(SEED_BASELINE_SET_ID)).toBe(BASELINE_COUNT);
    expect(counts.get(SEED_PILOT_SET_ID)).toBe(PILOT_COUNT);
    for (const row of rows) {
      // 列表接口不加载 items（`api/types.ts` 的 `PromptSetSummary` 注释逐字）：
      // 把整份端出去既是契约违约，也会让浏览器 demo 白扛 90 条×N。
      expect(row).not.toHaveProperty('items');
      expect(typeof row.item_count).toBe('number');
    }
  });

  it('没有题库的项目回空数组（不报 not_found）', async () => {
    const rows = await demoInvoke<PromptSetSummary[]>('prompt_set_list', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
    });

    expect(rows).toEqual([]);
  });
});

describe('demo/handlers/prompt · prompt_set_get', () => {
  it('回整份快照：基线那份 62 条，position 是 0 基连续序', async () => {
    const set = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_BASELINE_SET_ID });

    expect(set.id).toBe(SEED_BASELINE_SET_ID);
    expect(set.items).toHaveLength(BASELINE_COUNT);
    expect(set.items.map((item) => item.position)).toEqual(
      Array.from({ length: BASELINE_COUNT }, (_, index) => index),
    );
    expect(set.sample_size_grade).toBe('sufficient');
  });

  it('不存在的题库报 prompt_set/not_found，params 是 {kind,id}', async () => {
    const cause = await capture(() => demoInvoke('prompt_set_get', { id: MISSING_SET_ID }));

    expectCode(cause, 'prompt_set/not_found');
    expect(paramsOf(cause)).toEqual({ kind: 'prompt_set', id: MISSING_SET_ID });
  });
});

describe('demo/handlers/prompt · prompt_set_generate', () => {
  it('克隆基线那份 62 条：新 UUID id、ASCII label、继承 grade 与 notes', async () => {
    const created = await demoInvoke<PromptSet>('prompt_set_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { target_count: 60, industry: 'b2b_manufacturing' },
    });

    expect(created.id).not.toBe(SEED_BASELINE_SET_ID);
    expect(created.id).toMatch(UUID_V4);
    expect(created.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(created.version).toBe(1);
    expect(created.items).toHaveLength(BASELINE_COUNT);
    // label 是**代码生成**的字符串 ⇒ 必须 ASCII / 语言中立（先例 `demo-set-3`）。
    expect(created.label).toBe('demo-set-3');
    expect(created.created_at).toMatch(RFC3339);
    // 规则 9：分级**不重算**，继承被克隆那份的静态值。
    expect(created.sample_size_grade).toBe('sufficient');
    // content_hash 是占位派生值，**必须以 `demo-` 开头**（一眼看出不是真哈希）。
    expect(created.content_hash.startsWith('demo-')).toBe(true);
    // notes 继承：克隆体也带降级说明（演“生成出来的题库也带机器行”）。
    expect(created.notes).toContain('degraded {');
    // 条目是新对象：新 UUID id、新 set_id、position 0 基重排。
    expect(created.items[0]!.id).toMatch(UUID_V4);
    expect(created.items.every((item) => item.set_id === created.id)).toBe(true);
    expect(created.items[0]!.position).toBe(0);
    expect(created.items[BASELINE_COUNT - 1]!.position).toBe(BASELINE_COUNT - 1);
  });

  it('入参项目不存在时报 project/not_found（经 requireProject）', async () => {
    const cause = await capture(() =>
      demoInvoke('prompt_set_generate', { project_id: MISSING_SET_ID, options: {} }),
    );

    expectCode(cause, 'project/not_found');
    expect(paramsOf(cause)).toEqual({ kind: 'project', id: MISSING_SET_ID });
  });

  it('resetDemoDb 之后回种子：列表重新只有两份', async () => {
    await demoInvoke('prompt_set_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { target_count: 60, industry: 'other' },
    });
    resetDemoDb();

    const rows = await demoInvoke<PromptSetSummary[]>('prompt_set_list', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });

    expect(rows).toHaveLength(2);
  });
});

describe('demo/handlers/prompt · prompt_set_rename', () => {
  it('回**摘要**（不是整份 PromptSet），且 label 被 trim', async () => {
    const summary = await demoInvoke<PromptSetSummary>('prompt_set_rename', {
      id: SEED_PILOT_SET_ID,
      label: '  滤筒小样本 v2  ',
    });

    expect(summary.label).toBe('滤筒小样本 v2');
    expect(summary.item_count).toBe(PILOT_COUNT);
    expect(summary).not.toHaveProperty('items');
  });

  it('空白 label 报 validation/failed {field:label, reason:required}', async () => {
    const cause = await capture(() =>
      demoInvoke('prompt_set_rename', { id: SEED_PILOT_SET_ID, label: '   ' }),
    );

    expectCode(cause, 'validation/failed');
    expect(paramsOf(cause)).toEqual({ field: 'label', reason: 'required' });
  });
});

describe('demo/handlers/prompt · prompt_set_delete', () => {
  it('同时删 set 与它的全部条目（0 孤儿）', async () => {
    await demoInvoke('prompt_set_delete', { id: SEED_PILOT_SET_ID });

    const db = getDemoDb();
    expect(db.promptSets.some((set) => set.id === SEED_PILOT_SET_ID)).toBe(false);
    expect(db.promptItems.filter((item) => item.set_id === SEED_PILOT_SET_ID)).toHaveLength(0);
    // 另一份不受影响
    expect(db.promptItems.filter((item) => item.set_id === SEED_BASELINE_SET_ID)).toHaveLength(
      BASELINE_COUNT,
    );
  });

  it('删不存在的题库**先报一次** not_found（不是静默幂等）', async () => {
    const cause = await capture(() => demoInvoke('prompt_set_delete', { id: MISSING_SET_ID }));

    expectCode(cause, 'prompt_set/not_found');
  });
});

describe('demo/handlers/prompt · prompt_item_update', () => {
  it('回**单条条目**（不是整份快照），且保留原位置', async () => {
    const before = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });
    const target = before.items[3]!;

    const updated = await demoInvoke<PromptItem>('prompt_item_update', {
      item: { ...target, text: '改过的问法', weight: 5 },
    });

    expect(updated).not.toHaveProperty('items');
    expect(updated.id).toBe(target.id);
    expect(updated.text).toBe('改过的问法');
    expect(updated.weight).toBe(5);
    expect(updated.position).toBe(target.position);
  });

  it('group_name 留空时 demo **不回填**意图标签（简报 H-8 的裁定）', async () => {
    const before = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });
    const target = before.items[0]!;

    const updated = await demoInvoke<PromptItem>('prompt_item_update', {
      item: { ...target, group_name: '   ' },
    });

    // 后端会回填 `intent.label_zh()`（中文）；demo 不镜像那张 7 条中文表，
    // 而前端已有本地化的 `__ungrouped__` 路径（`PromptSetPage.tsx:35-40`）。
    expect(updated.group_name).toBeNull();
  });

  it('条目不存在报 prompt_item/not_found', async () => {
    const cause = await capture(() =>
      demoInvoke('prompt_item_update', {
        item: { id: MISSING_ITEM_ID, set_id: SEED_PILOT_SET_ID, text: 'x', intent: 'pricing_plan' },
      }),
    );

    expectCode(cause, 'prompt_item/not_found');
    expect(paramsOf(cause)).toEqual({ kind: 'prompt_item', id: MISSING_ITEM_ID });
  });
});

describe('demo/handlers/prompt · prompt_item_add', () => {
  it('强制 source=manual（即使入参自称 generated），回整份快照且 0 基重排', async () => {
    const snapshot = await demoInvoke<PromptSet>('prompt_item_add', {
      set_id: SEED_PILOT_SET_ID,
      items: [draft({ source: 'generated' }), draft({ text: '第二条新增' })],
    });

    expect(snapshot.items).toHaveLength(PILOT_COUNT + 2);
    const added = snapshot.items.slice(PILOT_COUNT);
    expect(added.every((item) => item.source === 'manual')).toBe(true);
    expect(added.every((item) => item.id.match(UUID_V4) !== null)).toBe(true);
    expect(snapshot.items.map((item) => item.position)).toEqual(
      Array.from({ length: PILOT_COUNT + 2 }, (_, index) => index),
    );
    // 快照的 content_hash 随内容变（占位口径，但**必须变**）。
    expect(snapshot.content_hash.startsWith('demo-')).toBe(true);
  });

  it('weight / repeat_count 缺省时落 3 / 1（对齐 PromptDraft 的 serde default）', async () => {
    const snapshot = await demoInvoke<PromptSet>('prompt_item_add', {
      set_id: SEED_PILOT_SET_ID,
      items: [{ text: '只给必填项', intent: 'local_service' }],
    });

    const added = snapshot.items[snapshot.items.length - 1]!;
    expect(added.weight).toBe(3);
    expect(added.repeat_count).toBe(1);
    expect(added.tags).toEqual([]);
    expect(added.competitor_ids).toEqual([]);
  });

  it('空数组报 validation/failed {field:items, reason:empty}', async () => {
    const cause = await capture(() =>
      demoInvoke('prompt_item_add', { set_id: SEED_PILOT_SET_ID, items: [] }),
    );

    expectCode(cause, 'validation/failed');
    expect(paramsOf(cause)).toEqual({ field: 'items', reason: 'empty' });
  });

  it('整批不落库：题库不存在时一条也不会写进内存库', async () => {
    const before = getDemoDb().promptItems.length;

    const cause = await capture(() =>
      demoInvoke('prompt_item_add', { set_id: MISSING_SET_ID, items: [draft()] }),
    );

    expectCode(cause, 'prompt_set/not_found');
    expect(getDemoDb().promptItems).toHaveLength(before);
  });
});

describe('demo/handlers/prompt · prompt_item_delete', () => {
  it('删掉首条后新首条的 position 是 **0**（0 基重排，不是 1）', async () => {
    const before = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });
    const firstId = before.items[0]!.id;

    const snapshot = await demoInvoke<PromptSet>('prompt_item_delete', {
      set_id: SEED_PILOT_SET_ID,
      ids: [firstId],
    });

    expect(snapshot.items).toHaveLength(PILOT_COUNT - 1);
    expect(snapshot.items[0]!.id).toBe(before.items[1]!.id);
    expect(snapshot.items[0]!.position).toBe(0);
    expect(snapshot.items.every((item) => item.id !== firstId)).toBe(true);
  });

  it('空 ids 报 {field:ids, reason:empty}', async () => {
    const cause = await capture(() =>
      demoInvoke('prompt_item_delete', { set_id: SEED_PILOT_SET_ID, ids: [] }),
    );

    expectCode(cause, 'validation/failed');
    expect(paramsOf(cause)).toEqual({ field: 'ids', reason: 'empty' });
  });

  it('含不存在的 id 报 prompt_item/not_found，且一条也不删', async () => {
    const before = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });

    const cause = await capture(() =>
      demoInvoke('prompt_item_delete', {
        set_id: SEED_PILOT_SET_ID,
        ids: [before.items[0]!.id, MISSING_ITEM_ID],
      }),
    );

    expectCode(cause, 'prompt_item/not_found');
    const after = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });
    expect(after.items).toHaveLength(PILOT_COUNT);
  });

  it('不许把题库删空：全选删除报 {field:ids, reason:out_of_range, expected:<N, value:N}', async () => {
    const before = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });
    const allIds = before.items.map((item) => item.id);

    const cause = await capture(() =>
      demoInvoke('prompt_item_delete', { set_id: SEED_PILOT_SET_ID, ids: allIds }),
    );

    expectCode(cause, 'validation/failed');
    expect(paramsOf(cause)).toEqual({
      field: 'ids',
      reason: 'out_of_range',
      expected: `<${PILOT_COUNT}`,
      value: String(PILOT_COUNT),
    });
    const after = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });
    expect(after.items).toHaveLength(PILOT_COUNT);
  });
});

describe('demo/handlers/prompt · prompt_set_dedupe', () => {
  it('回**静态**报告：kept = 全部条目、removed 为空、duplicate_pairs = 0（规则 9）', async () => {
    const report = await demoInvoke<DedupeReport>('prompt_set_dedupe', { id: SEED_PILOT_SET_ID });

    expect(report.kept).toHaveLength(PILOT_COUNT);
    expect(report.removed).toEqual([]);
    expect(report.duplicate_pairs).toBe(0);
    // 字段名逐字对齐 `api/types.ts` 的 `DedupeReport`：计划正文写的 merged/remaining **不存在**。
    expect(report).not.toHaveProperty('merged');
    expect(report).not.toHaveProperty('remaining');
  });
});

describe('demo/seed · notes 的两条渲染路径', () => {
  it('基线那份同时含一行合法机器行与一行遗留中文散文；小样本那份仍是 null', async () => {
    const baseline = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_BASELINE_SET_ID });
    const pilot = await demoInvoke<PromptSet>('prompt_set_get', { id: SEED_PILOT_SET_ID });

    expect(pilot.notes).toBeNull();
    const lines = (baseline.notes ?? '').split('\n');
    expect(lines).toHaveLength(2);
    const [machine, prose] = lines as [string, string];
    expect(machine.startsWith('degraded ')).toBe(true);
    // 机器行必须是**单行紧凑 JSON**，且 code 必须是契约 43 码之一（否则前端渲成兜底文案）。
    const payload = JSON.parse(machine.slice('degraded '.length)) as {
      stage: string;
      code: string;
      params: Record<string, string>;
    };
    expect(payload.code).toBe('llm/transport');
    expect(payload.stage).toBe('expansion');
    expect(payload.params).toEqual({ reason: 'other' });
    expect(machine).not.toMatch(/\s,|,\s/);
    // 散文行演“非机器行原样渲染”的回退路径：必须是中文（切语言不跟着变）。
    expect(prose).toMatch(CJK);
    expect(prose.startsWith('degraded ')).toBe(false);
  });
});

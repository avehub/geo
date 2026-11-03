/**
 * M1.5 `keyword_*` 5 条命令的行为测试（spec `2026-09-30-keyword-faq-library-design.md` §6 / §7）。
 *
 * # 分工
 * - **错误 params 的精确键集** ⇒ `error-contract.test.ts`（那里钉的是契约面）；
 * - **args 键名漂移** ⇒ 由 `pages/KeywordLibraryPage.test.tsx` 经 `api/library.ts` 覆盖；
 * - **种子自洽**（14 条、5 种 kind、时间戳固定） ⇒ `demo/seed.test.ts`；
 * - 本文件管**行为**：列表口径、录入/编辑/删除的返回形状、生成批次的产物形态。
 *
 * # 🔴 这里钉的是「demo 刻意不做的事」（AGENTS 规则 9 / 规则 6）
 * ① `keyword_generate` **不调模型、不挖词**：产物逐字取自 `seed/keywords.ts` 的预置池；
 * ② 生成出来的一律 `source: 'generated'` + `status: 'pending_review'`——demo 没有合规扫描器，
 *    写 `approved` 就是假声明；
 * ③ **不做相似度去重**：重复生成只会跳过**文本完全相同**的条目（等值判断，不是 3-gram Jaccard）；
 * ④ `monthly_volume` / `difficulty` 是种子写死的静态值，handler 一个都不重算。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { KeywordItem } from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { LIBRARY_GENERATE_MAX, LIBRARY_GENERATE_MIN } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID } from '../seed/projects';
import { SEED_KEYWORDS, SEED_KEYWORD_GENERATED_POOL } from '../seed/keywords';

/** 把「同步 throw」与「rejected promise」两种形状收成同一个 catch（照 `action.test.ts`）。 */
async function capture(thunk: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(thunk)
    .then(
      () => null,
      (cause: unknown) => cause,
    );
}

function errorCode(cause: unknown): string | null {
  return isIpcErrorPayload(cause) ? cause.code : null;
}

function errorParams(cause: unknown): Record<string, string> | null {
  return isIpcErrorPayload(cause) ? cause.params ?? null : null;
}

async function list(projectId: string = SEED_ACTIVE_PROJECT_ID): Promise<KeywordItem[]> {
  return demoInvoke<KeywordItem[]>('keyword_list', { project_id: projectId });
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/keyword · keyword_list', () => {
  it('回该项目全部素材，按 position 升序；内容逐字来自种子', async () => {
    const rows = await list();

    expect(rows).toHaveLength(SEED_KEYWORDS.length);
    expect(rows.map((row) => row.position)).toEqual(rows.map((_, index) => index));
    expect(rows.map((row) => row.text)).toEqual(SEED_KEYWORDS.map((row) => row.text));
    // 静态指标原样端出（规则 9：handler 一个都不重算）
    expect(rows.map((row) => row.monthly_volume)).toEqual(
      SEED_KEYWORDS.map((row) => row.monthly_volume),
    );
  });

  it('返回的是副本：改它不会动到库', async () => {
    const rows = await list();
    rows[0].text = 'mutated';

    expect((await list())[0].text).toBe(SEED_KEYWORDS[0].text);
  });

  it('项目不存在 ⇒ project/not_found，params 两个键都在', async () => {
    const cause = await capture(() => list('no-such-project'));

    expect(errorCode(cause)).toBe('project/not_found');
    expect(errorParams(cause)).toEqual({ kind: 'project', id: 'no-such-project' });
  });

  it('归档项目也能读（素材库不因归档而消失），但没有素材就是空数组', async () => {
    expect(await list(SEED_ARCHIVED_PROJECT_ID)).toEqual([]);
  });
});

describe('demo/handlers/keyword · keyword_add（手动录入）', () => {
  it('批量录入：position 接在最大值之后、source 固定 manual、status 是 approved', async () => {
    const added = await demoInvoke<KeywordItem[]>('keyword_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      drafts: [
        { text: ' 除尘风机选型 ', kind: 'long_tail', intent: 'professional_long_tail', priority: 4 },
        { text: '除尘器厂家排名', kind: 'core', intent: 'purchase_recommendation' },
      ],
    });

    expect(added).toHaveLength(2);
    // 文本 trim 过（与竞品名同口径）
    expect(added[0].text).toBe('除尘风机选型');
    expect(added.map((row) => row.position)).toEqual([SEED_KEYWORDS.length, SEED_KEYWORDS.length + 1]);
    expect(added.every((row) => row.source === 'manual')).toBe(true);
    expect(added.every((row) => row.status === 'approved')).toBe(true);
    // priority 缺省走 3（与 PromptDraft 的 default_weight 同族口径）
    expect(added[1].priority).toBe(3);
    // 人工录入没有指标数据 ⇒ null，不是 0
    expect(added[0].monthly_volume).toBeNull();
    expect(added[0].difficulty).toBeNull();
    // 运行时新建的对象用真 uuid / 真时间（shared.ts 的确定性口径）
    for (const row of added) {
      expect(row.id, row.id).toMatch(UUID_V4);
      expect(row.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
      expect(row.created_at).toMatch(RFC3339);
      expect(row.updated_at).toBe(row.created_at);
    }

    const rows = await list();
    expect(rows).toHaveLength(SEED_KEYWORDS.length + 2);
    expect(rows.at(-1)?.text).toBe('除尘器厂家排名');
  });

  it('前端自称 AI 生成也没用：source 一律收敛成 manual', async () => {
    const added = await demoInvoke<KeywordItem[]>('keyword_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      drafts: [{ text: '除尘器', kind: 'core', intent: 'category_awareness', source: 'generated' }],
    });

    expect(added[0].source).toBe('manual');
  });

  it('文本为空白 ⇒ validation/failed { field: text, reason: required }，且一条都不入库', async () => {
    const cause = await capture(() =>
      demoInvoke('keyword_add', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        drafts: [
          { text: '除尘器', kind: 'core', intent: 'category_awareness' },
          { text: '   ', kind: 'core', intent: 'category_awareness' },
        ],
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({ field: 'text', reason: 'required' });
    expect(await list()).toHaveLength(SEED_KEYWORDS.length);
  });

  it('空 drafts ⇒ validation/failed { field: drafts, reason: required }', async () => {
    const cause = await capture(() =>
      demoInvoke('keyword_add', { project_id: SEED_ACTIVE_PROJECT_ID, drafts: [] }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({ field: 'drafts', reason: 'required' });
  });

  it('项目不存在 ⇒ project/not_found（先于文本校验）', async () => {
    const cause = await capture(() =>
      demoInvoke('keyword_add', {
        project_id: 'no-such-project',
        drafts: [{ text: '除尘器', kind: 'core', intent: 'category_awareness' }],
      }),
    );

    expect(errorCode(cause)).toBe('project/not_found');
  });
});

describe('demo/handlers/keyword · keyword_update（就地编辑与人工审核）', () => {
  it('整行进整行出：可改文本/类型/意图/优先级/状态/备注/指标', async () => {
    const target = SEED_KEYWORDS[5];
    const updated = await demoInvoke<KeywordItem>('keyword_update', {
      item: {
        ...target,
        text: '澜舟与蓝净除尘器对比',
        kind: 'competitor',
        intent: 'brand_comparison',
        priority: 5,
        status: 'approved',
        note: '人工核对过竞品标准名',
        monthly_volume: 200,
        difficulty: 25,
      },
    });

    expect(updated.id).toBe(target.id);
    expect(updated.text).toBe('澜舟与蓝净除尘器对比');
    expect(updated.priority).toBe(5);
    expect(updated.status).toBe('approved');
    expect(updated.note).toBe('人工核对过竞品标准名');
    expect(updated.monthly_volume).toBe(200);
    expect(updated.updated_at).toMatch(RFC3339);

    const rows = await list();
    expect(rows.find((row) => row.id === target.id)?.status).toBe('approved');
  });

  it('🔴 project_id / position / created_at / source 由后端保留：改个文本不能顺手改归属与来源', async () => {
    // 目标行的来源是 `generated`（AI 生成）：把它篡改成 `imported` 也必须被无视，
    // 否则"编辑一下备注"就能把一条 AI 生成的素材洗成批量导入的。
    const target = SEED_KEYWORDS[2];
    expect(target.source).toBe('generated');

    const updated = await demoInvoke<KeywordItem>('keyword_update', {
      item: {
        ...target,
        project_id: SEED_ARCHIVED_PROJECT_ID,
        position: 99,
        created_at: '2020-01-01T00:00:00Z',
        source: 'imported',
        text: '改了文本',
      },
    });

    expect(updated.id).toBe(target.id);
    expect(updated.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(updated.position).toBe(target.position);
    expect(updated.created_at).toBe(target.created_at);
    expect(updated.source).toBe('generated');
    expect(updated.text).toBe('改了文本');
  });

  it('优先级夹在 1~5：传 99 收成 5，传 0 收成 1', async () => {
    const target = SEED_KEYWORDS[0];

    const high = await demoInvoke<KeywordItem>('keyword_update', { item: { ...target, priority: 99 } });
    expect(high.priority).toBe(5);

    const low = await demoInvoke<KeywordItem>('keyword_update', { item: { ...target, priority: 0 } });
    expect(low.priority).toBe(1);
  });

  it('契约外的 kind / status 收敛到中立成员，不会流进渲染层（source 不在可改字段里）', async () => {
    const target = SEED_KEYWORDS[0];
    const updated = await demoInvoke<KeywordItem>('keyword_update', {
      item: { ...target, kind: 'not_a_kind', status: 'not_a_status', source: 'not_a_source' },
    });

    expect(updated.kind).toBe('core');
    expect(updated.status).toBe('pending_review');
    // source 是**归属账**，不参与收敛也不接受改写（见上一条用例）。
    expect(updated.source).toBe(target.source);
  });

  it('🔴 空白文本拒 validation/failed { field: text, reason: required }，且不改库', async () => {
    const target = SEED_KEYWORDS[0];
    const before = await list();

    const cause = await capture(() =>
      demoInvoke('keyword_update', { item: { ...target, text: '   ' } }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({ field: 'text', reason: 'required' });
    expect(await list()).toEqual(before);
  });

  it('id 认不出 ⇒ validation/failed { field: keyword_id, reason: invalid_id, value }', async () => {
    const cause = await capture(() =>
      demoInvoke('keyword_update', { item: { ...SEED_KEYWORDS[0], id: 'no-such-keyword' } }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'keyword_id',
      reason: 'invalid_id',
      value: 'no-such-keyword',
    });
  });
});

describe('demo/handlers/keyword · keyword_delete', () => {
  it('回剩余快照，position 重排成 0..n-1（照 M2 的 reindex 口径）', async () => {
    const removed = [SEED_KEYWORDS[0].id, SEED_KEYWORDS[2].id];

    const remaining = await demoInvoke<KeywordItem[]>('keyword_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: removed,
    });

    expect(remaining).toHaveLength(SEED_KEYWORDS.length - 2);
    expect(remaining.map((row) => row.position)).toEqual(remaining.map((_, index) => index));
    expect(remaining.some((row) => removed.includes(row.id))).toBe(false);
    expect(await list()).toHaveLength(SEED_KEYWORDS.length - 2);
  });

  it('幂等：认不出的 id 直接忽略，不发 not_found（照 competitor_delete 的口径）', async () => {
    const remaining = await demoInvoke<KeywordItem[]>('keyword_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: ['no-such-keyword'],
    });

    expect(remaining).toHaveLength(SEED_KEYWORDS.length);
  });

  it('允许删空（素材库没有"题库不许删空"那条约束）', async () => {
    const remaining = await demoInvoke<KeywordItem[]>('keyword_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: SEED_KEYWORDS.map((row) => row.id),
    });

    expect(remaining).toEqual([]);
  });

  it('只删本项目的行：别的项目的素材不受影响', async () => {
    const db = getDemoDb();
    db.keywords.push({ ...SEED_KEYWORDS[0], id: 'other-project-kw', project_id: SEED_ARCHIVED_PROJECT_ID });

    await demoInvoke('keyword_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: ['other-project-kw', SEED_KEYWORDS[0].id],
    });

    expect(db.keywords.some((row) => row.id === 'other-project-kw')).toBe(true);
  });
});

describe('demo/handlers/keyword · keyword_generate（🔴 预置批次，不调模型）', () => {
  it('按 kinds 从预置池里挑，产物一律 generated + pending_review，文本逐字来自池子', async () => {
    const generated = await demoInvoke<KeywordItem[]>('keyword_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { kinds: ['long_tail'], target_count: 3 },
    });

    expect(generated).toHaveLength(3);
    const poolTexts = SEED_KEYWORD_GENERATED_POOL.filter((row) => row.kind === 'long_tail').map(
      (row) => row.text,
    );
    expect(generated.map((row) => row.text)).toEqual(poolTexts.slice(0, 3));
    expect(generated.every((row) => row.source === 'generated')).toBe(true);
    expect(generated.every((row) => row.status === 'pending_review')).toBe(true);
    expect(generated.every((row) => row.id.match(UUID_V4) !== null)).toBe(true);

    // 入库了：列表里能看到，position 接在种子之后
    const rows = await list();
    expect(rows).toHaveLength(SEED_KEYWORDS.length + 3);
    expect(rows.map((row) => row.position)).toEqual(rows.map((_, index) => index));
  });

  it('多类一起要：按池子里的顺序挑满 target_count', async () => {
    const generated = await demoInvoke<KeywordItem[]>('keyword_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { kinds: ['brand', 'question'], target_count: 4 },
    });

    const poolTexts = SEED_KEYWORD_GENERATED_POOL.filter(
      (row) => row.kind === 'brand' || row.kind === 'question',
    ).map((row) => row.text);
    expect(generated.map((row) => row.text)).toEqual(poolTexts.slice(0, 4));
  });

  it('🔴 不做相似度去重：只跳过文本完全相同的条目（连点两次不会入库两份）', async () => {
    const first = await demoInvoke<KeywordItem[]>('keyword_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { kinds: ['long_tail'], target_count: 2 },
    });
    const second = await demoInvoke<KeywordItem[]>('keyword_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { kinds: ['long_tail'], target_count: 2 },
    });

    expect(first.map((row) => row.text)).not.toEqual(second.map((row) => row.text));
    const rows = await list();
    const texts = rows.map((row) => row.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('池子挑空 ⇒ 回空数组（不是错误），界面据此提示"换个类型或手动录入"', async () => {
    await demoInvoke('keyword_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { kinds: ['brand', 'competitor', 'core', 'long_tail', 'question'], target_count: 99 },
    });
    const second = await demoInvoke<KeywordItem[]>('keyword_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { kinds: ['brand', 'competitor', 'core', 'long_tail', 'question'], target_count: 99 },
    });

    expect(second).toEqual([]);
  });

  it('target_count 夹在 1~20：传 99 只出池子里那么多，传 0 出一条', async () => {
    expect(LIBRARY_GENERATE_MIN).toBe(1);
    expect(LIBRARY_GENERATE_MAX).toBe(20);

    const zero = await demoInvoke<KeywordItem[]>('keyword_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { kinds: ['core'], target_count: 0 },
    });
    expect(zero).toHaveLength(1);
  });

  it('kinds 为空 ⇒ validation/failed { field: kinds, reason: required }，一条都不入库', async () => {
    const cause = await capture(() =>
      demoInvoke('keyword_generate', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        options: { kinds: [], target_count: 5 },
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({ field: 'kinds', reason: 'required' });
    expect(await list()).toHaveLength(SEED_KEYWORDS.length);
  });

  it('kinds 里混进契约外的值 ⇒ 该值被忽略，其余照挑（不静默失败）', async () => {
    const generated = await demoInvoke<KeywordItem[]>('keyword_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { kinds: ['brand', 'not_a_kind'], target_count: 5 },
    });

    expect(generated.every((row) => row.kind === 'brand')).toBe(true);
    expect(generated.length).toBeGreaterThan(0);
  });

  it('项目不存在 ⇒ project/not_found', async () => {
    const cause = await capture(() =>
      demoInvoke('keyword_generate', {
        project_id: 'no-such-project',
        options: { kinds: ['core'], target_count: 3 },
      }),
    );

    expect(errorCode(cause)).toBe('project/not_found');
  });

  it('规则 6：生成产物永远不会是 approved（哪怕前端在 options 里这么要求）', async () => {
    const generated = await demoInvoke<KeywordItem[]>('keyword_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { kinds: ['core'], target_count: 2, status: 'approved', source: 'manual' },
    });

    expect(generated.every((row) => row.status === 'pending_review')).toBe(true);
    expect(generated.every((row) => row.source === 'generated')).toBe(true);
  });
});

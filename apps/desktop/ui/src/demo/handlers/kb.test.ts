/**
 * M1.2b `kb_*` 6 条命令的行为测试（spec `2026-10-10-kb-redesign-and-article-studio-design.md`
 * §3 / §6，裁定 DR-73 … DR-82）。
 *
 * # 与上一轮的差异：投影那三条靶心**退役**
 * 同步块没了（DR-73），所以这里不再证"改实体卡 board 跟着变"；改证三件新事：
 * ① `kb_board` 的返回里**没有** `synced` / `stale_ids`（结构上不可能再活现镜像）；
 * ② `kb_entry_add` 的 `source: 'imported'` 白名单与状态映射（DR-81）——前端自称
 *    `generated` 不算数、导入的 `status` 只认 approved / pending_review；
 * ③ 场景维度的后端规则（DR-75）：话术两模块保留、其余模块**强制置 null**、
 *    编辑跨模块搬家时场景跟着清 / 挂。
 *
 * # 分工（与 `keyword.test.ts` / `faq.test.ts` 同族，不重复写的部分）
 * 「返回形状三种不一致是刻意的」「`position` 0 基 + 删除后重排」「删除幂等」
 * 与素材库逐字同口径 ⇒ 各留一条最小断言。
 *
 * # 🔴 demo 不做的四件事（规则 9 / 规则 2 / 规则 6）各自都要有一条断言
 * ① `kb_generate` 不调模型（产物逐字来自预置池）；② 不做检索（契约里没有搜索入参）；
 * ③ 不碰媒体文件（`url` / `mime` 原样存取）；④ `KbStats` 只是数数（不含评分）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { KbBoard, KbEntry, KbEntryRevision } from '../../api/types';
import { isIpcErrorPayload, KB_MODULE_VALUES } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import { SEED_KB_ENTRIES, SEED_KB_GENERATED_POOL, SEED_KB_REVISIONS } from '../seed/kb';
import { KB_REVISION_BODY_LIMIT } from './kb-revision';
import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID } from '../seed/projects';

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
  return isIpcErrorPayload(cause) ? (cause.params ?? null) : null;
}

async function board(projectId: string = SEED_ACTIVE_PROJECT_ID): Promise<KbBoard> {
  return demoInvoke<KbBoard>('kb_board', { project_id: projectId });
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

afterEach(() => {
  resetDemoDb();
});

describe('kb_board', () => {
  it('回落库条目（position ASC）+ 统计；🔴 返回里没有任何投影字段（DR-73）', async () => {
    const result = await board();
    expect(result.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(result.entries).toHaveLength(SEED_KB_ENTRIES.length);
    const positions = result.entries.map((entry) => entry.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(result.stats).toEqual({
      modules: 11,
      entries: SEED_KB_ENTRIES.length,
      scripts: 7,
      pending_review: 3,
      unverified: SEED_KB_ENTRIES.length - 8,
      media: 3,
    });
    // DR-73 的结构断言：键集里不可能再长出镜像。
    // DR-119 之后多一个 `revisions`：留痕的读出口**寄生**在 board 上（命令面不加）。
    expect(Object.keys(result).sort()).toEqual(
      ['project_id', 'entries', 'stats', 'project_updated_at', 'revisions'].sort(),
    );
  });

  it('统计只是数数（规则 9）：没有任何评分 / 覆盖率字段', async () => {
    const result = await board();
    expect(Object.keys(result.stats).sort()).toEqual(
      ['modules', 'entries', 'scripts', 'pending_review', 'unverified', 'media'].sort(),
    );
  });

  it('归档项目也有自己的空库；不存在的项目报 project/not_found', async () => {
    const archived = await board(SEED_ARCHIVED_PROJECT_ID);
    expect(archived.entries).toEqual([]);
    expect(archived.stats.entries).toBe(0);

    const cause = await capture(() => board('00000000-0000-4000-8000-000000000000'));
    expect(errorCode(cause)).toBe('project/not_found');
  });
});

describe('kb_entry_add', () => {
  it('手动录入：source 固定 manual、status 固定 approved、verified_at 固定 null', async () => {
    const added = await demoInvoke<KbEntry[]>('kb_entry_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      drafts: [
        {
          module: 'sales_script',
          kind: 'statement',
          title: 'new script',
          body_markdown: 'hello',
          scenario: 'sales_quote',
          tags: ['a'],
        },
      ],
    });
    expect(added).toHaveLength(1);
    const [row] = added;
    expect(row.source).toBe('manual');
    expect(row.status).toBe('approved');
    expect(row.verified_at).toBeNull();
    expect(row.scenario).toBe('sales_quote');
    expect(row.id).toMatch(UUID_V4);
    expect(row.created_at).toMatch(RFC3339);
    expect(row.position).toBe(SEED_KB_ENTRIES.length);
  });

  it('🔴 source 白名单：只有 imported 被尊重，自称 generated 一律落 manual（DR-81）', async () => {
    const added = await demoInvoke<KbEntry[]>('kb_entry_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      drafts: [
        { module: 'brand', kind: 'statement', title: 'liar', source: 'generated' },
        { module: 'brand', kind: 'statement', title: 'honest', source: 'imported' },
      ],
    });
    expect(added[0].source).toBe('manual');
    expect(added[1].source).toBe('imported');
  });

  it('🔴 导入的状态映射：approved 被尊重、rejected 被收敛成 pending_review、缺省 pending_review', async () => {
    const added = await demoInvoke<KbEntry[]>('kb_entry_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      drafts: [
        { module: 'qualification', kind: 'text', title: 'a', source: 'imported', status: 'approved' },
        { module: 'qualification', kind: 'text', title: 'b', source: 'imported', status: 'rejected' },
        { module: 'qualification', kind: 'text', title: 'c', source: 'imported' },
      ],
    });
    expect(added.map((row) => row.status)).toEqual(['approved', 'pending_review', 'pending_review']);
  });

  it('🔴 场景维度：非话术模块强制置 null，不报错（DR-75）', async () => {
    const added = await demoInvoke<KbEntry[]>('kb_entry_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      drafts: [
        {
          module: 'brand',
          kind: 'statement',
          title: 'brand with stray scenario',
          scenario: 'sales_closing',
        },
        {
          module: 'support_script',
          kind: 'statement',
          title: 'support with scenario',
          scenario: 'support_return',
        },
        { module: 'support_script', kind: 'statement', title: 'support without scenario' },
      ],
    });
    expect(added[0].scenario).toBeNull();
    expect(added[1].scenario).toBe('support_return');
    expect(added[2].scenario).toBeNull();
  });

  it('全有或全无：一条标题空白整批拒，库里一条都不多', async () => {
    const before = (await board()).entries.length;
    const cause = await capture(() =>
      demoInvoke('kb_entry_add', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        drafts: [
          { module: 'brand', kind: 'statement', title: 'fine' },
          { module: 'brand', kind: 'statement', title: '   ' },
        ],
      }),
    );
    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({ field: 'kb_title', reason: 'required' });
    expect((await board()).entries.length).toBe(before);
  });
});

describe('kb_entry_update', () => {
  it('整行进整行出；🔴 verified_at / source / position 前端改不动', async () => {
    const db = getDemoDb();
    const seed = db.kbEntries.find((row) => row.project_id === SEED_ACTIVE_PROJECT_ID);
    expect(seed).toBeDefined();
    const original = structuredClone(seed!);

    const saved = await demoInvoke<KbEntry>('kb_entry_update', {
      entry: {
        ...original,
        title: 'renamed',
        module: 'sales_script',
        scenario: 'sales_needs',
        verified_at: '2026-01-01T00:00:00Z',
        source: 'generated',
        position: 999,
      },
    });
    expect(saved.title).toBe('renamed');
    expect(saved.module).toBe('sales_script');
    expect(saved.scenario).toBe('sales_needs');
    expect(saved.verified_at).toBe(original.verified_at);
    expect(saved.source).toBe(original.source);
    expect(saved.position).toBe(original.position);
  });

  it('编辑跨模块搬家：话术 → 品牌时场景被清掉；品牌 → 话术且带场景时挂上（DR-75）', async () => {
    const db = getDemoDb();
    const script = db.kbEntries.find(
      (row) => row.project_id === SEED_ACTIVE_PROJECT_ID && row.module === 'sales_script',
    );
    expect(script?.scenario).not.toBeNull();
    const moved = await demoInvoke<KbEntry>('kb_entry_update', {
      entry: { ...structuredClone(script), module: 'brand' },
    });
    expect(moved.scenario).toBeNull();

    const back = await demoInvoke<KbEntry>('kb_entry_update', {
      entry: { ...moved, module: 'support_script', scenario: 'support_complaint' },
    });
    expect(back.scenario).toBe('support_complaint');
  });

  it('认不出的 id 报 validation/failed；空白标题报 required', async () => {
    const db = getDemoDb();
    const seed = structuredClone(
      db.kbEntries.find((row) => row.project_id === SEED_ACTIVE_PROJECT_ID),
    );
    const missing = await capture(() =>
      demoInvoke('kb_entry_update', { entry: { ...seed, id: 'nope' } }),
    );
    expect(errorCode(missing)).toBe('validation/failed');
    expect(errorParams(missing)?.reason).toBe('invalid_id');

    const blank = await capture(() =>
      demoInvoke('kb_entry_update', { entry: { ...seed, title: ' ' } }),
    );
    expect(errorCode(blank)).toBe('validation/failed');
    expect(errorParams(blank)).toEqual({ field: 'kb_title', reason: 'required' });
  });
});

describe('kb_entry_delete / kb_entry_verify', () => {
  it('删除回剩余快照且 position 重排成 0..n-1；认不出的 id 忽略（幂等）', async () => {
    const db = getDemoDb();
    const victim = db.kbEntries.find((row) => row.project_id === SEED_ACTIVE_PROJECT_ID);
    const remaining = await demoInvoke<KbEntry[]>('kb_entry_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: [victim!.id, 'ghost-id'],
    });
    expect(remaining).toHaveLength(SEED_KB_ENTRIES.length - 1);
    expect(remaining.map((row) => row.position)).toEqual(
      remaining.map((_row, index) => index),
    );
  });

  it('核实 = status approved + verified_at now；没命中就原样回快照不报错', async () => {
    const db = getDemoDb();
    const pending = db.kbEntries.find(
      (row) => row.project_id === SEED_ACTIVE_PROJECT_ID && row.status === 'pending_review',
    );
    expect(pending).toBeDefined();
    const after = await demoInvoke<KbEntry[]>('kb_entry_verify', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: [pending!.id],
    });
    const verified = after.find((row) => row.id === pending!.id);
    expect(verified?.status).toBe('approved');
    expect(verified?.verified_at).toMatch(RFC3339);

    const untouched = await demoInvoke<KbEntry[]>('kb_entry_verify', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: ['ghost-id'],
    });
    expect(untouched).toHaveLength(SEED_KB_ENTRIES.length);
  });
});

describe('kb_generate', () => {
  it('🔴 不调模型：产物逐字来自预置池，且一律 generated + pending_review（规则 6 / 9）', async () => {
    const added = await demoInvoke<KbEntry[]>('kb_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { modules: ['selling_point', 'case'], target_count: 2 },
    });
    expect(added).toHaveLength(2);
    for (const row of added) {
      const pool = SEED_KB_GENERATED_POOL.find((item) => item.title === row.title);
      expect(pool).toBeDefined();
      expect(row.body_markdown).toBe(pool?.body_markdown);
      expect(row.source).toBe('generated');
      expect(row.status).toBe('pending_review');
      expect(row.verified_at).toBeNull();
    }
  });

  it('按标题去重：连点两次不会出两份；池子掏空就回空数组（不是错误）', async () => {
    const first = await demoInvoke<KbEntry[]>('kb_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { modules: ['tone'], target_count: 5 },
    });
    expect(first.length).toBeGreaterThan(0);
    const second = await demoInvoke<KbEntry[]>('kb_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { modules: ['tone'], target_count: 5 },
    });
    expect(second).toEqual([]);
  });

  it('模块清单：空 / 全认不出 ⇒ validation/failed；契约外的值被丢掉而不是收敛', async () => {
    const empty = await capture(() =>
      demoInvoke('kb_generate', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        options: { modules: [], target_count: 3 },
      }),
    );
    expect(errorCode(empty)).toBe('validation/failed');

    const junk = await capture(() =>
      demoInvoke('kb_generate', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        options: { modules: ['nope'], target_count: 3 },
      }),
    );
    expect(errorCode(junk)).toBe('validation/failed');

    const mixed = await demoInvoke<KbEntry[]>('kb_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { modules: ['nope', 'audience'], target_count: 3 },
    });
    expect(mixed.every((row) => row.module === 'audience')).toBe(true);
  });

  it('媒体条目原样存取 url / mime（规则 2：不下载不探测）', async () => {
    const added = await demoInvoke<KbEntry[]>('kb_entry_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      drafts: [
        {
          module: 'media',
          kind: 'video',
          title: 'clip',
          url: 'https://cdn.example.com/a.mp4',
          mime: 'video/mp4',
        },
      ],
    });
    const stored = (await board()).entries.find((row) => row.id === added[0].id);
    expect(stored?.url).toBe('https://cdn.example.com/a.mp4');
    expect(stored?.mime).toBe('video/mp4');
  });

  it('模块枚举完整性：taxonomy v2 的 11 个键都在（DR-74）', () => {
    expect(KB_MODULE_VALUES).toHaveLength(11);
    expect([...KB_MODULE_VALUES].sort()).toEqual(
      [
        'brand',
        'product',
        'selling_point',
        'sales_script',
        'support_script',
        'case',
        'competitor',
        'audience',
        'tone',
        'qualification',
        'media',
      ].sort(),
    );
  });
});

/**
 * DR-119 · 知识库条目的修订留痕（照品牌实体卡 `entity_card_update_field` 的逐字段姿态）。
 *
 * 五条判据各挡一种劣化：
 * ① 读出口**寄生** `kb_board`（命令面不加）且新的在前；
 * ② **逐字段**留痕——改两个字段记两条（变异靶心：改成"整卡一条"必须红）；
 * ③ `body_markdown` 的新旧值截断到 120 字符，🔴 但**库里的正文不截断**；
 * ④ `kb_entry_verify` 记一条 `field_path: 'verified_at'`；
 * ⑤ 创建 / 删除 / 生成**不留痕**（它们不是"修订"）。
 */
describe('留痕（DR-119）', () => {
  async function revisions(entryId?: string): Promise<KbEntryRevision[]> {
    const result = await board();
    return entryId === undefined
      ? result.revisions
      : result.revisions.filter((row) => row.entry_id === entryId);
  }

  function firstEntry(): KbEntry {
    const row = getDemoDb().kbEntries.find((item) => item.project_id === SEED_ACTIVE_PROJECT_ID);
    expect(row).toBeDefined();
    return structuredClone(row!);
  }

  it('kb_board 带 revisions：种子那几条读得回来，且新的在前', async () => {
    const rows = await revisions();
    expect(rows.length).toBeGreaterThanOrEqual(SEED_KB_REVISIONS.length);
    const stamps = rows.map((row) => row.edited_at);
    expect(stamps).toEqual([...stamps].sort().reverse());
    // 六键同构：与 EntityCardRevision 共用的那六个键一个都不能少。
    for (const row of rows.slice(0, SEED_KB_REVISIONS.length)) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'id',
          'entry_id',
          'project_id',
          'field_path',
          'old_value',
          'new_value',
          'status',
          'note',
          'edited_at',
        ].sort(),
      );
    }
  });

  it('改两个字段 ⇒ 记两条留痕（old/new 并排）；没改的字段一条都不记', async () => {
    const entry = firstEntry();
    const before = await revisions(entry.id);

    const saved = await demoInvoke<KbEntry>('kb_entry_update', {
      entry: { ...entry, title: 'renamed title', tags: ['tag-a', 'tag-b'] },
    });
    expect(saved.title).toBe('renamed title');

    const after = await revisions(entry.id);
    expect(after.length).toBe(before.length + 2);
    const paths = after.slice(0, 2).map((row) => row.field_path).sort();
    expect(paths).toEqual(['tags', 'title']);

    const title = after.find((row) => row.field_path === 'title');
    expect(title?.old_value).toBe(entry.title);
    expect(title?.new_value).toBe('renamed title');
    expect(title?.entry_id).toBe(entry.id);
    expect(title?.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(title?.status).toBe('official');
    expect(title?.note).toBeNull();
    expect(title?.edited_at).toMatch(RFC3339);
    expect(title?.id).toMatch(UUID_V4);

    const tags = after.find((row) => row.field_path === 'tags');
    expect(tags?.old_value).toEqual(entry.tags);
    expect(tags?.new_value).toEqual(['tag-a', 'tag-b']);
  });

  it('原样保存 ⇒ 一条都不记（留痕只回答"改了什么"）', async () => {
    const entry = firstEntry();
    const before = await revisions(entry.id);
    await demoInvoke<KbEntry>('kb_entry_update', { entry });
    expect(await revisions(entry.id)).toHaveLength(before.length);
  });

  it('body_markdown 的新旧值截断到 120 字符，但库里的正文原样保留', async () => {
    const entry = firstEntry();
    const long = 'a'.repeat(KB_REVISION_BODY_LIMIT + 80);

    await demoInvoke<KbEntry>('kb_entry_update', { entry: { ...entry, body_markdown: long } });
    const first = (await revisions(entry.id)).find((row) => row.field_path === 'body_markdown');
    expect(first?.new_value).toBe(long.slice(0, KB_REVISION_BODY_LIMIT));
    expect(String(first?.new_value)).toHaveLength(KB_REVISION_BODY_LIMIT);

    // 第二次改：这次的**旧值**同样是那条 200 字长文 ⇒ 也要截断。
    const stored = (await board()).entries.find((row) => row.id === entry.id);
    expect(stored?.body_markdown, '留痕截断不许影响库里的值').toBe(long);
    await demoInvoke<KbEntry>('kb_entry_update', {
      entry: { ...stored!, body_markdown: 'short' },
    });
    const second = (await revisions(entry.id)).find((row) => row.new_value === 'short');
    expect(String(second?.old_value)).toHaveLength(KB_REVISION_BODY_LIMIT);
  });

  it('kb_entry_verify ⇒ 每条记一条 field_path=verified_at（旧值 null、状态 official）', async () => {
    const pending = getDemoDb().kbEntries.find(
      (row) => row.project_id === SEED_ACTIVE_PROJECT_ID && row.status === 'pending_review',
    );
    expect(pending).toBeDefined();
    const before = await revisions(pending!.id);

    await demoInvoke<KbEntry[]>('kb_entry_verify', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: [pending!.id, 'ghost-id'],
    });

    const after = await revisions(pending!.id);
    expect(after.length).toBe(before.length + 1);
    expect(after[0].field_path).toBe('verified_at');
    expect(after[0].old_value).toBeNull();
    expect(after[0].new_value).toMatch(RFC3339);
    expect(after[0].status).toBe('official');
  });

  it('add / delete / generate 不留痕（创建与删除不是"修订"）', async () => {
    const before = (await revisions()).length;

    const added = await demoInvoke<KbEntry[]>('kb_entry_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      drafts: [{ module: 'brand', kind: 'statement', title: 'brand new' }],
    });
    expect(await revisions()).toHaveLength(before);
    expect(await revisions(added[0].id)).toEqual([]);

    await demoInvoke<KbEntry[]>('kb_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      options: { modules: ['selling_point'], target_count: 2 },
    });
    expect(await revisions()).toHaveLength(before);

    await demoInvoke<KbEntry[]>('kb_entry_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: [added[0].id],
    });
    expect(await revisions()).toHaveLength(before);
  });

  it('留痕的 status 由条目审核态投影：pending_review → pending、rejected → disputed', async () => {
    const entry = firstEntry();
    await demoInvoke<KbEntry>('kb_entry_update', {
      entry: { ...entry, status: 'pending_review', title: 'needs review' },
    });
    const pending = (await revisions(entry.id)).find((row) => row.new_value === 'needs review');
    expect(pending?.status).toBe('pending');

    const stored = (await board()).entries.find((row) => row.id === entry.id);
    await demoInvoke<KbEntry>('kb_entry_update', {
      entry: { ...stored!, status: 'rejected', title: 'turned down' },
    });
    const rejected = (await revisions(entry.id)).find((row) => row.new_value === 'turned down');
    expect(rejected?.status).toBe('disputed');
  });

  it('截断上限就是 120 字符（DR-119 写死的口径，改宽改窄都要回来过审）', () => {
    expect(KB_REVISION_BODY_LIMIT).toBe(120);
  });
});

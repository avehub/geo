/**
 * M1 `competitor_*`（4 条）与 `asset_*`（3 条）的行为测试（Task 12 · 简报 §B-1 / §B-7）。
 *
 * 口径与 `project.test.ts` 一致：错误 params 的**精确键集**归 `error-contract.test.ts`，
 * args 键名归 `m1-contract.test.ts`，本文件只管行为——
 * 排序（真值源 `crates/geo-store/src/repo/{competitor,asset}.rs` 的 `ORDER BY`）、
 * `position` 的分配、`reorder` 的**全有或全无**、以及删除的**幂等**
 * （真后端两条 delete 都是 `DELETE … WHERE id = ?`，行不存在也返回 `Ok`）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { Competitor, ProjectAsset } from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { resetDemoDb } from '../db';
import {
  SEED_ACTIVE_COMPETITOR_IDS,
  SEED_ACTIVE_PROJECT_ID,
  SEED_ARCHIVED_PROJECT_ID,
  SEED_ASSETS,
  SEED_COMPETITORS,
} from '../seed/projects';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const MISSING_PROJECT_ID = '00000000-0000-4000-8000-0000000000aa';
const MISSING_ROW_ID = '00000000-0000-4000-8000-0000000000bb';

function draft(overrides: Record<string, unknown> = {}) {
  return { name: 'Rival A', aliases: ['A1'], website: null, note: '  keep me  ', ...overrides };
}

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

const activeCompetitors = () =>
  SEED_COMPETITORS.filter((row) => row.project_id === SEED_ACTIVE_PROJECT_ID);

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/relations · competitor_upsert', () => {
  it('id 为 null 时新增：position 接在最大值之后，id 与 created_at 是运行时产物', async () => {
    const created = await demoInvoke<Competitor>('competitor_upsert', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      draft: draft(),
      id: null,
    });

    expect(created.id).toMatch(UUID_V4);
    expect(created.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(created.position).toBe(activeCompetitors().length);
    expect(created.created_at).toMatch(RFC3339);
    expect(created.name).toBe('Rival A');
    // note 与后端同口径：trim 后落库（clean_optional）。
    expect(created.note).toBe('keep me');

    const rows = await demoInvoke<Competitor[]>('competitor_list', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });
    expect(rows).toHaveLength(activeCompetitors().length + 1);
    expect(rows[rows.length - 1].id).toBe(created.id);
  });

  it('带 id 时就地更新：id / position / created_at 都保留', async () => {
    const target = activeCompetitors()[0];

    const updated = await demoInvoke<Competitor>('competitor_upsert', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      draft: draft({ name: 'Rival Renamed', aliases: [], note: null }),
      id: target.id,
    });

    expect(updated.id).toBe(target.id);
    expect(updated.position).toBe(target.position);
    expect(updated.created_at).toBe(target.created_at);
    expect(updated.name).toBe('Rival Renamed');
    expect(updated.note).toBeNull();
    expect(
      await demoInvoke<Competitor[]>('competitor_list', { project_id: SEED_ACTIVE_PROJECT_ID }),
    ).toHaveLength(activeCompetitors().length);
  });

  it('id 不存在 ⇒ competitor/not_found', async () => {
    const cause = await capture(() =>
      demoInvoke('competitor_upsert', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        draft: draft(),
        id: MISSING_ROW_ID,
      }),
    );

    expectCode(cause, 'competitor/not_found');
  });

  it('id 属于别的项目也算 not_found（跨项目改不动）', async () => {
    const foreign = SEED_COMPETITORS.find(
      (row) => row.project_id === SEED_ARCHIVED_PROJECT_ID,
    ) as Competitor;

    const cause = await capture(() =>
      demoInvoke('competitor_upsert', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        draft: draft(),
        id: foreign.id,
      }),
    );

    expectCode(cause, 'competitor/not_found');
  });

  it('项目不存在 ⇒ project/not_found（先校项目，与后端 upsert_competitor 的顺序一致）', async () => {
    const cause = await capture(() =>
      demoInvoke('competitor_upsert', {
        project_id: MISSING_PROJECT_ID,
        draft: draft(),
        id: null,
      }),
    );

    expectCode(cause, 'project/not_found');
  });
});

describe('demo/handlers/relations · competitor_list / delete / reorder', () => {
  it('list 按 position 升序，没有竞品的项目返回空数组而不是报错', async () => {
    const rows = await demoInvoke<Competitor[]>('competitor_list', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });

    expect(rows.map((row) => row.id)).toEqual(SEED_ACTIVE_COMPETITOR_IDS);
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2]);
    expect(await demoInvoke('competitor_list', { project_id: MISSING_PROJECT_ID })).toEqual([]);
  });

  it('delete 摘掉一行，且幂等（删两次都不报错）', async () => {
    const target = SEED_ACTIVE_COMPETITOR_IDS[1];

    await demoInvoke('competitor_delete', { id: target });
    const rows = await demoInvoke<Competitor[]>('competitor_list', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });
    expect(rows.map((row) => row.id)).not.toContain(target);
    expect(rows).toHaveLength(2);

    expect(await capture(() => demoInvoke('competitor_delete', { id: target }))).toBeNull();
    expect(await capture(() => demoInvoke('competitor_delete', { id: MISSING_ROW_ID }))).toBeNull();
  });

  it('reorder 把 position 重写成 0..n，并回整份新顺序', async () => {
    const reversed = [...SEED_ACTIVE_COMPETITOR_IDS].reverse();

    const rows = await demoInvoke<Competitor[]>('competitor_reorder', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: reversed,
    });

    expect(rows.map((row) => row.id)).toEqual(reversed);
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2]);
    // 落库了：再读一次还是新顺序。
    const again = await demoInvoke<Competitor[]>('competitor_list', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });
    expect(again.map((row) => row.id)).toEqual(reversed);
  });

  it('reorder 里混进不属于该项目的 id ⇒ competitor/not_found，且**一条位置都没写**', async () => {
    const foreign = SEED_COMPETITORS.find(
      (row) => row.project_id === SEED_ARCHIVED_PROJECT_ID,
    ) as Competitor;

    const cause = await capture(() =>
      demoInvoke('competitor_reorder', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        ids: [foreign.id, ...SEED_ACTIVE_COMPETITOR_IDS],
      }),
    );

    expectCode(cause, 'competitor/not_found');
    // 全有或全无（真后端是单事务 + 整体回滚）。
    const rows = await demoInvoke<Competitor[]>('competitor_list', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });
    expect(rows.map((row) => row.id)).toEqual(SEED_ACTIVE_COMPETITOR_IDS);
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2]);
  });
});

describe('demo/handlers/relations · asset_add / asset_list / asset_delete', () => {
  it('新增资产：新 id、created_at 是运行时产物、空白的 title/note 归一成 null', async () => {
    const created = await demoInvoke<ProjectAsset>('asset_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'zhihu',
      url: 'https://zhihu.example.com/p/1',
      title: '   ',
      note: ' answer ',
    });

    expect(created.id).toMatch(UUID_V4);
    expect(created.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(created.kind).toBe('zhihu');
    expect(created.url).toBe('https://zhihu.example.com/p/1');
    expect(created.title).toBeNull();
    expect(created.note).toBe('answer');
    expect(created.created_at).toMatch(RFC3339);
  });

  it('项目不存在 ⇒ project/not_found', async () => {
    const cause = await capture(() =>
      demoInvoke('asset_add', {
        project_id: MISSING_PROJECT_ID,
        kind: 'other',
        url: 'https://x.example.com',
        title: null,
        note: null,
      }),
    );

    expectCode(cause, 'project/not_found');
  });

  it('list 按 created_at 升序（种子里那 3 条的顺序就是入库顺序）', async () => {
    const rows = await demoInvoke<ProjectAsset[]>('asset_list', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });
    const seeded = SEED_ASSETS.filter((row) => row.project_id === SEED_ACTIVE_PROJECT_ID);

    expect(rows.map((row) => row.id)).toEqual(seeded.map((row) => row.id));
    const stamps = rows.map((row) => Date.parse(row.created_at));
    expect(stamps).toEqual([...stamps].sort((left, right) => left - right));
    expect(await demoInvoke('asset_list', { project_id: MISSING_PROJECT_ID })).toEqual([]);
  });

  it('delete 摘掉一行且幂等', async () => {
    const target = SEED_ASSETS.filter((row) => row.project_id === SEED_ACTIVE_PROJECT_ID)[0];

    await demoInvoke('asset_delete', { id: target.id });

    const rows = await demoInvoke<ProjectAsset[]>('asset_list', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });
    expect(rows.map((row) => row.id)).not.toContain(target.id);
    expect(await capture(() => demoInvoke('asset_delete', { id: target.id }))).toBeNull();
    expect(await capture(() => demoInvoke('asset_delete', { id: MISSING_ROW_ID }))).toBeNull();
  });
});

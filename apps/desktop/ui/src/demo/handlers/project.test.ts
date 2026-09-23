/**
 * M1 `project_*` 10 条命令的行为测试（Task 12 · 简报 §B-1 / §B-5 / §B-7 / §B-12）。
 *
 * # 分工（别把同一件事钉三遍）
 * - **错误 params 的精确键集** ⇒ `error-contract.test.ts`（对契约 JSON 机械比对）；本文件只点 `code`。
 * - **args 键名漂移** ⇒ `m1-contract.test.ts`（经 `client.*` 具名导出 + 真 demo 分派）。
 * - 本文件管**行为**：过滤 / 排序、六表级联、导入导出的往返一致性、运行时产物的**形状**。
 *
 * # §B-7 确定性口径
 * 运行时新建的对象（新项目 id、`created_at`、`exported_at`）只断言形状：UUID v4 / 合法 RFC3339，
 * **绝不断言具体值**；种子数据仍然是绝对确定的字面量。
 *
 * # 语言约束（门禁 7）
 * 本目录的非注释 CJK 必须为 0 ⇒ 断言里的品牌名一律经 `SEED_*` 常量引用，测试自造的数据一律 ASCII。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type {
  ImportReport,
  Project,
  ProjectDetail,
  ProjectDraft,
  ProjectExport,
} from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import { SEED_ENTITY_CARD_REVISIONS } from '../seed/entity-cards';
import {
  SEED_ACTIVE_PROJECT_ID,
  SEED_ARCHIVED_PROJECT_ID,
  SEED_ASSETS,
  SEED_COMPETITORS,
  SEED_PROJECTS,
} from '../seed/projects';
import { demoContentHash } from './prompt';
import {
  SEED_BASELINE_SET_ID,
  SEED_PILOT_SET_ID,
  SEED_PROMPT_ITEMS,
  SEED_PROMPT_SETS,
} from '../seed/prompt-sets';

/** `crypto.randomUUID()` 的形状（§B-7：只断言形状，不断言值）。 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** `chrono::DateTime<Utc>` 的 RFC3339 存库口径（`Date.toISOString()` 也落在这个形状里）。 */
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** 一个库里一定不存在的 project id（uuid v4 形状，避免撞上守卫之外的分支）。 */
const MISSING_PROJECT_ID = '00000000-0000-4000-8000-0000000000aa';
/**
 * 导出格式版本。真值源 `apps/desktop/src-tauri/src/services/project_transfer.rs:19`
 * （跨语言无法 import ⇒ 这里独立写死一份，漂了本文件会红）。
 */
const EXPORT_FORMAT_VERSION = 'geo-project-export-v1';
/** CSV 的 BOM。写成转义序列，源码里不出现非 ASCII 字面量（门禁 7）。 */
const BOM = '\uFEFF';

function makeDraft(overrides: Partial<ProjectDraft> = {}): ProjectDraft {
  return {
    brand_name: 'Demo Brand',
    aliases: ['Demo'],
    name: 'Demo Brand GEO',
    website: 'https://demo-brand.example.com',
    core_pages: ['https://demo-brand.example.com/about'],
    products: [{ name: 'Demo Product', params: ['flow 100'], note: null }],
    service_scope: null,
    region: 'Jiangsu',
    language: 'zh_cn',
    industry: 'b2b_manufacturing',
    industry_label: null,
    tags: ['demo'],
    competitors: [{ name: 'Rival A', aliases: [], website: null, note: null }],
    ...overrides,
  };
}

/** 把「同步 throw」与「rejected promise」收成同一个 catch（与 `backend.test.ts` 同形）。 */
async function capture(thunk: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(thunk)
    .then(
      () => null,
      (cause: unknown) => cause,
    );
}

/** 断言一个运行时产物的时间戳：合法 RFC3339、可解析、非空（§B-7：不断言具体值）。 */
function expectTimestamp(value: string): void {
  expect(value).toMatch(RFC3339);
  expect(Number.isFinite(Date.parse(value))).toBe(true);
}

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/project · project_create', () => {
  it('建项后列表里出现该项目，id 与时间戳是运行时产物（形状对、值不钉）', async () => {
    const created = await demoInvoke<Project>('project_create', { draft: makeDraft() });

    expect(created.id).toMatch(UUID_V4);
    expect(created.status).toBe('active');
    expect(created.archived_at).toBeNull();
    expect(created.brand_name).toBe('Demo Brand');
    expect(created.name).toBe('Demo Brand GEO');
    expectTimestamp(created.created_at);
    expectTimestamp(created.updated_at);

    const listed = await demoInvoke<Project[]>('project_list', { filter: {} });
    expect(listed.map((project) => project.id)).toContain(created.id);
    // 新建的项目 updated_at 是「现在」，种子是 2026-09 ⇒ 排序上必须排在最前（updated_at DESC）。
    expect(listed[0].id).toBe(created.id);
  });

  it('建项会把草稿里的竞品与自有页面落成资产，但不造实体卡（规则 9：不移植 fields_from_draft）', async () => {
    const created = await demoInvoke<Project>('project_create', {
      draft: makeDraft({ core_pages: ['https://demo-brand.example.com/about', '   '] }),
    });

    const competitors = await demoInvoke<Project[]>('competitor_list', {
      project_id: created.id,
    }) as unknown as { name: string; position: number }[];
    expect(competitors).toHaveLength(1);
    expect(competitors[0].name).toBe('Rival A');
    expect(competitors[0].position).toBe(0);

    const assets = (await demoInvoke('asset_list', { project_id: created.id })) as {
      kind: string;
      url: string;
    }[];
    // 官网首页 1 条 + 非空 core_pages 1 条（空白那条被丢掉），都是 owned_page。
    expect(assets).toHaveLength(2);
    expect(assets.every((asset) => asset.kind === 'owned_page')).toBe(true);
    // ⚠ 刻意比**集合**不比顺序：两条资产的 created_at 是同一瞬间，仓储的
    // `ORDER BY created_at ASC, id ASC` 只能用 id 打平手，而 id 是运行时 uuid
    // ⇒ 顺序在真后端同样不受契约保证（§B-7：运行时产物只断言形状）。
    expect(assets.map((asset) => asset.url).sort()).toEqual(
      ['https://demo-brand.example.com', 'https://demo-brand.example.com/about'].sort(),
    );

    expect(await demoInvoke('entity_card_get', { project_id: created.id })).toBeNull();
  });

  it('两次建项拿到两个不同的 id（"两次创建同一个 id" 是行为错误，§B-7）', async () => {
    const first = await demoInvoke<Project>('project_create', { draft: makeDraft() });
    const second = await demoInvoke<Project>('project_create', { draft: makeDraft() });

    expect(first.id).not.toBe(second.id);
  });

  it('name 留空时回落成品牌名（与后端 build 的口径一致）', async () => {
    const created = await demoInvoke<Project>('project_create', {
      draft: makeDraft({ name: '   ' }),
    });

    expect(created.name).toBe('Demo Brand');
  });
});

describe('demo/handlers/project · project_list', () => {
  it('默认只看未归档，include_archived 才带出归档项目，且按 updated_at 倒序', async () => {
    const active = await demoInvoke<Project[]>('project_list', { filter: {} });
    expect(active.map((project) => project.id)).toEqual([SEED_ACTIVE_PROJECT_ID]);

    const all = await demoInvoke<Project[]>('project_list', {
      filter: { include_archived: true },
    });
    expect(all).toHaveLength(SEED_PROJECTS.length);
    // 种子里归档项目的 updated_at 更晚 ⇒ 倒序排在前（真值源：repo/project.rs 的 ORDER BY）。
    expect(all[0].id).toBe(SEED_ARCHIVED_PROJECT_ID);
    const stamps = all.map((project) => Date.parse(project.updated_at));
    expect(stamps).toEqual([...stamps].sort((left, right) => right - left));
  });

  it('query 同时模糊匹配项目名与品牌名，且 ASCII 大小写不敏感', async () => {
    await demoInvoke<Project>('project_create', { draft: makeDraft() });

    const byName = await demoInvoke<Project[]>('project_list', { filter: { query: 'brand geo' } });
    expect(byName.map((project) => project.name)).toEqual(['Demo Brand GEO']);

    const byBrand = await demoInvoke<Project[]>('project_list', { filter: { query: 'DEMO BRAND' } });
    expect(byBrand.map((project) => project.name)).toEqual(['Demo Brand GEO']);

    const none = await demoInvoke<Project[]>('project_list', { filter: { query: 'zzz-nope' } });
    expect(none).toEqual([]);
  });

  it('tags 是 AND 语义：需同时含全部给定标签', async () => {
    const one = await demoInvoke<Project[]>('project_list', {
      filter: { include_archived: true, tags: ['SaaS'] },
    });
    expect(one.map((project) => project.id)).toEqual([SEED_ARCHIVED_PROJECT_ID]);

    const two = await demoInvoke<Project[]>('project_list', {
      filter: { include_archived: true, tags: ['SaaS', 'no-such-tag'] },
    });
    expect(two).toEqual([]);
  });

  it('filter 整个缺省时也不炸（args 里没有 filter 键）', async () => {
    const rows = await demoInvoke<Project[]>('project_list', {});

    expect(rows.map((project) => project.id)).toEqual([SEED_ACTIVE_PROJECT_ID]);
  });
});

describe('demo/handlers/project · project_get', () => {
  it('活跃项目：实体卡、竞品、资产与题库数一次给全', async () => {
    const detail = await demoInvoke<ProjectDetail>('project_get', { id: SEED_ACTIVE_PROJECT_ID });

    expect(detail.project.id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(detail.entity_card?.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(detail.competitors).toHaveLength(
      SEED_COMPETITORS.filter((item) => item.project_id === SEED_ACTIVE_PROJECT_ID).length,
    );
    expect(detail.assets).toHaveLength(
      SEED_ASSETS.filter((item) => item.project_id === SEED_ACTIVE_PROJECT_ID).length,
    );
    // 题库只**读**（§B-12）：真值源是 db.promptSets，经 helper 过滤。
    expect(detail.prompt_set_count).toBe(
      SEED_PROMPT_SETS.filter((item) => item.project_id === SEED_ACTIVE_PROJECT_ID).length,
    );
  });

  it('归档项目：没有实体卡也没有题库（空状态走得通）', async () => {
    const detail = await demoInvoke<ProjectDetail>('project_get', { id: SEED_ARCHIVED_PROJECT_ID });

    expect(detail.entity_card).toBeNull();
    expect(detail.prompt_set_count).toBe(0);
    expect(detail.competitors).toHaveLength(1);
  });

  it('项目不存在 ⇒ project/not_found', async () => {
    const cause = await capture(() => demoInvoke('project_get', { id: MISSING_PROJECT_ID }));

    expect(isIpcErrorPayload(cause)).toBe(true);
    if (!isIpcErrorPayload(cause)) throw new Error('unreachable');
    expect(cause.code).toBe('project/not_found');
  });
});

describe('demo/handlers/project · project_update / project_archive', () => {
  it('更新只改可编辑字段：id / status / created_at 保持，updated_at 前推', async () => {
    const before = await demoInvoke<ProjectDetail>('project_get', { id: SEED_ACTIVE_PROJECT_ID });
    const updated = await demoInvoke<Project>('project_update', {
      project: { ...before.project, tags: ['demo-tag'], region: 'Shanghai' },
    });

    expect(updated.id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(updated.tags).toEqual(['demo-tag']);
    expect(updated.region).toBe('Shanghai');
    expect(updated.status).toBe('active');
    expect(updated.created_at).toBe(before.project.created_at);
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(before.project.updated_at),
    );

    const listed = await demoInvoke<Project[]>('project_list', { filter: { tags: ['demo-tag'] } });
    expect(listed.map((project) => project.id)).toEqual([SEED_ACTIVE_PROJECT_ID]);
  });

  it('更新不会把归档状态改掉（status / archived_at 以库里那行为准）', async () => {
    const detail = await demoInvoke<ProjectDetail>('project_get', { id: SEED_ARCHIVED_PROJECT_ID });

    const updated = await demoInvoke<Project>('project_update', {
      project: { ...detail.project, status: 'active', archived_at: null, tags: ['keep'] },
    });

    expect(updated.status).toBe('archived');
    expect(updated.archived_at).toBe(detail.project.archived_at);
    expect(updated.tags).toEqual(['keep']);
  });

  it('项目不存在 ⇒ project/not_found（update 与 archive 同口径）', async () => {
    const detail = await demoInvoke<ProjectDetail>('project_get', { id: SEED_ACTIVE_PROJECT_ID });

    const updateCause = await capture(() =>
      demoInvoke('project_update', { project: { ...detail.project, id: MISSING_PROJECT_ID } }),
    );
    const archiveCause = await capture(() =>
      demoInvoke('project_archive', { id: MISSING_PROJECT_ID, archived: true }),
    );

    expect(isIpcErrorPayload(updateCause) && updateCause.code).toBe('project/not_found');
    expect(isIpcErrorPayload(archiveCause) && archiveCause.code).toBe('project/not_found');
  });

  it('归档写入 archived_at，取消归档清空它，两者都回整行项目', async () => {
    const archived = await demoInvoke<Project>('project_archive', {
      id: SEED_ACTIVE_PROJECT_ID,
      archived: true,
    });
    expect(archived.status).toBe('archived');
    expect(archived.archived_at).not.toBeNull();
    expectTimestamp(archived.archived_at ?? '');
    // 归档后默认列表里就不该再出现。
    expect(await demoInvoke<Project[]>('project_list', { filter: {} })).toEqual([]);

    const restored = await demoInvoke<Project>('project_archive', {
      id: SEED_ACTIVE_PROJECT_ID,
      archived: false,
    });
    expect(restored.status).toBe('active');
    expect(restored.archived_at).toBeNull();
    expect((await demoInvoke<Project[]>('project_list', { filter: {} })).map((p) => p.id)).toEqual([
      SEED_ACTIVE_PROJECT_ID,
    ]);
  });
});

describe('demo/handlers/project · project_delete（六表级联，§B-12）', () => {
  it('删项目会清掉竞品/资产/实体卡/修订/题库两份视图，孤儿行为 0', async () => {
    await demoInvoke('project_delete', { id: SEED_ACTIVE_PROJECT_ID });
    const db = getDemoDb();

    expect(db.projects.map((project) => project.id)).toEqual([SEED_ARCHIVED_PROJECT_ID]);
    expect(db.competitors.filter((row) => row.project_id === SEED_ACTIVE_PROJECT_ID)).toHaveLength(0);
    expect(db.assets.filter((row) => row.project_id === SEED_ACTIVE_PROJECT_ID)).toHaveLength(0);
    expect(db.entityCards.filter((row) => row.project_id === SEED_ACTIVE_PROJECT_ID)).toHaveLength(0);
    expect(db.revisions.filter((row) => row.project_id === SEED_ACTIVE_PROJECT_ID)).toHaveLength(0);
    expect(db.promptSets.filter((row) => row.project_id === SEED_ACTIVE_PROJECT_ID)).toHaveLength(0);
    // 题库的**归一化视图**也必须跟着清：留下 set_id 指向不存在题库的行就是孤儿（§B-12）。
    expect(
      db.promptItems.filter((item) => !db.promptSets.some((set) => set.id === item.set_id)),
    ).toHaveLength(0);
    // 另一个项目的数据不受牵连。
    expect(db.competitors.filter((row) => row.project_id === SEED_ARCHIVED_PROJECT_ID)).toHaveLength(1);
    expect(SEED_ENTITY_CARD_REVISIONS).toHaveLength(1);
  });

  it('删除是幂等的：删两次都不报错（与 repo/project.rs 的 delete 同口径）', async () => {
    await demoInvoke('project_delete', { id: SEED_ARCHIVED_PROJECT_ID });

    expect(await capture(() => demoInvoke('project_delete', { id: SEED_ARCHIVED_PROJECT_ID }))).toBe(
      null,
    );
    expect(await demoInvoke<Project[]>('project_list', { filter: { include_archived: true } })).toHaveLength(1);
  });
});

describe('demo/handlers/project · project_export / project_import', () => {
  it('导出带 format_version 与合法的 exported_at，六类数据一起走', async () => {
    const exported = await demoInvoke<ProjectExport>('project_export', {
      id: SEED_ACTIVE_PROJECT_ID,
    });

    expect(exported.format_version).toBe(EXPORT_FORMAT_VERSION);
    // A-5：exported_at 是**运行时产物**，只断言合法 RFC3339 + 非空，不断言具体值。
    expect(exported.exported_at).not.toBe('');
    expectTimestamp(exported.exported_at);
    expect(exported.project.id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(exported.entity_card?.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(exported.revisions).toHaveLength(SEED_ENTITY_CARD_REVISIONS.length);
    expect(exported.competitors).toHaveLength(3);
    expect(exported.assets).toHaveLength(3);
    expect(exported.prompt_sets).toHaveLength(SEED_PROMPT_SETS.length);
    // 顺序照仓储真值源 `repo/prompt_set.rs` 的 `ORDER BY version DESC, created_at DESC`：
    // 两份种子题库 version 都是 1 ⇒ created_at 更晚的 pilot 排在前。
    expect(exported.prompt_sets.map((set) => set.id)).toEqual([
      SEED_PILOT_SET_ID,
      SEED_BASELINE_SET_ID,
    ]);
    // 题库的内嵌 items 走**归一化真值**（db.promptItems），不是内嵌副本（§B-12）。
    expect(exported.prompt_sets.map((set) => set.items.length)).toEqual([
      SEED_PROMPT_ITEMS.filter((item) => item.set_id === SEED_PILOT_SET_ID).length,
      SEED_PROMPT_ITEMS.filter((item) => item.set_id === SEED_BASELINE_SET_ID).length,
    ]);
  });

  it('导出不存在的项目 ⇒ project/not_found', async () => {
    const cause = await capture(() => demoInvoke('project_export', { id: MISSING_PROJECT_ID }));

    expect(isIpcErrorPayload(cause) && cause.code).toBe('project/not_found');
  });

  it('导出再导入：counts 恰好 7 个键、项目拿到新 id、绝不覆盖已有项目', async () => {
    const exported = await demoInvoke<ProjectExport>('project_export', {
      id: SEED_ACTIVE_PROJECT_ID,
    });
    const before = getDemoDb().projects.length;

    const report = await demoInvoke<ImportReport>('project_import', {
      payload: JSON.stringify(exported),
    });

    // A-5：counts 恰好 7 个键（多一个少一个都是违约）。
    expect(Object.keys(report.counts).sort()).toEqual([
      'assets',
      'competitors',
      'entity_cards',
      'projects',
      'prompt_items',
      'prompt_sets',
      'revisions',
    ]);
    expect(report.counts.projects).toBe(1);
    expect(report.counts.competitors).toBe(exported.competitors.length);
    expect(report.counts.assets).toBe(exported.assets.length);
    expect(report.counts.entity_cards).toBe(1);
    expect(report.counts.revisions).toBe(exported.revisions.length);
    expect(report.counts.prompt_sets).toBe(exported.prompt_sets.length);
    expect(report.counts.prompt_items).toBe(SEED_PROMPT_ITEMS.length);

    // 绝不覆盖：新 id，库里多一行，品牌名同名。
    expect(report.project_id).toMatch(UUID_V4);
    expect(report.project_id).not.toBe(SEED_ACTIVE_PROJECT_ID);
    const db = getDemoDb();
    expect(db.projects).toHaveLength(before + 1);
    const imported = db.projects.find((project) => project.id === report.project_id);
    expect(imported?.brand_name).toBe(exported.project.brand_name);
    expect(imported?.id).toBe(report.project_id);
    // 子表全部改挂到新项目上，且都是新 id。
    expect(db.entityCards.filter((card) => card.project_id === report.project_id)).toHaveLength(1);
    expect(db.revisions.filter((row) => row.project_id === report.project_id)).toHaveLength(
      exported.revisions.length,
    );
    expect(
      db.revisions
        .filter((row) => row.project_id === report.project_id)
        .every((row) => !exported.revisions.some((old) => old.id === row.id)),
    ).toBe(true);
    expect(db.promptSets.filter((set) => set.project_id === report.project_id)).toHaveLength(
      exported.prompt_sets.length,
    );
    // 两份视图都必须落：set 级与 item 级条数一致（§B-12 的坑）。
    const importedSets = db.promptSets.filter((set) => set.project_id === report.project_id);
    const importedItems = db.promptItems.filter((item) =>
      importedSets.some((set) => set.id === item.set_id),
    );
    expect(importedItems).toHaveLength(SEED_PROMPT_ITEMS.length);
    expect(importedSets.reduce((sum, set) => sum + set.items.length, 0)).toBe(
      importedItems.length,
    );
    expect(importedItems.every((item) => item.id !== '' && UUID_V4.test(item.id))).toBe(true);
  });

  it('同一份导出连导两次得到两个副本（导入绝不覆盖）', async () => {
    const exported = await demoInvoke<ProjectExport>('project_export', {
      id: SEED_ACTIVE_PROJECT_ID,
    });
    const payload = JSON.stringify(exported);

    const first = await demoInvoke<ImportReport>('project_import', { payload });
    const second = await demoInvoke<ImportReport>('project_import', { payload });

    expect(first.project_id).not.toBe(second.project_id);
    expect(getDemoDb().projects).toHaveLength(SEED_PROJECTS.length + 2);
  });

  /**
   * #21（台账 #39）：导入的题库必须走**唯一**的 item 级写入口（`handlers/prompt.ts` 的
   * `writePromptItems`），不能再自己 `structuredClone` 一份塞进内嵌视图。
   *
   * 原来那份克隆让「两份独立副本」可以并存：内嵌视图与归一化清单各是一批对象，
   * 于是「单一真值」只在 handler 内部成立，任何后续写入都可能只改到一边。
   * 写入口的核心不变量恰恰是**两份视图存同一批对象引用**（`prompt.ts:105-107`）⇒ 这里按引用判等。
   *
   * ⚠ 顺带钉住两条边界，免得「收写路径」被误读成「什么都重算」：
   * - `content_hash` 由写入口按 demo 的**占位**算法定稿（真值源 `transfer:182-183` 的
   *   `reindex()` + `refresh()` 同样重算它，所以这一侧是**向后端靠拢**，不是新偏离）；
   * - `sample_size_grade` 仍然**逐条继承载荷里的静态值**（AGENTS 规则 9 / 异常表 E-7：
   *   分级阈值是领域算法，demo 不算）。
   */
  it('导入走唯一写入口：两份视图是同一批对象引用，content_hash 定稿、分级仍继承载荷', async () => {
    const exported = await demoInvoke<ProjectExport>('project_export', {
      id: SEED_ACTIVE_PROJECT_ID,
    });

    const report = await demoInvoke<ImportReport>('project_import', {
      payload: JSON.stringify(exported),
    });

    const db = getDemoDb();
    const importedSets = db.promptSets.filter((set) => set.project_id === report.project_id);
    expect(importedSets.length).toBeGreaterThan(0);

    for (const set of importedSets) {
      const normalized = db.promptItems.filter((item) => item.set_id === set.id);

      expect(normalized, set.id).toHaveLength(set.items.length);
      expect(normalized.length, set.id).toBeGreaterThan(0);
      // 单一写入口的核心不变量：按**引用**判等（克隆出来的两份内容相同但引用不同 ⇒ 这条会红）
      expect(
        set.items.every((item, index) => item === normalized[index]),
        `${set.id} 的两份视图不是同一批对象引用`,
      ).toBe(true);
      // position 0 基连续（真值源 transfer:182 的 reindex()）
      expect(set.items.map((item) => item.position), set.id).toEqual(
        set.items.map((_, index) => index),
      );
      // content_hash 由写入口定稿（引生产函数，不在测试里抄一遍算法）
      expect(set.content_hash, set.id).toBe(demoContentHash(set.items));
    }

    // 规则 9 / E-7 不变：分级是静态演示值，导入**不重算**
    expect(importedSets.map((set) => set.sample_size_grade)).toEqual(
      exported.prompt_sets.map((set) => set.sample_size_grade),
    );
  });

  it('format_version 不匹配 ⇒ validation/failed（field=format_version）', async () => {
    const exported = await demoInvoke<ProjectExport>('project_export', {
      id: SEED_ACTIVE_PROJECT_ID,
    });

    const cause = await capture(() =>
      demoInvoke('project_import', {
        payload: JSON.stringify({ ...exported, format_version: 'geo-project-export-v9' }),
      }),
    );

    expect(isIpcErrorPayload(cause)).toBe(true);
    if (!isIpcErrorPayload(cause)) throw new Error('unreachable');
    expect(cause.code).toBe('validation/failed');
    expect(cause.params).toEqual({
      field: 'format_version',
      reason: 'invalid_format',
      value: 'geo-project-export-v9',
    });
    // 失败的导入不许留下半截项目。
    expect(getDemoDb().projects).toHaveLength(SEED_PROJECTS.length);
  });

  it('payload 不是合法 JSON ⇒ validation/failed（field=payload, reason=parse_failed）', async () => {
    const cause = await capture(() => demoInvoke('project_import', { payload: '{not json' }));

    expect(isIpcErrorPayload(cause)).toBe(true);
    if (!isIpcErrorPayload(cause)) throw new Error('unreachable');
    expect(cause.code).toBe('validation/failed');
    expect(cause.params?.field).toBe('payload');
    expect(cause.params?.reason).toBe('parse_failed');
    expect(cause.params?.value).not.toBe('');
    expect(getDemoDb().projects).toHaveLength(SEED_PROJECTS.length);
  });
});

describe('demo/handlers/project · CSV 导出（A-8：消费共享表头常量）', () => {
  it('竞品 CSV：表头逐字等于共享常量、不带 BOM、aliases 用分号连接、含逗号的值加引号', async () => {
    await demoInvoke('competitor_upsert', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      draft: { name: 'Rival, Inc', aliases: ['R1', 'R2'], website: null, note: null },
      id: null,
    });

    const csv = await demoInvoke<string>('project_export_competitors_csv', {
      id: SEED_ACTIVE_PROJECT_ID,
    });

    expect(csv.startsWith(BOM)).toBe(false);
    expect(csv.endsWith('\n')).toBe(true);
    const lines = csv.slice(0, -1).split('\n');
    expect(lines[0]).toBe('name,aliases,website,note,position');
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe('"Rival, Inc",R1;R2,,,3');
  });

  it('资产 CSV：表头逐字等于共享常量、kind 是 snake_case、不带 BOM', async () => {
    const csv = await demoInvoke<string>('project_export_assets_csv', {
      id: SEED_ACTIVE_PROJECT_ID,
    });

    expect(csv.startsWith(BOM)).toBe(false);
    const lines = csv.slice(0, -1).split('\n');
    expect(lines[0]).toBe('kind,url,title,note');
    expect(lines).toHaveLength(4);
    expect(lines[1].startsWith('owned_page,https://')).toBe(true);
  });

  it('项目不存在 ⇒ project/not_found（两条 CSV 导出都先取 detail）', async () => {
    const competitors = await capture(() =>
      demoInvoke('project_export_competitors_csv', { id: MISSING_PROJECT_ID }),
    );
    const assets = await capture(() =>
      demoInvoke('project_export_assets_csv', { id: MISSING_PROJECT_ID }),
    );

    expect(isIpcErrorPayload(competitors) && competitors.code).toBe('project/not_found');
    expect(isIpcErrorPayload(assets) && assets.code).toBe('project/not_found');
  });
});

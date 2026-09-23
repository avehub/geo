/**
 * M1 `entity_card_*` 4 条命令的行为测试（Task 12 · 简报 §B-2 / §B-4 / §B-6）。
 *
 * # 三件本轮必须成立的事
 * ① **A-4 / A-6 的真值表**：`domain` 三种非法输入、`field_path` 四种非法输入，
 *    code 与 params 的**精确键集**都要对上（`error-contract.test.ts` 再对契约 JSON 机械比一遍）；
 * ② **修订留痕在 demo 里成立**（§B-6）：每次改字段都追加一条 `EntityCardRevision`，
 *    `old_value` 是改之前的值（第一次改种子字段时就是种子里那个值），`entity_card_revisions` 读得回来；
 * ③ **规则 9 / §B-2**：`completeness` 是种子里的**静态演示值**，改字段之后**不重算**。
 *
 * # 语言约束（门禁 7）
 * 本目录非注释 CJK 必须为 0 ⇒ Rust 契约测试用的中文非法域名（`这不是域名`）在这里换成
 * **同为「host 里没有点号」的 ASCII 输入** `localhost`：两者在 `normalize_url` 里走的是同一条
 * 分支（`crates/geo-domain/src/asset.rs:117`），键集与 reason 完全一致。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { EntityCard, EntityCardRevision } from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import { DEFAULT_DEMO_LATENCY_MS, setDemoLatency } from '../latency';
import { SEED_ENTITY_CARD_REVISIONS, SEED_ENTITY_CARDS } from '../seed/entity-cards';
import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID } from '../seed/projects';
import { AUTOBUILD_EXTRA_MS, ENTITY_ROOT_FIELDS } from './entity-card';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const MISSING_PROJECT_ID = '00000000-0000-4000-8000-0000000000aa';
const VALID_DOMAIN = 'https://demo-brand.example.com';

/** 把「同步 throw」与「rejected promise」收成同一个 catch。 */
async function capture(thunk: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(thunk)
    .then(
      () => null,
      (cause: unknown) => cause,
    );
}

/** 断言 params 的**精确键集**（A-11 第 2 层：以 Rust 发射点为准，多一个少一个都算违约）。 */
function expectParams(cause: unknown, code: string, params: Record<string, string>): void {
  expect(isIpcErrorPayload(cause)).toBe(true);
  if (!isIpcErrorPayload(cause)) throw new Error('unreachable');
  expect(cause.code).toBe(code);
  expect(cause.params).toEqual(params);
  expect(Object.keys(cause.params ?? {}).sort()).toEqual(Object.keys(params).sort());
}

afterEach(() => {
  setDemoLatency(null);
  resetDemoDb();
});

describe('demo/handlers/entity-card · entity_card_autobuild 的 domain 契约（A-4 真值表）', () => {
  it('空白域名 ⇒ validation/failed，params 只有 field 与 reason 两个键', async () => {
    const cause = await capture(() =>
      demoInvoke('entity_card_autobuild', { project_id: SEED_ACTIVE_PROJECT_ID, domain: '   ' }),
    );

    expectParams(cause, 'validation/failed', { field: 'domain', reason: 'required' });
  });

  it('不是域名 ⇒ validation/failed，params 是 field/reason/value 三键，value 回显输入', async () => {
    const cause = await capture(() =>
      demoInvoke('entity_card_autobuild', { project_id: SEED_ACTIVE_PROJECT_ID, domain: 'localhost' }),
    );

    expectParams(cause, 'validation/failed', {
      field: 'domain',
      reason: 'invalid_url',
      value: 'localhost',
    });
  });

  it('协议不允许 ⇒ validation/failed，value 只是协议名（不是整串输入）', async () => {
    const cause = await capture(() =>
      demoInvoke('entity_card_autobuild', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        domain: 'ftp://hongyu-pump.example',
      }),
    );

    expectParams(cause, 'validation/failed', {
      field: 'domain',
      reason: 'not_allowed',
      value: 'ftp',
    });
  });

  it('项目校验先于域名校验（与 Rust autobuild 的顺序一致：先 get 项目再解析 origin）', async () => {
    const cause = await capture(() =>
      demoInvoke('entity_card_autobuild', { project_id: MISSING_PROJECT_ID, domain: '   ' }),
    );

    expectParams(cause, 'project/not_found', { kind: 'project', id: MISSING_PROJECT_ID });
  });
});

describe('demo/handlers/entity-card · entity_card_autobuild 的正常路径', () => {
  it('没有卡的项目：装上种子那张预置卡（不抓网页、不调模型），并写进库', async () => {
    expect(await demoInvoke('entity_card_get', { project_id: SEED_ARCHIVED_PROJECT_ID })).toBeNull();

    const card = await demoInvoke<EntityCard>('entity_card_autobuild', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
      domain: VALID_DOMAIN,
    });

    expect(card.project_id).toBe(SEED_ARCHIVED_PROJECT_ID);
    // demo 不抓网页也不调模型（规则 9）⇒ source 里不许谎报 provider/model/爬到的页面。
    expect(card.source).toEqual({
      crawled_pages: [],
      llm_provider: null,
      llm_model: null,
      generated_at: null,
    });
    // §B-2：completeness 是种子里的静态演示值，不是算出来的。
    expect(card.completeness).toBe(SEED_ENTITY_CARDS[0].completeness);
    expect(card.fields.standard_name).toBe(SEED_ENTITY_CARDS[0].fields.standard_name);
    expect(card.created_at).toMatch(RFC3339);

    const stored = await demoInvoke<EntityCard | null>('entity_card_get', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
    });
    expect(stored?.project_id).toBe(SEED_ARCHIVED_PROJECT_ID);
    expect(getDemoDb().entityCards).toHaveLength(SEED_ENTITY_CARDS.length + 1);
  });

  it('已有卡的项目：字段、状态与静态完整率原样保留，只把 updated_at 前推', async () => {
    const before = await demoInvoke<EntityCard | null>('entity_card_get', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });

    const after = await demoInvoke<EntityCard>('entity_card_autobuild', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      domain: VALID_DOMAIN,
    });

    expect(after.fields).toEqual(before?.fields);
    expect(after.field_status).toEqual(before?.field_status);
    expect(after.completeness).toBe(before?.completeness);
    expect(after.source).toEqual(before?.source);
    expect(Date.parse(after.updated_at)).toBeGreaterThanOrEqual(Date.parse(before?.updated_at ?? ''));
  });

  it('延迟口径（B-4）：额外 680ms + demoInvoke 的 120ms = 浏览器里约 800ms', async () => {
    expect(AUTOBUILD_EXTRA_MS).toBe(680);
    expect(DEFAULT_DEMO_LATENCY_MS + AUTOBUILD_EXTRA_MS).toBe(800);

    // 非空洞证明：显式覆盖成 40ms 后，两层延迟都真的被 await 了（>= 80ms）。
    setDemoLatency(40);
    const startedAt = performance.now();
    await demoInvoke('entity_card_autobuild', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      domain: VALID_DOMAIN,
    });
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(75);
  });
});

describe('demo/handlers/entity-card · entity_card_get / entity_card_revisions', () => {
  it('get 返回种子卡；没有卡时是 null 而不是报错（Option 语义）', async () => {
    const card = await demoInvoke<EntityCard | null>('entity_card_get', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });
    expect(card?.fields.price_range).toBe(SEED_ENTITY_CARDS[0].fields.price_range);

    expect(await demoInvoke('entity_card_get', { project_id: SEED_ARCHIVED_PROJECT_ID })).toBeNull();
    expect(await demoInvoke('entity_card_get', { project_id: MISSING_PROJECT_ID })).toBeNull();
  });

  it('revisions 首屏就是种子里那一条；没有卡的项目是空数组', async () => {
    const seeded = await demoInvoke<EntityCardRevision[]>('entity_card_revisions', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });
    expect(seeded).toHaveLength(SEED_ENTITY_CARD_REVISIONS.length);
    expect(seeded[0].field_path).toBe('price_range');

    expect(
      await demoInvoke<EntityCardRevision[]>('entity_card_revisions', {
        project_id: SEED_ARCHIVED_PROJECT_ID,
      }),
    ).toEqual([]);
  });
});

describe('demo/handlers/entity-card · entity_card_update_field 的 field_path 契约（A-6 真值表）', () => {
  const cases: [string, Record<string, string>][] = [
    ['   ', { field: 'field_path', reason: 'required' }],
    ['', { field: 'field_path', reason: 'required' }],
    ['products[x].name', { field: 'field_path', reason: 'invalid_format', value: 'x' }],
    ['[0].name', { field: 'field_path', reason: 'invalid_format', value: '[0].name' }],
    ['nope', { field: 'field_path', reason: 'unknown_field', value: 'nope' }],
    ['nope.deep[0]', { field: 'field_path', reason: 'unknown_field', value: 'nope' }],
    /**
     * #30① · **退化路径**：整条 path 一个段都解析不出来 ⇒ 后端在 `entity_card.rs:426-427`
     * 发 `required`，而且是**2 键**（没有 `value`）。demo 原先在这里发 `unknown_field` + `value:''`
     * （`"..."`）或 `invalid_format` + `value:path`（`"[]"`）——**3 键**，与真值源不同构，
     * 而 `params` 的键集是会渲染到界面上的（多一个 `value` 就多一段括号文案）。
     */
    ['...', { field: 'field_path', reason: 'required' }],
    ['..', { field: 'field_path', reason: 'required' }],
    ['[]', { field: 'field_path', reason: 'required' }],
    ['.[].[]', { field: 'field_path', reason: 'required' }],
    // ⚠ 不是退化路径：`' . . '` trim 成 `'. .'`，中间那段是**一个空格**，而后端只跳过
    // `key.is_empty()`（`entity_card.rs:410`），空格不是空 ⇒ 它是一个 Key，于是走 `unknown_field`。
    [' . . ', { field: 'field_path', reason: 'unknown_field', value: ' ' }],
    // 首段是 Index（不是 Key）⇒ `invalid_format` + `value` = 整个 path（`entity_card.rs:429-431`）。
    ['[0]', { field: 'field_path', reason: 'invalid_format', value: '[0]' }],
    ['[0].name', { field: 'field_path', reason: 'invalid_format', value: '[0].name' }],
    // 下标非数字 ⇒ `invalid_format` + `value` = 那个 chunk（`entity_card.rs:419-421`）。
    ['products[-1].name', { field: 'field_path', reason: 'invalid_format', value: '-1' }],
  ];

  for (const [path, params] of cases) {
    it(`非法路径 ${JSON.stringify(path)} ⇒ validation/failed（精确键集）`, async () => {
      const cause = await capture(() =>
        demoInvoke('entity_card_update_field', {
          project_id: SEED_ACTIVE_PROJECT_ID,
          path,
          value: 'x',
          status: 'official',
          note: null,
        }),
      );

      expectParams(cause, 'validation/failed', params);
      // 失败的编辑不许留痕。
      const rows = await demoInvoke<EntityCardRevision[]>('entity_card_revisions', {
        project_id: SEED_ACTIVE_PROJECT_ID,
      });
      expect(rows).toHaveLength(SEED_ENTITY_CARD_REVISIONS.length);
    });
  }

  it('表外的路径一律放行（B-2③）：带下标的嵌套路径不报错、照样留痕', async () => {
    const revision = await demoInvoke<EntityCardRevision>('entity_card_update_field', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      path: 'products[0].name',
      value: 'Demo Product',
      status: 'pending',
      note: null,
    });

    expect(revision.field_path).toBe('products[0].name');
    expect(revision.id).toMatch(UUID_V4);
  });

  it('没有实体卡 ⇒ entity_card/not_found，params.id 传的是 project_id（契约 note 明写）', async () => {
    const cause = await capture(() =>
      demoInvoke('entity_card_update_field', {
        project_id: SEED_ARCHIVED_PROJECT_ID,
        path: 'price_range',
        value: 'x',
        status: 'official',
        note: null,
      }),
    );

    expectParams(cause, 'entity_card/not_found', {
      kind: 'entity_card',
      id: SEED_ARCHIVED_PROJECT_ID,
    });
  });

  it('合法根字段清单是 Rust ALL_FIELDS 的镜像，且与 EntityFields 的键逐字相等', () => {
    expect(ENTITY_ROOT_FIELDS).toHaveLength(11);
    expect([...ENTITY_ROOT_FIELDS].sort()).toEqual(Object.keys(SEED_ENTITY_CARDS[0].fields).sort());
  });
});

describe('demo/handlers/entity-card · entity_card_update_field 的留痕（B-6）', () => {
  it('返回的是新那条 revision（不是整张卡），old_value 是改之前的种子值', async () => {
    const seededValue = SEED_ENTITY_CARDS[0].fields.price_range;

    const revision = await demoInvoke<EntityCardRevision>('entity_card_update_field', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      path: 'price_range',
      value: 'POA',
      status: 'official',
      note: '  confirmed by marketing  ',
    });

    expect(revision.id).toMatch(UUID_V4);
    expect(revision.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
    expect(revision.field_path).toBe('price_range');
    expect(revision.old_value).toBe(seededValue);
    expect(revision.old_value).not.toBeNull();
    expect(revision.new_value).toBe('POA');
    expect(revision.status).toBe('official');
    // note 与后端同口径：trim 后为空 ⇒ null（clean_optional）。
    expect(revision.note).toBe('confirmed by marketing');
    expect(revision.edited_at).toMatch(RFC3339);
    expect(Number.isFinite(Date.parse(revision.edited_at))).toBe(true);
  });

  it('卡上生效：字段值改了、field_status 跟着改、completeness 是静态值不重算', async () => {
    const before = await demoInvoke<EntityCard | null>('entity_card_get', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });

    await demoInvoke('entity_card_update_field', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      path: 'founded_year',
      value: null,
      status: 'disputed',
      note: null,
    });
    const after = await demoInvoke<EntityCard | null>('entity_card_get', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });

    expect(after?.fields.founded_year).toBeNull();
    expect(after?.field_status.founded_year).toBe('disputed');
    expect(before?.field_status.founded_year).toBe('pending');
    // §B-2 / 规则 9：真实后端会在这里重算完整率，demo 只呈现种子里的静态值。
    expect(after?.completeness).toBe(before?.completeness);
    expect(after?.completeness).toBe(SEED_ENTITY_CARDS[0].completeness);
    expect(Date.parse(after?.updated_at ?? '')).toBeGreaterThanOrEqual(
      Date.parse(before?.updated_at ?? ''),
    );
  });

  it('空白 note 归一成 null', async () => {
    const revision = await demoInvoke<EntityCardRevision>('entity_card_update_field', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      path: 'cases',
      value: ['case-a'],
      status: 'pending',
      note: '   ',
    });

    expect(revision.note).toBeNull();
  });

  it('真的写进 db.revisions：时间线长一条，且新的排在前（edited_at DESC）', async () => {
    const first = await demoInvoke<EntityCardRevision>('entity_card_update_field', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      path: 'official_tone',
      value: 'tone-a',
      status: 'official',
      note: null,
    });
    const second = await demoInvoke<EntityCardRevision>('entity_card_update_field', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      path: 'official_tone',
      value: 'tone-b',
      status: 'disputed',
      note: null,
    });

    const rows = await demoInvoke<EntityCardRevision[]>('entity_card_revisions', {
      project_id: SEED_ACTIVE_PROJECT_ID,
    });
    expect(rows).toHaveLength(SEED_ENTITY_CARD_REVISIONS.length + 2);
    expect(rows[0].id).toBe(second.id);
    expect(rows[1].id).toBe(first.id);
    // B-6：edited_at 单调不减（同一毫秒也允许相等）。
    expect(Date.parse(second.edited_at)).toBeGreaterThanOrEqual(Date.parse(first.edited_at));
    // 第二次改的 old_value 是第一次改完的值，不是种子里那个。
    expect(second.old_value).toBe('tone-a');
    expect(getDemoDb().revisions.filter((row) => row.id === second.id)).toHaveLength(1);
  });

  it('resetDemoDb() 之后运行时产物全部回到种子（§B-7②）', async () => {
    await demoInvoke('entity_card_update_field', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      path: 'cases',
      value: ['case-x'],
      status: 'official',
      note: null,
    });
    await demoInvoke('entity_card_autobuild', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
      domain: VALID_DOMAIN,
    });

    resetDemoDb();

    expect(getDemoDb().revisions).toHaveLength(SEED_ENTITY_CARD_REVISIONS.length);
    expect(getDemoDb().entityCards).toHaveLength(SEED_ENTITY_CARDS.length);
    // 种子模块自身没被运行时产物污染（`createDemoDb` 的深拷语义）。
    expect(getDemoDb().entityCards[0].fields.price_range).toBe(
      SEED_ENTITY_CARDS[0].fields.price_range,
    );
  });
});

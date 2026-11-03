/**
 * M6.5 `site_patch_*` 6 条命令的行为测试
 * （spec `2026-09-30-site-connect-patch-bench-design.md` DR-47 / DR-50 / DR-52 / DR-56）。
 *
 * # 分工
 * - **档案与通道那 5 条** ⇒ `site.test.ts`；
 * - **六种导出物的形状与筛选口径** ⇒ `api/site-compose.test.ts`；
 * - **种子 ↔ 处方 ↔ 归因的自洽** ⇒ `demo/seed.test.ts`；
 * - 本文件管**行为**：新建 / 生成 / 就地改 / 三态跃迁 / 历史 / 删除。
 *
 * # 🔴 这一组最重要的三条纪律
 * ① **`publish` 不真下发**（DR-56①）：只翻状态 + 盖快照 + 记事件，线上站点一个字节都不会变；
 * ② **`publish` 的前置闸门是人工审核**（规则 6）：`review_status !== 'approved'` ⇒ reject，
 *    而 `unpublish` / `rollback` 是幂等的（没事可做就原样返回、**不记事件**）；
 * ③ **`save` 改不动 `status` 与 `published_body`**：状态只能经 `transition` 改，
 *    否则"谁在什么时候把它发上线的"这本账就被绕过去了。
 *
 * # 🔴 `generate` 不调模型（规则 9）
 * 产物逐字取自 `SEED_SITE_PATCH_POOL`，去重是 `(action_id, kind, target_url)` 的**等值**判断
 * （不是相似度）；池子里没有的处方一律回**空数组**而不是错误。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { SitePatch, SitePatchEvent } from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb, roundsOf } from '../db';
import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID } from '../seed/projects';
import { SEED_SITE_PATCHES, SEED_SITE_PATCH_POOL } from '../seed/site';

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

async function patches(projectId: string = SEED_ACTIVE_PROJECT_ID): Promise<SitePatch[]> {
  const board = await demoInvoke<{ patches: SitePatch[] }>('site_board', {
    project_id: projectId,
  });
  return board.patches;
}

async function history(patchId: string): Promise<SitePatchEvent[]> {
  return demoInvoke<SitePatchEvent[]>('site_patch_history', { patch_id: patchId });
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** 手动新建一条最小可用的补丁（各用例只覆盖自己关心的那几个键）。 */
function draft(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'html_fragment',
    title: 'Add a quotable definition paragraph',
    target_url: 'https://www.lanzhou-hb.example.com/products/bag-filter',
    target_hint: null,
    body: '<section><p>definition</p></section>',
    channel_kind: 'bundle',
    action_id: null,
    ...overrides,
  };
}

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/site-patch · site_patch_add（手动新建）', () => {
  it('source 固定 manual、审核态固定 approved、状态 draft、快照 null、position 接在最大值之后', async () => {
    const created = await demoInvoke<SitePatch>('site_patch_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      draft: draft(),
    });

    expect(created.id).toMatch(UUID_V4);
    expect(created.source).toBe('manual');
    expect(created.review_status).toBe('approved');
    expect(created.status).toBe('draft');
    expect(created.published_body).toBeNull();
    expect(created.published_at).toBeNull();
    expect(created.position).toBe(SEED_SITE_PATCHES.length);
    expect(created.created_at).toBe(created.updated_at);
    expect(created.created_at).toMatch(RFC3339);
  });

  it('🔴 前端自称 AI 生成 + 待审也没用：source / review_status 由后端定（不许把人工录入洗成别的）', async () => {
    const created = await demoInvoke<SitePatch>('site_patch_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      draft: draft({ source: 'generated', review_status: 'pending_review', status: 'published' }),
    });

    expect(created.source).toBe('manual');
    expect(created.review_status).toBe('approved');
    expect(created.status).toBe('draft');
  });

  it('round_id 继承关联处方的那一轮；没关联处方时取最近一轮', async () => {
    const db = getDemoDb();
    const linked = await demoInvoke<SitePatch>('site_patch_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      draft: draft({ action_id: 'demo-act-008' }),
    });
    const free = await demoInvoke<SitePatch>('site_patch_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      draft: draft({ title: 'Another one' }),
    });
    const rounds = roundsOf(db, SEED_ACTIVE_PROJECT_ID);
    const action = db.actions.find((row) => row.id === 'demo-act-008');

    expect(linked.round_id).toBe(action?.round_id);
    expect(free.round_id).toBe(rounds[rounds.length - 1]?.id);
  });

  it('记一条 created 事件，且 handler 生成的事件 note 恒为 null（门禁 7：非注释不含 CJK）', async () => {
    const created = await demoInvoke<SitePatch>('site_patch_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      draft: draft(),
    });
    const events = await history(created.id);

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('created');
    expect(events[0]?.channel_kind).toBeNull();
    expect(events[0]?.note).toBeNull();
    expect(events[0]?.created_at).toBe(created.created_at);
  });

  it('契约外的 kind / channel_kind 收敛到最中性的一档（不是清单第 0 项）', async () => {
    const created = await demoInvoke<SitePatch>('site_patch_add', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      draft: draft({ kind: 'server_config', channel_kind: 'browser_extension' }),
    });

    // `llms_txt` 是清单第 0 项，但它的落点是站点根目录文件（有运维后果）⇒ 刻意回落到 html_fragment
    expect(created.kind).toBe('html_fragment');
    expect(created.channel_kind).toBe('bundle');
  });

  it('标题 / 落点 / 正文空白 ⇒ 各自的 validation/failed，且一条都不入库', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['patch_title', { title: '   ' }],
      ['patch_target_url', { target_url: '' }],
      ['patch_body', { body: ' \n ' }],
    ];
    for (const [field, overrides] of cases) {
      const cause = await capture(() =>
        demoInvoke('site_patch_add', {
          project_id: SEED_ACTIVE_PROJECT_ID,
          draft: draft(overrides),
        }),
      );
      expect(errorCode(cause), field).toBe('validation/failed');
      expect(errorParams(cause), field).toEqual({ field, reason: 'required' });
    }
    expect(await patches()).toHaveLength(SEED_SITE_PATCHES.length);
  });

  it('action_id 认不出 ⇒ validation/failed { field: action_id, reason: invalid_id, value }', async () => {
    const cause = await capture(() =>
      demoInvoke('site_patch_add', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        draft: draft({ action_id: 'demo-act-999' }),
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'action_id',
      reason: 'invalid_id',
      value: 'demo-act-999',
    });
  });

  it('🔴 action_id 属于别的项目 ⇒ validation/failed invalid_id（不把 A 的处方挂到 B 上）', async () => {
    const cause = await capture(() =>
      demoInvoke('site_patch_add', {
        project_id: SEED_ARCHIVED_PROJECT_ID,
        draft: draft({ action_id: 'demo-act-006' }),
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'action_id',
      reason: 'invalid_id',
      value: 'demo-act-006',
    });
  });

  it('项目不存在 ⇒ project/not_found（先于 draft 校验）', async () => {
    const cause = await capture(() =>
      demoInvoke('site_patch_add', { project_id: 'no-such-project', draft: draft({ title: '' }) }),
    );

    expect(errorCode(cause)).toBe('project/not_found');
  });
});

describe('demo/handlers/site-patch · site_patch_generate（🔴 预置池，不调模型）', () => {
  it('按 kinds 从池子里挑，正文逐字端出；产物一律 generated + pending_review + draft', async () => {
    const row = SEED_SITE_PATCH_POOL['demo-act-008']?.[0];
    expect(row, 'demo-act-008 在池子里应该有候选').toBeDefined();

    const created = await demoInvoke<SitePatch[]>('site_patch_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      action_id: 'demo-act-008',
      kinds: [row?.kind],
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.body).toBe(row?.body);
    expect(created[0]?.title).toBe(row?.title);
    expect(created[0]?.target_url).toBe(row?.target_url);
    expect(created[0]?.target_hint).toBe(row?.target_hint);
    expect(created[0]?.channel_kind).toBe(row?.channel_kind);
    expect(created[0]?.source).toBe('generated');
    expect(created[0]?.review_status).toBe('pending_review');
    expect(created[0]?.status).toBe('draft');
    expect(created[0]?.published_body).toBeNull();
    expect(created[0]?.action_id).toBe('demo-act-008');
    // 继承处方的那一轮（归因时要对得上复测轮）
    expect(created[0]?.round_id).toBe(
      getDemoDb().actions.find((item) => item.id === 'demo-act-008')?.round_id,
    );
  });

  it('一次要两类 ⇒ 两条都生成、position 连续、各记一条 created 事件', async () => {
    const created = await demoInvoke<SitePatch[]>('site_patch_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      action_id: 'demo-act-008',
      kinds: ['html_fragment', 'jsonld'],
    });

    expect(created).toHaveLength(2);
    expect(created.map((row) => row.position)).toEqual([
      SEED_SITE_PATCHES.length,
      SEED_SITE_PATCHES.length + 1,
    ]);
    for (const row of created) {
      const events = await history(row.id);
      expect(events.map((event) => event.kind)).toEqual(['created']);
    }
  });

  it('只回**新增**那几条：等值去重（同 action_id + kind + target_url 已在台账就跳过）', async () => {
    // demo-act-001 的池子里是 meta_title @ 产品页；台账里已有 html_fragment 与 meta_description
    // 两条同页面的补丁 ⇒ 三条 (action, kind, target) 组合互不相同，第一次生成应当成功。
    const first = await demoInvoke<SitePatch[]>('site_patch_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      action_id: 'demo-act-001',
      kinds: ['meta_title'],
    });
    expect(first).toHaveLength(1);

    const second = await demoInvoke<SitePatch[]>('site_patch_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      action_id: 'demo-act-001',
      kinds: ['meta_title'],
    });
    // 🔴 空数组不是错误：界据此提示"这条处方的补丁已经都在台账里了"
    expect(second).toEqual([]);
    expect(await patches()).toHaveLength(SEED_SITE_PATCHES.length + 1);
  });

  it('🔴 source_layout 类处方 ⇒ 回空数组（落点在站外平台，DR-46），且不写库', async () => {
    const created = await demoInvoke<SitePatch[]>('site_patch_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      action_id: 'demo-act-005',
      kinds: ['html_fragment', 'llms_txt'],
    });

    expect(created).toEqual([]);
    expect(await patches()).toHaveLength(SEED_SITE_PATCHES.length);
  });

  it('池子里没有那条处方 ⇒ 回空数组（不是 not_found）', async () => {
    // demo-act-002 的两条补丁（llms.txt / robots.txt）已经发布在台账里，池子里刻意不再放一份
    expect(SEED_SITE_PATCH_POOL['demo-act-002']).toBeUndefined();
    const created = await demoInvoke<SitePatch[]>('site_patch_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      action_id: 'demo-act-002',
      kinds: ['llms_txt'],
    });

    expect(created).toEqual([]);
  });

  it('kinds 为空 ⇒ validation/failed { field: kinds, reason: empty }', async () => {
    const cause = await capture(() =>
      demoInvoke('site_patch_generate', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        action_id: 'demo-act-008',
        kinds: [],
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({ field: 'kinds', reason: 'empty' });
  });

  it('kinds 里混进契约外的值 ⇒ 该值被忽略，其余照挑（不静默失败）', async () => {
    const created = await demoInvoke<SitePatch[]>('site_patch_generate', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      action_id: 'demo-act-008',
      kinds: ['jsonld', 'server_config', 'jsonld'],
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.kind).toBe('jsonld');
  });

  it('action_id 认不出、或属于别的项目 ⇒ validation/failed invalid_id', async () => {
    for (const actionId of ['demo-act-999', 'no-such-action']) {
      const cause = await capture(() =>
        demoInvoke('site_patch_generate', {
          project_id: SEED_ACTIVE_PROJECT_ID,
          action_id: actionId,
          kinds: ['html_fragment'],
        }),
      );
      expect(errorCode(cause), actionId).toBe('validation/failed');
      expect(errorParams(cause), actionId).toEqual({
        field: 'action_id',
        reason: 'invalid_id',
        value: actionId,
      });
    }
  });

  it('项目不存在 ⇒ project/not_found', async () => {
    const cause = await capture(() =>
      demoInvoke('site_patch_generate', {
        project_id: 'no-such-project',
        action_id: 'demo-act-008',
        kinds: ['html_fragment'],
      }),
    );

    expect(errorCode(cause)).toBe('project/not_found');
  });
});

describe('demo/handlers/site-patch · site_patch_save（就地改草案）', () => {
  it('可改 kind / title / target_url / target_hint / body / channel_kind / review_status', async () => {
    const before = (await patches()).find((row) => row.id === 'demo-site-patch-006');
    expect(before, '种子应该有 patch-006').toBeDefined();

    const saved = await demoInvoke<SitePatch>('site_patch_save', {
      patch: {
        ...before,
        kind: 'meta_title',
        title: 'Rewritten title',
        target_url: 'https://www.lanzhou-hb.example.com/about',
        target_hint: 'above the fold',
        body: '<title>Rewritten</title>',
        channel_kind: 'cms',
        review_status: 'approved',
      },
    });

    expect(saved.kind).toBe('meta_title');
    expect(saved.title).toBe('Rewritten title');
    expect(saved.target_url).toBe('https://www.lanzhou-hb.example.com/about');
    expect(saved.target_hint).toBe('above the fold');
    expect(saved.body).toBe('<title>Rewritten</title>');
    expect(saved.channel_kind).toBe('cms');
    expect(saved.review_status).toBe('approved');
  });

  it('🔴 status / published_body / source / position / action_id / round_id 由后端保留（塞进来也静默忽略）', async () => {
    const before = (await patches()).find((row) => row.id === 'demo-site-patch-001');
    expect(before?.status).toBe('published');

    const saved = await demoInvoke<SitePatch>('site_patch_save', {
      patch: {
        ...before,
        status: 'unpublished',
        published_body: 'tampered',
        source: 'imported',
        position: 99,
        action_id: 'demo-act-009',
        round_id: 'demo-round-live',
        project_id: SEED_ARCHIVED_PROJECT_ID,
      },
    });

    expect(saved.id).toBe('demo-site-patch-001');
    expect(saved.status).toBe('published');
    expect(saved.published_body).toBe(before?.published_body);
    expect(saved.source).toBe(before?.source);
    expect(saved.position).toBe(before?.position);
    expect(saved.action_id).toBe('demo-act-001');
    expect(saved.round_id).toBe(before?.round_id);
    expect(saved.project_id).toBe(SEED_ACTIVE_PROJECT_ID);
  });

  it('🔴 改一条已发布的补丁**不会**自动撤回它：body 变了、published_body 原样（DR-47）', async () => {
    const before = (await patches()).find((row) => row.id === 'demo-site-patch-003');
    expect(before?.status).toBe('published');
    expect(before?.published_body).toBe(before?.body);

    const saved = await demoInvoke<SitePatch>('site_patch_save', {
      patch: { ...before, body: `${before?.body ?? ''}\n# appended line` },
    });

    expect(saved.status).toBe('published');
    expect(saved.published_at).toBe(before?.published_at);
    expect(saved.published_body).toBe(before?.published_body);
    // 界面据这一条派生"有未发布的修改"
    expect(saved.body).not.toBe(saved.published_body);
  });

  it('正文空白 ⇒ validation/failed { field: patch_body, reason: required }（与 add 同一条判据）', async () => {
    const before = (await patches()).find((row) => row.id === 'demo-site-patch-006');
    const cause = await capture(() =>
      demoInvoke('site_patch_save', { patch: { ...before, body: '   ' } }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({ field: 'patch_body', reason: 'required' });
  });

  it('标题 / 落点空白 ⇒ 各自的 validation/failed', async () => {
    const before = (await patches()).find((row) => row.id === 'demo-site-patch-006');
    for (const [field, overrides] of [
      ['patch_title', { title: ' ' }],
      ['patch_target_url', { target_url: '' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const cause = await capture(() =>
        demoInvoke('site_patch_save', { patch: { ...before, ...overrides } }),
      );
      expect(errorCode(cause), field).toBe('validation/failed');
      expect(errorParams(cause), field).toEqual({ field, reason: 'required' });
    }
  });

  it('id 认不出 ⇒ validation/failed { field: patch_id, reason: invalid_id, value }', async () => {
    const cause = await capture(() =>
      demoInvoke('site_patch_save', { patch: { ...draft(), id: 'demo-site-patch-999' } }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'patch_id',
      reason: 'invalid_id',
      value: 'demo-site-patch-999',
    });
  });

  it('记一条 saved 事件；一次写操作只取一个时间戳（updated_at === 事件 created_at）', async () => {
    const before = (await patches()).find((row) => row.id === 'demo-site-patch-006');
    const saved = await demoInvoke<SitePatch>('site_patch_save', {
      patch: { ...before, title: 'Tweaked' },
    });
    const events = await history(saved.id);
    const last = events[events.length - 1];

    expect(last?.kind).toBe('saved');
    expect(last?.created_at).toBe(saved.updated_at);
    expect(last?.channel_kind).toBeNull();
    expect(last?.note).toBeNull();
  });
});

describe('demo/handlers/site-patch · site_patch_transition（三态 + 回滚）', () => {
  it('publish（已审核）⇒ 翻状态、盖快照、published_at === updated_at === 事件时间', async () => {
    const draftRow = (await patches()).find((row) => row.id === 'demo-site-patch-006');
    expect(draftRow?.status).toBe('draft');
    expect(draftRow?.review_status).toBe('pending_review');

    // 先过人工审核（publish 的闸门）
    await demoInvoke<SitePatch>('site_patch_save', {
      patch: { ...draftRow, review_status: 'approved' },
    });
    const published = await demoInvoke<SitePatch>('site_patch_transition', {
      patch_id: 'demo-site-patch-006',
      transition: 'publish',
    });

    expect(published.status).toBe('published');
    expect(published.published_body).toBe(published.body);
    expect(published.published_kind).toBe(published.kind);
    expect(published.published_target_url).toBe(published.target_url);
    expect(published.published_channel_kind).toBe(published.channel_kind);
    expect(published.published_at).toBe(published.updated_at);
    expect(published.published_at).toMatch(RFC3339);

    const events = await history('demo-site-patch-006');
    const last = events[events.length - 1];
    expect(last?.kind).toBe('published');
    expect(last?.created_at).toBe(published.published_at);
    // "从哪条路发出去的"是账的一部分 ⇒ 事件带上通道
    expect(last?.channel_kind).toBe(published.channel_kind);
  });

  it('🔴 规则 6 的闸门：审核态不是 approved ⇒ reject，状态不变、不记事件', async () => {
    const before = (await patches()).find((row) => row.id === 'demo-site-patch-006');
    const eventsBefore = await history('demo-site-patch-006');

    const cause = await capture(() =>
      demoInvoke('site_patch_transition', {
        patch_id: 'demo-site-patch-006',
        transition: 'publish',
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'review_status',
      reason: 'not_allowed',
      value: 'pending_review',
    });
    const after = (await patches()).find((row) => row.id === 'demo-site-patch-006');
    expect(after).toEqual(before);
    expect(await history('demo-site-patch-006')).toEqual(eventsBefore);
  });

  it('重复发布 ⇒ 重新盖一次快照 + 再记一条事件（对齐 Ahrefs 的全量历史）', async () => {
    const once = await demoInvoke<SitePatch>('site_patch_transition', {
      patch_id: 'demo-site-patch-003',
      transition: 'publish',
    });
    await demoInvoke<SitePatch>('site_patch_save', {
      patch: { ...once, body: 'second revision' },
    });
    const twice = await demoInvoke<SitePatch>('site_patch_transition', {
      patch_id: 'demo-site-patch-003',
      transition: 'publish',
    });

    expect(twice.status).toBe('published');
    expect(twice.published_body).toBe('second revision');
    const kinds = (await history('demo-site-patch-003')).map((event) => event.kind);
    expect(kinds.filter((kind) => kind === 'published').length).toBeGreaterThanOrEqual(2);
  });

  it('unpublish ⇒ 状态回 unpublished、published_at 清空、🔴 published_body 保留（回滚的落点）', async () => {
    const before = (await patches()).find((row) => row.id === 'demo-site-patch-003');
    const reverted = await demoInvoke<SitePatch>('site_patch_transition', {
      patch_id: 'demo-site-patch-003',
      transition: 'unpublish',
    });

    expect(reverted.status).toBe('unpublished');
    expect(reverted.published_at).toBeNull();
    expect(reverted.published_body).toBe(before?.published_body);
    expect(reverted.body).toBe(before?.body);
    const last = (await history('demo-site-patch-003')).at(-1);
    expect(last?.kind).toBe('unpublished');
    expect(last?.channel_kind).toBe(before?.channel_kind);
  });

  it('unpublish 幂等：已经撤回过 ⇒ 原样返回、事件数不变', async () => {
    const reverted = await demoInvoke<SitePatch>('site_patch_transition', {
      patch_id: 'demo-site-patch-002',
      transition: 'unpublish',
    });
    const eventsBefore = await history('demo-site-patch-002');
    const again = await demoInvoke<SitePatch>('site_patch_transition', {
      patch_id: 'demo-site-patch-002',
      transition: 'unpublish',
    });

    expect(reverted.status).toBe('unpublished');
    expect(again).toEqual(reverted);
    expect(await history('demo-site-patch-002')).toEqual(eventsBefore);
  });

  it('rollback ⇒ 草案恢复成上一次发布的快照，🔴 状态不变（回滚的是草案，不是替用户撤回线上）', async () => {
    const published = (await patches()).find((row) => row.id === 'demo-site-patch-003');
    await demoInvoke<SitePatch>('site_patch_save', {
      patch: {
        ...published,
        body: 'edited after publishing',
        kind: 'meta_title',
        target_url: 'https://example.com/edited-target',
        channel_kind: 'edge',
      },
    });

    const rolledBack = await demoInvoke<SitePatch>('site_patch_transition', {
      patch_id: 'demo-site-patch-003',
      transition: 'rollback',
    });

    expect(rolledBack.body).toBe(published?.published_body);
    expect(rolledBack.kind).toBe(published?.kind);
    expect(rolledBack.target_url).toBe(published?.target_url);
    expect(rolledBack.channel_kind).toBe(published?.channel_kind);
    expect(rolledBack.status).toBe('published');
    expect(rolledBack.published_body).toBe(published?.published_body);
    expect((await history('demo-site-patch-003')).at(-1)?.kind).toBe('rolled_back');
  });

  it('rollback 没有落点 ⇒ 原样返回、不记事件（从没发布过 / 草案与快照逐字相同）', async () => {
    // ① 从没发布过
    const neverPublished = (await patches()).find((row) => row.id === 'demo-site-patch-006');
    const eventsBefore = await history('demo-site-patch-006');
    const first = await demoInvoke<SitePatch>('site_patch_transition', {
      patch_id: 'demo-site-patch-006',
      transition: 'rollback',
    });
    expect(first).toEqual(neverPublished);
    expect(await history('demo-site-patch-006')).toEqual(eventsBefore);

    // ② 已发布且草案与快照相同（种子里那 6 条已发布的补丁都是这个形状）
    const same = (await patches()).find((row) => row.id === 'demo-site-patch-001');
    expect(same?.published_body).toBe(same?.body);
    const eventsBefore2 = await history('demo-site-patch-001');
    const second = await demoInvoke<SitePatch>('site_patch_transition', {
      patch_id: 'demo-site-patch-001',
      transition: 'rollback',
    });
    expect(second).toEqual(same);
    expect(await history('demo-site-patch-001')).toEqual(eventsBefore2);
  });

  it('🔴 transition 是**命令动词**：认不出的值报错而不是收敛（猜错动词 = 替用户执行了一次发布）', async () => {
    const cause = await capture(() =>
      demoInvoke('site_patch_transition', {
        patch_id: 'demo-site-patch-003',
        transition: 'deploy',
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'transition',
      reason: 'not_allowed',
      value: 'deploy',
    });
    // 状态一个字节都没动
    expect((await patches()).find((row) => row.id === 'demo-site-patch-003')?.status).toBe(
      'published',
    );
  });

  it('patch_id 认不出 ⇒ validation/failed { field: patch_id, reason: invalid_id }', async () => {
    for (const transition of ['publish', 'unpublish', 'rollback']) {
      const cause = await capture(() =>
        demoInvoke('site_patch_transition', {
          patch_id: 'demo-site-patch-999',
          transition,
        }),
      );
      expect(errorCode(cause), transition).toBe('validation/failed');
      expect(errorParams(cause), transition).toEqual({
        field: 'patch_id',
        reason: 'invalid_id',
        value: 'demo-site-patch-999',
      });
    }
  });
});

describe('demo/handlers/site-patch · site_patch_history', () => {
  it('时间正序（与实体卡修订时间线的倒序刻意相反）', async () => {
    const events = await history('demo-site-patch-002');

    expect(events.map((event) => event.kind)).toEqual(['created', 'published', 'unpublished']);
    const stamps = events.map((event) => Date.parse(event.created_at));
    expect(stamps).toEqual([...stamps].sort((left, right) => left - right));
  });

  it('patch_id 认不出 ⇒ validation/failed（不给一个空数组冒充"没有历史"）', async () => {
    const cause = await capture(() => history('demo-site-patch-999'));

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)?.field).toBe('patch_id');
  });
});

describe('demo/handlers/site-patch · site_patch_delete', () => {
  it('回剩余快照，position 重排成 0..n-1', async () => {
    const left = await demoInvoke<SitePatch[]>('site_patch_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: ['demo-site-patch-002', 'demo-site-patch-006'],
    });

    expect(left).toHaveLength(SEED_SITE_PATCHES.length - 2);
    expect(left.map((row) => row.position)).toEqual(left.map((_, index) => index));
    expect(left.map((row) => row.id)).not.toContain('demo-site-patch-002');
  });

  it('🔴 级联删事件：补丁没了，它的历史也不该留（不留一批指向不存在补丁的孤儿行）', async () => {
    expect((await history('demo-site-patch-002')).length).toBeGreaterThan(0);

    await demoInvoke<SitePatch[]>('site_patch_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: ['demo-site-patch-002'],
    });

    expect(getDemoDb().sitePatchEvents.some((event) => event.patch_id === 'demo-site-patch-002')).toBe(
      false,
    );
    // 别的历史原样留着
    expect((await history('demo-site-patch-001')).length).toBeGreaterThan(0);
  });

  it('幂等：认不出的 id 直接忽略，不发 not_found', async () => {
    const left = await demoInvoke<SitePatch[]>('site_patch_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: ['demo-site-patch-999'],
    });

    expect(left).toHaveLength(SEED_SITE_PATCHES.length);
  });

  it('允许删空：先把已发布的都撤回，再整批删除（没有"不许删空"那条约束）', async () => {
    for (const row of SEED_SITE_PATCHES) {
      if (row.status === 'published') {
        await demoInvoke<SitePatch>('site_patch_transition', {
          patch_id: row.id,
          transition: 'unpublish',
        });
      }
    }

    const left = await demoInvoke<SitePatch[]>('site_patch_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: SEED_SITE_PATCHES.map((row) => row.id),
    });

    expect(left).toEqual([]);
    expect(getDemoDb().sitePatchEvents).toEqual([]);
  });

  it('🔴 已发布的补丁拒绝硬删：state/conflict + reason=not_allowed，补丁与事件原样保留', async () => {
    const cause = await capture(() =>
      demoInvoke('site_patch_delete', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        ids: ['demo-site-patch-001'],
      }),
    );

    expect(errorCode(cause)).toBe('state/conflict');
    expect(errorParams(cause)).toEqual({ reason: 'not_allowed', value: 'published' });
    expect(getDemoDb().sitePatches.some((row) => row.id === 'demo-site-patch-001')).toBe(true);
    expect((await history('demo-site-patch-001')).length).toBeGreaterThan(0);
  });

  it('🔴 批量里混入一条已发布 ⇒ 整批拒绝（原子），可删的那条也不会被顺手删掉', async () => {
    const before = getDemoDb().sitePatches.length;
    const cause = await capture(() =>
      demoInvoke('site_patch_delete', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        ids: ['demo-site-patch-002', 'demo-site-patch-001', 'demo-site-patch-006'],
      }),
    );

    expect(errorCode(cause)).toBe('state/conflict');
    expect(getDemoDb().sitePatches).toHaveLength(before);
    expect(getDemoDb().sitePatches.some((row) => row.id === 'demo-site-patch-002')).toBe(true);
  });

  it('🔴 只删本项目的行：别的项目的补丁**与其历史事件**都不受影响', async () => {
    const other = await demoInvoke<SitePatch>('site_patch_add', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
      draft: draft({ title: 'Belongs to the archived project' }),
    });
    const otherEvents = await history(other.id);
    expect(otherEvents.length).toBeGreaterThan(0);

    // 把 B 项目的补丁 id 混进 A 项目的删除请求：A 的过滤条件不该命中 B；
    // 更不能因为入参里有这个 id 就把 B 的事件级联删掉。
    await demoInvoke<SitePatch[]>('site_patch_delete', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      ids: ['demo-site-patch-002', other.id],
    });

    expect(await patches(SEED_ARCHIVED_PROJECT_ID)).toHaveLength(1);
    expect(await history(other.id)).toEqual(otherEvents);
  });

  it('项目不存在 ⇒ project/not_found', async () => {
    const cause = await capture(() =>
      demoInvoke('site_patch_delete', { project_id: 'no-such-project', ids: ['demo-site-patch-001'] }),
    );

    expect(errorCode(cause)).toBe('project/not_found');
  });
});

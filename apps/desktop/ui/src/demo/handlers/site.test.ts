/**
 * M6.5 `site_board` / `site_profile_save` / `site_channel_*` 5 条命令的行为测试
 * （spec `2026-09-30-site-connect-patch-bench-design.md` DR-46 / DR-48 / DR-49 / DR-52 / DR-56）。
 *
 * # 分工
 * - **补丁台账那 6 条** ⇒ `site-patch.test.ts`（单文件约 400 行的软线，与 handler 的拆法对齐）；
 * - **args 键名漂移** ⇒ 由 `pages/SitePage.test.tsx` 经 `api/site.ts` 覆盖；
 * - **种子自洽**（8 条补丁 ↔ 10 条处方 ↔ 归因卡片）⇒ `demo/seed.test.ts`；
 * - 本文件管**行为**：五块首屏的口径、档案 upsert、四条通道的配置/自检/清除。
 *
 * # 🔴 这里钉的是「demo 刻意不做的事」（AGENTS 规则 2 / 规则 3 / 规则 9）
 * ① `site_channel_test` **不联网**：结论逐字取自 `SEED_SITE_CHANNEL_PROBES`；
 * ② `SitePage[]` **不是爬出来的**：静态表，按项目过滤之后原样端出；
 * ③ **凭据一个字符都不收**：入参里塞 `password` / `token` 既不落库、也不进错误 params，
 *    库里那一行只有 `secret_ref` 这个**引用串**（`keyring://site/<kind>/<project>`）。
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { SiteBoard, SiteChannel, SiteProfile } from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID, SEED_PROJECTS } from '../seed/projects';
import {
  SEED_SITE_CHANNELS,
  SEED_SITE_CHANNEL_PROBES,
  SEED_SITE_DOMAIN,
  SEED_SITE_PAGES,
  SEED_SITE_PATCHES,
  SEED_SITE_PATCH_POOL,
  SEED_SITE_PROFILE,
} from '../seed/site';

/** 把「同步 throw」与「rejected promise」两种形状收成同一个 catch（照 `keyword.test.ts`）。 */
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

async function board(projectId: string = SEED_ACTIVE_PROJECT_ID): Promise<SiteBoard> {
  return demoInvoke<SiteBoard>('site_board', { project_id: projectId });
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** 契约里 `SiteChannel` 的全部键：多一个就说明有东西（比如凭据）悄悄落库了。 */
const CHANNEL_KEYS = [
  'id',
  'project_id',
  'kind',
  'status',
  'endpoint',
  'username',
  'note',
  'credentials_state',
  'secret_ref',
  'checked_at',
  'check_detail',
  'updated_at',
].sort();

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/site · site_board（五块首屏）', () => {
  it('一次端回五块：档案 / 页面清单 / 通道 / 补丁 / 生成池目录，各自逐字来自种子', async () => {
    const result = await board();

    expect(result.profile).toEqual(SEED_SITE_PROFILE);
    expect(result.pages).toHaveLength(SEED_SITE_PAGES.length);
    expect(result.pages.map((page) => page.url)).toEqual(SEED_SITE_PAGES.map((page) => page.url));
    // 通道按 SITE_CHANNEL_KIND_VALUES 的清单序（bundle → cms → edge → repo），不是 updated_at 序
    expect(result.channels.map((channel) => channel.kind)).toEqual([
      'bundle',
      'cms',
      'edge',
      'repo',
    ]);
    expect(result.patches).toHaveLength(SEED_SITE_PATCHES.length);
    expect(result.patches.map((patch) => patch.position)).toEqual(
      result.patches.map((_, index) => index),
    );
  });

  it('🔴 已发布补丁的 published_body 与 body 逐字相同（回滚的落点，也是"有未发布的修改"的判据）', async () => {
    const result = await board();
    const published = result.patches.filter((patch) => patch.status === 'published');

    expect(published.length).toBeGreaterThanOrEqual(5);
    for (const patch of published) {
      expect(patch.published_body, patch.id).toBe(patch.body);
      expect(patch.published_at, patch.id).toMatch(RFC3339);
    }
    // 反过来：从没发布过的补丁，快照必须是 null（否则界面会派生出一个假的"有未发布的修改"）
    for (const patch of result.patches.filter((row) => row.status === 'draft')) {
      expect(patch.published_body, patch.id).toBeNull();
    }
  });

  it('生成池只端**目录**（action_id / kind / title），正文留在种子里', async () => {
    const result = await board();
    const expected = Object.entries(SEED_SITE_PATCH_POOL).flatMap(([actionId, rows]) =>
      rows.map((row) => ({ action_id: actionId, kind: row.kind, title: row.title })),
    );

    expect(result.pool).toEqual(expected);
    for (const entry of result.pool) {
      expect(Object.keys(entry).sort()).toEqual(['action_id', 'kind', 'title']);
    }
  });

  it('🔴 source_layout 类处方在池子里一条都没有（DR-46：落点在站外平台）', async () => {
    const result = await board();
    const db = getDemoDb();
    const offSite = db.actions
      .filter((item) => item.category === 'source_layout')
      .map((item) => item.id);

    expect(offSite).toEqual(['demo-act-005', 'demo-act-006']);
    expect(result.pool.filter((entry) => offSite.includes(entry.action_id))).toEqual([]);
    // 初始台账里也没有它们的补丁
    expect(
      result.patches.filter((patch) => patch.action_id !== null && offSite.includes(patch.action_id)),
    ).toEqual([]);
  });

  it('返回的是副本：改首屏不会动到库', async () => {
    const result = await board();
    const title = result.patches[0]?.title ?? '';
    if (result.profile !== null) result.profile.note = 'tampered';
    result.patches[0]!.title = 'tampered';

    const again = await board();
    expect(again.patches[0]?.title).toBe(title);
    expect(again.profile?.note).toBe(SEED_SITE_PROFILE.note);
  });

  it('🔴 还没建档的项目 ⇒ profile 是 null（不是 not_found），其余四块是空数组', async () => {
    const result = await board(SEED_ARCHIVED_PROJECT_ID);

    expect(result.profile).toBeNull();
    expect(result.pages).toEqual([]);
    expect(result.channels).toEqual([]);
    expect(result.patches).toEqual([]);
    // 池子按处方的归属项目过滤 ⇒ 归档项目一条候选都没有
    expect(result.pool).toEqual([]);
  });

  it('项目不存在 ⇒ project/not_found，params 两个键都在', async () => {
    const cause = await capture(() => board('no-such-project'));

    expect(errorCode(cause)).toBe('project/not_found');
    expect(errorParams(cause)).toEqual({ kind: 'project', id: 'no-such-project' });
  });
});

describe('demo/handlers/site · site_profile_save（upsert）', () => {
  it('已有档案 ⇒ 只改三项 + updated_at；id / created_at / domain 原样保留', async () => {
    const saved = await demoInvoke<SiteProfile>('site_profile_save', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      platform: 'wordpress',
      ownership: 'self',
      note: '  moved in-house  ',
    });

    expect(saved.id).toBe(SEED_SITE_PROFILE.id);
    expect(saved.created_at).toBe(SEED_SITE_PROFILE.created_at);
    expect(saved.platform).toBe('wordpress');
    expect(saved.ownership).toBe('self');
    // 两端都 trim：备注是要贴进交接单的，带着首尾空白会被当成"内容的一部分"
    expect(saved.note).toBe('moved in-house');
    expect(saved.updated_at).toMatch(RFC3339);
    expect(saved.updated_at >= SEED_SITE_PROFILE.updated_at).toBe(true);
  });

  it('🔴 domain 不在入参里：塞一个也会被 Project.website 逐字覆盖（DR-49）', async () => {
    const saved = await demoInvoke<SiteProfile>('site_profile_save', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      platform: 'custom',
      ownership: 'agency',
      note: null,
      domain: 'https://attacker.example.com',
    });

    expect(saved.domain).toBe(SEED_SITE_DOMAIN);
    expect(saved.domain).not.toContain('attacker');
  });

  it('没建档的项目 ⇒ 建一份，domain 逐字取自该项目的 website，id 是 uuid v4', async () => {
    const saved = await demoInvoke<SiteProfile>('site_profile_save', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
      platform: 'saas_builder',
      ownership: 'no_access',
      note: null,
    });
    const project = SEED_PROJECTS.find((row) => row.id === SEED_ARCHIVED_PROJECT_ID);

    expect(saved.id).toMatch(UUID_V4);
    expect(saved.project_id).toBe(SEED_ARCHIVED_PROJECT_ID);
    expect(saved.domain).toBe(project?.website);
    expect(saved.platform).toBe('saas_builder');
    expect(saved.ownership).toBe('no_access');
    expect(saved.note).toBeNull();
    expect(saved.created_at).toBe(saved.updated_at);
    // 第二次读得到同一份（真的进库了，不是只在返回值里）
    expect((await board(SEED_ARCHIVED_PROJECT_ID)).profile).toEqual(saved);
  });

  it('契约外的 platform / ownership 收敛到 unknown（数据字段收敛，不报错）', async () => {
    const saved = await demoInvoke<SiteProfile>('site_profile_save', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      platform: 'wix',
      ownership: 'freelancer',
      note: '   ',
    });

    expect(saved.platform).toBe('unknown');
    expect(saved.ownership).toBe('unknown');
    // 纯空白 ⇒ null（不是空串）：界面上空串与"没填"是两种显示
    expect(saved.note).toBeNull();
  });

  it('项目不存在 ⇒ project/not_found（先于字段收敛）', async () => {
    const cause = await capture(() =>
      demoInvoke('site_profile_save', {
        project_id: 'no-such-project',
        platform: 'nonsense',
        ownership: 'nonsense',
        note: null,
      }),
    );

    expect(errorCode(cause)).toBe('project/not_found');
  });
});

describe('demo/handlers/site · site_channel_upsert（🔴 不收凭据）', () => {
  it('bundle：唯一零配置就 ready 的通道，endpoint / username / secret_ref 一律 null', async () => {
    const channel = await demoInvoke<SiteChannel>('site_channel_upsert', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'bundle',
      endpoint: 'https://should-be-ignored.example.com',
      username: 'ignored',
      note: 'hand-over sheet',
    });

    expect(channel.kind).toBe('bundle');
    expect(channel.status).toBe('ready');
    expect(channel.endpoint).toBeNull();
    expect(channel.username).toBeNull();
    expect(channel.credentials_state).toBe('not_required');
    expect(channel.secret_ref).toBeNull();
    expect(channel.note).toBe('hand-over sheet');
  });

  it('cms：填了落点 ⇒ pending_verify + credentials missing + 钥匙串引用串', async () => {
    const channel = await demoInvoke<SiteChannel>('site_channel_upsert', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'cms',
      endpoint: 'https://www.lanzhou-hb.example.com/wp-json',
      username: 'webmaster',
      note: null,
    });

    expect(channel.status).toBe('pending_verify');
    expect(channel.endpoint).toBe('https://www.lanzhou-hb.example.com/wp-json');
    expect(channel.username).toBe('webmaster');
    expect(channel.credentials_state).toBe('missing');
    expect(channel.secret_ref).toBe(`keyring://site/cms/${SEED_ACTIVE_PROJECT_ID}`);
  });

  it('落点留空 ⇒ not_configured（配了个寂寞不等于配好了）', async () => {
    const channel = await demoInvoke<SiteChannel>('site_channel_upsert', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'edge',
      endpoint: '   ',
      username: null,
      note: null,
    });

    expect(channel.status).toBe('not_configured');
    expect(channel.endpoint).toBeNull();
  });

  it('同 kind 覆盖：一个项目每条通道至多一行', async () => {
    await demoInvoke<SiteChannel>('site_channel_upsert', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'repo',
      endpoint: 'https://github.com/org/site-repo',
      username: null,
      note: 'first',
    });
    await demoInvoke<SiteChannel>('site_channel_upsert', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'repo',
      endpoint: 'https://gitlab.com/org/site-repo',
      username: null,
      note: 'second',
    });
    const result = await board();
    const repos = result.channels.filter((channel) => channel.kind === 'repo');

    expect(repos).toHaveLength(1);
    expect(repos[0]?.endpoint).toBe('https://gitlab.com/org/site-repo');
    expect(repos[0]?.note).toBe('second');
    expect(result.channels).toHaveLength(SEED_SITE_CHANNELS.length);
  });

  it('🔴 改配置 ⇒ 上一次的自检结论作废（checked_at / check_detail 清空）', async () => {
    const before = (await board()).channels.find((channel) => channel.kind === 'bundle');
    expect(before?.checked_at).not.toBeNull();

    const after = await demoInvoke<SiteChannel>('site_channel_upsert', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'bundle',
      endpoint: null,
      username: null,
      note: 'changed',
    });

    expect(after.checked_at).toBeNull();
    expect(after.check_detail).toBeNull();
  });

  it('🔴 规则 3：入参里塞 password / token 既不落库、也不改形状', async () => {
    const channel = await demoInvoke<SiteChannel>('site_channel_upsert', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'cms',
      endpoint: 'https://www.lanzhou-hb.example.com/wp-json',
      username: 'webmaster',
      note: null,
      password: 'sup3r-secret',
      application_password: 'xxxx xxxx xxxx',
      token: 'cf-token-abc',
    });

    expect(Object.keys(channel).sort()).toEqual(CHANNEL_KEYS);
    // 整行序列化之后不含任何一处凭据原文（库、日志、错误 params 三个面一起兜住）
    expect(JSON.stringify(channel)).not.toContain('sup3r-secret');
    expect(JSON.stringify(channel)).not.toContain('cf-token-abc');
    expect(JSON.stringify(getDemoDb().siteChannels)).not.toContain('sup3r-secret');
  });

  it('🔴 认不出的 kind ⇒ validation/failed { field: channel_kind, reason: not_allowed }（点名入参不收敛）', async () => {
    const cause = await capture(() =>
      demoInvoke('site_channel_upsert', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        kind: 'browser_extension',
        endpoint: null,
        username: null,
        note: null,
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({
      field: 'channel_kind',
      reason: 'not_allowed',
      value: 'browser_extension',
    });
    // 一条都没写进去
    expect((await board()).channels).toHaveLength(SEED_SITE_CHANNELS.length);
  });

  it('项目不存在 ⇒ project/not_found', async () => {
    const cause = await capture(() =>
      demoInvoke('site_channel_upsert', {
        project_id: 'no-such-project',
        kind: 'bundle',
        endpoint: null,
        username: null,
        note: null,
      }),
    );

    expect(errorCode(cause)).toBe('project/not_found');
  });
});

describe('demo/handlers/site · site_channel_remove（回剩余快照、幂等）', () => {
  it('删一条 ⇒ 回剩下的三条，仍按清单序', async () => {
    const left = await demoInvoke<SiteChannel[]>('site_channel_remove', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'edge',
    });

    expect(left.map((channel) => channel.kind)).toEqual(['bundle', 'cms', 'repo']);
    expect(await demoInvoke<SiteChannel[]>('site_channel_remove', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'edge',
    })).toEqual(left);
  });

  it('幂等：删一条本来就不存在的配置不发 not_found', async () => {
    const before = (await board(SEED_ARCHIVED_PROJECT_ID)).channels;
    const left = await demoInvoke<SiteChannel[]>('site_channel_remove', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
      kind: 'cms',
    });

    expect(before).toEqual([]);
    expect(left).toEqual([]);
  });

  it('🔴 删的是配置，不动挂在它上面的补丁', async () => {
    const patchesBefore = (await board()).patches;
    await demoInvoke<SiteChannel[]>('site_channel_remove', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'bundle',
    });
    const patchesAfter = (await board()).patches;

    expect(patchesBefore.filter((patch) => patch.channel_kind === 'bundle').length).toBeGreaterThan(0);
    expect(patchesAfter).toEqual(patchesBefore);
  });

  it('认不出的 kind ⇒ validation/failed（与 upsert 同一条判据）', async () => {
    const cause = await capture(() =>
      demoInvoke('site_channel_remove', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        kind: 'third_party',
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)?.field).toBe('channel_kind');
  });
});

describe('demo/handlers/site · site_channel_test（🔴 不联网，回预置结论）', () => {
  it('结论逐字取自 SEED_SITE_CHANNEL_PROBES，四条通道各测一遍', async () => {
    for (const kind of ['bundle', 'cms', 'edge', 'repo'] as const) {
      const channel = await demoInvoke<SiteChannel>('site_channel_test', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        kind,
      });
      const probe = SEED_SITE_CHANNEL_PROBES[kind];

      expect(channel.kind, kind).toBe(kind);
      expect(channel.status, kind).toBe(probe.status);
      expect(channel.check_detail, kind).toBe(probe.check_detail);
      expect(channel.checked_at, kind).toMatch(RFC3339);
      expect(channel.updated_at, kind).toBe(channel.checked_at);
    }
  });

  it('🔴 自检即建档：没配过的通道也能自检，先补一行再写结论', async () => {
    expect((await board(SEED_ARCHIVED_PROJECT_ID)).channels).toEqual([]);

    const channel = await demoInvoke<SiteChannel>('site_channel_test', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
      kind: 'edge',
    });

    expect(channel.id).toMatch(UUID_V4);
    expect(channel.project_id).toBe(SEED_ARCHIVED_PROJECT_ID);
    expect(channel.endpoint).toBeNull();
    expect(channel.status).toBe(SEED_SITE_CHANNEL_PROBES.edge.status);
    expect(channel.secret_ref).toBe(`keyring://site/edge/${SEED_ARCHIVED_PROJECT_ID}`);
    // 补出来的那一行进库了
    expect((await board(SEED_ARCHIVED_PROJECT_ID)).channels).toHaveLength(1);
  });

  it('🔴 demo 里 credentials_state 永远不会是 stored（比真后端更强：连内存都不存）', async () => {
    for (const kind of ['bundle', 'cms', 'edge', 'repo'] as const) {
      await demoInvoke<SiteChannel>('site_channel_test', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        kind,
      });
    }
    const states = (await board()).channels.map((channel) => channel.credentials_state);

    expect(states).not.toContain('stored');
    expect(new Set(states)).toEqual(new Set(['not_required', 'missing']));
  });

  it('🔴 错误 params 里绝不出现凭据字段（规则 3 的第三个面）', async () => {
    const cause = await capture(() =>
      demoInvoke('site_channel_test', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        kind: 'cms',
        password: 'sup3r-secret',
      }),
    );
    // kind 合法 ⇒ 这一支其实成功；换成认不出的 kind 才走到错误分支
    expect(errorCode(cause)).toBeNull();

    const rejected = await capture(() =>
      demoInvoke('site_channel_test', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        kind: 'nope',
        password: 'sup3r-secret',
      }),
    );
    expect(errorCode(rejected)).toBe('validation/failed');
    expect(JSON.stringify(errorParams(rejected))).not.toContain('sup3r-secret');
    expect(Object.keys(errorParams(rejected) ?? {}).sort()).toEqual(['field', 'reason', 'value']);
  });

  it('项目不存在 ⇒ project/not_found', async () => {
    const cause = await capture(() =>
      demoInvoke('site_channel_test', { project_id: 'no-such-project', kind: 'bundle' }),
    );

    expect(errorCode(cause)).toBe('project/not_found');
  });
});

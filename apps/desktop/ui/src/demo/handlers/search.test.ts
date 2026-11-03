/// <reference types="node" />
/**
 * M5.5 站长数据 6 条命令的行为测试（spec `2026-10-12-webmaster-data-integration-design.md`
 * · DR-97 … DR-99 / DR-108 / DR-113 / DR-118）。
 *
 * # 分工
 * - **导入那一条**（`search_metric_import_csv`）在本文件里占一半篇幅：它是这一轮唯一"真算"的
 *   写路径（DR-99 放宽：解析、认列、重算、覆盖同周期都真做）；
 * - **种子自洽**（§5.2 那 16 条）⇒ `demo/seed.test.ts`；
 * - **归一 / 求和 / 区间收敛**⇒ `api/search-compose.test.ts`（那边是纯函数，这里只验"命令端得出料"）；
 * - **args 键名漂移** ⇒ 由 `pages/WebmasterDataPage.test.tsx` 经 `api/client.ts` 的 wrapper 覆盖。
 *
 * # 🔴 这里钉的是「demo 刻意不做的事」（AGENTS 规则 2 / 规则 3 / 规则 9 / 规则 11）
 * ① `search_source_test` **不联网**：结论逐字取自 `SEED_SEARCH_SOURCE_PROBES`；
 * ② 机会清单**不是算出来的**：翻状态不会长出新条目（DR-99 / E-68）；
 * ③ **凭据一个字符都不收**：`binding` 只装站点绑定，库里只有 `keyring://search/<kind>` 这个引用串；
 * ④ 二期源（`sogou` / `so_360`）**命令面也不收**：目录表 `phase: 2` ⇒ 拒（DR-92 / DR-108，
 *    开放二期只改目录表一个数字，这里跟着自动放开）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SEARCH_AI_SUMMARY_CSV_HEADER } from '../../api/constants';
import { resolveDataThrough } from '../../api/search-catalog';
import { MAPPING_VERSION } from '../../api/search-mapping';
import type {
  SearchBoardResult,
  SearchMetricImportResult,
  SearchOpportunity,
  SearchSource,
} from '../../api/types';
import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';
import { SEED_ACTIVE_PROJECT_ID, SEED_ARCHIVED_PROJECT_ID } from '../seed/projects';
import {
  SEED_SEARCH_BINDING_BLOCKED_DETAIL,
  SEED_SEARCH_QUERY_METRICS,
  SEED_SEARCH_SOURCES,
  SEED_SEARCH_SOURCE_PROBES,
  SEED_SEARCH_TRAFFIC_SPLIT,
  SEED_SELF_INDEX_SNAPSHOTS,
} from '../seed/search-data';
import { SEED_SITE_DOMAIN } from '../seed/site';

/** 从 `process.cwd()` 往上找仓库根读字节（口径照 `api/search-xlsx.test.ts` 的同名 helper）。 */
function readRepoBytes(...segments: string[]): Uint8Array {
  const relative = join(...segments);
  let dir = resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return new Uint8Array(readFileSync(candidate));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`fixture not found: ${relative}`);
}

/** 百度《AI 流量分析》官方导出的真实空表（仅表头零数据行，录制纪律见 `fixtures/search/README.md`）。 */
const BAIDU_AI_XLSX = readRepoBytes(
  'fixtures',
  'search',
  'baidu_aiflow_hot_keywords_empty_2026-10-12.xlsx',
);

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** 把「同步 throw」与「rejected promise」两种形状收成同一个 catch（照 `site.test.ts`）。 */
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

async function board(projectId: string = SEED_ACTIVE_PROJECT_ID): Promise<SearchBoardResult> {
  return demoInvoke<SearchBoardResult>('search_board', { project_id: projectId });
}

async function importCsv(args: Record<string, unknown>): Promise<SearchMetricImportResult> {
  return demoInvoke<SearchMetricImportResult>('search_metric_import_csv', args);
}

/** 我们自己的关键词表模板（`SEARCH_QUERY_CSV_HEADER` 的列名 == 规范列名，identity 支认得）。 */
const WEB_CSV = [
  'query,page_url,impressions,clicks,ctr_check,citations',
  `工业除尘器,${SEED_SITE_DOMAIN}/,1200,36,0.03,`,
  `锅炉烟气除尘改造,${SEED_SITE_DOMAIN}/news/dust-retrofit-case,300,9,0.03,`,
].join('\n');

/** 第二行故意把点击数写成文字 ⇒ 行级错误指到行号，好行照样入库（DR-98 行级容错）。 */
const WEB_CSV_ONE_BAD_ROW = [
  'query,page_url,impressions,clicks,ctr_check,citations',
  `工业除尘器,${SEED_SITE_DOMAIN}/,1200,36,0.03,`,
  `锅炉烟气除尘改造,${SEED_SITE_DOMAIN}/news/dust-retrofit-case,300,abc,0.03,`,
].join('\n');

/** 平台给的点击率与重算值差 0.06（> `CTR_CHECK_TOLERANCE`）⇒ warning 不阻断（DR-98）。 */
const WEB_CSV_CTR_MISMATCH = [
  'query,page_url,impressions,clicks,ctr_check,citations',
  `工业除尘器,${SEED_SITE_DOMAIN}/,1200,36,0.09,`,
].join('\n');

/** 百度《AI 流量分析》后台表格：中文表头、**列序打乱**、多一列认不出的（进 C 类留档，DR-107 / DR-113）。 */
const BAIDU_AI_TSV = [
  ['AI点击率', '关键词', '备注', 'AI引用量', 'AI曝光量', 'AI点击量'].join('\t'),
  ['27.50%', '工业除尘器', '灰度期', '320', '1,420', '88'].join('\t'),
].join('\n');

const PERIOD = { period_start: '2026-09-01', period_end: '2026-09-27' };
const IMPORTED_KIND = 'gsc';

afterEach(() => {
  resetDemoDb();
});

describe('demo/handlers/search · search_board（六块首屏 + 自建索引覆盖）', () => {
  it('一次端回六块，各自逐字来自种子（源按目录表序、明细按周期序）', async () => {
    const result = await board();

    expect(result.sources.map((row) => row.kind)).toEqual(SEED_SEARCH_SOURCES.map((row) => row.kind));
    expect(result.metrics).toHaveLength(SEED_SEARCH_QUERY_METRICS.length);
    expect(result.ai_overviews).toHaveLength(1);
    expect(result.ai_overviews[0]?.source_kind).toBe('baidu_ziyuan_ai');
    expect(result.native_extras.length).toBeGreaterThan(0);
    expect(result.opportunities).toHaveLength(6);
    expect(result.self_index_snapshots).toEqual(SEED_SELF_INDEX_SNAPSHOTS);
  });

  it('self_index_summary 由快照聚合出来：引擎数 / 关键题数 / 轮次数去重，last_run_at 取最近一次观测', async () => {
    const result = await board();
    const summary = result.self_index_summary;

    expect(summary).not.toBeNull();
    expect(summary?.engines_covered).toBe(new Set(SEED_SELF_INDEX_SNAPSHOTS.map((row) => row.engine)).size);
    expect(summary?.queries_covered).toBe(new Set(SEED_SELF_INDEX_SNAPSHOTS.map((row) => row.key)).size);
    expect(summary?.rounds_covered).toBe(new Set(SEED_SELF_INDEX_SNAPSHOTS.map((row) => row.round_id)).size);
    expect(summary?.last_run_at).toBe(
      SEED_SELF_INDEX_SNAPSHOTS.map((row) => row.observed_at).sort().at(-1),
    );
  });

  it('traffic_split 端出这个项目的流量三分（DR-111：分布数字来自种子，不是内置的市场份额表）', async () => {
    const result = await board();

    // 🔴 端出来的是**契约形状**（`engine` + `share`）：库里的行还挂着 `project_id`，
    // 那是 demo 的存储细节，不许跟着回到前端（照 `SearchSource` 与种子行的关系）。
    expect(result.traffic_split).toEqual(
      SEED_SEARCH_TRAFFIC_SPLIT.map(({ engine, share }) => ({ engine, share })),
    );
    // 深拷：改返回体不许污染内存库，否则第二次 board() 会拿到被改过的分布。
    result.traffic_split[0]!.share = 0.01;
    expect((await board()).traffic_split[0]?.share).toBe(0.62);
  });

  it('没有快照的项目回 null（界面显示空态，不抛错）；归档项目六块都空、流量分布也空', async () => {
    const result = await board(SEED_ARCHIVED_PROJECT_ID);

    expect(result.self_index_summary).toBeNull();
    expect(result.sources).toEqual([]);
    expect(result.metrics).toEqual([]);
    expect(result.opportunities).toEqual([]);
    // 🔴 空数组而不是种子那一份：DR-111 的裁定是"没有 analytics 数据时**不显示建议**"，
    // 归档项目一份来源分析都没有，端出分布就等于替它编了一份推荐。
    expect(result.traffic_split).toEqual([]);
  });

  it('认不出的项目 ⇒ project/not_found（三件套带 kind 与 id）', async () => {
    const cause = await capture(() => board('00000000-0000-4000-8000-0000000000aa'));

    expect(errorCode(cause)).toBe('project/not_found');
    expect(errorParams(cause)).toEqual({ kind: 'project', id: '00000000-0000-4000-8000-0000000000aa' });
  });

  it('端出来的是深拷：改返回体不会污染内存库（刷新即重置的前提）', async () => {
    const result = await board();
    result.sources[0]!.status = 'failed';

    expect(getDemoDb().searchSources[0]!.status).toBe(SEED_SEARCH_SOURCES[0]!.status);
  });
});

describe('demo/handlers/search · search_source_upsert / _remove / _test', () => {
  it('新建一个源：分组 / 区域 / 凭据形态 / 取数形态**逐字来自目录表**，不收用户输入（DR-108）', async () => {
    const source = await demoInvoke<SearchSource>('search_source_upsert', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
      kind: 'gsc',
      binding: { siteUrl: 'https://www.yunqi-suite.example.com/' },
      note: null,
    });

    expect(source.group).toBe('webmaster_global');
    expect(source.region).toBe('global');
    expect(source.auth_mode).toBe('oauth');
    expect(source.ingest_modes).toEqual(['api', 'file_import', 'paste_parse']);
    expect(source.status).toBe('pending_verify');
    // 🔴 规则 3：库里只有引用串（账号级两段），没有任何形如 token 的值。
    expect(source.secret_ref).toBe('keyring://search/gsc');
    expect(source.credentials_state).toBe('missing');
    expect(source.data_through).toBeNull();
    expect(source.checked_at).toBeNull();
  });

  it('同 kind 再存一次 ⇒ 覆盖同一行（一个项目每 kind 至多一条），且上一次的自检结论作废', async () => {
    const before = SEED_SEARCH_SOURCES.find((row) => row.kind === 'gsc')!;
    expect(before.checked_at).not.toBeNull();

    const source = await demoInvoke<SearchSource>('search_source_upsert', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'gsc',
      binding: { siteUrl: `${SEED_SITE_DOMAIN}/` },
      note: '换了资源库地址',
    });
    const rows = getDemoDb().searchSources.filter((row) => row.kind === 'gsc');

    expect(rows).toHaveLength(1);
    expect(source.id).toBe(before.id);
    expect(source.note).toBe('换了资源库地址');
    expect(source.checked_at).toBeNull();
    expect(source.check_detail).toBeNull();
    expect(source.status).toBe('pending_verify');
    // 已经导入过的数据不因改配置而消失（它的截至日照旧挂在源上）。
    expect(source.data_through).toBe(before.data_through);
  });

  it('`manual` 没有绑定字段 ⇒ 建档即可用；绑定填不全的源停在 not_configured', async () => {
    const manual = await demoInvoke<SearchSource>('search_source_upsert', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
      kind: 'manual',
      binding: {},
      note: null,
    });
    const partial = await demoInvoke<SearchSource>('search_source_upsert', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
      kind: 'baidu_tongji',
      binding: {},
      note: null,
    });

    expect(manual.status).toBe('ready');
    expect(manual.credentials_state).toBe('not_required');
    expect(manual.secret_ref).toBeNull();
    expect(partial.status).toBe('not_configured');
    expect(partial.binding).toEqual({});
  });

  it('不收凭据：入参里塞 password / token 既不落库、也不进错误 params，键集恰好是契约那 17 个', async () => {
    const source = await demoInvoke<SearchSource>('search_source_upsert', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
      kind: 'bing_wmt',
      binding: { siteUrl: 'https://www.yunqi-suite.example.com/', siteId: 'ignored' },
      note: null,
      password: 'hunter2',
      token: 'ya29.secret',
    });

    expect(Object.keys(source).sort()).toEqual([
      'auth_mode', 'binding', 'check_detail', 'checked_at', 'created_at', 'credentials_state',
      'data_through', 'group', 'id', 'ingest_modes', 'kind', 'note', 'project_id', 'region',
      'secret_ref', 'status', 'updated_at',
    ]);
    expect(JSON.stringify(source)).not.toContain('hunter2');
    expect(JSON.stringify(source)).not.toContain('ya29.secret');
    // `bing_wmt` 的目录行只认 siteUrl ⇒ siteId 不是它的绑定字段。
    expect(source.binding).toEqual({ siteUrl: 'https://www.yunqi-suite.example.com/' });
  });

  it('认不出的 kind 与二期源都拒（`validation/failed` 三件套；二期开放只改目录表）', async () => {
    const unknown = await capture(() =>
      demoInvoke('search_source_upsert', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        kind: 'no_such_source',
        binding: {},
        note: null,
      }),
    );
    const phase2 = await capture(() =>
      demoInvoke('search_source_upsert', {
        project_id: SEED_ACTIVE_PROJECT_ID,
        kind: 'sogou',
        binding: {},
        note: null,
      }),
    );

    expect(errorParams(unknown)).toEqual({ field: 'source_kind', reason: 'not_allowed', value: 'no_such_source' });
    expect(errorCode(unknown)).toBe('validation/failed');
    expect(errorCode(phase2)).toBe('validation/failed');
    expect(errorParams(phase2)).toEqual({ field: 'source_kind', reason: 'not_allowed', value: 'sogou' });
  });

  it('移除一个源 ⇒ 连带删掉它导入的指标行、AI 汇总与原生字段留档，回剩余快照；重复移除幂等', async () => {
    const before = await board();
    expect(before.metrics.some((row) => row.source_kind === 'bing_wmt')).toBe(true);

    const remaining = await demoInvoke<SearchSource[]>('search_source_remove', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'bing_wmt',
    });
    const after = await board();

    expect(remaining.map((row) => row.kind)).not.toContain('bing_wmt');
    expect(after.sources).toHaveLength(before.sources.length - 1);
    expect(after.metrics.some((row) => row.source_kind === 'bing_wmt')).toBe(false);
    expect(after.native_extras.some((row) => row.source_kind === 'bing_wmt')).toBe(false);
    // 别的源一条不动。
    expect(after.metrics.filter((row) => row.source_kind === 'gsc')).toHaveLength(
      before.metrics.filter((row) => row.source_kind === 'gsc').length,
    );

    const again = await demoInvoke<SearchSource[]>('search_source_remove', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'bing_wmt',
    });
    expect(again).toHaveLength(remaining.length);
  });

  it('移除 AI 面的源 ⇒ 它的项目级 AI 汇总也一起走（不留"查不到出处的数字"）', async () => {
    await demoInvoke('search_source_remove', { project_id: SEED_ACTIVE_PROJECT_ID, kind: 'baidu_ziyuan_ai' });
    const after = await board();

    expect(after.ai_overviews).toEqual([]);
    expect(after.metrics.some((row) => row.source_kind === 'baidu_ziyuan_ai')).toBe(false);
  });

  it('移除源 ⇒ 依赖它指标的机会一起失效，剩余机会的证据 id 不再悬空', async () => {
    const before = await board();
    const removedIds = new Set(
      before.metrics.filter((row) => row.source_kind === 'toutiao').map((row) => row.id),
    );
    expect(
      before.opportunities.some((row) =>
        row.evidence_metric_ids.some((id) => removedIds.has(id)),
      ),
    ).toBe(true);

    await demoInvoke('search_source_remove', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'toutiao',
    });
    const after = await board();
    const liveMetricIds = new Set(after.metrics.map((row) => row.id));

    for (const opportunity of after.opportunities) {
      for (const id of opportunity.evidence_metric_ids) {
        expect(liveMetricIds.has(id), `机会 ${opportunity.id} 仍引用已删除指标 ${id}`).toBe(true);
      }
    }
    expect(after.opportunities.length).toBeLessThan(before.opportunities.length);
  });

  it('移除站内分析源 ⇒ 流量分布一起清空，接入建议不再基于已删数据（DR-111）', async () => {
    expect((await board()).traffic_split.length).toBeGreaterThan(0);

    await demoInvoke('search_source_remove', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'baidu_tongji',
    });
    const after = await board();

    expect(after.traffic_split).toEqual([]);
    expect(after.sources.some((row) => row.kind === 'baidu_tongji')).toBe(false);
  });

  it('自检**不联网**：结论逐字来自预置表，翻 checked_at / check_detail / status', async () => {
    const probe = SEED_SEARCH_SOURCE_PROBES.toutiao;
    const source = await demoInvoke<SearchSource>('search_source_test', {
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'toutiao',
    });

    expect(source.check_detail).toBe(probe.check_detail);
    expect(source.status).toBe(probe.status);
    expect(source.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(source.updated_at).toBe(source.checked_at);
    // 自检不动数据：明细行数与截至日都不变。
    expect(getDemoDb().searchMetrics).toHaveLength(SEED_SEARCH_QUERY_METRICS.length);
    expect(source.data_through).toBe('2026-08-20');
  });

  it('自检即建档：这个项目还没有该源的行时先按目录表补一行，再写结论（照 site_channel_test）', async () => {
    const source = await demoInvoke<SearchSource>('search_source_test', {
      project_id: SEED_ARCHIVED_PROJECT_ID,
      kind: 'baidu_ziyuan',
    });

    expect(source.project_id).toBe(SEED_ARCHIVED_PROJECT_ID);
    expect(source.binding).toEqual({});
    // 预置结论是 `ready`，但这一行没有填任何绑定 ⇒ 不能把“未配置”说成可用。
    expect(source.status).toBe('not_configured');
    // 结论文字也必须跟状态一致：不能一边说未配置、一边说“站点已验证”。
    expect(source.check_detail).not.toContain('站点已验证');
    expect(source.check_detail).toBe(SEED_SEARCH_BINDING_BLOCKED_DETAIL);
  });
});

describe('demo/handlers/search · search_opportunity_update（只翻状态，不重算）', () => {
  it('翻成 adopted / ignored 只改 status 与 updated_at，依据与证据一条不动', async () => {
    const target = 'demo-sop-003';
    // 🔴 handler 照 `site-patch.ts` 的姿态**原地改行**（`opportunity.updated_at = stamp`），
    // 所以这里必须先拷一份快照，否则 `before` 与 `after` 指向同一行、断言恒真。
    const before = { ...getDemoDb().searchOpportunities.find((row) => row.id === target)! };

    const after = await demoInvoke<SearchOpportunity>('search_opportunity_update', {
      opportunity_id: target,
      status: 'adopted',
    });

    expect(after.status).toBe('adopted');
    expect(after.updated_at).not.toBe(before.updated_at);
    expect(after.basis).toBe(before.basis);
    expect(after.evidence_metric_ids).toEqual(before.evidence_metric_ids);
    expect(after.created_at).toBe(before.created_at);
  });

  it('翻状态不会长出新机会（DR-99：机会清单是静态的，导入与翻状态都不重算）', async () => {
    await demoInvoke('search_opportunity_update', { opportunity_id: 'demo-sop-001', status: 'ignored' });
    const result = await board();

    expect(result.opportunities).toHaveLength(6);
    expect(result.opportunities.map((row) => row.rule_id).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('认不出的 id 与契约外的 status 都拒（三件套 field / reason / value）', async () => {
    const missing = await capture(() =>
      demoInvoke('search_opportunity_update', { opportunity_id: 'demo-sop-999', status: 'adopted' }),
    );
    const badStatus = await capture(() =>
      demoInvoke('search_opportunity_update', { opportunity_id: 'demo-sop-001', status: 'done' }),
    );

    expect(errorCode(missing)).toBe('validation/failed');
    expect(errorParams(missing)).toEqual({
      field: 'opportunity_id',
      reason: 'invalid_id',
      value: 'demo-sop-999',
    });
    expect(errorCode(badStatus)).toBe('validation/failed');
    expect(errorParams(badStatus)).toEqual({
      field: 'opportunity_status',
      reason: 'not_allowed',
      value: 'done',
    });
  });
});

describe('demo/handlers/search · search_metric_import_csv（CSV / 粘贴 / xlsx 三条入口，一条命令）', () => {
  it('AI 汇总模板 ⇒ 写 SearchAiOverview，不伪造 query 行；同周期重复导入覆盖不叠数', async () => {
    const payload = 'citations,impressions,ai_clicks,ai_ctr_check,cited_pages\n1200,6106,90,7.5%,18\n';
    const first = await importCsv({
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'baidu_ziyuan_ai',
      payload,
      ...PERIOD,
    });

    expect(first.errors).toEqual([]);
    expect(first.metrics).toEqual([]);
    expect(first.ai_overviews).toHaveLength(1);
    const overview = first.ai_overviews[0]!;
    expect(overview).toMatchObject({
      source_kind: 'baidu_ziyuan_ai',
      citations: 1200,
      ai_impressions: 6106,
      ai_clicks: 90,
      cited_pages: 18,
      period_start: PERIOD.period_start,
      period_end: PERIOD.period_end,
    });
    expect(overview.ai_ctr).toBeCloseTo(90 / 1200, 6);
    expect((await board()).ai_overviews.some((row) => row.id === overview.id)).toBe(true);

    const second = await importCsv({
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'baidu_ziyuan_ai',
      payload,
      ...PERIOD,
    });
    expect(second.ai_overviews).toHaveLength(1);
    const sameSlot = (await board()).ai_overviews.filter(
      (row) =>
        row.source_kind === 'baidu_ziyuan_ai' &&
        row.period_start === PERIOD.period_start &&
        row.period_end === PERIOD.period_end,
    );
    expect(sameSlot).toHaveLength(1);
  });

  it('🔴 仅表头的 AI 汇总文件不删除旧 summary（0 数据行 = 成功但不清槽）', async () => {
    const before = (await board()).ai_overviews.find(
      (row) => row.source_kind === 'baidu_ziyuan_ai',
    );
    expect(before).toBeDefined();

    const payload = `${SEARCH_AI_SUMMARY_CSV_HEADER.join(',')}\n`;
    const result = await importCsv({
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'baidu_ziyuan_ai',
      payload,
      period_start: before!.period_start,
      period_end: before!.period_end,
    });

    expect(result.errors).toEqual([]);
    expect(result.ai_overviews).toEqual([]);
    const after = (await board()).ai_overviews.find(
      (row) => row.source_kind === 'baidu_ziyuan_ai',
    );
    expect(after).toMatchObject({
      citations: before!.citations,
      ai_impressions: before!.ai_impressions,
      ai_clicks: before!.ai_clicks,
      cited_pages: before!.cited_pages,
    });
  });

  it('CSV 文本 ⇒ 好行入库：ctr 一律重算、区间由导入时确认、mapping_version 记当前版本', async () => {
    const importedAt = new Date().toISOString();
    const result = await importCsv({
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: IMPORTED_KIND,
      payload: WEB_CSV,
      ...PERIOD,
    });

    expect(result.errors).toEqual([]);
    expect(result.metrics).toHaveLength(2);
    const [first] = result.metrics;
    expect(first!.source_kind).toBe('gsc');
    expect(first!.surface).toBe('web_search');
    expect(first!.query).toBe('工业除尘器');
    expect(first!.impressions).toBe(1200);
    expect(first!.clicks).toBe(36);
    // 🔴 B 类只能重算：平台给的 `ctr_check` 不作真值（DR-95 / DR-98）。
    expect(first!.ctr).toBeCloseTo(36 / 1200, 6);
    expect(first!.citations).toBeNull();
    expect(first!.period_start).toBe(PERIOD.period_start);
    expect(first!.period_end).toBe(PERIOD.period_end);
    expect(first!.window_source).toBe('user_stated');
    expect(first!.mapping_version).toBe(MAPPING_VERSION);
    expect(first!.imported_at >= importedAt).toBe(true);
    expect(first!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // 导入后该源的截至日 = 目录表推出来的平台可用日与区间末日取更早的那个（DR-109）。
    expect(result.data_through).toBe(
      resolveDataThrough('gsc', { period_end: PERIOD.period_end, imported_at: first!.imported_at }),
    );
    expect((await board()).sources.find((row) => row.kind === 'gsc')!.data_through).toBe(result.data_through);
  });

  it('同周期同源再导一次 ⇒ 覆盖旧行（删除是导入的一个分支，所以没有 search_metric_delete）', async () => {
    await importCsv({ project_id: SEED_ACTIVE_PROJECT_ID, kind: IMPORTED_KIND, payload: WEB_CSV, ...PERIOD });
    const seeded = SEED_SEARCH_QUERY_METRICS.filter((row) => row.source_kind === IMPORTED_KIND).length;
    const second = await importCsv({
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: IMPORTED_KIND,
      payload: WEB_CSV,
      ...PERIOD,
    });
    const after = await board();

    expect(second.metrics).toHaveLength(2);
    expect(after.metrics.filter((row) => row.source_kind === IMPORTED_KIND)).toHaveLength(2);
    expect(after.metrics.filter((row) => row.source_kind === IMPORTED_KIND).length).toBeLessThan(seeded);
    // 别的源与别的周期一条不动。
    expect(after.metrics.filter((row) => row.source_kind === 'baidu_ziyuan')).toHaveLength(6);
  });

  it('行级容错：坏行进 errors 指到行号，好行照样入库', async () => {
    const result = await importCsv({
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: IMPORTED_KIND,
      payload: WEB_CSV_ONE_BAD_ROW,
      ...PERIOD,
    });

    expect(result.metrics).toHaveLength(1);
    expect(result.errors).toEqual([{ row: 3, reason: 'invalid_format', params: { column: 'clicks', value: 'abc' } }]);
  });

  it('平台给的点击率与重算值偏差 > 0.005 ⇒ warning 不阻断，入库仍是重算值', async () => {
    const result = await importCsv({
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: IMPORTED_KIND,
      payload: WEB_CSV_CTR_MISMATCH,
      ...PERIOD,
    });

    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0]!.ctr).toBeCloseTo(36 / 1200, 6);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.kind).toBe('ctr_mismatch');
    expect(result.warnings[0]!.row).toBe(2);
  });

  it('粘贴后台表格：中文表头 + 列序打乱也认，认不出的列进 C 类留档而不是被丢掉', async () => {
    const result = await importCsv({
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'baidu_ziyuan_ai',
      payload: BAIDU_AI_TSV,
      ...PERIOD,
    });

    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0]!.surface).toBe('ai_answer');
    expect(result.metrics[0]!.citations).toBe(320);
    expect(result.metrics[0]!.impressions).toBe(1420);
    expect(result.metrics[0]!.clicks).toBe(88);
    // AI 面那五项里没有 ai_clicks（它属于项目级汇总表）⇒ 行上是 null，不拿 clicks 顶。
    expect(result.metrics[0]!.ai_clicks).toBeNull();
    const extra = result.native_extras.find((row) => row.label === '备注');
    expect(extra?.value).toBe('灰度期');
    expect(extra?.metric_id).toBe(result.metrics[0]!.id);
    // 百度官方口径的 AI点击率 = 点击量 ÷ 引用量，与行级 `clicks ÷ impressions` 不是一回事 ⇒ 交叉校验报 warning。
    expect(result.warnings.map((row) => row.kind)).toEqual(['ctr_mismatch']);
  });

  it('真实 fixture：百度官方导出的**空表**导入成功、0 行、合计不变，源的截至日仍记导入时确认的区间', async () => {
    const before = await board();
    const result = await importCsv({
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'baidu_ziyuan_ai',
      payload: toBase64(BAIDU_AI_XLSX),
      ...PERIOD,
    });
    const after = await board();

    expect(result.metrics).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.data_through).toBe(PERIOD.period_end);
    expect(after.metrics).toHaveLength(before.metrics.length);
    expect(after.sources.find((row) => row.kind === 'baidu_ziyuan_ai')!.data_through).toBe(PERIOD.period_end);
  });

  it('xlsx 也认 data URI 形态（浏览器 FileReader 读出来就是这个样子）', async () => {
    const result = await importCsv({
      project_id: SEED_ACTIVE_PROJECT_ID,
      kind: 'baidu_ziyuan_ai',
      payload: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${toBase64(BAIDU_AI_XLSX)}`,
      ...PERIOD,
    });

    expect(result.metrics).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('data URI 指向的不是 xlsx ⇒ 稳定错误码，不崩、不猜（走查 20 / E-72 ③）', async () => {
    const cause = await capture(() =>
      importCsv({
        project_id: SEED_ACTIVE_PROJECT_ID,
        kind: IMPORTED_KIND,
        payload: `data:application/pdf;base64,${toBase64(new Uint8Array([0x25, 0x50, 0x44, 0x46]))}`,
        ...PERIOD,
      }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)).toEqual({ field: 'payload', reason: 'not_allowed', value: 'application/pdf' });
  });

  it('表头认不出 / 内容为空 ⇒ 一行都没进，抛稳定错误码并把逐行原因放进 detail', async () => {
    const unknownHeader = await capture(() =>
      importCsv({
        project_id: SEED_ACTIVE_PROJECT_ID,
        kind: IMPORTED_KIND,
        payload: 'foo,bar\n1,2',
        ...PERIOD,
      }),
    );
    const empty = await capture(() =>
      importCsv({ project_id: SEED_ACTIVE_PROJECT_ID, kind: IMPORTED_KIND, payload: '   ', ...PERIOD }),
    );

    expect(errorCode(unknownHeader)).toBe('validation/failed');
    expect(errorParams(unknownHeader)?.field).toBe('payload');
    expect(errorParams(unknownHeader)?.reason).toBe('unknown_field');
    expect(errorCode(empty)).toBe('validation/failed');
    expect(errorParams(empty)).toEqual({ field: 'payload', reason: 'empty', value: '' });
  });

  it('区间必填、必须是日期、且起点不得晚于终点（区间靠导入时确认，DR-98）', async () => {
    const missing = await capture(() =>
      importCsv({
        project_id: SEED_ACTIVE_PROJECT_ID,
        kind: IMPORTED_KIND,
        payload: WEB_CSV,
        period_start: '2026-09-01',
      }),
    );
    const badShape = await capture(() =>
      importCsv({
        project_id: SEED_ACTIVE_PROJECT_ID,
        kind: IMPORTED_KIND,
        payload: WEB_CSV,
        period_start: '2026/09/01',
        period_end: '2026-09-27',
      }),
    );
    const inverted = await capture(() =>
      importCsv({
        project_id: SEED_ACTIVE_PROJECT_ID,
        kind: IMPORTED_KIND,
        payload: WEB_CSV,
        period_start: '2026-09-27',
        period_end: '2026-09-01',
      }),
    );

    expect(errorParams(missing)).toEqual({ field: 'period_end', reason: 'required' });
    expect(errorParams(badShape)).toEqual({
      field: 'period_start',
      reason: 'invalid_format',
      value: '2026/09/01',
    });
    expect(errorParams(inverted)).toEqual({
      field: 'period_start',
      reason: 'out_of_range',
      value: '2026-09-27',
      expected: '<=2026-09-01',
    });
  });

  it('导入即建档：这个源还没配过也能导（数据真的进来了就说明源可用），并回写截至日', async () => {
    const result = await importCsv({
      project_id: SEED_ARCHIVED_PROJECT_ID,
      kind: 'toutiao',
      payload: WEB_CSV,
      ...PERIOD,
    });
    const after = await board(SEED_ARCHIVED_PROJECT_ID);
    const source = after.sources.find((row) => row.kind === 'toutiao')!;

    expect(result.metrics).toHaveLength(2);
    expect(source.status).toBe('ready');
    expect(source.data_through).toBe(result.data_through);
    expect(after.metrics).toHaveLength(2);
  });

  it('站内分析源（百度统计）没有已核实别名 ⇒ 粘贴表整批被拒，一行都不进（DR-95 C 类 / DR-110 护栏 2）', async () => {
    // 🔴 规范列里**没有** `sessions` 这个落库位（`api/search-mapping.ts` 文件头那条裁定）：
    // 会话数是站内量纲，映射进来就等于暗示它能与曝光并列 ⇒ 它的种子行走 C 类留档，
    // 而**导入**这一支在表头级就被拒（认不出一列 ⇒ `tableRejection`，不是行级容错）。
    const payload = ['关键词\t会话数\t落地页', `工业除尘器\t412\t${SEED_SITE_DOMAIN}/`].join('\n');
    const seeded = SEED_SEARCH_QUERY_METRICS.filter((row) => row.source_kind === 'baidu_tongji').length;

    const cause = await capture(() =>
      importCsv({ project_id: SEED_ACTIVE_PROJECT_ID, kind: 'baidu_tongji', payload, ...PERIOD }),
    );

    expect(errorCode(cause)).toBe('validation/failed');
    expect(errorParams(cause)?.field).toBe('payload');
    expect(errorParams(cause)?.reason).toBe('unknown_field');
    // 整批被拒 ⇒ 库里既没多一行、也没被覆盖掉一行。
    expect(getDemoDb().searchMetrics.filter((row) => row.source_kind === 'baidu_tongji')).toHaveLength(seeded);
  });

  it('认不出的 kind ⇒ 拒；不给项目 ⇒ project/not_found', async () => {
    const badKind = await capture(() =>
      importCsv({ project_id: SEED_ACTIVE_PROJECT_ID, kind: 'so_360', payload: WEB_CSV, ...PERIOD }),
    );
    const badProject = await capture(() =>
      importCsv({ project_id: 'no-such-project', kind: IMPORTED_KIND, payload: WEB_CSV, ...PERIOD }),
    );

    expect(errorParams(badKind)).toEqual({ field: 'source_kind', reason: 'not_allowed', value: 'so_360' });
    expect(errorCode(badProject)).toBe('project/not_found');
  });
});

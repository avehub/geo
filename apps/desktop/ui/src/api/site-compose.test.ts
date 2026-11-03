/**
 * 站点补丁六种导出物的判据（spec `2026-09-30-site-connect-patch-bench-design.md` DR-53）。
 *
 * # 钉四件事
 * ① **两道筛选口径**（AGENTS 规则 6）：交接单 / `llms.txt` / `robots.txt` 只收
 *   `review_status === 'approved'`，`patches.json` 只收 `status === 'published'`；
 *   零条可用一律回 `null`（界面据此置灰，而不是导出一份空壳）；
 * ② **`patches.json` 下发的是快照而不是草案**：`published_body` 优先于 `body`（DR-47）；
 * ③ **边缘函数骨架里没有任何一条补丁的正文**（照 Ahrefs 的分工：逻辑在客户侧、数据在我们侧）；
 * ④ 文件名一律 ASCII（中文文件名在 `download` 属性里会掉）、只有 CSV 需要 BOM。
 *
 * 🔴 界面文案经 `t()` 传进来 ⇒ 中文界面导出中文交接单、切英文再导出就是英文的，
 * 同一份数据。语言切换用 `i18n.getFixedT(...)`（不动全局单例，照 `api/errors.test.ts`）。
 */
import { describe, expect, it } from 'vitest';

import {
  SITE_EXPORTABLE_KINDS,
  SITE_LEDGER_CSV_HEADER,
  composeLedgerCsv,
  composeLlmsTxt,
  composePatchesJson,
  composeRobotsTxt,
  composeSiteBundle,
  composeWorkerJs,
  siteExportFileName,
  siteExportNeedsBom,
} from './site-compose';
import type { SitePatch, SitePatchEvent } from './types';
import { i18n } from '../i18n';

const PROJECT_ID = 'a1f3c0d2-4b6e-4a11-9f3c-7d2e5b8a0c14';
const DOMAIN = 'https://www.lanzhou-hb.example.com';

const zh = () => i18n.getFixedT('zh-CN');
const en = () => i18n.getFixedT('en-US');

const CJK = /[\u3000-\u303f\u4e00-\u9fa5\uff00-\uffef]/;

function patch(overrides: Partial<SitePatch> = {}): SitePatch {
  return {
    id: 'demo-site-patch-001',
    project_id: PROJECT_ID,
    action_id: 'demo-act-001',
    round_id: 'demo-round-baseline',
    kind: 'html_fragment',
    title: 'Definition paragraph on the product page',
    target_url: `${DOMAIN}/products/bag-filter`,
    target_hint: 'above the fold',
    body: '<section id="definition"><p>body</p></section>',
    published_body: null,
    published_kind: null,
    published_target_url: null,
    published_channel_kind: null,
    status: 'draft',
    review_status: 'approved',
    channel_kind: 'bundle',
    source: 'generated',
    position: 0,
    published_at: null,
    created_at: '2026-09-17T02:00:00Z',
    updated_at: '2026-09-19T08:00:00Z',
    ...overrides,
  };
}

/** 一条已发布、且发布后又改过草案的补丁（`patches.json` 的口径就靠它才分得出来）。 */
function publishedAfterEdit(): SitePatch {
  return patch({
    id: 'demo-site-patch-003',
    kind: 'llms_txt',
    title: 'Publish llms.txt',
    target_url: `${DOMAIN}/llms.txt`,
    body: '# draft revision (must not be shipped)',
    published_body: '# live snapshot (must be shipped)',
    published_kind: 'meta_title',
    published_target_url: `${DOMAIN}/old-target`,
    published_channel_kind: 'cms',
    status: 'published',
    published_at: '2026-09-20T02:30:00Z',
  });
}

describe('api/site-compose · 交接单 Markdown（bundle）', () => {
  it('🔴 只收已人工审核通过的补丁：pending_review / rejected 一律不进交接单', () => {
    const bundle = composeSiteBundle(zh(), [
      patch({ id: 'a', title: 'Approved one', body: 'APPROVED-BODY' }),
      patch({ id: 'b', title: 'Pending one', body: 'PENDING-BODY', review_status: 'pending_review' }),
      patch({ id: 'c', title: 'Rejected one', body: 'REJECTED-BODY', review_status: 'rejected' }),
    ]);

    expect(bundle).toContain('APPROVED-BODY');
    expect(bundle).not.toContain('PENDING-BODY');
    expect(bundle).not.toContain('REJECTED-BODY');
    // 计数行只数可用的那一条
    expect(bundle).toContain(zh()('site.export.bundleCount', { total: 1 }));
  });

  it('零条可用 ⇒ null（界面据此置灰并说明原因）', () => {
    expect(composeSiteBundle(zh(), [])).toBeNull();
    expect(
      composeSiteBundle(zh(), [patch({ review_status: 'pending_review' })]),
    ).toBeNull();
  });

  it('一条补丁一节：落点 / 类型 / 通道 / 状态 / 贴在哪 / 正文围栏 / 验收动作都在', () => {
    const bundle = composeSiteBundle(zh(), [patch()]) ?? '';

    expect(bundle.startsWith(`# ${zh()('site.export.bundleTitle')}\n`)).toBe(true);
    expect(bundle).toContain(zh()('site.export.bundleDisclaimer'));
    expect(bundle).toContain('## 1. Definition paragraph on the product page');
    expect(bundle).toContain(`${zh()('site.export.bundleTarget')}: ${DOMAIN}/products/bag-filter`);
    // 枚举一律渲染成词典标签，绝不露 `html_fragment` 这种机器记号
    expect(bundle).toContain(zh()('site.export.bundleKind') + ': ' + zh()('site.patchKinds.html_fragment'));
    expect(bundle).not.toContain('html_fragment');
    expect(bundle).toContain(`${zh()('site.export.bundleHint')}: above the fold`);
    expect(bundle).toContain('```html');
    expect(bundle).toContain(zh()('site.export.bundleVerify'));
    expect(bundle.endsWith('\n')).toBe(true);
  });

  it('target_hint 为 null 时不出那一行；来自处方那一行带 action_id', () => {
    const bundle = composeSiteBundle(zh(), [patch({ target_hint: null })]) ?? '';

    expect(bundle).not.toContain(zh()('site.export.bundleHint'));
    expect(bundle).toContain(`${zh()('site.export.bundleAction')}: demo-act-001`);
  });

  it('围栏语言按补丁类型挑（JSON-LD 是 html、实体口径是 markdown）', () => {
    expect(composeSiteBundle(zh(), [patch({ kind: 'jsonld' })])).toContain('```html');
    expect(composeSiteBundle(zh(), [patch({ kind: 'entity_consistency' })])).toContain('```markdown');
    expect(composeSiteBundle(zh(), [patch({ kind: 'robots_txt' })])).toContain('```text');
  });

  it('同一份数据、两种语言：切到 en 之后节标题与表头都是英文', () => {
    const rows = [patch()];
    const chinese = composeSiteBundle(zh(), rows) ?? '';
    const english = composeSiteBundle(en(), rows) ?? '';

    expect(chinese).toContain(zh()('site.export.bundleTitle'));
    expect(english).toContain(en()('site.export.bundleTitle'));
    expect(english).not.toContain(zh()('site.export.bundleTitle'));
    // 数据部分逐字不动（正文与落点是数据，不跟着界面语言走）
    expect(english).toContain(`${DOMAIN}/products/bag-filter`);
    expect(english).toContain('<section id="definition"><p>body</p></section>');
  });
});

describe('api/site-compose · 站点根目录文件（llms.txt / robots.txt）', () => {
  it('只收同类 + 已审核通过；正文按顺序接起来，空行分隔，末尾一个换行', () => {
    const txt =
      composeLlmsTxt([
        patch({ id: 'a', kind: 'llms_txt', body: '  FIRST  ' }),
        patch({ id: 'b', kind: 'llms_txt', body: 'SECOND' }),
        patch({ id: 'c', kind: 'robots_txt', body: 'WRONG-KIND' }),
        patch({ id: 'd', kind: 'llms_txt', body: 'PENDING', review_status: 'pending_review' }),
      ]) ?? '';

    expect(txt).toBe('FIRST\n\nSECOND\n');
    expect(txt).not.toContain('WRONG-KIND');
    expect(txt).not.toContain('PENDING');
  });

  it('robots.txt 走同一个口径，且与 llms.txt 互不串台', () => {
    const rows = [
      patch({ id: 'a', kind: 'llms_txt', body: 'LLMS' }),
      patch({ id: 'b', kind: 'robots_txt', body: 'User-agent: GPTBot\nAllow: /' }),
    ];

    expect(composeRobotsTxt(rows)).toBe('User-agent: GPTBot\nAllow: /\n');
    expect(composeLlmsTxt(rows)).toBe('LLMS\n');
  });

  it('零条可用 ⇒ null', () => {
    expect(composeLlmsTxt([])).toBeNull();
    expect(composeRobotsTxt([patch({ kind: 'llms_txt' })])).toBeNull();
    expect(composeRobotsTxt([patch({ kind: 'robots_txt', review_status: 'rejected' })])).toBeNull();
  });
});

describe('api/site-compose · patches.json（边缘函数实时拉取的那一份）', () => {
  it('🔴 只收已发布的补丁：草案与已撤回的一条都不进去', () => {
    const json =
      composePatchesJson([
        patch({ id: 'live', status: 'published', published_at: '2026-09-20T02:30:00Z' }),
        patch({ id: 'draft', status: 'draft' }),
        patch({ id: 'off', status: 'unpublished', published_at: null }),
      ]) ?? '';
    const parsed = JSON.parse(json) as { patches: Array<{ id: string }> };

    expect(parsed.patches.map((row) => row.id)).toEqual(['live']);
  });

  it('🔴 下发的是完整发布快照：body / kind / target_url / channel 都取上一次发布的值', () => {
    const parsed = JSON.parse(composePatchesJson([publishedAfterEdit()]) ?? '') as {
      patches: Array<{ body: string; kind: string; target_url: string; channel: string }>;
    };

    expect(parsed.patches[0]?.body).toBe('# live snapshot (must be shipped)');
    expect(parsed.patches[0]?.body).not.toContain('draft revision');
    expect(parsed.patches[0]?.kind).toBe('meta_title');
    expect(parsed.patches[0]?.target_url).toBe(`${DOMAIN}/old-target`);
    expect(parsed.patches[0]?.channel).toBe('cms');
  });

  it('🔴 已发布但审核态被降级的补丁不得进入 patches.json（DR-53 / 规则 6）', () => {
    const json = composePatchesJson([
      patch({ id: 'approved', status: 'published', review_status: 'approved' }),
      patch({ id: 'pending', status: 'published', review_status: 'pending_review' }),
      patch({ id: 'rejected', status: 'published', review_status: 'rejected' }),
    ]);
    const parsed = JSON.parse(json ?? '') as { patches: Array<{ id: string }> };
    expect(parsed.patches.map((row) => row.id)).toEqual(['approved']);
  });

  it('形状：version / generated_at（最晚的发布时刻，不是"现在"）/ project_id / patches', () => {
    const parsed = JSON.parse(
      composePatchesJson([
        patch({ id: 'early', status: 'published', published_at: '2026-09-19T08:00:00Z' }),
        publishedAfterEdit(),
      ]) ?? '',
    ) as { version: number; generated_at: string; project_id: string; patches: unknown[] };

    expect(parsed.version).toBe(1);
    expect(parsed.generated_at).toBe('2026-09-20T02:30:00Z');
    expect(parsed.project_id).toBe(PROJECT_ID);
    expect(parsed.patches).toHaveLength(2);
  });

  it('每行只有边缘函数需要的五个键（少一个字段就少一处漂移的可能）', () => {
    const parsed = JSON.parse(composePatchesJson([publishedAfterEdit()]) ?? '') as {
      patches: Array<Record<string, unknown>>;
    };

    expect(Object.keys(parsed.patches[0] ?? {}).sort()).toEqual([
      'body',
      'channel',
      'id',
      'kind',
      'target_url',
    ]);
  });

  it('零条已发布 ⇒ null', () => {
    expect(composePatchesJson([])).toBeNull();
    expect(composePatchesJson([patch({ status: 'draft' })])).toBeNull();
  });
});

describe('api/site-compose · 边缘函数骨架（worker.js）', () => {
  const URL = `${DOMAIN}/geo-site-patches-json-${PROJECT_ID}.json`;

  it('🔴 骨架里没有任何一条补丁的正文：逻辑在客户侧、数据在 patches.json 里', () => {
    const code = composeWorkerJs(zh(), PROJECT_ID, URL);
    const rows = [patch({ body: 'SECRET-PATCH-BODY' }), publishedAfterEdit()];

    // 组装函数根本不吃补丁清单 ⇒ 这条是结构性的，不是靠筛选筛出来的
    expect(composeWorkerJs.length).toBe(3);
    expect(code).not.toContain('SECRET-PATCH-BODY');
    expect(code).not.toContain('live snapshot');
    void rows;
  });

  it('PATCHES_URL 逐字是传进来的那个地址，且被 JSON.stringify 过（可安全嵌进代码）', () => {
    const code = composeWorkerJs(zh(), PROJECT_ID, URL);

    expect(code).toContain(`const PATCHES_URL = ${JSON.stringify(URL)};`);
    expect(code).toContain('export default {');
    expect(code).toContain('async fetch(request)');
  });

  it('只有 meta / canonical / jsonld / html_fragment 这几类在边缘生效，其余留给交接单', () => {
    const code = composeWorkerJs(zh(), PROJECT_ID, URL);

    expect(code).toContain(
      "const APPLIABLE = new Set(['meta_title', 'meta_description', 'canonical', 'jsonld', 'html_fragment']);",
    );
    // llms.txt / robots.txt 是根目录**文件**，走的是另一条分支（直接回正文）
    expect(code).toContain('ROOT_FILES');
  });

  it('🔴 代码全 ASCII：中文只出现在顶部三行注释里（这份文件要贴进客户的云控制台）', () => {
    const chinese = composeWorkerJs(zh(), PROJECT_ID, URL).split('\n');
    const english = composeWorkerJs(en(), PROJECT_ID, URL).split('\n');

    expect(chinese.filter((line) => CJK.test(line))).toHaveLength(3);
    for (const line of chinese.filter((entry) => CJK.test(entry))) {
      expect(line.startsWith('// '), `含中文的那一行必须是注释：${line}`).toBe(true);
    }
    expect(english.some((line) => CJK.test(line))).toBe(false);
    // 两种语言下代码主体逐字相同（只有注释变）
    expect(english.filter((line) => !line.startsWith('// '))).toEqual(
      chinese.filter((line) => !line.startsWith('// ')),
    );
  });

  it('project_id 进了响应头，便于在客户侧确认"这一份是谁下发的"', () => {
    const js = composeWorkerJs(zh(), PROJECT_ID, URL);

    // 值在顶部常量里注入，响应头处引用标识符（Worker 运行时才拼）
    expect(js).toContain(`const PROJECT_ID = ${JSON.stringify(PROJECT_ID)};`);
    expect(js).toContain("headers.set('x-geo-patches', `${PROJECT_ID}:${scoped.length}`);");
  });

  it('🔴 patches.json 不能被模块级永久缓存：短 TTL 后重新拉取（改补丁不需要重新部署函数）', () => {
    const js = composeWorkerJs(zh(), PROJECT_ID, URL);

    // 永久缓存会让"客户改完补丁只需更新 patches.json"这条承诺失效（DR-53）。
    expect(js).not.toContain('if (cache !== null) return cache;');
    expect(js).toContain('CACHE_TTL_MS');
    expect(js).toContain('cachedAt');
    expect(js).toContain('Date.now()');
  });
});

describe('api/site-compose · 台账留档 CSV（补丁 × 事件扁平表）', () => {
  function event(overrides: Partial<SitePatchEvent> = {}): SitePatchEvent {
    return {
      id: 'e1',
      patch_id: 'demo-site-patch-001',
      kind: 'created',
      channel_kind: null,
      note: null,
      created_at: '2026-09-17T02:00:00Z',
      ...overrides,
    };
  }

  it('表头含事件列，补丁字段按列序落位；null 落成空单元格', () => {
    for (const column of ['event_index', 'event_kind', 'event_at', 'event_channel', 'event_note']) {
      expect(SITE_LEDGER_CSV_HEADER, column).toContain(column);
    }
    const csv = composeLedgerCsv([patch({ target_hint: null, published_at: null })], []) ?? '';
    const [header, row] = csv.trim().split('\n');

    expect(header).toBe(SITE_LEDGER_CSV_HEADER.join(','));
    const cells = row?.split(',') ?? [];
    expect(cells).toHaveLength(SITE_LEDGER_CSV_HEADER.length);
    expect(cells.slice(0, 14)).toEqual([
      'demo-site-patch-001',
      'demo-act-001',
      'html_fragment',
      `${DOMAIN}/products/bag-filter`,
      'Definition paragraph on the product page',
      '',
      'draft',
      'approved',
      'bundle',
      'generated',
      '0',
      '',
      '2026-09-17T02:00:00Z',
      '2026-09-19T08:00:00Z',
    ]);
    // 没有事件时仍留一行补丁，事件列全空（不是把补丁整行丢掉）
    expect(cells.slice(14)).toEqual(['', '', '', '', '']);
  });

  it('🔴 一条补丁有 N 条事件就落 N 行，事件按时间正序且只属于自己的补丁', () => {
    const rows = [
      patch({ id: 'p1', title: 'Patch one' }),
      patch({ id: 'p2', title: 'Patch two' }),
    ];
    const events = [
      event({ id: 'p1-b', patch_id: 'p1', kind: 'published', channel_kind: 'bundle', created_at: '2026-09-20T02:00:00Z' }),
      event({ id: 'p2-a', patch_id: 'p2', kind: 'created', created_at: '2026-09-18T02:00:00Z' }),
      event({ id: 'p1-a', patch_id: 'p1', kind: 'created', created_at: '2026-09-17T02:00:00Z' }),
    ];
    const lines = (composeLedgerCsv(rows, events) ?? '').trim().split('\n');
    expect(lines).toHaveLength(1 + 3);

    const p1 = lines.slice(1).filter((line) => line.startsWith('p1,'));
    expect(p1).toHaveLength(2);
    expect(p1[0]).toContain('created');
    expect(p1[1]).toContain('published');
    expect(p1[1]).toContain('bundle');

    const p2 = lines.slice(1).filter((line) => line.startsWith('p2,'));
    expect(p2).toHaveLength(1);
    expect(p2[0]).toContain('created');
  });

  it('含逗号 / 引号 / 换行的单元格加引号，内部引号翻倍（与 csv crate 的默认口径同形）', () => {
    const csv =
      composeLedgerCsv([
        patch({ title: 'A, B', body: 'x', target_hint: 'say "hi"' }),
      ]) ?? '';
    const row = csv.trim().split('\n')[1] ?? '';

    expect(row).toContain('"A, B"');
    expect(row).toContain('"say ""hi"""');
  });

  it('空清单 ⇒ null（不是只有一行表头的空壳）', () => {
    expect(composeLedgerCsv([])).toBeNull();
    expect(composeLedgerCsv([], [event()])).toBeNull();
  });
});

describe('api/site-compose · 文件名与 BOM', () => {
  it('六种产物的扩展名各就各位，文件名一律 ASCII', () => {
    const expected: Record<string, string> = {
      bundle: 'md',
      llms_txt: 'txt',
      robots_txt: 'txt',
      patches_json: 'json',
      worker_js: 'js',
      ledger_csv: 'csv',
    };
    for (const kind of SITE_EXPORTABLE_KINDS) {
      const name = siteExportFileName(PROJECT_ID, kind);
      expect(name).toBe(`geo-site-${kind}-${PROJECT_ID}.${expected[kind]}`);
      // 中文文件名在 `download` 属性里会掉（`report-compose.ts` 同一条纪律）
      expect(CJK.test(name)).toBe(false);
      expect(/^[\w.-]+$/.test(name), name).toBe(true);
    }
  });

  it('🔴 只有 CSV 需要 BOM（Excel 打开中文才不乱码；其余五种加了反而脏）', () => {
    for (const kind of SITE_EXPORTABLE_KINDS) {
      expect(siteExportNeedsBom(kind), kind).toBe(kind === 'ledger_csv');
    }
  });

  it('六种产物一种不多一种不少（与词典 site.export.kinds 的键集对齐）', () => {
    expect([...SITE_EXPORTABLE_KINDS].sort()).toEqual([
      'bundle',
      'ledger_csv',
      'llms_txt',
      'patches_json',
      'robots_txt',
      'worker_js',
    ]);
    const zhKeys = Object.keys(
      (zh()('site.export.kinds', { returnObjects: true }) as Record<string, string>) ?? {},
    ).sort();
    expect(zhKeys).toEqual([...SITE_EXPORTABLE_KINDS].sort());
  });
});

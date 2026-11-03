/**
 * 站点补丁的**导出文本**组装（M6.5，spec `2026-09-30-site-connect-patch-bench-design.md` DR-53）。
 *
 * 与 `library-compose.ts` / `report-compose.ts` 同族：导出物在**前端**组装，落盘走既有的
 * `export_write_file`（🔴 不新增导出命令）。界面文案（标题、节名、表头、免责说明）一律由
 * `t()` 现取 ⇒ 中文界面导出中文交接单，切到英文再导出就是英文交接单，同一份数据。
 *
 * # 六种产物，各服务一条通道（spec DR-46）
 * - `bundle`：交接单 Markdown —— 给站长/外包**照着做**的那一份（零凭据，人人可用）；
 * - `llms_txt` / `robots_txt`：站点根目录的两个文件（只收**已采用**的补丁）；
 * - `patches_json`：边缘函数实时拉取的那份数据（只收**已发布**的补丁）；
 * - `worker_js`：边缘函数的骨架代码（Cloudflare Workers / 腾讯云 EdgeOne / 阿里云 ESA 同族运行时）；
 * - `ledger_csv`：补丁台账留档（"谁在什么时候把什么改上线了"的证据，对齐 M7 的证据附录思路）。
 *
 * # 🔴 分工照 Ahrefs Patches 的那一条：逻辑在客户侧、数据在我们侧
 * Worker 骨架里**没有**任何一条补丁的正文，它只按 `patches.json` 干活 ⇒ 客户改了补丁
 * 不需要重新部署函数（同 Ahrefs 的 "worker fetches the latest JSON in real time"）。
 *
 * # 🔴 两道筛选口径（AGENTS 规则 6）
 * - `llms_txt` / `robots_txt` 只收 `review_status === 'approved'`：待审的 AI 草案不该被贴到官网上
 *   （照 `composeFaqJsonLd`）；
 * - `patches_json` 只收 `status === 'published'`：边缘函数下发的是**线上生效**的那一份，
 *   把草案塞进去等于绕过人工审核。
 * 零条可用时返回 `null`，界面据此置灰按钮并说明原因（而不是导出一份空壳）。
 *
 * 🔴 文件名一律 ASCII（下载属性里的中文会掉，`report-compose.ts` 同一条纪律）。
 */
import type { TFunction } from 'i18next';

import type { SitePatch, SitePatchEvent } from './types';

/** demo 里真能产出的六种导出物。 */
export type SiteExportKind =
  | 'bundle'
  | 'llms_txt'
  | 'robots_txt'
  | 'patches_json'
  | 'worker_js'
  | 'ledger_csv';

export const SITE_EXPORTABLE_KINDS: readonly SiteExportKind[] = [
  'bundle',
  'llms_txt',
  'robots_txt',
  'patches_json',
  'worker_js',
  'ledger_csv',
];

const EXTENSIONS: Record<SiteExportKind, string> = {
  bundle: 'md',
  llms_txt: 'txt',
  robots_txt: 'txt',
  patches_json: 'json',
  worker_js: 'js',
  ledger_csv: 'csv',
};

/** 需要加引号的字符：分隔符、引号本身、两种换行（与 csv crate 的默认口径同形）。 */
const MUST_QUOTE = /[",\n\r]/;

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return MUST_QUOTE.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** 文件名：`geo-site-<kind>-<project>.<ext>`，全 ASCII。 */
export function siteExportFileName(projectId: string, kind: SiteExportKind): string {
  return `geo-site-${kind}-${projectId}.${EXTENSIONS[kind]}`;
}

/** 标签查不到词条时回落到记号本身（照 `report-compose.ts` 的 `sectionTitle`，绝不回落中文）。 */
function labelOf(t: TFunction, prefix: string, id: string): string {
  const key = `${prefix}.${id}`;
  const rendered = t(key, { nsSeparator: false });
  return typeof rendered === 'string' && rendered !== key && rendered !== '' ? rendered : id;
}

/** 交接单里那段代码围栏的语言记号（按补丁类型挑；只是给编辑器上色用，不影响内容）。 */
const FENCE_LANGUAGE: Record<SitePatch['kind'], string> = {
  llms_txt: 'text',
  robots_txt: 'text',
  jsonld: 'html',
  html_fragment: 'html',
  meta_title: 'text',
  meta_description: 'text',
  canonical: 'text',
  alt_text: 'html',
  internal_link: 'html',
  entity_consistency: 'markdown',
};

/**
 * 交接单（Markdown）：一条补丁一节，节内是"改哪个页面、贴在哪、贴什么、怎么验收"。
 *
 * 🔴 **只收 `review_status === 'approved'`**：把待审草案写进交接单，外包会照着直接上线。
 * 一条可用的都没有 ⇒ `null`（界面置灰并说明）。
 */
export function composeSiteBundle(t: TFunction, patches: readonly SitePatch[]): string | null {
  const usable = patches.filter((patch) => patch.review_status === 'approved');
  if (usable.length === 0) return null;

  const lines: string[] = [
    `# ${t('site.export.bundleTitle')}`,
    '',
    `> ${t('site.export.bundleDisclaimer')}`,
    '',
    `${t('site.export.bundleCount', { total: usable.length })}`,
    '',
  ];

  usable.forEach((patch, index) => {
    lines.push(
      `## ${index + 1}. ${patch.title}`,
      '',
      `- ${t('site.export.bundleTarget')}: ${patch.target_url}`,
      `- ${t('site.export.bundleKind')}: ${labelOf(t, 'site.patchKinds', patch.kind)}`,
      `- ${t('site.export.bundleChannel')}: ${labelOf(t, 'site.channelKinds', patch.channel_kind)}`,
      `- ${t('site.export.bundleStatus')}: ${labelOf(t, 'site.patchStatuses', patch.status)}` +
        ` · ${t('site.export.bundleReview')}: ${labelOf(t, 'action.contentStatuses', patch.review_status)}`,
    );
    if (patch.target_hint !== null) {
      lines.push(`- ${t('site.export.bundleHint')}: ${patch.target_hint}`);
    }
    if (patch.action_id !== null) {
      lines.push(`- ${t('site.export.bundleAction')}: ${patch.action_id}`);
    }
    lines.push('', '```' + FENCE_LANGUAGE[patch.kind], patch.body, '```', '');
    lines.push(`${t('site.export.bundleVerify')}`, '');
  });

  return `${lines.join('\n')}\n`;
}

/** 站点根目录文件（`llms.txt` / `robots.txt`）：把同类补丁的正文按顺序接起来。 */
function composeRootFile(
  patches: readonly SitePatch[],
  kind: 'llms_txt' | 'robots_txt',
): string | null {
  const usable = patches.filter(
    (patch) => patch.kind === kind && patch.review_status === 'approved',
  );
  if (usable.length === 0) return null;
  return `${usable.map((patch) => patch.body.trim()).join('\n\n')}\n`;
}

export function composeLlmsTxt(patches: readonly SitePatch[]): string | null {
  return composeRootFile(patches, 'llms_txt');
}

export function composeRobotsTxt(patches: readonly SitePatch[]): string | null {
  return composeRootFile(patches, 'robots_txt');
}

/** `patches.json` 的一行（边缘函数按它干活；🔴 只收**已发布**的补丁，见文件头）。 */
export interface SitePatchJson {
  id: string;
  kind: SitePatch['kind'];
  target_url: string;
  channel: SitePatch['channel_kind'];
  body: string;
}

export interface SitePatchesJson {
  version: number;
  generated_at: string;
  project_id: string;
  patches: SitePatchJson[];
}

export function composePatchesJson(patches: readonly SitePatch[]): string | null {
  // 已发布 + 当前仍为 approved：审核态被降级的补丁不得继续进线上下发文件（规则 6 / DR-53）。
  const published = patches.filter(
    (patch) => patch.status === 'published' && patch.review_status === 'approved',
  );
  if (published.length === 0) return null;

  const payload: SitePatchesJson = {
    version: 1,
    // 🔴 用**已发布时刻**里最晚的那个，不是"现在"：这份 JSON 描述的是线上生效的那一版，
    // 盖一个导出时刻的时间戳会让人以为"刚刚又改过线上"。
    generated_at: published.reduce(
      (latest, patch) =>
        patch.published_at !== null && patch.published_at > latest ? patch.published_at : latest,
      '',
    ),
    project_id: published[0]?.project_id ?? '',
    patches: published.map((patch) => ({
      id: patch.id,
      // 边缘下发的是**完整发布快照**，不是还在改的草案（DR-47）：
      // kind / target_url / channel 也不能取当前值，否则发布后改类型或落点会泄漏到线上。
      kind: patch.published_kind ?? patch.kind,
      target_url: patch.published_target_url ?? patch.target_url,
      channel: patch.published_channel_kind ?? patch.channel_kind,
      body: patch.published_body ?? patch.body,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * 边缘函数骨架（Cloudflare Workers / 腾讯云 EdgeOne / 阿里云 ESA 同族运行时）。
 *
 * 🔴 **代码全 ASCII**，只有顶部三行注释经 `t()` 取（客户语言）：这份文件是要被贴进
 * 客户云控制台的，里面出现半句英文半句中文的拼接会很难维护。
 * 🔴 用**字符串替换**而不是 `HTMLRewriter`：三家运行时对 `HTMLRewriter` 的支持度不一致，
 * 而字符串替换在任何一家都跑得起来（代价是每次响应多一次全量读写，量级完全可接受）。
 */
export function composeWorkerJs(
  t: TFunction,
  projectId: string,
  patchesUrl: string,
): string {
  return [
    `// ${t('site.export.workerNote1')}`,
    `// ${t('site.export.workerNote2')}`,
    `// ${t('site.export.workerNote3')}`,
    '',
    `const PATCHES_URL = ${JSON.stringify(patchesUrl)};`,
    `const PROJECT_ID = ${JSON.stringify(projectId)};`,
    '',
    '// llms.txt / robots.txt are served straight from the patch body, no origin round-trip.',
    'const ROOT_FILES = {',
    "  '/llms.txt': 'llms_txt',",
    "  '/robots.txt': 'robots_txt',",
    '};',
    '',
    '// Kinds the worker can apply mechanically. Everything else stays in the hand-over sheet:',
    '// alt_text / internal_link / entity_consistency need a human to pick the exact spot.',
    "const APPLIABLE = new Set(['meta_title', 'meta_description', 'canonical', 'jsonld', 'html_fragment']);",
    '',
    '// No permanent cache: a new patches.json must take effect without redeploying the worker.',
    'const CACHE_TTL_MS = 30000;',
    'let cache = null;',
    'let cachedAt = 0;',
    '',
    'async function loadPatches() {',
    '  if (cache !== null && Date.now() - cachedAt < CACHE_TTL_MS) return cache;',
    '  const response = await fetch(PATCHES_URL, { headers: { Accept: "application/json" } });',
    '  // Keep the last known good payload when the origin is briefly unavailable.',
    '  if (!response.ok) return cache ?? [];',
    '  const payload = await response.json();',
    "  cache = Array.isArray(payload.patches) ? payload.patches : [];",
    '  cachedAt = Date.now();',
    '  return cache;',
    '}',
    '',
    'function replaceOnce(html, pattern, replacement) {',
    '  const index = html.search(pattern);',
    '  if (index === -1) return html + replacement;',
    '  return html.replace(pattern, replacement);',
    '}',
    '',
    'function applyPatch(html, patch) {',
    '  if (!APPLIABLE.has(patch.kind)) return html;',
    '  const body = String(patch.body ?? "");',
    '  switch (patch.kind) {',
    "    case 'meta_title':",
    '      return replaceOnce(html, /<title>[\\s\\S]*?<\\/title>/i, `<title>${body}</title>`);',
    "    case 'meta_description':",
    '      return replaceOnce(',
    '        html,',
    '        /<meta\\s+name=["\']description["\'][^>]*>/i,',
    '        `<meta name="description" content="${body.replace(/"/g, "&quot;")}">`,',
    '      );',
    "    case 'canonical':",
    '      return replaceOnce(',
    '        html,',
    '        /<link\\s+rel=["\']canonical["\'][^>]*>/i,',
    '        `<link rel="canonical" href="${body}">`,',
    '      );',
    "    case 'jsonld':",
    "    case 'html_fragment':",
    "      return html.includes('</body>') ? html.replace('</body>', `${body}\\n</body>`) : html + body;",
    '    default:',
    '      return html;',
    '  }',
    '}',
    '',
    'export default {',
    '  async fetch(request) {',
    '    const url = new URL(request.url);',
    '    const patches = await loadPatches();',
    '',
    '    // 1) root files: serve the patch body directly when one is published.',
    '    const rootKind = ROOT_FILES[url.pathname];',
    '    if (rootKind !== undefined) {',
    '      const patch = patches.find((entry) => entry.kind === rootKind);',
    '      if (patch !== undefined) {',
    "        return new Response(String(patch.body), { headers: { 'content-type': 'text/plain; charset=utf-8' } });",
    '      }',
    '    }',
    '',
    '    // 2) html pages: apply every patch whose target_url matches this path.',
    '    const response = await fetch(request);',
    "    const contentType = response.headers.get('content-type') ?? '';",
    "    if (!contentType.includes('text/html')) return response;",
    '',
    '    const scoped = patches.filter((entry) => {',
    '      if (!APPLIABLE.has(entry.kind)) return false;',
    '      try {',
    '        return new URL(entry.target_url).pathname === url.pathname;',
    '      } catch {',
    '        return false;',
    '      }',
    '    });',
    '    if (scoped.length === 0) return response;',
    '',
    '    let html = await response.text();',
    '    for (const patch of scoped) html = applyPatch(html, patch);',
    '',
    '    const headers = new Headers(response.headers);',
    "    headers.set('x-geo-patches', `${PROJECT_ID}:${scoped.length}`);",
    '    return new Response(html, { status: response.status, statusText: response.statusText, headers });',
    '  },',
    '};',
    '',
  ].join('\n');
}

/**
 * 台账留档 CSV 的表头（🔴 刻意不进 `api/constants.ts`：Rust 侧还没有这张表，spec DR-53）。
 *
 * 🔴 这是**补丁 × 事件**的扁平表：一行 = 一条事件。只留补丁字段的话，导出物回答不了
 * 「谁在什么时候把什么改上线了」——而这句话正是这张表的唯一用途（spec §6 第 6 条）。
 * 没有事件的补丁仍保留一行（事件列留空），避免导出时把这条补丁整行丢掉。
 */
export const SITE_LEDGER_CSV_HEADER = [
  'id',
  'action_id',
  'kind',
  'target_url',
  'title',
  'target_hint',
  'status',
  'review_status',
  'channel_kind',
  'source',
  'position',
  'published_at',
  'created_at',
  'updated_at',
  'event_index',
  'event_kind',
  'event_at',
  'event_channel',
  'event_note',
] as const;

/** 台账留档 CSV（补丁 × 事件；`with_bom = true` 交给 `export_write_file`，Excel 打开中文才不乱码）。 */
export function composeLedgerCsv(
  patches: readonly SitePatch[],
  events: readonly SitePatchEvent[] = [],
): string | null {
  if (patches.length === 0) return null;

  const byPatch = new Map<string, SitePatchEvent[]>();
  for (const event of events) {
    const list = byPatch.get(event.patch_id);
    if (list === undefined) byPatch.set(event.patch_id, [event]);
    else list.push(event);
  }
  // 与 `site_patch_history` 同一条口径：时间正序（同刻按 id 稳定排序，保证导出可复现）。
  for (const list of byPatch.values()) {
    list.sort((left, right) =>
      left.created_at === right.created_at
        ? left.id.localeCompare(right.id)
        : left.created_at.localeCompare(right.created_at),
    );
  }

  const lines = [SITE_LEDGER_CSV_HEADER.join(',')];
  for (const row of patches) {
    const patchCells = [
      csvCell(row.id),
      csvCell(row.action_id),
      csvCell(row.kind),
      csvCell(row.target_url),
      csvCell(row.title),
      csvCell(row.target_hint),
      csvCell(row.status),
      csvCell(row.review_status),
      csvCell(row.channel_kind),
      csvCell(row.source),
      csvCell(row.position),
      csvCell(row.published_at),
      csvCell(row.created_at),
      csvCell(row.updated_at),
    ];
    const own = byPatch.get(row.id) ?? [];
    if (own.length === 0) {
      lines.push([...patchCells, '', '', '', '', ''].join(','));
      continue;
    }
    own.forEach((event, index) => {
      lines.push(
        [
          ...patchCells,
          csvCell(index + 1),
          csvCell(event.kind),
          csvCell(event.created_at),
          csvCell(event.channel_kind),
          csvCell(event.note),
        ].join(','),
      );
    });
  }
  return `${lines.join('\n')}\n`;
}

/** 只有 CSV 需要 BOM（与 `library-compose.ts` / `CsvToolbar` 同一条口径）。 */
export function siteExportNeedsBom(kind: SiteExportKind): boolean {
  return kind === 'ledger_csv';
}

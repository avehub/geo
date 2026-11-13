/**
 * Webmaster Data (M5.5 off-site truth layer), en-US mirror of `zh-CN/webmaster-data.ts`.
 * Design spec `docs/superpowers/specs/2026-10-12-webmaster-data-integration-design.md` (DR-90 … DR-118).
 * Key set parity is pinned at compile time by `ResourceBundle['webmasterData']` and asserted at
 * runtime by `i18n/index.test.ts` and `i18n/dictionary.test.ts`.
 *
 * # Naming (DR-91)
 * `Webmaster Data` rather than `Search Console Data`: the latter reads as Google-only, while the
 * former matches both Bing Webmaster Tools and the three domestic "webmaster platforms".
 * The word is admittedly dated in the West (Google renamed its console in 2015), but accuracy wins
 * over fashion here — this page really does hold data from each platform's webmaster console.
 *
 * # The three always-on notes (DR-99)
 * `demoBody` (page top), `staticNote` (opportunities) and `metricNote` (aggregate) must never be
 * folded into a tooltip. This page is half real, half preset: mapping, Class A sums, Class B
 * ratios, filtering and the overlap window are genuinely computed in the frontend (importing data
 * really moves the totals), while the six detection rules are pure `geo-domain` functions and demo
 * serves a static opportunity list (importing never grows it). Leaving that asymmetry unstated is
 * how a reviewer concludes the analysis is broken (divergence ledger E-68).
 *
 * # Wording of the three normalization classes
 * They are `Class A/B/C`, never "tier" or "grade": the `#22` guard in `dictionary.test.ts` fails any
 * leaf that pairs `tier|grade` with `recomput|recalculat`, and the Class B note has to say the ratio
 * is recomputed rather than averaged (DR-95 / DR-110).
 *
 * # No second copy of an existing label table
 * Source status reuses `site.channelStatuses`, credential state reuses `site.credentialsStates`,
 * the suggested prescription category reuses `action.categories`, and impact / difficulty reuse
 * `action.levels`. Only the enums unique to this page live here.
 *
 * # Compliance (AGENTS rules 6 and 11)
 * No ranking promises, no absolute claims. External CTR curves are cold-start reference only and
 * always carry the publisher plus the study year (DR-115). `pasteNote` is a product commitment,
 * not boilerplate: it is the visible half of "we never log in on your behalf" (DR-114).
 *
 * ⚠ Interpolation variables are never named `count` (i18next would look for plural branches).
 */
import type { ResourceBundle } from '../../resources';

const webmasterData: ResourceBundle['webmasterData'] = {
  title: 'Webmaster Data · All Platforms',
  lead:
    'Bring in the impressions, clicks and AI citations from your own consoles, normalize them across platforms, compare them with our own sampling, and let the rules open optimization opportunities.',
  loadFailed: 'Failed to load Webmaster Data',

  demoBody:
    'Demo mode makes no network calls: the source probe results and the opportunity list are preset static values, and no OAuth flow is implemented. What you can walk through here is importing, pasting, manual entry, aggregation and opportunity handling.',
  /** Always-on note (desktop): OAuth is not connected yet; import / paste / manual entry remain the paths. */
  liveBody:
    'OAuth is not connected yet: import, paste and manual entry are the available paths. Aggregation, opportunities and reconciliation still run on the data you have brought in.',
  staticNote:
    'Demo data: the opportunity list is not computed, so importing or pasting never adds to it. The aggregate totals, click-through rate and aggregation window are computed for real and do change after an import. That asymmetry is a demo limit, not a broken analysis.',
  metricNote:
    'Platforms measure differently, so this page normalizes in three classes: impressions, clicks and AI citations can be summed across platforms; click-through rate is only ever recomputed from those sums, never averaged across platforms; dimensions that do not map are shown on their own with the platform named.',
  pasteNote:
    'Copy and paste happens inside your own browser. This app never stores your platform password and never logs in to any platform on your behalf.',
  trademarkNote:
    'Data comes from each platform. This product is not an official partner of any of them, and each platform’s own documentation governs how its metrics are defined.',
  regionNote:
    'These platform APIs may be unreachable from mainland China. Requests are sent from your own computer, so reachability depends on your network.',

  staleTitle: 'Stale data',
  staleWarning:
    'This data runs through {{through}} and trails the current data cut-off by {{days}} days: refresh it before you report on it.',
  sampledWarning:
    'Includes sampled rows from {{source}} (above the 50,000-row daily cap), so the total may read low.',
  aggregateWindow: 'Aggregation window {{start}} to {{end}}',

  // Who declared the window (keys == `WINDOW_SOURCE_VALUES`). Baidu’s AI Traffic Analysis export
  // has no date column, so that case can only read "confirmed at import time".
  windowSources: {
    platform: 'Window declared by the platform',
    user_stated: 'Window confirmed at import time',
  },

  // -------------------------------------------------------------------------
  // Data sources (page section 1)
  // -------------------------------------------------------------------------

  // The three groups (keys == `SEARCH_GROUP_VALUES` in `api/types-search.ts`). DR-103 wrote
  // `groups.{webmaster,analytics}`, but DR-104 renders three sections and the landed contract folds
  // China / Overseas into the group value itself, so the UI never has to re-derive it from `region`.
  groups: {
    webmaster_cn: 'Webmaster platforms · China',
    webmaster_global: 'Webmaster platforms · Overseas',
    analytics: 'On-site analytics (supplementary)',
  },

  groupNotes: {
    webmaster_cn:
      'Only your own account can see these numbers: the platforms expose no read API, so the data arrives by copying, exporting or manual entry.',
    webmaster_global:
      'Google Search Console and Bing Webmaster Tools, both over official authorization with data pulled on a cycle. Relevant mainly for customers with overseas traffic.',
    analytics:
      'This group measures on-site traffic (sessions and visits). It never joins the impressions total; it only supplements traffic-source distribution and on-site behavior.',
  },

  sources: {
    baidu_ziyuan_ai: 'Baidu Search Resource Platform · AI Traffic Analysis',
    baidu_ziyuan: 'Baidu Search Resource Platform (index count / traffic and keywords)',
    toutiao: 'Toutiao Search Webmaster Platform',
    gsc: 'Google Search Console',
    bing_wmt: 'Bing Webmaster Tools',
    sogou: 'Sogou Webmaster Platform (behind WeChat Search)',
    so_360: '360 Webmaster Platform',
    baidu_tongji: 'Baidu Tongji (web analytics)',
    manual: 'Manual entry',
  },

  sourceHints: {
    baidu_ziyuan_ai:
      'A gradual-rollout feature: blank data right after site verification is normal. Only the "Top AI-cited keywords" table has a download button, it exports xlsx, and it has no date column.',
    baidu_ziyuan:
      'Classic search surface: index count plus the traffic-and-keywords table (impressions / clicks / average position). Only submission APIs are public, so readings arrive by copy or export.',
    toutiao:
      'Classic search surface: keyword impressions and clicks. Newly registered sites see a delay before data extraction.',
    gsc: 'Classic search surface: clicks / impressions / ctr / position. AI Overviews traffic is folded into web and cannot be separated through the API; data lags about two to three days.',
    bing_wmt:
      'Classic search surface: rank and traffic stats plus keyword details. AI Performance is UI-only for now, and the API is REST-only (SOAP and POX were retired on 2026-08-31).',
    sogou:
      'Classic search surface (phase 2): the data behind WeChat Search. Only a submission API is public; there is no read API.',
    so_360:
      'Classic search surface (phase 2): keyword data from 360 Search. Only a submission API is public; there is no read API.',
    baidu_tongji:
      'On-site analytics: sessions, visits and source breakdown. API access is requested inside the Baidu Tongji console and needs approval; note that a Baidu account and Baidu Cloud are two separate systems.',
    manual:
      'The fallback when neither an export nor API access is available: fill in a few key figures per period. Leave a metric empty when the platform does not report it — never enter 0.',
  },

  metricNotes: {
    baidu_ziyuan_ai:
      'Reports five columns: keyword, AI citations, AI impressions, AI clicks and AI click-through rate. The CTR denominator is citations, not impressions. We store and show clicks ÷ citations recomputed on our side, and treat the rate in the file as a cross-check only.',
    baidu_ziyuan:
      'Reports the index count and the keyword table: impressions, clicks and average position. Impressions are counted differently here than on the AI surface, so the two surfaces are not summed together by default.',
    toutiao:
      'Reports impressions and clicks per keyword. Directory-level queries are not supported, and a missing column is not the same as a value of 0.',
    gsc: 'Reports clicks / impressions / ctr / position, where the CTR denominator is impressions. Each search type returns at most 50,000 rows per day; anything beyond that is silently sampled.',
    bing_wmt:
      'Reports rank and traffic stats plus keyword details. Grounding Queries in AI Performance is a platform-specific dimension and is shown on its own with the platform named.',
    sogou:
      'Reports impressions, clicks and click-through rate, where the CTR denominator is queries — different again from Baidu’s AI surface and from GSC. Phase 2 will adopt this definition as is.',
    so_360:
      'Reports keyword impressions and clicks; the platform’s own documentation governs the details, and phase 2 will adopt them as is.',
    baidu_tongji:
      'Measured in sessions and visits, with no impressions column at all — that absence is the physical proof that the two units must not be mixed. Its numbers never join the impressions total.',
    manual:
      'Stored exactly as you entered it, with the window marked as confirmed at entry time. When a manual figure conflicts with a first-party platform number, the reconciled platform number wins.',
  },

  howToExport: {
    baidu_ziyuan_ai:
      'Baidu Search Resource Platform → AI Traffic Analysis → the download button on the "Top AI-cited keywords" table exports xlsx. The overview and trend blocks have no export today, so copy and paste those instead.',
    baidu_ziyuan:
      'Baidu Search Resource Platform → Statistics → Traffic and keywords: select the table and copy it, or export a CSV and import that.',
    toutiao:
      'Toutiao Search Webmaster Platform → Statistics → Keywords: select the table and copy it. The platform offers no bulk export.',
    gsc: 'Google Search Console → Performance → Export to download a CSV, or authorize and let the API pull it.',
    bing_wmt:
      'Bing Webmaster Tools → Reports & Data → export the relevant report as CSV, or authorize and let the REST API pull it.',
    sogou:
      'Sogou Webmaster Platform → Statistics: select the table and copy it (phase 2 will accept both paste and CSV import).',
    so_360:
      '360 Webmaster Platform → Statistics: select the table and copy it (phase 2 will accept both paste and CSV import).',
    baidu_tongji:
      'Baidu Tongji → Source analysis → Search engines: select the table and copy it, or request API access and let the API pull it.',
    manual:
      'Nothing to export: fill in impressions, clicks and AI citations per period in the entry form, and leave a metric empty when you do not have it.',
  },

  upcoming: {
    title: 'Phase 2 sources',
    note:
      'Both are already in the catalog and the dictionary, but the UI offers no entry point yet: rendering a control that can never work only makes people think they misconfigured something.',
    sogou:
      'Sogou Webmaster Platform is phase 2: the platform exposes no read API. When it opens, paste and file import cover it with no change to page code.',
    so_360:
      '360 Webmaster Platform is phase 2: the platform exposes no read API. When it opens, paste and file import cover it with no change to page code.',
  },

  regions: {
    cn: 'China',
    global: 'Overseas',
  },

  surfaces: {
    web_search: 'Classic search',
    ai_answer: 'AI answers',
  },
  surfaceNote:
    'The two surfaces count impressions differently (on the AI surface an impression is a user seeing your cited link), so a cross-surface total has to be selected explicitly and reads only as an order of magnitude.',

  tiers: {
    a: 'Class A · additive',
    b: 'Class B · derived',
    c: 'Class C · platform-specific',
  },
  tierNotes: {
    a: 'Impressions, clicks and AI citations: across platforms these are disjoint event sets, so they can be summed. The total row always carries the window, the contributing sources and a completeness flag.',
    b: 'Click-through rate and average position: only ever recomputed as summed numerator ÷ summed denominator, never averaged across platforms — the three denominators differ (Baidu’s AI surface divides by citations, Sogou by queries, GSC by impressions).',
    c: 'Bing Grounding Queries, Baidu’s cited-page count, position by device, Baidu Tongji sessions: unmapped and unmerged, shown on their own with the platform named.',
  },

  authModes: {
    none: 'No authorization needed',
    oauth: 'Official API authorization',
  },

  ingestModes: {
    api: 'Direct API',
    file_import: 'File import',
    paste_parse: 'Paste a console table',
    manual_entry: 'Manual entry',
  },
  ingestModeNotes: {
    api: 'Pulled automatically on a cycle once authorized; tokens go to the system keychain and only a keyring:// reference is stored.',
    file_import: 'Accepts .xlsx and .csv: columns are matched by header text, so column order does not matter.',
    paste_parse: 'You select and copy the table in your own console. We never touch credentials, never log in for you and never bypass a verification step.',
    manual_entry: 'Key figures entered by hand per period. Leave a metric empty when it is missing — "no such column" and "the value is 0" are two different conclusions.',
  },

  sourceCards: {
    title: 'Data sources',
    hint: 'One source is one platform console. Binding values (site URL, site ID) are not sensitive and are stored with the project; tokens go only to the keychain.',
    configure: 'Configure',
    drawerTitle: 'Configure data source',
    test: 'Probe',
    testing: 'Probing',
    tested: 'Probe complete',
    remove: 'Remove',
    removed: 'Data source removed',
    saved: 'Data source saved',
    binding: 'Binding',
    siteUrl: 'Site URL',
    siteId: 'Site ID',
    client_id: 'OAuth client ID (client_id)',
    oauthStart: 'Start Google authorization',
    bingApiKey: 'Bing API key',
    bingApiKeyHint:
      'Generate an API key under Bing Webmaster Tools → Settings → API access. It is long-lived and needs no redirect URI (Bing\'s OAuth console rejects loopback addresses). The key is stored in the system keychain, never in the database.',
    oauthStarted: 'Authorization page opened. Data refreshes automatically when you finish.',
    googleClientSecret: 'Google OAuth client secret (optional)',
    googleClientSecretHint: 'Leave empty for a desktop client using PKCE; if provided, it is stored in the system keychain, never in the database.',
    bindingHint: 'This is how the site is identified in the platform console — not a username or password.',
    authModeLabel: 'Credential mode',
    ingestModesLabel: 'How data arrives',
    dataThrough: 'Data through',
    neverImported: 'No data yet',
    importedAt: 'Imported at',
    checkedAt: 'Last probe',
    checkDetail: 'Probe result',
    neverChecked: 'Never probed',
    credentials: 'Credentials',
    secretRef: 'Keychain reference',
    demoCredentials: 'Demo mode collects no password or token: only a real backend writes to the system keychain, and the database keeps just the reference string.',
    liveCredentials: 'Credentials are stored in the system keychain; the database keeps only a reference string.',
    empty: 'No data source connected yet.',
    browserOpen: 'Open system Chrome',
    browserOpened: 'Chrome is open. Sign in there and stay on the data page.',
    browserCapture: 'Read current page',
    browserHint: 'Reads only the tables visible in your own browser window: no sign-in on your behalf, no private APIs, no cookies.',
    browserWindow: 'Data period: {{start}} ~ {{end}}',
    browserConnectFirst: 'Open system Chrome first, then sign in and stay on the data page before reading.',
    browserImported: 'Imported {{metrics}} metric rows and {{overviews}} AI summaries',
  },

  // -------------------------------------------------------------------------
  // Automatic collection card (DR-116: automation should be visible)
  // -------------------------------------------------------------------------
  stats: {
    title: 'Automatic collection',
    hint: 'The main feed is always automatic and has two layers: our own sampling (asking each AI engine the questions in your keyword library and recording citations) and official APIs (pulled on a cycle once authorized). Import, paste and manual entry below form the reconciliation layer, which calibrates our sample against first-party platform numbers.',
    lastRun: 'Last run',
    neverRun: 'No collection run yet',
    engines: 'Engines covered',
    queries: 'Queries covered',
    engineCount: '{{total}} engines',
    queryCount: '{{total}} queries',
    tokenState: 'API authorization state',
  },

  // -------------------------------------------------------------------------
  // Aggregate (page section 2: show the number and the account behind it)
  // -------------------------------------------------------------------------
  aggregate: {
    title: 'Cross-platform aggregate',
    hint: 'Every total keeps three things on screen: the aggregation window, the list of contributing sources and a completeness flag. A total you can defend line by line is the persuasive one.',
    impressions: 'Impressions',
    clicks: 'Clicks',
    citations: 'AI citations',
    ctr: 'Aggregate CTR',
    ctrNote: 'Aggregate CTR = total clicks ÷ total impressions (same surface, same window, same contributing sources). It is never the arithmetic mean of per-platform rates.',
    windowLimited: 'Aggregation window {{start}} to {{end}} (limited by the data-through date of {{source}}; narrowed to the overlap across sources)',
    windowEmpty: 'The contributing sources have no common time window; totals add each source over its own range and are not comparable.',
    windowOverride: 'Add each source over its own available window (totals will read low)',
    windowOverrideFlag: 'Not narrowed to the overlap right now: each source contributes only its own available days, so the total reads low.',
    participating: 'Contributing sources ({{total}})',
    participatingToggle: 'Show contributing sources',
    participatingLine: '{{source}} · data through {{through}} · {{completeness}}',
    participatingEmpty: 'No source contributes to the total under the current filters.',
    excludedAnalytics: 'The on-site analytics group is excluded here: it is measured in sessions, not impressions.',
    crossSurface: 'Classic search + AI answers',
  },

  filters: {
    time: 'Period',
    platform: 'Platform',
    surface: 'Surface',
    dimension: 'Breakdown',
    presets: {
      d7: 'Last 7 days',
      d28: 'Last 28 days',
      d90: 'Last 90 days',
      custom: 'Custom',
    },
    allPlatforms: 'All platforms',
    bothSurfaces: 'Both surfaces',
    recomputeHint: 'Unchecking any platform recomputes the totals, the CTR and the aggregation window on the spot, from the new overlap.',
    stateNote: 'Filters apply to this page only and reset on reload.',
  },

  pivots: {
    query: 'By keyword',
    page: 'By page',
    engine: 'By platform',
  },

  // -------------------------------------------------------------------------
  // AI citation performance (page section 3)
  // -------------------------------------------------------------------------
  aiOverview: {
    title: 'AI citation performance',
    hint: 'The five summary figures come from Baidu’s AI Traffic Analysis. Every other platform keeps its AI report UI-only for now, so that data arrives by copy or export.',
    citations: 'AI citations',
    impressions: 'AI impressions',
    clicks: 'AI clicks',
    ctr: 'AI click-through rate',
    ctrNote: 'CTR = clicks ÷ citations (Baidu’s own definition). The denominator differs from GSC and from Sogou, so this rate is never averaged with other platforms.',
    citedPages: 'Cited pages',
    period: '{{start}} to {{end}} (through {{through}})',
    hotKeywords: 'Top AI-cited keywords',
    hotPages: 'Top AI-cited pages',
    empty: 'No AI-surface data yet: copy or export a table from Baidu’s AI Traffic Analysis.',
  },

  nativePanel: {
    title: 'Platform-specific dimensions',
    hint: 'Native fields that do not map are archived as they are and shown here with the platform named. We neither guess their definition nor drop them silently.',
    examples: 'For example Bing Grounding Queries, Baidu’s cited-page count, GSC position by device, and Baidu Tongji sessions and bounce rate.',
    empty: 'Nothing unmapped in this batch.',
  },

  // -------------------------------------------------------------------------
  // Keyword impressions and clicks (page section 4, titled as reconciliation)
  // -------------------------------------------------------------------------
  metrics: {
    expand: 'Show detail',
    title: 'Keyword impressions and clicks',
    hint: 'The same rows can be broken down by keyword, by page or by platform; a row merged from several sources says how many platforms it covers.',
    empty: 'No metrics yet: paste or import a console table and both the totals and this table will change.',
    multiPlatform: '{{total}} platforms',
    columns: {
      query: 'Keyword',
      page: 'Page',
      platform: 'Platform',
      impressions: 'Impressions',
      clicks: 'Clicks',
      ctr: 'CTR',
      citations: 'AI citations',
      position: 'Average position',
      window: 'Window',
      completeness: 'Completeness',
      dataThrough: 'Data through',
    },
  },

  reconcile: {
    sampleTitle: 'Sample reconciliation (L1 vs L3)',
    reconciled: 'Reconciled',
    columns: {
      query: 'Query',
      engine: 'Engine',
      l1: 'Our sample',
      l3: 'Platform figure',
      displayed: 'Displayed',
      divergence: 'Divergence',
      status: 'Status',
    },
    title: 'Reconciliation',
    hint: 'This area is not the main feed: it calibrates our own sampling against first-party platform numbers. On conflict the platform figure is what we show, and the original sample value stays available.',
    notReconciled: 'Not reconciled with a platform',
    notReconciledNote: 'These figures come from our own sampling and have not been checked against first-party platform data yet. A missing reconciliation blocks nothing.',
    divergenceTitle: 'Reconciliation gap',
    divergenceEvent: '{{metric}} differs by {{rate}} between our sample and {{source}}: the platform figure is shown, and the sampled value stays available.',
    divergenceHint: 'A reconciliation event opens only when the gap passes the threshold. First-party platform numbers carry more weight with a customer, so they win the display.',
    sampledSide: 'What we asked (our own sample)',
    platformSide: 'What the platform recorded (first party)',
  },

  import: {
    pasteTitle: 'Paste a console table',
    // 🔴 The primary button (DR-113): pasting is a first-class ingest mode, not a CSV fallback.
    pasteButton: 'Paste a console table',
    pasteHint: 'Select the whole table in the platform console, header row included, copy it and paste it here: columns are matched by header text, so order does not matter.',
    pastePlaceholder: 'Paste the copied table here (TSV, an HTML table or comma-separated all work)',
    pasteAria: 'Pasted content',
    pasteRun: 'Parse and import',
    normalizeHint: 'Thousands separators, percent signs and the Chinese ten-thousand shorthand are normalized ("1.2w" becomes 12000). Columns we do not recognize are not dropped: they are archived as-is under "Platform-specific dimensions".',
    fileTitle: 'Import a file',
    // Secondary button. The walkthrough calls it "Import CSV"; XLSX is named too because DR-98
    // confirmed Baidu’s AI Traffic Analysis exports xlsx only — a CSV-only label would hide the
    // main real-world case.
    fileButton: 'Import CSV / XLSX',
    fileHint: 'Accepts .xlsx (the format Baidu’s AI Traffic Analysis exports) and .csv. For several months of backfill a file suits better than the clipboard.',
    filePick: 'Choose file',
    fileRun: 'Import',
    templates: 'Download a template',
    templateWeb: 'Keyword template (impressions / clicks / position)',
    templateAi: 'AI-surface template (citations / impressions / clicks)',
    templateAnalytics: 'On-site analytics template (sessions / landing page)',
    sourceLabel: 'Data source',
    sourceRequired: 'Choose a data source',
    periodLabel: 'Data window',
    periodHint: 'The export has no date column: confirm which window this file covers, and we record its end date as the data-through date of that source.',
    periodRequired: 'Fill in the data window',
    cancel: 'Cancel',
    ok: 'Import',
    done: 'Imported {{total}} rows',
    doneWithWarnings: 'Imported {{total}} rows, {{warnings}} with a warning',
    emptyFile: 'That file has no data rows: the import completed and the totals are unchanged.',
    errorsTitle: 'Import rejected: {{total}} problem(s)',
    errMissingColumn: 'The header is missing the {{column}} column',
    errUnknownHeader: 'Unrecognized header: at least one column has to match {{column}}',
    errInvalidNumber: 'Row {{row}}: "{{column}}" is not a valid number ({{value}})',
    errRequiredCell: 'Row {{row}}: "{{column}}" is empty',
    errUnsupportedFile: 'Only .xlsx and .csv are accepted: use one of those, or copy the table in the console and choose "Paste a console table".',
    errEmptyPayload: 'Nothing was pasted: select the table together with its header row and copy again.',
    errUnknownReason: 'Row {{row}} hit an unrecognized import problem: {{reason}}. Send the file to support so it can be checked.',
    warnCtrMismatch: 'Row {{row}}: the CTR in the file ({{given}}) disagrees with the recomputed value ({{recalculated}}). The recomputed value was stored; the import was not blocked.',
    aliasHint: 'Per-platform column aliases live in the catalog and the UI matches columns against them. A changed header structure raises an error rather than a guess.',
  },

  // -------------------------------------------------------------------------
  // Optimization opportunities (page section 5)
  // -------------------------------------------------------------------------
  opportunity: {
    title: 'Optimization opportunities',
    hint: 'Every opportunity states the figures behind it, the suggested prescription category and a confidence value. Adopting one only queues it for the next prescription ranking pass; it never writes a prescription by itself.',
    empty: 'No optimization opportunities yet.',
    rule: 'Rule',
    rationale: 'Rationale',
    evidence: 'Figures behind it',
    category: 'Suggested category',
    impact: 'Impact',
    difficulty: 'Effort',
    confidence: 'Confidence',
    status: 'Status',
    adopt: 'Adopt',
    ignore: 'Ignore',
    adopted: 'Adopted: it joins the next prescription ranking pass (demo mode does not actually grow a prescription).',
    adoptedLive: 'Adopted: it joins the next prescription ranking pass.',
    ignored: 'Ignored',
    updated: 'Opportunity status updated',
    toArticle: 'Turn into an article direction',
    toPatch: 'Generate a patch',
    toArticleHint: 'Reuses "New direction" in Article Studio and carries the keyword and the rationale across.',
    toPatchHint: 'Reuses patch generation in Site Connect and carries the rationale into the patch target hint.',
    demoStatic: 'In demo mode these six are preset samples, one per rule: changing a status recomputes nothing, and importing data adds no new opportunity.',
    sampleGate: 'With fewer than {{min}} queries in the sample the CTR rule opens no opportunity: better none than a shaky one.',
    // Keys == `SEARCH_OPPORTUNITY_STATUS_VALUES`. The landed contract says `new` / `adopted` /
    // `ignored`, not DR-94’s `pending` / `dismissed`, and downstream agents code against it.
    statuses: {
      new: 'New',
      adopted: 'Adopted',
      ignored: 'Ignored',
    },
  },

  rules: {
    high_impression_low_ctr: {
      name: 'High impressions, low CTR',
      hint: 'Impressions clear the floor while CTR sits below this site’s own median for the same position band ⇒ rewrite the title and description (lands in Site Connect).',
    },
    demand_without_content: {
      name: 'Demand without content',
      hint: 'The query earns impressions but is absent from the keyword library and has no matching topic page on the site ⇒ add content (lands in Article Studio, and writes back to the keyword library).',
    },
    ai_citation_gap: {
      name: 'AI citation gap',
      hint: 'The query gets clicks on the classic surface while AI-surface citations are 0 or missing ⇒ work on source placement (lands in the Action Center).',
    },
    landing_role_mismatch: {
      name: 'Landing-page role mismatch',
      hint: 'Traffic concentrates on pages whose role is "other" while the home and product pages get none ⇒ revisit the information architecture (lands in the Action Center).',
    },
    crawl_blocked_with_demand: {
      name: 'Demand blocked from crawling',
      hint: 'A page with impressions is marked non-crawlable in Site Connect, or robots.txt blocks AI crawlers ⇒ generate a robots.txt patch directly (lands in Site Connect).',
    },
    trend_divergence: {
      name: 'Trend divergence',
      hint: 'Branded query volume rises while brand coverage falls (or the reverse), and the gap exceeds the band ⇒ raise an M5 alert.',
    },
  },

  completeness: {
    full: 'Complete',
    sampled: 'Sampled by the platform',
    partial: 'Reported incomplete',
  },
  completenessNotes: {
    full: 'This batch is complete by the platform’s own account.',
    sampled: 'GSC returns at most 50,000 rows per search type per day and silently samples beyond that: no error, just fewer rows, so the total may read low.',
    partial: 'The platform itself reports the data as incomplete (blank during Baidu’s AI Traffic Analysis rollout, delayed for new Toutiao sites, no directory-level queries on Sogou). A missing column is not a value of 0.',
  },
  completenessFlagNote:
    'Sources that are not complete still join the total, but the total row carries a flag: dropping them makes the number swing (adding a third source could shrink it), which is harder to explain than a flag.',

  selfIndex: {
    title: 'AI citation visibility trend (our own observations)',
    hint: 'This curve comes from our own sampling of your site: each round asks the AI engines the questions in your keyword library and records whether you are cited.',
    noCtr: 'Our own observations contain no clicks, so this chart offers no CTR curve. For click-through rate use the platform aggregate above, which is first-party data.',
    boundary: 'No whole-web index, no estimated impressions, no clickstream: only the snapshots we observed for this site.',
    rankBandsTitle: 'SERP position bands',
    rankBandNote: 'We record a band, not an exact rank: one sample cannot support an exact rank, and printing one would be false precision.',
    rounds: '{{total}} observation rounds',
    retention: 'Snapshots are kept for {{days}} days so year-on-year comparisons stay possible.',
    rankBands: {
      top3: 'Top 3',
      top10: 'Top 10',
      top30: 'Top 30',
      absent: 'Outside the top 30',
    },
    // The three sampled surfaces (keys == `SELF_INDEX_SNAPSHOT_KIND_VALUES`).
    snapshotKinds: {
      ai_citation: 'AI citation snapshots',
      page_indexability: 'Page indexability snapshots',
      serp_rank_band: 'SERP position-band snapshots',
    },
  },

  ctrBenchmark: {
    title: 'CTR benchmark',
    primary: 'The primary benchmark is this site’s own median for the same position band: it is your data, it cites no external curve, and it is naturally computed per engine.',
    source: 'Reference band from {{org}} ({{year}}): English-SERP field values, for cold-start reference only.',
    sourceNote: 'External curves act as a reference band, never as a threshold, and take no part in the decision by default. Enable them explicitly under Settings → "Cold-start reference band".',
    enable: 'Enable the cold-start reference band',
    disabledByDefault: 'The cold-start reference band is off by default: the major studies differ by nearly a factor of two on the average CTR of position 1, and all of them measure English SERPs.',
    insufficientSample: 'Fewer than {{min}} queries in the sample: this rule opens no opportunity, rather than judge your pages against a benchmark that is not comparable.',
    wording: 'A benchmark is always worded as "the observed range for the same position", never as "the CTR you should reach".',
  },

  onboarding: {
    title: 'Which platforms to connect',
    hint: 'How many sources you need depends on which engines your visitors actually use, so we do not guess: once on-site analytics is connected, the suggestion here is derived from your own traffic sources.',
    empty: 'No on-site analytics data yet. Connect Baidu Tongji and the suggestion will follow your own traffic split; with no data we show no generic recommendation at all.',
    allConnected: 'Every search engine in your traffic split is already connected; Sogou and 360 remain phase 2.',
    suggestion: 'Your on-site traffic is {{split}} ⇒ connect these {{total}} webmaster platforms first.',
    later: '{{sources}} are phase 2: with a share this small they can wait.',
  },

  keywordOverlay: {
    fromPlatforms: 'From {{total}} platforms',
    window: 'Window {{start}} to {{end}}',
    withCompleteness: 'From {{total}} platforms · {{start}} to {{end}} · {{completeness}}',
    noneNote: 'Keywords with no webmaster data show no empty placeholder: absent data stays absent instead of posing as 0.',
  },

  evidenceSources: {
    model_sample: 'From our sampling estimate',
    webmaster: 'From the customer’s own webmaster console',
  },

  report: {
    sectionTitle: 'Off-site data comparison',
    sectionNote: 'This chapter puts "what we asked" next to "what the platform recorded": every figure carries a platform badge, a window and a completeness flag.',
    metricBlock: 'Off-site data',
    attributionNote: 'These figures come from the customer’s own webmaster console, not from our sampling estimate.',
  },
};

export default webmasterData;

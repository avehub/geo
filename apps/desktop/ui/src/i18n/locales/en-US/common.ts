import type { ResourceBundle } from '../../resources';

/**
 * 跨页面复用的通用动作与兜底文案。键集由 zh-CN 侧钉死（R-G）。
 *
 * `appName` 的 en 值**故意**与 zh 相同：产品名是专有名词，不译（裁定 B-3）。
 * 两侧值相同是合法的——R-G 那条运行期断言只比较键路径集合，不比较值。
 */
const common: ResourceBundle['common'] = {
  // One status vocabulary for the whole app (StatusChip).
  status: {
    ok: 'Healthy',
    running: 'Running',
    warning: 'Needs attention',
    error: 'Failed',
    todo: 'Not started',
    unavailable: 'Not connected',
    insufficient: 'Low sample',
  },

  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  confirm: 'Confirm',
  search: 'Search',
  loading: 'Loading…',
  unknownError: 'Something went wrong. Please try again later.',

  appName: '稿得快 GEO',
  tagline: 'Generative Engine Optimization · local-first',

  edit: 'Edit',
  close: 'Close',
  actions: 'Actions',
  more: 'More',
  invalidUrl: 'Enter a valid URL (including http/https)',
  noteOptional: 'Note (optional)',
  listSeparator: ', ',

  // M3–M7 追加的跨 surface 复用键（与 zh-CN 同批）。
  refresh: 'Refresh',
  all: 'All',
  yes: 'Yes',
  no: 'No',

  sampleSizeGrades: {
    sufficient: 'Sufficient sample',
    directional: 'Directional only',
    insufficient: 'Sample too small',
  },

  sentiments: {
    positive: 'Positive',
    neutral: 'Neutral',
    negative: 'Negative',
  },

  units: {
    percentagePoints: '{{value}} pp',
    items: '{{value}} items',
    prompts: '{{value}} prompts',
    seconds: '{{value}} s',
    tokens: '{{value}} tokens',
  },

  /**
   * 界面语言标签（`enumLabel(t, 'common.languages', locale)`）。
   * 键名 = `i18n/index.ts` 的 `LOCALES`。en 侧一律 ASCII（见 zh 侧同段注释）。
   */
  languages: {
    'zh-CN': 'Simplified Chinese',
    'en-US': 'English',
  },

  exportFormats: {
    markdown: 'Markdown',
    html: 'HTML',
    csv: 'CSV',
    docx: 'Word',
    pdf: 'PDF',
    png: 'PNG',
  },
  checkDetails: {
    site_bundle_ready: 'The hand-over bundle needs no credentials; exports go to local files and the export directory is writable.',
    site_bundle_verified: 'The hand-over bundle needs no credentials; the export directory is writable, and the latest export was the {{date}} qualification-page bundle.',
    site_edge_not_deployed: 'The edge function is not deployed yet: the patches.json URL returned {{status}}. Deploy it, then run the check again.',
    site_cms_not_configured: 'Not configured: enter the site URL and username, then create an application password in WordPress (the demo does not accept passwords).',
    site_repo_not_configured: 'Not configured: enter the repository URL to generate a diff and hand-over notes, then open the merge request yourself.',
    search_ai_flow_verified: 'The site is verified and included in the AI Traffic Analysis rollout: all three reports are visible, and only the AI-cited keywords report has a download button (xlsx, no date column).',
    search_traffic_keywords_verified: 'The site is verified and the traffic and keywords export is available; average position and index size stay in platform-specific dimensions because they have no canonical slot.',
    search_toutiao_delayed: 'The site is verified, but the console only has data through {{through}} because new sites arrive late. That is {{days}} days behind, so a stale-data warning will show.',
    search_gsc_export_verified: 'The property has been checked (URL-prefix property with trailing slash). This batch came from a CSV export; API authorization is not configured. Data lags {{lag_days}} days and is capped at {{row_cap}} rows per search type per day, with silent sampling beyond that.',
    search_bing_verified_no_api: 'The site passed DNS verification. AI Performance has a UI but no API today, so the Grounding Queries column stays in platform-specific dimensions.',
    search_tongji_verified: 'The site ID has been checked and sessions and source analysis are readable. It is an on-site analytics source measured in sessions, so it never joins impression totals; it is used only for traffic-source distribution and onboarding suggestions.',
    search_binding_missing: 'Required binding is incomplete: {{fields}}.',
    search_binding_blocked: 'Required binding is incomplete: the preset probe says the platform itself is available, but this source lacks the site binding needed to read data; the demo does not send requests.',
    search_credentials_missing: 'Not authorized yet: {{kind}} requires official authorization first.',
    search_reachable: 'The site is reachable (HTTP {{status}}).',
    search_unreachable: 'The site is unreachable: {{reason}}.',
    search_manual_no_probe: 'Manual entry needs no probe: there is no platform and no credential, and the stated period is used as-is.',
    search_phase_two: 'Phase-two source: the catalog entry exists, but this release does not render its onboarding entry.',
  },
};

export default common;

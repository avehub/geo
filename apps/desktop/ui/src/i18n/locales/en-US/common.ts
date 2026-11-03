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
};

export default common;

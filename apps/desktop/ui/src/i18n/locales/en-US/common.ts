import type { ResourceBundle } from '../../resources';

/**
 * 跨页面复用的通用动作与兜底文案。键集由 zh-CN 侧钉死（R-G）。
 *
 * `appName` 的 en 值**故意**与 zh 相同：产品名是专有名词，不译（裁定 B-3）。
 * 两侧值相同是合法的——R-G 那条运行期断言只比较键路径集合，不比较值。
 */
const common: ResourceBundle['common'] = {
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
  invalidUrl: 'Enter a valid URL (including http/https)',
  noteOptional: 'Note (optional)',
  listSeparator: ', ',
};

export default common;

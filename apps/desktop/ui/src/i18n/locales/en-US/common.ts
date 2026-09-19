import type { ResourceBundle } from '../../resources';

/** 跨页面复用的通用动作与兜底文案。键集由 zh-CN 侧钉死（R-G）。 */
const common: ResourceBundle['common'] = {
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  confirm: 'Confirm',
  search: 'Search',
  loading: 'Loading…',
  unknownError: 'Something went wrong. Please try again later.',
};

export default common;

import type { ResourceBundle } from '../../resources';

/**
 * 左侧导航。标注 `ResourceBundle['nav']` 让 zh/en 的键集在 `tsc -b` 阶段就必须相等（R-G）：
 * 少一个键或多一个键都会编译不过。
 */
const nav: ResourceBundle['nav'] = {
  projects: 'Projects',
  entityCard: 'Brand Entity Card',
  prompts: 'Prompt Library',
  settings: 'Settings',
};

export default nav;

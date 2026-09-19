import common from './common';
import nav from './nav';
import errors from './errors';
import fields from './fields';
import project from './project';
import prompt from './prompt';
import entity from './entity';
import settings from './settings';
import demo from './demo';

/**
 * zh-CN 资源树：产品主语言，也是**键集的真值源**（`ResourceBundle = typeof zhCN`）。
 *
 * namespace 的顺序按计划正文固定：common / nav / errors / fields / project / prompt /
 * entity / settings / demo。分文件只是**代码组织**，不是 i18next 的多 ns（R-H）——
 * 最终合成一个对象、走默认的 `keySeparator: '.'`，键写成 `nav.projects`。
 *
 * 增删 namespace 必须同步改 `../en-US/index.ts`，否则 `tsc -b` 会红。
 */
const zhCN = {
  common,
  nav,
  errors,
  fields,
  project,
  prompt,
  entity,
  settings,
  demo,
};

export default zhCN;

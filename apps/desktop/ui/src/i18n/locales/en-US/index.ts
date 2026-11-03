import type { ResourceBundle } from '../../resources';

import common from './common';
import nav from './nav';
import errors from './errors';
import fields from './fields';
import project from './project';
import prompt from './prompt';
import entity from './entity';
import settings from './settings';
import demo from './demo';
import collection from './collection';
import insight from './insight';
import diagnosis from './diagnosis';
import action from './action';
import report from './report';
import library from './library';
import site from './site';
import kb from './kb';
import article from './article';
import webmasterData from './webmaster-data';
import overview from './overview';
import portfolio from './portfolio';
import design from './design';

/**
 * en-US 资源树。两层类型钉法（R-G）：
 *
 * 1. 每个 namespace 文件各自标注 `ResourceBundle['<ns>']` —— 只有这层抓得到「en 多出来的键」，
 *    因为组合层的嵌套值来自变量、不触发 excess property check（实测证据见 task-6-report.md）。
 * 2. 这里再整体标注一次 `ResourceBundle` —— 抓「漏掉一整个 namespace」。
 */
const enUS: ResourceBundle = {
  common,
  nav,
  errors,
  fields,
  project,
  prompt,
  entity,
  settings,
  demo,
  collection,
  insight,
  diagnosis,
  action,
  report,
  library,
  site,
  kb,
  article,
  webmasterData,
  overview,
  portfolio,
  design,
};

export default enUS;

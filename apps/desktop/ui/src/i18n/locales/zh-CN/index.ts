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
 * zh-CN 资源树：产品主语言，也是**键集的真值源**（`ResourceBundle = typeof zhCN`）。
 *
 * namespace 的顺序按计划正文固定：common / nav / errors / fields / project / prompt /
 * entity / settings / demo，M3–M7 之后接 collection / insight / diagnosis / action / report
 * （顺序 = 里程碑顺序，`dictionary.test.ts` 的合规扫描清单按同一顺序登记）。
 * M1.5 的 `library` 与 M6.5 的 `site` 接在后面（各自那一轮新增，顺序 = 落地顺序）。
 * M1.2b 的 `kb` 与 M6 的 `article` 同属 2026-10-10 那一轮（知识库重构 + 文章管理），
 * 按 spec 的章节顺序排在末尾（§3 知识库 → §4 文章管理）；
 * M5.5 的 `webmasterData`（站长数据）是 2026-10-12 那一轮，接在最后（顺序 = 落地顺序）。
 * 🔴 资源树的**顺序**与导航顺序无关：导航位置（解析与核查之后、诊断与归因之前，DR-91）
 * 由 `nav.ts` 的键序与 `components/SideNav.tsx` 持有。
 * 分文件只是**代码组织**，不是 i18next 的多 ns（R-H）——
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

export default zhCN;

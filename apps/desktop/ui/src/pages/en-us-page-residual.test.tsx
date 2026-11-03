/**
 * 常驻守卫（Task 15a 第 9 条 · 台账 #04）：**每个页面/分段在 en-US 下，除数据之外整页无 CJK**。
 * （刻意不写页面数：它随里程碑一直长，写死就成了每次都要回来改的假红——真值看下面那组用例。）
 *
 * # 为什么这条判据现在才写得出来
 *
 * Task 9 那两轮各页的 B-2 用例都**刻意避开**了「整页无 CJK」，注释原话是
 * 「得先把数据级泄漏面列清楚才写得对」（`pages/ProjectListPage.test.tsx` 与
 * `pages/EntityCardPage.test.tsx` 的 B-2 头注释）。原因很实在：项目名 / 品牌名 / 别名 /
 * 地域 / 标签 / 实体卡字段值 / `prompt.text` / `group_name` 都是**数据**，后端发什么就显示什么，
 * en locale 下照旧是中文——直接断言「整页无 CJK」会假红，于是只能退化成逐条点名 chrome。
 * Task 9b 把最后几处 chrome 泄漏（`ProviderInfo.label_zh`、notes 散文行、枚举标签）收进词典之后，
 * 这条判据才**可能**为真；本文件把它落成常驻守卫，并给「数据」下一个可执行定义。
 *
 * # 判据形状：`整页文本节点 − 演示种子数据 = 无 CJK`
 *
 * 不做「白名单几个 chrome 串」那种点名式断言（漏一个就静默通过），而是反过来：
 * 遍历 `document.body` 的**全部文本节点**，把 demo 种子数据里出现过的每一个中文串从节点文本里
 * 减掉，剩下的部分再查 CJK。剩下的还有中文 ⇒ 那一定是**界面文案**泄漏（词典漏翻、
 * 硬编码、或后端散文行直接上屏），必须红。
 *
 * 「减掉」而不是「整节点相等」，是为了容下**模板 + 数据**的组合形态：
 * `AI-extracted: 澜舟` 这种节点整体不在数据清单里，但减掉数据串 `澜舟` 之后剩下的
 * `AI-extracted: ` 是干净 ASCII ⇒ 判为合格。反过来，`已抽取：澜舟` 减完之后还剩 `已抽取：`
 * ⇒ 判红。这正是本守卫要的判别力（对照组见下面那条用例）。
 *
 * 数据清单**从种子模块现算、不手抄**：`import * as seed…` 把 `demo/seed/**` 全部 18 个模块的
 * 导出走一遍，收上所有含 CJK 的字符串（Plan B Task 4 加的 `seed/model-catalogs.ts` 整份是
 * ASCII 机器记号 ⇒ 一条都不贡献，纳进来是为了"哪天有人往里写中文名"时这里能自动兜住）。
 * 所以给 demo 加一条中文语料不需要同步改这里；
 * 而清单塌成空集会被下面「防空跑」那条抓住。
 *
 * # 为什么走 demo 假后端而不是逐页 stub
 *
 * 每个页面各有一套 `mockInvoke` 桩（`stubList()` / `stub('sufficient')` …），复刻一遍既冗长
 * 又会与各自的页面测试漂移。这里把 `api/runtime` mock 成 `'demo'`，`api/client.ts:172` 就会
 * 把全部命令分派给 `demo/backend.ts` 的 `demoInvoke` ⇒ 所有页面共用**同一份真种子数据**，
 * 与产品负责人在 `mise run web` 里看到的是同一个数据面。
 *
 * 🔴 后半段那 5 个页面（M3 采集 / M4 解析 / M5 诊断 / M6 行动 / M7 报告）的中文语料比前 5 个
 * 多一个量级：问题原文、回答片段、核查引文、处方 rationale、报告正文段落全是中文。它们
 * **照样只能来自 `demo/seed/**`**，所以减法清单从 228 条涨到 454 条（M1.5 素材层之后是 527 条）是"语料变多"，
 * 不是"放行面被人为放宽"——短尾那档只多出 2 条，逐条判断见 `SHORT_DATA_PINNED` 的 docblock。
 *
 * ⚠ 副作用是「数据清单」也必须取 demo 侧的种子（`src/demo/seed/**`）而不是 `src/test/fixtures.ts`
 * ——两套桩数据的品牌名不同（澜舟除尘 vs 宏宇泵业）。取错一侧会整页假红。
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as seedActions from '../demo/seed/actions';
import * as seedArticles from '../demo/seed/articles';
import * as seedCollectionRecords from '../demo/seed/collection-records';
import * as seedCollectionRecordsRetest from '../demo/seed/collection-records-retest';
import * as seedCollectionRounds from '../demo/seed/collection-rounds';
import * as seedContents from '../demo/seed/contents';
import * as seedDiagnosis from '../demo/seed/diagnosis';
import * as seedEntityCards from '../demo/seed/entity-cards';
import * as seedFaqs from '../demo/seed/faqs';
import * as seedInsights from '../demo/seed/insights';
import * as seedKeywords from '../demo/seed/keywords';
import * as seedKb from '../demo/seed/kb';
import * as seedModelCatalogs from '../demo/seed/model-catalogs';
import * as seedProjects from '../demo/seed/projects';
import * as seedPromptItemsInsufficient from '../demo/seed/prompt-items-insufficient';
import * as seedPromptItemsSufficient from '../demo/seed/prompt-items-sufficient';
import * as seedPromptSets from '../demo/seed/prompt-sets';
import * as seedReports from '../demo/seed/reports';
import * as seedSearchData from '../demo/seed/search-data';
import * as seedSettings from '../demo/seed/settings';
import * as seedSite from '../demo/seed/site';
import { SEED_ACTIVE_PROJECT_ID } from '../demo/seed/projects';
import { SEED_COLLECTION_ROUNDS, SEED_RETEST_ROUND_ID } from '../demo/seed/collection-rounds';
import enUS from '../i18n/locales/en-US';
import { renderAtRoute, renderWithProviders } from '../test/render';
import ActionPage from './ActionPage';
import ArticleStudioPage from './ArticleStudioPage';
import AutoBuildProjectPage from './AutoBuildProjectPage';
import CollectionPage from './CollectionPage';
import DiagnosisPage from './DiagnosisPage';
import EntityCardPage from './EntityCardPage';
import FaqLibraryPage from './FaqLibraryPage';
import InsightPage from './InsightPage';
import KeywordLibraryPage from './KeywordLibraryPage';
import KnowledgeBasePage from './KnowledgeBasePage';
import NewProjectPage from './NewProjectPage';
import OverviewPage from './OverviewPage';
import PortfolioPage from './PortfolioPage';
import ProjectListPage from './ProjectListPage';
import ProjectWizardPage from './ProjectWizardPage';
import PromptSetPage from './PromptSetPage';
import ReportPage from './ReportPage';
import SettingsPage from './SettingsPage';
import SitePage from './SitePage';
import WebmasterDataPage from './WebmasterDataPage';
import { SETTINGS_SECTIONS } from './settings/sections';

// `client.ts` 只从 `./runtime` 取 `runtime` 这一个绑定（照 `api/client.demo-runtime.test.ts:38` 的既有做法）。
vi.mock('../api/runtime', () => ({ runtime: 'demo' }));

/**
 * 残留字符类：与 `i18n/no-hardcoded-strings.test.ts:90`、`i18n/enum-label.test.tsx:51`
 * **同集合**（CJK 汉字 + CJK 标点 + 全角形式）。这里判的是**渲染结果**而不是源码，
 * 所以窄区间那套「看不见 `、`」的老问题同样适用——`join('、')` 泄漏到界面上要能被这条抓住。
 */
const CJK = /[\u3000-\u303f\u4e00-\u9fa5\uff00-\uffef]/;

function collectCjkStrings(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 8) return;
  if (typeof node === 'string') {
    if (CJK.test(node)) out.add(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const value of node) collectCjkStrings(value, out, depth + 1);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      collectCjkStrings(value, out, depth + 1);
    }
  }
}

/**
 * 演示种子数据里全部含 CJK 的字符串，**长的排前面**。
 *
 * 排序是必需的：`'澜舟除尘 · 基线题库'` 必须先于 `'澜舟除尘'` 被减掉，
 * 否则节点文本里会剩下 `' · 基线题库'` 这段（虽然它是 ASCII，但换个语料就会剩下中文尾巴）。
 */
const DATA_STRINGS: string[] = (() => {
  const found = new Set<string>();
  for (const mod of [
    seedActions,
    seedArticles,
    seedCollectionRecords,
    seedCollectionRecordsRetest,
    seedCollectionRounds,
    seedContents,
    seedDiagnosis,
    seedEntityCards,
    seedFaqs,
    seedInsights,
    seedKeywords,
    seedKb,
    seedModelCatalogs,
    seedProjects,
    seedPromptItemsInsufficient,
    seedPromptItemsSufficient,
    seedPromptSets,
    seedReports,
    seedSearchData,
    seedSettings,
    seedSite,
  ]) {
    for (const value of Object.values(mod)) collectCjkStrings(value, found);
  }
  return [...found].sort((left, right) => right.length - left.length);
})();

/**
 * 🔴 短尾放行清单（15b #50 / 15a 复审 **M-1**）：`DATA_STRINGS` 里**短于等于 4 字**的条目，
 * **逐字钉死**（内容 + 条数，两个方向都钉）。
 *
 * **M-1 的缺陷形状**：`DATA_STRINGS` 是从种子语料**现算**的，原先只有 `>= 20` 这个**下界**。
 * 下界只防「清单空了 ⇒ 整页假红」，**防不住「清单胖了」**：往语料里加一个两字通用词，
 * 减法就自动多放行一个词，而与之**逐字相同**的未翻译 chrome 会被**静默减掉**。
 * 复审席的可判别复现：插 `<span>方案</span>` 仍全绿，插 `<span>方案设置</span>` 立刻红。
 *
 * **实测规模比复审席估的大得多**：复审席 dump 出的「最短 12 条」是**排序后的尾巴样本**；
 * 真值是 **≤2 字 62 条 / ≤3 字 63 条 / ≤4 字 83 条**（总清单 454 条）。
 * 62 个两字词里有 `价格` / `方案` / `设计` / `标准` / `行业` / `合规` / `交付` / `检测` /
 * `售后` / `区域` 这类**本身就是合法界面标签**的词 ⇒ 风险面不是 12 个词，是 62 个。
 *
 * **阈值取 4 的理由**：4 字以内的中文串与界面标签同形的概率不可忽略（4 字那 20 条里已经有
 * `运行成本` / `品牌对比` / `本地服务` / `专业长尾` 这种一眼就像列头的词）；5 字以上是短语，
 * 与 chrome 同形的概率可忽略，而它们仍被下面「减法只对数据串生效」的对照组与 5 条整页守卫兜着。
 *
 * **摩擦是刻意的**：往种子语料里加一个 ≤4 字的新词 ⇒ 这条断言红 ⇒ 必须回来判断
 * 「它会不会与某个界面标签同形」。这正是把「放行面变宽」从**静默**变成**必须过审**。
 *
 * **M3–M7 那 8 个新 seed 模块只让短尾多出 2 条**（81 → 83），都已逐条判断过：
 * `关于澜舟` 是被引用页面的标题（`seed/collection-records*.ts` 的 `sources[].title`），
 * `销售运营` 是处方的建议负责团队（`seed/actions.ts` 的 `owner_hint`）。两者都是**数据**，
 * 与任何界面标签不同形；≤3 字那两档一条没多（62 / 63 原样），风险面没有实质变宽。
 *
 * **M1.5 那两个 seed 模块（关键词 14 + 生成池 12、FAQ 8 + 生成池 8）只让短尾多出 1 条**
 * （83 → 84）：`故障排查`，是 FAQ 的自由文本分类（`seed/faqs.ts` 的 `category`）。逐条判断：
 * 全仓 `rg 故障排查` 除种子外**零命中**（`i18n/locales/**`、`components/**`、`pages/**` 都没有
 * 这个串）⇒ 没有任何界面标签与它同形，减法不会吃掉 chrome。FAQ 另外 7 个分类
 * （`选型` / `报价` / `安装` / `验收` / `维保` / `售后` / `工况`）**一条都没新增**——
 * M3–M7 的处方语料早就把它们收进清单了。≤3 字那两档同样一条没多（62 / 63 原样）。
 *
 * **M1.2b 的 `seed/kb.ts` v2（25 条知识 + 6 行生成池；taxonomy 11 模块 + 场景维度）把短尾
 * 从 84 抬到 99（+15）**：`决策链` / `冶金` / `合规红线` / `品牌故事` / `回访` / `官网地址` /
 * `定义句` / `差异点` / `应对` / `开场` / `成交推进` / `服务` / `水泥` / `评级` / `运维成本`
 * ——全部来自知识条目的标题、正文与 `tags`（话术按场景成段、竞品按「差异点 / 应对 / 评级」成列，
 * 所以短词比 v1 密）。上一轮 v1 那 16 条里的 `厂区` / `窑线` / `滤袋` / `沿革` / `商务` /
 * `现场` / `口径` / `授权` / `清单` / `人群` / `对照` / `模板` 随种子重写退场。
 * 三档实测（M9 组合页的两个 onboarding 项目之前）：≤2 字 **69** / ≤3 字 **73** / ≤4 字 **99**（总清单 666 条）。
 * 🔴 M9 组合页新增两个「已接入、尚未采集」的项目（澄川水处理设备 / 禾野食品供应链）后，
 * 短尾 +6：`澄川` / `澄川环保` / `禾野` / `膜法` / `冷链` / `餐饮渠道`（总 105 条）。
 * 六个都是品牌名、别名或标签（数据）；en 词典里没有逐字相同的值 ⇒ 减法不会吃掉 chrome。
 *
 * 🔴 15 条里有 **3 条与 zh 词典标签逐字相同**，必须点名说清为什么仍然放行：
 * - `定义句` == `kb.kinds.statement` 的 zh 值（种子里它是知识条目的一个 `tags` 元素）；
 * - `官网地址` == `fields.website` 的 zh 值（`demo-kb-103` 那条 link 条目的标题——从实体卡导入时
 *   标题就取字段名，见 `components/kb-import.ts`）；
 * - `成交推进` == `kb.scenarios.sales_closing` 的 zh 值（种子里它是销售话术正文的一段）。
 *
 * **放行依据（本轮从「逐词论证」升级成可执行判据）**：M-1 的失败形态是「漏翻的中文 chrome 被
 * 减法吃掉」，而减法只可能吃掉与数据串**逐字相同**的那条 chrome。把 en-US 词典整棵树摊平后与
 * 短尾清单求交，实测**交集为空**（zh 侧有 11 条同形、en 侧 0 条）⇒ en-US 渲染出的任何词典标签
 * 都不可能被减掉。这条不再只写在注释里：下面「防空跑」那条用例用 `EN_DICT_SHORT_OVERLAP` 现算。
 * 另外漏翻在**编译期**就红：`ResourceBundle = typeof zhCN`（`i18n/resources.ts`）+ en 侧每个 namespace
 * 文件各自标注 `ResourceBundle['<ns>']` ⇒ en 缺任何一个 zh 已有的键都是 `tsc -b` 错误，
 * `fallbackLng: 'zh-CN'` 那条回落路径对**词典键**结构性不可达（它只可能救"两侧都拼错的 key"，
 * 而那会露出裸 key、不含 CJK，仍被本守卫抓住）。至于"组件里硬编码一个 `定义句`"这种形态，
 * 判据在 `i18n/no-hardcoded-strings.test.ts` 的源码扫描（它不看渲染结果、因此不受减法影响）。
 * ⚠ 这三条论证是**放行前提**：哪天 en 侧的整体类型标注被摘掉，这里必须重新过审。
 */
const SHORT_DATA_MAX_LENGTH = 4;

const SHORT_DATA_PINNED: readonly string[] = [
  '专业长尾', '云栖', '云栖协作', '交付', '付款', '价格', '会话数', '供应链', '冷链',
  '关于澜舟', '决策链', '冶金', '勘测', '区域', '协作办公', '压差', '原理',
  '参数', '口碑', '合同', '合规', '合规红线', '同舟办公', '品牌对比', '品牌故事',
  '品类', '品类认知', '响应', '售后', '回访', '培训', '备件', '安徽',
  '安装', '官网地址', '定义句', '对比', '寿命', '山东', '工业除尘', '工况', '澄川', '澄川环保',
  '工期', '工艺', '差异点', '平均排名', '应对', '开场', '恒宇环境', '成交推进',
  '扩容', '报价', '招标', '排查', '改造', '故障', '故障排查', '方案',
  '施工', '服务', '本地服务', '标准', '案例', '检测', '水泥', '江苏',
  '测定', '浙江', '清源环保', '清灰', '滤料', '滤芯', '澜舟', '澜舟环保', '禾野', '膜法',
  '澜舟除尘', '焊接烟尘', '环保工程', '管道', '维保', '耗材', '腾讯混元', '苏州澜舟',
  '蓝净', '蓝净科技', '行业', '规范', '设计', '评级', '质保', '资质',
  '车间', '运维', '运维成本', '运行成本', '选型', '配套', '采购', '销售运营',
  '防爆', '预算', '风量', '验收', '高温', '餐饮渠道',
];

/**
 * 总清单的**上界**（15b #50 的另一半）。短尾已经逐字钉死，这里管的是「长尾也不许无声暴涨」：
 * 真值 **666**（M3–M7 的 8 个 seed 模块把语料翻了一倍到 454；M1.5 那两个模块再加 73 条到 527；
 * M1.2 的 `seed/kb.ts` 再加 58 条到 585——知识条目的正文是多行 Markdown 语料，与 FAQ 的多行答案同性质；
 * M6.5 的 `seed/site.ts` 再加 67 条到 652——补丁正文是**字面量** HTML / JSON-LD / robots.txt 追加段，
 * 一条动辄几十行，是历轮最大的一次语料增量；M1.2b 把 `seed/kb.ts` 重写到 25 条知识 + 6 行生成池，
 * 该模块自身从 58 条涨到 82 条，与其他模块去重后**净增 14 条**到 666；M6 文章管理的
 * `seed/articles.ts`（方向 / 模板 / 排期 / 文章四组种子，文章正文是多行 Markdown 语料）再加 49 条到 715；
 * M5.5 的 `seed/search-data.ts` 再加 **36** 条到 **751**——7 个源的 `check_detail` / `note`、
 * 6 条机会的 `basis`、C 类留档的 `label` 与 30 行指标的中文词面，都是"平台会怎么回话"的语料）。
 * 留到 870 ⇒ 正常加语料（长串，与 chrome 同形概率可忽略）不会打红，但一次大批量导入必须回来过审。
 * 留白比例与前几轮一致（454 → 520 是 +15%，527 → 600 是 +14%，585 → 680 是 +16%，715 → 820 是 +15%，
 * 751 → 870 是 +16%），刻意没有借这次放宽。
 * 🔴 M5.5 这轮**短尾只多出 2 条**（99 → 101：`会话数` / `平均排名`）：它们是 C 类"平台独有维度"的
 * **原生字段名**，DR-107 裁定原样留档、刻意不翻译（翻成英文客户就认不出自己后台里那一列），
 * 所以是数据不是 chrome；且 `EN_DICT_SHORT_OVERLAP` 现算为空（en 词典里没有与之逐字相同的值）
 * ⇒ 减法吃不掉任何未翻译的界面文案，M-1 那个风险形状没有变宽。
 * 🔴 M6 那 49 条**没有一条落进短尾**（`ART_NEW_SHORT` 实测为空：文章正文与方向摘要都是整段语料，
 * 短词只是整串的内部片段）⇒ `SHORT_DATA_PINNED` 一条没变，风险面没有变宽。
 * 🔴 这 67 条**没有一条落进短尾**：补丁正文里的 `项目` / `过滤风速` / `清灰方式` 这些短词是
 * 整段正文的**内部片段**，而 `collectCjkStrings` 收的是种子导出的**整串**，片段不会单独入清单
 * ⇒ `SHORT_DATA_PINNED` 一条没变（这正是短尾要钉的那个风险面没有变宽的证据）。
 * 下界仍是 `>= 20`（它只负责防空跑，见那条断言的注释）。
 */
const DATA_STRINGS_UPPER_BOUND = 870;

/**
 * en-US 词典里**刻意**含 CJK 的值（第二类例外，形状钉死为恰好 2 条）。
 *
 * - `common.appName` = `'稿得快 GEO'`：产品名，两侧**逐字相同**（专有名词不译）。
 * - `project.wizard.aliasesPlaceholder` = `'e.g. HongYu, 宏宇'`：那个中文样本是**产品意图**
 *   而不是漏翻——别名既可能是中文也可能是拼音，占位提示要同时示范两种写法
 *   （`i18n/locales/zh-CN/project.ts` 顶部那段注释讲的就是它，zh 侧对应值是 `'例如：宏宇、HongYu'`）。
 *
 * ⚠ 从词典**现算**、不手抄，并逐条钉住：en 侧再长出一个含中文的值 ⇒ 下面那条断言立刻红，
 * 必须回来判断它是"同类刻意样本"还是真漏翻。这条例外因此不会悄悄长大。
 */
function leafValues(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) leafValues(value, out);
  }
  return out;
}

const EN_DICT_CJK: string[] = leafValues(enUS)
  .filter((value) => CJK.test(value))
  .sort((left, right) => right.length - left.length);

/**
 * 🔴 短尾减法清单与 **en-US 词典叶子值**的逐字交集（M-1 的可执行判据，论证见
 * `SHORT_DATA_PINNED` 上方那段）。恒空 ⇒ 减法结构上不可能吃掉任何 en-US chrome。
 * 与 `EN_DICT_CJK` 同姿态：从词典**现算**、不手抄清单。
 */
const EN_DICT_SHORT_OVERLAP: string[] = [...new Set(leafValues(enUS))].filter(
  (value) => value.length <= SHORT_DATA_MAX_LENGTH && DATA_STRINGS.includes(value),
);

/** 把节点文本里的数据串与已登记的词典例外逐个减掉，返回剩下的部分。 */
function withoutData(text: string): string {
  let rest = text;
  for (const data of [...DATA_STRINGS, ...EN_DICT_CJK]) rest = rest.split(data).join('');
  return rest;
}

/** 当前 DOM 里「减掉数据之后仍含 CJK」的文本节点（= 界面文案泄漏，格式带上原文便于定位）。 */
function unexplainedCjkText(): string[] {
  const offenders: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const raw = node.textContent ?? '';
    if (!CJK.test(raw)) continue;
    const rest = withoutData(raw);
    if (CJK.test(rest)) offenders.push(`剩下 "${rest.trim()}" ⟵ 节点原文 "${raw.trim()}"`);
  }
  return offenders;
}

/** 每个页面都要先证明自己**真的渲染出来了**，否则「0 条泄漏」是空跑。 */
function expectRendered(englishChrome: string): void {
  // 用 queryAll：带 `scroll.x` 的 antd 表格会额外渲染一个 measure-cell 副本，
  // 同一个表头会命中两次——「至少渲染出一次」才是这条判据要的。
  const hits = screen.queryAllByText(englishChrome);
  expect(hits.length, `页面没渲染出 "${englishChrome}"，判据是空跑的`).toBeGreaterThan(0);
  expect((document.body.textContent ?? '').length).toBeGreaterThan(40);
}

/**
 * 等到演示种子数据**真的上屏**（标题在 loading 期间就渲染了，只等标题等于没等）。
 * 没有这一步，"页面还在转圈 ⇒ 一个文本节点都没有 ⇒ 0 条泄漏" 会让判据空跑。
 */
async function expectDataLanded(): Promise<void> {
  await waitFor(() => {
    const body = document.body.textContent ?? '';
    expect(
      DATA_STRINGS.some((value) => body.includes(value)),
      '页面没有渲染出任何演示种子数据 ⇒ 数据面没落地，本条判据是空跑的',
    ).toBe(true);
  });
}

/**
 * 切到「第 3 轮 · 行动后复测」。
 *
 * 🔴 M5 默认选中的是**进行中**的第 4 轮，而进行中的那一轮在种子里刻意没有体检结果
 * （`diagnosis.noData` 那支）⇒ 不切一轮，本条判据扫到的是一片空状态卡片，等于空跑。
 * 选复测轮是因为它在种子里数据最全：体检 / 五维 / 竞品矩阵 / 意图漏斗 / 告警都出得来。
 * （M7 报告页默认就选最近一轮**能出报告**的，恰好也是复测轮，所以那边不用切。）
 */
async function selectCompletedRound(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const round = SEED_COLLECTION_ROUNDS.find((entry) => entry.id === SEED_RETEST_ROUND_ID)!;
  await user.click(screen.getByRole('combobox'));
  const options = (await screen.findAllByTitle(round.label)).filter((element) =>
    element.hasAttribute('aria-selected'),
  );
  expect(options, `轮次下拉里没有「${round.label}」`).toHaveLength(1);
  await user.click(options[0]);
}

/**
 * 渲染设置页的某个分段（走真路由参数，与 `SettingsLayout` 的分派一致）。
 *
 * 返回前等到分段标题上屏：设置页在 `settings_get` 回来之前只渲染一个 loading 卡片，
 * 不等一下就会扫到一片空 DOM ⇒ "0 条泄漏"是空跑。
 */
async function renderSettingsSection(
  section: (typeof SETTINGS_SECTIONS)[number],
  englishHeading: string,
): Promise<void> {
  renderAtRoute(
    <SettingsPage />,
    '/settings/:section',
    `/settings/${section}`,
    'en-US',
  );
  await screen.findByRole('heading', { name: englishHeading });
}

/**
 * 对照组（②③）用的那条数据串。
 *
 * 🔴 **不能直接拿 `DATA_STRINGS[0]`**：M6.5 之后最长的那条是**补丁正文**，而补丁正文是字面量
 * HTML / JSON-LD（`demo/seed/site.ts`）。对照组是用 `innerHTML` 把它塞进去的 ⇒ 那段 HTML 会被
 * **解析成真 DOM**，一个 `<div>` 炸成几十个文本节点，逐节点做的减法自然对不上，对照组会假红。
 * 页面上不会这样：`SitePatchTable` 把正文放进 `<pre>{row.body}</pre>`、编辑器放进 `TextArea`，
 * React 一律转义成**单个**文本节点（SitePage 那条 en-US 用例因此是绿的）。
 * 这里要验的只是"纯数据串不算泄漏"，所以挑一条**不含标记**的：判据形状一字不改，
 * 只是躲开测试自己的注入方式。
 */
const CONTROL_DATA_STRING = DATA_STRINGS.find((value) => !/[<>]/.test(value)) as string;

const MESSAGE =
  '这些文本节点在减掉演示种子数据之后仍含中文 ⇒ **界面文案**泄漏（词典漏翻 / 硬编码 / ' +
  '后端散文行直接上屏）。迁进 `i18n/locales/**`（zh/en 同批），🔴 不许把数据串加进 DATA_STRINGS 来让它变绿';

describe('常驻守卫（第 9 条）· 每个页面/分段在 en-US 下整页无非数据 CJK', () => {
  it('防空跑：设置页的分段清单与 `pages/settings/sections.ts` 逐字相等（5 段，没有「扩展」）', () => {
    expect([...SETTINGS_SECTIONS]).toEqual(['general', 'models', 'collection', 'storage', 'about']);
  });

  it('防空跑：数据清单非空、真的从种子里数得出中文，且减法只对数据串生效', () => {
    // 下界只防「清单空了」（那会让判据退化成「整页无 CJK」⇒ 整页假红）。
    expect(DATA_STRINGS.length, '种子数据清单为空 ⇒ 判据退化成「整页无 CJK」，会整页假红').toBeGreaterThanOrEqual(20);
    // 🔴 上界防「清单胖了」（15b #50 / M-1）：放行面变宽必须过审，不许静默。
    expect(
      DATA_STRINGS.length,
      `减法清单涨过 ${DATA_STRINGS_UPPER_BOUND} 条 ⇒ 放行面变宽了，必须回来过审（15b #50）`,
    ).toBeLessThanOrEqual(DATA_STRINGS_UPPER_BOUND);
    // 🔴 短尾（≤4 字）逐字钉死：这是 M-1 的真正风险面。条数与长度分布**只在** SHORT_DATA_PINNED
    // 上方那段 docblock 里维护（刻意不写行号：行号会随编辑漂移，见 15c-2 复审 Nit-1），
    // 这里也刻意**不抄第二份数字**：本行原先写着「62 个两字通用词」，
    // 可被钉的清单按 `SHORT_DATA_MAX_LENGTH` 收的是 ≤4 字那一档 —— 两个数根本不是同一个集合，于是这句
    // 注释成了过期陈述（15c-2 复审 Nit-1，与台账 #12/#47 同一缺陷类）。只改注释，判据一个字未动。
    const shortOnes = DATA_STRINGS.filter((value) => value.length <= SHORT_DATA_MAX_LENGTH).sort();
    expect(
      shortOnes,
      '短尾放行清单变了 ⇒ 有一个 ≤4 字的中文串新进了减法清单。它可能与某个界面标签**逐字相同**，' +
        '从而把未翻译的 chrome 静默减掉（15a 复审 M-1）。逐条判断后同步 SHORT_DATA_PINNED。',
    ).toEqual([...SHORT_DATA_PINNED].sort());
    expect(shortOnes.length, '短尾条数上界（与逐字清单同一个闸门，便于定位）').toBe(SHORT_DATA_PINNED.length);
    // 🔴 上面那条钉的是「清单长什么样」，这条钉的是「清单**能不能**吃掉 chrome」：
    // 只要交集为空，逐字同形的 zh 标签（今天 11 条）就与 en-US 渲染结果无关。
    expect(
      EN_DICT_SHORT_OVERLAP,
      '有 ≤4 字的种子串与 en-US 词典值逐字相同 ⇒ 减法会静默吃掉那条未翻译的 chrome（15a 复审 M-1）。' +
        '逐条过审：要么改种子语料，要么说明它为什么不是 chrome。',
    ).toEqual([]);
    expect(DATA_STRINGS.some((value) => value.includes('澜舟')), '清单里连品牌名都没有 ⇒ 走错了桩数据源').toBe(true);
    // en 词典里刻意含 CJK 的值：逐条钉死（多一条 ⇒ 必须回来判断是刻意样本还是漏翻）
    expect(EN_DICT_CJK, 'en-US 词典里含 CJK 的值变了（逐条判断：刻意样本还是漏翻？）').toEqual([
      'e.g. HongYu, 宏宇',
      '稿得快 GEO',
    ]);
    // 长串排在前面（减法顺序的前提）
    for (let index = 1; index < DATA_STRINGS.length; index += 1) {
      expect(DATA_STRINGS[index - 1].length).toBeGreaterThanOrEqual(DATA_STRINGS[index].length);
    }
    expect(withoutData('Save')).toBe('Save');
    // 数据串被减成空；数据串之外的中文一个字符都不减
    expect(withoutData(DATA_STRINGS[0])).toBe('');
    expect(withoutData('保存')).toBe('保存');
    // 反向对照（15b #50）：短尾清单是**白名单**，不在里面的同长度中文词一个都不许被减掉。
    // 这几个都是真实界面标签用词，且都不在那 81 条短尾里 ⇒ 若哪天语料长出同形词，上面那条会先红。
    for (const chrome of ['设置', '删除', '导出', '项目', '状态']) {
      expect(withoutData(chrome), `「${chrome}」不在数据清单里却被减掉了 ⇒ 减法过宽`).toBe(chrome);
    }
  });

  /**
   * ⚠ 这条用例直接改 DOM，所以改动一律收进自己创建的宿主节点、`finally` 里摘掉：
   * RTL 的 `cleanup()`（`test/setup.ts:35`）只卸它自己建的容器，
   * 留在 `document.body` 上的节点会漏给后面 5 个页面用例，把它们的判据污染成假红
   * （本轮实测踩过：`['A', 'B'].join('、')` 那个探针串在 ProjectWizardPage 与 SettingsPage 里又红了一次）。
   */
  it('自证（对照组）：塞一个中文文本节点就会被扫出来；塞一条数据串则不会', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      host.innerHTML = '<div>Save</div>';
      expect(unexplainedCjkText()).toEqual([]);

      // ① 裸中文 chrome ⇒ 必须红
      host.innerHTML = '<div>保存</div>';
      expect(unexplainedCjkText()).toHaveLength(1);

      // ② 数据串 ⇒ 合格（这条证明判据不是「见中文就红」）
      host.innerHTML = `<div>${CONTROL_DATA_STRING}</div>`;
      expect(unexplainedCjkText()).toEqual([]);

      // ③ 模板 + 数据：中文模板部分仍要报（这条才是 ② 的对价）
      host.innerHTML = `<div>已抽取：${CONTROL_DATA_STRING}</div>`;
      expect(unexplainedCjkText()).toHaveLength(1);

      // ④ 中文标点同样看得见（`、` U+3001 不在窄区间里，是 Task 8 复审 #6 的漏网形态）
      host.innerHTML = "<div>['A', 'B'].join('、')</div>";
      expect(unexplainedCjkText()).toHaveLength(1);

      // ⑤ 已登记的词典例外（那个刻意保留的中文样本）⇒ 合格
      host.innerHTML = `<div>${EN_DICT_CJK[0]}</div>`;
      expect(unexplainedCjkText()).toEqual([]);
    } finally {
      host.remove();
    }
  });

  it('ProjectListPage：项目表的 chrome 全英文，中文只来自数据列', async () => {
    renderWithProviders(<ProjectListPage />, { locale: 'en-US' });
    await screen.findByRole('heading', { name: 'Projects' });
    await expectDataLanded();
    expectRendered('New project');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('EntityCardPage：实体卡字段名全英文，中文只来自字段值', async () => {
    renderAtRoute(
      <EntityCardPage />,
      '/projects/:id/entity-card',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/entity-card`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Brand Entity Card' });
    await expectDataLanded();
    expectRendered('Revision history');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  /**
   * ── M1.2 知识层（知识库）─────────────────────────────────────────────────
   *
   * 位置照 DR-69 的导航顺序（实体卡 → 知识库 → 关键词库 → FAQ 库 → 题库）。
   *
   * 🔴 这一页的 chrome 面比前几页都大：10 个模块名 + 10 句模块用途说明 + 6 种素材形式 +
   * 5 档来源 + 7 格统计 + 同步说明条，全是**从数据拼出来的动态 key**
   * （`kb.modules.*` / `kb.modulesHint.*` / `kb.kinds.*` / `kb.sources.*` /
   * `entity.fields.*` / `kb.sync.projectFields.*`）⇒ 漏一个词条就露出裸 key 或中文。
   * 模块面板默认全展开（`KbModulePanels` 的 `defaultActiveKey`），所以不用点就已经扫到全部条目卡。
   */
  it('KnowledgeBasePage：模块名/形式/来源/统计与工具条全英文，中文只来自条目语料', async () => {
    renderAtRoute(
      <KnowledgeBasePage />,
      '/projects/:id/knowledge',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/knowledge`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Knowledge base' });
    await expectDataLanded();
    // 🔴 点名扫这五处：模块名（动态 key）、演示模式提示（漏了就成了"假素材"）、
    // 职责说明条（DR-73：同步横幅退役之后由它承担"实体卡与知识库不互相同步、导入是一次性复制"
    // 的口径告知，漏了用户会以为改一处另一处跟着变）、统计条新加的那一格（`kb.stats.scripts`）、
    // 与工具条上的导入入口（DR-81）。
    expectRendered('New entry');
    expect(screen.getAllByText(/Brand overview/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        'Demo mode: sample data only; AI generation does not call a model; images and videos are not fetched.',
      ),
    ).toBeInTheDocument();
    // ⚠ 用正则而不是整串相等：说明条里带破折号与弯引号，逐字抄一遍等于把词典值抄进测试
    // （词典改一个标点这里就假红，而这条判据要管的是"有没有翻"，不是"标点长什么样"）。
    expect(screen.getAllByText(/They do not sync with each other/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Talk tracks').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Import from entity card').length).toBeGreaterThan(0);

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  /**
   * ── M1.5 素材层的两个页面（关键词库 / FAQ 常见问题库）─────────────────────
   *
   * 位置照 DR-37 的导航顺序（实体卡 → 关键词库 → FAQ 库 → 题库）。
   *
   * 🔴 这两页的**数据面比前几页更容易与 chrome 同形**：`kind` / `category` 那两列是
   * `选型` / `报价` / `维保` / `工况` 这类两字词，与界面标签的常用词高度重叠。
   * 所以这两个 seed 模块进 `DATA_STRINGS` 时，`SHORT_DATA_PINNED` 那条逐字清单**必须**同步过审
   * （M-1 的缺陷形状：往语料里加一个两字通用词，减法就自动多放行一个词）。
   *
   * `category` 是**自由文本数据**（不进词典），en 界面下照旧是中文——与项目名 / 别名同一性质。
   */
  it('KeywordLibraryPage：类型/来源/状态标签与工具栏全英文，中文只来自词面与备注', async () => {
    renderAtRoute(
      <KeywordLibraryPage />,
      '/projects/:id/keywords',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/keywords`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Keyword Library' });
    await expectDataLanded();
    // 🔴 点名扫这句：它是本页最容易被漏翻、又最不能漏的一句（漏了就成了"假调研数据"）。
    expectRendered('Add manually');
    expect(
      screen.getByText(
        'Monthly volume and competition difficulty are preset static values in demo mode; the frontend neither fetches nor computes them.',
      ),
    ).toBeInTheDocument();

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('FaqLibraryPage：问答表与导出区全英文，中文只来自问题、答案与分类', async () => {
    const user = userEvent.setup();
    renderAtRoute(
      <FaqLibraryPage />,
      '/projects/:id/faq',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/faq`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'FAQ Library' });
    await expectDataLanded();
    expectRendered('Export FAQPage JSON-LD');

    // 空态扫一遍，再**展开一行**扫一遍：答案原文与那句合规提示只在展开之后才上屏，
    // 不点这一下，FAQ 最大的一片数据面（多行 Markdown 答案）就是空跑。
    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
    const row = screen
      .getAllByRole('row')
      .find((entry) => entry.querySelector('.ant-table-row-expand-icon') !== null);
    expect(row, 'FAQ 表里没有可展开的行').toBeDefined();
    await user.click(row?.querySelector('.ant-table-row-expand-icon') as HTMLElement);
    await screen.findByText('Answer preview');
    await waitFor(() => expect(unexplainedCjkText(), MESSAGE).toEqual([]));
  });

  it('PromptSetPage：题库表格与筛选器全英文，中文只来自题干与分组名', async () => {
    renderAtRoute(
      <PromptSetPage />,
      '/projects/:id/prompts',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/prompts`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Prompt Library' });
    await expectDataLanded();

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('ProjectWizardPage：向导步骤与表单字段全英文（空白表单，本页连数据都不该有中文）', () => {
    renderWithProviders(<ProjectWizardPage />, { locale: 'en-US' });
    expectRendered('New project');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  /**
   * ── 新建项目的两屏（Plan B Task 7）──────────────────────────────────────
   *
   * 两屏都**不调** `expectDataLanded()`：岔路口不发任何 IPC，自动采集屏在点「开始」之前
   * 也不发（判据分别在 `NewProjectPage.test.tsx` ③ 与 `AutoBuildProjectPage.test.tsx` ①），
   * 所以种子语料一条都不会上屏，等它落地会永远超时。防空跑由 chrome 串 + 标题负责。
   */
  it('NewProjectPage：模式选择屏全英文（岔路口没有数据面）', () => {
    renderWithProviders(<NewProjectPage />, { locale: 'en-US' });
    expectRendered('Auto-build from a URL');
    expect(screen.getByRole('heading', { name: 'New project' })).toBeInTheDocument();

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('AutoBuildProjectPage：自动采集屏全英文，含那句常驻的演示提示', () => {
    renderWithProviders(<AutoBuildProjectPage />, { locale: 'en-US' });
    // 🔴 点名扫这句：它是本页最容易被漏翻、又最不能漏的一句（漏了就成了"假抓取"）。
    expectRendered('Demo mode does not fetch web pages. The extracted fields are preset data.');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  /**
   * ── 设置页的 5 个分段（Plan B Task 2 把单页拆成 `/settings/:section`）────────────
   *
   * 判据与原来的 `SettingsPage` 那一条**逐字相同**，只是从"一页扫一次"变成"一段扫一次"：
   * 拆段之后每段各自是一屏，只扫 `general` 会把模型段的厂商名（`label_zh` 泄漏面最大的那处）
   * 整个漏掉。分段清单从 `pages/settings/sections.ts` 现取，多一段少一段都由下面的
   * `SETTINGS_SECTION_SCANS` 长度断言兜住。
   *
   * ⚠ 五段**都不调** `expectDataLanded()`：设置页上屏的中文只有 `secret_ref` 这类 ASCII 记号
   * 与**词典**里的服务商名（Task 8 起不再回落种子的 `label_zh`），所以种子语料一条都不会出现，
   * 等它落地会永远超时。防空跑改由 `expectRendered`（chrome 串 + body 长度）与分段标题负责。
   */
  it('Settings · general：外观 / 语言 / 代理 / 通知全英文', async () => {
    await renderSettingsSection('general', 'General');
    expectRendered('Network proxy');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('Settings · models：厂商名走词典、不许回落 `label_zh`，密钥区全英文', async () => {
    await renderSettingsSection('models', 'Model providers');
    expectRendered('Model provider');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('Settings · collection：并发与频控的 5 个 label 全英文', async () => {
    await renderSettingsSection('collection', 'Collection and rate limits');
    expectRendered('Queue length');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('Settings · storage：数据与存储段全英文', async () => {
    await renderSettingsSection('storage', 'Data and storage');
    // 🔴 这一段的事实行来自 `app_environment`（Task 5 起不再是空状态占位）：
    // 等**数据行**上屏再扫，否则 loading 骨架下"0 条泄漏"是空跑。
    await screen.findByText('Data directory');
    expectRendered('Migrations applied');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('Settings · about：关于段全英文', async () => {
    await renderSettingsSection('about', 'About');
    await screen.findByText('Open-source licenses');
    expectRendered('Build');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  /**
   * ── M3–M7 的 5 个页面 ──────────────────────────────────────────────────
   *
   * 判据与前 5 个页面**逐字相同**，差别只在数据面：这几页上屏的中文语料是问题原文、
   * 回答片段、核查引文、处方 rationale、报告正文段落，量级比项目名 / 别名 / 字段值大得多。
   * 它们全部来自 `demo/seed/**` ⇒ 已经进了 `DATA_STRINGS`，减完之后剩下的中文只可能是
   * **界面文案**泄漏。
   *
   * 🔴 这几页最容易漏翻的三处形态，正是本组用例的靶心：
   * ① 枚举标签（引擎 / 情感 / 风险标记 / 处方类别 / 报告节名）——漏一个就是裸中文或裸枚举值；
   * ② `components/format.ts` 的两个 delta 格式化器（百分点 vs 原始单位）拼出来的复合串；
   * ③ 报告正文里的免责与口径说明（`report.disclaimer` 等），它们在 zh 侧最长、最像散文。
   */
  it('CollectionPage：轮次概览、任务队列与证据表全英文，中文只来自语料', async () => {
    renderAtRoute(
      <CollectionPage />,
      '/projects/:id/collection',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/collection`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Multi-engine Collection' });
    await expectDataLanded();
    expectRendered('Task queue');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('InsightPage：解析结果表与筛选器全英文，中文只来自问题原文与回答片段', async () => {
    renderAtRoute(
      <InsightPage />,
      '/projects/:id/insight',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/insight`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Answer Parsing and Fact Check' });
    await expectDataLanded();
    expectRendered('Risk flags');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('WebmasterDataPage：三分组源墙 / 汇总条 / AI 面 / C 类面板 / 机会卡全英文，中文只来自平台回话的语料', async () => {
    renderAtRoute(
      <WebmasterDataPage />,
      '/projects/:id/webmaster-data',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/webmaster-data`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Webmaster Data · All Platforms' });
    await expectDataLanded();
    expectRendered('Cross-platform aggregate');

    // 🔴 这一页的中文语料面比其它页**更容易假绿**：平台名（百度搜索资源平台 / 头条搜索站长平台）
    // 走的是词典 `webmasterData.sources.*`，en 侧逐字是英文写法（`Google Search Console` 等），
    // 所以这里减掉的中文只可能是**数据**（源的 `check_detail` / `note`、机会的 `basis`、
    // C 类留档的 `label`）。判据与其余 12 条同形状：减完还剩中文 ⇒ 一定是 chrome 泄漏。
    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('OverviewPage：KPI / 竞品 / 风险 / 行动全英文，中文只来自项目与处方语料', async () => {
    renderAtRoute(
      <OverviewPage />,
      '/projects/:id/overview',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/overview`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Project Overview' });
    await expectDataLanded();
    expectRendered('Next actions');

    // 概览默认落在最近一轮**有结论**的，不需要像诊断页那样切轮次。
    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('PortfolioPage：组合统计 / 分布 / 项目清单全英文，中文只来自项目名', async () => {
    renderAtRoute(
      <PortfolioPage />,
      '/portfolio',
      '/portfolio',
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Portfolio Overview' });
    await expectDataLanded();
    expectRendered('Project list');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('DiagnosisPage：五维得分、竞品矩阵与意图漏斗全英文，中文只来自归因语料', async () => {
    const user = userEvent.setup();
    renderAtRoute(
      <DiagnosisPage />,
      '/projects/:id/diagnosis',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/diagnosis`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Diagnosis and Attribution' });
    await selectCompletedRound(user);
    await screen.findByText('GEO health score');
    await expectDataLanded();
    expectRendered('Five dimensions');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('ActionPage：处方表与内容面板全英文，中文只来自处方标题与 rationale', async () => {
    renderAtRoute(
      <ActionPage />,
      '/projects/:id/action',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/action`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'GEO Action Center' });
    await expectDataLanded();
    expectRendered('Top prescriptions');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  /**
   * ── M6 文章管理 Article Studio（spec 2026-10-10 · DR-83 … DR-89）────────────
   *
   * 位置照 DR-83 的导航顺序（行动中心之后、站点接入之前）。
   *
   * 🔴 这一页的 chrome 是**三个 Tab 名 + 排期表列头 + 评审队列按钮**，数据面是**文章正文**
   * （多行 Markdown 语料，与 FAQ 答案 / 知识条目正文同性质）⇒ `seed/articles.ts` 必须进
   * `DATA_STRINGS`（上面那个模块清单），否则正文里的中文会整页假红。
   * Tabs 默认只挂载活动面板，所以排期表的 chrome（频率枚举标签 `article.freqs`，动态 key、
   * 字面量扫描看不见）要**先切到第三个 Tab** 才扫得到。
   */
  it('ArticleStudioPage：Tab 名/演示提示/排期与评审 chrome 全英文，中文只来自文章语料', async () => {
    renderAtRoute(
      <ArticleStudioPage />,
      '/projects/:id/articles',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/articles`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Article Studio' });
    await expectDataLanded();
    // 🔴 点名扫这三处：演示模式提示（DR-85 的三句口径：不调模型 / 不自动跑 / 刷新即重置，
    // 漏了用户会以为排期真的会到点出稿）、页题、与方向工作区的主按钮。
    expect(
      screen.getByText(
        'Demo mode: directions, templates and articles are preset samples. ' +
          'AI generation does not call a model, schedules do not fire on their own, and a reload resets everything.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Directions').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Prompt templates').length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.click(screen.getByText('Schedule and articles'));
    // 排期表与评审队列都挂在第三个 Tab 上：频率标签（动态 key）+ 评审态标签（动态 key）。
    expect(screen.getAllByText('Daily').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pending review').length).toBeGreaterThan(0);

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('SitePage：站点档案 / 通道卡 / 补丁工作台全英文，中文只来自补丁标题与自检结论', async () => {
    renderAtRoute(
      <SitePage />,
      '/projects/:id/site',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/site`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Site Connect' });
    await expectDataLanded();
    expectRendered('Patch bench');

    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
  });

  it('ReportPage：生成报告后正文、节标题与免责说明全英文，中文只来自报告语料', async () => {
    const user = userEvent.setup();
    renderAtRoute(
      <ReportPage />,
      '/projects/:id/report',
      `/projects/${SEED_ACTIVE_PROJECT_ID}/report`,
      'en-US',
    );
    await screen.findByRole('heading', { name: 'Reports and Sharing' });
    await expectDataLanded();
    expectRendered('Render report');

    // 空状态扫一遍，再**生成一次报告**扫一遍：正文段落与节标题只在生成之后才上屏，
    // 不点这一下，M7 最大的一片文案面（`report.sections.*` + `report.disclaimer`）就是空跑。
    expect(unexplainedCjkText(), MESSAGE).toEqual([]);
    await user.click(screen.getByRole('button', { name: /Render report/ }));
    // 老板版渲染 conclusion + evidence 两节；`Conclusion` 是节标题里唯一不与其他文案重名的。
    await screen.findByText('Conclusion');
    await waitFor(() => expect(unexplainedCjkText(), MESSAGE).toEqual([]));
  });
});

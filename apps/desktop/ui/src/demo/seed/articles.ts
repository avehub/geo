/**
 * 种子：文章管理 Article Studio（M6 内容生产，spec `2026-10-10-kb-redesign-and-article-studio-design.md` §4 / DR-85）。
 *
 * # 🔴 四张有写路径的表 + 两个预置池
 * - `SEED_ARTICLE_DIRECTIONS` / `SEED_ARTICLE_TEMPLATES` / `SEED_ARTICLE_SCHEDULES` / `SEED_ARTICLES`
 *   **进内存库**（新增方向、存模板、开关排期、评审文章都会写它们）；
 * - `SEED_ARTICLE_DIRECTION_POOL` 与 `SEED_ARTICLE_POOL` **不进库**：它们是「AI 生成」的替身，
 *   要让"点一下生成 → 库里多出来"这件事在界面上看得见（与 `SEED_KB_GENERATED_POOL` /
 *   `SEED_KEYWORD_GENERATED_POOL` 同一条裁定，AGENTS 规则 9：demo 不调模型，逐字端出预置语料）。
 *
 * # 🔴 去重是**按标题**的（`handlers/article.ts`）
 * 种子里那两条 `pending_review` 的文章，标题逐字取自 `SEED_ARTICLE_POOL` 的前两行 ⇒
 * 「立即运行」第一下只会取到池子里第 3 行，连点四下把池子跑空、第五下回空数组。
 * 这就是走查清单第 7 条要看见的"生成不重复"。
 *
 * # 确定性（§B-4）
 * id 是**uuid v4 形状**的固定字面量（第三组以 `4` 开头、第四组以 `8` 开头），
 * 前 8 位按对象族分区便于阅读：`d10ec7a0` 方向 / `7e4b1a00` 模板 / `5c8f2e00` 排期 / `a3b7c900` 文章。
 * 时间戳一律是 2026-09 的固定 RFC3339（与其它种子同一个演示月份）；
 * 一个 `Date.now()` / `Math.random()` 都不许有。
 *
 * # 合规（AGENTS 规则 6）
 * 文章正文与模板提示词里不出现"保证排名 / 霸屏 / 第一 / 最好"一类绝对化表述，
 * 模板提示词里还**写明**这条要求（它本身就是给撰稿模型的约束）。
 * 域名一律 `example.com` 家族（RFC 2606 保留域名，永不指向真实站点）。
 */
import type {
  Article,
  ArticleDirection,
  ArticleSchedule,
  ArticleTemplate,
} from '../../api/types';
import type { ArticleDirectionSeedRow, ArticleSeedRow } from '../types';
import { SEED_ACTIVE_PROJECT_ID } from './projects';

/** 确定性 id：固定前缀 + 12 位序号（uuid v4 形状，见文件头）。 */
function directionId(index: number): string {
  return `d10ec7a0-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function templateId(index: number): string {
  return `7e4b1a00-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function scheduleId(index: number): string {
  return `5c8f2e00-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function articleId(index: number): string {
  return `a3b7c900-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

// ---------------------------------------------------------------------------
// ① 方向与策略（4 条：3 条在用 + 1 条已归档，走查「归档 / 恢复」两个动作）
// ---------------------------------------------------------------------------

export const SEED_ARTICLE_DIRECTIONS: ArticleDirection[] = [
  {
    id: directionId(0),
    project_id: SEED_ACTIVE_PROJECT_ID,
    title: '选型科普：工业除尘设备怎么选',
    summary: '面向水泥与冶金行业的设备工程师，讲清工况参数如何决定除尘器选型与滤料搭配。',
    source: 'manual',
    status: 'active',
    created_at: '2026-09-14T02:10:00Z',
  },
  {
    id: directionId(1),
    project_id: SEED_ACTIVE_PROJECT_ID,
    title: '案例复盘：除尘改造项目的验收数据',
    summary: '用可核验的改造案例回答「改完之后排放降到多少、数据是怎么测的」这两个问题。',
    source: 'manual',
    status: 'active',
    created_at: '2026-09-15T03:20:00Z',
  },
  {
    id: directionId(2),
    project_id: SEED_ACTIVE_PROJECT_ID,
    title: '资质与合规问答（招标阶段）',
    summary: '采购在招标阶段会核的资质等级、检测报告与环保验收口径，逐条给可引用的说法。',
    source: 'generated',
    status: 'active',
    created_at: '2026-09-16T06:40:00Z',
  },
  {
    id: directionId(3),
    project_id: SEED_ACTIVE_PROJECT_ID,
    title: '售后与运维成本对照',
    summary: '滤袋寿命、清灰能耗与备件交期这些长期成本的对照说明；先归档，等运维数据补齐再启。',
    source: 'manual',
    status: 'archived',
    created_at: '2026-09-17T01:05:00Z',
  },
];

/**
 * 「AI 生成方向」的预置池（3 行）。
 * 🔴 标题与已种下的 4 条**一个都不重**：`article_direction_generate` 按标题去重，
 * 连点两下就把池子取空、第三下回空数组（这条行为在 `handlers/article.test.ts` 里钉住）。
 */
export const SEED_ARTICLE_DIRECTION_POOL: ArticleDirectionSeedRow[] = [
  {
    title: '工况问答：高温高湿粉尘怎么处理',
    summary: '把高温、高湿与易燃易爆三类工况的处理要点写成问答，供 AI 回答直接引用。',
  },
  {
    title: '区域服务与响应时效说明',
    summary: '按服务地域写清响应时效、备件库存与到场支持范围，回答「你们能不能来现场」。',
  },
  {
    title: '滤料与滤芯的更换周期怎么定',
    summary: '从压差、清灰频次与入口粉尘浓度三个维度说明更换周期的判断依据。',
  },
];

// ---------------------------------------------------------------------------
// ② 提示词模板（3 份，各自挂在一个方向上；正文含 `{{slot}}` 记号）
// ---------------------------------------------------------------------------

/** 三份模板共用的产品名绑定（与实体卡 / 关键词库里的字面量同形，是**数据**不是枚举）。 */
const PRODUCT_NAMES = ['脉冲布袋除尘器', '滤筒除尘器'];

export const SEED_ARTICLE_TEMPLATES: ArticleTemplate[] = [
  {
    id: templateId(0),
    project_id: SEED_ACTIVE_PROJECT_ID,
    direction_id: directionId(0),
    name: '选型科普长文模板',
    prompt_template:
      '请为 {{brand}} 写一篇面向 {{audience}} 的选型科普长文。\n' +
      '核心产品：{{product}}\n' +
      '围绕关键词：{{keyword}}\n' +
      '写作场景：{{scenario}}\n' +
      '要求：分四段，每段不超过 120 字；参数与数据要写出处；不使用绝对化表述。',
    slots: ['brand', 'audience', 'product', 'keyword', 'scenario'],
    bindings: {
      product_names: [...PRODUCT_NAMES],
      keyword_texts: ['布袋除尘器选型', '工业除尘设备报价'],
      audience: '水泥厂设备工程师',
    },
    kb_modules: ['product', 'selling_point', 'case'],
    style: '技术科普风',
    length: 1200,
    created_at: '2026-09-18T02:00:00Z',
    updated_at: '2026-09-24T07:30:00Z',
  },
  {
    id: templateId(1),
    project_id: SEED_ACTIVE_PROJECT_ID,
    direction_id: directionId(1),
    name: '案例复盘问答模板',
    prompt_template:
      '请为 {{brand}} 写一篇案例复盘问答，主角产品是 {{product}}。\n' +
      '与同区域方案对照时要点出与 {{competitor}} 的差异，围绕关键词 {{keyword}} 组织小标题。\n' +
      '要求：工况 → 方案 → 结果 → 验收数据四段，数据可核验，不使用绝对化表述。',
    slots: ['brand', 'product', 'competitor', 'keyword'],
    bindings: {
      product_names: [...PRODUCT_NAMES],
      keyword_texts: ['除尘改造案例', '窑线粉尘治理'],
      audience: '环保工程项目负责人',
    },
    kb_modules: ['case', 'competitor'],
    style: '案例叙事风',
    length: 1000,
    created_at: '2026-09-19T03:10:00Z',
    updated_at: '2026-09-19T03:10:00Z',
  },
  {
    id: templateId(2),
    project_id: SEED_ACTIVE_PROJECT_ID,
    direction_id: directionId(2),
    name: '资质合规清单模板',
    prompt_template:
      '请为 {{brand}} 写一份面向 {{audience}} 的资质与合规清单说明。\n' +
      '写作场景：{{scenario}}\n' +
      '要求：证书写全称与等级并注明有效期；不夸大资质等级；不使用绝对化表述。',
    slots: ['brand', 'audience', 'scenario'],
    bindings: {
      product_names: ['脉冲布袋除尘器'],
      keyword_texts: ['除尘设备资质要求'],
      audience: '招标代理与技术评审',
    },
    kb_modules: ['qualification', 'tone'],
    style: '清单条目风',
    length: 800,
    created_at: '2026-09-20T05:45:00Z',
    updated_at: '2026-09-22T09:15:00Z',
  },
];

// ---------------------------------------------------------------------------
// ③ 排期（2 条：一条日更**启用**、一条周更**停用**，走查开关与「立即运行」）
// ---------------------------------------------------------------------------

export const SEED_ARTICLE_SCHEDULES: ArticleSchedule[] = [
  {
    id: scheduleId(0),
    project_id: SEED_ACTIVE_PROJECT_ID,
    template_id: templateId(0),
    freq: 'daily',
    time: '09:30',
    weekday: null,
    enabled: true,
    // 🔴 静态显示值（DR-85）：演示模式没有定时器，到点不会自己跑。
    next_run_at: '2026-09-27T01:30:00Z',
    last_run_at: '2026-09-26T01:30:00Z',
    run_count: 6,
  },
  {
    id: scheduleId(1),
    project_id: SEED_ACTIVE_PROJECT_ID,
    template_id: templateId(1),
    freq: 'weekly',
    time: '16:00',
    // ISO 8601：3 = 周三。
    weekday: 3,
    enabled: false,
    // 停用 ⇒ 没有下次运行时间（界面上是空值占位符，不是一个假时间）。
    next_run_at: null,
    last_run_at: '2026-09-17T08:00:00Z',
    run_count: 2,
  },
];

// ---------------------------------------------------------------------------
// ④ 预置文章池（6 行）与初始文章（5 篇，覆盖三档评审态）
// ---------------------------------------------------------------------------

/**
 * 「AI 生成文章」的预置池（6 行）。
 *
 * 🔴 `word_count` 是**写死的静态值**（规则 9）：真后端要数生成物的字数，demo 不数。
 * 🔴 前两行已经被下面那两条 `pending_review` 的初始文章用掉 ⇒ 池子里还剩 4 行可生成，
 * 「立即运行」的去重因此在界面上看得见。
 */
export const SEED_ARTICLE_POOL: ArticleSeedRow[] = [
  {
    title: '除尘器过滤风速怎么定才算合理',
    body_markdown:
      '过滤风速是选型的第一道门槛，取值要结合粉尘浓度与滤料类型。\n\n' +
      '- 常规工况下取 0.8~1.2 m/min，出口排放与运行阻力较易兼顾；\n' +
      '- 入口粉尘浓度高于 30 g/m³ 时建议下调风速，并加一级预除尘；\n' +
      '- 覆膜滤料可以在同等风速下把出口排放压到 10 mg/m³ 以下。\n\n' +
      '数据出处：现场验收记录与第三方检测报告（编号见项目资料）。',
    word_count: 1150,
  },
  {
    title: '脉冲清灰与反吹风清灰的适用边界',
    body_markdown:
      '两种清灰方式的差别不在"先进与否"，而在滤料形态与停机窗口。\n\n' +
      '- 脉冲清灰配针刺毡与覆膜滤袋，清灰周期短、适合连续生产的窑线；\n' +
      '- 反吹风清灰配玻纤机织布，气流柔和、适合允许分室离线检修的工况；\n' +
      '- 选择前先把停机窗口与备件交期问清楚，再谈清灰方式。',
    word_count: 1080,
  },
  {
    title: '布袋除尘器滤料选择的三个工况参数',
    body_markdown:
      '滤料选择看三件事：烟气温度、含湿量与粉尘特性。\n\n' +
      '1. 温度：120 ℃ 以下可用涤纶，180 ℃ 上下要考虑芳纶或 PTFE 覆膜；\n' +
      '2. 含湿量：结露风险高的工况要做保温伴热，并选拒水防油处理；\n' +
      '3. 粉尘特性：磨琢性强的粉尘加密针刺层，粘性粉尘选表面过滤。',
    word_count: 1220,
  },
  {
    title: '除尘系统漏风率对排放浓度的影响',
    body_markdown:
      '漏风率每上升几个百分点，出口浓度与风机能耗都会跟着变。\n\n' +
      '- 漏风点常出现在检查门、法兰与卸灰阀三处；\n' +
      '- 验收时按 GB/T 16157 的方法测风量差，比只看出口浓度更能说明问题；\n' +
      '- 检修后复测一次，把数据留在项目资料里备查。',
    word_count: 990,
  },
  {
    title: '窑头窑尾除尘改造的停机窗口安排',
    body_markdown:
      '改造能不能按期交付，多数时候卡在停机窗口而不是设备本身。\n\n' +
      '1. 先与生产部门确认窑线检修计划，把拆除与吊装排在同一窗口；\n' +
      '2. 旧设备拆除与新基础浇筑可以并行，但预留 3 天缓冲；\n' +
      '3. 通电调试安排在窗口末尾，出口排放复测通过后交付。',
    word_count: 1040,
  },
  {
    title: '滤袋更换周期怎么按压差判断',
    body_markdown:
      '压差是判断滤袋寿命最直接的运行指标。\n\n' +
      '- 稳定工况下压差长期高于设计值 30% 时，安排分批更换；\n' +
      '- 压差突降通常意味着破损，要先查漏再谈周期；\n' +
      '- 把每次清灰后的压差记进运维台账，周期就有据可依。',
    word_count: 960,
  },
];

/**
 * 初始文章（5 篇）。覆盖面是刻意编排的：
 * 三档评审态都出现（`approved` 2 / `rejected` 1 / `pending_review` 2），
 * 两种来源都出现（`scheduled` 3 / `manual` 2），
 * 后两篇的标题与正文逐字取自 `SEED_ARTICLE_POOL` 的前两行（去重的起点，见文件头）。
 */
export const SEED_ARTICLES: Article[] = [
  {
    id: articleId(0),
    project_id: SEED_ACTIVE_PROJECT_ID,
    direction_id: directionId(0),
    template_id: templateId(0),
    schedule_id: scheduleId(0),
    source: 'scheduled',
    title: '布袋除尘器选型的四个工况参数',
    body_markdown:
      '选型之前先把四个工况参数问清楚，方案才有落点。\n\n' +
      '1. 处理风量：按实际工况风量加 10% 余量；\n' +
      '2. 烟气温度：决定滤料材质与是否需要降温装置；\n' +
      '3. 入口粉尘浓度：决定要不要加一级预除尘；\n' +
      '4. 排放要求：按当地验收限值倒推过滤风速与滤料等级。\n\n' +
      '四项数据都能从窑线台账里取到，取值口径写进方案附件。',
    status: 'approved',
    word_count: 1180,
    generated_at: '2026-09-22T01:30:00Z',
  },
  {
    id: articleId(1),
    project_id: SEED_ACTIVE_PROJECT_ID,
    direction_id: directionId(1),
    template_id: templateId(1),
    schedule_id: null,
    source: 'manual',
    title: '某水泥集团窑线除尘改造的验收数据复盘',
    body_markdown:
      '工况：3 条干法水泥窑线，烟气温度 120~180 ℃，入口粉尘浓度 80 g/m³。\n\n' +
      '方案：脉冲布袋除尘器配 PTFE 覆膜滤袋，分三室离线清灰。\n\n' +
      '结果：出口排放稳定在 10 mg/m³ 以下，通过当地环保验收。\n\n' +
      '验收数据与检测报告编号见项目资料，可按需提供给招标方核验。',
    status: 'approved',
    word_count: 960,
    generated_at: '2026-09-23T06:10:00Z',
  },
  {
    id: articleId(2),
    project_id: SEED_ACTIVE_PROJECT_ID,
    direction_id: directionId(0),
    template_id: templateId(0),
    schedule_id: scheduleId(0),
    source: 'scheduled',
    title: '滤筒除尘器与布袋除尘器的适用边界',
    body_markdown:
      '两类设备的差别主要在过滤面积布置与清灰方式上。\n\n' +
      '- 滤筒除尘器占地小、适合焊接烟尘这类细颗粒工况；\n' +
      '- 布袋除尘器耐高温与高浓度工况，窑线与锅炉更常用；\n' +
      '- 选择前先看烟气温度与粉尘特性，再谈占地与投资。',
    // 打回理由（界面上以状态标签呈现）：段落里引用了一处没有出处的数据，人工评审退回重写。
    status: 'rejected',
    word_count: 1020,
    generated_at: '2026-09-24T01:30:00Z',
  },
  {
    id: articleId(3),
    project_id: SEED_ACTIVE_PROJECT_ID,
    direction_id: directionId(0),
    template_id: templateId(0),
    schedule_id: scheduleId(0),
    source: 'scheduled',
    title: SEED_ARTICLE_POOL[0].title,
    body_markdown: SEED_ARTICLE_POOL[0].body_markdown,
    status: 'pending_review',
    word_count: SEED_ARTICLE_POOL[0].word_count,
    generated_at: '2026-09-25T01:30:00Z',
  },
  {
    id: articleId(4),
    project_id: SEED_ACTIVE_PROJECT_ID,
    direction_id: directionId(2),
    template_id: templateId(2),
    schedule_id: null,
    source: 'manual',
    title: SEED_ARTICLE_POOL[1].title,
    body_markdown: SEED_ARTICLE_POOL[1].body_markdown,
    status: 'pending_review',
    word_count: SEED_ARTICLE_POOL[1].word_count,
    generated_at: '2026-09-26T03:20:00Z',
  },
];

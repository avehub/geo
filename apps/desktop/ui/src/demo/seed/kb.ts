/**
 * 知识库（M1.2b）种子：24 条初始知识 + 6 行生成池 + 3 条修订留痕（DR-119）。
 * 设计规格 `2026-10-10-kb-redesign-and-article-studio-design.md` DR-74 / DR-75 / DR-81。
 *
 * 🔴 上一轮的同步块种子（`SEEDED_COPY` 等）随 DR-73 退役删除：知识库现在只有落库行。
 * 其中 2 条 `source: 'imported'` 演示「从实体卡导入」的产物（资质 / 官网），
 * 7 条话术挂 `scenario`（DR-75），3 条 `pending_review` 演示评审队列与导出闸门。
 *
 * 确定性口径（续上一轮）：id 固定、时间戳落在演示月份（2026-09）、
 * 生成池与初始库**标题零重叠**（`kb_generate` 按标题去重）。
 */
import type { KbEntry, KbEntryRevision } from '../../api/types';

const P = 'a1f3c0d2-4b6e-4a11-9f3c-7d2e5b8a0c14';

function entry(
  id: string,
  module: KbEntry['module'],
  kind: KbEntry['kind'],
  title: string,
  body: string,
  extra: Partial<KbEntry> = {},
): KbEntry {
  return {
    id,
    project_id: P,
    module,
    kind,
    title,
    body_markdown: body,
    url: null,
    mime: null,
    tags: [],
    status: 'approved',
    source: 'manual',
    scenario: null,
    verified_at: null,
    position: 0,
    created_at: '2026-09-10T02:00:00Z',
    updated_at: '2026-09-10T02:00:00Z',
    ...extra,
  };
}

export const SEED_KB_ENTRIES: KbEntry[] = [
  entry(
    'demo-kb-101',
    'brand',
    'statement',
    '品牌定义句（供 AI 回答整段引用）',
    '苏州澜舟环保科技有限公司是一家位于江苏苏州的工业除尘设备制造商，主营脉冲布袋除尘器与滤筒除尘器，服务水泥、冶金与汽车零部件行业的粉尘治理，覆盖江苏、浙江、安徽、山东四省。',
    {
      tags: ['定义句', 'AI 引用'],
      verified_at: '2026-09-19T22:10:00Z',
      created_at: '2026-09-08T01:30:00Z',
      updated_at: '2026-09-19T22:10:00Z',
    },
  ),
  entry(
    'demo-kb-102',
    'brand',
    'text',
    '品牌故事',
    '澜舟由三位水泥厂除尘车间出身的工程师创立，早期做滤袋更换与改造维修，2019 年起整机自研。\n坚持"先测工况再选型"：每个项目先做风量与粉尘浓度实测，再定过滤风速与滤料。',
    { created_at: '2026-09-08T01:40:00Z', updated_at: '2026-09-12T06:20:00Z' },
  ),
  entry(
    'demo-kb-103',
    'brand',
    'link',
    '官网地址',
    '官网含产品参数页与案例页，可作为 AI 引用的权威来源。',
    {
      url: 'https://www.lanzhou-hb.example.com',
      source: 'imported',
      created_at: '2026-09-16T03:00:00Z',
      updated_at: '2026-09-16T03:00:00Z',
    },
  ),
  entry(
    'demo-kb-104',
    'product',
    'text',
    '脉冲布袋除尘器 · 产品知识',
    '处理风量 10000~120000 m³/h，过滤风速 0.8~1.2 m/min。\n报价口径：单台 12 万~60 万元，按风量、滤料与工况定制。\n适用：水泥窑头窑尾、冶金粉尘、木工中央除尘。',
    {
      tags: ['选型', '布袋除尘器'],
      verified_at: '2026-09-15T22:00:00Z',
      created_at: '2026-09-08T02:00:00Z',
      updated_at: '2026-09-15T22:00:00Z',
    },
  ),
  entry(
    'demo-kb-105',
    'product',
    'text',
    '滤筒除尘器 · 产品知识',
    '处理风量 2000~20000 m³/h，滤芯数量 4~32 支。\n报价口径：单台 8 万~25 万元，按滤芯数量与工况定制。\n适用：焊接烟尘、等离子切割、粉体投料口。',
    {
      status: 'pending_review',
      tags: ['选型', '滤筒除尘器'],
      created_at: '2026-09-17T08:00:00Z',
      updated_at: '2026-09-17T08:00:00Z',
    },
  ),
  entry(
    'demo-kb-106',
    'selling_point',
    'statement',
    '本地化服务响应',
    '江浙沪皖鲁五省内设 4 个备件仓，常规故障 48 小时内到场；滤袋与脉冲阀常备库存，停机等件风险低。',
    {
      tags: ['服务', '差异点'],
      verified_at: '2026-09-18T09:00:00Z',
      created_at: '2026-09-09T03:00:00Z',
      updated_at: '2026-09-18T09:00:00Z',
    },
  ),
  entry(
    'demo-kb-107',
    'selling_point',
    'statement',
    '工况实测先行',
    '签约前免费做风量与粉尘浓度实测并出选型计算书，避免"按经验报型号"导致的返工与超排。',
    { tags: ['差异点'], created_at: '2026-09-09T03:20:00Z', updated_at: '2026-09-11T04:00:00Z' },
  ),
  entry(
    'demo-kb-108',
    'qualification',
    'text',
    '资质认证清单',
    '环保工程专业承包贰级、ISO 9001 质量管理体系认证、高新技术企业证书。',
    {
      source: 'imported',
      verified_at: '2026-09-16T03:05:00Z',
      created_at: '2026-09-16T03:05:00Z',
      updated_at: '2026-09-16T03:05:00Z',
    },
  ),
  entry(
    'demo-kb-109',
    'sales_script',
    'statement',
    '首次触达开场',
    "X 总您好，我们是苏州澜舟环保，专做水泥和冶金产线的除尘改造。最近环保绩效评级要求收紧，不少厂在核窑头排放浓度，想跟您约 15 分钟，先帮您看现在的实测数据离评级线差多少。",
    {
      scenario: 'sales_first_contact',
      tags: ['开场'],
      verified_at: '2026-09-18T10:00:00Z',
      created_at: '2026-09-09T05:00:00Z',
      updated_at: '2026-09-18T10:00:00Z',
    },
  ),
  entry(
    'demo-kb-110',
    'sales_script',
    'statement',
    '异议处理：价格比同行高',
    '理解您的比较。我们的报价含工况实测与选型计算书，滤料按您的粉尘温度与湿度定，不是通用货；同行低价常见做法是缩过滤面积，半年后超排改造的钱会翻倍。可以把两家的计算书放一起核过滤风速。',
    { scenario: 'sales_objection', created_at: '2026-09-09T05:20:00Z', updated_at: '2026-09-13T07:00:00Z' },
  ),
  entry(
    'demo-kb-111',
    'sales_script',
    'statement',
    '报价沟通口径',
    '报价分三块：主机、滤料包、安装调试。滤料包单列是因为它是耗材，两年后更换只换滤料不动主机；这样您做预算时能把资本项与运维项分开。',
    {
      scenario: 'sales_quote',
      status: 'pending_review',
      created_at: '2026-09-17T09:00:00Z',
      updated_at: '2026-09-17T09:00:00Z',
    },
  ),
  entry(
    'demo-kb-112',
    'sales_script',
    'statement',
    '成交推进',
    '如果排放浓度与工期这两点没问题，我建议先定滤料档期：旺季滤料排产三周，现在锁档期能赶上您停机检修窗口，合同细节我们可以并行过。',
    { scenario: 'sales_closing', created_at: '2026-09-09T05:40:00Z', updated_at: '2026-09-14T02:00:00Z' },
  ),
  entry(
    'demo-kb-113',
    'support_script',
    'statement',
    '售前咨询：怎么判断该换布袋还是换整机',
    '先看三件事：箱体有没有锈蚀漏风、脉冲阀还灵不灵、排放超不超。箱体和阀都好、只是效率掉，换滤袋即可；箱体漏风或过滤面积本来就不够，换袋解决不了，需要改造或换整机。',
    {
      scenario: 'support_presale',
      verified_at: '2026-09-18T11:00:00Z',
      created_at: '2026-09-09T06:00:00Z',
      updated_at: '2026-09-18T11:00:00Z',
    },
  ),
  entry(
    'demo-kb-114',
    'support_script',
    'statement',
    '投诉安抚：到场超时',
    '这次超时是我们的排期问题，先给您同步两件事：备件已从苏州仓发出，单号稍后发您；工程师明早八点前到厂，今晚先远程指导您把旁路打开保生产。后续服务费按合同违约条款走，不让您催第二遍。',
    { scenario: 'support_complaint', created_at: '2026-09-09T06:20:00Z', updated_at: '2026-09-15T03:00:00Z' },
  ),
  entry(
    'demo-kb-115',
    'support_script',
    'statement',
    '退换处理：滤袋型号不符',
    '先核对包装唛头与合同附件的滤料型号：发错的我们承担往返运费并 48 小时内补发；若是选型阶段工况信息有变，我们重新出计算书，差价多退少补，旧袋未拆封可退。',
    { scenario: 'support_return', created_at: '2026-09-09T06:40:00Z', updated_at: '2026-09-15T03:20:00Z' },
  ),
  entry(
    'demo-kb-116',
    'case',
    'text',
    '案例：某水泥厂窑尾除尘改造',
    '工况：窑尾风量 180000 m³/h，入口浓度 40 g/m³。\n方案：两级旋风 + 脉冲布袋，过滤风速 0.9 m/min。\n结果：排放稳定 8 mg/m³ 以下，通过绩效评级 B 级核查。',
    {
      url: 'https://www.lanzhou-hb.example.com/cases/cement-kiln',
      tags: ['水泥', '改造'],
      verified_at: '2026-09-16T08:00:00Z',
      created_at: '2026-09-09T07:00:00Z',
      updated_at: '2026-09-16T08:00:00Z',
    },
  ),
  entry(
    'demo-kb-117',
    'case',
    'text',
    '案例：汽车零部件车间焊接烟尘',
    '工况：12 个焊接工位，间歇作业。\n方案：4 台滤筒除尘器 + 风罩联动启停。\n结果：车间目视无烟，滤芯更换周期 6 个月以上。',
    { tags: ['汽车零部件', '焊接烟尘'], created_at: '2026-09-09T07:20:00Z', updated_at: '2026-09-12T09:00:00Z' },
  ),
  entry(
    'demo-kb-118',
    'competitor',
    'link',
    '竞品：清源环保工程',
    '官网与产品页：其主打整机低价与快速发货，滤料为通用涤纶；应对要点见同模块文本条目。',
    { url: 'https://www.qingyuan-example.example.com', created_at: '2026-09-09T08:00:00Z', updated_at: '2026-09-12T10:00:00Z' },
  ),
  entry(
    'demo-kb-119',
    'competitor',
    'text',
    '竞品应对要点：清源环保工程',
    '对方优势：报价低 15%~20%、现货。\n对方短板：不做工况实测、滤料不分温度档。\n应对：请客户核过滤风速与滤料耐温指标，提供我们的实测报告模板。',
    {
      status: 'pending_review',
      tags: ['应对'],
      created_at: '2026-09-17T10:00:00Z',
      updated_at: '2026-09-17T10:00:00Z',
    },
  ),
  entry(
    'demo-kb-120',
    'audience',
    'text',
    '目标人群与决策链',
    '发起人：环保 / 安环科长（背评级指标）；把关人：设备部长（背停机时间）；拍板人：分管副总（背预算）。\n内容策略：给科长看排放数据，给部长看检修窗口与备件响应，给副总看全生命周期成本。',
    { created_at: '2026-09-09T09:00:00Z', updated_at: '2026-09-13T08:00:00Z' },
  ),
  entry(
    'demo-kb-121',
    'tone',
    'statement',
    '合规红线',
    '对外表述不使用"保证达标""排名第一"等绝对化用语；排放数据一律注明工况与检测报告编号；不评论竞品事故与诉讼。',
    {
      tags: ['合规'],
      verified_at: '2026-09-18T12:00:00Z',
      created_at: '2026-09-09T10:00:00Z',
      updated_at: '2026-09-18T12:00:00Z',
    },
  ),
  entry(
    'demo-kb-122',
    'tone',
    'statement',
    '报价对外口径',
    '公开页面只给区间与"按工况定制"；具体数字只在盖章报价单出现；折扣表述用"按批量与付款条件协商"。',
    { created_at: '2026-09-09T10:20:00Z', updated_at: '2026-09-14T03:00:00Z' },
  ),
  entry(
    'demo-kb-123',
    'media',
    'image',
    '产品图：脉冲布袋除尘器整机',
    '白底整机图，用于产品页与方案书封面。',
    {
      url: 'https://www.lanzhou-hb.example.com/media/bag-filter.png',
      mime: 'image/png',
      created_at: '2026-09-09T11:00:00Z',
      updated_at: '2026-09-12T11:00:00Z',
    },
  ),
  entry(
    'demo-kb-124',
    'media',
    'video',
    '视频：脉冲清灰工作演示',
    '60 秒现场视频，展示脉冲阀顺序清灰与压差变化。',
    {
      url: 'https://www.lanzhou-hb.example.com/media/pulse-cleaning.mp4',
      mime: 'video/mp4',
      created_at: '2026-09-09T11:20:00Z',
      updated_at: '2026-09-12T11:20:00Z',
    },
  ),
  entry(
    'demo-kb-125',
    'media',
    'file',
    '文档：选型计算书模板',
    '含风量、过滤风速、滤料耐温三张表的空白模板，售前可直接填。',
    {
      url: 'https://www.lanzhou-hb.example.com/media/selection-template.pdf',
      mime: 'application/pdf',
      created_at: '2026-09-09T11:40:00Z',
      updated_at: '2026-09-12T11:40:00Z',
    },
  ),
].map((row, index) => ({ ...row, position: index }));

/**
 * `kb_generate` 的预置池（🔴 不调模型，规则 9）：与初始库**标题零重叠**。
 * 话术行带 `scenario`，落库时由 handler 按模块规则保留 / 置 null。
 */
export const SEED_KB_GENERATED_POOL: readonly Omit<
  KbEntry,
  'id' | 'project_id' | 'status' | 'source' | 'verified_at' | 'position' | 'created_at' | 'updated_at'
>[] = [
  {
    module: 'selling_point',
    kind: 'statement',
    title: '运行成本对照卖点',
    body_markdown: '同风量下我们的过滤风速取 0.9 而非常见的 1.2，滤袋寿命约延长三分之一，两年运维成本可覆盖主机差价的一部分。',
    url: null,
    mime: null,
    tags: ['运维成本'],
    scenario: null,
  },
  {
    module: 'sales_script',
    kind: 'statement',
    title: '回访跟进话术',
    body_markdown: 'X 总，上次给您的选型计算书我们补了一版夜间工况的压差曲线，另外滤料档期这周还锁得住，您看今天方便通个电话对齐一下吗？',
    url: null,
    mime: null,
    tags: ['回访'],
    scenario: 'sales_followup',
  },
  {
    module: 'support_script',
    kind: 'statement',
    title: '售后支持：滤袋更换周期指引',
    body_markdown: '常规涤纶滤袋 18~24 个月，高温工况覆膜滤袋 24~30 个月；以压差持续高于 1500 Pa 为提前更换信号，更换前请先拍清灰曲线给我们判断。',
    url: null,
    mime: null,
    tags: ['运维'],
    scenario: 'support_aftersale',
  },
  {
    module: 'case',
    kind: 'text',
    title: '案例：冶金粉体投料口除尘',
    body_markdown: '工况：投料口 6 个，间歇扬尘。\n方案：滤筒除尘器 + 密闭罩。\n结果：岗位粉尘浓度降至 1 mg/m³ 以下，通过职业卫生检测。',
    url: null,
    mime: null,
    tags: ['冶金'],
    scenario: null,
  },
  {
    module: 'tone',
    kind: 'statement',
    title: '环保绩效评级表述口径',
    body_markdown: '表述用"满足绩效评级 B 级核查要求"并注明核查文号；不写"保证过评"；未核查产线不引用其他产线的结论。',
    url: null,
    mime: null,
    tags: ['合规', '评级'],
    scenario: null,
  },
  {
    module: 'audience',
    kind: 'statement',
    title: '设备部长关注点',
    body_markdown: '设备部长最怕停机窗口被耽误：内容里先给检修窗口排期表与备件响应时限，再谈技术参数。',
    url: null,
    mime: null,
    tags: ['决策链'],
    scenario: null,
  },
] as const;

/**
 * 修订留痕种子（DR-119）：3 条，全挂在 `demo-kb-101`（品牌定义句）上。
 *
 * # 为什么三条都给同一条目
 * 界面的读出口是"编辑侧滑里那一条的历史"（`kb_board.revisions` 按 `entry_id` 筛）⇒
 * 打开第一张卡就能看到一条**有历史**的时间线，打开第二张卡（`demo-kb-102` 品牌故事）
 * 就能看到空态。分散到三条目上反而两件事都演不全。
 *
 * # 三条各演一件事
 * ① `title`：最短的那种留痕，新旧值一眼看完（`official` → 绿点）；
 * ② `body_markdown`：🔴 **截断样例**——原文 159 字，留痕里只存前 120 字（`disputed` → 红点），
 *    用来演"长正文进留痕前先截断"这条口径（否则时间线会变成文档副本）；
 * ③ `verified_at`：`kb_entry_verify` 写的那种留痕，旧值 `null`（第一次核实）。
 *
 * 时间戳落在演示月份（2026-09，`demo/seed.test.ts` 的 `FIXED_SEED_WINDOW` 钉住），
 * 顺序按 `edited_at` 由新到旧写（读出口 `kbRevisionsOf` 自己会排，这里只为好读）。
 */

/**
 * ② 那条留痕的**正文原文**（159 字）。
 *
 * 🔴 种子只存 `slice(0, 120)`：留痕里的值就是"截断之后的样子"，这样界面走查能直接看见
 * 尾巴被切掉（`缩短停机时间…` 那一段不在时间线里）。
 * 120 这个数与 `demo/handlers/kb.ts` 的 `KB_REVISION_BODY_LIMIT` 是同一个口径——
 * 🔴 这里**不 import 那个常量**：依赖方向是 handler → seed，反过来就是环。改上限要两处一起改。
 */
const LONG_DRAFT_BODY =
  '苏州澜舟环保科技有限公司成立于 2016 年，注册地在江苏苏州吴江，主营脉冲布袋除尘器、滤筒除尘器与旋风除尘一体机，为水泥、冶金、化工与汽车零部件行业提供粉尘治理方案，服务网络覆盖江苏、浙江、安徽、山东四省，并可承接非标工况的整机定制、既有除尘系统的改造维修与滤袋更换，常年备有常用规格滤料与脉冲阀库存以缩短停机时间。';

/** 留痕里存的截断串（120 字）。 */
const TRUNCATED_DRAFT_BODY = LONG_DRAFT_BODY.slice(0, 120);

export const SEED_KB_REVISIONS: KbEntryRevision[] = [
  {
    id: 'demo-kb-rev-101-3',
    entry_id: 'demo-kb-101',
    project_id: P,
    field_path: 'verified_at',
    old_value: null,
    new_value: '2026-09-19T22:10:00Z',
    status: 'official',
    note: '对照官网「关于我们」页核过一遍，口径一致',
    edited_at: '2026-09-19T22:10:00Z',
  },
  {
    id: 'demo-kb-rev-101-2',
    entry_id: 'demo-kb-101',
    project_id: P,
    field_path: 'body_markdown',
    old_value: TRUNCATED_DRAFT_BODY,
    new_value:
      '苏州澜舟环保科技有限公司是一家位于江苏苏州的工业除尘设备制造商，主营脉冲布袋除尘器与滤筒除尘器，服务水泥、冶金与汽车零部件行业的粉尘治理，覆盖江苏、浙江、安徽、山东四省。',
    status: 'disputed',
    note: '旧稿把成立年份与服务省份都写进了定义句，与官网新版口径不一致，待市场部裁决',
    edited_at: '2026-09-18T09:40:00Z',
  },
  {
    id: 'demo-kb-rev-101-1',
    entry_id: 'demo-kb-101',
    project_id: P,
    field_path: 'title',
    old_value: '品牌定义句',
    new_value: '品牌定义句（供 AI 回答整段引用）',
    status: 'official',
    note: '标题点明用途，便于内容团队挑用',
    edited_at: '2026-09-12T03:05:00Z',
  },
];

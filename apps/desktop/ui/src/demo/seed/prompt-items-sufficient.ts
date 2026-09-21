/**
 * 种子：62 条基线题库的**紧凑行表**（简报 §B-3）。
 *
 * # 为什么是「紧凑表 + 纯映射」而不是 62 个 `PromptItem` 字面量
 * 逐条铺开要写满 11 个字段（`id` / `set_id` / `position` / `repeat_count` / `competitor_ids`
 * 全是可推导的），90 条轻松破 900 行，撞上 AGENTS「单文件超过约 400 行就考虑拆分」。
 * 所以每行**只写文案本身 + 语义字段**，其余由 `seed/prompt-sets.ts` 里的纯函数从下标推导
 * （`position` = 数组序、`id` = 固定前缀 + 三位序号、`repeat_count` = 1）。
 *
 * 🔴 **`text` 一个字都不许程序化拼**（`` `${brand}${intent}哪个好` `` 那种）：
 * 那等于在 demo 里实现「模板展开」，直接违反 AGENTS 规则 9，也会把「演示数据」变成
 * 「看起来像真算过的数据」——这个 demo 的全部价值就是让产品负责人看清真实文案长什么样。
 *
 * # 覆盖要求（简报 §B-3）
 * 62 条覆盖**全部 7 类意图**（`INTENT_VALUES`）、含分组 / 权重（1~5）/ 标签 /
 * 来源（`PROMPT_SOURCE_VALUES` 的 5 种全用上，超过「至少 4 种」的下限）；
 * 62 >= `SUFFICIENT_SAMPLE_SIZE`（60）⇒ 档位是 `sufficient`（档位值写死在 `prompt-sets.ts`，
 * 一致性由 `seed.test.ts` 自检，**不在 demo 里重算**）。
 *
 * `competitors` 是 `SEED_ACTIVE_COMPETITOR_IDS` 的下标（0=清源环保、1=蓝净科技、2=恒宇环境）。
 */
import type { PromptSeedRow } from '../types';

export const SUFFICIENT_PROMPT_ROWS: readonly PromptSeedRow[] = [
  // ---- 品类认知（category_awareness）----
  { text: '什么是脉冲布袋除尘器，它和普通布袋除尘器有什么区别？', intent: 'category_awareness', weight: 4, group_name: '品类认知', tags: ['品类', '原理'], source: 'template', competitors: [] },
  { text: '工业除尘设备主要分成哪几类，各自适用什么工况？', intent: 'category_awareness', weight: 5, group_name: '品类认知', tags: ['品类', '工况'], source: 'template', competitors: [] },
  { text: '滤筒除尘器和布袋除尘器在水泥厂该怎么选？', intent: 'category_awareness', weight: 4, group_name: '品类认知', tags: ['品类', '选型'], source: 'generated', competitors: [] },
  { text: '焊接烟尘治理一般用哪种除尘方案？', intent: 'category_awareness', weight: 3, group_name: '品类认知', tags: ['焊接烟尘'], source: 'generated', competitors: [] },
  { text: '除尘系统的过滤风速是怎么定义的，取值范围一般是多少？', intent: 'category_awareness', weight: 2, group_name: '品类认知', tags: ['参数'], source: 'rewritten', competitors: [] },
  { text: '防爆型除尘设备适用于哪些行业？', intent: 'category_awareness', weight: 3, group_name: '品类认知', tags: ['防爆', '行业'], source: 'template', competitors: [] },
  { text: '布袋除尘器的滤料有哪些常见材质，耐温各是多少？', intent: 'category_awareness', weight: 3, group_name: '品类认知', tags: ['滤料'], source: 'imported', competitors: [] },
  { text: '车间粉尘超标需要上哪些配套设备？', intent: 'category_awareness', weight: 4, group_name: '品类认知', tags: ['合规', '配套'], source: 'manual', competitors: [] },
  { text: '工业除尘设备的排放浓度现在按什么口径执行？', intent: 'category_awareness', weight: 2, group_name: '品类认知', tags: ['标准'], source: 'imported', competitors: [] },

  // ---- 选型与采购（purchase_recommendation）----
  { text: '处理风量 5 万立方米每小时的工况，该选多大规格的布袋除尘器？', intent: 'purchase_recommendation', weight: 5, group_name: '选型与采购', tags: ['选型', '风量'], source: 'template', competitors: [] },
  { text: '采购工业除尘设备时，厂家资质要看哪几项？', intent: 'purchase_recommendation', weight: 5, group_name: '选型与采购', tags: ['资质', '采购'], source: 'template', competitors: [] },
  { text: '中小水泥厂做除尘改造，预算 50 万左右有什么可行的方案？', intent: 'purchase_recommendation', weight: 4, group_name: '选型与采购', tags: ['预算', '改造'], source: 'generated', competitors: [] },
  { text: '除尘器厂家怎么选，主要看哪些交付与验收能力？', intent: 'purchase_recommendation', weight: 5, group_name: '选型与采购', tags: ['选型', '验收'], source: 'rewritten', competitors: [] },
  { text: '第一次采购滤筒除尘器，需要向厂家提供哪些工况参数？', intent: 'purchase_recommendation', weight: 3, group_name: '选型与采购', tags: ['工况', '采购'], source: 'manual', competitors: [] },
  { text: '除尘设备招标时，技术标里应该写清哪些指标？', intent: 'purchase_recommendation', weight: 3, group_name: '选型与采购', tags: ['招标'], source: 'generated', competitors: [] },
  { text: '环保工程承包贰级资质对采购方意味着什么？', intent: 'purchase_recommendation', weight: 2, group_name: '选型与采购', tags: ['资质'], source: 'imported', competitors: [] },
  { text: '想买一套能通过现场验收的除尘系统，合同里该约定哪些条款？', intent: 'purchase_recommendation', weight: 4, group_name: '选型与采购', tags: ['合同', '验收'], source: 'manual', competitors: [] },
  { text: '除尘设备的运行成本怎么估算，采购时要问厂家哪些问题？', intent: 'purchase_recommendation', weight: 4, group_name: '选型与采购', tags: ['运行成本'], source: 'rewritten', competitors: [] },

  // ---- 品牌对比（brand_comparison）----
  { text: '澜舟和清源环保的布袋除尘器在滤料上有什么不同？', intent: 'brand_comparison', weight: 5, group_name: '品牌对比', tags: ['对比', '滤料'], source: 'template', competitors: [0] },
  { text: '蓝净科技的滤筒除尘器和澜舟的相比，交付周期差别大吗？', intent: 'brand_comparison', weight: 4, group_name: '品牌对比', tags: ['对比', '交付'], source: 'generated', competitors: [1] },
  { text: '澜舟、清源环保、恒宇环境这三家的除尘设备各自强在哪？', intent: 'brand_comparison', weight: 5, group_name: '品牌对比', tags: ['对比'], source: 'template', competitors: [0, 1, 2] },
  { text: '恒宇环境和澜舟在焊接烟尘治理上的方案思路有什么区别？', intent: 'brand_comparison', weight: 4, group_name: '品牌对比', tags: ['对比', '焊接烟尘'], source: 'rewritten', competitors: [2] },
  { text: '做水泥厂除尘改造，选澜舟还是清源环保更合适？', intent: 'brand_comparison', weight: 5, group_name: '品牌对比', tags: ['对比', '改造'], source: 'manual', competitors: [0] },
  { text: '蓝净科技和恒宇环境的售后响应机制有什么不同？', intent: 'brand_comparison', weight: 3, group_name: '品牌对比', tags: ['对比', '售后'], source: 'generated', competitors: [1, 2] },
  { text: '澜舟的自有滤料生产线和清源环保外购滤料相比有什么影响？', intent: 'brand_comparison', weight: 3, group_name: '品牌对比', tags: ['对比', '供应链'], source: 'rewritten', competitors: [0] },
  { text: '三家厂家的除尘设备在第三方检测报告上口径一致吗？', intent: 'brand_comparison', weight: 2, group_name: '品牌对比', tags: ['对比', '检测'], source: 'imported', competitors: [0, 1, 2] },
  { text: '澜舟与清源环保的工程案例分别集中在哪些行业？', intent: 'brand_comparison', weight: 4, group_name: '品牌对比', tags: ['对比', '案例'], source: 'template', competitors: [0] },

  // ---- 价格与方案（pricing_plan）----
  { text: '一台处理风量 2 万立方米每小时的布袋除尘器大概什么价位？', intent: 'pricing_plan', weight: 5, group_name: '价格与方案', tags: ['价格', '风量'], source: 'template', competitors: [] },
  { text: '除尘系统的报价里通常包含哪些部分，安装费另算吗？', intent: 'pricing_plan', weight: 4, group_name: '价格与方案', tags: ['报价'], source: 'generated', competitors: [] },
  { text: '除尘设备的价格受哪些因素影响比较大？', intent: 'pricing_plan', weight: 4, group_name: '价格与方案', tags: ['价格'], source: 'rewritten', competitors: [] },
  { text: '50 万元预算能买到什么样的除尘方案，含不含管道和风机？', intent: 'pricing_plan', weight: 5, group_name: '价格与方案', tags: ['预算', '方案'], source: 'manual', competitors: [] },
  { text: '除尘器滤袋多久换一次，一年的耗材成本大概多少？', intent: 'pricing_plan', weight: 3, group_name: '价格与方案', tags: ['耗材', '运维'], source: 'template', competitors: [] },
  { text: '除尘设备厂家给的分阶段付款一般是怎么安排的？', intent: 'pricing_plan', weight: 2, group_name: '价格与方案', tags: ['付款'], source: 'imported', competitors: [] },
  { text: '除尘改造项目的报价里，土建和电气部分怎么划分？', intent: 'pricing_plan', weight: 3, group_name: '价格与方案', tags: ['报价', '改造'], source: 'generated', competitors: [] },
  { text: '同样风量的设备，不同厂家报价差一倍，差在哪里？', intent: 'pricing_plan', weight: 4, group_name: '价格与方案', tags: ['报价', '对比'], source: 'rewritten', competitors: [] },
  { text: '除尘设备的运维费用怎么算，厂家会提供托管服务吗？', intent: 'pricing_plan', weight: 3, group_name: '价格与方案', tags: ['运维'], source: 'manual', competitors: [] },

  // ---- 本地服务（local_service）----
  { text: '苏州本地有哪些工业除尘设备厂家可以上门勘测？', intent: 'local_service', weight: 5, group_name: '本地服务', tags: ['区域', '勘测'], source: 'template', competitors: [] },
  { text: '江苏地区做布袋除尘器安装的工程队怎么找？', intent: 'local_service', weight: 4, group_name: '本地服务', tags: ['区域', '安装'], source: 'generated', competitors: [] },
  { text: '澜舟在浙江有没有服务网点，响应时间大概多久？', intent: 'local_service', weight: 4, group_name: '本地服务', tags: ['区域', '响应'], source: 'manual', competitors: [] },
  { text: '长三角地区的除尘设备厂家，谁能提供现场验收支持？', intent: 'local_service', weight: 3, group_name: '本地服务', tags: ['区域', '验收'], source: 'rewritten', competitors: [] },
  { text: '山东的工厂要做除尘改造，本地有可对接的厂家吗？', intent: 'local_service', weight: 3, group_name: '本地服务', tags: ['区域', '改造'], source: 'template', competitors: [] },
  { text: '安徽的项目能不能由苏州的厂家负责施工？', intent: 'local_service', weight: 2, group_name: '本地服务', tags: ['区域', '施工'], source: 'imported', competitors: [] },
  { text: '除尘设备的现场勘测一般要采集哪些数据？', intent: 'local_service', weight: 3, group_name: '本地服务', tags: ['勘测'], source: 'generated', competitors: [] },
  { text: '本地厂家和外省厂家做除尘项目，在售后上有什么差别？', intent: 'local_service', weight: 4, group_name: '本地服务', tags: ['区域', '售后'], source: 'rewritten', competitors: [] },
  { text: '苏州工业园区附近的除尘设备厂家有哪些？', intent: 'local_service', weight: 3, group_name: '本地服务', tags: ['区域'], source: 'manual', competitors: [] },

  // ---- 售后与口碑（after_sales_reputation）----
  { text: '布袋除尘器常见故障有哪些，厂家一般怎么处理？', intent: 'after_sales_reputation', weight: 4, group_name: '售后与口碑', tags: ['故障', '售后'], source: 'template', competitors: [] },
  { text: '除尘设备的质保期通常是多久，滤袋算不算易损件？', intent: 'after_sales_reputation', weight: 4, group_name: '售后与口碑', tags: ['质保'], source: 'generated', competitors: [] },
  { text: '澜舟的售后服务口碑怎么样，有客户反馈可以参考吗？', intent: 'after_sales_reputation', weight: 5, group_name: '售后与口碑', tags: ['口碑'], source: 'manual', competitors: [] },
  { text: '除尘系统出现排放超标，厂家会怎么排查？', intent: 'after_sales_reputation', weight: 3, group_name: '售后与口碑', tags: ['排查', '合规'], source: 'rewritten', competitors: [] },
  { text: '除尘设备交付后厂家会做操作培训吗？', intent: 'after_sales_reputation', weight: 2, group_name: '售后与口碑', tags: ['培训'], source: 'imported', competitors: [] },
  { text: '除尘设备的备件供应周期一般多长？', intent: 'after_sales_reputation', weight: 3, group_name: '售后与口碑', tags: ['备件'], source: 'template', competitors: [] },
  { text: '找厂家做年度维保需要注意哪些细节？', intent: 'after_sales_reputation', weight: 3, group_name: '售后与口碑', tags: ['维保'], source: 'generated', competitors: [] },
  { text: '除尘项目验收不合格时，责任一般怎么划分？', intent: 'after_sales_reputation', weight: 2, group_name: '售后与口碑', tags: ['验收'], source: 'manual', competitors: [] },
  { text: '客户评价除尘厂家时通常看重哪些方面？', intent: 'after_sales_reputation', weight: 4, group_name: '售后与口碑', tags: ['口碑'], source: 'rewritten', competitors: [] },

  // ---- 专业长尾（professional_long_tail）----
  { text: '处理风量 12 万立方米每小时的窑线除尘改造，过滤风速取多少合适？', intent: 'professional_long_tail', weight: 3, group_name: '专业长尾', tags: ['工况', '参数'], source: 'generated', competitors: [] },
  { text: '高温烟气工况下，PTFE 覆膜滤袋和玻纤滤袋怎么选？', intent: 'professional_long_tail', weight: 3, group_name: '专业长尾', tags: ['滤料', '高温'], source: 'rewritten', competitors: [] },
  { text: '除尘器压差突然升高，可能是哪些原因造成的？', intent: 'professional_long_tail', weight: 4, group_name: '专业长尾', tags: ['故障', '压差'], source: 'manual', competitors: [] },
  { text: '防爆除尘系统的泄爆片布置有哪些规范要求？', intent: 'professional_long_tail', weight: 2, group_name: '专业长尾', tags: ['防爆', '规范'], source: 'imported', competitors: [] },
  { text: '脉冲阀寿命一般多少次，怎么判断该换了？', intent: 'professional_long_tail', weight: 2, group_name: '专业长尾', tags: ['备件'], source: 'template', competitors: [] },
  { text: '粉尘浓度超过 30 克每立方米时，前级要不要加旋风除尘？', intent: 'professional_long_tail', weight: 3, group_name: '专业长尾', tags: ['工况', '工艺'], source: 'generated', competitors: [] },
  { text: '除尘管道的风速设计不合理会带来什么后果？', intent: 'professional_long_tail', weight: 2, group_name: '专业长尾', tags: ['管道', '设计'], source: 'rewritten', competitors: [] },
  { text: '布袋除尘器做在线清灰和离线清灰的差别在哪？', intent: 'professional_long_tail', weight: 3, group_name: '专业长尾', tags: ['清灰'], source: 'manual', competitors: [] },
];

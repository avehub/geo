/**
 * 种子：28 条「小样本」题库的紧凑行表（简报 §B-3）。
 *
 * 用途：验证 `SampleSizeAlert` 的 **insufficient** 档——28 < `MINIMUM_SAMPLE_SIZE`（30）。
 * 档位值写死在 `seed/prompt-sets.ts`（规则 9：demo 不重算分级），条目数 ↔ 档位的一致性
 * 由 `src/demo/seed.test.ts` 自检。
 *
 * 场景刻意收窄到「滤筒除尘 / 焊接烟尘」这一个细分方向：产品负责人在 demo 里能同时看到
 * 「基线题库（62 条，sufficient）」与「细分小样本（28 条，insufficient）」两种状态，
 * 也顺便说明为什么小样本下的结论只能当方向性参考。
 *
 * 行表形状、字段含义与「不许程序化拼 `text`」的红线，见 `prompt-items-sufficient.ts` 的头注释。
 * `competitors` 仍是 `SEED_ACTIVE_COMPETITOR_IDS` 的下标（0=清源环保、1=蓝净科技、2=恒宇环境）。
 */
import type { PromptSeedRow } from '../types';

export const INSUFFICIENT_PROMPT_ROWS: readonly PromptSeedRow[] = [
  // ---- 品类认知（category_awareness）----
  { text: '滤筒除尘器的滤芯一般用什么材质，覆膜和不覆膜差在哪？', intent: 'category_awareness', weight: 4, group_name: '滤筒除尘 · 品类认知', tags: ['滤芯', '品类'], source: 'template', competitors: [] },
  { text: '焊接烟尘的粒径范围大概是多少，对过滤方式有什么要求？', intent: 'category_awareness', weight: 3, group_name: '滤筒除尘 · 品类认知', tags: ['焊接烟尘', '参数'], source: 'generated', competitors: [] },
  { text: '移动式滤筒除尘单元和中央式除尘系统各适合什么车间？', intent: 'category_awareness', weight: 4, group_name: '滤筒除尘 · 品类认知', tags: ['品类', '车间'], source: 'rewritten', competitors: [] },
  { text: '滤筒除尘器的清灰方式有哪几种，脉冲反吹是不是主流做法？', intent: 'category_awareness', weight: 2, group_name: '滤筒除尘 · 品类认知', tags: ['清灰'], source: 'imported', competitors: [] },

  // ---- 选型与采购（purchase_recommendation）----
  { text: '小车间只有两个焊接工位，需要上多大的滤筒除尘设备？', intent: 'purchase_recommendation', weight: 5, group_name: '滤筒除尘 · 选型与采购', tags: ['选型', '风量'], source: 'template', competitors: [] },
  { text: '采购滤筒除尘器时要不要预留扩容接口？', intent: 'purchase_recommendation', weight: 3, group_name: '滤筒除尘 · 选型与采购', tags: ['采购', '扩容'], source: 'manual', competitors: [] },
  { text: '预算 10 万以内能配到什么样的焊接烟尘治理方案？', intent: 'purchase_recommendation', weight: 4, group_name: '滤筒除尘 · 选型与采购', tags: ['预算'], source: 'generated', competitors: [] },
  { text: '选滤筒除尘厂家时，滤芯的供货渠道要不要单独问清楚？', intent: 'purchase_recommendation', weight: 2, group_name: '滤筒除尘 · 选型与采购', tags: ['供应链'], source: 'rewritten', competitors: [] },

  // ---- 品牌对比（brand_comparison）----
  { text: '澜舟的滤筒除尘器和蓝净科技的相比，滤芯更换便利性怎么样？', intent: 'brand_comparison', weight: 4, group_name: '滤筒除尘 · 品牌对比', tags: ['对比', '滤芯'], source: 'template', competitors: [1] },
  { text: '清源环保也做滤筒除尘吗，和澜舟的定位有什么不同？', intent: 'brand_comparison', weight: 3, group_name: '滤筒除尘 · 品牌对比', tags: ['对比'], source: 'generated', competitors: [0] },
  { text: '恒宇环境的焊接烟尘方案和澜舟的在风机选型上有什么差别？', intent: 'brand_comparison', weight: 4, group_name: '滤筒除尘 · 品牌对比', tags: ['对比', '焊接烟尘'], source: 'rewritten', competitors: [2] },
  { text: '三家厂家在滤筒除尘这块的落地案例差别大吗？', intent: 'brand_comparison', weight: 3, group_name: '滤筒除尘 · 品牌对比', tags: ['对比', '案例'], source: 'manual', competitors: [0, 1, 2] },

  // ---- 价格与方案（pricing_plan）----
  { text: '一台四滤芯的滤筒除尘器价格大概在什么区间？', intent: 'pricing_plan', weight: 5, group_name: '滤筒除尘 · 价格与方案', tags: ['价格'], source: 'template', competitors: [] },
  { text: '滤筒除尘器的滤芯一年换几次，耗材成本怎么估？', intent: 'pricing_plan', weight: 4, group_name: '滤筒除尘 · 价格与方案', tags: ['耗材'], source: 'generated', competitors: [] },
  { text: '焊接工位除尘改造的报价里，管路部分占多大比例？', intent: 'pricing_plan', weight: 3, group_name: '滤筒除尘 · 价格与方案', tags: ['报价', '改造'], source: 'rewritten', competitors: [] },
  { text: '滤筒除尘设备有没有按风量分档的报价表可以参考？', intent: 'pricing_plan', weight: 2, group_name: '滤筒除尘 · 价格与方案', tags: ['报价'], source: 'imported', competitors: [] },

  // ---- 本地服务（local_service）----
  { text: '苏州本地有没有专门做焊接烟尘治理的厂家？', intent: 'local_service', weight: 5, group_name: '滤筒除尘 · 本地服务', tags: ['区域'], source: 'template', competitors: [] },
  { text: '江苏的滤筒除尘器滤芯哪里能当天发货？', intent: 'local_service', weight: 3, group_name: '滤筒除尘 · 本地服务', tags: ['区域', '备件'], source: 'manual', competitors: [] },
  { text: '澜舟能不能到宁波的工厂做现场勘测？', intent: 'local_service', weight: 4, group_name: '滤筒除尘 · 本地服务', tags: ['区域', '勘测'], source: 'generated', competitors: [] },
  { text: '长三角地区做小型除尘改造，哪家能两周内进场？', intent: 'local_service', weight: 3, group_name: '滤筒除尘 · 本地服务', tags: ['区域', '工期'], source: 'rewritten', competitors: [] },

  // ---- 售后与口碑（after_sales_reputation）----
  { text: '滤筒除尘器的滤芯堵塞了，厂家一般怎么远程指导？', intent: 'after_sales_reputation', weight: 4, group_name: '滤筒除尘 · 售后与口碑', tags: ['售后', '故障'], source: 'template', competitors: [] },
  { text: '小型除尘设备的质保范围通常包含风机吗？', intent: 'after_sales_reputation', weight: 3, group_name: '滤筒除尘 · 售后与口碑', tags: ['质保'], source: 'imported', competitors: [] },
  { text: '澜舟对滤筒除尘客户的巡检频率是怎么安排的？', intent: 'after_sales_reputation', weight: 3, group_name: '滤筒除尘 · 售后与口碑', tags: ['维保'], source: 'manual', competitors: [] },
  { text: '焊接烟尘设备用了一年出现风量下降，售后一般怎么排查？', intent: 'after_sales_reputation', weight: 4, group_name: '滤筒除尘 · 售后与口碑', tags: ['排查', '口碑'], source: 'generated', competitors: [] },

  // ---- 专业长尾（professional_long_tail）----
  { text: '滤筒除尘器入口风速超过多少会明显影响滤芯寿命？', intent: 'professional_long_tail', weight: 3, group_name: '滤筒除尘 · 专业长尾', tags: ['参数', '寿命'], source: 'generated', competitors: [] },
  { text: '铝镁粉尘用滤筒除尘需要额外做哪些防爆措施？', intent: 'professional_long_tail', weight: 3, group_name: '滤筒除尘 · 专业长尾', tags: ['防爆'], source: 'rewritten', competitors: [] },
  { text: '覆膜滤芯的初始压差一般控制在什么范围？', intent: 'professional_long_tail', weight: 2, group_name: '滤筒除尘 · 专业长尾', tags: ['压差'], source: 'manual', competitors: [] },
  { text: '滤筒除尘系统的漏风率怎么在现场测定？', intent: 'professional_long_tail', weight: 2, group_name: '滤筒除尘 · 专业长尾', tags: ['测定'], source: 'imported', competitors: [] },
];

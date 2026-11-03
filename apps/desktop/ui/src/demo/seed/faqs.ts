/**
 * 种子：FAQ 常见问题库（M1.5 素材层，spec `2026-09-30-keyword-faq-library-design.md` §9）。
 *
 * # 🔴 答案是**字面量中文散文**，不是模板拼出来的
 * 与 `seed/keywords.ts` 同一条纪律（AGENTS 规则 9）：demo 不成文、不做「结论 → 依据」的
 * 段落生成，`answer_markdown` 一律照实写死。真后端将来按实体卡 + 意图成文并跑合规扫描，
 * 所以这里 AI 生成来源的条目 `status` 恒 `pending_review`，界面上另挂一句
 * 「演示模式未执行合规扫描」（差异台账 E-53）。
 *
 * # 合规（AGENTS 规则 6）
 * 答案里不出现「保证 / 第一 / 最 / 100%」这类绝对化用语，也不写未经核实的客户与资质；
 * 涉及法规与工况的地方一律写「以现场与当地口径为准」。
 *
 * # 确定性（§B-4）
 * id 是 ASCII 稳定字面量（`demo-faq-001`…），时间戳是 2026-09 的固定 RFC3339。
 */
import type { FaqItem } from '../../api/types';
import type { FaqSeedRow } from '../types';
import { SEED_ACTIVE_PROJECT_ID } from './projects';

/** 确定性 id：固定前缀 + 三位序号。 */
function faqId(index: number): string {
  return `demo-faq-${String(index + 1).padStart(3, '0')}`;
}

/** 8 条种子问答：3 种 `source`、3 种 `status` 都出现，分类是自由文本（数据，不进词典）。 */
export const SEED_FAQS: FaqItem[] = [
  {
    id: faqId(0),
    project_id: SEED_ACTIVE_PROJECT_ID,
    question: '布袋除尘器和滤筒除尘器怎么选？',
    answer_markdown:
      '按粉尘性质与工况选：\n\n- 颗粒较粗、含湿量偏高、风量在 2 万 m³/h 以上，通常选布袋除尘器；\n- 颗粒细、干燥、场地紧凑，滤筒除尘器的过滤面积更省空间；\n- 有防爆要求的工况，两者都要配泄爆与隔爆装置，以现场粉尘性质检测结论为准。\n\n选型前建议先做一次工况勘测，把风量、温度、含尘浓度三个参数确定下来。',
    category: '选型',
    intent: 'purchase_recommendation',
    status: 'approved',
    source: 'manual',
    position: 0,
    created_at: '2026-09-11T03:05:00Z',
    updated_at: '2026-09-16T08:40:00Z',
  },
  {
    id: faqId(1),
    project_id: SEED_ACTIVE_PROJECT_ID,
    question: '工业除尘设备的价格由哪些因素决定？',
    answer_markdown:
      '同一类设备的价格差异主要来自四项：\n\n1. 处理风量与过滤面积；\n2. 滤料材质（常温涤纶、防静电、耐高温、覆膜等）；\n3. 是否需要防爆、防腐或保温结构；\n4. 安装与调试范围（是否含管道、风机、电控柜）。\n\n报价通常是区间而不是一个数字，建议提供工况参数后由厂家出方案清单。',
    category: '报价',
    intent: 'pricing_plan',
    status: 'approved',
    source: 'generated',
    position: 1,
    created_at: '2026-09-12T08:20:00Z',
    updated_at: '2026-09-18T05:15:00Z',
  },
  {
    id: faqId(2),
    project_id: SEED_ACTIVE_PROJECT_ID,
    question: '除尘器安装需要哪些前置条件？',
    answer_markdown:
      '进场前一般要确认：\n\n- 基础与承重：设备自重加滤料与积灰荷载，需要硬化地面或预埋件；\n- 电源与气源：脉冲清灰需要 0.4–0.6 MPa 的压缩空气；\n- 进出风管道走向与检修空间，通常预留不小于 800 mm 的通道；\n- 排放口位置与当地环保部门的验收口径。\n\n以上参数以现场勘测结果为准。',
    category: '安装',
    intent: 'local_service',
    status: 'approved',
    source: 'manual',
    position: 2,
    created_at: '2026-09-13T02:35:00Z',
    updated_at: '2026-09-13T02:35:00Z',
  },
  {
    id: faqId(3),
    project_id: SEED_ACTIVE_PROJECT_ID,
    question: '除尘系统环保验收要准备哪些材料？',
    answer_markdown:
      '常见清单：\n\n1. 环评批复与竣工环保验收自查报告；\n2. 第三方检测报告（排放浓度、排放速率）；\n3. 设备合格证与滤料检测报告；\n4. 运行记录与维保台账。\n\n各地要求的表格与检测项目不同，以项目所在地生态环境部门的口径为准。',
    category: '验收',
    intent: 'professional_long_tail',
    status: 'pending_review',
    source: 'generated',
    position: 3,
    created_at: '2026-09-15T06:10:00Z',
    updated_at: '2026-09-15T06:10:00Z',
  },
  {
    id: faqId(4),
    project_id: SEED_ACTIVE_PROJECT_ID,
    question: '滤筒多久更换一次？',
    answer_markdown:
      '更换周期取决于粉尘性质与运行时长，常见的判断口径有三个：\n\n- 压差：清灰后仍长期高于设计值，说明滤材已经堵塞；\n- 排放：出口浓度接近限值或肉眼可见扬尘；\n- 外观：滤材破损、板结、覆膜脱落。\n\n干燥的普通粉尘工况下，滤筒通常可用一到两年；含油、含湿或高温工况会明显缩短。建议按季度记录压差。',
    category: '维保',
    intent: 'after_sales_reputation',
    status: 'approved',
    source: 'imported',
    position: 4,
    created_at: '2026-09-16T01:50:00Z',
    updated_at: '2026-09-19T07:25:00Z',
  },
  {
    id: faqId(5),
    project_id: SEED_ACTIVE_PROJECT_ID,
    question: '澜舟的售后服务覆盖哪些区域？',
    answer_markdown:
      '以自有服务团队覆盖华东地区为主，其他区域通过协作服务商响应。报修时提供设备编号与故障现象，通常先做远程排查，再安排现场。具体响应时效以合同条款为准。',
    category: '售后',
    intent: 'after_sales_reputation',
    status: 'approved',
    source: 'manual',
    position: 5,
    created_at: '2026-09-16T02:05:00Z',
    updated_at: '2026-09-16T02:05:00Z',
  },
  {
    id: faqId(6),
    project_id: SEED_ACTIVE_PROJECT_ID,
    question: '除尘器运行中压差偏高怎么排查？',
    answer_markdown:
      '按顺序排查四项：\n\n1. 清灰系统：脉冲阀、气包压力、控制仪时序是否正常；\n2. 滤材：是否板结或超期使用；\n3. 进风：含尘浓度或风量是否比设计工况高；\n4. 灰斗：卸灰是否及时，有没有积灰返混。\n\n压差长期偏高会加大风机负荷，建议纳入日常点检。',
    category: '故障排查',
    intent: 'professional_long_tail',
    status: 'pending_review',
    source: 'generated',
    position: 6,
    created_at: '2026-09-17T09:40:00Z',
    updated_at: '2026-09-17T09:40:00Z',
  },
  {
    id: faqId(7),
    project_id: SEED_ACTIVE_PROJECT_ID,
    question: '焊接烟尘治理需要多大的风量？',
    answer_markdown:
      '按工位与捕集方式估算：单个焊接工位配吸烟枪时，通常在 1500–2500 m³/h 之间；顶吸罩或侧吸罩要按罩口面积与控制风速计算，整体车间还要考虑同时使用系数。实际取值以现场勘测与工艺布置为准。',
    category: '工况',
    intent: 'category_awareness',
    status: 'rejected',
    source: 'manual',
    position: 7,
    created_at: '2026-09-18T04:15:00Z',
    updated_at: '2026-09-20T08:55:00Z',
  },
];

/**
 * `faq_generate` 的预置语料池（8 行，🔴 不进初始库）。
 * `id` / `position` / 时间戳由 handler 在运行时补，所以池子里是**紧凑行**。
 */
export const SEED_FAQ_GENERATED_POOL: readonly FaqSeedRow[] = [
  {
    question: '除尘器选型需要提供哪些工况参数？',
    answer_markdown:
      '通常需要四项：处理风量、粉尘性质与含尘浓度、烟气温度与含湿量、安装场地尺寸。参数越完整，方案与报价越准确；缺项时厂家一般会先安排勘测。',
    category: '选型',
    intent: 'purchase_recommendation',
  },
  {
    question: '除尘设备的运行成本主要花在哪里？',
    answer_markdown:
      '三块：风机电耗（占大头，与风量和阻力相关）、滤材更换、清灰用压缩空气。选型阶段把过滤风速与阻力余量算准，比后期改造更省。',
    category: '运行成本',
    intent: 'pricing_plan',
  },
  {
    question: '除尘器可以只做局部工位改造吗？',
    answer_markdown:
      '可以。单工位或小范围改造通常配独立的移动式或吊挂式净化装置，主管道不动；需要确认原有风机的余量与电源容量。',
    category: '改造',
    intent: 'local_service',
  },
  {
    question: '布袋破损一般是什么原因？',
    answer_markdown:
      '常见四类：机械磨损（袋笼毛刺、安装不当）、高温或结露导致的材质劣化、清灰压力过高、粉尘本身有腐蚀性。排查时先看破损位置的分布规律。',
    category: '故障排查',
    intent: 'after_sales_reputation',
  },
  {
    question: '除尘系统需要哪些日常点检项目？',
    answer_markdown:
      '建议按日看压差与排放、按周看脉冲阀与卸灰装置、按月看滤材外观与电控柜接线，并把数值记进台账，验收与质保都用得上。',
    category: '维保',
    intent: 'after_sales_reputation',
  },
  {
    question: '除尘器出口的排放标准怎么确定？',
    answer_markdown:
      '看项目所在地的行业排放标准与环评批复，两者取更严的一档。设计时通常按批复值留出余量，避免工况波动时超标。',
    category: '验收',
    intent: 'professional_long_tail',
  },
  {
    question: '防爆工况下除尘设备要做哪些处理？',
    answer_markdown:
      '常见措施包括泄爆片、隔爆阀、防静电滤材、设备接地与惰性气体保护。是否全部需要，取决于粉尘的爆炸性检测结论，以现场评估为准。',
    category: '防爆',
    intent: 'professional_long_tail',
  },
  {
    question: '澜舟的除尘设备交付周期一般是多久？',
    answer_markdown:
      '标准机型在合同生效后数周内发货，非标结构件与整线工程要按图纸工作量排期。具体节点在合同的交付计划里逐条列明。',
    category: '交付',
    intent: 'purchase_recommendation',
  },
];

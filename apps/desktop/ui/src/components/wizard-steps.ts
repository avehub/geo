/** 5 步建项向导的步骤定义与各步字段清单（数据与组件分离，理由同 `entity-fields.ts`）。 */

export const WIZARD_STEPS = [
  { title: '品牌与别名', description: '品牌名、常见叫法' },
  { title: '官网与核心页', description: '自动建档的抓取入口' },
  { title: '产品线与服务范围', description: '产品、参数与服务边界' },
  { title: '地域与语言', description: '服务地域、行业与标签' },
  { title: '竞品 3–5 家', description: '同框对比与 SOV 基础' },
] as const;

export const WIZARD_STEP_FIELDS: readonly (readonly string[])[] = [
  ['brand_name', 'aliases', 'name'],
  ['website', 'core_pages'],
  ['products', 'service_scope'],
  ['region', 'language', 'industry', 'industry_label', 'tags'],
  ['competitors'],
];

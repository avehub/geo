/**
 * 品牌实体卡（Task 8 填入）。
 *
 * `fields.*` 的键名逐字等于 `components/entity-fields.ts` 里 `FieldDescriptor.path`
 * （稳定 id，也是数据库列名），因此**数据表加字段时键名不用另想**。
 * 裁定 B-3：这些是**实体卡字段标签**，与 Task 7 占用的 `fields.*`（`validation/failed`
 * 的 `field` 参数）语义不同——两侧集合只部分重叠（`aliases` / `products` 都出现，
 * 但一个是校验报错里指的字段、一个是卡上的展示标签），所以刻意不合并。
 *
 * 覆盖断言在 `src/i18n/no-hardcoded-strings.test.ts`（B-4）：它遍历 `ENTITY_FIELDS`
 * 与 `WIZARD_STEPS`，断言每个 key 两侧都 `exists`。扫描测试抓不到从数据表读出的变量 key，
 * 忘建词条是**静默**的，所以必须有这条。
 */
const entity = {
  fields: {
    standard_name: '标准名',
    aliases: '品牌别名',
    founded_year: '成立年份',
    qualifications: '资质认证',
    products: '产品与参数',
    price_range: '价格区间',
    service_regions: '服务地域',
    cases: '客户案例',
    differentiators: '差异化卖点',
    official_tone: '官方口径',
    contact: '联系方式',
  },

  /** `FieldStatus` 的 Tooltip 解释。状态标签本身仍来自 `api/types.ts`（归 Task 9）。 */
  fieldStatusHint: {
    official: '与官方口径一致，可直接用于内容生产',
    pending: 'AI 抽取或人工待确认，使用前请核对',
    disputed: '与公开信息存在冲突，需人工裁决',
  },

  revisions: {
    empty: '还没有修订记录',
  },

  fieldCard: {
    optional: '（选填）',
    jsonParseFailed: 'JSON 解析失败：{{detail}}',
    tagsPlaceholder: '输入后回车添加',
    yearPlaceholder: '例如：2006',
  },

  autobuild: {
    title: '域名自动建档',
    scopeHint: '仅抓自有域名，遵守 robots.txt，最多 8 页',
    domainPlaceholder: '例如：www.hongyu-pump.com',
    submit: '自动建档',
    running: '正在抓取官网并抽取实体卡…',
    emptyDomain: '请输入要抓取的官网域名，例如 www.example.com',
    success: '自动建档完成，字段完整率 {{percent}}%',
  },
};

export default entity;

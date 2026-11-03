/**
 * 关键词库 / FAQ 常见问题库（M1.5 素材层，zh-CN）。
 * 设计规格 `docs/superpowers/specs/2026-09-30-keyword-faq-library-design.md`（DR-40）。
 *
 * # 🔴 为什么两个页面共用一个 namespace
 * `sources`（来源标签）与 `reference` / `export`（两个共用弹窗）在两页之间是**同一份**：
 * 拆成 `keyword` + `faq` 两个 namespace 就得抄两份逐字相同的标签表，
 * 那正是 `entity.contentStatuses` 那个已被收掉的缺陷类（判据在 `i18n/enum-label-prefixes.test.ts`）。
 *
 * # 文案合规（AGENTS 规则 6）
 * 不承诺排名与效果；`staticNote` / `demoBody` 两句必须显示——搜索量、竞争难度与 AI 生成的问答
 * 在演示模式下都是**预置静态值**，不写清楚就等于让产品负责人拿演示数据当真实调研评审。
 *
 * ⚠ 插值变量一律不叫 `count`（i18next 会走复数分支去找 `_one` / `_other`，本词典没有）。
 */
const library = {
  /** 关键词类型标签（`enumLabel(t, 'library.kinds', kind)`）。 */
  kinds: {
    core: '核心词',
    long_tail: '长尾词',
    brand: '品牌词',
    competitor: '竞品词',
    question: '问题词',
  },

  /**
   * 素材来源标签（`enumLabel(t, 'library.sources', source)`），关键词与 FAQ 共用。
   *
   * 🔴 与 `prompt.sources`（M2 题库的 5 档来源）**刻意分开**：那边有 `template` / `rewritten`
   * 两档，来自题库的「模板展开 → 口语化改写」管线，素材库没有这两条链路。
   */
  sources: {
    manual: '人工录入',
    generated: 'AI 生成',
    imported: '批量导入',
  },

  /** 两页共用的表格与筛选器 chrome。 */
  columns: {
    intent: '意图',
    status: '状态',
    source: '来源',
    note: '备注',
    search: '站长数据',
    updatedAt: '最后更新',
    category: '分类',
    /**
     * 行内那个审核态 `Select` 的可访问名：带**行文本**，所以每一行都不同
     * （照 `prompt.table.weightAria` 的既有做法）。不带行文本的话，
     * 一屏十几行全是同一个 aria-label，读屏与测试都没法定位到具体哪一行。
     */
    statusAria: '审核状态 {{text}}',
  },

  filters: {
    allKinds: '全部类型（{{total}}）',
    allStatuses: '全部状态',
    allSources: '全部来源',
    allCategories: '全部分类（{{total}}）',
    allIntents: '全部意图（{{total}}）',
    uncategorized: '未分类',
    kindAria: '按类型筛选',
    statusAria: '按状态筛选',
    sourceAria: '按来源筛选',
    categoryAria: '按分类筛选',
    intentAria: '按意图筛选',
    filtered: '显示 {{shown}} / {{total}} 条',
  },

  actions: {
    add: '手动录入',
    generate: 'AI 生成',
    reference: '引用到 Prompt 题库',
    deleteSelected: '删除选中',
    deleteSelectedCount: '删除选中（{{selected}}）',
    exportCsv: '导出 CSV',
    exportJsonLd: '导出 FAQPage JSON-LD',
    demoModeHint: '演示模式下导出走浏览器下载，文件名回显在提示里。',
  },

  keyword: {
    title: '关键词库',
    subtitle: '核心词 · 长尾词 · 品牌词 · 竞品词 · 问题词，可直接引用去优化官网或进 Prompt 题库',
    staticNote: '月搜索量与竞争难度在演示模式下是预置静态值，不由前端抓取或计算。',
    empty: '还没有关键词。可以手动录入，也可以让 AI 生成一批。',
    text: '关键词',
    kind: '类型',
    monthlyVolume: '月搜索量',
    difficulty: '竞争难度',
    priority: '优先级',
    searchPlaceholder: '搜索关键词',
    searchAria: '搜索关键词',
    textPlaceholder: '例如：布袋除尘器厂家',
    addTitle: '录入关键词',
    editTitle: '编辑关键词',
    generateTitle: 'AI 生成关键词',
    kindsLabel: '生成哪几类',
    targetCountLabel: '生成数量',
    demoBody: '演示模式不调用模型：生成结果取自预置语料池，走查的是产物形态（类型、意图、审核态），不是选词质量。',
    generated: '已生成 {{total}} 条关键词',
    generatedNone: '预置语料池里没有符合这些类型的新词了：换个类型，或手动录入。',
    saved: '已保存关键词',
    deleted: '已删除 {{total}} 条关键词',
    deleteConfirmTitle: '删除关键词',
    deleteConfirmContent: '将删除 {{total}} 条关键词，此操作不可撤销。',
    requiredText: '请填写关键词文本',
    priorityAria: '优先级 {{text}}',
  },

  faq: {
    title: 'FAQ 常见问题库',
    subtitle: '问题 + 答案成对沉淀，可导出成官网的 FAQPage 结构化数据，或引用进 Prompt 题库',
    staticNote: 'AI 生成的问答在演示模式下取自预置语料，未执行合规扫描，采用前请人工核对。',
    empty: '还没有常见问题。可以手动录入，也可以让 AI 生成一批。',
    question: '问题',
    answer: '答案',
    answerPreview: '答案预览',
    searchPlaceholder: '搜索问题或答案',
    searchAria: '搜索常见问题',
    questionPlaceholder: '例如：布袋除尘器和滤筒除尘器怎么选？',
    answerPlaceholder: '按「结论 → 依据 → 适用工况」写，答案会原样进 JSON-LD。',
    addTitle: '录入常见问题',
    editTitle: '编辑常见问题',
    generateTitle: 'AI 生成常见问题',
    intentsLabel: '覆盖哪几类意图',
    targetCountLabel: '生成数量',
    demoBody: '演示模式不调用模型：问答取自预置语料池，走查的是产物形态（分类、意图、审核态、JSON-LD），不是文笔。',
    generated: '已生成 {{total}} 条常见问题',
    generatedNone: '预置语料池里没有符合这些意图的新问答了：换个意图，或手动录入。',
    saved: '已保存常见问题',
    deleted: '已删除 {{total}} 条常见问题',
    deleteConfirmTitle: '删除常见问题',
    deleteConfirmContent: '将删除 {{total}} 条常见问题，此操作不可撤销。',
    requiredQuestion: '请填写问题',
    requiredAnswer: '请填写答案',
    complianceUnchecked: '演示模式未执行合规扫描',
    exportDisabled: '没有「已通过」的问答可导出：JSON-LD 只收录人工审核通过的条目。',
    jsonldTitle: 'FAQPage 结构化数据预览',
    jsonldHint: '把这段 JSON-LD 放进官网页面的 head 里，搜索引擎与 AI 助手可以直接读取问答对。',
    jsonldIncluded: '收录 {{total}} 条已通过的问答',
  },

  /** 「引用到 Prompt 题库」弹窗（DR-43：复用既有 `prompt_item_add`，不加新命令）。 */
  reference: {
    title: '引用到 Prompt 题库',
    targetSet: '目标题库',
    targetSetPlaceholder: '选择一份题库',
    noSets: '这个项目还没有题库：先去「Prompt 题库」页生成或新建一份，再回来引用。',
    willAdd: '将新增 {{total}} 道题目',
    /**
     * 映射说明**按素材类型分两句**，不共用一句：
     * 🔴 权重那一半两侧不同源——关键词拿自己的 `priority` 当权重，FAQ 没有优先级字段，
     * 只能用题库的默认权重（DR-43）。合成一句就必然对其中一页说谎。
     */
    keywordMappingNote: '文本作为题干、意图沿用素材的意图、关键词优先级作为权重；分组与标签留空。',
    faqMappingNote: '问题作为题干、意图沿用素材的意图、权重用题库默认值；分组与标签留空。',
    sourceNote: '引用后来源按「人工录入」计：素材库的 AI 生成标记不会带进题库。',
    confirm: '引用',
    done: '已引用 {{total}} 道题目到「{{label}}」',
    needSelection: '请先勾选要引用的条目',
  },

  /** 导出预览弹窗（DR-44：前端组装文本 + 既有 `export_write_file` 落盘）。 */
  export: {
    title: '导出预览',
    fileName: '文件名',
    download: '下载',
    downloaded: '已导出：{{path}}',
    lines: '{{total}} 行',
  },
};

export default library;

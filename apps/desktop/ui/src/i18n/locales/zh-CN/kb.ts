/**
 * 知识库（M1.2b）词典。结构与设计裁定见 spec
 * `2026-10-10-kb-redesign-and-article-studio-design.md` DR-74 … DR-82。
 *
 * 🔴 同步块相关键（上一轮的 `kb.sync.*`）整体删除（DR-73）；
 * 模块表按 taxonomy v2 重写（11 个），新增 `scenarios` / `view` / `import` 三组。
 */
const kb = {
  title: '知识库',
  lead: '把品牌事实、案例、卖点、话术、口径与多媒体素材沉淀成一套可复用、可修改的知识。',
  demoHint: '演示模式：数据为预置样本，AI 生成不调用模型，图片与视频不加载远端文件。',
  /** DR-73：同步横幅退役后的静态职责说明条。 */
  dutyNote:
    '实体卡装「我是谁」的结构化事实，知识库存可复用的表达与素材；两者不互相同步，可用「从实体卡导入」一次性复制。',
  loadFailed: '知识库加载失败',

  stats: {
    modules: '有内容的模块',
    modulesCount: '{{count}} 条',
    entries: '知识条目',
    scripts: '话术条目',
    pendingReview: '待审核',
    unverified: '未核实',
    media: '多媒体',
  },

  /** 模块标签（`enumLabel(t, 'kb.modules', module)`），键名 == `KB_MODULE_VALUES`。 */
  modules: {
    brand: '品牌概况',
    product: '产品知识',
    selling_point: '产品卖点',
    sales_script: '销售话术',
    support_script: '客服话术',
    case: '客户案例',
    competitor: '竞品对照',
    audience: '人群与场景',
    tone: '官方口径与合规',
    qualification: '资质与认证',
    media: '素材库',
  },

  /** 每个模块一句用途说明（面板头上的灰字）。 */
  modulesHint: {
    brand: '我是谁：标准名、别名、成立年份与品牌故事',
    product: '卖什么：产品、参数与报价口径',
    selling_point: '为什么选我：与同区域厂商对照的差异要点',
    sales_script: '怎么谈：按销售场景组织的可复用话术',
    support_script: '怎么答：按客服场景组织的应答口径',
    case: '做过什么：可核验的交付案例',
    competitor: '同框对比：竞品名称、官网与应对要点',
    audience: '讲给谁听：目标人群、工况与决策链',
    tone: '怎么讲自己：口径与合规红线',
    qualification: '凭什么信：证书、资质与检测报告',
    media: '拿什么佐证：图片、视频与文档',
  },

  /** 素材形式标签，键名 == `KB_ENTRY_KIND_VALUES`。 */
  kinds: {
    statement: '定义句',
    text: '文本',
    link: '链接',
    image: '图片',
    video: '视频',
    file: '文档',
  },

  /** 来源标签，键名 == `KB_SOURCE_VALUES`。 */
  sources: {
    manual: '人工录入',
    generated: 'AI 生成',
    imported: '导入',
  },

  /** 话术场景标签（DR-75），键名 == `KB_SCENARIO_VALUES`。 */
  scenarios: {
    sales_first_contact: '首次触达',
    sales_needs: '需求挖掘',
    sales_objection: '异议处理',
    sales_quote: '报价沟通',
    sales_closing: '成交推进',
    sales_followup: '回访跟进',
    support_presale: '售前咨询',
    support_aftersale: '售后支持',
    support_complaint: '投诉安抚',
    support_return: '退换处理',
  },

  /** 视图切换（DR-76）与表格列名。 */
  view: {
    label: '视图',
    group: '分组卡片',
    table: '表格',
    columns: {
      module: '模块',
      kind: '形式',
      title: '标题',
      scenario: '场景',
      status: '状态',
      source: '来源',
      verifiedAt: '核实时间',
      updatedAt: '更新时间',
      actions: '操作',
    },
  },

  filters: {
    title: '筛选',
    reset: '重置',
    module: '模块',
    kind: '形式',
    status: '状态',
    source: '来源',
    all: '全部',
    searchPlaceholder: '搜索标题、正文或标签',
    noMatch: '没有符合筛选条件的知识',
    shown: '显示 {{shown}} / {{total}} 条',
  },

  entry: {
    add: '新增知识',
    added: '已新增 {{added}} 条知识',
    saved: '已保存',
    deleted: '已删除',
    deleteFailed: '删除失败，请重试',
    verified: '已核实 {{selected}} 条',
    copied: '已复制到剪贴板',
    copyFailed: '复制失败，请手动选择文本',
    empty: '还没有知识',
    emptyBody: '从「新增知识」或「从实体卡导入」开始沉淀第一条',
    unverified: '未核实',
    verifiedAt: '核实于 {{time}}',
    updatedAt: '最后更新 {{time}}',
    expand: '展开全文',
    collapse: '收起',
    preview: '预览素材',
    mediaNote: '演示模式不加载远端媒体文件，仅展示素材卡与地址。',
    scenarioLabel: '适用场景',
  },

  actions: {
    copy: '复制',
    edit: '编辑',
    verify: '核实',
    delete: '删除',
    deleteConfirm: '确定删除选中的 {{selected}} 条知识？删除后不可恢复。',
    batchVerify: '批量核实',
    batchDelete: '删除选中',
    generate: 'AI 生成',
    import: '从实体卡导入',
    exportMarkdown: '导出 Markdown',
    exportJson: '导出 JSON',
    demoModeHint: '演示模式：导出内容为预置样本',
  },

  /** 从实体卡 / 项目一次性导入（DR-81）。 */
  import: {
    title: '从实体卡导入',
    hint: '导入是一次性复制：落库后源头再修改不会同步到知识库。',
    groupEntity: '品牌实体卡',
    groupProject: '项目信息',
    columnPreview: '预览',
    columnModule: '落入模块',
    columnStatus: '落入状态',
    empty: '实体卡与项目信息都没有可导入的内容',
    done: '已导入 {{added}} 条知识',
    submit: '导入所选',
    profileTitle: '行业、地域与标签画像',
  },

  generate: {
    title: 'AI 生成知识',
    modules: '在哪些模块生成',
    modulesRequired: '请至少选择一个模块',
    count: '生成条数',
    submit: '生成',
    empty: '所选模块没有可生成的预置语料，换个模块或手动录入',
    done: '已生成 {{added}} 条，状态为待审核',
    demoNote: '演示模式不调用模型：从预置语料池逐字取出；未执行合规扫描。',
  },

  export: {
    docTitle: '品牌知识库',
    docNote: '由稿得快 GEO 客户端导出；待审核条目不含在本文件内。',
    markdownTitle: 'Markdown 知识册',
    markdownHint: '给内容团队直接读的版本',
    jsonTitle: 'JSON 知识包',
    jsonHint: '机器可读，带来源与核实时间等溯源字段',
  },

  editor: {
    titleAdd: '新增知识',
    titleEdit: '编辑知识',
    module: '模块',
    kind: '形式',
    scenario: '话术场景',
    scenarioNone: '不挂场景',
    title: '标题',
    titleRequired: '请填写标题',
    body: '正文（Markdown）',
    bodyMediaHint: '媒体类条目这里填写说明 / 图注',
    url: '地址',
    mime: '媒体类型',
    tags: '标签',
    status: '审核状态',
    submit: '保存',
  },

  /**
   * 修订留痕（DR-119）：编辑侧滑的第二个页签，与品牌实体卡**共用** `RevisionTimeline`。
   * 🔴 空态是知识库自己那句（`entity.revisions.empty` 是实体卡页的口径，不复用）。
   */
  revisions: {
    title: '修订历史',
    // 🔴 刻意与实体卡那句（`entity.revisions.empty` = 「还没有修订记录」）**不同词面**：
    // 这里的空态是"这一条知识"的，不是"整个项目"的，写成条目级口径用户才知道范围；
    // 同词面的话，`KbEntryDrawer` 那个空态分流就算被谁删掉也没有任何判据会红。
    empty: '这条知识还没有修订记录',
  },

  /**
   * 留痕里 `field_path` 的字段标签，键名 == `components/kb-fields.ts` 的 `KB_FIELDS[].path`。
   *
   * 🔴 与上面 `editor.*` 那组**刻意分开**（哪怕词面一样）：`editor.*` 是表单的输入提示，
   * 这里是"改过哪个字段"的台账标签，两者会各自演化（例如台账里的 `verified_at` / `position`
   * 在表单里根本不可编辑）。合并成一组的话，改表单文案就会顺手改掉台账文案。
   */
  fields: {
    title: '标题',
    body_markdown: '正文',
    url: '地址',
    mime: '媒体类型',
    tags: '标签',
    status: '审核状态',
    scenario: '话术场景',
    verified_at: '核实时间',
    position: '排序',
    module: '模块',
    kind: '形式',
  },
};

export default kb;

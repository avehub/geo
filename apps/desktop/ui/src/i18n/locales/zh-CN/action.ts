/**
 * M6 GEO 行动中心（zh-CN）。
 *
 * 口径来自产品定义 §3.8：四类处方库（站点结构 / 信源布局 / 事实纠错 / 内容生产）、
 * 每条处方的「影响范围 + 预期收益 + 依据 + 实施难度 + 负责人建议 + 可交付物模板」、
 * 1 小时内可完成的快赢项（MVP 验收 ≥3 条）、执行跟踪、闭环归因、一键生成内容。
 *
 * 🔴 `attribution.note` 必须显示：归因卡片把"完成动作"与"指标变化"并排放，
 * 不写清"AI 回答有随机性、这不是因果证明"，就等于在暗示我们能控制模型输出
 * （AGENTS 规则 6 的同族红线）。
 */
const action = {
  title: 'GEO 行动中心',
  subtitle: '处方清单 · 执行跟踪 · 闭环归因 · 内容生产',
  staticNote: '处方清单与归因数字在演示模式下是预置静态值，不由前端排序或重算。',

  list: {
    title: 'Top 处方',
    rank: '名次',
    category: '类别',
    actionTitle: '处方',
    rationale: '依据',
    impact: '预期收益',
    difficulty: '实施难度',
    owner: '负责人建议',
    deliverable: '可交付物',
    affectedPrompts: '影响题目',
    affectedEngines: '涉及引擎',
    evidence: '关联证据',
    status: '状态',
    updatedAt: '最后更新',
    completedAt: '完成时间',
    quickWin: '1 小时内可完成',
    quickWinSummary: '其中 {{total}} 条预计 1 小时内可完成。',
    markDone: '标记完成',
    markInProgress: '标记进行中',
    markTodo: '打回待办',
    statusOk: '已更新处方状态',
    generate: '生成可交付物',
    // M6.5 站点接入（spec DR-50）：处方行多一个入口，跳到 `/projects/:id/site?from=<action_id>`，
    // 站点页据此自动打开生成弹窗并预选这条处方。
    // 🔴 `source_layout` 类处方那一行**置灰**，tooltip 复用 `site.generate.sourceLayout`
    // （同一句话不在两个 namespace 各存一份：那正是 `entity.contentStatuses` 那个缺陷类的形状，
    // 而这句话是合规敏感的——两处措辞一旦漂移，置灰理由与弹窗理由就会互相矛盾）。
    sitePatch: '站点补丁',
    noEvidence: '这条处方没有关联的核查问题',
    empty: '还没有处方。',
  },

  categories: {
    site_structure: '站点结构',
    source_layout: '信源布局',
    fact_correction: '事实纠错',
    content_production: '内容生产',
  },

  statuses: {
    todo: '待办',
    in_progress: '进行中',
    done: '已完成',
  },

  /**
   * 文稿审核态（`ContentStatus`）。与上面的 `statuses`（处方**执行**态）刻意分开：
   * 一个是"这条做没做完"，一个是"这份能不能对外发"，混用会让"已退回"看起来像"没做完"。
   */
  contentStatuses: {
    pending_review: '待人工审核',
    approved: '已通过',
    rejected: '已退回',
  },

  levels: {
    high: '高',
    medium: '中',
    low: '低',
  },

  attribution: {
    title: '闭环归因',
    baseline: '基线轮',
    retest: '复测轮',
    actions: '期间完成的动作',
    before: '执行前',
    after: '复测后',
    change: '变化',
    metric: '指标',
    empty: '还没有可归因的复测轮。',
    note: 'AI 回答存在随机性，区间按重复采样给出；这张卡片是环比对照，不是因果证明。',
    metrics: {
      brand_coverage: 'Brand Coverage',
      top3_rate: 'Top3 率',
      fact_error_count: '事实错误条数',
      negative_rate: '负面提及占比',
    },
  },

  templates: {
    title: '内容模板',
    kind: '模板',
    sections: '章节结构',
    formats: '可导出格式',
    targets: '适配处方类别',
    generate: '生成文稿',
    empty: '没有可用模板。',
    kinds: {
      qa_article: '问答式文章',
      comparison_table: '横向对比表',
      spec_card: '参数规格卡',
      case_card: '客户案例卡',
      faq_page: '常见问题页',
      glossary_page: '术语页',
    },
  },

  /** 模板章节（`ContentTemplate.section_keys`，稳定记号）。 */
  templateSections: {
    term_definition: '术语定义',
    working_principle: '工作原理',
    selection_guide: '选型要点',
    related_terms: '相关术语',
    references: '参考资料',
    question: '问题',
    short_answer: '一句话回答',
    detail: '展开说明',
    faq: '延伸问答',
    sources: '引用来源',
    scope: '对比范围',
    criteria: '对比维度',
    table: '对比表',
    how_to_read: '怎么读这张表',
    model: '型号',
    parameters: '参数',
    applications: '适用工况',
    certification: '认证信息',
    delivery: '交付周期',
    client_context: '客户背景',
    challenge: '面临的问题',
    solution: '解决方案',
    results: '落地结果',
    verification: '可验证信息',
    faq_price: '价格类问题',
    faq_delivery: '交付类问题',
    faq_service: '售后类问题',
    schema_note: '结构化标记说明',
  },

  contents: {
    title: '已生成文稿',
    contentTitle: '标题',
    status: '审核态',
    createdAt: '生成时间',
    updatedAt: '最后更新',
    action: '关联处方',
    template: '模板',
    preview: '预览',
    approve: '通过',
    reject: '退回',
    reopen: '打回待审',
    statusOk: '已更新审核态',
    generated: '已生成演示文稿，状态为待人工审核',
    complianceChecked: '已过合规扫描',
    complianceUnchecked: '演示模式未执行合规扫描',
    demoBody: '正文是预置的演示文稿：演示模式不调用模型，走查的是产物形态而不是文笔。',
    pendingNote: '生成内容默认待人工审核，通过后才可对外发布（合规红线）。',
    empty: '还没有生成过文稿。',
    noAction: '未关联处方',
  },

  export: {
    title: '导出',
    desktopOnly: '{{format}} 由桌面端提供，演示模式下不可用。',
    done: '已导出：{{path}}',
    cancelled: '已取消导出',
    onlyApproved: '只有审核通过的文稿才能导出；待审或已退回的文稿请先通过审核。',
  },
};

export default action;

/**
 * 文章管理 Article Studio（M6 内容生产，zh-CN）。
 * 设计规格 `docs/superpowers/specs/2026-10-10-kb-redesign-and-article-studio-design.md`（DR-83 … DR-89）。
 *
 * # 结构 = 三个工作区（DR-86）
 * `directions`（方向与策略）/ `templates`（提示词模板）/ `schedules` + `review`（排期与文章评审队列），
 * 外加四张**枚举标签表**（`slots` / `freqs` / `statuses` / `sources`，DR-88 点名走 `enumLabel`）
 * 与 `weekdays`（排期的星期几：它是 1~7 的**数字**而不是枚举串 ⇒ 不走 `enumLabel`，
 * 用 `components/ArticleScheduleTable.tsx` 里那张 `Record<number, TranslationKey>` 查）。
 *
 * # 🔴 两句必须常驻的演示说明（DR-85）
 * `demoHint`（页头）与 `schedules.demoBody`（排期表上方）：demo **没有定时器**也**不调模型**，
 * `next_run_at` 只是显示值、生成物逐字来自预置语料池。不写清楚，产品负责人就会把
 * "排期到点自动出稿"当成本轮已经落地的能力评审。
 *
 * # 文案合规（AGENTS 规则 6）
 * 不承诺排名与效果；生成物一律 `pending_review`，`review.complianceUnchecked`
 * 那句免责标签挂在每一行待审文章上（与 `library.faq.complianceUnchecked` 逐字相同）。
 *
 * ⚠ 插值变量一律不叫 `count`（i18next 会走复数分支去找 `_one` / `_other`，本词典没有）。
 * ⚠ 值里**不许**出现字面量 `{{slot}}` 记号：i18next 会把它当插值变量吃掉（未命中 ⇒ 渲染成空串）。
 *   槽位记号的形状由 `components/article-slots.ts` 的 `slotToken()` 独家持有。
 */
const article = {
  title: '文章管理',
  lead: '先定「写什么」的方向，再定「怎么问模型」的模板，让排期按周期产出稿子，最后由人评审定稿。',
  demoHint:
    '演示模式：方向、模板与文章都是预置样本；AI 生成不调用模型，排期也不会到点自动运行，刷新即重置。',
  loadFailed: '文章管理加载失败',

  /** 三个工作区（DR-86）。 */
  tabs: {
    directions: '方向与策略',
    templates: '提示词模板',
    pipeline: '排期与文章',
  },

  /** 提示词槽位标签（`enumLabel(t, 'article.slots', slot)`），键名 == `ARTICLE_SLOT_VALUES`。 */
  slots: {
    brand: '品牌',
    product: '产品',
    keyword: '关键词',
    audience: '目标人群',
    scenario: '写作场景',
    competitor: '竞品',
  },

  /** 排期频率标签，键名 == `ARTICLE_FREQ_VALUES`。 */
  freqs: {
    daily: '每天',
    weekly: '每周',
  },

  /**
   * 文章评审态标签，键名 == `ARTICLE_STATUS_VALUES`。
   * 🔴 与 `action.contentStatuses` **刻意分开**（DR-88 点名 `article.statuses` 走 `enumLabel`）：
   * 三档取值同形，但评审队列讲的是"稿子能不能交付"，行动中心讲的是"处方内容审没审"，
   * 两张表各自演进（例如将来给稿子加一档"已排期待发布"时不该牵动处方）。
   */
  statuses: {
    pending_review: '待审核',
    approved: '已通过',
    rejected: '已打回',
  },

  /** 来源标签，键名 == `ARTICLE_DIRECTION_SOURCE_VALUES` ∪ `ARTICLE_SOURCE_VALUES`（方向与文章共用）。 */
  sources: {
    manual: '人工录入',
    generated: 'AI 生成',
    scheduled: '排期生成',
  },

  /** ISO 8601 的星期几（1 = 周一 … 7 = 周日）。 */
  weekdays: {
    mon: '星期一',
    tue: '星期二',
    wed: '星期三',
    thu: '星期四',
    fri: '星期五',
    sat: '星期六',
    sun: '星期日',
  },

  // -------------------------------------------------------------------------
  // ① 方向与策略（DR-86①）
  // -------------------------------------------------------------------------
  directions: {
    hint: '方向回答「写什么、写给谁」：一个方向下面可以挂多份提示词模板，模板再被排期引用。',
    empty: '还没有内容方向。可以手动新增，也可以让 AI 先生成一批再挑。',
    add: '新增方向',
    generate: 'AI 生成方向',
    addTitle: '新增内容方向',
    titleLabel: '方向标题',
    titlePlaceholder: '例如：选型科普怎么写',
    summaryLabel: '场景摘要',
    summaryPlaceholder: '一句话说清写给谁、在什么场景下写；它同时是模板预览里写作场景槽位的取值。',
    titleRequired: '请先填写方向标题',
    ok: '保存',
    archive: '归档',
    restore: '恢复',
    statusArchived: '已归档',
    /** 卡片脚注：这个方向下面挂了几份模板、累计产出几篇稿子（survey §4B 的方向卡）。 */
    templateCount: '{{total}} 份模板',
    articleCount: '{{total}} 篇文章',
    saved: '已保存方向',
    archived: '方向已归档',
    restored: '方向已恢复',
    generated: '已生成 {{total}} 个方向',
    generatedNone: '预置方向已经用完：换个说法手动新增，或刷新回到初始样本。',
    generateDemoBody: '演示模式不调用模型：生成的方向逐字取自预置语料池，按标题去重。',
  },

  // -------------------------------------------------------------------------
  // ② 提示词模板（DR-86②）
  // -------------------------------------------------------------------------
  templates: {
    hint: '模板回答「怎么问模型」：正文里用槽位记号引用品牌、产品与关键词，点槽位按钮即可插到光标处。',
    empty: '还没有提示词模板。先在「方向与策略」里定方向，再回来新建模板。',
    create: '新建模板',
    edit: '编辑',
    delete: '删除',
    deleteTitle: '删除模板',
    /**
     * 🔴 刻意**不带插值**：页面测试拿词典原串断言确认弹窗的内容
     * （`toContain(A.templates.deleteCascade)`），带了 `{{total}}` 就对不上渲染结果。
     * 条数信息在提示语 `deleted` 里给。
     */
    deleteCascade:
      '删除模板会连带删掉挂在它们下面的排期；已经生成的文章保留在评审队列里。此操作不可撤销。',
    deleteOk: '删除',
    deleted: '已删除 {{total}} 份模板',
    saved: '已保存模板',
    runNow: '立即生成',
    generated: '已生成 {{total}} 篇待审文章',
    generatedNone: '预置文章池已经用完：没有新稿子可生成，刷新可回到初始样本。',
    columns: {
      name: '模板名称',
      direction: '所属方向',
      slots: '槽位',
      style: '文风',
      length: '目标字数',
      updatedAt: '最后更新',
    },
    editor: {
      createTitle: '新建提示词模板',
      editTitle: '编辑提示词模板',
      nameLabel: '模板名称',
      nameRequired: '请先填写模板名称',
      directionLabel: '所属方向',
      directionRequired: '请选择所属方向',
      promptLabel: '提示词正文',
      /** 正文输入框的可访问名（页面测试与读屏都靠它定位）。 */
      promptAria: '提示词正文',
      promptRequired: '请先填写提示词正文',
      slotsLabel: '点击插入槽位',
      slotsHint: '槽位记号会插到光标所在位置；同一份模板里重复插入同一个槽位不会去重。',
      previewLabel: '实时预览',
      /** 预览区（只读）的可访问名。 */
      previewAria: '实时预览',
      previewHint: '预览用项目里的真实值替换槽位；取不到值的槽位保留记号，方便看出哪一槽还没绑东西。',
      wordCount: '预览字数 {{total}}',
      kbModules: '引用知识模块',
      kbModulesHint: '只记录引用关系：演示模式不把知识条目拼进提示词，交给真后端的生成管线去做。',
      bindingsLabel: '绑定素材',
      productNamesLabel: '产品名',
      productNamesPlaceholder: '输入产品名后回车',
      keywordTextsLabel: '关键词',
      keywordTextsPlaceholder: '输入关键词后回车',
      audienceLabel: '目标人群',
      audiencePlaceholder: '例如：水泥厂设备工程师',
      styleLabel: '文风',
      stylePlaceholder: '例如：技术科普风',
      lengthLabel: '目标字数',
      ok: '保存',
    },
  },

  // -------------------------------------------------------------------------
  // ③ 排期与文章评审队列（DR-86③）
  // -------------------------------------------------------------------------
  schedules: {
    title: '生成排期',
    /** 🔴 常驻（DR-85）：demo 没有定时器，到点不会自动出稿。 */
    demoBody:
      '演示模式不跑真实定时任务：「下次运行」只是按频率与时间算出来的显示值，到点不会自动产出。要立刻看到效果请点「立即运行」。',
    empty: '还没有排期。新建一条，把模板挂上去并选个频率。',
    create: '新建排期',
    edit: '编辑',
    runNow: '立即运行',
    ran: '已生成 {{total}} 篇待审文章',
    ranNone: '预置文章池已经用完：这次运行没有产出，也没有记进运行次数。',
    saved: '已保存排期',
    columns: {
      template: '绑定模板',
      freq: '频率',
      time: '运行时间',
      nextRun: '下次运行',
      lastRun: '上次运行',
      runCount: '已运行',
      enabled: '启用',
    },
    /** 行内那个开关的可访问名：带模板名，所以每一行都不同（照 `library.columns.statusAria`）。 */
    enabledAria: '启用排期 {{name}}',
    editor: {
      createTitle: '新建生成排期',
      editTitle: '编辑生成排期',
      templateLabel: '绑定模板',
      templateRequired: '请选择要绑定的模板',
      freqLabel: '频率',
      timeLabel: '运行时间',
      weekdayLabel: '星期',
      weekdayRequired: '每周排期要选一个星期',
      enabledLabel: '启用这条排期',
      ok: '保存',
    },
  },

  review: {
    title: '文章评审队列',
    hint: '生成物一律先进人工评审：只有「已通过」的文章才进导出物，待审与打回的稿子都不会被当成可交付内容。',
    empty: '还没有文章。去「提示词模板」点「立即生成」，或在排期上点「立即运行」。',
    filterAria: '按审核状态筛选',
    filterAll: '全部状态',
    approveCount: '通过选中（{{selected}}）',
    approved: '已通过 {{total}} 篇文章',
    rejectCount: '退回选中（{{selected}}）',
    rejected: '已退回 {{total}} 篇文章',
    needSelection: '请先勾选要评审的文章',
    export: '导出 Markdown',
    exportDisabled: '没有「已通过」的文章可导出：Markdown 文章册只收录人工评审通过的稿子。',
    preview: '预览',
    /** 预览抽屉里正文（只读）的可访问名。 */
    previewAria: '文章正文',
    /** 🔴 常驻（规则 6 的 demo 侧对价）：待审行都挂着这一句。 */
    complianceUnchecked: '演示模式未执行合规扫描',
    bodyHint: '正文按 Markdown 原文展示，不渲染成 HTML：数据不是标记，与 FAQ 答案同一个口径。',
    meta: {
      direction: '方向',
      template: '模板',
      source: '来源',
      status: '状态',
      words: '字数',
      generatedAt: '生成时间',
    },
    columns: {
      title: '标题',
      direction: '方向',
      template: '模板',
      source: '来源',
      status: '状态',
      words: '字数',
      generatedAt: '生成时间',
    },
  },

  /** 导出（DR-89：前端组装文本 + 既有 `export_write_file` 落盘，不新增导出命令）。 */
  export: {
    markdownTitle: '导出 Markdown 文章册',
    markdownHint: '给内容团队直接读的版本；只有已通过评审的文章会被收录。',
    docTitle: '生成文章册',
    docNote: '由稿得快 GEO 客户端导出；待审核与已打回的文章不含在本文件内。',
    /** 每一篇末尾那行元信息（`api/article-compose.ts` 用）。 */
    metaLine: '生成于 {{time}} · {{words}} 字',
  },
};

export default article;

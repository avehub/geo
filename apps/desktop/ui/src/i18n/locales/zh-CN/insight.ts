/**
 * M4 回答解析与事实核查（zh-CN）。
 *
 * 口径来自产品定义 §3.6：结构化抽取（品牌提及 / 推荐位次 / 情感倾向 / 引用来源归类 /
 * 回答形态）、事实核查（**说错了 / 说旧了 / 漏说了** 三类，逐字段对照 M1 实体卡）、
 * 风险标记、抽取质量保障（置信度 + 低置信度人工复核队列 + 一键纠正）。
 *
 * 🔴 `factCheck.accuracyNote` 那句是**必须显示**的口径说明：事实准确率是采集时的静态值，
 * 人工结办几条问题**不会**让它变化（demo 不重算，AGENTS 规则 9）。少了这句，
 * 界面上"结办了 2 条、准确率没动"看起来像 bug。
 */
const insight = {
  title: '回答解析与事实核查',
  subtitle: '结构化抽取 + 三类事实问题，每条都能回到原始回答',
  sampleOnly: '演示数据只收录样本条目的解析结果与核查问题。',
  staticNote: '置信度、来源归类与准确率在演示模式下是预置静态值，不由前端重算。',
  round: '轮次',
  /**
   * 轮次选择器的可访问名（`aria-label`）。
   *
   * 🔴 不能只靠 `placeholder`：选中一轮之后占位文案就没了，Select 的可访问名变成空串，
   * 读屏软件只会念出当前值、说不出这个下拉是干什么的（与 `prompt.promptSet.groupFilterAria`
   * 同一个理由）。
   */
  roundAria: '选择轮次',
  tabs: {
    insights: '解析结果',
    factCheck: '事实核查',
  },

  list: {
    prompt: '题目',
    engine: '引擎',
    mentioned: '本品牌',
    rank: '推荐位次',
    sentiment: '情感',
    confidence: '置信度',
    needsReview: '待人工复核',
    reviewed: '已复核',
    risks: '风险标记',
    corrected: '已人工纠正',
    shape: '回答形态',
    sources: '引用来源',
    openEvidence: '看证据',
    correct: '纠正',
    empty: '没有符合筛选条件的解析结果。',
    reviewedAt: '复核时间',
    confidenceFloor: '置信度低于 {{floor}} 的条目进人工复核队列。',
  },

  filters: {
    engine: '引擎',
    /** 四个筛选器的可访问名（理由同 `insight.roundAria`：占位文案选中后就消失）。 */
    engineAria: '按引擎筛选',
    review: '复核状态',
    reviewAria: '按复核状态筛选',
    needsReviewOnly: '只看待复核',
    mentioned: '提及情况',
    mentionedAria: '按提及情况筛选',
    mentionedOnly: '只看提及本品牌',
    notMentionedOnly: '只看未提及',
    risk: '风险标记',
    riskAria: '按风险标记筛选',
    all: '全部',
    reset: '清空筛选',
  },

  /** 回答形态（`AnswerShape`）：四个布尔位，界面上用标签展示。 */
  shape: {
    hasConclusion: '有结论',
    hasTable: '有对比表',
    asksBack: '反问澄清',
    refused: '拒答',
    plain: '常规叙述',
  },

  /** 风险标记（`RiskFlag`）。 */
  risks: {
    regulated_claim: '涉监管表述',
    absolute_wording: '绝对化用语',
    suspected_hallucination: '疑似编造',
    negative_buzz: '负面舆情',
  },

  mentions: {
    title: '品牌提及明细',
    brand: '品牌',
    role: '角色',
    count: '次数',
    sentiment: '情感',
    rank: '位次',
    inTable: '在对比表里',
    excerpt: '回答原文片段',
    empty: '这条回答没有提到任何品牌。',
  },

  roles: {
    self: '本品牌',
    competitor: '竞品',
    other: '其他品牌',
  },

  /** 人工纠正过的字段名（`AnswerInsight.corrected_fields`）。 */
  correctedFields: {
    self_mentioned: '是否提及',
    self_rank: '推荐位次',
    self_sentiment: '情感倾向',
  },

  correct: {
    title: '人工纠正',
    mentioned: '提及本品牌',
    rank: '推荐位次',
    rankPlaceholder: '未进推荐清单则留空',
    rankInvalid: '推荐位次需是 1 或更大的整数',
    sentiment: '情感倾向',
    submit: '提交纠正',
    ok: '已记录人工纠正，本条已移出复核队列',
    demoNotice: '纠正只改这一条的展示与证据行投影，不会重算任何比率（演示模式不做计算）。',
    excerpt: '回答原文片段',
  },

  factCheck: {
    title: '事实核查',
    summary: '汇总',
    checkedAnswers: '已核查回答',
    accuracy: '事实准确率',
    accuracyNote: '准确率是采集时的静态口径：人工结办问题不会让它变化（演示模式不重算）。',
    falsePositives: '判为误报',
    byKind: '分类条数',
    noSummary: '这一轮没有可发布的核查汇总（样本不足时不出准确率）。',
    issues: '问题清单',
    kind: '类型',
    field: '实体卡字段',
    answerExcerpt: '回答里的说法',
    entityValue: '实体卡口径',
    confidence: '置信度',
    status: '状态',
    channel: '更正渠道',
    note: '处理说明',
    notePlaceholder: '写清楚去哪儿改、改成了什么（可选）',
    resolvedAt: '结办时间',
    resolve: '结办',
    markCorrected: '标为已更正',
    markFalsePositive: '标为误报',
    reopen: '重新打开',
    resolveOk: '已更新核查问题状态',
    empty: '这一轮没有核查问题。',
    openEvidence: '看证据',
  },

  /** 三类事实问题（`FactIssueKind`）——产品定义里的原话。 */
  kinds: {
    wrong: '说错了',
    outdated: '说旧了',
    missing: '漏说了',
  },

  issueStatuses: {
    open: '待处理',
    false_positive: '误报',
    corrected: '已更正',
  },

  /** 更正渠道（`CorrectionChannel`）：M6 处方库第 3 类要给"去哪儿改"。 */
  channels: {
    official_site: '官网页面',
    baike_entry: '百科词条',
    third_party_page: '第三方页面',
    service_script: '客服话术',
    business_directory: '企业名录',
  },
};

export default insight;

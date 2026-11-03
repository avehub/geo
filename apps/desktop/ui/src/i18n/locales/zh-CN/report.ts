/**
 * M7 报告与分享（zh-CN）。
 *
 * 口径来自产品定义 §3.9：老板版（1 页结论 + 3 个数字 + 下一步）、执行版（带明细与证据附录）、
 * 白标版（服务商署名）、报告口径说明页、导出与分享。
 *
 * # 🔴 报告标题在这里、报告内容不在
 * 种子（`demo/seed/reports.ts`）只给**稳定记号 + 数据**：节 id、指标 id、表头 id、叙述段。
 * 标题、节标题、指标名、表头、免责声明都是界面文案 ⇒ 一律走本词典，
 * 于是导出的 Markdown / HTML / CSV 会随界面语言走（`src/api/report-compose.ts`）。
 *
 * # `disclaimer` 是合规红线（AGENTS 规则 6）
 * 报告会被转发给老板与客户，所以每一版都带同一句免责声明：说明抽样与口径、
 * 且明确**不承诺**搜索或 AI 的排名结果。这句不许按版本删减。
 */
const report = {
  settingsTitle: '报告设置',
  title: '报告与分享',
  subtitle: '同一份数据，三种讲法：老板版 / 执行版 / 白标版',
  staticNote: '报告里的数字取自诊断页的静态口径，演示模式不重算。',
  round: '轮次',
  render: '生成报告',
  empty: '选择一轮已完成的采集，再生成报告。',
  roundUnavailable: '排队中、采集中或失败的轮次不能出报告。',
  includeEvidence: '附证据附录',
  evidenceHint: '附录含原始回答片段、引擎与采集时间，用于向老板或客户自证。',

  variants: {
    executive: '老板版',
    detailed: '执行版',
    white_label: '白标版',
  },

  variantHints: {
    executive: '1 页结论 + 3 个数字 + 下一步',
    detailed: '含可见度明细、竞品对标、引擎差异、漏斗、核查明细与处方摘要',
    white_label: '服务商署名，去掉漏斗与核查明细',
  },

  /** 报告标题模板：`{{brand}}` 是数据（品牌名），`{{round}}` 是数据（轮次名）。 */
  titleOf: {
    executive: '{{brand}} · GEO 体检简报（{{round}}）',
    detailed: '{{brand}} · GEO 体检执行报告（{{round}}）',
    white_label: '{{brand}} · GEO 体检报告（{{round}}）',
  },

  headline: '关键数字',
  nextSteps: '下一步建议',

  /**
   * CSV 明细的表头（只有导出用得到）。
   *
   * 🔴 不能写成代码里的英文字面量：导出文件是**给用户看的产物**，同样归 AGENTS 规则 7 管
   * （界面语言是中文就该导出中文表头）。
   */
  csvHeader: {
    metric: '指标',
    value: '数值',
    delta: '变化',
  },

  /** 节标题（`ReportSection.id`，稳定记号）。 */
  sections: {
    conclusion: '结论',
    coverage: '可见度明细',
    competitors: '竞品对标',
    engines: '引擎差异',
    funnel: '意图漏斗',
    fact_check: '事实核查明细',
    actions: '处方摘要',
    evidence: '证据附录',
  },

  /** 指标名（`ReportMetricBlock.metric` / 归因卡片的 metric，稳定记号）。 */
  metrics: {
    brand_coverage: 'Brand Coverage',
    total_score: 'GEO 体检总分',
    sample_size: '样本量',
    success_rate: '采集成功率',
    share_of_voice: 'Share of Voice',
    fact_accuracy: '事实准确率',
    fact_error_count: '事实错误条数',
    top3_rate: 'Top3 率',
    negative_rate: '负面提及占比',
    distinct_cited_domains: '被引域名（去重）',
  },

  /** 表头（`ReportTableBlock.column_keys`，稳定记号）。 */
  columns: {
    prompt_text: '题目',
    engine: '引擎',
    collected_at: '采集时间',
    mention: '是否提及',
    rank: '位次',
    answer_excerpt: '回答片段',
    brand: '品牌',
    coverage: '覆盖率',
    share_of_voice: '提及份额',
    top3_rate: 'Top3 率',
    sentiment: '情感',
    fact_error_count: '事实错误',
    fact_error_rate: '事实错误率',
    success_rate: '采集成功率',
    avg_latency_ms: '平均耗时',
    title: '处方',
    category: '类别',
    impact: '预期收益',
    status: '状态',
    stage: '漏斗阶段',
    prompt_count: '题目数',
    mention_rate: '提及率',
  },

  methodology: {
    title: '口径说明',
    round: '轮次',
    sampleSize: '样本量',
    grade: '样本量分级',
    collectedAt: '采集完成时间',
    engines: '引擎',
    modelVersions: '模型版本',
    promptSet: '题库',
    promptSetVersion: '题库版本',
    metricSpec: '指标口径版本',
    repeatCount: '重复采样',
    repeatNote: '关键题目重复采样 {{times}} 次：比率类指标是区间，不是单点。',
    insufficientNote: '样本量低于下限，本报告只提供方向性参考，不提供精确分数。',
  },

  whiteLabel: {
    title: '白标信息',
    agencyName: '服务商名称',
    contact: '联系方式',
    logoUrl: 'Logo 链接',
    logoOptional: '留空则不放 Logo',
    defaultHint: '三项都留空时使用默认署名（演示数据里的那一家服务商）。',
    applyHint: '改完白标信息后点「生成报告」生效。',
    none: '不带署名',
    preparedBy: '本报告由 {{agency}} 出品',
  },

  disclaimer:
    '本报告基于抽样采集与既定指标口径，反映的是本品牌在 AI 回答里的可见度与内容适配情况，' +
    '不构成对搜索或 AI 排名结果的承诺。',

  export: {
    title: '导出与分享',
    desktopOnly: '{{format}} 由桌面端提供，演示模式下不可用。',
    done: '已导出：{{path}}',
    cancelled: '已取消导出',
    generatedAt: '生成时间',
    copy: '复制正文',
    copied: '已复制到剪贴板',
  },
};

export default report;

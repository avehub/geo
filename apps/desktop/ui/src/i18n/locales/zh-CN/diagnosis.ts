/**
 * M5 诊断与归因（zh-CN）。
 *
 * 口径来自产品定义 §3.7 的六个视图与附录 C 的加权公式：体检总分（五维加权）、
 * 头号 KPI（Brand Coverage）、竞品对标矩阵、意图漏斗、引擎差异、告警。
 *
 * 🔴 两处必须显示的口径说明：
 * - `score.marginNote`：比率类指标是**区间**不是单点（重复采样得来），不给区间就等于
 *   把随机波动当成变化卖给用户；
 * - `competitors.headToHeadNote`：Share of Voice 的分母是"同框提到多个品牌"的题目数，
 *   不是全部题目——分母口径不写出来，这个数字没法被质疑也没法被信任。
 *
 * 合规（AGENTS 规则 6）：全篇只说"可见度 / 覆盖率 / 提及份额"，不出现排名承诺。
 */
const diagnosis = {
  title: '诊断与归因',
  subtitle: '体检总分、五维得分、竞品对标、意图漏斗与引擎差异',
  staticNote: '总分与各维得分在演示模式下是预置静态值，不由前端按权重重算。',
  round: '轮次',
  noData: '这一轮还没有体检结果：采集未完成或样本不足时不出结论。',

  score: {
    total: 'GEO 体检总分',
    outOf: '满分 100',
    margin: '±{{value}}',
    marginNote: '比率类指标按重复采样给出区间，不当单点读。',
    sample: '样本量',
    coverage: 'Brand Coverage',
    coverageHint: '有多少道题的回答提到了本品牌',
    sov: 'Share of Voice',
    sovHint: '同框题目里的提及份额',
    factAccuracy: '事实准确率',
    factAccuracyHint: '涉及本品牌的回答里，事实说对的比例',
    domains: '被引域名（去重）',
    domainsHint: '信源健康的组成项',
    metricSpec: '指标口径',
    collectedAt: '采集完成时间',
  },

  dimensions: {
    title: '五维得分',
    dimension: '维度',
    score: '得分',
    weight: '权重',
    sample: '样本',
    detail: '说明',
    names: {
      visibility: '可见度',
      recommendation: '推荐力',
      sentiment: '情感倾向',
      fact_accuracy: '事实准确',
      source_health: '信源健康',
    },
    weightNote: '权重取自产品定义附录 C 的口径，界面只做展示、不做归一化计算。',
  },

  trend: {
    title: '环比趋势',
    coverage: 'Brand Coverage',
    totalScore: '体检总分',
    factAccuracy: '事实准确率',
    empty: '还没有可比的轮次。',
    note: '进行中的轮次不进趋势：口径没跑完，画上去就是假变化。',
    axisRound: '轮次',
    legend: '图例',
  },

  alerts: {
    title: '告警',
    empty: '没有告警。',
    acknowledge: '标记已读',
    unacknowledge: '取消已读',
    acknowledged: '已读',
    acknowledgeOk: '已更新告警状态',
    raisedAt: '触发时间',
    metric: '指标',
    delta: '变化量',
    engine: '引擎',
    round: '轮次',
    severities: {
      info: '提示',
      warning: '警告',
      critical: '严重',
    },
    kinds: {
      coverage_drop: '覆盖率下滑',
      negative_sentiment: '负面提及',
      fact_error: '事实错误',
      competitor_overtake: '竞品反超',
    },
    metrics: {
      brand_coverage: 'Brand Coverage',
      fact_error_count: '事实错误条数',
      negative_rate: '负面提及占比',
      share_of_voice: 'Share of Voice',
    },
  },

  competitors: {
    title: '竞品对标矩阵',
    sample: '样本量',
    headToHead: '同框题目',
    headToHeadNote: 'Share of Voice 的分母是"同框提到多个品牌"的 {{total}} 道题，不是全部题目。',
    brand: '品牌',
    self: '本品牌',
    coverage: '覆盖率',
    shareOfVoice: '提及份额',
    top1Rate: 'Top1 率',
    top3Rate: 'Top3 率',
    mentionOnlyRate: '仅提及率',
    positiveRate: '正面率',
    negativeRate: '负面率',
    factErrorCount: '事实错误',
    citedDomainCount: '被引域名',
    empty: '这一轮没有竞品对标数据。',
  },

  funnel: {
    title: '意图漏斗',
    stage: '阶段',
    promptCount: '题目数',
    mentionRate: '提及率',
    top3Rate: 'Top3 率',
    note: '病症结论',
    empty: '这一轮没有漏斗数据。',
    smallDenominator: '这一层只有 {{total}} 道题，比率波动会很大。',
    stages: {
      awareness: '认知层',
      recommendation: '推荐层',
      decision: '决策层',
    },
  },

  engines: {
    title: '引擎差异',
    note: '按事实错误率倒序：先看哪些引擎更容易把本品牌说错。',
    engine: '引擎',
    sample: '样本',
    coverage: '覆盖率',
    top3Rate: 'Top3 率',
    positiveRate: '正面率',
    factErrorRate: '事实错误率',
    successRate: '采集成功率',
    avgLatency: '平均耗时',
    empty: '这一轮还没有引擎数据。',
  },
};

export default diagnosis;

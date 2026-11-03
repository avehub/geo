/**
 * M9 组合总览（多项目）。
 *
 * 口径：组合层只给**计数 + 分布 + 逐项目行**，不对比率取平均（分母不同）。
 * `demoNote` 必须常驻：未采集不是 0 分，待采集行不能被读成"表现最差"。
 */
const portfolio = {
  title: '组合总览',
  subtitle: '多项目 GEO 结果、风险与数据新鲜度',
  demoNote:
    '演示模式下项目摘要来自各项目既有的最近一轮结论；未采集的项目显示「待采集」，不会被当成 0 分。比率只给分布，不做跨项目平均。',
  stats: {
    projects: '项目数',
    withRound: '有结论',
    insufficient: '样本不足',
    alerts: '未读告警',
    samples: '总样本量',
  },
  distribution: {
    title: '指标分布',
    note: 'min / 中位数 / max，不是平均值。',
    countNote: '{{value}} 个项目有结论',
    archivedNote: '归档项目默认不计入。',
    empty: '还没有项目产出结论。',
    min: 'min',
    median: '中位数',
    max: 'max',
    metrics: {
      coverage: '品牌覆盖',
      score: '体检总分',
      sov: '提及份额',
    },
  },
  filters: {
    all: '全部 {{value}}',
    concluded: '有结论 {{value}}',
    onboarding: '待采集 {{value}}',
    risks: '有告警 {{value}}',
  },
  searchPlaceholder: '搜索项目或品牌',
  sort: {
    label: '排序',
    risk: '先看风险',
    coverage: '覆盖从低到高',
    recent: '最近采集',
  },
  table: {
    title: '项目清单',
    project: '项目',
    round: '最近结论',
    coverage: '覆盖',
    score: '总分',
    sov: '提及份额',
    alerts: '未读告警',
    action: '操作',
    open: '打开概览',
    collect: '去采集',
    onboarding: '待采集',
    failed: '读取失败',
    noData: '—',
  },
  empty: '没有符合条件的项目。',
  partialError: '{{value}} 个项目的数据暂时读取失败，行内已标出。',
};

export default portfolio;

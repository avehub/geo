/**
 * 设计样张（`/__design`，仅 vite dev 注册）的界面文案。
 *
 * 为什么进词典而不是写死：`pages/**` 在 `no-hardcoded-strings.test.ts` 的抽取面里，
 * 样张页同样是生产源码；写死中文会让守卫红，也给「dev-only 就可以乱写」开一个坏先例。
 * en-US 侧同批加同一批键（`ResourceBundle = typeof zhCN` 会强制对齐）。
 */
const design = {
  title: '设计样张',
  subtitle: '仅开发环境可见；不进导航，不调用任何命令。',
  note: '生产构建不包含此路由（import.meta.env.DEV 门禁）。',
  devOnly: '仅开发环境',

  colors: {
    title: '色彩',
    brand: '品牌与语义',
    neutral: '中性阶',
    chart: '图表分类色',
    note: '主色只用于主按钮、选中态与链接；状态色只表达状态，不做装饰。',
  },

  type: {
    title: '字体与数字',
    display: '页面标题 20/28 · 600',
    body: '正文 14/22',
    meta: '元信息 12/18',
    number: '数字等宽（tabular-nums）',
    sample: '42.5%',
  },

  space: {
    title: '间距与圆角',
    note: '4 基数：4 / 8 / 12 / 16 / 24 / 32。卡片圆角 8，控件 6，胶囊 4。',
  },

  actions: {
    title: '按钮层级',
    primary: '主按钮',
    secondary: '次按钮',
    text: '文字按钮',
    danger: '危险操作',
  },

  status: {
    title: '状态语言',
    note: '七种状态全站共用一套徽标；未接入与样本不足都不隐藏。',
  },

  metrics: {
    title: '指标块',
    coverage: '品牌覆盖',
    score: 'GEO 体检总分',
    delta: '+13 个百分点',
    margin: '±5 个百分点',
    hint: '有多少道题的回答提到了本品牌',
    insufficient: '仅方向参考',
  },

  verdict: {
    title: '结论条',
    positive: '品牌覆盖 55%，较上一轮提升 13 个百分点。',
    neutral: '本轮样本量与上一轮持平。',
    risk: '豆包事实错误率 18%，有 3 条核查项需要复核。',
    insufficient: '样本量 9，低于 20 的判定门槛。',
    kicker: '本轮结论',
    action: '去看待办',
  },

  table: {
    title: '表格',
    name: '项目',
    status: '状态',
    coverage: '覆盖',
    updated: '更新时间',
  },

  states: {
    title: '空态与错误态',
    emptyTitle: '还没有采集结果',
    emptyBody: '先跑一轮采集，这里会出现可核查的回答样本。',
    emptyAction: '开始采集',
    errorTitle: '这一块暂时取不到数据',
    errorBody: 'ipc/unknown_command：桌面端尚未接入该命令。',
    retry: '重试',
    loading: '加载中',
  },

  strip: {
    title: '演示模式细条',
    note: '32px 常驻、不可关闭；合规句一字不减。',
  },

  density: {
    title: '密度',
    comfortable: '舒适 44',
    compact: '紧凑 36',
    note: '默认舒适；表格工具条可切换到紧凑。',
  },
};

export default design;

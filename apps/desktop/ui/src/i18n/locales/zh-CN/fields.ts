/**
 * 字段名词典（zh-CN）：`validation/failed` 的 `field` 参数 → 人类可读字段名。
 *
 * `field` 的取值来自后端（`task-5-report.md` §3.2 / §3.3 是全量清单），其中**动态**取值
 * （`competitors[{index}].name`、`core_pages[{index}]`、实体卡的 `set_field(path)`）
 * 无法穷举，所以组合器会先做**下标归一化**（去掉 `[数字]`）再查表，查不到就原样显示
 * （裁定 B-4 / F-2）。带点的键（`model.provider`）是**扁平**写法：i18next 的 `deepFind`
 * 支持在嵌套 namespace 里直接命中含点的属性名，因此 `competitors`（叶子）与
 * `competitors.name`（叶子）可以共存——它们在后端是两个不同的 field 值。
 */
const fields = {
  brand_name: '品牌名',
  name: '项目名',
  aliases: '品牌别名',
  tags: '标签',
  region: '所在地域',
  website: '官网地址',
  domain: '官网域名',
  content: '内容',
  csv_header: 'CSV 表头',
  payload: '导入内容',
  format_version: '文件格式版本',
  target_count: '生成条数',
  repeat_count: '改写轮数',
  intents: '意图列表',
  label: '题库名称',
  items: '条目列表',
  ids: '选中条目',
  set_id: '所属题库',
  text: '题目内容',
  weight: '权重',
  api_key: 'API Key',
  language: '语言',
  field_path: '字段路径',
  standard_name: '标准名',
  founded_year: '成立年份',
  qualifications: '资质认证',
  products: '产品与参数',
  'products.name': '产品名',
  price_range: '价格区间',
  service_regions: '服务地域',
  cases: '客户案例',
  differentiators: '差异化卖点',
  official_tone: '官方口径',
  contact: '联系方式',
  'asset.url': '资产链接',
  'competitor.name': '竞品名称',
  'competitor.website': '竞品官网',
  competitors: '竞品数量',
  'competitors.name': '竞品名称',
  'competitors.website': '竞品官网',
  core_pages: '核心页面',
  'model.provider': '服务商',
  'model.model': '模型名',
  'model.base_url': '模型服务地址',
  'model.temperature': '温度',
  'model.timeout_secs': '超时时间',
  'proxy.url': '代理地址',
  'concurrency.max_parallel': '并发上限',
  'concurrency.queue_size': '队列长度',
  'rate_limit.requests_per_minute': '每分钟请求数',
  'rate_limit.min_interval_ms': '最小请求间隔',
  'rate_limit.retry_max': '重试次数上限',

  // -------------------------------------------------------------------------
  // M3–M7：demo 闭环那一轮新发的 `field` 值
  // -------------------------------------------------------------------------
  // 🔴 这批**在 Rust 真值源上还不存在**（M3–M7 尚未落后端）：假后端用既有的
  // `validation/failed` + `reason: 'invalid_id'` 组合报"这个实体 id 认不出"，
  // 于是字段名必须进本词典，否则界面上会露出 `round_id` 这种机器记号。
  // 真后端落地时若换了错误码或字段名，改这里并在
  // `docs/superpowers/specs/2026-09-23-demo-vs-backend-known-divergences.md` 登记。
  round_id: '采集轮次 ID',
  task_id: '采集任务 ID',
  record_id: '证据记录 ID',
  insight_id: '解析结果 ID',
  issue_id: '核查问题 ID',
  self_rank: '品牌位次',
  alert_id: '告警 ID',
  action_id: '处方 ID',
  template_id: '内容模板 ID',
  content_id: '生成文稿 ID',
  variant: '报告版本',
  engine_scope: '引擎范围',
  status: '证据状态筛选',

  // -------------------------------------------------------------------------
  // M6.5 站点接入与补丁工作台那一轮新发的 `field` 值
  // -------------------------------------------------------------------------
  // 🔴 与 M3–M7 那批同一个处境：Rust 真值源上还没有这几条 `field`，假后端用既有的
  // `validation/failed` 报"这一栏是空的 / 这个 id 认不出 / 这个动词不许"，字段名因此必须进词典。
  // 🔴 三个正文栏刻意带 `patch_` 前缀：`title` / `target_url` / `body` 这种裸名在别的命令里
  // 已经指别的东西（`name` = 项目名、`text` = 题目内容），同名不同义会让"哪一栏没填"指错地方。
  patch_id: '补丁 ID',
  patch_title: '补丁标题',
  patch_target_url: '落点页面',
  patch_body: '补丁正文',
  channel_kind: '下发通道',
  kinds: '补丁类型列表',
  review_status: '人工审核状态',
  transition: '补丁动作',

  // -------------------------------------------------------------------------
  // M1.2 知识库那一轮新发的 `field` 值（spec 2026-10-01 · DR-65 / §6）
  // -------------------------------------------------------------------------
  // 🔴 与上面两批同一个处境：Rust 真值源上还没有知识库这个实体，假后端用既有的
  // `validation/failed` 报"这一栏是空的 / 这个 id 认不出"，字段名因此必须进词典。
  // 🔴 三个都带 `kb_` 前缀：`title` / `entry_id` / `block_id` 这种裸名在别的命令里已经指别的东西
  // （`patch_title` = 补丁标题、`name` = 项目名），同名不同义会让"哪一栏没填"指错地方
  // （与 M6.5 那批 `patch_` 前缀同一条裁定）。
  kb_entry_id: '知识条目 ID',
  kb_block_id: '同步块 ID',
  kb_title: '知识标题',
  kb_modules: '知识模块列表',
  // -------------------------------------------------------------------------
  // M1.5 关键词库（Plan C 第一个纵向切片，2026-11-03）
  // -------------------------------------------------------------------------
  keyword_id: '关键词 ID',
  drafts: '关键词草稿',
  kind: '关键词类型',
  intent: '搜索意图',
  priority: '优先级',
  monthly_volume: '月搜索量',
  difficulty: '竞争难度',
  note: '备注',
  // M1.5 FAQ 库（Plan C 第二个纵向切片，2026-11-03）
  faq_id: 'FAQ ID',
  question: '问题',
  answer_markdown: '答案原文',
  category: '分类',
};

export default fields;

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
};

export default fields;

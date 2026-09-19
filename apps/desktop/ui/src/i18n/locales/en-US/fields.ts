import type { ResourceBundle } from '../../resources';

/**
 * 字段名词典（en-US）。键集必须与 zh-CN 侧完全一致（R-G / R-J），
 * 顶部的 `: ResourceBundle['fields']` 标注**不要删**——它是唯一抓得到「en 多键」的一层。
 *
 * **标签一律写成单数头名词**（`Brand alias list` 而不是 `Brand aliases`）。理由：
 * en 的 `validation/failed` 模板是 `'{{field}} {{reason}}'`，而 `errors.reasons.*` 一律以
 * `is …` / `exceeds …` 这类**单数谓语**开头，复数标签会渲染出 `Brand aliases is required`
 * （复审 M-2 实测过 3 条可达组合）。新增 field 时请沿用这个形态；
 * `intents` / `items` 早就是 `Intent list` / `Item list`，是同一套写法。
 * 中文侧没有主谓一致问题，`zh-CN/fields.ts` 保持原样。
 */
const fields: ResourceBundle['fields'] = {
  brand_name: 'Brand name',
  name: 'Project name',
  aliases: 'Brand alias list',
  tags: 'Tag list',
  region: 'Region',
  website: 'Website',
  domain: 'Website domain',
  content: 'Content',
  csv_header: 'CSV header',
  payload: 'Imported payload',
  format_version: 'File format version',
  target_count: 'Target count',
  repeat_count: 'Rewrite rounds',
  intents: 'Intent list',
  label: 'Prompt set name',
  items: 'Item list',
  ids: 'Selected item list',
  set_id: 'Prompt set ID',
  text: 'Prompt text',
  weight: 'Weight',
  api_key: 'API key',
  language: 'Language',
  field_path: 'Field path',
  standard_name: 'Standard name',
  founded_year: 'Founded year',
  qualifications: 'Qualification list',
  products: 'Product and spec list',
  'products.name': 'Product name',
  price_range: 'Price range',
  service_regions: 'Service region list',
  cases: 'Customer case list',
  differentiators: 'Differentiator list',
  official_tone: 'Official tone',
  contact: 'Contact',
  'asset.url': 'Asset URL',
  'competitor.name': 'Competitor name',
  'competitor.website': 'Competitor website',
  competitors: 'Number of competitors',
  'competitors.name': 'Competitor name',
  'competitors.website': 'Competitor website',
  core_pages: 'Core page',
  'model.provider': 'Provider',
  'model.model': 'Model name',
  'model.base_url': 'Model base URL',
  'model.temperature': 'Temperature',
  'model.timeout_secs': 'Timeout',
  'proxy.url': 'Proxy URL',
  'concurrency.max_parallel': 'Max parallel requests',
  'concurrency.queue_size': 'Queue size',
  'rate_limit.requests_per_minute': 'Requests per minute',
  'rate_limit.min_interval_ms': 'Minimum request interval',
  'rate_limit.retry_max': 'Max retries',
};

export default fields;

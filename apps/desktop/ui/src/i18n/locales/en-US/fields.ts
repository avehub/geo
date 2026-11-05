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
  repeat_count: 'Rewrite round count',
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
  'concurrency.max_parallel': 'Parallel request limit',
  'concurrency.queue_size': 'Queue size',
  'rate_limit.requests_per_minute': 'Per-minute request limit',
  'rate_limit.min_interval_ms': 'Minimum request interval',
  'rate_limit.retry_max': 'Max retry count',

  // M3–M7 新增的 field 值。⚠ 标签一律**单数头名词**且首末词都不以 s 结尾
  // （`PLURAL_HEAD_KNOWN` 钉死在 1 条，加胖就红）：`status` 因此不写成 `Status`，
  // 而是 `Record status filter`——头名词落在 filter 上，与单数谓语组合后主谓一致。
  round_id: 'Collection round ID',
  task_id: 'Collection task ID',
  record_id: 'Evidence record ID',
  insight_id: 'Answer insight ID',
  issue_id: 'Fact-check issue ID',
  self_rank: 'Brand mention rank',
  alert_id: 'Alert ID',
  action_id: 'Prescription ID',
  template_id: 'Content template ID',
  content_id: 'Generated content ID',
  variant: 'Report variant',
  engine_scope: 'Engine scope',
  status: 'Record status filter',

  // M6.5 Site Connect & Patch Bench (spec 2026-09-30, DR-52).
  // ⚠ Same singular-head-noun rule as the block above: `review_status` is therefore
  // `Manual review state` and not `Review status` — a trailing `status` ends in s, so
  // `pluralHead()` would flag it and the sentence would read "Review status is …".
  // `kinds` keeps the `… list` shape already used by `intents` / `items`.
  patch_id: 'Site patch ID',
  patch_title: 'Patch title',
  patch_target_url: 'Target page URL',
  patch_body: 'Patch body',
  channel_kind: 'Delivery channel',
  kinds: 'Patch kind list',
  review_status: 'Manual review state',
  transition: 'Patch action',

  // M1.2 Knowledge base (spec 2026-10-01, DR-65).
  // ⚠ Same singular-head-noun rule as the two blocks above (`PLURAL_HEAD_KNOWN` is pinned at 1):
  // `kb_modules` therefore keeps the `… list` shape already used by `intents` / `items` / `kinds`.
  kb_entry_id: 'Knowledge entry ID',
  kb_block_id: 'Synced block ID',
  kb_title: 'Knowledge title',
  kb_modules: 'Knowledge module list',
  // M1.5 Keyword library (Plan C first vertical slice, 2026-11-03).
  // ⚠ Avoid plural head nouns: `drafts` is therefore `Keyword draft list`.
  keyword_id: 'Keyword ID',
  drafts: 'Keyword draft list',
  kind: 'Keyword type',
  intent: 'Search intent',
  priority: 'Priority',
  monthly_volume: 'Monthly search volume',
  difficulty: 'Competition difficulty',
  note: 'Note',
  // M1.5 FAQ library (Plan C second vertical slice, 2026-11-03).
  faq_id: 'FAQ ID',
  question: 'Question',
  answer_markdown: 'Answer text',
  category: 'Category',
  // M5.5 Webmaster data (Plan C fifth slice).
  source_kind: 'Data source type',
  opportunity_id: 'Optimization opportunity ID',
  opportunity_status: 'Opportunity state',
  binding: 'Site binding',
  period_start: 'Start date',
  period_end: 'End date',
};

export default fields;
